import {
  evidenceFile,
  evidenceContent,
  storeEvidence,
} from '@/lib/desk/evidence';
import { authenticated, apiError, checkOrigin } from '../http';
import { getEvent, rateLimit, requireThat } from '@/lib/desk/store';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await authenticated(request);
    requireThat(
      user.role === 'participant',
      'Only participants can upload evidence.',
      403,
    );
    await rateLimit(`upload:${user.id}`, 15);
    const event = await getEvent(user.eventId);
    requireThat(event.stage !== 'shortlisted', 'Evidence uploads are closed.');
    requireThat(
      Number(request.headers.get('content-length') || 0) <= 2200000,
      'Images must be smaller than 2 MB.',
      413,
    );
    const data = await request.formData();
    const file = data.get('file');
    requireThat(
      file instanceof File && file.size > 0 && file.size <= 2000000,
      'Upload a PNG, JPEG, or WebP under 2 MB.',
    );
    const content = Buffer.from(await file.arrayBuffer());
    const png = content
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = content[0] === 255 && content[1] === 216 && content[2] === 255;
    const webp =
      content.toString('ascii', 0, 4) === 'RIFF' &&
      content.toString('ascii', 8, 12) === 'WEBP';
    requireThat(png || jpeg || webp, 'Use a PNG, JPEG, or WebP image.');
    const project = event.projects.find((p) => p.ownerId === user.id);
    requireThat(project, 'Project not found.', 404);
    const id = await storeEvidence(
      event.id,
      project.id,
      png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp',
      content,
    );
    return Response.json({
      id,
      kind: 'image',
      label: file.name.slice(0, 100),
      url: `/api/desk/evidence?id=${id}`,
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function GET(request: Request) {
  try {
    const user = await authenticated(request);
    const id = new URL(request.url).searchParams.get('id');
    const file = await evidenceFile(id || '', user.eventId);
    requireThat(file, 'Evidence not found.', 404);
    if (user.role === 'participant')
      requireThat(
        (await getEvent(user.eventId)).projects.some(
          (p) => p.id === file.project_id && p.ownerId === user.id,
        ),
        'This evidence is private.',
        403,
      );
    return new Response(await evidenceContent(file), {
      headers: {
        'Content-Type': file.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
