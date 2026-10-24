import { authenticated, apiError, checkOrigin } from '../http';
import { getEvent, requireThat, rateLimit } from '@/lib/desk/store';
import {
  configureTracker,
  ingestTrackerSnapshot,
  trackerSnapshotSchema,
  trackerSourceSchema,
  trackerFromEvent,
} from '@/lib/desk/github-tracker';
import { sheetBridgeScript } from '@/lib/desk/tracker-bridge';

export const runtime = 'nodejs';
export const maxDuration = 180;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const user = await authenticated(request);
    const tracker = trackerFromEvent(await getEvent(user.eventId), user);
    return Response.json(
      { tracker, bridgeConfigured: !!process.env.TRACKER_BRIDGE_SECRET },
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
    requireThat(
      user.role === 'organizer',
      'Organizer access is required.',
      403,
    );
    await rateLimit(`tracker-setup:${user.id}`, 12);
    const text = await request.text();
    requireThat(text.length < 600000, 'The tracker request is too large.', 413);
    const body = JSON.parse(text);
    if (body.action === 'connect') {
      const source = trackerSourceSchema.parse(body.source);
      await configureTracker(user, source);
      return Response.json({ connected: true }, { headers });
    }
    if (body.action === 'bridge') {
      const tracker = trackerFromEvent(await getEvent(user.eventId), user);
      requireThat(tracker, 'Connect a submission sheet first.', 409);
      const origin = new URL(request.url).origin;
      requireThat(
        origin.startsWith('https://') || process.env.NODE_ENV !== 'production',
        'Use the secure deployed app URL.',
      );
      return new Response(
        sheetBridgeScript(user.eventId, tracker.source, origin),
        {
          headers: {
            ...headers,
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="tracker-bridge.gs"',
          },
        },
      );
    }
    requireThat(body.action === 'import', 'Unknown tracker action.');
    const snapshot = trackerSnapshotSchema.parse({
      ...body.snapshot,
      eventId: user.eventId,
    });
    return Response.json(await ingestTrackerSnapshot(snapshot, false), {
      headers,
    });
  } catch (error) {
    return apiError(error);
  }
}
