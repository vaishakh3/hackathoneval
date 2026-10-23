import { randomUUID } from 'node:crypto';
import type { Assessment, DeskEvent, Project, User } from './types';
import { DEFAULT_RUBRIC } from './types';
import { insertEvent, insertUser } from './store';
const ideas = [
  [
    'Canopy',
    'A second life for your neighborhood’s surplus food.',
    'Community',
    '#648976',
  ],
  [
    'Wayfinder',
    'Accessible routes through a city that works for everyone.',
    'Community',
    '#7b87bd',
  ],
  [
    'Quiet Hours',
    'A calmer workspace, one focused session at a time.',
    'AI & tools',
    '#a28bbe',
  ],
  [
    'Local Loop',
    'Discover the makers around the corner.',
    'Community',
    '#cd9872',
  ],
  [
    'Leafline',
    'Turn everyday habits into measurable climate action.',
    'Climate',
    '#7eaa76',
  ],
  [
    'Second Brain',
    'Find the thought you know you wrote down.',
    'AI & tools',
    '#8a94aa',
  ],
  [
    'Study Buddy',
    'A learning companion that asks better questions.',
    'Education',
    '#d3a457',
  ],
  [
    'Care Note',
    'Make the most of the next conversation with your doctor.',
    'Health',
    '#bd8396',
  ],
  [
    'Raincheck',
    'Hyperlocal rain alerts for your next commute.',
    'Climate',
    '#729cb8',
  ],
  [
    'Open Shelf',
    'A little library, connected to the whole neighborhood.',
    'Education',
    '#af916c',
  ],
  [
    'Signal',
    'Turn scattered community reports into useful action.',
    'Community',
    '#b77e70',
  ],
  [
    'Patchwork',
    'Small fixes for the tools you use every day.',
    'AI & tools',
    '#8c89b5',
  ],
  [
    'Kindred',
    'Make volunteering easier to start and easier to sustain.',
    'Community',
    '#c39b89',
  ],
  [
    'Groundwork',
    'Practical growing advice for first-time gardeners.',
    'Climate',
    '#879a72',
  ],
  [
    'Read Along',
    'Stories that help young readers find their confidence.',
    'Education',
    '#a78cab',
  ],
  [
    'Pulse',
    'A personal check-in that makes patterns easier to notice.',
    'Health',
    '#b78986',
  ],
  [
    'Clearcut',
    'Understand a document before you sign it.',
    'AI & tools',
    '#8a9bba',
  ],
  [
    'Field Notes',
    'Capture observations and connect them to the bigger picture.',
    'Education',
    '#c6a272',
  ],
  [
    'ReThread',
    'Find a repair before you buy a replacement.',
    'Climate',
    '#849a88',
  ],
  [
    'Little Steps',
    'Make rehabilitation exercises easier to remember.',
    'Health',
    '#9a8ab0',
  ],
] as const;
const firstNames = [
  'Mira',
  'Arjun',
  'Diya',
  'Nikhil',
  'Ananya',
  'Rohan',
  'Sara',
  'Dev',
  'Isha',
  'Neel',
];
const lastNames = [
  'Varma',
  'Menon',
  'Nair',
  'Thomas',
  'Joseph',
  'Rao',
  'Shah',
  'Pillai',
  'Das',
  'George',
];
export function newEvent(name: string, demo = false): DeskEvent {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    theme: 'Build something that makes everyday life a little better.',
    venue: 'Kochi, Kerala',
    startsAt: new Date(now - (demo ? 8 : 0) * 3600000).toISOString(),
    endsAt: new Date(now + 12 * 3600000).toISOString(),
    capacity: 100,
    shortlistTarget: 8,
    currentCheckpoint: demo ? 2 : 0,
    stage: demo ? 'final-review' : 'building',
    checkpoints: [
      'Idea & direction',
      'Working progress',
      'Final submission',
    ].map((title, i) => ({
      title,
      dueAt: new Date(now + (i + 1) * 4 * 3600000).toISOString(),
    })),
    rubric: structuredClone(DEFAULT_RUBRIC),
    participantCode: `BUILD-${randomUUID().slice(0, 8).toUpperCase()}`,
    mentorCode: `MENTOR-${randomUUID().slice(0, 8).toUpperCase()}`,
    demo,
    revision: 0,
    projects: [],
    reviews: [],
    evaluations: [],
    help: [],
    conflicts: [],
    locks: [],
    audit: [],
  };
}
export async function seedDemo(): Promise<{
  event: DeskEvent;
  organizer: User;
}> {
  const event = newEvent('Devin Hacks Kochi', true);
  const organizer: User = {
    id: randomUUID(),
    eventId: event.id,
    role: 'organizer',
    name: 'Alex Morgan',
    email: `${event.id}.organizer@example.invalid`,
    skills: [],
  };
  const mentors: User[] = ['Asha', 'Ben', 'Chitra', 'Farah'].map((name, i) => ({
    id: randomUUID(),
    eventId: event.id,
    role: 'mentor',
    name,
    email: `${event.id}.mentor${i}@example.invalid`,
    skills: [
      ['Software', 'AI'],
      ['Hardware'],
      ['Design'],
      ['Software', 'Education'],
    ][i],
  }));
  const builder: User = {
    id: randomUUID(),
    eventId: event.id,
    role: 'participant',
    name: 'Mira Varma',
    email: `${event.id}.builder@example.invalid`,
    skills: [],
  };
  for (let i = 0; i < 100; i++) {
    const idea = ideas[i % ideas.length];
    const number = i + 1;
    const project: Project = {
      id: randomUUID(),
      ownerId: i === 0 ? builder.id : randomUUID(),
      number,
      title: `${idea[0]}${i >= 20 ? [' Studio', ' Connect', ' Pocket', ' Lab'][Math.floor(i / 20) - 1] : ''}`,
      tagline: idea[1],
      description: `${idea[1]} A solo-built prototype with a focused, practical core workflow.`,
      category: idea[2],
      color: idea[3],
      participantName: `${firstNames[i % 10]} ${lastNames[Math.floor(i / 10)]}`,
      repoUrl: '',
      demoUrl: '',
      preExisting:
        'Started from a blank project. Used existing open-source libraries.',
      goal: 'Demonstrate the main user journey with real inputs.',
      createdAt: new Date(Date.now() - 8 * 3600000).toISOString(),
      submissions: [],
      shortlisted: i < 5,
      shortlistReason:
        i < 5
          ? 'A clear problem, a demonstrated core workflow, and independent mentor support.'
          : '',
      needsReview: i === 4 || i === 12,
    };
    const checkpointCount = i < 89 ? 3 : i < 96 ? 2 : 0;
    for (let c = 0; c < checkpointCount; c++) {
      const submission = {
        id: randomUUID(),
        checkpoint: c,
        changed: [
          'Defined the problem and mapped the main user journey.',
          'Built the core interface, data model, and first working flow.',
          'Connected the main flow end to end and improved the error states.',
        ][c],
        working:
          c === 0
            ? 'A clickable first concept.'
            : 'The main workflow runs locally with sample inputs. Deployment has not been verified.',
        blockers:
          i === 4
            ? 'Offline synchronization still needs testing.'
            : i % 17 === 0
              ? 'Need a mentor to review the data flow.'
              : '',
        evidence: [],
        submittedAt: new Date(
          Date.now() - (7 - c * 3) * 3600000 + i * 1000,
        ).toISOString(),
        projectSnapshot: {
          title: project.title,
          description: project.description,
          goal: project.goal,
          preExisting: project.preExisting,
          repoUrl: '',
          demoUrl: '',
        },
      };
      project.submissions.push(submission);
    }
    if (project.submissions.length) {
      const latest = project.submissions.at(-1)!;
      const base = Math.max(2, 5 - Math.floor(i / 22));
      const assessment: Assessment = {
        summary: `${project.title} has progressed from a clear concept to a prototype of its core workflow. This is an illustrative sample assessment.`,
        progress:
          'The latest update connects the main user journey and records remaining testing work.',
        strengths: [
          'Focused scope and a clearly described user problem.',
          'Progress is documented across checkpoints.',
        ],
        unknowns: [
          'Live functionality has not been independently verified by AI.',
          'No source files or screenshots were supplied in this sample.',
        ],
        questions: [
          'Can you demonstrate the core journey with a new input?',
          'What happens when the request fails?',
        ],
        readiness: i < 60 ? 'ready' : 'partial',
        criteria: event.rubric.map((c) => ({
          id: c.id,
          score: Math.max(1, Math.min(5, base - (i % 5 === 4 ? 1 : 0))),
          reasoning:
            'Illustrative sample rating; verify the actual project before judging.',
          evidenceIds: [`update:${latest.id}`],
        })),
      };
      event.evaluations.push({
        id: randomUUID(),
        projectId: project.id,
        submissionId: latest.id,
        checkpoint: latest.checkpoint,
        status: i === 93 ? 'failed' : 'completed',
        attempts: 1,
        error:
          i === 93
            ? 'Sample: evaluation interrupted. Try again in a real event.'
            : undefined,
        createdAt: latest.submittedAt,
        finishedAt: latest.submittedAt,
        model: 'Sample assessment',
        promptVersion: 'sample',
        rubric: event.rubric,
        assessment: i === 93 ? undefined : assessment,
        sources: [
          {
            id: `update:${latest.id}`,
            label: 'Checkpoint update',
            text: latest.changed,
          },
        ],
        sample: true,
      });
      if (i < 82)
        event.reviews.push({
          id: randomUUID(),
          projectId: project.id,
          submissionId: project.submissions[0].id,
          mentorId: mentors[(i + 2) % 4].id,
          mentorName: mentors[(i + 2) % 4].name,
          checkpoint: 0,
          kind: 'check-in',
          scores: {},
          note: 'Keep the core journey small. Demonstrate it with a new input at the final checkpoint.',
          verified: false,
          recommendation: 'maybe',
          createdAt: project.submissions[0].submittedAt,
        });
      if (i < 74 && latest.checkpoint === 2) {
        for (let k = 0; k < (i < 16 ? 2 : 1); k++) {
          const mentor = mentors[(i + k) % 4];
          event.reviews.push({
            id: randomUUID(),
            projectId: project.id,
            submissionId: latest.id,
            mentorId: mentor.id,
            mentorName: mentor.name,
            checkpoint: 2,
            kind: 'final',
            scores: Object.fromEntries(
              event.rubric.map((c, ci) => [
                c.id,
                Math.max(
                  1,
                  Math.min(5, base - ((i + ci + k) % 7 === 0 ? 1 : 0)),
                ),
              ]),
            ),
            note: 'Observed the core workflow with a fresh input. The scope is clear; edge cases need more testing.',
            verified: true,
            recommendation: i < 20 ? 'yes' : 'maybe',
            createdAt: latest.submittedAt,
          });
        }
      }
    }
    event.projects.push(project);
  }
  for (const index of [4, 16, 28, 41])
    event.help.push({
      id: randomUUID(),
      projectId: event.projects[index].id,
      type: index === 4 ? 'Software' : 'Design',
      note:
        index === 4
          ? 'Could use a fresh look at offline sync before the final demo.'
          : 'Would love feedback on the core user journey.',
      createdAt: new Date(Date.now() - (index + 2) * 60000).toISOString(),
      status: index === 16 ? 'claimed' : 'open',
      ...(index === 16
        ? { claimedBy: mentors[2].id, claimedName: mentors[2].name }
        : {}),
    });
  event.audit = [
    {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: 'Chitra',
      text: 'Completed an independent review of Wayfinder.',
    },
    {
      id: randomUUID(),
      at: new Date(Date.now() - 120000).toISOString(),
      actor: 'Mira Varma',
      text: 'Submitted Canopy’s final checkpoint.',
    },
    {
      id: randomUUID(),
      at: new Date(Date.now() - 240000).toISOString(),
      actor: 'Asha',
      text: 'Requested a second look at Leafline.',
    },
  ];
  await insertEvent(event);
  for (const user of [organizer, ...mentors, builder])
    await insertUser(user, 'sample-sign-in-disabled');
  return { event, organizer };
}
