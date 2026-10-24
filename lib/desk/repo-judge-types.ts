export const REPO_JUDGE_VERSION = 'repository-features-v1';

export type CodeReference = {
  fileId: string;
  startLine: number;
  endLine: number;
};
export type RepositoryFeature = {
  name: string;
  description: string;
  status: 'implemented' | 'partial' | 'scaffolded' | 'claimed';
  evidence: CodeReference[];
  caveats: string[];
};
export type RepositoryCaveat = {
  severity: 'high' | 'medium' | 'low';
  detail: string;
  basis: 'source' | 'inference' | 'runtime';
  evidence: CodeReference[];
};
export type RepositoryAssessment = {
  summary: string;
  architecture: string;
  features: RepositoryFeature[];
  caveats: RepositoryCaveat[];
  latestChanges: string[];
  questions: string[];
  limitations: string[];
};
export type ReviewSource = {
  id: string;
  path: string;
  lines: number;
  inspectedLines: number;
  kind: 'code' | 'documentation' | 'configuration' | 'test';
};
export type ReviewCoverage = {
  sourceMethod?: 'archive' | 'github-tree';
  inventoryTruncated?: boolean;
  archiveFiles: number;
  eligibleFiles: number;
  inspectedFiles: number;
  inspectedCharacters: number;
  omittedFiles: string[];
  truncatedFiles: string[];
  diffAvailable: boolean;
};
export type RepositoryJudgment = {
  id: string;
  sha: string;
  sinceSha?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'superseded';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  dispatchAt?: string;
  dispatchToken?: string;
  workflowRunId?: string;
  leaseUntil?: string;
  attempts: number;
  retryAt?: string;
  error?: string;
  model: string;
  promptVersion: string;
  assessment?: RepositoryAssessment;
  sources?: ReviewSource[];
  coverage?: ReviewCoverage;
  tokens?: number;
  headline?: string;
  featureCounts?: Record<RepositoryFeature['status'], number>;
};

// Older bounded snapshots could label a file truncated even when no complete line fit.
export function normalizeJudgmentCoverage(job: RepositoryJudgment) {
  if (!job.coverage || !job.sources) return;
  const paths = new Set(job.sources.map((source) => source.path));
  const omitted = job.coverage.truncatedFiles.filter(
    (path) => !paths.has(path),
  );
  if (!omitted.length) return;
  job.coverage.omittedFiles = [
    ...new Set([...job.coverage.omittedFiles, ...omitted]),
  ];
  job.coverage.truncatedFiles = job.coverage.truncatedFiles.filter((path) =>
    paths.has(path),
  );
  if (job.assessment)
    job.assessment.limitations = job.assessment.limitations.map((limit) =>
      limit.startsWith('Coverage is bounded:')
        ? `Coverage is bounded: ${job.coverage!.inspectedFiles} of ${job.coverage!.eligibleFiles} eligible text files inspected; ${job.coverage!.truncatedFiles.length} files truncated. Uninspected features remain unknown.`
        : limit,
    );
}
