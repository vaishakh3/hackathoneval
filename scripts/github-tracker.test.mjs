import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRepository, parseTsv, reconcile, refresh } from './github-tracker.mjs';

const now = '2026-10-24T18:00:00.000Z';
const snapshot = rows => ({ source: { spreadsheetId: 'sheet', gid: 1, url: 'https://docs.google.com/spreadsheets/d/sheet/edit', sheetName: 'Responses' }, capturedAt: now, rows });
const row = (number, repoCandidate = '', name = 'Team') => ({ row: number, repoCandidate, participantName: name, submittedAt: now });
const head = sha => ({ sha: sha.repeat(40), committedAt: now, subject: 'Update' });

test('canonicalizes submitted URLs and rejects non-GitHub hosts and credentials', () => {
  assert.equal(normalizeRepository(' github.com/Team/Project.git ').key, 'team/project');
  assert.equal(normalizeRepository('git@github.com:Team/Project.git').url, 'https://github.com/Team/Project');
  assert.equal(normalizeRepository('https://www.github.com/Team/Project').key, 'team/project');
  assert.equal(normalizeRepository('https://github.com/Team/Project,').key, 'team/project');
  for (const value of ['https://github.com.evil.invalid/a/b', 'https://secret@github.com/a/b', 'https://github.com/a/b/tree/main', 'file:///a/b', 'https://github.com/a'])
    assert.equal(normalizeRepository(value), null);
});

test('parses multiline copied descriptions without shifting sheet row numbers', () => {
  assert.deepEqual(parseTsv('Name\tRepo\tDescription\nTeam\tgithub.com/a/b\t"hello\nsecond line"\n'),
    [['Name', 'Repo', 'Description'], ['Team', 'github.com/a/b', 'hello\nsecond line']]);
  assert.throws(() => parseTsv('a\t"truncated'), /Incomplete/);
});

test('includes late submissions, corrected pending rows, duplicates and retained prior repos', () => {
  const initial = reconcile(snapshot([row(2), row(3, 'github.com/a/one')]), null, now);
  assert.equal(initial.pendingRows.length, 1);
  const later = reconcile(snapshot([row(2, 'github.com/b/two'), row(3, 'github.com/A/ONE'), row(4, 'https://github.com/a/one.git', 'Other team'), row(5, 'github.com/c/three')]), initial, now);
  assert.equal(later.pendingRows.length, 0);
  assert.equal(later.currentRepositoryCount, 3);
  assert.deepEqual(later.repositories['a/one'].sourceRows, [3, 4]);
  assert.equal(later.repositories['a/one'].participants.length, 2);
  const removed = reconcile(snapshot([row(2, 'github.com/b/two')]), later, now);
  assert.equal(Object.keys(removed.repositories).length, 3);
  assert.equal(removed.currentRepositoryCount, 1);
  assert.equal(removed.repositories['a/one'].presentInLatestSheet, false);
});

test('transient failures retain the last commit and subsequent refreshes recover', async () => {
  let state = reconcile(snapshot([row(2, 'github.com/a/b')]), null, now);
  await refresh(state, async () => head('a'));
  assert.equal(state.repositories['a/b'].baselineSha, 'a'.repeat(40));
  state = reconcile(snapshot([row(2, 'github.com/a/b')]), state, now);
  await refresh(state, async () => { throw new Error('HTTP 404'); });
  assert.equal(state.repositories['a/b'].status, 'unavailable');
  assert.equal(state.repositories['a/b'].head.sha, 'a'.repeat(40));
  await refresh(state, async () => head('b'));
  assert.equal(state.repositories['a/b'].status, 'tracking');
  assert.deepEqual(state.changedRepositories, ['a/b']);
  assert.equal(state.repositories['a/b'].history.length, 1);
});

test('refuses another sheet and stale coverage snapshots', () => {
  const state = reconcile(snapshot([]), null, now);
  assert.throws(() => reconcile({ ...snapshot([]), source: { spreadsheetId: 'other', gid: 1 } }, state), /different sheet/);
  assert.throws(() => reconcile({ ...snapshot([]), capturedAt: '2026-10-23T00:00:00Z' }, state), /older snapshot/);
});
