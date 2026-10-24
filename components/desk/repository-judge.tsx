'use client';

import { useEffect, useState } from 'react';
import type {
  GithubTracker,
  TrackedRepository,
} from '@/lib/desk/github-tracker';
import type {
  CodeReference,
  RepositoryFeature,
  RepositoryJudgment,
} from '@/lib/desk/repo-judge-types';
import { Badge, Button, dateTime, Modal } from './ui';

const featureLabels: Record<RepositoryFeature['status'], string> = {
  implemented: 'Implemented in source',
  partial: 'Partially implemented',
  scaffolded: 'Scaffold / mock',
  claimed: 'Claimed, unverified',
};

async function judgeAction(action: 'enable' | 'retry', repo?: string) {
  const response = await fetch('/api/desk/tracker/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, repo }),
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new Error(body.error || 'Could not queue the repository review.');
}

export function RepositoryJudgeControls({
  tracker,
}: {
  tracker: GithubTracker;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const jobs = Object.values(tracker.repositories).map((r) =>
    r.judgments?.at(-1),
  );
  const active = tracker.judge?.enabled || enabled;
  return (
    <section className="d-judge-overview">
      <div className="d-tracker-section-heading">
        <h2>AI repository judge</h2>
        <Badge tone={active ? 'purple' : 'neutral'}>
          {active ? 'Automatic reviews enabled' : 'Ready to enable'}
        </Badge>
      </div>
      <p>
        Feature inventories and caveats from the latest source code, with links
        to the exact lines inspected. New submissions and changed commits are
        reviewed in the cloud.
      </p>
      <p className="d-muted">
        Source evidence supports these reviews. Builds, tests and live behavior
        require separate verification. AI findings support human judging.
      </p>
      {active ? (
        <div className="d-judge-progress" aria-live="polite">
          <span>
            <strong>
              {jobs.filter((j) => j?.status === 'completed').length}
            </strong>{' '}
            reviewed
          </span>
          <span>
            <strong>
              {jobs.filter((j) => j?.status === 'running').length}
            </strong>{' '}
            reviewing
          </span>
          <span>
            <strong>{jobs.filter((j) => j?.status === 'queued').length}</strong>{' '}
            queued
          </span>
          <span>
            <strong>{jobs.filter((j) => j?.status === 'failed').length}</strong>{' '}
            need attention
          </span>
        </div>
      ) : (
        <Button
          primary
          busy={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void judgeAction('enable')
              .then(() => setEnabled(true))
              .catch((e) => setError((e as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          Start AI judging
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function RepositoryReviewButton({
  repo,
  onOpen,
}: {
  repo: TrackedRepository;
  onOpen: () => void;
}) {
  const latest = repo.judgments?.at(-1);
  const completed = repo.judgments?.findLast((j) => j.status === 'completed');
  return (
    <div className="d-review-cell">
      <Badge
        tone={
          latest?.status === 'completed'
            ? 'purple'
            : latest?.status === 'failed'
              ? 'red'
              : 'neutral'
        }
      >
        {latest?.status ||
          (repo.status === 'tracking' ? 'Awaiting review' : 'Awaiting source')}
      </Badge>
      {completed?.featureCounts && (
        <small className="d-cell-note">
          {completed.featureCounts.implemented} implemented ·{' '}
          {completed.featureCounts.partial} partial
        </small>
      )}
      {latest && latest.sha !== repo.sha && (
        <small className="d-cell-note">New commit awaiting review</small>
      )}
      <button className="d-text-button" onClick={onOpen}>
        View AI review
      </button>
    </div>
  );
}

function codeUrl(
  repo: TrackedRepository,
  job: RepositoryJudgment,
  reference: CodeReference,
) {
  const source = job.sources?.find((s) => s.id === reference.fileId);
  return source
    ? `${repo.url}/blob/${job.sha}/${source.path.split('/').map(encodeURIComponent).join('/')}#L${reference.startLine}-L${reference.endLine}`
    : undefined;
}
function References({
  repo,
  job,
  evidence,
}: {
  repo: TrackedRepository;
  job: RepositoryJudgment;
  evidence: CodeReference[];
}) {
  return (
    <div className="d-judge-references">
      {evidence.map((ref, i) => {
        const file = job.sources?.find((s) => s.id === ref.fileId);
        const url = codeUrl(repo, job, ref);
        return (
          url && (
            <a
              key={`${ref.fileId}:${i}`}
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {file?.path}:{ref.startLine}
              {ref.endLine !== ref.startLine ? `–${ref.endLine}` : ''}
            </a>
          )
        );
      })}
    </div>
  );
}
function downloadReview(repo: TrackedRepository, job: RepositoryJudgment) {
  const a = job.assessment;
  if (!a) return;
  const references = (refs: CodeReference[]) =>
    refs
      .map((r) => codeUrl(repo, job, r))
      .filter(Boolean)
      .join('\n');
  const text = `# ${repo.fullName}\n\nCommit: ${job.sha}\nReviewed: ${job.finishedAt}\n\n${a.summary}\n\n${a.architecture}\n\n## Feature inventory\n\n${a.features.map((f) => `### ${f.name} — ${featureLabels[f.status]}\n\n${f.description}\n\n${f.caveats.join('\n')}\n\n${references(f.evidence)}`).join('\n\n')}\n\n## Caveats\n\n${a.caveats.map((c) => `- ${c.severity} / ${c.basis}: ${c.detail}\n${references(c.evidence)}`).join('\n')}\n\n## Latest changes\n\n${a.latestChanges.map((c) => `- ${c}`).join('\n')}\n\n## Scope and limitations\n\n${a.limitations.map((c) => `- ${c}`).join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${repo.fullName.replace('/', '-')}-${job.sha.slice(0, 7)}-review.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RepositoryReviewDetail({
  repoKey,
  revision,
  onClose,
}: {
  repoKey: string;
  revision: number;
  onClose: () => void;
}) {
  const [repo, setRepo] = useState<TrackedRepository>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/desk/tracker/judge?repo=${encodeURIComponent(repoKey)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          repo?: TrackedRepository;
          error?: string;
        };
        if (!response.ok || !body.repo)
          throw new Error(body.error || 'Could not load review.');
        setRepo(body.repo);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, [repoKey, revision]);
  const latest = repo?.judgments?.at(-1);
  const report = repo?.judgments?.findLast(
    (j) => j.status === 'completed' && j.assessment,
  );
  const a = report?.assessment;
  const features =
    a?.features.filter((f) => filter === 'all' || f.status === filter) || [];
  return (
    <Modal
      wide
      title={repo?.fullName || repoKey}
      subtitle="AI feature inventory and implementation caveats"
      onClose={onClose}
    >
      <div className="d-repository-review">
        {error && (
          <p className="d-connection-error" role="alert">
            {error}
          </p>
        )}
        {!repo && !error && <output>Loading repository review…</output>}
        {repo && (
          <>
            <div className="d-judge-review-status">
              <Badge tone={latest?.status === 'completed' ? 'purple' : 'amber'}>
                {latest?.status || 'Awaiting inspectable source'}
              </Badge>
              <a
                href={`${repo.url}${repo.sha ? `/commit/${repo.sha}` : ''}`}
                target="_blank"
                rel="noreferrer"
              >
                Latest commit {repo.sha?.slice(0, 7) || 'unavailable'}
              </a>
            </div>
            {latest?.error && <output>{latest.error}</output>}
            {latest?.status === 'failed' && (
              <Button
                busy={busy}
                onClick={() => {
                  setBusy(true);
                  void judgeAction('retry', repoKey)
                    .catch((e) => setError((e as Error).message))
                    .finally(() => setBusy(false));
                }}
              >
                Retry review
              </Button>
            )}
            {!a && (
              <p>
                {repo.status === 'tracking'
                  ? 'The review will appear here when the cloud worker finishes. This page can be closed while it runs.'
                  : 'The repository is empty or cannot currently be read. It remains included and will be reviewed when source becomes available.'}
              </p>
            )}
          </>
        )}
        {repo && report && a && (
          <>
            <p className="d-muted">
              Reviewed commit{' '}
              <a
                href={`${repo.url}/commit/${report.sha}`}
                target="_blank"
                rel="noreferrer"
              >
                {report.sha.slice(0, 7)}
              </a>{' '}
              · {report.finishedAt && dateTime(report.finishedAt)}
              {report.sha !== repo.sha
                ? ' · A newer commit is awaiting review.'
                : ''}
            </p>
            <h3>Judge’s assessment</h3>
            <p>{a.summary}</p>
            <p>{a.architecture}</p>
            <div className="d-tracker-section-heading">
              <h3>Feature inventory ({a.features.length})</h3>
              <Button onClick={() => downloadReview(repo, report)}>
                Download review
              </Button>
            </div>
            <label className="d-judge-filter">
              Show features{' '}
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All features</option>
                {Object.entries(featureLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="d-judge-features">
              {features.map((feature, i) => (
                <article
                  key={`${feature.name}:${i}`}
                  className="d-judge-feature"
                >
                  <div>
                    <h4>{feature.name}</h4>
                    <Badge
                      tone={
                        feature.status === 'implemented'
                          ? 'green'
                          : feature.status === 'partial'
                            ? 'amber'
                            : 'neutral'
                      }
                    >
                      {featureLabels[feature.status]}
                    </Badge>
                  </div>
                  <p>{feature.description}</p>
                  {feature.caveats.length > 0 && (
                    <ul>
                      {feature.caveats.map((c, j) => (
                        <li key={j}>{c}</li>
                      ))}
                    </ul>
                  )}
                  <References
                    repo={repo}
                    job={report}
                    evidence={feature.evidence}
                  />
                </article>
              ))}
            </div>
            <h3>Caveats and incomplete work</h3>
            <div className="d-judge-caveats">
              {a.caveats.map((c, i) => (
                <article key={i}>
                  <Badge
                    tone={
                      c.severity === 'high'
                        ? 'red'
                        : c.severity === 'medium'
                          ? 'amber'
                          : 'neutral'
                    }
                  >
                    {c.severity} ·{' '}
                    {c.basis === 'source'
                      ? 'Source evidence'
                      : c.basis === 'runtime'
                        ? 'Verify at runtime'
                        : 'Inference'}
                  </Badge>
                  <p>{c.detail}</p>
                  <References repo={repo} job={report} evidence={c.evidence} />
                </article>
              ))}
            </div>
            {a.latestChanges.length > 0 && (
              <>
                <h3>Changes in the latest reviewed code</h3>
                <ul>
                  {a.latestChanges.map((change, i) => (
                    <li key={i}>{change}</li>
                  ))}
                </ul>
              </>
            )}
            {a.questions.length > 0 && (
              <>
                <h3>Questions for the builder</h3>
                <ul>
                  {a.questions.map((question, i) => (
                    <li key={i}>{question}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>Inspection coverage</h3>
            <p>
              {report.coverage?.inspectedFiles} /{' '}
              {report.coverage?.eligibleFiles} eligible source files inspected ·{' '}
              {report.sources?.length} files with source references.
            </p>
            <ul>
              {a.limitations.map((limit, i) => (
                <li key={i}>{limit}</li>
              ))}
            </ul>
            <details>
              <summary>Inspected files</summary>
              <ul>
                {report.sources?.map((source) => (
                  <li key={source.id}>
                    <a
                      href={`${repo.url}/blob/${report.sha}/${source.path.split('/').map(encodeURIComponent).join('/')}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.path}
                    </a>{' '}
                    · {source.inspectedLines}/{source.lines} lines
                  </li>
                ))}
              </ul>
            </details>
            {!!report.coverage?.omittedFiles.length && (
              <details>
                <summary>
                  Files outside inspection limits (
                  {report.coverage.omittedFiles.length})
                </summary>
                <ul>
                  {report.coverage.omittedFiles.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
