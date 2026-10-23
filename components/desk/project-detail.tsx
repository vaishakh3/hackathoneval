'use client';

import Image from 'next/image';
import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  ExternalLink as LinkIcon,
  Flag,
  GitBranch,
  LockKeyhole,
  RotateCw,
  ScanLine,
} from 'lucide-react';
import type {
  DeskEvent,
  Evaluation,
  Project,
  Submission,
} from '@/lib/desk/types';
import { signals, totalScore } from '@/lib/desk/domain';
import {
  Badge,
  Button,
  dateTime,
  Empty,
  ExternalLink,
  Field,
  Modal,
  ProjectMark,
  Score,
  type WorkspaceProps,
} from './ui';

export function SubmissionTimeline({
  event,
  project,
}: {
  event: DeskEvent;
  project: Project;
}) {
  return (
    <div className="d-timeline">
      {[...project.submissions].reverse().map((s, i) => (
        <article key={s.id} className="d-timeline-entry">
          <span className={`d-timeline-point ${i === 0 ? 'is-current' : ''}`}>
            {s.checkpoint + 1}
          </span>
          <div className="d-timeline-content">
            <div className="d-row d-between">
              <h3>{event.checkpoints[s.checkpoint].title}</h3>
              <span className="d-time">{dateTime(s.submittedAt)}</span>
            </div>
            <p className="d-small-heading">What changed</p>
            <p>{s.changed}</p>
            <p className="d-small-heading">What works now</p>
            <p>{s.working}</p>
            {s.blockers && (
              <div className="d-blocker">
                <Flag size={14} />
                <span>{s.blockers}</span>
              </div>
            )}
            {s.evidence.length > 0 && <EvidenceList submission={s} />}
            {s.projectSnapshot && (
              <details className="d-snapshot">
                <summary>
                  Project details at submission
                  <ChevronDown size={13} />
                </summary>
                <p>{s.projectSnapshot.description}</p>
                <p>
                  <strong>Goal:</strong> {s.projectSnapshot.goal}
                </p>
                <p>
                  <strong>Existing work:</strong>{' '}
                  {s.projectSnapshot.preExisting || 'None declared'}
                </p>
              </details>
            )}
          </div>
        </article>
      ))}
      {!project.submissions.length && (
        <Empty title="Every project starts somewhere">
          The first checkpoint update will begin this project’s story.
        </Empty>
      )}
    </div>
  );
}
function EvidenceList({ submission }: { submission: Submission }) {
  return (
    <div className="d-evidence-list">
      {submission.evidence.map((e) =>
        e.kind === 'image' ? (
          <a
            key={e.id}
            href={e.url}
            target="_blank"
            rel="noreferrer"
            className="d-image-evidence"
          >
            <Image
              src={e.url}
              alt={e.label}
              width={290}
              height={180}
              unoptimized
            />
            <span>
              {e.label}
              <LinkIcon size={12} />
            </span>
          </a>
        ) : (
          <ExternalLink key={e.id} href={e.url}>
            {e.label}
          </ExternalLink>
        ),
      )}
    </div>
  );
}

export function AssessmentView({
  event,
  evaluation,
  act,
  canRetry,
}: {
  event: DeskEvent;
  evaluation?: Evaluation;
  act: WorkspaceProps['act'];
  canRetry: boolean;
}) {
  const [busy, setBusy] = useState(false);
  if (!evaluation)
    return (
      <Empty title="Waiting for the next update">
        AI evaluation starts when a participant submits a checkpoint.
      </Empty>
    );
  if (evaluation.status === 'queued' || evaluation.status === 'running')
    return (
      <div className="d-assessment-wait">
        <ScanLine size={25} strokeWidth={1.5} />
        <h3>
          {evaluation.status === 'queued'
            ? 'In the evaluation queue'
            : 'Reviewing the submitted evidence'}
        </h3>
        <p>
          This view updates automatically. The participant’s submission is
          already saved.
        </p>
      </div>
    );
  if (evaluation.status === 'failed')
    return (
      <div className="d-callout d-callout-amber">
        <h3>Evaluation needs another try</h3>
        <p>{evaluation.error}</p>
        {canRetry && !event.demo && (
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await act(
                  'retry-ai',
                  { evaluationId: evaluation.id },
                  'Evaluation queued again.',
                );
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            <RotateCw size={14} />
            Retry evaluation
          </Button>
        )}
      </div>
    );
  const assessment = evaluation.assessment;
  if (!assessment)
    return (
      <div className="d-blind-review">
        <LockKeyhole size={25} strokeWidth={1.5} />
        <h3>Your perspective comes first.</h3>
        <p>
          Save your independent review to reveal the AI assessment. Earlier
          factual updates are available in the timeline.
        </p>
      </div>
    );
  return (
    <div className="d-assessment">
      {evaluation.sample && (
        <div className="d-callout">
          Illustrative sample assessment. These ratings were seeded to
          demonstrate the workflow.
        </div>
      )}
      <div className="d-assessment-intro">
        <span className="d-eyebrow">Evidence-based observations</span>
        <p>{assessment.summary}</p>
        <small>
          {evaluation.model} · {evaluation.promptVersion} ·{' '}
          {evaluation.finishedAt ? dateTime(evaluation.finishedAt) : ''}
        </small>
      </div>
      <div className="d-assessment-change">
        <GitBranch size={17} />
        <div>
          <strong>Since the previous checkpoint</strong>
          <p>{assessment.progress}</p>
        </div>
      </div>
      <div className="d-assessment-criteria">
        {evaluation.rubric.map((c) => {
          const value = assessment.criteria.find((a) => a.id === c.id);
          return (
            <div key={c.id}>
              <div className="d-row d-between">
                <strong>
                  {c.label}
                  <span className="d-muted"> · {c.weight}%</span>
                </strong>
                <Badge tone={value?.score == null ? 'amber' : 'neutral'}>
                  {value?.score == null
                    ? 'Insufficient evidence'
                    : `${value.score} / 5`}
                </Badge>
              </div>
              <p>{value?.reasoning}</p>
              <div className="d-source-tags">
                {value?.evidenceIds.map((id) => {
                  const source = evaluation.sources.find((s) => s.id === id);
                  return source ? (
                    <span key={id} title={source.text.slice(0, 500)}>
                      {source.url && /^https?:/.test(source.url) ? (
                        <ExternalLink href={source.url}>
                          {source.label}
                        </ExternalLink>
                      ) : (
                        source.label
                      )}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="d-assessment-columns">
        <section>
          <h3>What stands out</h3>
          <ul>
            {assessment.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Still to verify</h3>
          <ul>
            {assessment.unknowns.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      </div>
      <section className="d-verify-questions">
        <h3>Good questions for the next review</h3>
        {assessment.questions.map((q, i) => (
          <p key={q}>
            <span>0{i + 1}</span>
            {q}
          </p>
        ))}
      </section>
      <p className="d-caption">
        AI evaluates submitted evidence. Working behavior still needs human
        verification.
      </p>
    </div>
  );
}

export function ProjectDetail({
  data,
  act,
  projectId,
  onClose,
  onReview,
}: WorkspaceProps & {
  projectId: string;
  onClose: () => void;
  onReview: (id: string) => void;
}) {
  const [tab, setTab] = useState('timeline');
  const [busy, setBusy] = useState(false);
  const { event, user } = data;
  const project = event.projects.find((p) => p.id === projectId)!;
  const [reason, setReason] = useState(project?.shortlistReason || '');
  if (!project) return null;
  const signal = signals(event).find((s) => s.project.id === project.id)!;
  const reviews = event.reviews.filter(
    (r) =>
      r.projectId === project.id &&
      (user.role === 'organizer' || r.mentorId === user.id),
  );
  const hasOwnReview = event.reviews.some(
    (r) =>
      r.submissionId === signal.latest?.id &&
      r.mentorId === user.id &&
      r.kind === (event.stage === 'building' ? 'check-in' : 'final'),
  );
  async function choose(selected: boolean) {
    setBusy(true);
    try {
      await act(
        'shortlist',
        { projectId, selected, reason },
        selected
          ? 'Provisional shortlist updated.'
          : 'Project removed from the shortlist.',
      );
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project.title}
      subtitle={`Project ${String(project.number).padStart(3, '0')} · ${project.participantName}`}
      onClose={onClose}
      wide
    >
      <div className="d-project-detail-hero">
        <ProjectMark project={project} />
        <div>
          <p>{project.tagline || project.description}</p>
          <div className="d-row">
            <Badge>{project.category}</Badge>
            {project.repoUrl && (
              <ExternalLink href={project.repoUrl}>Repository</ExternalLink>
            )}
            {project.demoUrl && (
              <ExternalLink href={project.demoUrl}>Open demo</ExternalLink>
            )}
          </div>
        </div>
      </div>
      <div className="d-detail-stats">
        <div>
          <span>Human evaluation</span>
          <Score value={signal.humanScore} />
          <small>{signal.finalReviews} current final reviews</small>
        </div>
        <div>
          <span>AI signal</span>
          <Score value={signal.aiScore} subdued />
          <small>
            {signal.evaluation?.sample
              ? 'Illustrative sample'
              : signal.aiScore == null
                ? 'Evidence incomplete or withheld'
                : 'Advisory · evidence based'}
          </small>
        </div>
        <div>
          <span>Latest checkpoint</span>
          <strong>
            {signal.latest
              ? event.checkpoints[signal.latest.checkpoint].title
              : 'Awaiting update'}
          </strong>
          <small>
            {signal.latest
              ? dateTime(signal.latest.submittedAt)
              : 'No submission yet'}
          </small>
        </div>
      </div>
      <div
        className="d-detail-tabs"
        role="tablist"
        aria-label="Project details"
      >
        {[
          ['timeline', 'Project timeline'],
          ['ai', 'AI assessment'],
          ['reviews', 'Human reviews'],
        ].map(([key, label]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="d-detail-body">
        {tab === 'timeline' && (
          <>
            <div className="d-project-about">
              <h3>The idea</h3>
              <p>{project.description}</p>
              <div className="d-row">
                <span className="d-small-heading">Goal</span>
                <p>{project.goal || 'Not yet recorded'}</p>
              </div>
            </div>
            <SubmissionTimeline event={event} project={project} />
          </>
        )}
        {tab === 'ai' && (
          <AssessmentView
            event={event}
            evaluation={signal.evaluation}
            act={act}
            canRetry={user.role === 'organizer' || project.ownerId === user.id}
          />
        )}
        {tab === 'reviews' && (
          <>
            {user.role === 'mentor' && (
              <div className="d-callout">
                Your own reviews appear here. Other reviewers’ ratings stay
                private.
              </div>
            )}
            {reviews.length ? (
              reviews.map((r) => {
                const excluded = event.conflicts.some(
                  (c) =>
                    c.projectId === project.id && c.mentorId === r.mentorId,
                );
                const current = r.submissionId === signal.latest?.id;
                return (
                  <article
                    className={`d-review-record ${excluded ? 'is-excluded' : ''}`}
                    key={r.id}
                  >
                    <div className="d-row d-between">
                      <strong>{r.mentorName}</strong>
                      <Badge
                        tone={excluded ? 'red' : current ? 'green' : 'neutral'}
                      >
                        {excluded
                          ? 'Excluded · conflict'
                          : r.kind === 'check-in'
                            ? 'Progress check-in'
                            : current
                              ? 'Current final review'
                              : 'Earlier version'}
                      </Badge>
                    </div>
                    <p>{r.note}</p>
                    {r.kind === 'final' && (
                      <div className="d-review-scores">
                        {event.rubric.map((c) => (
                          <span key={c.id}>
                            {c.label}
                            <b>{r.scores[c.id] ?? '—'} / 5</b>
                          </span>
                        ))}
                        <Score value={totalScore(r.scores, event.rubric)} />
                      </div>
                    )}
                    <div className="d-row d-between">
                      <small>
                        {r.verified
                          ? 'Core workflow observed'
                          : 'Runtime behavior not verified'}
                      </small>
                      <small>{dateTime(r.createdAt)}</small>
                    </div>
                  </article>
                );
              })
            ) : (
              <Empty title="A fresh perspective is on its way">
                Independent mentor reviews will appear here when submitted.
              </Empty>
            )}
          </>
        )}
      </div>
      {user.role === 'organizer' && (
        <footer className="d-detail-actions">
          {!event.approvedAt ? (
            <>
              <Field label="Why should the panel see this project?">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={1500}
                  placeholder="A concrete reason for the shortlist…"
                />
              </Field>
              <div className="d-row d-between">
                <Button
                  onClick={async () => {
                    try {
                      await act(
                        'second-look',
                        { projectId },
                        'Independent second look requested.',
                      );
                    } catch {}
                  }}
                  disabled={project.needsReview}
                >
                  <ClipboardCheck size={14} />
                  {project.needsReview
                    ? 'Second look requested'
                    : 'Request second look'}
                </Button>
                <div className="d-row">
                  {project.shortlisted && (
                    <Button onClick={() => choose(false)} busy={busy}>
                      Remove
                    </Button>
                  )}
                  <Button
                    primary
                    onClick={() => choose(true)}
                    busy={busy}
                    disabled={!reason.trim()}
                  >
                    {project.shortlisted ? (
                      <Check size={14} />
                    ) : (
                      <Flag size={14} />
                    )}
                    {project.shortlisted
                      ? 'Save selection reason'
                      : 'Add to shortlist'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="d-row">
              <LockKeyhole size={15} />
              <span>
                The shortlist was approved on {dateTime(event.approvedAt)}.
              </span>
            </div>
          )}
        </footer>
      )}
      {user.role === 'mentor' && (
        <footer className="d-detail-actions">
          <div className="d-row d-between">
            <span className="d-muted">Your assessment stays independent.</span>
            <Button
              primary
              disabled={hasOwnReview || !signal.latest || !!event.approvedAt}
              onClick={() => onReview(project.id)}
            >
              {hasOwnReview ? <Check size={15} /> : <ArrowRight size={15} />}
              {hasOwnReview ? 'Review submitted' : 'Start a review'}
            </Button>
          </div>
        </footer>
      )}
    </Modal>
  );
}
