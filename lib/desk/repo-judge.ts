import { addAudit } from './domain';
import { getEvent, mutateEvent, requireThat } from './store';
import { queueRepositoryJudgments, REVIEW_LEASE_MS } from './repo-judge-queue';
import type { User } from './types';
import type {
  RepositoryAssessment,
  ReviewCoverage,
  ReviewSource,
} from './repo-judge-types';

export async function enableRepositoryJudge(user: User) {
  requireThat(user.role === 'organizer', 'Organizer access is required.', 403);
  requireThat(
    process.env.OPENAI_API_KEY,
    'Configure the server OpenAI key first.',
    409,
  );
  return mutateEvent(user.eventId, (event) => {
    requireThat(
      event.githubTracker && !event.demo,
      'Connect the real submission sheet first.',
      409,
    );
    const at = new Date().toISOString();
    if (!event.githubTracker.judge?.enabled) {
      event.githubTracker.judge = { enabled: true, enabledAt: at };
      addAudit(
        event,
        user.name,
        'Enabled source-based AI judging for submitted repositories and future commit changes.',
      );
    }
    return { queued: queueRepositoryJudgments(event.githubTracker, at) };
  });
}

export async function retryRepositoryJudgment(user: User, key: string) {
  requireThat(user.role === 'organizer', 'Organizer access is required.', 403);
  return mutateEvent(user.eventId, (event) => {
    const tracker = event.githubTracker;
    requireThat(
      tracker?.judge?.enabled,
      'Enable repository judging first.',
      409,
    );
    const repo = tracker.repositories[key];
    requireThat(repo?.presentInSheet, 'Submitted repository not found.', 404);
    const job = repo.judgments?.at(-1);
    requireThat(
      job?.status === 'failed',
      'Only failed reviews can be retried.',
      409,
    );
    job.status = 'queued';
    job.attempts = 0;
    delete job.workflowRunId;
    delete job.dispatchAt;
    delete job.dispatchToken;
    return { queued: 1 };
  });
}

export async function claimRepositoryJudgment(
  eventId: string,
  key: string,
  id: string,
  token: string,
) {
  return mutateEvent(eventId, (event) => {
    const tracker = event.githubTracker;
    const repo = tracker?.repositories[key];
    const job = repo?.judgments?.find((j) => j.id === id);
    if (
      !tracker?.judge?.enabled ||
      !repo ||
      !job ||
      job.status !== 'queued' ||
      job.dispatchToken !== token
    )
      return null;
    if (!repo.presentInSheet || job.sha !== repo.sha) {
      job.status = 'superseded';
      return null;
    }
    job.status = 'running';
    job.attempts++;
    job.startedAt = new Date().toISOString();
    job.leaseUntil = new Date(Date.now() + REVIEW_LEASE_MS).toISOString();
    job.sinceSha ||= repo.judgments?.findLast(
      (j) => j.status === 'completed' && j.sha !== job.sha,
    )?.sha;
    delete job.error;
    return {
      fullName: repo.fullName,
      sha: job.sha,
      sinceSha: job.sinceSha,
      model: job.model,
    };
  });
}

export async function finishRepositoryJudgment(
  eventId: string,
  key: string,
  id: string,
  token: string,
  result: {
    assessment: RepositoryAssessment;
    sources: ReviewSource[];
    coverage: ReviewCoverage;
    tokens: number;
  },
) {
  await mutateEvent(eventId, (event) => {
    const job = event.githubTracker?.repositories[key]?.judgments?.find(
      (j) => j.id === id,
    );
    if (!job || job.status !== 'running' || job.dispatchToken !== token) return;
    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    job.assessment = result.assessment;
    job.sources = result.sources;
    job.coverage = result.coverage;
    job.tokens = result.tokens;
    job.headline = result.assessment.summary.slice(0, 500);
    job.featureCounts = {
      implemented: 0,
      partial: 0,
      scaffolded: 0,
      claimed: 0,
    };
    result.assessment.features.forEach((f) => job.featureCounts![f.status]++);
    delete job.leaseUntil;
    queueRepositoryJudgments(event.githubTracker!, job.finishedAt);
  });
}

export async function failRepositoryJudgment(
  eventId: string,
  key: string,
  id: string,
  token: string,
  stage: 'source' | 'analysis',
) {
  await mutateEvent(eventId, (event) => {
    const job = event.githubTracker?.repositories[key]?.judgments?.find(
      (j) => j.id === id,
    );
    if (!job || job.status !== 'running' || job.dispatchToken !== token) return;
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    job.retryAt = new Date(Date.now() + 15 * 60000).toISOString();
    job.error =
      stage === 'source'
        ? 'The pinned source archive could not be inspected. It may be inaccessible, oversized, or contain no supported application source. The project remains unjudged.'
        : 'The AI review did not complete. Check provider availability, billing, or limits. A later sync retries up to three attempts.';
    delete job.leaseUntil;
  });
}

export async function repositoryJudgmentFor(user: User, key: string) {
  requireThat(user.role === 'organizer', 'Organizer access is required.', 403);
  const repo = (await getEvent(user.eventId)).githubTracker?.repositories[key];
  requireThat(repo, 'Repository not found.', 404);
  return repo;
}
