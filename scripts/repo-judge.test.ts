import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  collectRepositoryEvidence,
  readRepositoryTar,
  selectRepositorySources,
  SOURCE_CHARACTER_LIMIT,
} from '../lib/desk/repo-evidence';
import { validateRepositoryAssessment } from '../lib/desk/repo-judge-ai';
import {
  queueRepositoryJudgments,
  reserveRepositoryJudgments,
} from '../lib/desk/repo-judge-queue';
import {
  claimRepositoryJudgment,
  enableRepositoryJudge,
  finishRepositoryJudgment,
  repositoryJudgmentFor,
  failRepositoryJudgment,
} from '../lib/desk/repo-judge';
import {
  ingestTrackerSnapshot,
  type GithubTracker,
} from '../lib/desk/github-tracker';
import { newEvent } from '../lib/desk/demo';
import {
  db,
  getEvent,
  insertEvent,
  insertUser,
  mutateEvent,
} from '../lib/desk/store';
import { stateFor } from '../lib/desk/service';
import type {
  RepositoryAssessment,
  ReviewSource,
} from '../lib/desk/repo-judge-types';
import { normalizeJudgmentCoverage } from '../lib/desk/repo-judge-types';
import type { User } from '../lib/desk/types';

const directory = mkdtempSync(path.join(tmpdir(), 'repository-judge-'));
process.env.DESK_DB_PATH = path.join(directory, 'fixture.sqlite');
process.env.OPENAI_API_KEY = 'fixture-no-network';
const sha = 'a'.repeat(40),
  newer = 'b'.repeat(40),
  latest = 'c'.repeat(40);
const source = {
  spreadsheetId: 'fixture_spreadsheet_123456789',
  gid: 42,
  sheetName: 'Responses',
};
const tracker = (): GithubTracker => ({
  source,
  configuredAt: new Date().toISOString(),
  judge: { enabled: true, enabledAt: new Date().toISOString() },
  rows: [],
  repositories: {
    'owner/app': {
      key: 'owner/app',
      fullName: 'owner/app',
      url: 'https://github.com/owner/app',
      firstSeenAt: new Date().toISOString(),
      sourceRows: [2],
      participants: ['Builder'],
      presentInSheet: true,
      status: 'tracking',
      sha,
      changes: [],
    },
  },
});
const assessment = (): RepositoryAssessment => ({
  summary: 'A source-based fixture.',
  architecture: 'A handler and storage adapter.',
  features: [
    {
      name: 'Save notes',
      description: 'Persists notes through a handler.',
      status: 'implemented',
      evidence: [{ fileId: 'F1', startLine: 1, endLine: 2 }],
      caveats: [],
    },
  ],
  caveats: [],
  latestChanges: [],
  questions: [],
  limitations: [],
});
const sources: ReviewSource[] = [
  { id: 'F1', path: 'src/notes.ts', lines: 3, inspectedLines: 3, kind: 'code' },
  {
    id: 'F2',
    path: 'README.md',
    lines: 4,
    inspectedLines: 4,
    kind: 'documentation',
  },
];
after(async () => {
  await db().close();
  rmSync(directory, { recursive: true, force: true });
});

function tarMember(name: string, text: string, type = '0') {
  const body = Buffer.from(text),
    header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write('ustar\0', 257);
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([
    header,
    body,
    Buffer.alloc((512 - (body.length % 512)) % 512),
  ]);
}
void test('archive parsing reads regular files, ignores traversal/symlinks, and rejects corrupt or oversized members', () => {
  const tar = Buffer.concat([
    tarMember('root/src/app.ts', 'export const save=()=>true;'),
    tarMember('root/../escape.ts', 'bad'),
    tarMember('root/link.ts', 'src/app.ts', '2'),
    Buffer.alloc(1024),
  ]);
  assert.deepEqual(
    readRepositoryTar(tar).map((f) => f.path),
    ['src/app.ts'],
  );
  const corrupt = Buffer.from(tar);
  corrupt[40] ^= 1;
  assert.throws(() => readRepositoryTar(corrupt), /corrupt/);
  assert.throws(() => readRepositoryTar(tar.subarray(0, 520)), /incomplete/);
});
void test('source coverage includes UI, APIs, data and tests while excluding credentials, binaries and vendored/generated code', () => {
  const files = [
    ['README.md', 'Claims'],
    ['package.json', '{}'],
    ['app/page.tsx', 'export default function App(){return <div/>}'],
    ['lib/api.py', 'def run(): pass'],
    ['tests/api.test.ts', 'test()'],
    ['.env', 'OPENAI_API_KEY=secret'],
    ['node_modules/pkg/index.js', 'vendored'],
    ['dist/app.js', 'generated'],
    ['src/binary.ts', 'a\0b'],
    ['src/huge.ts', 'x'.repeat(180001)],
  ];
  const result = selectRepositorySources(
    files.map(([path, text]) => ({ path, bytes: Buffer.from(text) })),
  );
  assert.equal(result.coverage.eligibleFiles, 6);
  assert.equal(result.files.length, 5);
  assert.deepEqual(result.coverage.omittedFiles, ['src/huge.ts']);
  assert.deepEqual(
    new Set(result.files.map((f) => f.kind)),
    new Set(['documentation', 'configuration', 'code', 'test']),
  );
  const secret = selectRepositorySources([
    {
      path: 'src/config.ts',
      bytes: Buffer.from('const token="sk-proj-' + 'A'.repeat(40) + '";'),
    },
  ]);
  assert.match(secret.files[0].text, /credential omitted/);
  const multiline = selectRepositorySources([
    {
      path: 'src/key.ts',
      bytes: Buffer.from(
        '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\nexport const feature=true;',
      ),
    },
  ]);
  assert.equal(
    multiline.files[0].text.split('\n')[3],
    'export const feature=true;',
  );
});
void test('coverage limits remain explicit rather than silently claiming to read the entire repository', () => {
  const result = selectRepositorySources(
    Array.from({ length: 180 }, (_, i) => ({
      path: `src/file${i}.ts`,
      bytes: Buffer.from('export const x=1;\n'.repeat(400)),
    })),
  );
  assert.ok(result.coverage.inspectedCharacters <= SOURCE_CHARACTER_LIMIT);
  assert.ok(result.coverage.omittedFiles.length > 0);
  assert.ok(result.batches.length > 1);
});
void test('files with no complete line inside the remaining budget are omitted, including older saved coverage', () => {
  const result = selectRepositorySources(
    [180000, 180000, 180000, 179998, 100].map((size, i) => ({
      path: `src/${i}.ts`,
      bytes: Buffer.from('x'.repeat(size)),
    })),
  );
  assert.equal(result.files.length, 4);
  assert.deepEqual(result.coverage.omittedFiles, ['src/4.ts']);
  assert.deepEqual(result.coverage.truncatedFiles, []);
  assert.equal(
    result.coverage.eligibleFiles,
    result.coverage.inspectedFiles + result.coverage.omittedFiles.length,
  );
  const t = tracker();
  queueRepositoryJudgments(t, new Date().toISOString());
  const job = t.repositories['owner/app'].judgments![0];
  job.coverage = {
    ...result.coverage,
    omittedFiles: [],
    truncatedFiles: ['src/0.ts', 'src/4.ts'],
  };
  job.sources = result.files.map(({ text: _text, ...source }) => source);
  job.assessment = {
    ...assessment(),
    limitations: ['Coverage is bounded: old counts.'],
  };
  normalizeJudgmentCoverage(job);
  assert.deepEqual(job.coverage.omittedFiles, ['src/4.ts']);
  assert.deepEqual(job.coverage.truncatedFiles, ['src/0.ts']);
  assert.match(job.assessment.limitations[0], /1 files truncated/);
});
void test('archive failures fall back to the pinned file tree and disclose unreadable, oversized and truncated coverage', async () => {
  const urls: string[] = [];
  const request: typeof fetch = async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    urls.push(url);
    if (url.includes('codeload.github.com'))
      return new Response('Unavailable', { status: 503 });
    if (url.includes('api.github.com'))
      return Response.json({
        truncated: true,
        tree: [
          { path: 'src/app.ts', type: 'blob', mode: '100644', size: 40 },
          { path: 'src/unreadable.ts', type: 'blob', mode: '100644', size: 20 },
          { path: 'src/huge.ts', type: 'blob', mode: '100644', size: 200000 },
          { path: '.env.local', type: 'blob', mode: '100644', size: 40 },
          { path: 'link.ts', type: 'blob', mode: '120000', size: 10 },
        ],
      });
    if (url.endsWith('/src/app.ts'))
      return new Response('export function save(){return true;}');
    return new Response('Unavailable', { status: 404 });
  };
  const bundle = await collectRepositoryEvidence(
    'owner/app',
    sha,
    undefined,
    request,
  );
  assert.deepEqual(
    bundle.sources.map((f) => f.path),
    ['src/app.ts'],
  );
  assert.equal(bundle.coverage.sourceMethod, 'github-tree');
  assert.equal(bundle.coverage.inventoryTruncated, true);
  assert.equal(bundle.coverage.eligibleFiles, 3);
  assert.deepEqual(
    new Set(bundle.coverage.omittedFiles),
    new Set(['src/unreadable.ts', 'src/huge.ts']),
  );
  assert.equal(bundle.coverage.diffAvailable, false);
  assert.ok(
    !urls.some((u) => u.endsWith('/.env.local') || u.endsWith('/link.ts')),
  );
  assert.ok(
    urls
      .filter((u) => u.includes('raw.githubusercontent.com'))
      .every((u) => u.includes(sha)),
  );
});
void test('invented/out-of-range citations are rejected and README-only claims cannot become implemented features', () => {
  const a = assessment();
  a.features[0].evidence = [
    { fileId: 'missing', startLine: 1, endLine: 2 },
    { fileId: 'F1', startLine: 1, endLine: 99 },
    { fileId: 'F2', startLine: 1, endLine: 3 },
  ];
  a.caveats = [
    {
      severity: 'medium',
      detail: 'A limited-coverage inference.',
      basis: 'source',
      evidence: [{ fileId: 'missing', startLine: 1, endLine: 2 }],
    },
  ];
  const valid = validateRepositoryAssessment(a, sources);
  assert.equal(valid.features[0].status, 'claimed');
  assert.equal(valid.features[0].evidence.length, 1);
  assert.equal(valid.caveats[0].basis, 'inference');
  assert.equal(
    validateRepositoryAssessment(assessment(), sources).features[0].status,
    'implemented',
  );
});
void test('jobs deduplicate unchanged commits, coalesce queued revisions, retain completed reports and skip empty/inaccessible/removed repos', () => {
  const t = tracker(),
    at = new Date().toISOString();
  assert.equal(queueRepositoryJudgments(t, at), 1);
  assert.equal(queueRepositoryJudgments(t, at), 0);
  const r = t.repositories['owner/app'];
  r.sha = newer;
  assert.equal(queueRepositoryJudgments(t, at), 1);
  assert.equal(r.judgments![0].status, 'superseded');
  r.judgments![1].status = 'completed';
  r.sha = sha;
  assert.equal(queueRepositoryJudgments(t, at), 1);
  assert.equal(r.judgments!.at(-1)!.sha, sha);
  assert.equal(r.judgments!.at(-1)!.status, 'queued');
  r.sha = latest;
  queueRepositoryJudgments(t, at);
  assert.equal(r.judgments!.at(-1)!.sinceSha, newer);
  r.status = 'empty';
  r.sha = 'd'.repeat(40);
  assert.equal(queueRepositoryJudgments(t, at), 0);
  r.status = 'unavailable';
  assert.equal(queueRepositoryJudgments(t, at), 0);
  r.status = 'tracking';
  r.presentInSheet = false;
  assert.equal(queueRepositoryJudgments(t, at), 0);
});
void test('concurrent dispatch reservations share a three-worker limit and cannot reserve the same review twice', async () => {
  const event = newEvent('Dispatch fixture'),
    t = tracker();
  event.githubTracker = t;
  const template = t.repositories['owner/app'];
  for (let i = 0; i < 6; i++) {
    const key = `owner/app${i}`;
    t.repositories[key] = { ...structuredClone(template), key, fullName: key };
  }
  await insertEvent(event);
  const reservations = await Promise.all(
    [0, 1].map(() =>
      mutateEvent(event.id, (e) =>
        reserveRepositoryJudgments(e.githubTracker!, new Date().toISOString()),
      ),
    ),
  );
  assert.equal(reservations.flat().length, 3);
  assert.equal(new Set(reservations.flat().map((r) => r.id)).size, 3);
  const queued = Object.values(
    (await getEvent(event.id)).githubTracker!.repositories,
  ).flatMap((r) => r.judgments || []);
  assert.equal(queued.filter((j) => j.dispatchToken).length, 3);
  assert.equal(queued.filter((j) => !j.dispatchToken).length, 4);
});
void test('real persisted flow: enable → atomic claim → cited report → compact organizer state; new signed sheet snapshots queue new commits', async () => {
  const event = newEvent('Repository judge fixture');
  event.githubTracker = tracker();
  event.githubTracker.judge = undefined;
  await insertEvent(event);
  const organizer: User = {
    id: crypto.randomUUID(),
    eventId: event.id,
    role: 'organizer',
    name: 'Organizer',
    email: 'judge@example.invalid',
    skills: [],
  };
  await insertUser(organizer, 'fixture');
  await assert.rejects(
    enableRepositoryJudge({ ...organizer, role: 'participant' }),
    /Organizer/,
  );
  assert.equal((await enableRepositoryJudge(organizer)).queued, 1);
  const repo = (await getEvent(event.id)).githubTracker!.repositories[
    'owner/app'
  ];
  const job = repo.judgments!.at(-1)!;
  await mutateEvent(event.id, (e) => {
    e.githubTracker!.repositories['owner/app'].judgments!.at(
      -1,
    )!.dispatchToken = 'claim-fixture';
  });
  const claims = await Promise.all([
    claimRepositoryJudgment(event.id, repo.key, job.id, 'claim-fixture'),
    claimRepositoryJudgment(event.id, repo.key, job.id, 'claim-fixture'),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  await finishRepositoryJudgment(event.id, repo.key, job.id, 'wrong-token', {
    assessment: assessment(),
    sources,
    coverage: {
      archiveFiles: 2,
      eligibleFiles: 2,
      inspectedFiles: 2,
      inspectedCharacters: 100,
      omittedFiles: [],
      truncatedFiles: [],
      diffAvailable: true,
    },
    tokens: 100,
  });
  assert.equal(
    (await repositoryJudgmentFor(organizer, repo.key)).judgments!.at(-1)!
      .status,
    'running',
  );
  await finishRepositoryJudgment(event.id, repo.key, job.id, 'claim-fixture', {
    assessment: assessment(),
    sources,
    coverage: {
      archiveFiles: 2,
      eligibleFiles: 2,
      inspectedFiles: 2,
      inspectedCharacters: 100,
      omittedFiles: [],
      truncatedFiles: [],
      diffAvailable: true,
    },
    tokens: 100,
  });
  const full = (await repositoryJudgmentFor(organizer, repo.key)).judgments!.at(
    -1,
  )!;
  assert.equal(full.status, 'completed');
  assert.equal(full.featureCounts?.implemented, 1);
  assert.ok(full.assessment);
  const compact = (await stateFor(organizer)).event.githubTracker!.repositories[
    repo.key
  ].judgments!.at(-1)!;
  assert.equal(compact.assessment, undefined);
  assert.equal(compact.featureCounts?.implemented, 1);
  await assert.rejects(
    repositoryJudgmentFor(
      { ...organizer, eventId: crypto.randomUUID() },
      repo.key,
    ),
    /not found/i,
  );
  await assert.rejects(
    repositoryJudgmentFor({ ...organizer, role: 'mentor' }, repo.key),
    /Organizer/,
  );
  await ingestTrackerSnapshot(
    {
      eventId: event.id,
      source,
      capturedAt: new Date().toISOString(),
      rows: [
        {
          row: 2,
          submittedAt: 'now',
          participantName: 'Builder',
          repoCandidate: repo.url,
        },
      ],
    },
    true,
    async () => ({ sha: newer, branch: 'main' }),
  );
  const next = (await getEvent(event.id)).githubTracker!.repositories[
    repo.key
  ].judgments!.at(-1)!;
  assert.equal(next.status, 'queued');
  assert.equal(next.sha, newer);
  assert.equal(next.sinceSha, sha);
  await mutateEvent(event.id, (e) => {
    e.githubTracker!.repositories[repo.key].judgments!.at(-1)!.dispatchToken =
      'next';
  });
  await claimRepositoryJudgment(event.id, repo.key, next.id, 'next');
  await failRepositoryJudgment(event.id, repo.key, next.id, 'next', 'analysis');
  const failed = (
    await repositoryJudgmentFor(organizer, repo.key)
  ).judgments!.at(-1)!;
  assert.equal(failed.status, 'failed');
  assert.ok(failed.retryAt);
  assert.ok(!failed.assessment);
});
