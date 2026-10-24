# Devin Hacks Kochi — Build Desk

An MVP for continuously evaluating up to 100 solo hackathon projects and choosing 5–10 finalist demos. The existing community homepage remains at `/`; the evaluation workspace is at `/desk`.

## Run

Requires Node.js 24. The Vercel deployment uses the same runtime.

```sh
npm install
npm run dev
```

Open [http://localhost:3000/desk](http://localhost:3000/desk). Choose **Explore a sample event** to try an isolated fictional event with 100 projects and switch between organizer, mentor, and participant views. Sample AI assessments are labeled examples; this mode never makes paid model calls.

Choose **Create event** for a real event. The default name is Devin Hacks Kochi. Organizer settings provide separate participant and mentor invitations, three checkpoint deadlines, a shared weighted rubric, and the number of demo slots. A saved event template reuses only the setup and starts with fresh projects and invitation codes.

## Event workflow

1. Participants register through an invitation, describe their project and starting point, then submit timestamped checkpoint updates with links or images. Submitted evidence and project metadata are preserved as snapshots. Draft editing does not change an evaluator’s submitted version.
2. Every real submission queues an evidence-based AI assessment. Mentors independently claim projects, record early check-ins, and later verify a working flow and score the final rubric. AI findings unlock for each mentor only after their independent review. Conflicts exclude that mentor’s scores.
3. Organizers track coverage, support requests, disagreements, and candidates. The queue spreads work across mentors and prioritizes missing reviews, finalists, disagreements, and projects near the human-score cutoff. AI ratings remain separate and do not contribute to the ranking.
4. Organizers select 5–10 demos and record a reason for each. Approval requires at least one final human review for every final submission and two independent reviews for each finalist. Resubmissions invalidate old scores; late conflicts reopen an affected approved lineup. Reopening requires an audited reason.
5. Export scores to CSV, event content to JSON, or factual finalist briefs for the panel. Judge briefs omit earlier ratings to support independent final judging.

## AI configuration

The server reads `OPENAI_API_KEY` from the ignored `.env.local`. A key has already been provisioned securely for this workspace. Never put it in a `NEXT_PUBLIC_*` variable or commit it. Optional settings:

```dotenv
OPENAI_MODEL=gpt-5.4-mini
# Optional separate model for repository feature reviews:
# REPO_JUDGE_MODEL=gpt-5.4-mini
# Optional GitHub token for higher public-repository rate limits:
# GITHUB_TOKEN=...
# Optional persistent database location:
# DESK_DB_PATH=/absolute/path/desk.sqlite
```

The model receives submission text, uploaded evidence images, and bounded snapshots of public GitHub repositories: a pinned commit, its README, and up to two changed source files. Arbitrary demo links are not fetched, repositories are not executed, and missing evidence remains unknown. Mentors must verify actual behavior. Participant text and repository content are treated as untrusted evidence. Submitted evidence is sent to OpenAI for assessment; explain this to participants before collection.

Jobs have persistent queued/running/completed/failed states, a three-job concurrency limit per event, bounded retries, and recovery of interrupted runs. Vercel Workflow runs evaluations in the background and continues after the browser closes. A database outbox records dispatch attempts; later authenticated requests recover an interrupted dispatch. Checkpoint workflow steps receive event and evaluation IDs; project evidence remains in the application database and private storage. Repository judge steps also process bounded public source snapshots and intermediate findings.

For ongoing repository monitoring from a changing registration sheet, see [sheet-driven GitHub tracking](docs/github-tracker.md). A bound Google Apps Script sends signed snapshots on every form submission and every 15 minutes. The deployed app adds late submissions, retains missing links for retry, and records default-branch commit changes without a local computer running.

### Repository AI judge

In **GitHub tracker**, organizers can enable the repository judge. Every current, readable submitted repository queues a review of its exact latest observed default-branch SHA. Later submissions and changed commits are queued by the hosted sheet bridge. Unchanged commits reuse their report. Three durable workers drain the queue without an open browser or Codex session; transient failures retry up to three times. Older reports remain available while a newer commit is being reviewed.

Each review inventories implemented, partial, scaffolded, and documentation-only features, with commit-pinned file and line citations, architecture, recent changes, material caveats, and questions for the builder. Search repositories or participants, open **View review**, and download a Markdown report. This judge provides source evidence and does not alter the human finalist ranking.

The judge inspects application code, UI, API handlers, data models, configuration, and tests across the repository. It downloads a bounded public archive (12 MB compressed / 64 MB expanded), falling back to individual pinned files through GitHub's tree API when the archive is unavailable or oversized. It excludes credentials, dependencies, generated files and binaries, and reads up to 160 eligible files / 720,000 source characters in multiple model batches. Reports disclose omitted/truncated files, incomplete trees, and unavailable diffs. It never executes repository code, builds, tests, or demos; an implemented source path is not proof that the deployed feature works. Projects without accessible supported source remain unjudged rather than receiving a negative score. Repository evidence and findings are processed by OpenAI and the durable workflow service.

## Storage and access

On Vercel, Neon Postgres stores event data, users, hashed sessions, review history, and audit records. Vercel private Blob stores image evidence, served only through an authenticated route. PostgreSQL transaction locks keep simultaneous registrations, reviews, uploads, and rate-limit increments consistent across instances. Participant polling filters other projects out inside the database before returning data.

Local development can use SQLite (without `DATABASE_URL`) or the hosted database. A local `DESK_DB_PATH` forces SQLite for isolated tests. Hosted environments use separate database schemas: production defaults to `desk`, local development uses `desk_dev`, and automated remote checks use disposable `desk_test_*` schemas. Never point a preview or test run at the production schema.

Passwords use salted scrypt; session cookies are HTTP-only, SameSite=Lax, and secure in production. The server enforces event boundaries, roles, invitation-derived access, review locks, evidence ownership, validation, and rate limits. Real events have no role switch. Production event creation requires `ORGANIZER_SETUP_CODE`; sample events are available only locally, so a public visitor cannot start paid evaluations by creating an arbitrary event.

Accounts currently belong to one event, and there is no password-reset or email-delivery service in this MVP. Invitation links are copied and shared manually. The sample event and real events are isolated.

## Vercel deployment

The deployment project is `animaregems-projects/hackathoneval`. Production application functions, private Blob, and Neon are in Singapore (`sin1`). The database uses the Neon Free plan; normal Vercel, storage, workflow, and OpenAI usage limits still apply.

1. The deployment owner creates their organizer account in **Create event**, using the private organizer setup code from the deployment owner. An existing organizer can sign in directly.
2. In **Event settings**, set the actual event dates, checkpoint deadlines, rubric, and number of demo slots.
3. Copy the separate participant and mentor invitation links. These point directly at the deployed `/desk` workspace.

`OPENAI_API_KEY`, `ORGANIZER_SETUP_CODE`, and `TRACKER_BRIDGE_SECRET` are Vercel production secrets. The Neon and private Blob integrations provision their environment variables. Do not copy production credentials into previews or publish `.env*`, `.data`, `.vercel`, or `outputs`; `.vercelignore` excludes these from uploads.

For a fresh database, load the intended environment through a secure env file and run `npm run db:migrate` with `DATABASE_URL` and the optional `DESK_DB_SCHEMA`. Migrations are versioned in `lib/desk/migrations/` and use the direct connection when `DATABASE_URL_UNPOOLED` is available. Never run test cleanup against an application schema.

Release a tested production build:

```sh
vercel deploy --prod --skip-domain --scope animaregems-projects
# Verify the returned exact deployment URL.
vercel promote <verified-deployment-url> --scope animaregems-projects
```

`vercel curl` can test a protected deployment using the CLI's own authentication. The HTTP smoke script supports `DESK_TEST_PROTECTED=1` for this, and never extracts the CLI's bypass credential. After release, check that the stable production URL works without Vercel sign-in; application sign-in still protects projects and evidence.

## Verify

```sh
npm run test:desk
npm run test:tracker
npm run test:judge
npx tsx --test scripts/desk-concurrency.test.ts
npx tsc --noEmit
npx oxlint app/api/desk app/desk components/desk lib/desk workflows scripts
npm run build
```

The automated suite defaults to a temporary SQLite database and covers a 100-project event, role boundaries, immutable submissions, review locks, blind evaluation, conflicts, approval gates, queue assignment, templates, and export escaping.

With the development server running, `npm run test:desk:live` performs one real OpenAI assessment and verifies the complete participant → AI → independent mentor review flow over HTTP. It consumes API usage and removes only its uniquely identified test event afterward. For hosted testing, load the matching database environment and supply `DESK_TEST_URL`, `DESK_TEST_CLEANUP=1`, and `DESK_TEST_PROTECTED=1` when needed. The test also verifies private image uploads and cross-participant denial. It must use the same database schema as the deployed application to clean up its own fixture.

## Reference

The MVP takes workflow ideas from [Mentor Desk](https://github.com/jasimcm/mentor-desk): shared rubrics, independent reviews, conflict declarations, support requests, and considered shortlisting. This implementation adds immutable checkpoint history, parallel AI evidence, coverage-first review assignment, and explicit finalist approval gates.
