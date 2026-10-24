import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, authenticated, checkOrigin, sessionToken } from './http';
import { act, login, register, stateFor } from '@/lib/desk/service';
import {
  db,
  endSession,
  eventUsers,
  getEvent,
  makeSession,
  rateLimit,
  requireThat,
  sessionUser,
} from '@/lib/desk/store';
import { seedDemo } from '@/lib/desk/demo';
import { needsDispatch, dispatchEvaluations } from '@/lib/desk/dispatch';
import { dispatchRepositoryJudgments } from '@/lib/desk/repo-judge-dispatch';
export const runtime = 'nodejs';
export const maxDuration = 180;
const COOKIE = 'build-desk-session';
function response(data: unknown, token?: string) {
  const res = NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  });
  if (token !== undefined)
    res.cookies.set(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: token ? 7 * 86400 : 0,
    });
  return res;
}
export async function GET(request: Request) {
  try {
    const user = await sessionUser(sessionToken(request));
    if (!user) return response({ user: null });
    const state = await stateFor(user);
    if (needsDispatch(state.event))
      after(() => dispatchEvaluations(user.eventId));
    if (state.event.githubTracker?.judge?.enabled)
      after(() => dispatchRepositoryJudgments(user.eventId));
    return response(state);
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    requireThat(
      Number(request.headers.get('content-length') || 0) < 100000,
      'The request is too large.',
      413,
    );
    const body = await request.text();
    requireThat(body.length < 100000, 'The request is too large.', 413);
    const { action, args } = z
      .object({
        action: z.string().max(40),
        args: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(JSON.parse(body));
    const remote =
      request.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
    if (['create', 'join', 'login', 'demo'].includes(action)) {
      requireThat(
        action !== 'demo' || process.env.NODE_ENV !== 'production',
        'Sample events are available in local development only.',
        403,
      );
      await rateLimit(
        `auth:${action}:${remote}`,
        action === 'demo' || action === 'create' ? 10 : 180,
        300000,
      );
      const email =
        typeof args.email === 'string' ? args.email.toLowerCase() : 'none';
      await rateLimit(`auth-email:${email}`, 15, 300000);
      const user =
        action === 'demo'
          ? (await seedDemo()).organizer
          : action === 'login'
            ? await login(args)
            : await register(args, action === 'join' ? 'join' : 'create');
      return response(await stateFor(user), await makeSession(user.id));
    }
    const user = await authenticated(request);
    await rateLimit(`user:${user.id}`, 180);
    if (action === 'logout') {
      await endSession(sessionToken(request));
      return response({ user: null }, '');
    }
    if (action === 'demo-role') {
      const event = await getEvent(user.eventId);
      requireThat(
        event.demo,
        'Role previews are available only in sample events.',
        403,
      );
      const target = (await eventUsers(event.id)).find(
        (u) => u.role === args.role,
      );
      requireThat(target, 'Sample role not found.');
      await endSession(sessionToken(request));
      return response(await stateFor(target), await makeSession(target.id));
    }
    const result = await act(user, String(action), args);
    const fresh = (await db()
      .prepare('SELECT skills FROM users WHERE id=?')
      .get(user.id)) as {
      skills: string;
    };
    user.skills = JSON.parse(fresh.skills);
    if (result.queued) after(() => dispatchEvaluations(user.eventId));
    return response({ ...(await stateFor(user)), result });
  } catch (error) {
    return apiError(error);
  }
}
