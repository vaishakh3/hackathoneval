export type Role = 'organizer' | 'mentor' | 'participant';
export type Stage = 'building' | 'final-review' | 'shortlisted';
export type Category =
  | 'AI & tools'
  | 'Community'
  | 'Climate'
  | 'Health'
  | 'Education'
  | 'Other';

export type Criterion = {
  id: string;
  label: string;
  weight: number;
  question: string;
};
export const DEFAULT_RUBRIC: Criterion[] = [
  {
    id: 'functionality',
    label: 'Functionality',
    weight: 40,
    question: 'Does the core experience work end to end?',
  },
  {
    id: 'fit',
    label: 'Problem fit',
    weight: 25,
    question: 'Does it address the stated problem or theme?',
  },
  {
    id: 'execution',
    label: 'Execution',
    weight: 20,
    question: 'How well is the demonstrated solution implemented?',
  },
  {
    id: 'originality',
    label: 'Originality',
    weight: 15,
    question: 'What is distinctive about the approach?',
  },
];
export const CATEGORIES: Category[] = [
  'AI & tools',
  'Community',
  'Climate',
  'Health',
  'Education',
  'Other',
];
export const ANCHORS = [
  'No demonstration',
  'Early attempt',
  'Partial solution',
  'Core works',
  'Strong solution',
  'Exceptional execution',
];

export type Evidence = {
  id: string;
  kind: 'link' | 'image';
  label: string;
  url: string;
};
export type Submission = {
  id: string;
  checkpoint: number;
  changed: string;
  working: string;
  blockers: string;
  evidence: Evidence[];
  submittedAt: string;
  projectSnapshot?: {
    title: string;
    tagline?: string;
    category?: Category;
    description: string;
    goal: string;
    preExisting: string;
    repoUrl: string;
    demoUrl: string;
  };
};
export type Project = {
  id: string;
  ownerId: string;
  number: number;
  title: string;
  tagline: string;
  description: string;
  category: Category;
  repoUrl: string;
  demoUrl: string;
  preExisting: string;
  goal: string;
  participantName: string;
  color: string;
  createdAt: string;
  submissions: Submission[];
  shortlisted: boolean;
  shortlistReason: string;
  needsReview: boolean;
};
export type Review = {
  id: string;
  projectId: string;
  submissionId: string;
  mentorId: string;
  mentorName: string;
  checkpoint: number;
  kind: 'check-in' | 'final';
  scores: Record<string, number>;
  note: string;
  verified: boolean;
  recommendation: 'yes' | 'maybe' | 'no';
  createdAt: string;
};
export type Assessment = {
  summary: string;
  progress: string;
  strengths: string[];
  unknowns: string[];
  questions: string[];
  readiness: 'early' | 'partial' | 'ready';
  criteria: {
    id: string;
    score: number | null;
    reasoning: string;
    evidenceIds: string[];
  }[];
};
export type Evaluation = {
  id: string;
  projectId: string;
  submissionId: string;
  checkpoint: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  createdAt: string;
  finishedAt?: string;
  startedAt?: string;
  workflowRunId?: string;
  dispatchAt?: string;
  error?: string;
  model: string;
  promptVersion: string;
  rubric: Criterion[];
  assessment?: Assessment;
  sources: { id: string; label: string; url?: string; text: string }[];
  tokens?: number;
  sample?: boolean;
};
export type HelpRequest = {
  id: string;
  projectId: string;
  type: string;
  note: string;
  createdAt: string;
  status: 'open' | 'claimed' | 'resolved';
  claimedBy?: string;
  claimedName?: string;
};
export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  text: string;
};
export type DeskEvent = {
  githubTracker?: import('./github-tracker').GithubTracker;
  id: string;
  name: string;
  theme: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  shortlistTarget: number;
  currentCheckpoint: number;
  stage: Stage;
  checkpoints: { title: string; dueAt: string }[];
  rubric: Criterion[];
  participantCode: string;
  mentorCode: string;
  demo: boolean;
  revision: number;
  approvedAt?: string;
  projects: Project[];
  reviews: Review[];
  evaluations: Evaluation[];
  help: HelpRequest[];
  conflicts: { mentorId: string; projectId: string; reason: string }[];
  locks: { projectId: string; mentorId: string; expiresAt: string }[];
  audit: AuditEntry[];
};
export type User = {
  id: string;
  eventId: string;
  role: Role;
  name: string;
  email: string;
  skills: string[];
};
export type DeskState = {
  user: User;
  event: DeskEvent;
  mentors: Pick<User, 'id' | 'name' | 'skills'>[];
  aiConfigured: boolean;
  serverTime: string;
  reviewQueue: string[];
};
export type ProjectSignal = {
  project: Project;
  latest?: Submission;
  evaluation?: Evaluation;
  humanScore: number | null;
  aiScore: number | null;
  finalReviews: number;
  checkins: number;
  attention: string[];
};
