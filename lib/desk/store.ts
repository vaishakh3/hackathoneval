import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DeskEvent, Role, User } from './types';
import { db, transaction, usesPostgres } from './database';
export { db, transaction } from './database';
const scryptAsync = promisify(scrypt);
export class DeskError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new DeskError(status, message);
}
export async function getEvent(id: string): Promise<DeskEvent> {
  const row = (await db()
    .prepare('SELECT data FROM events WHERE id=?')
    .get(id)) as
    | {
        data: string;
      }
    | undefined;
  requireThat(row, 'Event not found.', 404);
  return JSON.parse(row.data);
}
export async function getParticipantEvent(
  id: string,
  ownerId: string,
): Promise<DeskEvent> {
  if (!usesPostgres()) return getEvent(id);
  // Filter on the database side: polling one project must not transfer the entire event's evidence.
  const row = (await db()
    .prepare(`SELECT (
    e.data::jsonb || jsonb_build_object(
      'projects', jsonb_build_array(p.project),
      'evaluations', COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(e.data::jsonb->'evaluations') v WHERE v->>'projectId'=p.project->>'id'),'[]'::jsonb),
      'reviews', COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(e.data::jsonb->'reviews') v WHERE v->>'projectId'=p.project->>'id'),'[]'::jsonb),
      'help', COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(e.data::jsonb->'help') v WHERE v->>'projectId'=p.project->>'id'),'[]'::jsonb),
      'audit','[]'::jsonb,'conflicts','[]'::jsonb,'locks','[]'::jsonb,'participantCode','','mentorCode',''
    ))::text AS data FROM events e CROSS JOIN LATERAL (
      SELECT x AS project FROM jsonb_array_elements(e.data::jsonb->'projects') x WHERE x->>'ownerId'=? LIMIT 1
    ) p WHERE e.id=?`)
    .get(ownerId, id)) as { data: string } | undefined;
  requireThat(row, 'Project not found.', 404);
  return JSON.parse(row.data);
}
export async function insertEvent(event: DeskEvent) {
  await db()
    .prepare('INSERT INTO events(id,data) VALUES(?,?)')
    .run(event.id, JSON.stringify(event));
}
// Writers hold the same event lock across all reads and writes, including async operations.
export async function mutateEvent<T>(
  id: string,
  change: (event: DeskEvent) => T | Promise<T>,
): Promise<T> {
  return transaction(async () => {
    const event = await getEvent(id);
    const result = await change(event);
    event.revision++;
    await db()
      .prepare('UPDATE events SET data=? WHERE id=?')
      .run(JSON.stringify(event), id);
    return result;
  }, `event:${id}`);
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const digest = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${digest.toString('hex')}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, value] = stored.split(':');
  if (!salt || !value) return false;
  const digest = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, 'hex');
  return expected.length === digest.length && timingSafeEqual(expected, digest);
}
export async function insertUser(user: User, password: string) {
  try {
    await db()
      .prepare(
        'INSERT INTO users(id,event_id,role,name,email,password,skills) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        user.id,
        user.eventId,
        user.role,
        user.name,
        user.email.toLowerCase(),
        password,
        JSON.stringify(user.skills),
      );
  } catch (error) {
    const failure = error as { code?: string; errcode?: number };
    if (failure.code === '23505' || failure.errcode === 2067)
      throw new DeskError(
        409,
        'An account with this email already exists. Sign in instead.',
      );
    throw error;
  }
}
function userFromRow(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    role: row.role as Role,
    name: String(row.name),
    email: String(row.email),
    skills: JSON.parse(String(row.skills)),
  };
}
export async function findUser(email: string) {
  const row = (await db()
    .prepare('SELECT * FROM users WHERE email=?')
    .get(email.toLowerCase())) as Record<string, unknown> | undefined;
  return row
    ? { user: userFromRow(row), password: String(row.password) }
    : null;
}
export async function eventUsers(eventId: string): Promise<User[]> {
  return (
    (await db()
      .prepare('SELECT * FROM users WHERE event_id=?')
      .all(eventId)) as Record<string, unknown>[]
  ).map(userFromRow);
}
const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export async function makeSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  await db().prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  await db()
    .prepare('INSERT INTO sessions VALUES(?,?,?)')
    .run(tokenHash(token), userId, Date.now() + 7 * 86400000);
  return token;
}
export async function sessionUser(token?: string): Promise<User | null> {
  if (!token) return null;
  const row = (await db()
    .prepare(
      'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
    )
    .get(tokenHash(token), Date.now())) as Record<string, unknown> | undefined;
  return row ? userFromRow(row) : null;
}
export async function endSession(token: string) {
  await db()
    .prepare('DELETE FROM sessions WHERE token_hash=?')
    .run(tokenHash(token));
}
export async function rateLimit(key: string, limit: number, duration = 60000) {
  return transaction(async () => {
    const row = (await db()
      .prepare('SELECT expires_at,count FROM rate_limits WHERE key=?')
      .get(key)) as
      | {
          expires_at: number;
          count: number;
        }
      | undefined;
    const reset = !row || row.expires_at < Date.now();
    const count = reset ? 1 : row.count + 1;
    requireThat(
      count <= limit,
      'Too many requests. Please try again shortly.',
      429,
    );
    await db()
      .prepare(
        'INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at,count=excluded.count',
      )
      .run(key, reset ? Date.now() + duration : row.expires_at, count);
  }, `rate:${key}`);
}
