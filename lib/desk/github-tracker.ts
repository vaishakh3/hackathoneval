import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { addAudit } from './domain';
import { getEvent, mutateEvent, requireThat } from './store';
import type { DeskEvent, User } from './types';
import { queueRepositoryJudgments } from './repo-judge-queue';
import type { RepositoryJudgment } from './repo-judge-types';
import { normalizeJudgmentCoverage } from './repo-judge-types';

export const trackerSourceSchema = z.object({
  spreadsheetId: z.string().regex(/^[\w-]{20,150}$/),
  gid: z.number().int().nonnegative(),
  sheetName: z.string().trim().min(1).max(100),
});
export const trackerSnapshotSchema = z
  .object({
    eventId: z.uuid(),
    source: trackerSourceSchema,
    capturedAt: z.iso.datetime(),
    rows: z
      .array(
        z.object({
          row: z.number().int().min(2).max(100000),
          submittedAt: z.string().max(100),
          participantName: z.string().trim().max(200),
          repoCandidate: z.string().trim().max(1000),
          timestampOnly: z.boolean().optional(),
        }),
      )
      .max(2000),
  })
  .superRefine((value, context) => {
    if (new Set(value.rows.map((r) => r.row)).size !== value.rows.length)
      context.addIssue({
        code: 'custom',
        message: 'Duplicate sheet row references.',
      });
  });
export type TrackerSource = z.infer<typeof trackerSourceSchema>;
export type TrackerSnapshot = z.infer<typeof trackerSnapshotSchema>;
type TrackerRow = TrackerSnapshot['rows'][number] & {
  repositories: string[];
  issue?: string;
};
export type TrackedRepository = {
  judgments?: RepositoryJudgment[];
  key: string;
  fullName: string;
  url: string;
  firstSeenAt: string;
  sourceRows: number[];
  participants: string[];
  presentInSheet: boolean;
  status: 'pending' | 'tracking' | 'empty' | 'unavailable';
  sha?: string;
  branch?: string;
  baselineSha?: string;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  error?: string;
  changes: { from: string; to: string; observedAt: string }[];
};
export type GithubTracker = {
  judge?: { enabled: boolean; enabledAt: string };
  source: TrackerSource;
  configuredAt: string;
  sourceCapturedAt?: string;
  lastBridgeAt?: string;
  lastRefreshedAt?: string;
  rows: TrackerRow[];
  repositories: Record<string, TrackedRepository>;
  lease?: { id: string; until: string };
};

export function normalizeTrackedRepo(value: string) {
  let candidate = value.trim().replace(/[,;]+$/, '');
  candidate = candidate.replace(/^git@github\.com:/i, 'https://github.com/');
  if (/^(?:www\.)?github\.com\//i.test(candidate))
    candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (
      url.protocol !== 'https:' ||
      !['github.com', 'www.github.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !match ||
      match.slice(1).some((s) => /^\.+$/.test(s))
    )
      return null;
    const fullName = `${match[1]}/${match[2]}`;
    return {
      key: fullName.toLowerCase(),
      fullName,
      url: `https://github.com/${fullName}`,
    };
  } catch {
    return null;
  }
}

export function mergeTrackerSnapshot(
  tracker: GithubTracker,
  snapshot: TrackerSnapshot,
  receivedAt: string,
) {
  requireThat(
    JSON.stringify(tracker.source) === JSON.stringify(snapshot.source),
    'The snapshot belongs to another sheet.',
    409,
  );
  requireThat(
    !tracker.sourceCapturedAt ||
      snapshot.capturedAt >= tracker.sourceCapturedAt,
    'An older sheet snapshot cannot replace newer coverage.',
    409,
  );
  requireThat(
    Date.parse(snapshot.capturedAt) <= Date.parse(receivedAt) + 300000,
    'The snapshot timestamp is in the future.',
  );
  for (const repo of Object.values(tracker.repositories)) {
    repo.presentInSheet = false;
    repo.sourceRows = [];
  }
  tracker.rows = snapshot.rows.map((row) => {
    const candidates = row.repoCandidate.split(/[\s,;]+/).filter(Boolean);
    const parsed = candidates
      .map(normalizeTrackedRepo)
      .filter((r) => r !== null);
    const unique = [...new Map(parsed.map((r) => [r.key, r])).values()];
    for (const repo of unique) {
      const current = (tracker.repositories[repo.key] ||= {
        ...repo,
        firstSeenAt: receivedAt,
        status: 'pending',
        sourceRows: [],
        participants: [],
        presentInSheet: true,
        changes: [],
      });
      current.presentInSheet = true;
      current.sourceRows.push(row.row);
      if (
        row.participantName &&
        !current.participants.includes(row.participantName)
      )
        current.participants.push(row.participantName);
    }
    return {
      ...row,
      repositories: unique.map((r) => r.key),
      issue: row.timestampOnly
        ? 'Source row contains only repeated timestamps.'
        : !unique.length
          ? 'Repository link is missing or needs correction.'
          : parsed.length !== candidates.length
            ? 'An additional repository link needs correction.'
            : undefined,
    };
  });
  tracker.sourceCapturedAt = snapshot.capturedAt;
  return tracker;
}

// Read Git's bounded reference advertisement; no repository code is downloaded or executed.
// This avoids requiring a personal GitHub token for public-repository polling.
export function parseGitAdvertisement(
  bytes: Uint8Array,
): { sha: string; branch?: string } | null {
  const data = Buffer.from(bytes);
  let offset = 0;
  while (offset < data.length) {
    if (offset + 4 > data.length) throw new Error('Truncated Git response.');
    const header = data.subarray(offset, offset + 4).toString('ascii');
    if (!/^[\da-f]{4}$/i.test(header)) throw new Error('Invalid Git response.');
    const length = parseInt(header, 16);
    offset += 4;
    if (length === 0) continue;
    if (length < 4 || offset + length - 4 > data.length)
      throw new Error('Truncated Git packet.');
    const packet = data.subarray(offset, offset + length - 4).toString('utf8');
    offset += length - 4;
    const [reference, capabilities = ''] = packet.split('\0');
    const match = reference.trimEnd().match(/^([a-f0-9]{40}) HEAD$/i);
    if (match && !/^0+$/.test(match[1]))
      return {
        sha: match[1],
        branch: capabilities.match(/symref=HEAD:refs\/heads\/(\S+)/)?.[1],
      };
  }
  return null;
}

export async function fetchTrackedHead(
  repo: TrackedRepository,
): Promise<{ sha: string; branch?: string } | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Build-Desk-Tracker',
    'Git-Protocol': 'version=0',
  };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64')}`;
  const response = await fetch(
    `https://github.com/${repo.fullName}.git/info/refs?service=git-upload-pack`,
    {
      headers,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  requireThat(
    response.headers
      .get('content-type')
      ?.includes('application/x-git-upload-pack-advertisement'),
    'GitHub returned an unexpected response.',
    502,
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub returned no data.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512000)
        throw new Error('Repository reference list exceeds the size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parseGitAdvertisement(Buffer.concat(chunks));
}

export function trackerKey(eventId: string) {
  requireThat(
    process.env.TRACKER_BRIDGE_SECRET?.length &&
      process.env.TRACKER_BRIDGE_SECRET.length >= 32,
    'The deployment owner must configure TRACKER_BRIDGE_SECRET.',
    503,
  );
  return createHmac('sha256', process.env.TRACKER_BRIDGE_SECRET)
    .update(`sheet-tracker:${eventId}`)
    .digest('hex');
}
export function verifyTrackerSignature(
  eventId: string,
  body: string,
  timestamp: string,
  signature: string,
  now = Date.now(),
) {
  requireThat(
    /^\d{13}$/.test(timestamp) && Math.abs(now - Number(timestamp)) <= 300000,
    'Expired tracker request.',
    401,
  );
  requireThat(
    /^[a-f0-9]{64}$/i.test(signature),
    'Tracker authentication required.',
    401,
  );
  const expected = createHmac('sha256', trackerKey(eventId))
    .update(`${timestamp}.${body}`)
    .digest();
  requireThat(
    timingSafeEqual(expected, Buffer.from(signature, 'hex')),
    'Tracker authentication required.',
    401,
  );
}

export async function configureTracker(user: User, source: TrackerSource) {
  requireThat(user.role === 'organizer', 'Organizer access is required.', 403);
  trackerKey(user.eventId);
  await mutateEvent(user.eventId, (event) => {
    requireThat(!event.demo, 'Connect the submission sheet to a real event.');
    if (event.githubTracker) {
      requireThat(
        JSON.stringify(event.githubTracker.source) === JSON.stringify(source),
        'This event is already connected to a different sheet.',
        409,
      );
      return;
    }
    event.githubTracker = {
      source,
      configuredAt: new Date().toISOString(),
      rows: [],
      repositories: {},
    };
    addAudit(
      event,
      user.name,
      'Connected the submission sheet to hosted GitHub tracking.',
    );
  });
}

export async function ingestTrackerSnapshot(
  snapshot: TrackerSnapshot,
  bridge: boolean,
  fetchHead = fetchTrackedHead,
) {
  const receivedAt = new Date().toISOString();
  const leaseId = randomUUID();
  const targets = await mutateEvent(snapshot.eventId, (event) => {
    requireThat(
      event.githubTracker,
      'Connect the submission sheet in the organizer tracker first.',
      409,
    );
    const tracker = mergeTrackerSnapshot(
      event.githubTracker,
      snapshot,
      receivedAt,
    );
    if (bridge) tracker.lastBridgeAt = receivedAt;
    if (tracker.lease && Date.parse(tracker.lease.until) > Date.now())
      return null;
    tracker.lease = {
      id: leaseId,
      until: new Date(Date.now() + 180000).toISOString(),
    };
    return Object.values(tracker.repositories)
      .sort((a, b) =>
        (a.lastCheckedAt || '').localeCompare(b.lastCheckedAt || ''),
      )
      .slice(0, 100);
  });
  if (!targets) return { status: 'refresh-already-running' };
  const results = new Map<
    string,
    { head?: { sha: string; branch?: string } | null; error?: string }
  >();
  let index = 0;
  const deadline = Date.now() + 120000;
  await Promise.all(
    Array.from({ length: Math.min(6, targets.length) }, async () => {
      while (index < targets.length && Date.now() < deadline) {
        const repo = targets[index++];
        try {
          results.set(repo.key, { head: await fetchHead(repo) });
        } catch {
          results.set(repo.key, {
            error:
              'GitHub could not be read. Private, missing, renamed, or temporarily unavailable; will retry.',
          });
        }
      }
    }),
  );
  await mutateEvent(snapshot.eventId, (event) => {
    const tracker = event.githubTracker!;
    if (tracker.lease?.id !== leaseId) return;
    const checkedAt = new Date().toISOString();
    for (const [key, result] of results) {
      const repo = tracker.repositories[key];
      repo.lastCheckedAt = checkedAt;
      if (result.error) {
        repo.status = 'unavailable';
        repo.error = result.error;
        continue;
      }
      if (!result.head) {
        repo.status = 'empty';
        repo.error = 'No default-branch commit is available yet; will retry.';
        continue;
      }
      if (repo.sha && repo.sha !== result.head.sha)
        repo.changes = [
          ...repo.changes,
          { from: repo.sha, to: result.head.sha, observedAt: checkedAt },
        ].slice(-100);
      repo.baselineSha ||= result.head.sha;
      repo.sha = result.head.sha;
      repo.branch = result.head.branch;
      repo.lastSuccessAt = checkedAt;
      repo.status = 'tracking';
      delete repo.error;
    }
    tracker.lastRefreshedAt = checkedAt;
    delete tracker.lease;
    queueRepositoryJudgments(tracker, checkedAt);
  });
  const tracker = (await getEvent(snapshot.eventId)).githubTracker!;
  return {
    status: 'refreshed',
    responses: tracker.rows.length,
    repositories: Object.keys(tracker.repositories).length,
    unresolved: tracker.rows.filter((r) => r.issue).length,
    checked: results.size,
  };
}

export function trackerFromEvent(event: DeskEvent, user: User) {
  requireThat(
    user.role === 'organizer' && event.id === user.eventId,
    'Organizer access is required.',
    403,
  );
  if (event.githubTracker)
    Object.values(event.githubTracker.repositories).forEach((repo) =>
      repo.judgments?.forEach(normalizeJudgmentCoverage),
    );
  return event.githubTracker || null;
}
