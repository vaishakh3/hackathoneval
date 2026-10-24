'use client';

import { useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, GitBranch } from 'lucide-react';
import type { GithubTracker } from '@/lib/desk/github-tracker';
import { Badge, Button, dateTime, type WorkspaceProps } from './ui';

const submissionSource = {
  spreadsheetId: '1Vj2u4DHR_Sqpnr2K3xfZPwdjCXMxokVaYy9Pns7VXFM',
  gid: 925423988,
  sheetName: 'Form Responses 1',
};

export function GithubTrackerView({ data }: WorkspaceProps) {
  const [tracker, setTracker] = useState<GithubTracker | undefined>(
    data.event.githubTracker,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Ordinary workspace polling supplies current server state without scheduling work in the browser.
  const current = data.event.githubTracker || tracker;
  const repos = Object.values(current?.repositories || {}).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
  const unresolved = current?.rows.filter((r) => r.issue) || [];
  const active =
    !!current?.lastBridgeAt &&
    Date.parse(data.serverTime) - Date.parse(current.lastBridgeAt) < 30 * 60000;

  async function send(action: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/desk/tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, source: submissionSource }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(
          result.error || 'Tracker setup could not be completed.',
        );
      }
      if (action === 'bridge') {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = 'tracker-bridge.gs';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const state = await fetch('/api/desk/tracker', { cache: 'no-store' });
        if (!state.ok) throw new Error('Could not reload tracker settings.');
        setTracker(
          ((await state.json()) as { tracker: GithubTracker }).tracker,
        );
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="d-page-heading">
        <div>
          <p className="d-eyebrow">Submission coverage</p>
          <h1>GitHub tracker</h1>
          <p>
            Follow every submitted repository, including builders who join
            later.
          </p>
        </div>
        <GitBranch size={26} aria-hidden="true" />
      </div>
      {error && (
        <div className="d-connection-error" role="alert">
          {error}
        </div>
      )}
      {!current ? (
        <section className="d-tracker-setup">
          <h2>Connect the submission sheet</h2>
          <p>
            Import the current responses and include new or corrected
            submissions automatically. Google runs the sync on form submission
            and every 15 minutes.
          </p>
          <Button
            primary
            busy={busy}
            disabled={data.event.demo}
            onClick={() => void send('connect')}
          >
            Connect submission sheet
          </Button>
          {data.event.demo && (
            <p>Create a real event to connect the response sheet.</p>
          )}
        </section>
      ) : (
        <>
          <div className="d-event-banner">
            <div>
              <strong>
                {active
                  ? 'Automatic syncing is active.'
                  : current.lastBridgeAt
                    ? 'The sheet sync needs attention.'
                    : 'Finish connecting Google Sheets.'}
              </strong>
              <p>
                {current.lastBridgeAt
                  ? `Last sheet sync: ${dateTime(current.lastBridgeAt)}. ${active ? 'New submissions are included automatically.' : 'The last sync is over 30 minutes old. Check the Google trigger execution history.'}`
                  : 'Install the private sheet bridge once to keep tracking running when your computer is closed.'}
              </p>
            </div>
            <Badge tone={active ? 'green' : 'amber'}>
              {active ? 'Connected' : 'Setup needed'}
            </Badge>
          </div>
          <div className="d-metrics d-tracker-metrics">
            {[
              [current.rows.length, 'Response rows'],
              [repos.length, 'Tracked repositories'],
              [
                repos.filter((r) => r.status === 'tracking').length,
                'Readable repositories',
              ],
              [unresolved.length, 'Need a repo link'],
            ].map(([value, label]) => (
              <div className="d-tracker-metric" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          {!active && (
            <section className="d-tracker-setup">
              <h2>Enable automatic updates</h2>
              <ol>
                <li>
                  Open the response spreadsheet, then choose Extensions → Apps
                  Script.
                </li>
                <li>
                  Download the private bridge below and paste it into the
                  sheet’s script editor.
                </li>
                <li>
                  Run <code>installTrackerBridge</code> once and approve the
                  Google permissions. The first sync must succeed before the
                  triggers are installed.
                </li>
              </ol>
              <p>
                The bridge sends submission timestamps, participant names and
                repository links to this event. Email addresses and phone
                numbers are omitted. Keep the bridge private.
              </p>
              <Button busy={busy} onClick={() => void send('bridge')}>
                <ArrowDownToLine size={15} />
                Download private sheet bridge
              </Button>
            </section>
          )}
          <div className="d-tracker-section-heading">
            <h2>Repositories</h2>
            <a
              href={`https://docs.google.com/spreadsheets/d/${current.source.spreadsheetId}/edit?gid=${current.source.gid}`}
              target="_blank"
              rel="noreferrer"
            >
              Open submission sheet <ArrowUpRight size={14} />
            </a>
          </div>
          <p className="d-muted">
            A first observed commit establishes a baseline. Empty or
            inaccessible repos remain included and are retried. Late entrants
            are considered as soon as a valid link arrives.
          </p>
          <div className="d-table-scroll">
            <table className="d-project-table">
              <thead>
                <tr>
                  <th>Participant / repository</th>
                  <th>Sheet row</th>
                  <th>Status</th>
                  <th>Latest observed commit</th>
                  <th>Changes observed</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <tr key={repo.key}>
                    <td>
                      <strong>
                        {repo.participants.join(', ') || 'Participant pending'}
                      </strong>
                      <br />
                      <a href={repo.url} target="_blank" rel="noreferrer">
                        {repo.fullName}
                      </a>
                    </td>
                    <td>
                      {repo.sourceRows.join(', ') || 'Previously submitted'}
                    </td>
                    <td>
                      <Badge
                        tone={repo.status === 'tracking' ? 'green' : 'amber'}
                      >
                        {repo.status}
                      </Badge>
                      {repo.error && (
                        <small className="d-cell-note">{repo.error}</small>
                      )}
                    </td>
                    <td>
                      {repo.sha ? (
                        <a
                          href={`${repo.url}/commit/${repo.sha}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {repo.sha.slice(0, 7)}
                        </a>
                      ) : (
                        'Awaiting a readable commit'
                      )}
                      <small className="d-cell-note">
                        {repo.lastSuccessAt
                          ? dateTime(repo.lastSuccessAt)
                          : 'Not observed yet'}
                      </small>
                    </td>
                    <td>{repo.changes.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unresolved.length > 0 && (
            <section className="d-tracker-setup">
              <h2>Unresolved submissions</h2>
              <p>
                These rows are retained and checked on every sync. Correct their
                repo links in the form response sheet.
              </p>
              <div className="d-table-scroll">
                <table className="d-project-table">
                  <thead>
                    <tr>
                      <th>Sheet row</th>
                      <th>Participant</th>
                      <th>Needs attention</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unresolved.map((row) => (
                      <tr key={row.row}>
                        <td>{row.row}</td>
                        <td>
                          {row.participantName || 'Unavailable in source'}
                        </td>
                        <td>{row.issue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
