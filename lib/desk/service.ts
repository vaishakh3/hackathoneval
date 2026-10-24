import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { addAudit, queueFor, shortlistProblems } from './domain';
import { newEvent } from './demo';
import {
  db,
  getEvent,
  insertEvent,
  insertUser,
  findUser,
  hashPassword,
  checkPassword,
  mutateEvent,
  requireThat,
  eventUsers,
  DeskError,
  transaction,
  getParticipantEvent,
} from './store';
import type {
  DeskEvent,
  DeskState,
  Project,
  User,
  Evaluation,
  Role,
} from './types';
import { CATEGORIES } from './types';
const text = (max = 2000) => z.string().trim().max(max);
const url = z
  .union([z.literal(''), z.url().max(1000)])
  .refine(
    (v) => !v || ['https:', 'http:'].includes(new URL(v).protocol),
    'Use an http or https URL.',
  );
const accountSchema = z.object({
  name: text(80).min(2),
  email: z
    .email()
    .max(200)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
});
const id = z.uuid();
const now = () => new Date().toISOString();
const templateSchema = z
  .object({
    version: z.literal(1),
    theme: text(600),
    venue: text(120),
    shortlistTarget: z.number().int().min(5).max(10),
    durationMinutes: z.number().int().min(15).max(10080),
    checkpoints: z
      .array(
        z.object({
          title: text(60).min(3),
          offsetMinutes: z.number().int().positive(),
        }),
      )
      .length(3),
    weights: z.array(z.number().int().min(1).max(97)).length(4),
  })
  .refine(
    (t) =>
      t.weights.reduce((a, b) => a + b, 0) === 100 &&
      t.checkpoints.every(
        (c, i) =>
          c.offsetMinutes <= t.durationMinutes &&
          (!i || c.offsetMinutes > t.checkpoints[i - 1].offsetMinutes),
      ),
    'Template schedule or rubric is invalid.',
  );
export async function register(
  args: unknown,
  mode: 'create' | 'join',
): Promise<User> {
  const data = accountSchema
    .extend({
      eventName: text(100).optional(),
      code: text(80).optional(),
      template: templateSchema.optional(),
      organizerCode: text(200).optional(),
    })
    .parse(args);
  if (mode === 'create' && process.env.NODE_ENV === 'production') {
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    requireThat(
      process.env.ORGANIZER_SETUP_CODE &&
        timingSafeEqual(
          digest(data.organizerCode || ''),
          digest(process.env.ORGANIZER_SETUP_CODE),
        ),
      'Enter the organizer access code provided by the deployment owner.',
      403,
    );
  }
  requireThat(
    !(await findUser(data.email)),
    'An account with this email already exists. Sign in instead.',
  );
  const password = await hashPassword(data.password);
  let event: DeskEvent;
  let role: Role;
  if (mode === 'create') {
    requireThat(
      data.eventName && data.eventName.length >= 3,
      'Give your event a name.',
    );
    event = newEvent(data.eventName);
    if (data.template) {
      const template = data.template;
      event.theme = template.theme;
      event.venue = template.venue;
      event.shortlistTarget = template.shortlistTarget;
      event.endsAt = new Date(
        Date.parse(event.startsAt) + template.durationMinutes * 60000,
      ).toISOString();
      event.checkpoints = template.checkpoints.map((c) => ({
        title: c.title,
        dueAt: new Date(
          Date.parse(event.startsAt) + c.offsetMinutes * 60000,
        ).toISOString(),
      }));
      event.rubric.forEach((c, i) => {
        c.weight = template.weights[i];
      });
    }
    role = 'organizer';
  } else {
    const rows = (await db().prepare('SELECT data FROM events').all()) as {
      data: string;
    }[];
    const code = data.code?.toUpperCase();
    const match = rows
      .map((r) => JSON.parse(r.data) as DeskEvent)
      .find(
        (e) => !e.demo && (e.participantCode === code || e.mentorCode === code),
      );
    requireThat(
      match,
      'That invite code was not found. Check it with your organizer.',
    );
    event = match;
    role = code === event.mentorCode ? 'mentor' : 'participant';
    requireThat(
      event.stage !== 'shortlisted',
      'Registration has closed for this event.',
    );
  }
  const user: User = {
    id: randomUUID(),
    eventId: event.id,
    role,
    name: data.name,
    email: data.email,
    skills: [],
  };
  await transaction(async () => {
    if (mode === 'create') await insertEvent(event);
    else event = await getEvent(event.id);
    requireThat(event.stage !== 'shortlisted', 'Registration has closed.');
    if (role === 'participant')
      requireThat(
        event.projects.length < event.capacity,
        'This event has reached its participant capacity.',
      );
    await insertUser(user, password);
    if (role === 'participant')
      event.projects.push({
        id: randomUUID(),
        ownerId: user.id,
        participantName: user.name,
        number: event.projects.length + 1,
        title: 'Your next big idea',
        tagline: '',
        description: '',
        category: 'Other',
        repoUrl: '',
        demoUrl: '',
        preExisting: '',
        goal: '',
        color: '#2563eb',
        createdAt: now(),
        submissions: [],
        shortlisted: false,
        shortlistReason: '',
        needsReview: false,
      });
    addAudit(
      event,
      user.name,
      role === 'organizer' ? 'Created the event.' : `Joined as a ${role}.`,
    );
    event.revision++;
    await db()
      .prepare('UPDATE events SET data=? WHERE id=?')
      .run(JSON.stringify(event), event.id);
  }, `event:${event.id}`);
  return user;
}
export async function login(args: unknown) {
  const data = z
    .object({
      email: z.email().transform((v) => v.toLowerCase()),
      password: z.string().max(128),
    })
    .parse(args);
  const found = await findUser(data.email);
  // Equalize the expensive path for unknown accounts.
  const valid = await checkPassword(
    data.password,
    found?.password || '00000000000000000000000000000000:' + '00'.repeat(64),
  );
  requireThat(found && valid, 'Email or password is incorrect.', 401);
  return found.user;
}
export async function stateFor(user: User): Promise<DeskState> {
  const event =
    user.role === 'participant'
      ? await getParticipantEvent(user.eventId, user.id)
      : await getEvent(user.eventId);
  const reviewQueue =
    user.role === 'mentor'
      ? queueFor(event, user.id).map((s) => s.project.id)
      : [];
  // Evaluators see the submitted version. Unsubmitted participant edits belong to the next checkpoint.
  if (user.role !== 'participant')
    event.projects = event.projects.map((p) => ({
      ...p,
      ...p.submissions.at(-1)?.projectSnapshot,
    }));
  const mentors = (await eventUsers(event.id))
    .filter((u) => u.role === 'mentor')
    .map(({ id, name, skills }) => ({ id, name, skills }));
  if (user.role !== 'organizer') {
    delete event.githubTracker;
    event.participantCode = '';
    event.mentorCode = '';
    event.audit = [];
    if (user.role === 'participant') {
      const mine = event.projects
        .filter((p) => p.ownerId === user.id)
        .map((p) => ({
          ...p,
          shortlistReason: event.approvedAt ? p.shortlistReason : '',
          shortlisted: !!event.approvedAt && p.shortlisted,
        }));
      const mineIds = new Set(mine.map((p) => p.id));
      event.projects = mine;
      event.evaluations = event.evaluations.filter((e) =>
        mineIds.has(e.projectId),
      );
      event.reviews = event.reviews
        .filter((r) => mineIds.has(r.projectId))
        .map((r) => ({ ...r, scores: {}, recommendation: 'maybe' }));
      event.help = event.help.filter((h) => mineIds.has(h.projectId));
      event.conflicts = [];
      event.locks = [];
    } else {
      event.reviews = event.reviews
        .filter(
          (r) =>
            r.mentorId === user.id ||
            !event.conflicts.some(
              (c) => c.projectId === r.projectId && c.mentorId === r.mentorId,
            ),
        )
        .map((r) =>
          r.mentorId === user.id
            ? r
            : {
                ...r,
                scores: {},
                recommendation: 'maybe',
                note: '',
                verified: false,
              },
        );
      event.evaluations = event.evaluations.map((e) =>
        event.reviews.some(
          (r) => r.mentorId === user.id && r.submissionId === e.submissionId,
        )
          ? e
          : { ...e, assessment: undefined, sources: [] },
      );
      event.projects = event.projects.map((p) => ({
        ...p,
        shortlistReason: '',
        shortlisted: false,
      }));
      event.conflicts = event.conflicts.filter((c) => c.mentorId === user.id);
    }
  }
  return {
    user,
    event,
    mentors,
    aiConfigured: !!process.env.OPENAI_API_KEY,
    serverTime: now(),
    reviewQueue,
  };
}
function organizer(user: User) {
  requireThat(user.role === 'organizer', 'Organizer access is required.', 403);
}
function editable(event: DeskEvent) {
  requireThat(
    event.stage !== 'shortlisted',
    'The shortlist is locked. Ask the organizer to reopen it.',
  );
}
function ownProject(event: DeskEvent, user: User): Project {
  const project = event.projects.find((p) => p.ownerId === user.id);
  requireThat(
    user.role === 'participant' && project,
    'This project is not yours.',
    403,
  );
  return project;
}
function projectById(event: DeskEvent, projectId: string) {
  const project = event.projects.find((p) => p.id === projectId);
  requireThat(project, 'Project not found.', 404);
  return project;
}
export function queueEvaluation(
  event: DeskEvent,
  project: Project,
  submissionId: string,
) {
  const submission = project.submissions.find((s) => s.id === submissionId)!;
  const job: Evaluation = {
    id: randomUUID(),
    projectId: project.id,
    submissionId,
    checkpoint: submission.checkpoint,
    status: 'queued',
    attempts: 0,
    createdAt: now(),
    model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
    promptVersion: 'desk-v1',
    rubric: structuredClone(event.rubric),
    sources: [],
  };
  if (event.demo)
    Object.assign(job, {
      status: 'failed',
      sample: true,
      error:
        'Sample event: live AI is disabled. Create your event to evaluate real evidence.',
    });
  event.evaluations.push(job);
}
export async function act(
  user: User,
  action: string,
  args: unknown,
): Promise<{
  queued?: boolean;
  [key: string]: unknown;
}> {
  return await mutateEvent(user.eventId, async (event) => {
    if (action === 'save-project') {
      editable(event);
      const data = z
        .object({
          title: text(80).min(2),
          tagline: text(160),
          description: text(3000).min(10),
          category: z.enum(CATEGORIES),
          repoUrl: url,
          demoUrl: url,
          preExisting: text(1500),
          goal: text(1500).min(5),
        })
        .parse(args);
      const project = ownProject(event, user);
      Object.assign(project, data);
      addAudit(event, user.name, `Updated ${project.title}’s project details.`);
    } else if (action === 'submit') {
      editable(event);
      const data = z
        .object({
          id,
          checkpoint: z.number().int().min(0).max(2),
          changed: text(3000).min(10),
          working: text(3000).min(10),
          blockers: text(1500),
          evidence: z
            .array(
              z.object({
                id: text(100),
                kind: z.enum(['link', 'image']),
                label: text(100).min(1),
                url: text(1000),
              }),
            )
            .max(5),
        })
        .parse(args);
      const project = ownProject(event, user);
      if (project.submissions.some((s) => s.id === data.id)) return {};
      requireThat(
        !event.projects.some((p) =>
          p.submissions.some((s) => s.id === data.id),
        ),
        'Submission ID already used.',
      );
      requireThat(
        data.checkpoint === event.currentCheckpoint,
        'The checkpoint changed. Refresh and submit the current checkpoint.',
      );
      requireThat(
        Date.now() >= Date.parse(event.startsAt),
        'The event has not started yet.',
      );
      requireThat(
        Date.now() <= Date.parse(event.checkpoints[data.checkpoint].dueAt),
        'This checkpoint has closed. Ask your organizer to reopen it.',
      );
      requireThat(
        project.description.length >= 10 && project.goal.length >= 5,
        'Save your project details before submitting a checkpoint.',
      );
      for (const evidence of data.evidence) {
        if (evidence.kind === 'image') {
          const file = await db()
            .prepare(
              'SELECT id FROM files WHERE id=? AND project_id=? AND event_id=?',
            )
            .get(evidence.id, project.id, event.id);
          requireThat(
            file && evidence.url === `/api/desk/evidence?id=${evidence.id}`,
            'Image does not belong to your project.',
          );
        } else {
          url.parse(evidence.url);
          requireThat(!!evidence.url, 'Add a valid evidence link.');
        }
      }
      project.submissions.push({
        ...data,
        submittedAt: now(),
        projectSnapshot: {
          title: project.title,
          tagline: project.tagline,
          category: project.category,
          description: project.description,
          goal: project.goal,
          preExisting: project.preExisting,
          repoUrl: project.repoUrl,
          demoUrl: project.demoUrl,
        },
      });
      queueEvaluation(event, project, data.id);
      addAudit(
        event,
        user.name,
        `Submitted ${project.title} · ${event.checkpoints[data.checkpoint].title}.`,
      );
      return { queued: true };
    } else if (action === 'claim-review' || action === 'release-review') {
      requireThat(user.role === 'mentor', 'Mentor access is required.', 403);
      editable(event);
      const data = z
        .object({ projectId: id, reason: text(300).optional() })
        .parse(args);
      const project = projectById(event, data.projectId);
      event.locks = event.locks.filter(
        (l) => Date.parse(l.expiresAt) > Date.now(),
      );
      if (action === 'release-review') {
        event.locks = event.locks.filter(
          (l) => l.projectId !== project.id || l.mentorId !== user.id,
        );
        return {};
      }
      requireThat(
        project.submissions.length,
        'This project has not submitted an update.',
      );
      requireThat(
        !event.conflicts.some(
          (c) => c.projectId === project.id && c.mentorId === user.id,
        ),
        'You declared a conflict with this project.',
      );
      requireThat(
        !event.locks.some(
          (l) => l.projectId === project.id && l.mentorId !== user.id,
        ),
        'Another mentor is reviewing this project. Try the next project.',
        409,
      );
      const existing = event.locks.find(
        (l) => l.projectId === project.id && l.mentorId === user.id,
      );
      const seen = event.reviews.some(
        (r) => r.projectId === project.id && r.mentorId === user.id,
      );
      requireThat(
        existing || !seen || data.reason?.trim(),
        'You have reviewed this project before. Add a reason to revisit it.',
      );
      if (existing)
        existing.expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
      else {
        event.locks = event.locks.filter((l) => l.mentorId !== user.id);
        event.locks.push({
          projectId: project.id,
          mentorId: user.id,
          expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
        });
        if (seen)
          addAudit(
            event,
            user.name,
            `Revisited ${project.title}: ${data.reason}`,
          );
      }
    } else if (action === 'review') {
      requireThat(user.role === 'mentor', 'Mentor access is required.', 403);
      editable(event);
      const data = z
        .object({
          projectId: id,
          submissionId: id,
          kind: z.enum(['check-in', 'final']),
          scores: z.record(z.string(), z.number().int().min(0).max(5)),
          note: text(3000).min(10),
          verified: z.boolean(),
          recommendation: z.enum(['yes', 'maybe', 'no']),
        })
        .parse(args);
      const project = projectById(event, data.projectId);
      requireThat(
        !event.conflicts.some(
          (c) => c.projectId === project.id && c.mentorId === user.id,
        ),
        'You cannot review a project with a declared conflict.',
        403,
      );
      requireThat(
        project.submissions.at(-1)?.id === data.submissionId,
        'A newer update arrived. Refresh and review that version.',
        409,
      );
      requireThat(
        data.kind === (event.stage === 'building' ? 'check-in' : 'final'),
        'The event stage changed. Refresh before reviewing.',
        409,
      );
      requireThat(
        data.kind !== 'final' || project.submissions.at(-1)?.checkpoint === 2,
        'Final scoring needs a final checkpoint submission.',
      );
      requireThat(
        event.locks.some(
          (l) =>
            l.projectId === project.id &&
            l.mentorId === user.id &&
            Date.parse(l.expiresAt) > Date.now(),
        ),
        'Your review lock expired. Start the review again.',
        409,
      );
      requireThat(
        !event.reviews.some(
          (r) =>
            r.mentorId === user.id &&
            r.submissionId === data.submissionId &&
            r.kind === data.kind,
        ),
        'You already reviewed this version.',
      );
      if (data.kind === 'final')
        requireThat(
          event.rubric.every((c) => data.scores[c.id] != null),
          'Score every criterion before submitting.',
        );
      event.reviews.push({
        ...data,
        id: randomUUID(),
        mentorId: user.id,
        mentorName: user.name,
        checkpoint: project.submissions.at(-1)!.checkpoint,
        scores:
          data.kind === 'final'
            ? Object.fromEntries(
                event.rubric.map((c) => [c.id, data.scores[c.id]]),
              )
            : {},
        createdAt: now(),
      });
      event.locks = event.locks.filter(
        (l) => l.projectId !== project.id || l.mentorId !== user.id,
      );
      project.needsReview = false;
      addAudit(
        event,
        user.name,
        `Completed a ${data.kind === 'final' ? 'final review' : 'check-in'} of ${project.title}.`,
      );
    } else if (action === 'conflict') {
      requireThat(user.role === 'mentor', 'Mentor access is required.', 403);
      const data = z
        .object({ projectId: id, reason: text(300).min(3) })
        .parse(args);
      const project = projectById(event, data.projectId);
      requireThat(
        !event.conflicts.some(
          (c) => c.projectId === project.id && c.mentorId === user.id,
        ),
        'Conflict already recorded.',
      );
      event.conflicts.push({
        mentorId: user.id,
        projectId: project.id,
        reason: data.reason,
      });
      event.locks = event.locks.filter(
        (l) => l.projectId !== project.id || l.mentorId !== user.id,
      );
      // Any earlier scores are excluded by validReviews, including a conflict declared late.
      if (event.approvedAt && project.shortlisted) {
        event.approvedAt = undefined;
        event.stage = 'final-review';
      }
      addAudit(
        event,
        user.name,
        `Declared a conflict for ${project.title}. Earlier ratings are excluded.`,
      );
    } else if (action === 'help') {
      editable(event);
      const data = z
        .object({ type: text(60).min(2), note: text(1500).min(5) })
        .parse(args);
      const project = ownProject(event, user);
      requireThat(
        event.help.filter(
          (h) => h.projectId === project.id && h.status !== 'resolved',
        ).length < 3,
        'You already have three open requests. Update your mentor directly.',
      );
      event.help.push({
        ...data,
        id: randomUUID(),
        projectId: project.id,
        createdAt: now(),
        status: 'open',
      });
      addAudit(
        event,
        user.name,
        `Requested ${data.type.toLowerCase()} help for ${project.title}.`,
      );
    } else if (action === 'help-status') {
      requireThat(
        user.role === 'mentor' || user.role === 'organizer',
        'Mentor access is required.',
        403,
      );
      const data = z
        .object({ id, status: z.enum(['claimed', 'resolved']) })
        .parse(args);
      const help = event.help.find((h) => h.id === data.id);
      requireThat(help, 'Help request not found.', 404);
      requireThat(
        data.status !== 'claimed' ||
          help.status === 'open' ||
          help.claimedBy === user.id,
        'Another mentor has already claimed this request.',
        409,
      );
      requireThat(
        data.status !== 'resolved' ||
          user.role === 'organizer' ||
          help.claimedBy === user.id,
        'Only the assigned mentor can resolve this request.',
        403,
      );
      Object.assign(help, {
        status: data.status,
        claimedBy: user.id,
        claimedName: user.name,
      });
      addAudit(
        event,
        user.name,
        `${data.status === 'claimed' ? 'Picked up' : 'Resolved'} a ${help.type.toLowerCase()} help request.`,
      );
    } else if (action === 'shortlist') {
      organizer(user);
      editable(event);
      const data = z
        .object({ projectId: id, selected: z.boolean(), reason: text(1500) })
        .parse(args);
      const project = projectById(event, data.projectId);
      requireThat(
        !data.selected ||
          project.shortlisted ||
          event.projects.filter((p) => p.shortlisted).length < 10,
        'A shortlist can contain at most 10 demos.',
      );
      project.shortlisted = data.selected;
      project.shortlistReason = data.reason;
      addAudit(
        event,
        user.name,
        `${data.selected ? 'Added' : 'Removed'} ${project.title} ${data.selected ? 'to' : 'from'} the provisional shortlist.`,
      );
    } else if (action === 'second-look') {
      organizer(user);
      editable(event);
      const data = z.object({ projectId: id }).parse(args);
      const project = projectById(event, data.projectId);
      project.needsReview = true;
      addAudit(
        event,
        user.name,
        `Requested an independent second look at ${project.title}.`,
      );
    } else if (action === 'settings') {
      organizer(user);
      editable(event);
      const data = z
        .object({
          name: text(100).min(3),
          theme: text(600),
          venue: text(120),
          shortlistTarget: z.number().int().min(5).max(10),
          currentCheckpoint: z.number().int().min(0).max(2),
          stage: z.enum(['building', 'final-review']),
          startsAt: z.iso.datetime(),
          endsAt: z.iso.datetime(),
          checkpoints: z
            .array(
              z.object({ title: text(60).min(3), dueAt: z.iso.datetime() }),
            )
            .length(3),
          weights: z.array(z.number().int().min(1).max(97)).length(4),
        })
        .parse(args);
      requireThat(
        data.weights.reduce((a, b) => a + b, 0) === 100,
        'Rubric weights must total 100.',
      );
      requireThat(
        Date.parse(data.endsAt) > Date.parse(data.startsAt),
        'Event end must follow its start.',
      );
      requireThat(
        data.checkpoints.every(
          (c, i) =>
            Date.parse(c.dueAt) > Date.parse(data.startsAt) &&
            Date.parse(c.dueAt) <= Date.parse(data.endsAt) &&
            (!i ||
              Date.parse(c.dueAt) > Date.parse(data.checkpoints[i - 1].dueAt)),
        ),
        'Checkpoints must be in order, inside the event schedule.',
      );
      const submitted = event.projects.some((p) => p.submissions.length);
      requireThat(
        !submitted ||
          event.rubric.every((c, i) => c.weight === data.weights[i]),
        'Rubric weights lock after the first submission.',
      );
      const { weights, ...settings } = data;
      Object.assign(event, settings);
      event.rubric.forEach((c, i) => {
        c.weight = weights[i];
      });
      addAudit(
        event,
        user.name,
        `Updated event settings. Active checkpoint: ${data.checkpoints[data.currentCheckpoint].title}.`,
      );
    } else if (action === 'approve') {
      organizer(user);
      requireThat(
        event.stage === 'final-review',
        'Open final review before approving the shortlist.',
      );
      const problems = shortlistProblems(event);
      requireThat(!problems.length, problems.slice(0, 4).join(' '));
      event.stage = 'shortlisted';
      event.approvedAt = now();
      addAudit(
        event,
        user.name,
        `Approved ${event.shortlistTarget} demos for the final judging panel.`,
      );
    } else if (action === 'reopen') {
      organizer(user);
      const data = z.object({ reason: text(600).min(5) }).parse(args);
      event.stage = 'final-review';
      event.approvedAt = undefined;
      addAudit(event, user.name, `Reopened the shortlist: ${data.reason}`);
    } else if (action === 'retry-ai') {
      editable(event);
      const data = z.object({ evaluationId: id }).parse(args);
      const job = event.evaluations.find((e) => e.id === data.evaluationId);
      requireThat(job, 'Evaluation not found.', 404);
      requireThat(
        user.role === 'organizer' ||
          event.projects.some(
            (p) => p.id === job.projectId && p.ownerId === user.id,
          ),
        'You cannot retry this evaluation.',
        403,
      );
      requireThat(
        !event.demo,
        'Sample assessments are illustrative. Create a real event to run AI.',
      );
      requireThat(
        job.status === 'failed' ||
          (job.status === 'running' &&
            Date.now() - Date.parse(job.startedAt || job.createdAt) > 180000),
        'This evaluation is already active or complete.',
      );
      requireThat(
        job.attempts < 4,
        'This evaluation reached the retry limit. Contact the organizer.',
      );
      job.status = 'queued';
      job.error = undefined;
      job.workflowRunId = undefined;
      job.dispatchAt = undefined;
      return { queued: true };
    } else if (action === 'skills') {
      requireThat(user.role === 'mentor', 'Mentor access is required.', 403);
      const data = z.object({ skills: z.array(text(40)).max(8) }).parse(args);
      await db()
        .prepare('UPDATE users SET skills=? WHERE id=?')
        .run(JSON.stringify(data.skills), user.id);
    } else throw new DeskError(404, 'Unknown action.');
    return {};
  });
}
