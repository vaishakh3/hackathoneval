'use client';

import { useEffect, useState, type SubmitEvent } from 'react';
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Flag,
  LockKeyhole,
  Search,
} from 'lucide-react';
import { queueFor } from '@/lib/desk/domain';
import { ANCHORS, type DeskState, type Project } from '@/lib/desk/types';
import {
  Badge,
  Button,
  Empty,
  Field,
  Modal,
  ProjectMark,
  request,
  useDraft,
  type Action,
  type WorkspaceProps,
} from './ui';

export function MentorQueue({
  data,
  act,
  openProject,
  onReview,
}: WorkspaceProps & { onReview: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [showSkills, setShowSkills] = useState(false);
  const [skills, setSkills] = useState(data.user.skills);
  const [busy, setBusy] = useState(false);
  const { event, user } = data;
  const order = new Map(
    (data.reviewQueue ?? []).map((id, index) => [id, index]),
  );
  const queue = queueFor(event, user.id)
    .sort(
      (a, b) =>
        (order.get(a.project.id) ?? 1000) - (order.get(b.project.id) ?? 1000),
    )
    .filter((s) => event.stage === 'building' || s.latest?.checkpoint === 2)
    .filter((s) =>
      `${s.project.title} ${s.project.participantName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const mine = event.reviews.filter((r) => r.mentorId === user.id);
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">Your mentor desk</p>
          <h1>A fresh pair of eyes matters.</h1>
          <p>Start with an unfamiliar project. Bring your own perspective.</p>
        </div>
        <Button onClick={() => setShowSkills(true)}>Your expertise</Button>
      </div>
      <div className="d-mentor-intro">
        <span className="d-mentor-avatar">{user.name.slice(0, 1)}</span>
        <div>
          <h2>Good to have you here, {user.name.split(' ')[0]}.</h2>
          <p>
            {event.stage === 'building'
              ? 'Check in on direction, progress, and blockers. Scored final reviews open later.'
              : 'Verify the latest build and score the shared rubric. AI observations unlock after you submit.'}
          </p>
        </div>
        <div className="d-mentor-count">
          <strong>{mine.length}</strong>
          <span>your reviews</span>
        </div>
      </div>
      <div className="d-directory-toolbar">
        <div>
          <h2>Your next conversations</h2>
          <p className="d-muted">
            {queue.length} projects available · fresh perspectives first
          </p>
        </div>
        <div className="d-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search review queue"
            placeholder="Find a project or builder…"
          />
        </div>
      </div>
      <div className="d-review-queue">
        {queue.slice(0, 20).map((s, i) => {
          const lock = event.locks.find(
            (l) =>
              l.projectId === s.project.id &&
              l.mentorId !== user.id &&
              Date.parse(l.expiresAt) > Date.now(),
          );
          const visited = mine.some((r) => r.projectId === s.project.id);
          return (
            <article className="d-queue-card" key={s.project.id}>
              <div className="d-row d-between">
                <span className="d-queue-position">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {s.project.needsReview ? (
                  <Badge tone="amber">Second look</Badge>
                ) : visited ? (
                  <Badge>You’ve visited</Badge>
                ) : (
                  <Badge tone="green">New to you</Badge>
                )}
              </div>
              <button
                className="d-project-link"
                onClick={() => openProject(s.project.id)}
              >
                <ProjectMark project={s.project} />
                <span>
                  <strong>{s.project.title}</strong>
                  <small>{s.project.participantName}</small>
                </span>
              </button>
              <p>{s.project.tagline || s.project.description}</p>
              <div className="d-queue-context">
                <span>{s.project.category}</span>
                <span>{s.finalReviews} final reviews</span>
              </div>
              <Button
                primary={i === 0 && !lock}
                onClick={() => onReview(s.project.id)}
                disabled={!!lock || !!event.approvedAt}
              >
                {lock ? (
                  <>
                    <LockKeyhole size={14} />
                    With another mentor
                  </>
                ) : (
                  <>
                    Start {event.stage === 'building' ? 'check-in' : 'review'}
                    <ArrowRight size={15} />
                  </>
                )}
              </Button>
            </article>
          );
        })}
      </div>
      {!queue.length && (
        <Empty title="You’re all caught up">
          New submissions and projects needing another perspective will appear
          here.
        </Empty>
      )}
      {showSkills && (
        <Modal
          title="What can you help with?"
          subtitle="Your expertise makes the support desk more useful."
          onClose={() => setShowSkills(false)}
        >
          <div className="d-form-body">
            <div className="d-skill-options">
              {[
                'Software',
                'AI',
                'Design',
                'Hardware',
                'Idea refinement',
                'Education',
              ].map((s) => (
                <button
                  className={skills.includes(s) ? 'is-selected' : ''}
                  aria-pressed={skills.includes(s)}
                  key={s}
                  onClick={() =>
                    setSkills(
                      skills.includes(s)
                        ? skills.filter((v) => v !== s)
                        : [...skills, s],
                    )
                  }
                >
                  {skills.includes(s) && <Check size={14} />}
                  {s}
                </button>
              ))}
            </div>
            <Button
              primary
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await act('skills', { skills }, 'Your expertise is saved.');
                  setShowSkills(false);
                } catch {
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save expertise
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function ReviewSession({
  data,
  act,
  project,
  onClose,
}: {
  data: DeskState;
  act: Action;
  project: Project;
  onClose: () => void;
}) {
  const kind = data.event.stage === 'building' ? 'check-in' : 'final';
  const submission = project.submissions.at(-1)!;
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [form, save, clear] = useDraft(
    `desk-review-${data.user.id}-${submission.id}-${kind}`,
    {
      projectId: project.id,
      submissionId: submission.id,
      kind,
      scores: {} as Record<string, number>,
      note: '',
      verified: false,
      recommendation: 'maybe',
    },
  );
  const seen = data.event.reviews.some(
    (r) => r.projectId === project.id && r.mentorId === data.user.id,
  );
  useEffect(() => {
    if (!active) return;
    const heartbeat = setInterval(() => {
      request('claim-review', { projectId: project.id }).catch((error) => {
        setActive(false);
        setError(error.message);
      });
    }, 45000);
    return () => {
      clearInterval(heartbeat);
      request('release-review', { projectId: project.id }).catch(() => {});
    };
  }, [active, project.id]);
  async function start() {
    setBusy(true);
    setError('');
    try {
      await act('claim-review', { projectId: project.id, reason });
      setActive(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (
      kind === 'final' &&
      data.event.rubric.some((c) => form.scores[c.id] == null)
    ) {
      setError('Give a mark for every criterion.');
      return;
    }
    setBusy(true);
    try {
      await act(
        'review',
        form,
        'Independent review saved. AI observations are now available.',
      );
      clear();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${kind === 'final' ? 'Final review' : 'Progress check-in'} · ${project.title}`}
      subtitle={`${project.participantName} · ${data.event.checkpoints[submission.checkpoint].title}`}
      onClose={onClose}
      wide
    >
      <div className="d-review-session">
        <div className="d-callout">
          <LockKeyhole size={15} />
          AI ratings and other mentors’ scores stay hidden while you form your
          own assessment.
        </div>
        <div className="d-review-evidence">
          <h3>What the builder says works</h3>
          <p>{submission.working}</p>
          <h3>Since the last checkpoint</h3>
          <p>{submission.changed}</p>
          {submission.blockers && (
            <p>
              <strong>Remaining blocker:</strong> {submission.blockers}
            </p>
          )}
          <div className="d-row">
            {submission.evidence.map((e) => (
              <a
                className="d-inline-link"
                key={e.id}
                href={e.url}
                target="_blank"
                rel="noreferrer"
              >
                {e.label}
                <ArrowRight size={13} />
              </a>
            ))}
            {project.demoUrl && (
              <a
                className="d-inline-link"
                href={project.demoUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open demo
                <ArrowRight size={13} />
              </a>
            )}
          </div>
        </div>
        {!active ? (
          <div className="d-start-review">
            {seen && (
              <Field
                label="You’ve reviewed this project before. Why revisit?"
                hint="Fresh reviewers are preferred; this reason is visible to the organizer."
              >
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                />
              </Field>
            )}
            <div className="d-row d-between">
              <button
                className="d-text-btn"
                onClick={() => setConflict(!conflict)}
              >
                <Flag size={14} />I have a conflict of interest
              </button>
              <Button
                primary
                busy={busy}
                disabled={seen && !reason.trim()}
                onClick={start}
              >
                Start independent {kind === 'final' ? 'review' : 'check-in'}
                <ArrowRight size={15} />
              </Button>
            </div>
            {conflict && (
              <form
                className="d-conflict-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  const reason = new FormData(e.currentTarget).get('reason');
                  try {
                    await act(
                      'conflict',
                      { projectId: project.id, reason },
                      'Conflict recorded. Your earlier scores are excluded.',
                    );
                    onClose();
                  } catch {
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label="How are you connected to this project?">
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="e.g. I directly helped build this project."
                  />
                </Field>
                <Button type="submit" busy={busy}>
                  Declare conflict
                </Button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={submit}>
            {kind === 'final' && (
              <div className="d-scoring-rubric">
                {data.event.rubric.map((c) => (
                  <fieldset key={c.id}>
                    <legend>
                      {c.label}
                      <span>{c.weight}%</span>
                    </legend>
                    <p>{c.question}</p>
                    <div className="d-score-options">
                      {ANCHORS.map((label, value) => (
                        <button
                          type="button"
                          aria-pressed={form.scores[c.id] === value}
                          key={value}
                          title={label}
                          className={
                            form.scores[c.id] === value ? 'is-selected' : ''
                          }
                          onClick={() =>
                            save({
                              ...form,
                              scores: { ...form.scores, [c.id]: value },
                            })
                          }
                        >
                          <b>{value}</b>
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
            <Field
              label={
                kind === 'final'
                  ? 'What did you observe?'
                  : 'What would help this builder move forward?'
              }
            >
              <textarea
                rows={3}
                value={form.note}
                onChange={(e) => save({ ...form, note: e.target.value })}
                required
                minLength={10}
                maxLength={3000}
                placeholder="Concrete observations, useful feedback, and anything still to verify."
              />
            </Field>
            <label className="d-checkbox">
              <input
                type="checkbox"
                checked={form.verified}
                onChange={(e) => save({ ...form, verified: e.target.checked })}
              />
              <span>I observed the core workflow with a fresh input.</span>
            </label>
            {kind === 'final' && (
              <Field label="Should the final panel see this project?">
                <select
                  value={form.recommendation}
                  onChange={(e) =>
                    save({ ...form, recommendation: e.target.value })
                  }
                >
                  <option value="yes">Yes</option>
                  <option value="maybe">Worth considering</option>
                  <option value="no">Not yet ready</option>
                </select>
              </Field>
            )}
            <div className="d-form-actions">
              <span>Draft saved on this device.</span>
              <Button primary type="submit" busy={busy}>
                <ClipboardCheck size={15} />
                Save independent review
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p className="d-form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
