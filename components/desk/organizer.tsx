'use client';

import { useMemo, useState, type SubmitEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  Copy,
  Flag,
  LockKeyhole,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { rankedSignals, signals, shortlistProblems } from '@/lib/desk/domain';
import type { ProjectSignal } from '@/lib/desk/types';
import {
  Badge,
  Button,
  dateTime,
  Empty,
  Field,
  Modal,
  ProjectMark,
  relativeTime,
  Score,
  type WorkspaceProps,
} from './ui';

function readiness(signal: ProjectSignal) {
  if (!signal.latest) return <Badge>Not submitted</Badge>;
  if (signal.latest.checkpoint < 2)
    return <Badge tone="amber">In progress</Badge>;
  return signal.evaluation?.assessment?.readiness === 'ready' ? (
    <Badge tone="green">Demo ready</Badge>
  ) : (
    <Badge tone="purple">Final submitted</Badge>
  );
}

export function ProjectTable({
  rows,
  openProject,
  compact = false,
}: {
  rows: ProjectSignal[];
  openProject: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="d-table-scroll">
      <table className="d-project-table">
        <thead>
          <tr>
            <th>Project</th>
            {!compact && <th>Category</th>}
            <th>Checkpoint</th>
            <th>AI signal</th>
            <th>Human review</th>
            <th>{compact ? 'Updated' : 'Status'}</th>
            <th>
              <span className="d-sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.project.id}>
              <td>
                <button
                  className="d-project-link"
                  onClick={() => openProject(s.project.id)}
                >
                  <ProjectMark project={s.project} />
                  <span>
                    <strong>{s.project.title}</strong>
                    <small>
                      {s.project.participantName}
                      <span className="d-project-number">
                        {' '}
                        · #{String(s.project.number).padStart(3, '0')}
                      </span>
                    </small>
                  </span>
                </button>
              </td>
              {!compact && (
                <td>
                  <span className="d-category">{s.project.category}</span>
                </td>
              )}
              <td>
                <span
                  className="d-checkpoint-dots"
                  aria-label={`${(s.latest?.checkpoint ?? -1) + 1} of 3 checkpoints`}
                >
                  {[0, 1, 2].map((n) => (
                    <i
                      key={n}
                      className={
                        s.project.submissions.some((x) => x.checkpoint === n)
                          ? 'is-done'
                          : ''
                      }
                    />
                  ))}
                </span>
                <small className="d-cell-note">
                  {s.latest
                    ? ['Direction', 'Progress', 'Final update'][
                        s.latest.checkpoint
                      ]
                    : 'Awaiting update'}
                </small>
              </td>
              <td>
                {s.evaluation?.status === 'failed' ? (
                  <Badge tone="red">Needs retry</Badge>
                ) : s.evaluation?.status === 'queued' ||
                  s.evaluation?.status === 'running' ? (
                  <span className="d-muted">Evaluating…</span>
                ) : (
                  <Score value={s.aiScore} subdued />
                )}
                <small className="d-cell-note">
                  {s.evaluation?.sample
                    ? 'Sample signal'
                    : s.aiScore == null && s.evaluation?.assessment
                      ? 'Evidence incomplete'
                      : 'Advisory'}
                </small>
              </td>
              <td>
                <Score value={s.humanScore} />
                <small className="d-cell-note">
                  {s.finalReviews
                    ? `${s.finalReviews} independent review${s.finalReviews === 1 ? '' : 's'}`
                    : 'Review pending'}
                </small>
              </td>
              <td>
                {compact ? (
                  <span className="d-time">
                    {s.latest ? relativeTime(s.latest.submittedAt) : '—'}
                  </span>
                ) : (
                  readiness(s)
                )}
              </td>
              <td>
                <button
                  className="d-icon-btn"
                  onClick={() => openProject(s.project.id)}
                  aria-label={`Open ${s.project.title}`}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Overview({ data, openProject, go }: WorkspaceProps) {
  const { event } = data;
  const rows = signals(event);
  const submitted = rows.filter((s) => s.latest?.checkpoint === 2).length;
  const reviewed = rows.filter((s) => s.finalReviews).length;
  const selected = rows.filter((s) => s.project.shortlisted).length;
  const attention = rows
    .filter((s) =>
      s.attention.some(
        (a) =>
          a.includes('disagreement') ||
          a.includes('Second look') ||
          a.includes('support'),
      ),
    )
    .slice(0, 4);
  const completedAI = event.evaluations.filter(
    (e) => e.status === 'completed',
  ).length;
  const recent = [...rows]
    .filter((s) => s.latest)
    .sort((a, b) => b.latest!.submittedAt.localeCompare(a.latest!.submittedAt))
    .slice(0, 5);
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">Event overview</p>
          <h1>The room, at a glance.</h1>
          <p>A little perspective on everything being built.</p>
        </div>
        <Button onClick={() => go('shortlist')}>
          View shortlist
          <ArrowUpRight size={15} />
        </Button>
      </div>
      <div className="d-event-banner">
        <span className="d-banner-icon">
          <ClipboardCheck size={21} strokeWidth={1.6} />
        </span>
        <div>
          <strong>
            {event.stage === 'shortlisted'
              ? 'The final lineup is ready.'
              : event.stage === 'final-review'
                ? 'Time to give every project a fresh look.'
                : 'Good ideas are taking shape.'}
          </strong>
          <p>
            {event.stage === 'shortlisted'
              ? `${selected} demos have been approved for the judging panel.`
              : `${event.checkpoints[event.currentCheckpoint].title} is open. ${event.projects.length - reviewed} projects still need a final review.`}
          </p>
        </div>
        <button
          onClick={() =>
            go(event.stage === 'shortlisted' ? 'shortlist' : 'reviews')
          }
        >
          {event.stage === 'shortlisted' ? 'See the lineup' : 'Review coverage'}
          <ArrowRight size={15} />
        </button>
      </div>
      <div className="d-metrics">
        {[
          [
            event.projects.length,
            'Solo projects',
            `Room for ${event.capacity} builders`,
            <Users key="i" size={17} />,
          ],
          [
            submitted,
            'Final submissions',
            `${Math.max(0, event.projects.length - submitted)} still in progress`,
            <Clock3 key="i" size={17} />,
          ],
          [
            reviewed,
            'Human reviewed',
            `${data.mentors.length} mentors on the floor`,
            <ClipboardCheck key="i" size={17} />,
          ],
          [
            `${selected}`,
            'On the shortlist',
            `of ${event.shortlistTarget} demo spots`,
            <Flag key="i" size={17} />,
          ],
        ].map(([value, label, note, icon]) => (
          <div className="d-metric" key={String(label as string)}>
            <div>
              <span>{label}</span>
              {icon}
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="d-overview-grid">
        <section className="d-panel d-coverage">
          <div className="d-section-heading">
            <div>
              <h2>A fair look for every builder</h2>
              <p>Final review coverage, project by project.</p>
            </div>
            <span className="d-large-percent">
              {event.projects.length
                ? Math.round((reviewed / event.projects.length) * 100)
                : 0}
              <small>%</small>
            </span>
          </div>
          <div className="d-coverage-grid">
            {Array.from(
              { length: Math.max(event.projects.length, 100) },
              (_, i) => {
                const s = rows[i];
                return s ? (
                  <button
                    key={s.project.id}
                    className={
                      s.finalReviews
                        ? 'is-reviewed'
                        : s.latest?.checkpoint === 2
                          ? 'is-submitted'
                          : 'is-waiting'
                    }
                    title={`${s.project.title}: ${s.finalReviews ? 'reviewed' : s.latest?.checkpoint === 2 ? 'review pending' : 'final update pending'}`}
                    aria-label={`Open ${s.project.title}, ${s.finalReviews} final reviews`}
                    onClick={() => openProject(s.project.id)}
                  />
                ) : (
                  <span key={i} className="is-empty" />
                );
              },
            )}
          </div>
          <div className="d-legend">
            <span>
              <i className="is-reviewed" />
              Reviewed · {reviewed}
            </span>
            <span>
              <i className="is-submitted" />
              Ready for review · {submitted - reviewed}
            </span>
            <span>
              <i className="is-waiting" />
              Awaiting final · {event.projects.length - submitted}
            </span>
          </div>
          <div className="d-coverage-foot">
            <span>
              <CircleCheck size={15} />
              {completedAI} AI assessments complete
              {event.demo ? ' · illustrative sample data' : ''}
            </span>
            <button className="d-text-btn" onClick={() => go('reviews')}>
              View coverage
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section className="d-panel d-attention">
          <div className="d-section-heading">
            <div>
              <h2>Needs a closer look</h2>
              <p>Where a human perspective helps most.</p>
            </div>
            <span className="d-counter">
              {rows.filter((s) => s.attention.length).length}
            </span>
          </div>
          {attention.length ? (
            attention.map((s) => (
              <button
                className="d-attention-row"
                key={s.project.id}
                onClick={() => openProject(s.project.id)}
              >
                <ProjectMark project={s.project} small />
                <span>
                  <strong>{s.project.title}</strong>
                  <small>
                    {s.attention.find(
                      (a) =>
                        a.includes('disagreement') ||
                        a.includes('Second look') ||
                        a.includes('support'),
                    )}
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))
          ) : (
            <div className="d-inline-empty">
              All clear. New requests will appear here.
            </div>
          )}
          <button className="d-attention-footer" onClick={() => go('help')}>
            Open the support desk
            <ArrowUpRight size={14} />
          </button>
        </section>
      </div>
      <section className="d-panel d-recent">
        <div className="d-section-heading">
          <div>
            <h2>Projects in motion</h2>
            <p>The latest updates from the floor.</p>
          </div>
          <button className="d-text-btn" onClick={() => go('projects')}>
            All projects
            <ArrowRight size={14} />
          </button>
        </div>
        {recent.length ? (
          <ProjectTable rows={recent} openProject={openProject} compact />
        ) : (
          <Empty
            title="The first idea starts here"
            action={
              <Button onClick={() => go('settings')}>
                Invite your builders
                <ArrowRight size={15} />
              </Button>
            }
          >
            Share your participant invitation. Their projects will appear here
            as they join.
          </Empty>
        )}
      </section>
      <div className="d-page-foot">
        <span>
          <i className="d-live-dot" />
          Updates refresh automatically
        </span>
        <span>Independent perspectives. Thoughtful decisions.</span>
      </div>
    </>
  );
}

export function Projects({
  data,
  openProject,
  initialFilter = 'all',
}: WorkspaceProps & { initialFilter?: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [category, setCategory] = useState('all');
  const rows = useMemo(() => rankedSignals(data.event), [data.event]);
  const filtered = rows
    .filter((s) =>
      `${s.project.title} ${s.project.participantName} ${s.project.tagline}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter((s) => category === 'all' || s.project.category === category)
    .filter(
      (s) =>
        filter === 'all' ||
        (filter === 'review'
          ? !s.finalReviews
          : filter === 'attention'
            ? s.attention.length > 0
            : s.project.shortlisted),
    );
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">The project directory</p>
          <h1>One hundred possibilities.</h1>
          <p>Follow the progress. Find the next great demo.</p>
        </div>
        <a download className="d-btn" href="/api/desk/export">
          <ArrowDownToLine size={15} />
          Export scores
        </a>
      </div>
      <div className="d-directory-toolbar">
        <div className="d-filter-tabs">
          {[
            ['all', 'All projects'],
            ['review', 'Review needed'],
            ['attention', 'Needs attention'],
            ['selected', 'Shortlisted'],
          ].map(([key, label]) => (
            <button
              className={filter === key ? 'is-active' : ''}
              key={key}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === 'all' && <span>{rows.length}</span>}
            </button>
          ))}
        </div>
        <div className="d-search">
          <Search size={15} />
          <input
            aria-label="Search projects"
            placeholder="Search projects or builders…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="d-directory-meta">
        <span>
          {filtered.length} project{filtered.length === 1 ? '' : 's'}
        </span>
        <label className="d-select-label">
          <SlidersHorizontal size={14} />
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {[...new Set(rows.map((s) => s.project.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <section className="d-panel">
        {filtered.length ? (
          <ProjectTable rows={filtered} openProject={openProject} />
        ) : (
          <Empty title="No projects in this view">
            Try another search or filter. Newly registered projects appear
            automatically.
          </Empty>
        )}
      </section>
      <p className="d-caption">
        Ordered by final human scores. AI signals are shown separately and never
        added to the ranking.
      </p>
    </>
  );
}

export function Coverage(props: WorkspaceProps) {
  const { data, openProject } = props;
  const rows = signals(data.event);
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">Independent human evaluation</p>
          <h1>No project left unseen.</h1>
          <p>Track coverage and request another perspective where it counts.</p>
        </div>
        <Badge tone="purple">{data.mentors.length} mentors</Badge>
      </div>
      <div className="d-mentor-summary">
        {data.mentors.map((m) => {
          const checks = data.event.reviews.filter((r) => r.mentorId === m.id);
          const conflictCount = data.event.conflicts.filter(
            (c) => c.mentorId === m.id,
          ).length;
          return (
            <div className="d-mentor-card" key={m.id}>
              <span className="d-avatar">{m.name.slice(0, 1)}</span>
              <strong>{m.name}</strong>
              <p>{m.skills.join(' · ') || 'General mentor'}</p>
              <div>
                <span>
                  <b>{checks.filter((r) => r.kind === 'check-in').length}</b>{' '}
                  check-ins
                </span>
                <span>
                  <b>{checks.filter((r) => r.kind === 'final').length}</b> final
                  reviews
                </span>
              </div>
              {conflictCount > 0 && (
                <small>
                  {conflictCount} declared conflict
                  {conflictCount > 1 ? 's' : ''}
                </small>
              )}
            </div>
          );
        })}
      </div>
      <section className="d-panel">
        <div className="d-section-heading">
          <div>
            <h2>Waiting for a final review</h2>
            <p>Latest submitted versions with no independent final score.</p>
          </div>
          <Badge>
            {
              rows.filter((s) => s.latest?.checkpoint === 2 && !s.finalReviews)
                .length
            }{' '}
            projects
          </Badge>
        </div>
        <ProjectTable
          rows={rows.filter(
            (s) => s.latest?.checkpoint === 2 && !s.finalReviews,
          )}
          openProject={openProject}
        />
      </section>
    </>
  );
}

export function Shortlist({ data, act, openProject }: WorkspaceProps) {
  const { event } = data;
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);
  const rows = rankedSignals(event);
  const selected = rows.filter((s) => s.project.shortlisted);
  const candidates = rows
    .filter((s) => !s.project.shortlisted && s.humanScore != null)
    .slice(0, 20);
  const problems = shortlistProblems(event);
  async function approve() {
    setShowProblems(true);
    if (problems.length) return;
    setBusy(true);
    try {
      await act('approve', {}, 'The finalist lineup is approved.');
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">The final lineup</p>
          <h1>Make room for the standouts.</h1>
          <p>
            Your shortlist is a decision, with a reason behind every project.
          </p>
        </div>
        <div className="d-row">
          <a download className="d-btn" href="/api/desk/export?format=briefs">
            <ArrowDownToLine size={15} />
            Judge briefs
          </a>
          {event.approvedAt ? (
            <Button onClick={() => setReopen(true)}>
              <LockKeyhole size={14} />
              Reopen shortlist
            </Button>
          ) : (
            <Button primary onClick={approve} busy={busy}>
              <Check size={15} />
              Approve shortlist
            </Button>
          )}
        </div>
      </div>
      <div className="d-shortlist-progress">
        <div>
          <span className="d-eyebrow">
            {event.approvedAt ? 'Approved lineup' : 'Provisional lineup'}
          </span>
          <strong>
            {selected.length}
            <small> / {event.shortlistTarget} demo spots</small>
          </strong>
        </div>
        <div className="d-shortlist-slots">
          {Array.from({ length: event.shortlistTarget }, (_, i) => (
            <span key={i} className={i < selected.length ? 'is-filled' : ''}>
              {i < selected.length ? (
                <Check size={15} />
              ) : (
                String(i + 1).padStart(2, '0')
              )}
            </span>
          ))}
        </div>
        <Badge tone={event.approvedAt ? 'green' : 'purple'}>
          {event.approvedAt ? 'Ready for the panel' : 'Your final say'}
        </Badge>
      </div>
      {showProblems && problems.length > 0 && (
        <div className="d-callout d-callout-amber">
          <strong>A few things to finish first</strong>
          <ul>
            {problems.slice(0, 8).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {problems.length > 8 && (
            <p>And {problems.length - 8} more review requirements.</p>
          )}
        </div>
      )}
      <div className="d-shortlist-grid">
        {selected.map((s, i) => (
          <button
            className="d-finalist-card"
            key={s.project.id}
            onClick={() => openProject(s.project.id)}
          >
            <div className="d-finalist-top">
              <ProjectMark project={s.project} />
              <span className="d-finalist-number">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <h2>{s.project.title}</h2>
            <span>{s.project.participantName}</span>
            <p>{s.project.tagline}</p>
            <div className="d-finalist-score">
              <Score value={s.humanScore} />
              <Badge tone={s.finalReviews >= 2 ? 'green' : 'amber'}>
                {s.finalReviews} final reviews
              </Badge>
            </div>
            <div className="d-finalist-reason">
              {s.project.shortlistReason || 'Add a selection reason'}
              <ArrowUpRight size={14} />
            </div>
          </button>
        ))}
        {selected.length < event.shortlistTarget && (
          <div className="d-finalist-placeholder">
            <Flag size={25} strokeWidth={1.3} />
            <h3>The next standout</h3>
            <p>Open a candidate below to add them to the lineup.</p>
          </div>
        )}
      </div>
      {!event.approvedAt && (
        <section className="d-panel">
          <div className="d-section-heading">
            <div>
              <h2>Worth another look</h2>
              <p>
                Highest human-rated projects outside your provisional lineup.
              </p>
            </div>
            <span className="d-muted">Human scores only</span>
          </div>
          {candidates.length ? (
            <ProjectTable rows={candidates} openProject={openProject} compact />
          ) : (
            <Empty title="Your next candidates will appear here">
              Complete final human reviews to build a considered shortlist.
            </Empty>
          )}
        </section>
      )}
      {reopen && (
        <Modal
          title="Reopen the shortlist"
          subtitle="The reason will stay in the event history."
          onClose={() => setReopen(false)}
        >
          <form
            className="d-form-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get('reason');
              setBusy(true);
              try {
                await act(
                  'reopen',
                  { reason },
                  'Shortlist reopened for review.',
                );
                setReopen(false);
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Reason for reopening">
              <textarea name="reason" required minLength={5} rows={3} />
            </Field>
            <Button primary type="submit" busy={busy}>
              Reopen for review
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function HelpDesk({ data, act, openProject }: WorkspaceProps) {
  const [busy, setBusy] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const requests = data.event.help.filter((h) =>
    showResolved ? h.status === 'resolved' : h.status !== 'resolved',
  );
  async function update(id: string, status: string) {
    setBusy(id);
    try {
      await act(
        'help-status',
        { id, status },
        status === 'claimed'
          ? 'You’re on it. The participant can see your name.'
          : 'Help request resolved.',
      );
    } catch {
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">The support desk</p>
          <h1>A little help goes a long way.</h1>
          <p>Pick up a blocker. Give someone their momentum back.</p>
        </div>
        <Button onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? 'Open requests' : 'Resolved requests'}
        </Button>
      </div>
      <div className="d-help-grid">
        {requests.map((h) => {
          const p = data.event.projects.find((p) => p.id === h.projectId)!;
          return (
            <article className="d-help-card" key={h.id}>
              <div className="d-row d-between">
                <Badge tone={h.status === 'claimed' ? 'purple' : 'amber'}>
                  {h.status === 'claimed' ? 'Being helped' : h.type}
                </Badge>
                <span className="d-time">{relativeTime(h.createdAt)}</span>
              </div>
              <button
                className="d-project-link"
                onClick={() => openProject(p.id)}
              >
                <ProjectMark project={p} small />
                <span>
                  <strong>{p.title}</strong>
                  <small>{p.participantName}</small>
                </span>
              </button>
              <p>{h.note}</p>
              <div className="d-help-footer">
                <span>
                  {h.claimedName
                    ? `With ${h.claimedName}`
                    : 'Waiting for a mentor'}
                </span>
                {h.status === 'open' ? (
                  <Button
                    onClick={() => update(h.id, 'claimed')}
                    busy={busy === h.id}
                  >
                    I can help
                    <ArrowRight size={14} />
                  </Button>
                ) : h.status === 'claimed' &&
                  (h.claimedBy === data.user.id ||
                    data.user.role === 'organizer') ? (
                  <Button
                    onClick={() => update(h.id, 'resolved')}
                    busy={busy === h.id}
                  >
                    <Check size={14} />
                    Mark resolved
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {!requests.length && (
        <Empty title="Nothing waiting here">
          {showResolved
            ? 'Resolved help requests will appear here.'
            : 'When a builder needs a hand, their request appears here.'}
        </Empty>
      )}
    </>
  );
}

function localDate(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function Settings({ data, act }: WorkspaceProps) {
  const { event } = data;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [localError, setLocalError] = useState('');
  const [weights, setWeights] = useState(event.rubric.map((c) => c.weight));
  async function copy(kind: string, code: string) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/desk?join=${code}`,
      );
      setCopied(kind);
      setTimeout(() => setCopied(''), 2500);
    } catch {
      setLocalError(`Copy this invite code: ${code}`);
    }
  }
  async function save(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setLocalError('');
    const value = (key: string) => {
      const v = f.get(key);
      return typeof v === 'string' ? v : '';
    };
    try {
      await act(
        'settings',
        {
          name: value('name'),
          theme: value('theme'),
          venue: value('venue'),
          shortlistTarget: Number(f.get('target')),
          currentCheckpoint: Number(f.get('checkpoint')),
          stage: value('stage'),
          startsAt: new Date(value('startsAt')).toISOString(),
          endsAt: new Date(value('endsAt')).toISOString(),
          checkpoints: event.checkpoints.map((c, i) => ({
            title: value(`title-${i}`),
            dueAt: new Date(value(`due-${i}`)).toISOString(),
          })),
          weights,
        },
        'Event settings saved.',
      );
    } catch (error) {
      setLocalError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">Set the room up for success</p>
          <h1>The details make the difference.</h1>
          <p>Your schedule, invitations, and shared evaluation rubric.</p>
        </div>
        <div className="d-row">
          <a download className="d-btn" href="/api/desk/export?format=template">
            <ArrowDownToLine size={15} />
            Save event template
          </a>
          <a download className="d-btn" href="/api/desk/export?format=json">
            <ArrowDownToLine size={15} />
            Export event data
          </a>
        </div>
      </div>
      <section className="d-panel d-invites">
        <div>
          <h2>Bring your people in.</h2>
          <p>Separate invitations keep participant and mentor access clear.</p>
        </div>
        {[
          ['Participants', event.participantCode],
          ['Mentors', event.mentorCode],
        ].map(([kind, code]) => (
          <div className="d-invite" key={kind}>
            <span>{kind}</span>
            <code>{code}</code>
            <Button onClick={() => copy(kind, code)}>
              {copied === kind ? <Check size={14} /> : <Copy size={14} />}
              {copied === kind ? 'Copied' : 'Copy invite'}
            </Button>
          </div>
        ))}
      </section>
      <form onSubmit={save} className="d-settings-form">
        <section className="d-panel d-settings-section">
          <h2>Event details</h2>
          <div className="d-form-grid">
            <Field label="Event name">
              <input
                name="name"
                defaultValue={event.name}
                required
                minLength={3}
                maxLength={100}
              />
            </Field>
            <Field label="Location">
              <input name="venue" defaultValue={event.venue} maxLength={120} />
            </Field>
          </div>
          <Field label="Theme or brief">
            <textarea
              name="theme"
              defaultValue={event.theme}
              rows={2}
              maxLength={600}
            />
          </Field>
          <div className="d-form-grid">
            <Field label="Event starts · local time">
              <input
                type="datetime-local"
                name="startsAt"
                required
                defaultValue={localDate(event.startsAt)}
              />
            </Field>
            <Field label="Event ends · local time">
              <input
                type="datetime-local"
                name="endsAt"
                required
                defaultValue={localDate(event.endsAt)}
              />
            </Field>
          </div>
        </section>
        <section className="d-panel d-settings-section">
          <div className="d-section-heading">
            <div>
              <h2>Checkpoints</h2>
              <p>Open each checkpoint when the room is ready.</p>
            </div>
          </div>
          {event.checkpoints.map((c, i) => (
            <div className="d-checkpoint-setting" key={i}>
              <span className="d-step-number">0{i + 1}</span>
              <Field label={`Checkpoint ${i + 1} title`}>
                <input
                  name={`title-${i}`}
                  defaultValue={c.title}
                  required
                  minLength={3}
                />
              </Field>
              <Field label="Submission deadline · local time">
                <input
                  name={`due-${i}`}
                  type="datetime-local"
                  defaultValue={localDate(c.dueAt)}
                  required
                />
              </Field>
            </div>
          ))}
          <div className="d-form-grid">
            <Field label="Open checkpoint">
              <select name="checkpoint" defaultValue={event.currentCheckpoint}>
                {event.checkpoints.map((c, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Event stage">
              <select
                name="stage"
                defaultValue={
                  event.stage === 'shortlisted' ? 'final-review' : event.stage
                }
              >
                <option value="building">Building · mentor check-ins</option>
                <option value="final-review">
                  Final review · scored evaluations
                </option>
              </select>
            </Field>
          </div>
        </section>
        <section className="d-panel d-settings-section">
          <div className="d-section-heading">
            <div>
              <h2>The shared rubric</h2>
              <p>
                Scores use 0–5 anchors. Weights lock after the first submission.
              </p>
            </div>
            <Badge
              tone={
                weights.reduce((a, b) => a + b, 0) === 100 ? 'green' : 'red'
              }
            >
              {weights.reduce((a, b) => a + b, 0)} / 100%
            </Badge>
          </div>
          {event.rubric.map((c, i) => (
            <div className="d-rubric-setting" key={c.id}>
              <div>
                <strong>{c.label}</strong>
                <p>{c.question}</p>
              </div>
              <label>
                <input
                  type="number"
                  min={1}
                  max={97}
                  aria-label={`${c.label} weight`}
                  value={weights[i]}
                  disabled={event.projects.some(
                    (p) => p.submissions.length > 0,
                  )}
                  onChange={(e) =>
                    setWeights(
                      weights.map((w, n) =>
                        n === i ? Number(e.target.value) : w,
                      ),
                    )
                  }
                />
                %
              </label>
            </div>
          ))}
          <Field
            label="Number of finalist demos"
            hint="Choose between 5 and 10. Every finalist needs two independent final reviews."
          >
            <input
              className="d-short-input"
              type="number"
              name="target"
              defaultValue={event.shortlistTarget}
              min={5}
              max={10}
              required
            />
          </Field>
        </section>
        {localError && (
          <p className="d-form-error" role="alert">
            {localError}
          </p>
        )}
        <div className="d-form-actions">
          <span>All changes are recorded in the event history.</span>
          <Button
            primary
            busy={busy}
            type="submit"
            disabled={!!event.approvedAt}
          >
            Save event settings
            <Check size={15} />
          </Button>
        </div>
      </form>
      <section className="d-panel d-history">
        <h2>Event history</h2>
        {event.audit.slice(0, 15).map((a) => (
          <div key={a.id}>
            <span className="d-audit-dot" />
            <p>
              <strong>{a.actor}</strong> {a.text}
              <small>{dateTime(a.at)}</small>
            </p>
          </div>
        ))}
      </section>
    </>
  );
}
