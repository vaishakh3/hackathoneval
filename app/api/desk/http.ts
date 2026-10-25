import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DeskError, requireThat, sessionUser } from '@/lib/desk/store';
import { isDatabaseQuotaError } from '@/lib/desk/service-errors';
const COOKIE = 'build-desk-session';
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  requireThat(
    !origin || origin === new URL(request.url).origin,
    'Cross-origin requests are not allowed.',
    403,
  );
}
export function apiError(error: unknown) {
  if (isDatabaseQuotaError(error)) {
    console.error('Build Desk database allowance exhausted', { code: '53000' });
    return NextResponse.json(
      {
        error:
          'The event database has reached its service limit. Please contact the event organizer.',
      },
      { status: 503, headers: { 'Retry-After': '300' } },
    );
  }
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: error.issues
          .map((i) => `${i.path.join('.') || 'Form'}: ${i.message}`)
          .slice(0, 3)
          .join(' '),
      },
      { status: 400 },
    );
  if (error instanceof DeskError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: 'The request could not be read.' },
      { status: 400 },
    );
  // Do not log request bodies, secrets, or provider error objects.
  console.error(
    'Build Desk request failed:',
    error instanceof Error ? error.name : 'Unknown error',
  );
  return NextResponse.json(
    {
      error: 'Something went wrong. Your saved work is safe; please try again.',
    },
    { status: 500 },
  );
}
export function sessionToken(request: Request) {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1) || ''
  );
}
export async function authenticated(request: Request) {
  const user = await sessionUser(sessionToken(request));
  requireThat(user, 'Please sign in to continue.', 401);
  return user;
}
