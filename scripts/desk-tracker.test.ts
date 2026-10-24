import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import vm from 'node:vm';
import {
  configureTracker,
  fetchTrackedHead,
  ingestTrackerSnapshot,
  mergeTrackerSnapshot,
  normalizeTrackedRepo,
  parseGitAdvertisement,
  trackerKey,
  trackerSnapshotSchema,
  verifyTrackerSignature,
  type GithubTracker,
  type TrackerSnapshot,
} from '../lib/desk/github-tracker';
import { sheetBridgeScript } from '../lib/desk/tracker-bridge';
import { newEvent } from '../lib/desk/demo';
import { db, getEvent, insertEvent, insertUser } from '../lib/desk/store';
import { stateFor } from '../lib/desk/service';
import type { User } from '../lib/desk/types';

mkdirSync('work', { recursive: true });
const directory = mkdtempSync(path.join(process.cwd(), 'work/tracker-test-'));
process.env.DESK_DB_PATH = path.join(directory, 'test.sqlite');
process.env.TRACKER_BRIDGE_SECRET =
  'fixture-secret-that-is-at-least-32-characters';
const source = {
  spreadsheetId: 'spreadsheet_fixture_1234567890',
  gid: 42,
  sheetName: 'Responses',
};
const now = () => new Date().toISOString();
const eventId = randomUUID();
const row = (
  number: number,
  repoCandidate = '',
  participantName = 'Builder',
) => ({
  row: number,
  submittedAt: '2026-10-24 20:00',
  participantName,
  repoCandidate,
});
const snapshot = (rows: TrackerSnapshot['rows']): TrackerSnapshot => ({
  eventId,
  source,
  capturedAt: now(),
  rows,
});
const blank = (): GithubTracker => ({
  source,
  configuredAt: now(),
  rows: [],
  repositories: {},
});
const pkt = (text: string) =>
  Buffer.from(
    (Buffer.byteLength(text) + 4).toString(16).padStart(4, '0') + text,
  );

after(async () => {
  await db().close();
  rmSync(directory, { recursive: true, force: true });
});

void test('normalizes real form variants and rejects other hosts or embedded credentials', () => {
  for (const value of [
    'github.com/Owner/Repo',
    'https://www.github.com/Owner/Repo.git',
    'https://github.com/Owner/Repo,',
    'git@github.com:Owner/Repo.git',
  ])
    assert.equal(normalizeTrackedRepo(value)?.key, 'owner/repo');
  for (const value of [
    'https://github.com.evil.example/a/b',
    'https://token@github.com/a/b',
    'file:///a/b',
    'https://github.com/a',
  ])
    assert.equal(normalizeTrackedRepo(value), null);
});

void test('retains unknown rows, adds late/corrected links, and deduplicates with every participant association', () => {
  const state = mergeTrackerSnapshot(
    blank(),
    snapshot([row(2), row(3, 'github.com/a/b')]),
    now(),
  );
  assert.equal(state.rows.filter((r) => r.issue).length, 1);
  mergeTrackerSnapshot(
    state,
    snapshot([
      row(2, 'github.com/later/entry'),
      row(3, 'github.com/a/b'),
      row(4, 'github.com/A/B.git', 'Second builder'),
      row(5, 'github.com/one/repo, github.com/two/repo'),
    ]),
    now(),
  );
  assert.equal(Object.keys(state.repositories).length, 4);
  assert.deepEqual(state.repositories['a/b'].sourceRows, [3, 4]);
  assert.equal(state.repositories['a/b'].participants.length, 2);
  assert.equal(state.rows.filter((r) => r.issue).length, 0);
  mergeTrackerSnapshot(
    state,
    snapshot([row(2, 'github.com/later/entry')]),
    now(),
  );
  assert.equal(Object.keys(state.repositories).length, 4);
  assert.equal(state.repositories['a/b'].presentInSheet, false);
});

void test('rejects duplicate row references, stale snapshots and mismatched sources', () => {
  assert.throws(
    () => trackerSnapshotSchema.parse(snapshot([row(2), row(2)])),
    /Duplicate/,
  );
  const state = mergeTrackerSnapshot(blank(), snapshot([row(2)]), now());
  assert.throws(
    () =>
      mergeTrackerSnapshot(
        state,
        { ...snapshot([]), capturedAt: '2020-01-01T00:00:00.000Z' },
        now(),
      ),
    /older/,
  );
  assert.throws(
    () =>
      mergeTrackerSnapshot(
        state,
        { ...snapshot([]), source: { ...source, gid: 99 } },
        now(),
      ),
    /another sheet/,
  );
});

void test('validates Git reference packets, default branch, empty repos and malformed responses', () => {
  const sha = 'a'.repeat(40);
  const data = Buffer.concat([
    pkt('# service=git-upload-pack\n'),
    Buffer.from('0000'),
    pkt(`${sha} HEAD\0multi_ack symref=HEAD:refs/heads/main\n`),
    Buffer.from('0000'),
  ]);
  assert.deepEqual(parseGitAdvertisement(data), { sha, branch: 'main' });
  assert.equal(
    parseGitAdvertisement(
      Buffer.concat([pkt('# service=git-upload-pack\n'), Buffer.from('0000')]),
    ),
    null,
  );
  assert.throws(() => parseGitAdvertisement(Buffer.from('<html>')), /Invalid/);
  assert.throws(
    () => parseGitAdvertisement(Buffer.from('0010short')),
    /Truncated/,
  );
});

void test('requires an event-specific HMAC and rejects tampering, expired requests and cross-event signatures', () => {
  const timestamp = String(Date.now()),
    body = JSON.stringify(snapshot([row(2)]));
  const signature = createHmac('sha256', trackerKey(eventId))
    .update(`${timestamp}.${body}`)
    .digest('hex');
  verifyTrackerSignature(eventId, body, timestamp, signature);
  assert.throws(
    () => verifyTrackerSignature(eventId, body + ' ', timestamp, signature),
    /authentication/,
  );
  assert.throws(
    () => verifyTrackerSignature(randomUUID(), body, timestamp, signature),
    /authentication/,
  );
  assert.throws(
    () =>
      verifyTrackerSignature(
        eventId,
        body,
        timestamp,
        signature,
        Number(timestamp) + 300001,
      ),
    /Expired/,
  );
});

void test('the Google bridge sends a full sanitized snapshot and installs both cloud triggers only after success', () => {
  const properties = new Map<string, string>(),
    triggers: string[] = [];
  let sent: { body: string; headers: Record<string, string> } | undefined;
  const values = [
    Array(7).fill('Timestamp'),
    Array(7).fill('2026-10-24 20:00'),
    [
      '2026-10-24 20:01',
      'private@example.com',
      'Later builder',
      'github.com/a/b',
      'Description',
      'private-phone',
      'another@example.com',
    ],
  ];
  const sheet = {
    getSheetId: () => 42,
    getLastRow: () => values.length,
    getLastColumn: () => 7,
    getRange: () => ({ getDisplayValues: () => values }),
  };
  const spreadsheet = {
    getId: () => source.spreadsheetId,
    getSheets: () => [sheet],
  };
  const builder = {
    forSpreadsheet: () => builder,
    onFormSubmit: () => {
      triggers.push('submit');
      return builder;
    },
    timeBased: () => builder,
    everyMinutes: (minutes: number) => {
      assert.equal(minutes, 15);
      triggers.push('timer');
      return builder;
    },
    create: () => ({}),
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => properties.get(k),
        setProperty: (k: string, v: string) => properties.set(k, v),
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => builder },
    Utilities: {
      computeHmacSha256Signature: (text: string, secret: string) =>
        [...createHmac('sha256', secret).update(text).digest()].map((b) =>
          b > 127 ? b - 256 : b,
        ),
    },
    UrlFetchApp: {
      fetch: (
        endpoint: string,
        options: { payload: string; headers: Record<string, string> },
      ) => {
        assert.equal(endpoint, 'https://app.example/api/desk/tracker/ingest');
        sent = { body: options.payload, headers: options.headers };
        return { getResponseCode: () => 200 };
      },
    },
  });
  vm.runInContext(
    sheetBridgeScript(eventId, source, 'https://app.example') +
      '\ninstallTrackerBridge();',
    context,
  );
  assert.deepEqual(triggers, ['submit', 'timer']);
  assert.ok(sent);
  assert.ok(
    !sent.body.includes('private@example') &&
      !sent.body.includes('private-phone'),
  );
  const payload = trackerSnapshotSchema.parse(JSON.parse(sent.body));
  assert.equal(payload.rows.length, 2);
  assert.equal(payload.rows[0].timestampOnly, true);
  assert.equal(payload.rows[1].participantName, 'Later builder');
  verifyTrackerSignature(
    eventId,
    sent.body,
    sent.headers['x-tracker-timestamp'],
    sent.headers['x-tracker-signature'],
  );
});

void test('persists late submissions, recovers GitHub failures, and hides tracker data from non-organizers', async () => {
  const event = newEvent('Tracker test');
  event.id = eventId;
  await insertEvent(event);
  const organizer: User = {
    id: randomUUID(),
    eventId,
    role: 'organizer',
    name: 'Organizer',
    email: `${randomUUID()}@example.test`,
    skills: [],
  };
  const participant: User = {
    ...organizer,
    id: randomUUID(),
    role: 'participant',
    name: 'Participant',
    email: `${randomUUID()}@example.test`,
  };
  await insertUser(organizer, 'unused-hashed-fixture');
  await insertUser(participant, 'unused-hashed-fixture');
  await assert.rejects(configureTracker(participant, source), /Organizer/);
  await configureTracker(organizer, source);
  await ingestTrackerSnapshot(
    snapshot([row(2), row(3, 'github.com/a/b')]),
    true,
    async () => ({ sha: 'a'.repeat(40), branch: 'main' }),
  );
  await ingestTrackerSnapshot(
    snapshot([row(2, 'github.com/late/team'), row(3, 'github.com/a/b')]),
    true,
    async () => {
      throw new Error('unavailable');
    },
  );
  const failed = (await getEvent(eventId)).githubTracker!;
  assert.equal(Object.keys(failed.repositories).length, 2);
  assert.equal(failed.repositories['a/b'].sha, 'a'.repeat(40));
  assert.equal(failed.repositories['a/b'].status, 'unavailable');
  await ingestTrackerSnapshot(
    snapshot([row(2, 'github.com/late/team'), row(3, 'github.com/a/b')]),
    true,
    async () => ({ sha: 'b'.repeat(40) }),
  );
  const final = (await getEvent(eventId)).githubTracker!;
  assert.equal(final.repositories['a/b'].changes.length, 1);
  assert.equal(final.repositories['late/team'].baselineSha, 'b'.repeat(40));
  assert.ok(final.lastBridgeAt);
  assert.equal((await stateFor(participant)).event.githubTracker, undefined);
  assert.ok((await stateFor(organizer)).event.githubTracker);
});

if (process.env.TRACKER_LIVE_TEST === '1')
  void test('reads a real public GitHub default-branch HEAD without API credentials', async () => {
    const repo = {
      ...normalizeTrackedRepo('https://github.com/vaishakh3/hackathoneval')!,
      firstSeenAt: now(),
      status: 'pending' as const,
      sourceRows: [],
      participants: [],
      presentInSheet: true,
      changes: [],
    };
    const head = await fetchTrackedHead(repo);
    assert.match(head!.sha, /^[a-f0-9]{40}$/);
  });
