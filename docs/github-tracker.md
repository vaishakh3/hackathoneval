# Hosted sheet-driven GitHub tracking

The organizer’s **GitHub tracker** reads all current repository submissions and monitors each repository’s default-branch commit. Neon persists coverage and observations. A bound Google Apps Script runs in Google’s cloud on every form submission and every 15 minutes, rereading the complete response tab so late submissions and corrections are included. Neither Codex nor a local computer needs to remain open.

## Connect a sheet

1. Sign in as the event organizer and open **GitHub tracker**. Connect the response spreadsheet ID, numeric tab ID, and tab name.
2. Download the private bridge script. It contains an event-specific signing credential; never commit, share, or publish it.
3. Open that spreadsheet’s **Extensions → Apps Script**. Add the downloaded code to the bound project, save it, and run `installTrackerBridge`. Authorize its access to the current spreadsheet, outgoing HTTPS, and its two cloud triggers.
4. Confirm the app shows a recent cloud sync, and Apps Script shows both the spreadsheet form-submit trigger and 15-minute trigger.

Use the stable production app origin in the generated script. Changing `TRACKER_BRIDGE_SECRET` requires regenerating and reinstalling each bridge. Keep the script project restricted to trusted spreadsheet editors.

The bridge dynamically reads the used range on every run, with a 2,000-response guard. It sends only row reference, submission timestamp, participant name, and repository candidate. It omits contact information and other form answers. For the supplied form, damaged headers require the verified A/C/D mapping. Timestamp-only rows remain unresolved and are retried; they are never counted as successfully tracked repositories.

## Coverage and failures

Repository names are case-insensitive. `.git`, `www.github.com`, omitted schemes, SSH-style roots, and trailing punctuation are normalized. Credentials and other hosts are rejected. Duplicate submissions retain each participant’s association. Previous repositories remain monitored even if removed from a later sheet snapshot. Inaccessible repositories and empty repositories are retried, preserving their last successful commit.

Each signed snapshot merges into the event and polls up to 100 repositories, checking the oldest observations first. GitHub’s public Git reference endpoint provides the default-branch SHA without requiring a GitHub API token. Private repositories require appropriate authorized GitHub access; an OpenAI key does not grant that access. Repository contents are not executed.

A first observation establishes a baseline. Later changes record the old and new commit and the observation time; these are activity observations, not quality scores or a complete commit-history audit. OpenAI assessments remain a separate submission workflow.

Failures preserve prior coverage. The UI marks a cloud sync older than 30 minutes as stale. Apps Script execution logs show failed cloud requests, and the next trigger retries. HMAC authentication binds each request to its event, body, and a short timestamp window. Organizer sign-in protects coverage details; other event roles cannot read the tracker.

## Validation and local diagnostics

```sh
npm run test:tracker
TRACKER_LIVE_TEST=1 npm run test:tracker
```

`scripts/github-tracker.mjs` remains an optional local diagnostic reader for a sanitized JSON snapshot, with `parseTsv` support for quoted multiline cells. Its local scheduling is not required for hosted tracking. Keep snapshots, reports, credentials, and bridge files in ignored local paths.
