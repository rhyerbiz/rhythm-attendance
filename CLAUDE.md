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

- **1.0 (this):** adult classes. A static NFC sticker + QR on a printed sign, carrying `?t=<code>`
  from the Sheet's Tags tab (one random code per sign; see rule 11f).
  Do not call this "v0" — the user wants it to be version 1.
- **Later — rotating-code totem:** ESP32-S3 display board (Waveshare ESP32-S3-Touch-LCD-3.5) +
  Adafruit ST25DV16K dynamic NFC tag, showing `?t=<time step>&s=<HMAC>`. The server tracks the
  totem's clock drift (rolling median offset, re-anchor when several different students agree).
  `codeSource_()` in Logic.gs is where verification will go; until then those codes are
  recorded as `unverified` (or refused once the Tags tab has codes). For adults this is low
  priority: checking in *costs* a class credit,
  so nobody fakes attendance.
- **Later — kids' classes:** fobs on the totem; an instructor's phone carries the kids' taps.
- **Later — Wix:** read the schedule and package purchases from the studio's Wix site (likely the
  Core plan) instead of the Schedule tab. Read-only; never write bookings back. The site uses
  Fit by Wix, so classes are Wix Bookings services. Wix API keys can't be read-only, so
  `wixRead_()` in Wix.gs allows only the read calls listed in `WIX_READS`. Every Wix call goes
  through it. Key and IDs are in Script Properties (`wixApiKey`, `wixAccountId`, `wixSiteId`; the site ID can
  be looked up from the account by the one account-level read, `sites`). `wixTest` writes a
  "Wix preview" tab. **Schedule sync (built):** `wixSyncSchedule` (hourly trigger, installed by
  `wixSyncNow`) rewrites a "Wix schedule" tab with the next 14 days of sessions, one row per
  session (FirstDate = LastDate), via the pure `wixScheduleRows_` in Logic.gs. `classesFrom_`
  merges it with Schedule; a typed class with the same name as a Wix class is dropped. Config
  `wixSkip` (default `Kids`) leaves classes out. On a failed sync the tab is kept; it only throws
  after a day without a good sync. **Purchase sync (built):** the same hourly run rewrites a
  "Wix purchases" tab from Pricing Plans orders via the pure `wixPurchaseRows_`; `allPackages_` /
  `allPlans_` merge it into the ledger. Plans named in Config `wixPacks` (default
  `Single Class = 1`) are class passes; any other plan covers classes like a Plans row. Buyers
  are matched by Wix login email (`member` read, needs the key's "Read Members"; cached 6 h).
  Without that permission the rows are written unmatched. In practice almost everyone pays by
  Venmo; Wix "Single Class" purchases (online drop-ins) are what matters, so they aren't charged twice.

## Layout

```
apps-script/Logic.gs     the rules — pure JS, no Google services. Shared by all three below.
apps-script/Code.gs      Sheet I/O, doPost API, owner menu, Dashboard, weekly email, backups
apps-script/Wix.gs       read-only Wix client (allow-listed calls) + "Test the Wix connection"
apps-script/appsscript.json
web/                     the check-in page, published to GitHub Pages (static, no build)
  index.html, style.css, app.js, config.js (dev + prod host/apiUrl; studioName is a fallback)
  owner.html, owner.js   the owner's phone page (rule 11i)
  logo.png               the studio's logo, copied from rhythmdw.com; style.css follows that site's teal and type
  mock.js                preview-mode backend: runs Logic.gs in the browser
scripts/test_logic.js    Node tests for Logic.gs
scripts/serve.js         local preview server (serves .gs as JS)
scripts/push.js          clasp push (+ redeploy) to the dev or prod Apps Script project
deploy/dev.json, prod.json   clasp user, script ID and web app deployment ID per copy
docs/SETUP.md            deployment and owner how-to
docs/TESTING.md          what a fellow student tries on the dev copy, and how to report problems
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
   Payments pay for the check-ins in their `Covers` column first ("Yes, I paid" fills it in);
   payments without it (typed by the owner) pay off the oldest unpaid drop-ins. **The student
   page only ever asks for the check-ins just made** (`account.due`); older unpaid classes are
   the owner's to follow up via the Dashboard and Monday email (an old "debt" may be a cash
   payment not typed in yet). `account.owed` (the whole balance) is for the owner's menu only.
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
11a. **No class open → "I'm here for a class".** Records a Log row with `Status = unscheduled`
    (blank Class, optional note), one per student per day (so retries are safe). `liveLog_` skips
    it, so it costs nothing and isn't a visit until the owner fills in Class and sets `ok`
    (or `void`). `reviewItems_` lists them on the Dashboard and in the weekly email.
11b. **Group chat:** Config `chatLink` (https only) is returned in check-in responses, never put
    in the static page. `chatMode_` decides from the Sheet, not the phone (Safari clears page
    storage after 7 days without interaction): 'full' card for a student's first 3 check-ins,
    then 'mini' (one line), '' once Students → Chat is filled. Join / "Hide this" sends
    `action: 'chat'` (fire-and-forget, keepalive), which writes `joined|hidden <date>` there.
    New columns like Chat are added to older tabs by `addHeader_` (setup, or on first write).
11c. **Owner check-in** (`ownerCheckin_`, menu "Check someone in…"): same rules, but any class
    today at any time, `Source = owner`. Only Code.gs calls it; the web API passes `{}` options,
    so a request can't ask for it.
11d. **Today tab** (`todayRows_`): rewritten from the in-memory book after every check-in that
    wrote a row (in `doPost`, inside the lock), on Refresh dashboard, and hourly by the Wix sync.
    It's the owner's view in the Sheets phone app, which has no custom menus.
11e. **The API is open to anyone with the URL** (the repo is public too), so it never relies on
    secrecy. Text from students or Wix goes into the Sheet through `textSafe_` (a leading `'`
    on `= + - @`, so it can't run as a formula), including the Dashboard, Today and Wix tabs. The
    answer carries only the student's first name. A declared payment can't exceed what's owed.
    New students are capped per hour (`NEW_STUDENTS_PER_HOUR`, `io.allowNewStudent`). The page
    has a CSP (`index.html`); a new external host needs adding there, and no inline handlers.
    Known and accepted: anyone who knows a student's email can check in as them and see their
    balance (low stakes).
11f. **Sign codes** (`codeSource_`, Tags tab, menu "Make a code for a new sign or tag…"): once
    Tags has an active code, a check-in needs one of them in `?t=`, checked before anything is
    written (`needTag` otherwise); the Log's Source is the tag's Name. No tags = anything goes
    (`static`/`direct`/`unverified`, as before). Codes live only in the Sheet, never the repo.
11g. **Test links (dev only):** a Tags row with a `Scenario` (`TEST_SCENARIOS` in Logic.gs) makes
    `checkin_` use `testClasses_` (pretend classes around now; ClassIDs `T-…`, names "(test)")
    instead of the schedule. Opening a test link starts its situation fresh (`freshTestLink_`:
    voids that tester's earlier check-ins on that link only), and late at night they run on a
    pretend clock (`testClock_`: 8:50pm–2am) so every scenario fits in the day. Nothing
    test-specific is ever shown on the page (testers are non-technical). The `reset` scenario voids only that email's test rows and today's
    declared payments (`resetTester_`, via `io.update`). All of it only works while Config
    `testScenarios` is yes; never set it in prod. Menu "Make test links for testers" fills a
    "Test links" tab. docs/TESTING.md is built around them.
11h. **Passkeys (optional):** from a student's second check-in the page offers "Save a passkey"
    when they have none (`passkeyOffer`) and the phone supports it; a first visit shows nothing.
    The passkey's user handle is the student's email itself (≤ 64 plain-ASCII bytes, else a random
    handle), sent too (`action: 'passkey'`, needs the sign's code) to Students → Passkey, which
    only marks that they have one. On the email screen, passkey autofill (`autocomplete="email
    webauthn"` + a conditional `credentials.get`) suggests it above the keyboard only on a phone
    that has one; phones without autofill get a "Check in with a passkey" button. Either sends
    the handle back (`req.passkey`): a known Passkey value finds the student, otherwise
    `emailFromPasskey_` reads the email out of it (an unknown email gets the name step with the
    email filled in). So clearing the Passkey cell never breaks a passkey. No signature check
    (Apps Script can't verify P-256): a passkey is worth exactly what an email is worth. WebAuthn
    calls run straight from a tap (Safari needs the user gesture), and every failure falls back
    to the email box. rpId = the page's hostname, so dev and prod passkeys are separate.
11i. **Owner page** (`owner.html`, `ownerRequest_`): Today (with "remove": `ownerUndo_`, today's
    check-ins only), take attendance (`ownerCheckinMany_`; each class's `usual` students, by class
    name over six weeks, are listed first), check someone in, monthly plans
    (`PLAN_CHOICES`), class passes, and sorting out "I'm here for a class" visits, so the owner
    never edits the Sheet. Every request carries a named link's key, checked first (`ownerWho_`
    against Script Properties `ownerKeys` = {name: key}, made per person by the menu's "Make an
    owner page link…"; the pre-names `ownerKey` counts as "Owner"). The name goes into Log → `By`
    on each check-in they make (blank = the student themselves; the Sheet menu writes the user's
    email), and into Note on removals and sort-outs. The key travels in the link's `#k=` fragment,
    is kept in the phone's localStorage, and is never in the Sheet or the repo. **No money on purpose:**
    payments and prices wait until the owner has said what she wants. A Google sign-in is planned
    to replace the link when prod is set up.
12. **The Sheet's `studioName` wins.** The page remembers the last name the API sent;
    `config.js` only covers a phone's first visit.
13. **Backups:** `backupNow` (nightly trigger) copies the SCHEMA tabs — values only, no script —
    into a Drive folder; keeps 30 days plus the first of each month; old ones are trashed, never deleted.

## Commands

```bash
node scripts/test_logic.js      # run before every deploy
node scripts/serve.js           # preview at http://localhost:8642/ (mock backend, no Google needed)
node scripts/push.js dev|prod [--deploy]   # apps-script/ → that copy's Apps Script (clasp 3)
```

The preview toolbar switches scenarios (one class / two at once / free class / none), adds a
10-class pack, and forgets or resets the fake data.

## Dev and prod

Two identical copies: **dev** in the builder's Google/GitHub accounts, **prod** in the studio's.
Everything is built and tested on dev first. The studio's accounts aren't involved until handover,
when prod is set up with the owner (SETUP.md "Handover").
`web/config.js` lists both API URLs and the page picks by hostname (anything else = mock; `?dev`
forces dev; dev shows a DEV badge). `deploy/<env>.json` holds the clasp user, script ID and web
app deployment ID. Git remotes: `origin` = dev, `studio` = prod. Changes go to dev first.
Prod is always deployed under the studio's clasp login, so it runs as the studio's account
(`doGet` reports a masked `runsAs` to check).

## Versioning

`APP_VERSION` lives at the top of Logic.gs (semver; currently 1.0.0). Bump it with each release
and tag it in git. `push.js --deploy` redeploys the existing deployment, so the URL stays the same.

## Things to verify on real phones

- The Venmo pay link format (`https://venmo.com/<handle>?txn=pay&amount=…&note=…`) and the
  owner-email charge link (`?txn=charge&recipients=…`). Venmo has changed these before.
- iPhone Safari may clear the remembered student after 7 days without interaction on the page
  (possibly even for weekly students, whose check-in needs no tap). The page asks for the email
  only (name just for a new email) and calls `navigator.storage.persist()`, so a forgotten
  student taps their autofilled email, or "Check in with a passkey" if they saved one (rule 11h).
- Passkeys end to end on a real iPhone and an Android phone: the offer appears, Save shows Face
  ID / fingerprint, and after "Not you?" the email box's passkey suggestion finds them. The
  preview has no authenticator, so only the code around the prompts was tested there.
