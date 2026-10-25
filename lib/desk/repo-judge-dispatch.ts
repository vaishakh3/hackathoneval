import { start } from 'workflow/api';
import { judgeRepository } from '@/workflows/judge-repository';
import { getWorkspaceEvent, mutateEvent } from './store';
import {
  reserveRepositoryJudgments,
  REVIEW_CONCURRENCY,
} from './repo-judge-queue';

export async function dispatchRepositoryJudgments(eventId: string) {
  const tracker = (await getWorkspaceEvent(eventId)).githubTracker;
  if (!tracker?.judge?.enabled) return;
  const jobs = Object.values(tracker.repositories).flatMap(
    (repo) => repo.judgments || [],
  );
  const now = Date.now();
  const expired = jobs.some(
    (job) => job.status === 'running' && Date.parse(job.leaseUntil || '') < now,
  );
  const active = jobs.filter(
    (job) =>
      job.status === 'running' ||
      (job.status === 'queued' &&
        job.dispatchAt &&
        now - Date.parse(job.dispatchAt) < 120000),
  ).length;
  const ready = jobs.some(
    (job) =>
      (job.status === 'queued' &&
        (!job.dispatchAt || now - Date.parse(job.dispatchAt) >= 120000)) ||
      (job.status === 'failed' &&
        job.attempts < 3 &&
        Date.parse(job.retryAt || '') <= now),
  );
  if (!expired && (!ready || active >= REVIEW_CONCURRENCY)) return;
  const reserved = await mutateEvent(eventId, (event) => {
    return reserveRepositoryJudgments(
      event.githubTracker!,
      new Date().toISOString(),
    );
  });
  for (const item of reserved) {
    try {
      const run = await start(judgeRepository, [
        eventId,
        item.key,
        item.id,
        item.token,
      ]);
      await mutateEvent(eventId, (event) => {
        const job = event.githubTracker?.repositories[
          item.key
        ]?.judgments?.find((j) => j.id === item.id);
        if (job?.dispatchToken === item.token) job.workflowRunId = run.runId;
      });
    } catch {
      console.error('Repository review dispatch deferred', {
        reviewId: item.id,
      });
      await mutateEvent(eventId, (event) => {
        const job = event.githubTracker?.repositories[
          item.key
        ]?.judgments?.find((j) => j.id === item.id);
        if (job?.dispatchToken === item.token && job.status === 'queued')
          delete job.dispatchAt;
      });
    }
  }
}
