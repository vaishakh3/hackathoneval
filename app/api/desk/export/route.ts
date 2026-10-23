import { authenticated, apiError } from '../http';
import { getEvent, requireThat } from '@/lib/desk/store';
import { csvCell, rankedSignals, validReviews } from '@/lib/desk/domain';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const user = await authenticated(request);
    requireThat(
      user.role === 'organizer',
      'Organizer access is required.',
      403,
    );
    const event = await getEvent(user.eventId);
    event.projects = event.projects.map((p) => ({
      ...p,
      ...p.submissions.at(-1)?.projectSnapshot,
    }));
    const format = new URL(request.url).searchParams.get('format');
    const filename = event.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60);
    let content: string, extension: string, mime: string;
    if (format === 'template') {
      content = JSON.stringify(
        {
          version: 1,
          theme: event.theme,
          venue: event.venue,
          shortlistTarget: event.shortlistTarget,
          durationMinutes: Math.round(
            (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60000,
          ),
          checkpoints: event.checkpoints.map((c) => ({
            title: c.title,
            offsetMinutes: Math.round(
              (Date.parse(c.dueAt) - Date.parse(event.startsAt)) / 60000,
            ),
          })),
          weights: event.rubric.map((c) => c.weight),
        },
        null,
        2,
      );
      extension = 'json';
      mime = 'application/json';
    } else if (format === 'json') {
      // Event content only. Invite codes are omitted, and no auth/session tables are exported.
      content = JSON.stringify(
        {
          ...event,
          participantCode: undefined,
          mentorCode: undefined,
          locks: [],
        },
        null,
        2,
      );
      extension = 'json';
      mime = 'application/json';
    } else if (format === 'briefs') {
      content = `# ${event.name} — ${event.approvedAt ? 'Approved' : 'Provisional'} finalist briefs\n\n${event.projects
        .filter((p) => p.shortlisted)
        .map((p) => {
          const latest = p.submissions.at(-1);
          return `## ${p.title} · ${p.participantName}\n\n${p.tagline}\n\nBuilt: ${latest?.working || 'No final update'}\n\nGoal: ${p.goal}\n\nRemaining blockers: ${latest?.blockers || 'None reported'}\n\nDemo: ${p.demoUrl || 'In-person demonstration'}\n\nIndependent final reviews: ${validReviews(event, p).length}\n`;
        })
        .join('\n---\n\n')}`;
      extension = 'md';
      mime = 'text/markdown';
    } else {
      const rows = rankedSignals(event);
      content = [
        [
          'Project',
          'Participant',
          'Category',
          'Human score',
          'AI score (advisory)',
          'Final reviews',
          'Selected',
          'Selection reason',
          'Status',
        ],
        ...rows.map((s) => [
          s.project.title,
          s.project.participantName,
          s.project.category,
          s.humanScore ?? '',
          s.aiScore ?? '',
          s.finalReviews,
          s.project.shortlisted ? 'Yes' : 'No',
          s.project.shortlistReason,
          event.approvedAt ? 'Approved' : 'Provisional',
        ]),
      ]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n');
      extension = 'csv';
      mime = 'text/csv';
    }
    return new Response(content, {
      headers: {
        'Content-Type': `${mime}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${filename}-${format || 'scores'}.${extension}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
