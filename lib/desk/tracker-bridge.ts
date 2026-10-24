import { trackerKey, type TrackerSource } from './github-tracker';

export function sheetBridgeScript(
  eventId: string,
  source: TrackerSource,
  appOrigin: string,
) {
  const config = JSON.stringify({
    eventId,
    source,
    endpoint: `${appOrigin}/api/desk/tracker/ingest`,
    secret: trackerKey(eventId),
  });
  return `/** @OnlyCurrentDoc */
// Private bridge for this event. Keep this code and its script properties private.
// Bind this script to the response spreadsheet, then run installTrackerBridge once.
const TRACKER_CONFIG = ${config};

function installTrackerBridge() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== TRACKER_CONFIG.source.spreadsheetId) throw new Error('Bind this script to the intended response spreadsheet.');
  PropertiesService.getScriptProperties().setProperty('TRACKER_CONFIG', JSON.stringify(TRACKER_CONFIG));
  // Establish a successful full sync before installing recurring triggers.
  syncTrackerSheet();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncTrackerSheet').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncTrackerSheet').forSpreadsheet(spreadsheet).onFormSubmit().create();
  ScriptApp.newTrigger('syncTrackerSheet').timeBased().everyMinutes(15).create();
}

function syncTrackerSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const config = JSON.parse(PropertiesService.getScriptProperties().getProperty('TRACKER_CONFIG') || '{}');
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet || spreadsheet.getId() !== config.source.spreadsheetId) throw new Error('Wrong response spreadsheet.');
    const sheet = spreadsheet.getSheets().find(s => s.getSheetId() === config.source.gid);
    if (!sheet) throw new Error('Response tab not found.');
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow > 2001) throw new Error('The response sheet exceeds the configured 2000-response limit.');
    if (!lastRow || lastColumn < 4) throw new Error('The response sheet appears incomplete. Previous coverage has been preserved.');
    const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
    const header = values[0].map(v => v.trim().toLowerCase());
    let repoColumn = header.findIndex(v => /github|repository|repo url/.test(v));
    let nameColumn = header.findIndex(v => /^(full name|name|participant name|team name)$/.test(v));
    let timestampColumn = header.findIndex(v => /timestamp|submitted at/.test(v));
    // The supplied form has damaged headers; D was verified against its actual repo links.
    if (repoColumn < 0) {
      if (!values.slice(1).some(r => /(?:www\\.)?github\\.com[/:]/i.test(r[3] || ''))) throw new Error('Cannot safely identify the repository column. Previous coverage has been preserved.');
      repoColumn = 3;
    }
    if (nameColumn < 0) nameColumn = 2;
    if (timestampColumn < 0) timestampColumn = 0;
    const rows = [];
    values.slice(1).forEach((r, index) => {
      if (!r.some(c => c.trim())) return;
      const submittedAt = r[timestampColumn] || '';
      const timestampOnly = r.filter(c => c.trim()).every(c => c === submittedAt);
      rows.push({ row: index + 2, submittedAt, participantName: timestampOnly ? '' : String(r[nameColumn] || '').slice(0, 200), repoCandidate: timestampOnly ? '' : String(r[repoColumn] || '').slice(0, 1000), timestampOnly });
    });
    const body = JSON.stringify({ eventId: config.eventId, source: config.source, capturedAt: new Date().toISOString(), rows });
    const timestamp = String(Date.now());
    const signature = Utilities.computeHmacSha256Signature(timestamp + '.' + body, config.secret).map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
    const response = UrlFetchApp.fetch(config.endpoint, { method: 'post', contentType: 'application/json', payload: body, headers: { 'x-tracker-timestamp': timestamp, 'x-tracker-signature': signature }, followRedirects: false, muteHttpExceptions: true });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Tracker sync failed (HTTP ' + response.getResponseCode() + '). Existing coverage is retained; the next trigger retries.');
    PropertiesService.getScriptProperties().setProperty('TRACKER_LAST_SUCCESS', new Date().toISOString());
  } finally { lock.releaseLock(); }
}
`;
}
