'use client';

import { useState, type SubmitEvent } from 'react';
import {
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  ImagePlus,
  Link as LinkIcon,
  Pencil,
  Plus,
  Send,
  X,
} from 'lucide-react';
import { CATEGORIES, type Evidence, type Project } from '@/lib/desk/types';
import { latestEvaluation } from '@/lib/desk/domain';
import { AssessmentView, SubmissionTimeline } from './project-detail';
import {
  Badge,
  Button,
  dateTime,
  Field,
  Modal,
  ProjectMark,
  relativeTime,
  useDraft,
  type WorkspaceProps,
} from './ui';

export function Participant(props: WorkspaceProps) {
  const { data, act } = props;
  const { event } = data;
  const project = event.projects[0];
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [helping, setHelping] = useState(false);
  const [tab, setTab] = useState('timeline');
  if (!project) return null;
  const latest = project.submissions.at(-1);
  const assessment = latestEvaluation(event, project);
  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">Your corner of the build</p>
          <h1>Good things start unfinished.</h1>
          <p>
            Keep your progress visible. There’s a room full of people rooting
            for you.
          </p>
        </div>
        <Button onClick={() => setHelping(true)} disabled={!!event.approvedAt}>
          <CircleHelp size={15} />
          Ask for help
        </Button>
      </div>
      {event.approvedAt && (
        <div
          className={`d-callout ${project.shortlisted ? 'd-callout-green' : ''}`}
        >
          <strong>
            {project.shortlisted
              ? 'Your project is in the final lineup.'
              : 'The finalist lineup has been announced.'}
          </strong>
          <p>
            {project.shortlisted
              ? 'Get your demo ready for the judging panel. Your organizer will share the presentation details.'
              : 'Thank you for building with us. Your progress and mentor feedback remain here.'}
          </p>
        </div>
      )}
      <section className="d-panel d-my-project">
        <div className="d-row d-between">
          <div className="d-row">
            <ProjectMark project={project} />
            <div>
              <Badge>{project.category}</Badge>
              <h2>{project.title}</h2>
              <p>{project.tagline || 'Every idea deserves a first draft.'}</p>
            </div>
          </div>
          <Button
            onClick={() => setEditing(true)}
            disabled={!!event.approvedAt}
          >
            <Pencil size={14} />
            Edit project
          </Button>
        </div>
        <p>
          {project.description ||
            'Add a short description and your goal to get started.'}
        </p>
        <div className="d-project-goal">
          <span className="d-eyebrow">The thing you’re aiming for</span>
          <p>
            {project.goal || 'What should be working by the end of the event?'}
          </p>
        </div>
      </section>
      <section className="d-participant-checkpoints">
        {event.checkpoints.map((c, i) => {
          const sent = project.submissions.some((s) => s.checkpoint === i);
          return (
            <div
              key={i}
              className={i === event.currentCheckpoint ? 'is-current' : ''}
            >
              <span className={`d-step-number ${sent ? 'is-complete' : ''}`}>
                {sent ? <Check size={16} /> : `0${i + 1}`}
              </span>
              <div>
                <strong>{c.title}</strong>
                <small>{dateTime(c.dueAt)}</small>
              </div>
              <Badge
                tone={
                  sent
                    ? 'green'
                    : i === event.currentCheckpoint
                      ? 'purple'
                      : 'neutral'
                }
              >
                {sent
                  ? 'Submitted'
                  : i === event.currentCheckpoint
                    ? 'Open now'
                    : 'Coming up'}
              </Badge>
            </div>
          );
        })}
      </section>
      {!event.approvedAt && (
        <section className="d-next-update">
          <div>
            <p className="d-eyebrow">
              Checkpoint {event.currentCheckpoint + 1} / 3
            </p>
            <h2>
              {latest?.checkpoint === event.currentCheckpoint
                ? 'Something new to share?'
                : 'Show us where you are.'}
            </h2>
            <p>
              A short update, what works, and a little evidence. Your previous
              versions stay in the timeline.
            </p>
            <span>
              <Clock3 size={14} />
              Closes{' '}
              {dateTime(event.checkpoints[event.currentCheckpoint].dueAt)}
            </span>
          </div>
          <Button
            primary
            onClick={() => setUpdating(true)}
            disabled={!project.description || !project.goal}
          >
            {latest?.checkpoint === event.currentCheckpoint
              ? 'Submit a new version'
              : 'Share your update'}
            <ArrowRight size={16} />
          </Button>
        </section>
      )}
      <div
        className="d-detail-tabs"
        role="tablist"
        aria-label="Your project views"
      >
        {[
          ['timeline', 'Your timeline'],
          ['ai', 'AI observations'],
          ['feedback', 'Mentor feedback'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="d-panel d-participant-history">
        {tab === 'timeline' && (
          <SubmissionTimeline project={project} event={event} />
        )}
        {tab === 'ai' && (
          <AssessmentView
            event={event}
            evaluation={assessment}
            act={act}
            canRetry
          />
        )}
        {tab === 'feedback' &&
          (event.reviews.length ? (
            event.reviews.map((r) => (
              <article className="d-review-record" key={r.id}>
                <div className="d-row d-between">
                  <strong>{r.mentorName}</strong>
                  <span className="d-time">{relativeTime(r.createdAt)}</span>
                </div>
                <p>{r.note}</p>
                <small>
                  {r.verified
                    ? 'Core workflow observed'
                    : 'Progress conversation'}
                </small>
              </article>
            ))
          ) : (
            <p className="d-inline-empty">
              Your mentor’s observations will appear here after a visit.
            </p>
          ))}
      </section>
      {event.help.some((h) => h.status !== 'resolved') && (
        <section className="d-panel d-participant-help">
          <h2>Your open help requests</h2>
          {event.help
            .filter((h) => h.status !== 'resolved')
            .map((h) => (
              <div key={h.id}>
                <Badge tone={h.status === 'claimed' ? 'green' : 'amber'}>
                  {h.type}
                </Badge>
                <p>{h.note}</p>
                <small>
                  {h.claimedName
                    ? `${h.claimedName} is coming to help.`
                    : 'Waiting for a mentor to pick this up.'}
                </small>
              </div>
            ))}
        </section>
      )}
      {editing && (
        <ProjectEditor
          project={project}
          act={act}
          onClose={() => setEditing(false)}
        />
      )}
      {updating && (
        <UpdateForm
          project={project}
          data={data}
          act={act}
          onClose={() => setUpdating(false)}
        />
      )}
      {helping && <HelpForm act={act} onClose={() => setHelping(false)} />}
    </>
  );
}

function ProjectEditor({
  project,
  act,
  onClose,
}: {
  project: Project;
  act: WorkspaceProps['act'];
  onClose: () => void;
}) {
  const [form, save, clear] = useDraft(`desk-project-${project.id}`, {
    title: project.title,
    tagline: project.tagline,
    description: project.description,
    category: project.category,
    repoUrl: project.repoUrl,
    demoUrl: project.demoUrl,
    preExisting: project.preExisting,
    goal: project.goal,
  });
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => save({ ...form, [key]: value });
  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await act('save-project', form, 'Your project details are saved.');
      clear();
      onClose();
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Tell us what you’re building"
      subtitle="A clear starting point helps everyone give better feedback."
      onClose={onClose}
    >
      <form onSubmit={submit} className="d-form-body">
        <div className="d-form-grid">
          <Field label="Project name">
            <input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              required
              minLength={2}
              maxLength={80}
            />
          </Field>
          <Field label="Category">
            <select
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="In one sentence">
          <input
            value={form.tagline}
            onChange={(e) => set('tagline', e.target.value)}
            maxLength={160}
            placeholder="The problem you’re solving, in plain words."
          />
        </Field>
        <Field label="What is the idea?">
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            required
            minLength={10}
            maxLength={3000}
          />
        </Field>
        <Field label="What should work by the end?">
          <textarea
            rows={2}
            value={form.goal}
            onChange={(e) => set('goal', e.target.value)}
            required
            minLength={5}
            maxLength={1500}
          />
        </Field>
        <Field
          label="Existing work and libraries"
          hint="Declare anything you started before this event. Existing libraries are welcome."
        >
          <textarea
            rows={2}
            value={form.preExisting}
            onChange={(e) => set('preExisting', e.target.value)}
            maxLength={1500}
          />
        </Field>
        <Field
          label="GitHub repository · optional"
          hint="AI can inspect a bounded snapshot of a public GitHub repository."
        >
          <input
            type="url"
            value={form.repoUrl}
            onChange={(e) => set('repoUrl', e.target.value)}
            placeholder="https://github.com/you/project"
          />
        </Field>
        <Field label="Demo URL · optional">
          <input
            type="url"
            value={form.demoUrl}
            onChange={(e) => set('demoUrl', e.target.value)}
            placeholder="https://your-project.example"
          />
        </Field>
        <div className="d-form-actions">
          <span>Draft saved on this device.</span>
          <Button primary type="submit" busy={busy}>
            Save project
            <Check size={15} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function UpdateForm({
  project,
  data,
  act,
  onClose,
}: {
  project: Project;
  data: WorkspaceProps['data'];
  act: WorkspaceProps['act'];
  onClose: () => void;
}) {
  const checkpoint = data.event.currentCheckpoint;
  const [form, save, clear] = useDraft(
    `desk-update-${project.id}-${checkpoint}-${project.submissions.length}`,
    {
      id: crypto.randomUUID(),
      checkpoint,
      changed: '',
      working: '',
      blockers: '',
      evidence: [] as Evidence[],
    },
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [label, setLabel] = useState('');
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError('');
    if (file.size > 2000000) {
      setError('Use an image under 2 MB.');
      setUploading(false);
      return;
    }
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/desk/evidence', { method: 'POST', body });
      const result = (await res.json()) as Evidence & { error?: string };
      if (!res.ok) throw new Error(result.error);
      save({ ...form, evidence: [...form.evidence, result] });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setUploading(false);
    }
  }
  function addLink() {
    try {
      const parsed = new URL(link);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      save({
        ...form,
        evidence: [
          ...form.evidence,
          {
            id: crypto.randomUUID(),
            kind: 'link',
            label: label || parsed.hostname,
            url: parsed.href,
          },
        ],
      });
      setLink('');
      setLabel('');
      setError('');
    } catch {
      setError('Enter a complete http or https link.');
    }
  }
  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await act(
        'submit',
        form,
        'Checkpoint submitted. Your evaluation is queued.',
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
      title={`Checkpoint ${checkpoint + 1} · ${data.event.checkpoints[checkpoint].title}`}
      subtitle="A useful update is brief, specific, and backed by what you can show."
      onClose={onClose}
    >
      <form onSubmit={submit} className="d-form-body">
        <Field label="What changed since your last update?">
          <textarea
            rows={3}
            required
            minLength={10}
            maxLength={3000}
            value={form.changed}
            onChange={(e) => save({ ...form, changed: e.target.value })}
            placeholder="The things you built, learned, or changed direction on."
          />
        </Field>
        <Field label="What works right now?">
          <textarea
            rows={3}
            required
            minLength={10}
            maxLength={3000}
            value={form.working}
            onChange={(e) => save({ ...form, working: e.target.value })}
            placeholder="Be specific about what a mentor can actually try."
          />
        </Field>
        <Field label="Anything blocking you? · optional">
          <textarea
            rows={2}
            maxLength={1500}
            value={form.blockers}
            onChange={(e) => save({ ...form, blockers: e.target.value })}
            placeholder="It’s okay to be stuck. Tell us where."
          />
        </Field>
        <div className="d-field">
          <span>Show your work · optional</span>
          <small>
            Up to 5 evidence items. Screenshots: PNG, JPEG, or WebP, under 2 MB
            each.
          </small>
          <div className="d-uploaded-items">
            {form.evidence.map((item, i) => (
              <div key={item.id}>
                {item.kind === 'image' ? (
                  <ImagePlus size={14} />
                ) : (
                  <LinkIcon size={14} />
                )}
                <span>{item.label}</span>
                <button
                  type="button"
                  className="d-icon-btn"
                  aria-label={`Remove ${item.label}`}
                  onClick={() =>
                    save({
                      ...form,
                      evidence: form.evidence.filter((_, n) => n !== i),
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          {form.evidence.length < 5 && (
            <>
              <div className="d-evidence-link-form">
                <input
                  aria-label="Evidence link label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (e.g. demo recording)"
                  maxLength={100}
                />
                <input
                  aria-label="Evidence URL"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                />
                <Button type="button" onClick={addLink} disabled={!link}>
                  <Plus size={15} />
                  Add
                </Button>
              </div>
              <label
                className={`d-upload-button ${uploading ? 'is-busy' : ''}`}
              >
                <ImagePlus size={16} />
                {uploading ? 'Uploading…' : 'Attach a screenshot'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Attach a screenshot"
                  disabled={
                    uploading ||
                    form.evidence.filter((e) => e.kind === 'image').length >= 3
                  }
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </>
          )}
        </div>
        <div className="d-callout">
          Your update and attached evidence are shared with your event
          evaluators and sent to OpenAI for assessment. Keep secrets and
          personal data out of submissions.
        </div>
        {error && (
          <p className="d-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="d-form-actions">
          <span>Draft saved on this device.</span>
          <Button primary type="submit" busy={busy} disabled={uploading}>
            Submit checkpoint
            <Send size={14} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function HelpForm({
  act,
  onClose,
}: {
  act: WorkspaceProps['act'];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="A fresh pair of eyes?"
      subtitle="Tell the mentors what would help you move forward."
      onClose={onClose}
    >
      <form
        className="d-form-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const args = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          try {
            await act('help', args, 'Your help request is on the mentor desk.');
            onClose();
          } catch {
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="What kind of help?">
          <select name="type">
            {[
              'Software',
              'AI',
              'Design',
              'Hardware',
              'Idea refinement',
              'Other',
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="What’s getting in your way?">
          <textarea
            name="note"
            required
            minLength={5}
            maxLength={1500}
            rows={4}
            placeholder="A little context helps the right person find you."
          />
        </Field>
        <Button primary type="submit" busy={busy}>
          Ask the room
          <ArrowRight size={15} />
        </Button>
      </form>
    </Modal>
  );
}
