# Studio check-in — project context

A gift for a small, growing dance studio: students check themselves in by tapping an NFC tag
or scanning a QR code by the door with their own phone. The owner gets a Google Sheet that
fills itself in, a Dashboard tab and a Monday email. The builder is a long-time student there,
not the owner.

## Constraints — the point of the project

- **No recurring costs, ever.** It's a gift. Google Sheets + Apps Script + GitHub Pages only.
- **Effortless for students and the owner.** One tap for a returning student; the owner never
  has to sync, export or maintain anything beyond the class schedule and packages.
- **Everything lives in the studio's own accounts** so it never depends on the builder.
- **The studio has no Wi-Fi.** The check-in device can't be online; the student's phone carries
  the check-in over cellular (signal there is fine).

## Releases

- **1.0 (this):** adult classes. A static NFC sticker + QR (`?t=static`) on a printed sign.
  Do not call this "v0" — the user wants it to be version 1.
- **Later — rotating-code totem:** ESP32-S3 display board (Waveshare ESP32-S3-Touch-LCD-3.5) +
  Adafruit ST25DV16K dynamic NFC tag, showing `?t=<time step>&s=<HMAC>`. The server tracks the
  totem's clock drift (rolling median offset, re-anchor when several different students agree).
  `codeSource_()` in Logic.gs is where verification will go; until then those codes are
  recorded as `unverified`. For adults this is low priority: checking in *costs* a class credit,
  so nobody fakes attendance.
- **Later — kids' classes:** fobs on the totem; an instructor's phone carries the kids' taps.
- **Later — Wix:** read the schedule and package purchases from the studio's Wix site (likely the
  Core plan) instead of the Schedule tab. Read-only; never write bookings back.

## Layout

```
apps-script/Logic.gs     the rules — pure JS, no Google services. Shared by all three below.
apps-script/Code.gs      Sheet I/O, doPost API, owner menu, Dashboard, weekly email
apps-script/appsscript.json
web/                     the check-in page, published to GitHub Pages (static, no build)
  index.html, style.css, app.js, config.js (apiUrl; studioName is a first-visit fallback)
  mock.js                preview-mode backend: runs Logic.gs in the browser
scripts/test_logic.js    Node tests for Logic.gs
scripts/serve.js         local preview server (serves .gs as JS)
docs/SETUP.md            deployment and owner how-to
```

## Architecture rules

1. **Apps Script is an API, never a page.** The page is static on GitHub Pages and calls
   `doPost` with `fetch`. Serving HTML from Apps Script (HtmlService) is what made the builder's
   other project slow and gave it Google's "created by an Apps Script user" banner. Don't.
2. **POST as `text/plain`.** It keeps the request "simple" so the browser sends no CORS preflight,
   which Apps Script can't answer.
3. **Logic.gs stays pure.** No `SpreadsheetApp`, `Utilities`, `Session`… It works on wall-clock
   strings in the studio's time zone: days are `'yyyy-MM-dd'`, times are minutes after midnight.
   Code.gs converts (`nowParts_`, `cell_`). This keeps it testable in Node and runnable in the
   preview.
4. **Header names are the contract** (`SCHEMA` in Logic.gs). Rows are objects keyed by header.
   The owner may reorder or add columns; renaming one breaks it.
5. **Money is derived, never stored** (`ledgerFor_`). Credits used, drop-ins owed and payments are
   recomputed from the rows on every request, so a package entered late, a voided check-in or a
   rejected payment corrects everything at once. A check-in on a day the student has a monthly
   plan (Plans tab: Start → End, blank End = ongoing) is covered by the plan; otherwise it uses a
   credit from the valid package expiring soonest; otherwise it's a drop-in.
   **Deliberately not built yet** (to ask the owner after the gift is given): weekly limits on
   plans (1 vs 2 classes a week isn't enforced), tracking whether the monthly fee is paid (the
   owner bills plans in Venmo), and plans limited to specific classes.
6. **The price is written into the Log row at check-in**, so a later price change doesn't rewrite
   history.
7. **Deletes are soft:** `Status = void` on a Log row; `rejected`/`void` on a Payment.
8. **A repeat check-in is not an error** — it returns `already`. That's what makes the client's
   automatic retries safe. `declarePayment` is *not* retried by the client (a lost response would
   record the payment twice).
9. **One script lock around read → decide → write** in `doPost`, so a double tap can't create two
   rows.
10. A student's self-declared Venmo payment counts immediately (`declared`); the owner confirms or
    rejects it.
11. **Which class** (`todaysClasses_`, `checkin_`): a class is open from `opensMinutesBefore` its
    start to `lateMinutesAfterEnd` after its end (late check-in on the way out). One open class
    not yet checked in → checked in automatically. Several → the student ticks them. Later classes
    today can always be picked early (`more` / `later`), so a series is one check-in. A request
    may carry several `classIds`; ones already checked in come back as `already`.
12. **The Sheet's `studioName` wins.** The page remembers the last name the API sent;
    `config.js` only covers a phone's first visit.

## Commands

```bash
node scripts/test_logic.js      # run before every deploy
node scripts/serve.js           # preview at http://localhost:8642/ (mock backend, no Google needed)
clasp push                      # apps-script/ → the studio's Apps Script project
```

The preview toolbar switches scenarios (one class / two at once / free class / none), adds a
10-class pack, and forgets or resets the fake data.

## Versioning

`APP_VERSION` lives at the top of Logic.gs (semver; currently 1.0.0). Bump it with each release
and redeploy via **Manage deployments → New version** so the URL stays the same.

## Things to verify on real phones

- The Venmo pay link format (`https://venmo.com/<handle>?txn=pay&amount=…&note=…`) and the
  owner-email charge link (`?txn=charge&recipients=…`). Venmo has changed these before.
- iPhone Safari may clear the remembered student after 7 days without interaction on the page
  (possibly even for weekly students, whose check-in needs no tap). The page asks for the email
  only (name just for a new email) and calls `navigator.storage.persist()`, so a forgotten
  student taps their autofilled email. If it's still a nuisance, the planned fix is a passkey
  ("Check in with Face ID"), which lives in the phone's keychain and survives Safari's purge.
