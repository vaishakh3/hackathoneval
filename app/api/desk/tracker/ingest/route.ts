import { apiError } from '../../http';
import { rateLimit, requireThat } from '@/lib/desk/store';
import {
  ingestTrackerSnapshot,
  trackerSnapshotSchema,
  verifyTrackerSignature,
} from '@/lib/desk/github-tracker';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    requireThat(
      Number(request.headers.get('content-length') || 0) < 600000,
      'The tracker request is too large.',
      413,
    );
    const reader = request.body?.getReader();
    requireThat(reader, 'A tracker snapshot is required.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        requireThat(size < 600000, 'The tracker request is too large.', 413);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const snapshot = trackerSnapshotSchema.parse(JSON.parse(text));
    verifyTrackerSignature(
      snapshot.eventId,
      text,
      request.headers.get('x-tracker-timestamp') || '',
      request.headers.get('x-tracker-signature') || '',
    );
    await rateLimit(`tracker-ingest:${snapshot.eventId}`, 20);
    const result = await ingestTrackerSnapshot(snapshot, true);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
