import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newEvent } from '../lib/desk/demo';
import {
  db,
  getEvent,
  getTrackedRepository,
  getWorkspaceEvent,
  insertEvent,
} from '../lib/desk/store';
import { isDatabaseQuotaError } from '../lib/desk/service-errors';
import type { RepositoryAssessment } from '../lib/desk/repo-judge-types';

const directory = mkdtempSync(path.join(tmpdir(), 'desk-read-model-'));
process.env.DESK_DB_PATH = path.join(directory, 'fixture.sqlite');
after(async () => {
  await db().close();
  rmSync(directory, { recursive: true, force: true });
});

export function fixtureEvent() {
  const event = newEvent('Read model fixture');
  const assessment: RepositoryAssessment = {
    summary: 'A large reviewed project.',
    architecture: 'Source-backed capabilities.',
    features: Array.from({ length: 40 }, (_, i) => ({
      name: `Feature ${i}`,
      description: 'Implementation evidence. '.repeat(25),
      status: 'implemented',
      evidence: [{ fileId: 'F1', startLine: 1, endLine: 10 }],
      caveats: [],
    })),
    caveats: [],
    latestChanges: [],
    questions: [],
    limitations: [],
  };
  event.githubTracker = {
    source: {
      spreadsheetId: 'fixture_spreadsheet_123456789',
      gid: 42,
      sheetName: 'Responses',
    },
    configuredAt: new Date().toISOString(),
    rows: [],
    repositories: {},
    judge: { enabled: true, enabledAt: new Date().toISOString() },
  };
  for (let i = 0; i < 12; i++) {
    const key = `owner/app${i}`;
    event.githubTracker.repositories[key] = {
      key,
      fullName: key,
      url: `https://github.com/${key}`,
      firstSeenAt: new Date().toISOString(),
      sourceRows: [i + 2],
      participants: [`Builder ${i}`],
      presentInSheet: true,
      status: 'tracking',
      sha: 'a'.repeat(40),
      changes: [],
      judgments: [
        {
          id: crypto.randomUUID(),
          sha: 'a'.repeat(40),
          status: 'completed',
          createdAt: new Date().toISOString(),
          attempts: 1,
          model: 'fixture',
          promptVersion: 'fixture',
          assessment: structuredClone(assessment),
          sources: [
            {
              id: 'F1',
              path: 'src/app.ts',
              lines: 10,
              inspectedLines: 10,
              kind: 'code',
            },
          ],
          coverage: {
            archiveFiles: 1,
            eligibleFiles: 1,
            inspectedFiles: 1,
            inspectedCharacters: 100,
            omittedFiles: [],
            truncatedFiles: [],
            diffAvailable: true,
          },
          headline: 'Completed review',
          featureCounts: {
            implemented: 40,
            partial: 0,
            scaffolded: 0,
            claimed: 0,
          },
        },
      ],
    };
  }
  return event;
}

void test('routine workspace reads retain review status while full findings remain stored for detail reads', async () => {
  const event = fixtureEvent();
  await insertEvent(event);
  const compact = await getWorkspaceEvent(event.id);
  const job = compact.githubTracker!.repositories['owner/app0'].judgments![0];
  assert.equal(job.assessment, undefined);
  assert.equal(job.sources, undefined);
  assert.equal(job.coverage, undefined);
  assert.equal(job.featureCounts?.implemented, 40);
  assert.equal(job.status, 'completed');
  const full = await getEvent(event.id);
  assert.equal(
    full.githubTracker!.repositories['owner/app0'].judgments![0].assessment!
      .features.length,
    40,
  );
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length / 10);
  assert.equal(
    (await getWorkspaceEvent(event.id, false)).githubTracker,
    undefined,
  );
});
void test('repository detail reads preserve the requested report and respect the event boundary', async () => {
  const event = fixtureEvent();
  await insertEvent(event);
  const repo = await getTrackedRepository(event.id, 'owner/app3');
  assert.equal(repo?.key, 'owner/app3');
  assert.equal(repo?.judgments![0].assessment!.features.length, 40);
  assert.equal(
    await getTrackedRepository(event.id, 'owner/missing'),
    undefined,
  );
  const another = newEvent('Another event');
  await insertEvent(another);
  assert.equal(await getTrackedRepository(another.id, 'owner/app3'), undefined);
});
void test('only a database quota error receives service-limit handling', () => {
  assert.equal(
    isDatabaseQuotaError({
      code: '53000',
      message: 'Your account or project has exceeded the quota.',
    }),
    true,
  );
  assert.equal(
    isDatabaseQuotaError({
      code: '53000',
      message: 'An unrelated database failure.',
    }),
    false,
  );
  assert.equal(
    isDatabaseQuotaError(
      new Error('An unrelated error with quota in its text.'),
    ),
    false,
  );
  assert.equal(isDatabaseQuotaError(null), false);
});
