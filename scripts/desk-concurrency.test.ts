import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { register, act } from '../lib/desk/service';
import { db, getEvent, transaction } from '../lib/desk/store';
const remote = process.env.DESK_TEST_POSTGRES === '1';
const directory = mkdtempSync(path.join(tmpdir(), 'desk-concurrency-'));
if (!remote) process.env.DESK_DB_PATH = path.join(directory, 'db.sqlite');
else assert.match(process.env.DESK_DB_SCHEMA || '', /^desk_test_/);
after(async () => {
  await db().close();
  rmSync(directory, { recursive: true, force: true });
});
void test('concurrent saves preserve all participant updates and rate-limit increments', async () => {
  const suffix = randomUUID();
  const password = 'local-fixture-password';
  const organizer = await register(
    {
      name: 'Concurrency Organizer',
      email: `owner-${suffix}@example.invalid`,
      password,
      eventName: 'Concurrent writes',
    },
    'create',
  );
  const event = await getEvent(organizer.eventId);
  try {
    const builders = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        register(
          {
            name: `Concurrent Builder ${i}`,
            email: `builder-${i}-${suffix}@example.invalid`,
            password,
            code: event.participantCode,
          },
          'join',
        ),
      ),
    );
    await Promise.all(
      builders.map((user, i) =>
        act(user, 'save-project', {
          title: `Concurrent project ${i}`,
          tagline: 'Every write is retained.',
          description: 'A focused concurrency test fixture.',
          category: 'Other',
          repoUrl: '',
          demoUrl: '',
          preExisting: '',
          goal: `Keep update ${i}.`,
        }),
      ),
    );
    const saved = await getEvent(event.id);
    assert.equal(saved.projects.length, 8);
    for (const [i, builder] of builders.entries())
      assert.equal(
        saved.projects.find((p) => p.ownerId === builder.id)?.title,
        `Concurrent project ${i}`,
      );
    const { rateLimit } = await import('../lib/desk/store');
    const limits = await Promise.allSettled(
      Array.from({ length: 12 }, () => rateLimit(`concurrency-${suffix}`, 5)),
    );
    assert.equal(limits.filter((r) => r.status === 'fulfilled').length, 5);
  } finally {
    await transaction(async () => {
      await db()
        .prepare(
          'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE event_id=?)',
        )
        .run(event.id);
      await db().prepare('DELETE FROM users WHERE event_id=?').run(event.id);
      await db().prepare('DELETE FROM events WHERE id=?').run(event.id);
    }, `event:${event.id}`);
  }
});
