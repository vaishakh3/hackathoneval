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
