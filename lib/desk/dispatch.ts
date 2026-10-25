import { start } from 'workflow/api';
import { evaluateProject } from '@/workflows/evaluate-project';
import { getWorkspaceEvent, mutateEvent } from './store';
import type { DeskEvent } from './types';

export function needsDispatch(event: DeskEvent) {
  return (
    !event.demo &&
    event.evaluations.some(
      (e) =>
        e.status === 'queued' &&
        !e.workflowRunId &&
        (!e.dispatchAt || Date.now() - Date.parse(e.dispatchAt) > 60000),
    )
  );
}
export async function dispatchEvaluations(eventId: string) {
  if (!needsDispatch(await getWorkspaceEvent(eventId, false))) return;
  const at = new Date().toISOString();
  const ids = await mutateEvent(eventId, (event) => {
    if (!needsDispatch(event)) return [];
    const jobs = event.evaluations.filter(
      (e) =>
        e.status === 'queued' &&
        !e.workflowRunId &&
        (!e.dispatchAt || Date.now() - Date.parse(e.dispatchAt) > 60000),
    );
    jobs.forEach((e) => {
      e.dispatchAt = at;
    });
    return jobs.map((e) => e.id);
  });
  for (const id of ids) {
    try {
      const run = await start(evaluateProject, [eventId, id]);
      await mutateEvent(eventId, (event) => {
        const job = event.evaluations.find((e) => e.id === id);
        if (job?.dispatchAt === at) job.workflowRunId = run.runId;
      });
    } catch {
      // The submission is committed. A later request retries this outbox entry.
      console.error('Evaluation dispatch deferred', { evaluationId: id });
      await mutateEvent(eventId, (event) => {
        const job = event.evaluations.find((e) => e.id === id);
        if (job?.dispatchAt === at) job.dispatchAt = undefined;
      });
    }
  }
}
