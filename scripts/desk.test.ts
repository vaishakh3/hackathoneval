import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { act, login, register, stateFor } from '../lib/desk/service';
import {
  db,
  eventUsers,
  getEvent,
  makeSession,
  mutateEvent,
  sessionUser,
  endSession,
} from '../lib/desk/store';
import {
  csvCell,
  queueFor,
  rankedSignals,
  signals,
  shortlistProblems,
  totalScore,
  validReviews,
} from '../lib/desk/domain';
import { repositorySources, safeAiError } from '../lib/desk/ai';
import { seedDemo } from '../lib/desk/demo';
import type { Assessment, User } from '../lib/desk/types';
const directory = mkdtempSync(join(tmpdir(), 'build-desk-tests-'));
const remote = process.env.DESK_TEST_POSTGRES === '1';
if (remote) {
  assert.ok(
    process.env.DATABASE_URL &&
      /^desk_test_[a-z0-9_]+$/.test(process.env.DESK_DB_SCHEMA || ''),
    'Remote tests require a disposable desk_test_ schema.',
  );
} else process.env.DESK_DB_PATH = join(directory, 'test.sqlite');
after(async () => {
  if (remote)
    await db().exec(`DROP SCHEMA "${process.env.DESK_DB_SCHEMA}" CASCADE`);
  await db().close();
  rmSync(directory, { recursive: true, force: true });
});
const password = 'test-password-for-local-fixtures';
void test('100-project event: registration → immutable evidence → independent reviews → approved shortlist', async (t) => {
  const organizer = await register(
    {
      name: 'Test Organizer',
      email: 'organizer@example.invalid',
      password,
      eventName: 'Test Build Night',
    },
    'create',
  );
  let event = await getEvent(organizer.eventId);
  const builders: User[] = [];
  await t.test(
    'venue-sized registration, invite roles, capacity, and sessions',
    async () => {
      for (let offset = 0; offset < 100; offset += 10) {
        builders.push(
          ...(await Promise.all(
            Array.from({ length: 10 }, (_, n) =>
              register(
                {
                  name: `Test Builder ${offset + n + 1}`,
                  email: `builder${offset + n}@example.invalid`,
                  password,
                  code: event.participantCode,
                  role: 'organizer',
                },
                'join',
              ),
            ),
          )),
        );
      }
      assert.equal(builders.length, 100);
      assert.equal(builders[0].role, 'participant');
      await assert.rejects(
        register(
          {
            name: 'Overflow',
            email: 'overflow@example.invalid',
            password,
            code: event.participantCode,
          },
          'join',
        ),
        /capacity/,
      );
      assert.equal((await getEvent(event.id)).projects.length, 100);
      const token = await makeSession(builders[0].id);
      assert.equal((await sessionUser(token))?.id, builders[0].id);
      await endSession(token);
      assert.equal(await sessionUser(token), null);
      assert.equal(
        (await login({ email: builders[0].email, password })).id,
        builders[0].id,
      );
      await assert.rejects(
        login({ email: builders[0].email, password: 'incorrect' }),
        /incorrect/,
      );
      await assert.rejects(
        register(
          {
            name: 'Intruder',
            email: 'bad@example.invalid',
            password,
            code: 'not-an-invite',
          },
          'join',
        ),
        /not found/,
      );
    },
  );
  const mentors: User[] = [];
  for (let i = 0; i < 3; i++)
    mentors.push(
      await register(
        {
          name: `Test Mentor ${i + 1}`,
          email: `mentor${i}@example.invalid`,
          password,
          code: event.mentorCode,
        },
        'join',
      ),
    );
  await t.test(
    'check-in facts, lock ownership, conflict and role enforcement',
    async () => {
      await act(builders[0], 'save-project', {
        title: 'Checkpoint Journal',
        tagline: 'Make small progress visible.',
        description: 'A journal that stores timestamped progress notes.',
        category: 'AI & tools',
        repoUrl: '',
        demoUrl: '',
        preExisting: 'A blank project.',
        goal: 'Save and retrieve a note.',
      });
      const submissionId = randomUUID();
      await act(builders[0], 'submit', {
        id: submissionId,
        checkpoint: 0,
        changed: 'Mapped the first input and output flow.',
        working: 'A basic local interface is visible.',
        blockers: '',
        evidence: [],
      });
      const project = (await getEvent(event.id)).projects[0];
      await act(mentors[0], 'claim-review', { projectId: project.id });
      await assert.rejects(
        async () =>
          await act(mentors[1], 'claim-review', { projectId: project.id }),
        /Another mentor/,
      );
      await assert.rejects(
        async () =>
          await act(builders[0], 'shortlist', {
            projectId: project.id,
            selected: true,
            reason: 'Forged organizer action',
          }),
        /Organizer/,
      );
      await assert.rejects(
        async () =>
          await act(mentors[1], 'review', {
            projectId: project.id,
            submissionId,
            kind: 'check-in',
            scores: {},
            note: 'A fabricated unlocked review.',
            verified: false,
            recommendation: 'maybe',
          }),
        /lock/,
      );
      await act(mentors[0], 'review', {
        projectId: project.id,
        submissionId,
        kind: 'check-in',
        scores: {},
        note: 'Focus on saving the note and showing it after reload.',
        verified: false,
        recommendation: 'maybe',
      });
      await assert.rejects(
        async () =>
          await act(mentors[0], 'claim-review', { projectId: project.id }),
        /reason/,
      );
      await act(builders[0], 'help', {
        type: 'Software',
        note: 'Need help persisting notes after a reload.',
      });
      const help = (await getEvent(event.id)).help[0];
      await act(mentors[0], 'help-status', { id: help.id, status: 'claimed' });
      await assert.rejects(
        async () =>
          await act(mentors[1], 'help-status', {
            id: help.id,
            status: 'claimed',
          }),
        /already claimed/,
      );
      await assert.rejects(
        async () =>
          await act(mentors[1], 'help-status', {
            id: help.id,
            status: 'resolved',
          }),
        /assigned mentor/,
      );
      await act(mentors[0], 'help-status', { id: help.id, status: 'resolved' });
    },
  );
  await mutateEvent(event.id, (e) => {
    e.currentCheckpoint = 2;
    e.stage = 'final-review';
    e.shortlistTarget = 5;
  });
  await t.test(
    'all 100 final submissions preserve snapshots and deduplicate retries',
    async () => {
      for (const [i, builder] of builders.entries()) {
        await act(builder, 'save-project', {
          title: `Project ${i + 1}`,
          tagline: 'A focused local prototype.',
          description:
            'A project for capturing and retrieving timestamped notes.',
          category: 'AI & tools',
          repoUrl: '',
          demoUrl: '',
          preExisting: 'No existing project.',
          goal: 'Save and retrieve notes after reload.',
        });
        const args = {
          id: randomUUID(),
          checkpoint: 2,
          changed: 'Added persistent note storage and an input form.',
          working: 'Notes survive reload in the local demo.',
          blockers: '',
          evidence: [],
        };
        await act(builder, 'submit', args);
        if (i === 0) await act(builder, 'submit', args);
      }
      event = await getEvent(event.id);
      assert.equal(event.projects.length, 100);
      assert.equal(event.evaluations.length, 101);
      assert.equal(event.projects[0].submissions.length, 2);
      assert.equal(
        event.projects[0].submissions[0].projectSnapshot?.title,
        'Checkpoint Journal',
      );
      assert.equal(
        event.projects[0].submissions[1].projectSnapshot?.title,
        'Project 1',
      );
      const mine = await stateFor(builders[0]);
      assert.equal(mine.event.projects.length, 1);
      assert.equal(mine.event.projects[0].ownerId, builders[0].id);
      assert.equal(mine.event.mentorCode, '');
      assert.deepEqual(mine.event.audit, []);
      await act(builders[0], 'save-project', {
        ...event.projects[0],
        title: 'Unsubmitted draft',
        tagline: 'Still being edited.',
      });
      assert.equal(
        (await stateFor(builders[0])).event.projects[0].title,
        'Unsubmitted draft',
      );
      assert.equal(
        (await stateFor(mentors[0])).event.projects[0].title,
        'Project 1',
      );
      assert.equal(
        (await stateFor(organizer)).event.projects[0].tagline,
        'A focused local prototype.',
      );
      await act(builders[0], 'save-project', event.projects[0]);
    },
  );
  const first = (await getEvent(event.id)).projects[0];
  const assessment: Assessment = {
    summary: 'Synthetic test assessment.',
    progress: 'Notes now persist.',
    strengths: ['Focused scope'],
    unknowns: ['Runtime not tested by AI'],
    questions: ['Show reload'],
    readiness: 'partial',
    criteria: event.rubric.map((c) => ({
      id: c.id,
      score: c.id === 'functionality' ? null : 4,
      reasoning: 'Evidence is incomplete.',
      evidenceIds: ['update'],
    })),
  };
  await mutateEvent(event.id, (e) => {
    const job = e.evaluations.find(
      (j) => j.submissionId === first.submissions.at(-1)!.id,
    )!;
    job.status = 'completed';
    job.assessment = assessment;
  });
  await t.test(
    'AI stays hidden until an independent review; unknowns are not zeroes',
    async () => {
      const before = (await stateFor(mentors[1])).event.evaluations.find(
        (j) => j.submissionId === first.submissions.at(-1)!.id,
      )!;
      assert.equal(before.assessment, undefined);
      assert.deepEqual(before.sources, []);
      assert.equal(signals(await getEvent(event.id))[0].aiScore, null);
      assert.equal(
        totalScore(
          { functionality: null, fit: 4, execution: 4, originality: 4 },
          event.rubric,
        ),
        null,
      );
    },
  );
  async function review(user: User, index: number, value = 4) {
    const p = (await getEvent(event.id)).projects[index];
    await act(user, 'claim-review', {
      projectId: p.id,
      reason:
        'Independent final verification after an earlier progress conversation.',
    });
    await act(user, 'review', {
      projectId: p.id,
      submissionId: p.submissions.at(-1)!.id,
      kind: 'final',
      scores: Object.fromEntries(event.rubric.map((c) => [c.id, value])),
      note: 'Observed a new note persist after reloading the application.',
      verified: true,
      recommendation: 'yes',
    });
  }
  await t.test(
    'complete human coverage, independent finalist reviews, and approval gate',
    async () => {
      for (let i = 0; i < 100; i++) await review(mentors[1], i, i < 5 ? 5 : 3);
      assert.ok(
        (await stateFor(mentors[1])).event.evaluations.find(
          (j) => j.submissionId === first.submissions.at(-1)!.id,
        )?.assessment,
      );
      assert.equal(
        signals(await getEvent(event.id)).filter((s) => s.humanScore != null)
          .length,
        100,
      );
      for (let i = 0; i < 5; i++)
        await act(organizer, 'shortlist', {
          projectId: (await getEvent(event.id)).projects[i].id,
          selected: true,
          reason: 'Demonstrated a complete workflow and strong execution.',
        });
      await assert.rejects(
        async () => await act(organizer, 'approve', {}),
        /two independent/,
      );
      for (let i = 0; i < 5; i++) await review(mentors[0], i, 4);
      assert.deepEqual(shortlistProblems(await getEvent(event.id)), []);
      await act(organizer, 'approve', {});
      assert.equal((await getEvent(event.id)).stage, 'shortlisted');
      await assert.rejects(
        async () => await act(builders[0], 'save-project', {}),
        /locked/,
      );
      await assert.rejects(
        async () =>
          await act(organizer, 'shortlist', {
            projectId: first.id,
            selected: false,
            reason: '',
          }),
        /locked/,
      );
      assert.equal(
        (await stateFor(builders[0])).event.projects[0].shortlisted,
        true,
      );
    },
  );
  await t.test(
    'late conflicts invalidate scores and reopen an affected approved lineup',
    async () => {
      await act(mentors[0], 'conflict', {
        projectId: first.id,
        reason: 'I helped implement this project.',
      });
      const current = await getEvent(event.id);
      assert.equal(current.stage, 'final-review');
      assert.equal(current.approvedAt, undefined);
      assert.equal(validReviews(current, current.projects[0]).length, 1);
      await assert.rejects(
        async () =>
          await act(mentors[0], 'claim-review', {
            projectId: first.id,
            reason: 'Override conflict',
          }),
        /conflict/,
      );
      await review(mentors[2], 0, 4);
      await act(organizer, 'approve', {});
      await act(organizer, 'reopen', {
        reason: 'One last independent evidence check.',
      });
      assert.equal((await getEvent(event.id)).stage, 'final-review');
    },
  );
  await t.test(
    'a new submission invalidates old scores without erasing history',
    async () => {
      const old = (await getEvent(event.id)).projects[0].submissions.at(-1)!;
      await act(builders[0], 'submit', {
        id: randomUUID(),
        checkpoint: 2,
        changed: 'Added keyboard shortcuts and clearer save errors.',
        working: 'The revised note flow also handles empty inputs.',
        blockers: '',
        evidence: [],
      });
      const current = await getEvent(event.id);
      assert.equal(current.projects[0].submissions.length, 3);
      assert.equal(validReviews(current, current.projects[0]).length, 0);
      assert.ok(current.reviews.some((r) => r.submissionId === old.id));
      assert.ok(shortlistProblems(current).length > 0);
      const ordered = rankedSignals(current);
      assert.ok(ordered.findIndex((s) => s.project.id === first.id) > 0);
    },
  );
});
void test('sample event is isolated, fictional, and cannot spend the real AI key', async () => {
  const { event, organizer } = await seedDemo();
  const other = await seedDemo();
  assert.notEqual(event.id, other.event.id);
  assert.equal(event.projects.length, 100);
  assert.ok(event.evaluations.every((e) => e.sample));
  const builder = (await eventUsers(event.id)).find(
    (u) => u.role === 'participant',
  )!;
  const latest = event.projects[0].submissions.at(-1)!;
  await act(builder, 'submit', {
    id: randomUUID(),
    checkpoint: 2,
    changed: 'Trying an isolated fictional checkpoint submission.',
    working: 'A fictional preview of the checkpoint workflow.',
    blockers: '',
    evidence: [],
  });
  const next = (await getEvent(event.id)).evaluations.at(-1)!;
  assert.equal(next.status, 'failed');
  assert.equal(next.sample, true);
  await assert.rejects(
    async () => await act(organizer, 'retry-ai', { evaluationId: next.id }),
    /Sample assessments/,
  );
  assert.equal(
    other.event.projects[0].submissions.at(-1)!.id === latest.id,
    false,
  );
});
void test('mentor queue uses complete coverage signals while keeping independent ratings hidden', async () => {
  const { event } = await seedDemo();
  const mentor = (await eventUsers(event.id)).find((u) => u.role === 'mentor')!;
  const state = await stateFor(mentor);
  assert.deepEqual(
    state.reviewQueue,
    queueFor(event, mentor.id).map((s) => s.project.id),
  );
  assert.ok(
    state.event.reviews
      .filter((r) => r.mentorId !== mentor.id)
      .every((r) => Object.keys(r.scores).length === 0 && r.note === ''),
  );
  const firstQueue = queueFor(event, mentor.id)
    .slice(0, 8)
    .map((s) => s.project.id);
  const otherMentor = (await eventUsers(event.id)).filter(
    (u) => u.role === 'mentor',
  )[1];
  assert.notDeepEqual(
    firstQueue,
    queueFor(event, otherMentor.id)
      .slice(0, 8)
      .map((s) => s.project.id),
  );
});
void test('event templates reuse only setup, with fresh invitations and a validated relative schedule', async () => {
  const template = {
    version: 1,
    theme: 'Useful tools for the city',
    venue: 'Kochi',
    shortlistTarget: 6,
    durationMinutes: 360,
    checkpoints: [
      { title: 'Direction', offsetMinutes: 60 },
      { title: 'Progress', offsetMinutes: 240 },
      { title: 'Final build', offsetMinutes: 360 },
    ],
    weights: [40, 25, 20, 15],
  };
  const account = {
    name: 'Template Organizer',
    email: 'template@example.invalid',
    password,
    eventName: 'Devin Hacks Kochi',
    template,
  };
  const organizer = await register(account, 'create');
  const event = await getEvent(organizer.eventId);
  assert.equal(event.name, 'Devin Hacks Kochi');
  assert.equal(event.projects.length, 0);
  assert.equal(event.shortlistTarget, 6);
  assert.equal(event.currentCheckpoint, 0);
  assert.equal(event.stage, 'building');
  assert.equal(
    Date.parse(event.checkpoints[2].dueAt) - Date.parse(event.startsAt),
    360 * 60000,
  );
  const other = await register(
    { ...account, email: 'template2@example.invalid' },
    'create',
  );
  assert.notEqual(
    (await getEvent(other.eventId)).participantCode,
    event.participantCode,
  );
  await assert.rejects(
    register(
      {
        ...account,
        email: 'invalid-template@example.invalid',
        template: { ...template, weights: [40, 25, 20, 20] },
      },
      'create',
    ),
    /invalid/,
  );
});
void test('export escaping, source URL restrictions, and safe provider errors', async () => {
  assert.equal(csvCell('=HYPERLINK("example")'), '"\'=HYPERLINK(""example"")"');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(
    (await repositorySources('http://127.0.0.1:3000/secret'))[0].id,
    'repo-unavailable',
  );
  assert.equal(
    (await repositorySources('https://github.com.evil.invalid/a/b'))[0].id,
    'repo-unavailable',
  );
  const message = safeAiError({
    statusCode: 401,
    message: 'DO NOT EXPOSE THIS PROVIDER PAYLOAD',
  });
  assert.ok(!message.includes('PAYLOAD'));
  assert.match(message, /authenticate/);
});
