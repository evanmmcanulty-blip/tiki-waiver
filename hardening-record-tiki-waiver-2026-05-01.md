# Hardening Record — Tiki Waiver Kiosk — 2026-05-01

## What was hardened

| Finding | Severity | Status | Where |
|---|---|---|---|
| C1 — Apps Script URL accepts unauthenticated POSTs | Critical | Client side fixed; **Apps Script paste required** | `index.html` adds `kiosk_token`; `apps-script.gs` enforces it |
| C2 — EmailJS public key may be unrestricted | Critical | **Dashboard action required** | EmailJS dashboard |
| H1 — XSS via guest name in log render | High | Fixed | `index.html` renderLog now uses `textContent` + DOM construction |
| H2 — No rate limit / honeypot | High | Fixed (client + server) | 15s client cooldown + offscreen honeypot input + 8s Apps Script rate limit |
| H3 — Submit gating fully client-side | High | Fixed via Apps Script schema validation | `doPost` rejects bad name length, unknown host, missing dates |
| H4 — Third-party PII processing not disclosed | High | Fixed | New Section 15 "Record Storage" added to waiver; `WAIVER_VERSION` bumped to `v3` |
| H5 — Apps Script failures silent | High | Fixed | New `confirm-sheet-status` pill surfaces transport errors |
| M1 — No CSP header | Medium | Fixed | `<meta http-equiv="Content-Security-Policy">` added |
| M2 — Site iframable | Medium | Fixed | CSP `frame-ancestors 'none'` |
| M3 — No noindex on kiosk-only page | Medium | Fixed | `<meta name="robots" content="noindex,nofollow">` added |
| M4 — Single hardcoded recipient inbox | Medium | Open — operational decision | See "What I couldn't verify" |
| L2 — Signature exported as 300×90 JPEG q0.5 | Low | Fixed | Now 480×144 PNG with JPEG q0.85 fallback if size exceeds EmailJS limit |

### Before / after summary of code changes

- **`<head>`**: added `meta robots noindex,nofollow` and a tight Content-Security-Policy that pins script/style/font/img/connect sources, blocks framing, and locks form actions to self.
- **Landing form**: added a hidden honeypot input (`#hp-website`) — off-screen, untabbable, hidden from screen readers.
- **Waiver document**: added Section 15 "Record Storage" disclosing third-party processing (EmailJS, Google Workspace). `WAIVER_VERSION` bumped to `v3`.
- **Confirm screen**: added a second status pill (`#confirm-sheet-status`) so sheet-log transport failures are visible alongside email status.
- **`state`**: added `lastSubmittedAt` and `isSubmitting`; `SUBMIT_COOLDOWN_MS` constant set to 15000.
- **`KIOSK_TOKEN`**: shared validator constant — must match Apps Script. Current value `kiosk_2026_a3f8e1d7c4b2`. Rotate by updating both files.
- **Submit handler**: honeypot check → concurrency guard → cooldown guard → submit-button disabled while in flight → fires email + sheet POST in parallel → both outcomes surfaced as separate status pills → `isSubmitting` released.
- **Sheet POST body**: now includes `kiosk_token`.
- **Signature export**: 300×90 JPEG q0.5 → 480×144 PNG (with JPEG q0.85 fallback if >48KB).
- **`renderLog`**: replaced template-string `innerHTML` with safe `document.createElement` + `textContent` construction.

## New disclosures or policy language

**Section 15 — Record Storage** (now present in `index.html`, fires `WAIVER_VERSION = v3`):

> The Guest acknowledges that this Waiver, including the Guest's name and signature image, is recorded for compliance purposes and transmitted through third-party services — currently EmailJS and Google Workspace — for record-keeping and operational notification. The Company shall protect such records with reasonable security and shall not share them outside the parties identified in this Waiver except as required by law.

**Toast copy** (new, shown when a guest taps submit during cooldown):

> Kiosk is processing — please wait

**Sheet failure copy** (new, on confirm screen if Apps Script fetch errors):

> ⚠ Sheet log failed — check connection

## Where credentials live

| Credential | Location | State | Recommended action |
|---|---|---|---|
| EmailJS public key `htbLz3cS-R-U5fONO` | `index.html`:1201 | In client source. Intentional per EmailJS design. | **Lock to origin** in EmailJS dashboard (see "What to do next"). Once locked, no rotation needed. |
| EmailJS service ID `service_irr91tj` | `index.html`:1202 | In client. Not sensitive in isolation. | No action. |
| EmailJS template ID `template_qvqz4u5` | `index.html`:1203 | In client. Not sensitive in isolation. | No action. |
| Recipient email `emcanulty@allprorecon.com` | `index.html`:1204 | In client. Business email, intentional. | No action. |
| Google Apps Script URL `/AKfyc.../exec` | `index.html`:1207 | In client. Effectively a public endpoint. | Endpoint **must** be paired with `kiosk_token` validation in `doPost` (see `apps-script.gs`). |
| `KIOSK_TOKEN` `kiosk_2026_a3f8e1d7c4b2` | `index.html` + `apps-script.gs` | Shared between client and Apps Script. Not a true secret. | Rotate by changing both constants together if abuse observed. |

## Environment variables

This is a static site; there are no env vars. All configuration lives in `index.html` and `apps-script.gs`. The constants that must stay in sync between those two files:

- `KIOSK_TOKEN` — exact string match required.
- `WAIVER_VERSION` — bump in `index.html` whenever the waiver text changes; the Apps Script logs whatever it receives.

## What to monitor

| Signal | Threshold | Where |
|---|---|---|
| Daily waiver count | Alert if > 30/day or 0 for 7 consecutive days | `dailySelfCheck` in `apps-script.gs` (set up a time trigger) |
| EmailJS quota | Alert at 80% of monthly limit | EmailJS dashboard → set email alert |
| Apps Script error rate | Spike above baseline | Apps Script → Executions view, check weekly |
| Sheet pollution | Manual scan once a month for known-bad host names or impossible dates | Spreadsheet itself |
| Recipient inbox volume | Spike in `tiki-waiver` tagged messages | Gmail filter + label suggested |

## What to test before shipping

1. **Honeypot trip:** open devtools, set `document.getElementById('hp-website').value = 'x'`, submit. Confirm: nothing happens, no email, no sheet row.
2. **Cooldown trip:** complete one waiver. Immediately try a second submit within 15s of the first. Confirm: toast shows "Kiosk is processing — please wait" and submission is blocked.
3. **Bad token at server:** in browser console, manually `fetch(SHEET_ENDPOINT, {method:'POST', mode:'no-cors', body: JSON.stringify({kiosk_token:'wrong', guest_name:'X', host_name:'Brandon'})})`. Then check the Apps Script execution log — should show the request was rejected with `bad-token`. No row should be appended.
4. **CSP enforcement:** in devtools network tab during a normal flow, confirm no console errors from CSP. If something is blocked, the legitimate origin needs to be added to `connect-src`.
5. **Sheet status visible:** unplug WiFi, complete a waiver. Confirm the "⚠ Sheet log failed" pill appears on the confirm screen.
6. **XSS regression:** type `<img src=x onerror=alert(1)>` as a guest name and submit. Then go to the log screen. Confirm: the literal string appears, no alert fires.
7. **Signature fidelity:** complete a waiver, check the resulting email. Signature should be visibly sharper than the prior 300×90 q0.5 JPEG.
8. **Apps Script daily trigger:** in script.google.com, manually run `dailySelfCheck` once. Should not error. Then pause logging for a week (or temporarily lower the 7-day threshold for a one-shot test) to verify the alert email actually arrives.

## What to do next (you, manually)

1. **EmailJS dashboard** — Account → Security → Allowed Origins → set to `https://evanmmcanulty-blip.github.io`. This converts C2 from "Likely Critical" to "Resolved." 60 seconds.
2. **Paste `apps-script.gs`** into your existing Apps Script project (not a new one — same deployment URL). Deploy → Manage deployments → edit existing web app deployment → New version → save. The URL stays the same so the client doesn't change.
3. **Optional: add the daily trigger** — Apps Script project settings → Triggers → add `dailySelfCheck` → time-driven → daily. You'll get an email if the kiosk goes quiet for a week.
4. **Commit + push** the index.html, apps-script.gs, and this hardening-record.md once you've reviewed.

## What I couldn't verify and why

1. **Whether EmailJS Allowed Origins is currently set.** Only you can check the dashboard. Until it's set, C2 stays Critical even though the client code is unchanged from a token-handling perspective.
2. **Whether the existing Apps Script `doPost(e)` validates anything today.** I wrote a replacement (`apps-script.gs`) but I haven't seen the current script. If the existing one already does validation, replacing it wholesale may regress something specific to your sheet structure — review the `appendRow` column order before pasting and adjust if your sheet has different columns.
3. **Whether the Apps Script URL has been pasted anywhere outside this repo.** If it's in old emails, Slack messages, or notes, treat it as fully leaked — token validation on the server is the load-bearing fix regardless.
4. **Real-world signature compression behavior across iPad versions.** I bumped fidelity from 300×90 JPEG q0.5 to 480×144 PNG with a JPEG q0.85 fallback at >48KB. Tested logically against the EmailJS 50KB variable limit, not measured on a real iPad signing session. Worth one real-device test before you stop watching for "email failed" status.
5. **Whether GitHub Pages might add CSP via repo settings later.** The CSP I added is a `<meta>` tag, which works but is weaker than an HTTP header. If you ever move to a host that lets you set headers (Cloudflare Pages, Netlify, etc.), promote the CSP to a real header.
6. **Whether the sheet log has *already* been polluted** by anyone who scraped the URL before today. I didn't audit historical sheet contents. Worth a quick scan of recent rows for known-bad host names or impossible dates.
7. **Browser support for `'unsafe-inline'`-free CSP.** The current CSP allows `'unsafe-inline'` for scripts because the entire app is one inline `<script>`. Tightening this requires extracting the script to a separate file — out of scope for this audit but worth doing on the next major refactor.

---

Generated by `#FORTIFY` — 2026-05-01
