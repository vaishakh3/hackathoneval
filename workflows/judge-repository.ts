import type { RepositoryBundle, SourceFile } from '@/lib/desk/repo-evidence';
import type { RepositoryAssessment } from '@/lib/desk/repo-judge-types';

async function claim(eventId: string, key: string, id: string, token: string) {
  'use step';
  const { claimRepositoryJudgment } = await import('@/lib/desk/repo-judge');
  return claimRepositoryJudgment(eventId, key, id, token);
}
async function source(fullName: string, sha: string, sinceSha?: string) {
  'use step';
  const { collectRepositoryEvidence } =
    await import('@/lib/desk/repo-evidence');
  return collectRepositoryEvidence(fullName, sha, sinceSha);
}
source.maxRetries = 2;
async function inspect(
  model: string,
  bundle: Pick<
    RepositoryBundle,
    'fullName' | 'sha' | 'inventory' | 'changedPaths' | 'diff' | 'sinceSha'
  >,
  files: SourceFile[],
) {
  'use step';
  const { analyzeRepositoryBatch } = await import('@/lib/desk/repo-judge-ai');
  const { safeAiError } = await import('@/lib/desk/ai');
  try {
    return await analyzeRepositoryBatch(model, bundle, files);
  } catch (error) {
    throw new Error(safeAiError(error));
  }
}
inspect.maxRetries = 1;
async function merge(
  model: string,
  bundle: RepositoryBundle,
  findings: { assessment: RepositoryAssessment; tokens: number }[],
) {
  'use step';
  const { mergeRepositoryFindings } = await import('@/lib/desk/repo-judge-ai');
  const { safeAiError } = await import('@/lib/desk/ai');
  try {
    return await mergeRepositoryFindings(model, bundle, findings);
  } catch (error) {
    throw new Error(safeAiError(error));
  }
}
merge.maxRetries = 1;
async function complete(
  eventId: string,
  key: string,
  id: string,
  token: string,
  bundle: RepositoryBundle,
  result: { assessment: RepositoryAssessment; tokens: number },
) {
  'use step';
  const { finishRepositoryJudgment } = await import('@/lib/desk/repo-judge');
  await finishRepositoryJudgment(eventId, key, id, token, {
    ...result,
    sources: bundle.sources,
    coverage: bundle.coverage,
  });
}
async function failed(
  eventId: string,
  key: string,
  id: string,
  token: string,
  stage: 'source' | 'analysis',
) {
  'use step';
  const { failRepositoryJudgment } = await import('@/lib/desk/repo-judge');
  await failRepositoryJudgment(eventId, key, id, token, stage);
}
async function drain(eventId: string) {
  'use step';
  const { dispatchRepositoryJudgments } =
    await import('@/lib/desk/repo-judge-dispatch');
  await dispatchRepositoryJudgments(eventId);
}

export async function judgeRepository(
  eventId: string,
  key: string,
  id: string,
  token: string,
) {
  'use workflow';
  const job = await claim(eventId, key, id, token);
  if (!job) {
    await drain(eventId);
    return;
  }
  let stage: 'source' | 'analysis' = 'source';
  try {
    const bundle = await source(job.fullName, job.sha, job.sinceSha);
    stage = 'analysis';
    const findings: { assessment: RepositoryAssessment; tokens: number }[] = [];
    // At most two model calls per repository at once, with three repository workers.
    for (let i = 0; i < bundle.batches.length; i += 2) {
      findings.push(
        ...(await Promise.all(
          bundle.batches.slice(i, i + 2).map((files) =>
            inspect(
              job.model,
              {
                fullName: bundle.fullName,
                sha: bundle.sha,
                sinceSha: bundle.sinceSha,
                inventory: bundle.inventory,
                changedPaths: bundle.changedPaths,
                diff: bundle.diff,
              },
              files,
            ),
          ),
        )),
      );
    }
    const compact = { ...bundle, batches: [] };
    const result = await merge(job.model, compact, findings);
    await complete(eventId, key, id, token, compact, result);
  } catch {
    await failed(eventId, key, id, token, stage);
  }
  await drain(eventId);
}
