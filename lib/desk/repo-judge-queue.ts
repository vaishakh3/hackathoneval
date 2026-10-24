import { randomUUID } from 'node:crypto';
import type { GithubTracker, TrackedRepository } from './github-tracker';
import { REPO_JUDGE_VERSION } from './repo-judge-types';

export const REVIEW_CONCURRENCY = 3;
export const REVIEW_LEASE_MS = 20 * 60000;
export const latestJudgment = (repo: TrackedRepository) =>
  repo.judgments?.at(-1);

// The sheet sync calls this under the event lock. An unchanged SHA costs no model calls.
export function queueRepositoryJudgments(tracker: GithubTracker, at: string) {
  if (!tracker.judge?.enabled) return 0;
  let queued = 0;
  for (const repo of Object.values(tracker.repositories)) {
    if (!repo.presentInSheet || repo.status !== 'tracking' || !repo.sha)
      continue;
    repo.judgments ||= [];
    for (const job of repo.judgments) {
      if (
        job.status === 'running' &&
        Date.parse(job.leaseUntil || '') < Date.parse(at)
      ) {
        job.status = 'failed';
        job.error = 'The review was interrupted. A later sync will retry.';
        job.finishedAt = at;
        job.retryAt = at;
        delete job.workflowRunId;
      }
      if (job.status === 'queued' && job.sha !== repo.sha)
        job.status = 'superseded';
    }
    const existing = repo.judgments.findLast(
      (j) => j.sha === repo.sha && j.promptVersion === REPO_JUDGE_VERSION,
    );
    if (existing) {
      // Reusing a report after a branch reset must also select it as the current report.
      if (existing.status === 'completed') {
        repo.judgments = [
          ...repo.judgments.filter((j) => j !== existing),
          existing,
        ];
      }
      if (
        existing.status === 'superseded' ||
        (existing.status === 'failed' &&
          existing.attempts < 3 &&
          Date.parse(existing.retryAt || '') <= Date.parse(at))
      ) {
        existing.status = 'queued';
        delete existing.finishedAt;
        delete existing.dispatchAt;
        delete existing.dispatchToken;
        delete existing.workflowRunId;
        repo.judgments = [
          ...repo.judgments.filter((j) => j !== existing),
          existing,
        ];
        queued++;
      }
      continue;
    }
    const previous = repo.judgments.findLast((j) => j.status === 'completed');
    repo.judgments.push({
      id: randomUUID(),
      sha: repo.sha,
      sinceSha: previous?.sha,
      status: 'queued',
      createdAt: at,
      attempts: 0,
      model:
        process.env.REPO_JUDGE_MODEL ||
        process.env.OPENAI_MODEL ||
        'gpt-5.4-mini',
      promptVersion: REPO_JUDGE_VERSION,
    });
    // Keep active work and the most recent four finished reports.
    const finished = repo.judgments
      .filter((j) => !['queued', 'running'].includes(j.status))
      .slice(-4);
    repo.judgments = repo.judgments.filter(
      (j) => ['queued', 'running'].includes(j.status) || finished.includes(j),
    );
    queued++;
  }
  return queued;
}

export function reserveRepositoryJudgments(tracker: GithubTracker, at: string) {
  queueRepositoryJudgments(tracker, at);
  const now = Date.parse(at);
  const all = Object.values(tracker.repositories).flatMap((repo) =>
    (repo.judgments || []).map((job) => ({ repo, job })),
  );
  const active = all.filter(
    ({ job }) =>
      job.status === 'running' ||
      (job.status === 'queued' &&
        job.dispatchAt &&
        now - Date.parse(job.dispatchAt) < 120000),
  );
  return all
    .filter(
      ({ job }) =>
        job.status === 'queued' &&
        (!job.dispatchAt || now - Date.parse(job.dispatchAt) >= 120000),
    )
    .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt))
    .slice(0, Math.max(0, REVIEW_CONCURRENCY - active.length))
    .map(({ repo, job }) => {
      job.dispatchAt = at;
      job.dispatchToken = randomUUID();
      delete job.workflowRunId;
      return { key: repo.key, id: job.id, token: job.dispatchToken };
    });
}
