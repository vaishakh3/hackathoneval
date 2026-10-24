import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);

export function normalizeRepository(value) {
  let candidate = String(value || '').trim().replace(/[,;]+$/, '');
  candidate = candidate.replace(/^git@github\.com:/i, 'https://github.com/');
  if (/^(?:www\.)?github\.com\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname) ||
        url.username || url.password || url.port) return null;
    const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (!match || match.slice(1).some(s => /^\.+$/.test(s))) return null;
    const fullName = `${match[1]}/${match[2]}`;
    return { key: fullName.toLowerCase(), fullName, url: `https://github.com/${fullName}` };
  } catch { return null; }
}

export function parseTsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || cell === '')) {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && /[\t\n\r]/.test(c)) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (c !== '\t') { rows.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error('Incomplete quoted sheet data; keep the previous snapshot.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function reconcile(snapshot, previous = null, now = new Date().toISOString()) {
  if (!snapshot.source?.spreadsheetId || snapshot.source.gid === undefined ||
      !Array.isArray(snapshot.rows) || !Number.isFinite(Date.parse(snapshot.capturedAt)))
    throw new Error('A complete, timestamped sheet snapshot is required.');
  if (previous && (previous.source.spreadsheetId !== snapshot.source.spreadsheetId ||
      previous.source.gid !== snapshot.source.gid))
    throw new Error('The snapshot belongs to a different sheet.');
  if (previous && Date.parse(snapshot.capturedAt) < Date.parse(previous.sourceCapturedAt))
    throw new Error('Refusing to replace sheet coverage with an older snapshot.');
  const state = structuredClone(previous || { version: 1, repositories: {}, changes: [] });
  state.source = snapshot.source;
  state.sourceCapturedAt = snapshot.capturedAt;
  state.checkedAt = now;
  state.responseCount = snapshot.rows.length;
  state.pendingRows = [];
  state.newRepositories = [];
  for (const repo of Object.values(state.repositories)) {
    repo.presentInLatestSheet = false;
    repo.sourceRows = [];
    repo.participants = [];
  }
  for (const row of snapshot.rows) {
    const parsed = normalizeRepository(row.repoCandidate);
    if (!parsed) {
      state.pendingRows.push({ row: row.row, submittedAt: row.submittedAt,
        participantName: row.participantName || '',
        reason: row.timestampOnly ? 'Only repeated timestamps are present in the source row.' :
          row.repoCandidate ? 'Repository link needs correction.' : 'Repository link not submitted yet.' });
      continue;
    }
    if (!state.repositories[parsed.key]) {
      state.repositories[parsed.key] = { ...parsed, firstSeenAt: now, status: 'pending',
        history: [], sourceRows: [], participants: [] };
      state.newRepositories.push(parsed.key);
    }
    const repo = state.repositories[parsed.key];
    repo.presentInLatestSheet = true;
    repo.lastSeenAt = now;
    repo.sourceRows.push(row.row);
    if (row.participantName && !repo.participants.includes(row.participantName))
      repo.participants.push(row.participantName);
  }
  state.currentRepositoryCount = Object.values(state.repositories).filter(r => r.presentInLatestSheet).length;
  return state;
}

export function applyHead(repo, head, checkedAt) {
  if (!head || !/^[a-f0-9]{40}$/i.test(head.sha) || !Number.isFinite(Date.parse(head.committedAt)))
    throw new Error('GitHub did not return a valid commit.');
  const changed = !!repo.head && repo.head.sha !== head.sha;
  if (changed) repo.history = [...repo.history, { from: repo.head.sha, to: head.sha, observedAt: checkedAt }].slice(-100);
  repo.baselineSha ||= head.sha;
  repo.head = head;
  repo.lastCheckedAt = checkedAt;
  repo.lastSuccessAt = checkedAt;
  repo.status = 'tracking';
  delete repo.error;
  return changed;
}

export async function githubHead(repo) {
  const { stdout } = await exec('gh', ['api', '--hostname', 'github.com', '--method', 'GET',
    `repos/${repo.fullName}/commits?per_page=1`, '--jq',
    '.[0] | {sha: .sha, committedAt: .commit.committer.date, subject: (.commit.message | split("\n")[0]), url: .html_url}'],
  { timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export async function refresh(state, fetchHead = githubHead) {
  const queue = Object.values(state.repositories);
  let index = 0;
  const changed = [];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (index < queue.length) {
      const repo = queue[index++];
      try {
        if (applyHead(repo, await fetchHead(repo), state.checkedAt)) changed.push(repo.key);
      } catch (error) {
        const diagnostic = String(error.stderr || error.message || '');
        repo.status = 'unavailable';
        repo.lastCheckedAt = state.checkedAt;
        repo.error = /404/.test(diagnostic) ? 'Missing, private, or inaccessible repository (404).' :
          /409/.test(diagnostic) ? 'Repository has no commits yet (409).' :
          /429|rate limit|403/i.test(diagnostic) ? 'GitHub access or rate limit; retry on the next refresh.' :
          'GitHub could not be reached or returned an invalid response; retry on the next refresh.';
      }
    }
  }));
  state.changedRepositories = changed.sort((a, b) => a.localeCompare(b));
  if (changed.length || state.newRepositories.length)
    state.changes = [...state.changes, { at: state.checkedAt, added: state.newRepositories,
      changed: state.changedRepositories }].slice(-200);
  return state;
}

const cell = value => String(value ?? '').replace(/[\r\n]+/g, ' ').replaceAll('|', '\\|').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function report(state) {
  const repos = Object.values(state.repositories).sort((a, b) => a.fullName.localeCompare(b.fullName));
  const healthy = repos.filter(r => r.status === 'tracking').length;
  const stale = Date.parse(state.checkedAt) - Date.parse(state.sourceCapturedAt) > 30 * 60 * 1000;
  const lines = ['# Hackathon GitHub tracker', '',
    `GitHub checked: ${state.checkedAt}`, `Sheet last read: ${state.sourceCapturedAt}`, '',
    `[Submission sheet](${state.source.url}) · ${cell(state.source.sheetName)} · gid ${state.source.gid}`, '',
    `${state.responseCount} response rows; ${state.currentRepositoryCount} unique repos in the latest sheet; ${state.pendingRows.length} unresolved rows.`,
    `${repos.length} repos retained in tracking; ${healthy} readable; ${repos.length - healthy} awaiting access or retry.`, '',
    stale ? '**The sheet snapshot is stale. New submissions are not yet verified; restore sheet access.**' :
      'The full sheet is reread by the 15-minute chat automation. New submissions and corrected rows are reconsidered on every run.', '',
    'Unresolved submissions remain pending. Unavailable repositories are retried and keep their last successful commit. A late first observation is a baseline, not evidence of earlier inactivity. Previously seen repositories remain tracked even if removed from the sheet.', '',
    'This is a local tracker attached to the Codex chat. It records default-branch commit changes; it does not score projects or modify the deployed evaluation app.', '',
    '| Participant | Repository | Sheet row | Status | Latest observed commit | Commit time (UTC) |',
    '| --- | --- | --- | --- | --- | --- |'];
  for (const repo of repos) {
    const commit = repo.head ? `[${repo.head.sha.slice(0, 7)}](https://github.com/${repo.fullName}/commit/${repo.head.sha})` : 'Pending';
    lines.push(`| ${cell(repo.participants.join(', ')) || 'Previously submitted'} | [${cell(repo.fullName)}](${repo.url}) | ${repo.sourceRows.join(', ') || 'Previously seen'} | ${cell(repo.status)}${repo.error ? ': ' + cell(repo.error) : ''} | ${commit} | ${cell(repo.head?.committedAt)} |`);
  }
  lines.push('', '## Unresolved response rows', '',
    '| Sheet row | Participant | Submission timestamp as entered | Reason |', '| --- | --- | --- | --- |');
  for (const row of state.pendingRows)
    lines.push(`| ${row.row} | ${cell(row.participantName) || 'Unavailable in source'} | ${cell(row.submittedAt)} | ${cell(row.reason)} |`);
  if (!state.pendingRows.length) lines.push('| — | — | — | All current rows have a valid repository link. |');
  return lines.join('\n') + '\n';
}

async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, file);
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error(`Required option: ${name}`);
    return path.resolve(args[index + 1]);
  };
  const input = option('--input'), statePath = option('--state'), reportPath = option('--report');
  await mkdir(path.dirname(statePath), { recursive: true });
  const lock = `${statePath}.lock`;
  try { await mkdir(lock); }
  catch { throw new Error('Another tracker refresh may be running. Leave its state untouched.'); }
  try {
    const snapshot = JSON.parse(await readFile(input, 'utf8'));
    let previous = null;
    try { previous = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const state = await refresh(reconcile(snapshot, previous));
    await atomicWrite(statePath, JSON.stringify(state, null, 2) + '\n');
    await atomicWrite(reportPath, report(state));
    console.log(JSON.stringify({ responses: state.responseCount, currentRepos: state.currentRepositoryCount,
      retainedRepos: Object.keys(state.repositories).length, pendingRows: state.pendingRows.length,
      readableRepos: Object.values(state.repositories).filter(r => r.status === 'tracking').length,
      newRepos: state.newRepositories, changedRepos: state.changedRepositories,
      sourceCapturedAt: state.sourceCapturedAt, checkedAt: state.checkedAt }));
  } finally { await rm(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
