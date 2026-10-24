import { after } from 'next/server';
import { z } from 'zod';
import { authenticated, apiError, checkOrigin } from '../../http';
import { rateLimit } from '@/lib/desk/store';
import {
  enableRepositoryJudge,
  repositoryJudgmentFor,
  retryRepositoryJudgment,
} from '@/lib/desk/repo-judge';
import { dispatchRepositoryJudgments } from '@/lib/desk/repo-judge-dispatch';

export const runtime = 'nodejs';
export const maxDuration = 180;
const headers = { 'Cache-Control': 'private, no-store' };
const keySchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/)
  .max(220);
export async function GET(request: Request) {
  try {
    const user = await authenticated(request);
    const key = keySchema.parse(new URL(request.url).searchParams.get('repo'));
    return Response.json(
      { repo: await repositoryJudgmentFor(user, key) },
      { headers },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await authenticated(request);
    await rateLimit(`repository-judge:${user.id}`, 12);
    const text = await request.text();
    if (text.length > 2000)
      return Response.json({ error: 'Request too large.' }, { status: 413 });
    const body = z
      .object({
        action: z.enum(['enable', 'retry']),
        repo: keySchema.optional(),
      })
      .parse(JSON.parse(text));
    const result =
      body.action === 'enable'
        ? await enableRepositoryJudge(user)
        : await retryRepositoryJudgment(user, keySchema.parse(body.repo));
    after(() => dispatchRepositoryJudgments(user.eventId));
    return Response.json(result, { status: 202, headers });
  } catch (error) {
    return apiError(error);
  }
}
