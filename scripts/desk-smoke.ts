import { deploymentFetch as fetch } from './desk-protected-fetch';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, transaction } from '../lib/desk/store';
import { del } from '@vercel/blob';
const base = process.env.DESK_TEST_URL || 'http://localhost:3000';
const suffix = randomUUID();
const password = `QA-only-${randomUUID()}`;
let eventId: string | undefined;
const users = new Map<string, string>();
async function rpc(who: string, action?: string, args = {}) {
  const response = await fetch(`${base}/api/desk`, {
    method: action ? 'POST' : 'GET',
    headers: {
      ...(action ? { 'Content-Type': 'application/json', Origin: base } : {}),
      Cookie: users.get(who) || '',
    },
    ...(action ? { body: JSON.stringify({ action, args }) } : {}),
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(`Deployment access failed (HTTP ${response.status}).`);
  const body = (await response.json()) as Record<string, unknown> & {
    error?: string;
    event: {
      id: string;
      participantCode: string;
      mentorCode: string;
      projects: {
        id: string;
        submissions: {
          id: string;
        }[];
      }[];
      evaluations: {
        status: string;
        error?: string;
        assessment?: {
          summary: string;
        };
      }[];
    };
    user: {
      role: string;
    } | null;
  };
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error}`);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('build-desk-session='));
  if (cookie) users.set(who, cookie.split(';')[0]);
  return body;
}
try {
  assert.equal((await rpc('none')).user, null);
  const organizer = await rpc('organizer', 'create', {
    name: 'QA Organizer',
    email: `qa-${suffix}@example.invalid`,
    password,
    eventName: `QA ${suffix}`,
    organizerCode: process.env.ORGANIZER_SETUP_CODE,
  });
  eventId = organizer.event.id;
  assert.equal(organizer.user?.role, 'organizer');
  const builder = await rpc('builder', 'join', {
    name: 'QA Builder',
    email: `qa-builder-${suffix}@example.invalid`,
    password,
    code: organizer.event.participantCode,
  });
  assert.equal(builder.user?.role, 'participant');
  assert.equal(builder.event.projects.length, 1);
  const projectId = builder.event.projects[0].id;
  await rpc('builder', 'save-project', {
    title: 'QA Checkpoint Journal',
    tagline: 'A small, testable note-taking tool.',
    description:
      'A journal prototype that stores timestamped notes in browser storage.',
    category: 'AI & tools',
    repoUrl: '',
    demoUrl: '',
    preExisting: 'A new synthetic QA fixture.',
    goal: 'Create a note and show it survives reload.',
  });
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM5sAAAAASUVORK5CYII=',
    'base64',
  );
  const upload = new FormData();
  upload.set(
    'file',
    new File([pixel], 'qa-evidence.png', { type: 'image/png' }),
  );
  const uploaded = await fetch(`${base}/api/desk/evidence`, {
    method: 'POST',
    headers: { Origin: base, Cookie: users.get('builder')! },
    body: upload,
  });
  assert.equal(uploaded.status, 200);
  const evidence = (await uploaded.json()) as { url: string };
  const image = await fetch(`${base}${evidence.url}`, {
    headers: { Cookie: users.get('builder')! },
  });
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), pixel);
  assert.equal((await fetch(`${base}${evidence.url}`)).status, 401);
  await rpc('other-builder', 'join', {
    name: 'QA Other Builder',
    email: `qa-other-${suffix}@example.invalid`,
    password,
    code: organizer.event.participantCode,
  });
  assert.equal(
    (
      await fetch(`${base}${evidence.url}`, {
        headers: { Cookie: users.get('other-builder')! },
      })
    ).status,
    403,
  );
  console.log(
    '✓ Private evidence upload persists, authenticated retrieval works, and other participants are denied',
  );
  const submissionId = randomUUID();
  const submitted = await rpc('builder', 'submit', {
    id: submissionId,
    checkpoint: 0,
    changed:
      'Built a basic note input, local persistence, and a list of saved notes.',
    working:
      'The author reports that notes survive a reload. No screenshot or runtime verification is supplied.',
    blockers: 'Keyboard navigation still needs testing.',
    evidence: [],
  });
  assert.equal(
    submitted.event.projects[0].submissions.at(-1)?.id,
    submissionId,
  );
  console.log(
    '✓ Browser-facing API: create event, join, save project, submit immutable checkpoint',
  );
  let evaluation = submitted.event.evaluations[0];
  for (
    let attempts = 0;
    attempts < 45 &&
    (evaluation.status === 'queued' || evaluation.status === 'running');
    attempts++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    evaluation = (await rpc('builder')).event.evaluations[0];
  }
  assert.equal(
    evaluation.status,
    'completed',
    evaluation.error || 'AI evaluation did not complete',
  );
  assert.ok(evaluation.assessment?.summary);
  console.log('✓ Live OpenAI structured assessment completed and persisted');
  const mentor = await rpc('mentor', 'join', {
    name: 'QA Mentor',
    email: `qa-mentor-${suffix}@example.invalid`,
    password,
    code: organizer.event.mentorCode,
  });
  assert.equal(mentor.event.evaluations[0].assessment, undefined);
  await rpc('mentor', 'claim-review', { projectId });
  const reviewed = await rpc('mentor', 'review', {
    projectId,
    submissionId,
    kind: 'check-in',
    scores: {},
    note: 'Verify the reload behavior with a new note before final scoring.',
    verified: false,
    recommendation: 'maybe',
  });
  assert.ok(reviewed.event.evaluations[0].assessment);
  const prohibited = await fetch(`${base}/api/desk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      Cookie: users.get('builder')!,
    },
    body: JSON.stringify({ action: 'approve' }),
  });
  assert.equal(prohibited.status, 403);
  const csrf = await fetch(`${base}/api/desk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://other.invalid',
      Cookie: users.get('organizer')!,
    },
    body: JSON.stringify({ action: 'approve' }),
  });
  assert.equal(csrf.status, 403);
  const exported = await fetch(`${base}/api/desk/export`, {
    headers: { Cookie: users.get('organizer')! },
  });
  assert.equal(exported.status, 200);
  assert.match(await exported.text(), /Human score/);
  console.log(
    '✓ Independent mentor review, AI reveal, role restrictions, CSRF protection, and CSV export',
  );
} finally {
  // Only remove this script’s UUID-scoped synthetic event; preserve all user and demo events.
  if (
    eventId &&
    (base === 'http://localhost:3000' || process.env.DESK_TEST_CLEANUP === '1')
  ) {
    const connection = db();
    const row = (await connection
      .prepare('SELECT data FROM events WHERE id=?')
      .get(eventId)) as
      | {
          data: string;
        }
      | undefined;
    if (row && JSON.parse(row.data).name === `QA ${suffix}`) {
      try {
        await transaction(async () => {
          const files = (await db()
            .prepare('SELECT blob_path FROM files WHERE event_id=?')
            .all(eventId)) as { blob_path: string | null }[];
          for (const file of files)
            if (file.blob_path) await del(file.blob_path);
          await db()
            .prepare(
              'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE event_id=?)',
            )
            .run(eventId);
          await db().prepare('DELETE FROM files WHERE event_id=?').run(eventId);
          await db().prepare('DELETE FROM users WHERE event_id=?').run(eventId);
          await db().prepare('DELETE FROM events WHERE id=?').run(eventId);
        }, `event:${eventId}`);
      } catch {
        console.error('QA fixture cleanup failed.');
        process.exitCode = 1;
      }
    }
  }
  await db().close();
}
