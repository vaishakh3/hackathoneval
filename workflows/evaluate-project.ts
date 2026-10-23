import { sleep } from 'workflow';
import { runQueuedEvaluation } from '@/lib/desk/ai';

async function evaluate(eventId: string, evaluationId: string) {
  'use step';
  console.info('Evaluation step started', { evaluationId });
  const status = await runQueuedEvaluation(eventId, evaluationId);
  console.info('Evaluation step finished', { evaluationId, status });
  return status;
}
evaluate.maxRetries = 3;

export async function evaluateProject(eventId: string, evaluationId: string) {
  'use workflow';
  for (let attempt = 0; attempt < 180; attempt++) {
    if ((await evaluate(eventId, evaluationId)) === 'done') return;
    await sleep('15s');
  }
  await expire(eventId, evaluationId);
}
async function expire(eventId: string, evaluationId: string) {
  'use step';
  const { mutateEvent } = await import('@/lib/desk/store');
  await mutateEvent(eventId, (event) => {
    const job = event.evaluations.find((e) => e.id === evaluationId);
    if (job && job.status === 'queued') {
      job.status = 'failed';
      job.error = 'The evaluation queue timed out. Please retry.';
    }
  });
}
