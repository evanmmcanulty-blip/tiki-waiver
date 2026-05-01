// ─────────────────────────────────────────────────────────────────────────────
// Tiki House Guest Check-In — Apps Script doPost handler
//
// HOW TO INSTALL
//   1. Open https://script.google.com and find the existing project bound to the
//      Tiki Waiver Log spreadsheet.
//   2. Replace the entire Code.gs contents with this file's contents.
//   3. KIOSK_TOKEN below MUST match the KIOSK_TOKEN constant in index.html.
//      Rotate by changing both at once.
//   4. Update ALLOWED_HOSTS if you add or remove approved users.
//   5. Deploy → Manage deployments → edit the existing web app deployment →
//      "New version" → save. The deployment URL stays the same so the client
//      doesn't need to change.
//   6. (Optional but recommended) Project Settings → Triggers → add a daily
//      trigger for `dailySelfCheck` so you get an email if no waivers are
//      logged for 7+ days (catches silent breakage).
//
// WHAT THIS DOES
//   - Rejects any request without the matching kiosk_token (stops drive-by
//     POSTs from anyone who scrapes the deployment URL out of the public site).
//   - Validates schema: name length, host in allowlist, dates parseable.
//   - Per-script rate limit: drops repeated submissions within 8 seconds.
//   - Appends a row to the active spreadsheet's first sheet.
//   - Returns JSON {ok: true} on success or {ok: false, reason: '...'} on
//     rejection (the client uses no-cors so it can't read this, but it appears
//     in the Apps Script execution log for debugging).
// ─────────────────────────────────────────────────────────────────────────────

const KIOSK_TOKEN = 'kiosk_2026_a3f8e1d7c4b2'; // MUST match index.html

const ALLOWED_HOSTS = [
  'Brandon','Brett','Monty','Trey','Thomas','Fernando','Jason','Kris','KK'
];

const RATE_LIMIT_WINDOW_MS = 8000;
const ALERT_RECIPIENT = 'emcanulty@allprorecon.com';

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return jsonResp({ ok: false, reason: 'busy' });
  }
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResp({ ok: false, reason: 'no-body' });
    }

    let data;
    try { data = JSON.parse(e.postData.contents); }
    catch (err) { return jsonResp({ ok: false, reason: 'bad-json' }); }

    // Token gate — first line of defense against drive-by abuse.
    if (data.kiosk_token !== KIOSK_TOKEN) {
      return jsonResp({ ok: false, reason: 'bad-token' });
    }

    // Schema validation — server-side mirror of the client gates so devtools
    // bypass on the kiosk side still gets caught here.
    const name = String(data.guest_name || '').trim();
    const host = String(data.host_name || '').trim();
    const arrival = String(data.arrival_date || '').trim();
    const departure = String(data.departure_date || '').trim();

    if (name.length < 3 || name.length > 80) {
      return jsonResp({ ok: false, reason: 'bad-name' });
    }
    if (ALLOWED_HOSTS.indexOf(host) === -1) {
      return jsonResp({ ok: false, reason: 'bad-host' });
    }
    if (!arrival || !departure) {
      return jsonResp({ ok: false, reason: 'bad-dates' });
    }

    // Per-script rate limit. Coarse but adequate for a kiosk: legitimate
    // back-to-back guests are spaced by reading + signing time, so 8 seconds
    // doesn't impact real use but stops scripted bursts.
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const lastTs = parseInt(props.getProperty('last_submit_ts') || '0', 10);
    if (now - lastTs < RATE_LIMIT_WINDOW_MS) {
      return jsonResp({ ok: false, reason: 'rate-limited' });
    }
    props.setProperty('last_submit_ts', String(now));

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    sheet.appendRow([
      new Date(),
      name,
      host,
      arrival,
      departure,
      String(data.signed_at || ''),
      String(data.waiver_version || ''),
      String(data.email_status || '')
    ]);

    return jsonResp({ ok: true });
  } catch (err) {
    return jsonResp({ ok: false, reason: 'server-error', detail: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily self-check — set up a time-driven trigger to run this once a day.
// Emails the owner if the log has gone quiet for a week, which usually means
// the deployment URL drifted or auth lapsed.
// ─────────────────────────────────────────────────────────────────────────────
function dailySelfCheck() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const lastTs = sheet.getRange(lastRow, 1).getValue();
  if (!(lastTs instanceof Date)) return;

  const ageDays = (Date.now() - lastTs.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays >= 7) {
    MailApp.sendEmail({
      to: ALERT_RECIPIENT,
      subject: 'Tiki Waiver: log quiet for 7+ days',
      body: 'No waiver entries have arrived in the past ' + Math.floor(ageDays) +
            ' days. Verify the kiosk Apps Script deployment URL still matches ' +
            'the SHEET_ENDPOINT in index.html and that the page loads.'
    });
  }
}
