# Setting it up

About an hour, start to finish. Nothing here costs money.

There are two copies, set up the same way:

| | **dev** — your test copy | **prod** — the studio's |
|---|---|---|
| Google account (Sheet + script) | yours | the studio's |
| GitHub repository | yours (`origin`) | the studio's (`studio`) |
| Address | `<you>.github.io/rhythm-attendance` | `checkin.theirstudio.com` |
| Tag / QR | a test sticker on your desk | the sign by the door |

**Steps 1–5 build your dev copy, entirely in your own accounts.** The studio isn't involved
until it's working and you hand it over. Then you repeat the same steps in the studio's accounts
with the owner (see [Handover](#handover-the-studios-copy)), so the real system never depends on
you. The code is the same; only `deploy/<copy>.json` and one line of `web/config.js` differ.
Updates afterwards: see [Updating](#updating-dev-first-then-prod).

## 1. The Sheet and the script

1. Signed in to **your** Google account, create a new Google Sheet named something like
   *Studio Check-ins*. Check **File → Settings → Time zone** is the studio's.
2. **Extensions → Apps Script.** This opens the Sheet's own script project in a new tab. (If it
   says "unable to open the file", your browser is signed in to several Google accounts; open the
   Sheet in an Incognito window or a Chrome profile signed in to just this account.) Give the
   project a name at the top left (e.g. *Studio Check-ins*), then:
   - Click the **gear icon (Project Settings)** in the left sidebar.
   - Under **IDs**, click **Copy** next to **Script ID**. It's a long code like `1AbC…xyz`; the
     same code appears in the editor's address, between `/projects/` and `/edit`.
   - Paste it into `deploy/dev.json` as `"scriptId": "…"`.

   Then sign clasp in to the account that owns the Sheet (you only do this once):
   ```bash
   npm install -g @google/clasp
   clasp login --user dev
   ```
   The browser opens; choose the account that owns the Sheet. If clasp is already signed in to
   that same account for another project (`clasp show-authorized-user` tells you which), you can
   skip this and set `"user": "default"` in `deploy/dev.json` instead.
   If Apps Script refuses the push, turn on the Apps Script API for your account at
   https://script.google.com/home/usersettings. Then push the code:
   ```bash
   node scripts/push.js dev
   ```
   (Without clasp: create `Logic.gs`, `Code.gs` and `Wix.gs` in the editor and paste the files
   from `apps-script/`. Turn on **Project Settings → Show "appsscript.json"** and paste that too.)
3. The script's time zone comes from `apps-script/appsscript.json` (`America/Denver`, the
   studio's) and is reset to it on every push, so don't change it in **Project Settings**. Set
   the **Sheet's** time zone to the same (**File → Settings**); check-in times follow the Sheet.
   If the studio ever moves zones, change the `timeZone` line in that file instead.
4. Select `setup` in the function dropdown and **Run**. Approve the permissions (it's your own
   script asking to use your own Sheet and send email). This builds the tabs.
5. Back in the Sheet, fill in:
   - **Config:** `studioName`, `venmoHandle`, `dropInPrice`, `ownerEmail`. The check-in page
     picks up `studioName` from here — change it in the Sheet and phones show the new name from
     their next check-in. Check-in opens 30 minutes before a class and stays open until 90
     minutes after it ends (`opensMinutesBefore`, `lateMinutesAfterEnd`).
   - **Schedule:** one row per class. `Days` can be `Mon, Wed`; `Start` can be `7:00 PM`.
     Leave `ClassID` blank (it fills itself in). Set `Active` to `yes`, and delete the examples.
6. **Check-in → Turn on the Monday email and nightly backups** (from the Sheet's menu). Google asks
   once for permission to use Drive — that's for the backups folder.

## 2. Deploy the API

1. In Apps Script: **Deploy → New deployment → Web app**. *Execute as:* **Me**.
   *Who has access:* **Anyone**.
2. Copy the URL ending in `/exec`, and copy the **Deployment ID** into `deploy/dev.json`.
   Opening the URL in a browser should show `{"ok":true,"service":"rhythm-attendance",...}`.
3. **Never create a second deployment** — it gets a new URL and the page would stop working.
   Updates go through `node scripts/push.js dev --deploy`, which reuses the same one.

## 3. Publish the check-in page

1. In `web/config.js`, fill in `dev`'s `host` (`<you>.github.io`) and `apiUrl` (the `/exec`
   URL). The `prod` line stays blank until handover; the page picks a copy by the address it is
   opened on. (`studioName` there is only a fallback for a phone's very first visit; the Sheet's
   Config tab is the one that counts.) Commit it.
2. Create a **public** GitHub repository in your account (GitHub Pages is free for public repos;
   nothing secret lives in the repo — the page has to know the API URL anyway) and push to it:
   ```bash
   git remote add origin https://github.com/<you>/rhythm-attendance.git
   git push -u origin main
   ```
3. **Settings → Pages → Source: GitHub Actions.** The workflow in `.github/workflows/pages.yml`
   publishes `web/` on every push to `main`.

## 4. The tag and the QR code

Each sign, sticker or totem gets its own random code, so someone who only finds the website
can't check in, and the **Log**'s `Source` says which sign each check-in came from.

1. Put the page's address in `pageUrl` in **Config** (dev: `https://<you>.github.io/rhythm-attendance/`).
2. Choose **Check-in → Make a code for a new sign or tag…** and give it a name (e.g. *Front
   door*). It adds a row to the **Tags** tab and shows the address to write, like
   `https://<you>.github.io/rhythm-attendance/?t=kqmzabhrdpsn`.
3. Write that address to the NFC tag and make the QR code from it (below). Pages opened from the
   dev address show a **DEV** badge.

Until **Tags** has an active code, any address can check in (handy for the first tests). Once
it has one, only addresses with an active code can: anything else shows "tap the sign at the
studio", before anything is recorded. The owner's **Check someone in…** needs no code.

The codes live only in the Sheet, never in the repo. If one leaks (a photo of the QR code passed
around), set its `Active` to `no`, make a new one, and rewrite that tag and QR code. The studio's
copy makes its own codes at handover, with its own `pageUrl` (e.g. `https://checkin.theirstudio.com/`).
(When the rotating-code totem arrives it serves the same page with a changing `t` and `s`.)

- **NFC:** an NTAG213 or NTAG215 sticker. Write a single *URL* record with the free **NFC Tools**
  app, then use *Other → Set password* so nobody else can rewrite it. **Don't use "Lock tag"** —
  that is permanent and you could never change it.
  Embed it in a 3D print by pausing a few layers below the top surface.
- **QR:** any QR generator; print it large (at least 4 cm) with a white border around it.
- Test with an iPhone and an Android before installing.

## 5. Try it end to end

Be the first student: tap, enter your email and name, check in. Then in the Sheet:

- A row appears in **Log** (and **Students**, the first time).
- The **Today** tab shows you under the class, with how it was paid for. It's rewritten after
  every check-in, so it's also what to look at in the Google Sheets phone app.
- **Check-in → Refresh dashboard** shows you. The Dashboard also rebuilds whenever the Sheet opens.
- **Check-in → Check someone in…** checks in a second (made-up) student from the Sheet.
- **Check-in → Email me the weekly summary now** sends a sample.

## Handover: the studio's copy

Do this with the owner once dev works, so everything lives in the studio's accounts and keeps
running without you. Repeat steps 1–4, with these differences:

1. **The Sheet and the script:** signed in as **the studio's** Google account. Put the Script ID
   in `deploy/prod.json`, sign clasp in to the studio's account, and push:
   ```bash
   clasp login --user studio
   node scripts/push.js prod
   ```
   When `setup` asks for permissions, it's the studio's own script asking for its own Sheet.
2. **Deploy the API** as the studio (it runs as whoever deploys it). Put the Deployment ID in
   `deploy/prod.json`. Open the `/exec` URL and check `runsAs` is the studio's account (masked,
   e.g. `st***@gmail.com`), not yours. Later updates: `node scripts/push.js prod --deploy`, which
   always runs as the studio's clasp login.
3. **The page:** fill in `prod`'s `host` and `apiUrl` in `web/config.js` and commit. Create a
   public repository in **the studio's** GitHub account and push to it:
   ```bash
   git remote add studio https://github.com/<studio>/rhythm-attendance.git
   git push studio main
   ```
   Turn on Pages as in step 3, then add the custom domain, so the URL on the sign is the
   studio's and outlives any hosting choice:
   - In GitHub **Settings → Pages → Custom domain**, enter `checkin.theirstudio.com`.
   - In Wix: **Domains → ⋯ → Manage DNS records → CNAME → Add record**, host `checkin`,
     value `<studio's github user>.github.io`.
   - Once it verifies, tick **Enforce HTTPS**.
4. **The sign:** write the studio's address to the NFC tag and QR code and test both.
5. **Wix:** the owner (or the Wix co-owner) makes a separate key for the studio's copy and pastes
   it into its Script Properties themselves (see [Connecting Wix](#connecting-wix-read-only)).
6. Turn on the Monday email and nightly backups in the studio's Sheet, and make sure `ownerEmail`
   in Config is the owner's. If Wix is connected, also choose **Get classes and purchases from
   Wix now (and every hour)**. Do these menu items **signed in as the studio's account**: a trigger runs as
   whoever turns it on, so if you click them as yourself they'd keep running under your account.
7. Check `testScenarios` in the studio's Config is **no** (it starts that way), and make the
   real sign's code with **Make a code for a new sign or tag…** (step 4).

Your dev copy stays as it is, for trying out changes before they reach the studio. Testing with
fellow students uses its test links: see [TESTING.md](TESTING.md).

## The owner page

So the owner never has to edit the Sheet, `owner.html` (next to the check-in page) does the
everyday jobs from her phone:
- **Today:** each class with who's in and how it's covered (plan, class pass, drop-in). "Owes" is
  shown for information only. **remove** next to a name undoes one of today's check-ins.
- **Take attendance** (on each class): a checklist with that class's usual students first (the
  last six weeks), then everyone else. Tick who's there and check them all in at once.
  **Someone new?** at the bottom adds a first-timer (email and name) to that class.
- **Students:** start, change or end a monthly plan (a start date in the past covers the
  check-ins since then), and add a class pass.
- **To sort out:** match an "I'm here for a class" visit to its class, or remove it.

It doesn't handle money on purpose: payments and prices stay in the Sheet until that's decided
with the owner.

**Giving someone a link:** in the Sheet, choose **Check-in → Make an owner page link…**, type who
it's for (e.g. Caress), and send them the address it shows (`…/owner.html#k=…`). They open it once
on their phone, and from then on it remembers them; they can add it to their home screen.
- Each person gets their own link, named after them. That name goes into the Log's **By** column
  for every check-in they make, so you can see who checked someone in. (A blank **By** means the
  student checked in themselves; the Sheet menu's **Check someone in…** records the email of
  whoever used it.) Removing a check-in or sorting out a visit adds "removed by …" or
  "matched by …" to that row's **Note**.
- The keys live only in Script Properties (`ownerKeys`), never in the Sheet or the repo. The first
  link, made before links had names, counts as "Owner".
- Making a link for a name that already has one replaces it, and the old one stops working. Do
  that if a phone is lost or a link went to the wrong person. **Turn off an owner page link…**
  removes someone's link altogether. **Rename an owner page link…** changes only the name it
  records (e.g. "Owner" to "Caress"); the link itself keeps working.
- Anyone with the link can see student names and emails and change plans, so treat it like a
  password.
- At handover, make a new link in the studio's copy. (A Google sign-in instead of the link is
  planned for then.)

## Day to day, for the owner

Most of this is on [the owner page](#the-owner-page); the Sheet does the rest.

| To… | Do this |
|---|---|
| See who's in class today | The **Today** tab: each class today, who checked in, and whether it was a plan, a class pass or a drop-in (and if they owe). It updates after every check-in, so it works in the Google Sheets phone app. |
| Check in someone without their phone, or new at the door | On the owner page: **Take attendance** on the class (**Someone new?** for a first-timer). Or on a computer: **Check-in → Check someone in…**. Type their email (or name), then pick the class. Any class today works, even after it ended. For another day, add a **Log** row by hand. |
| Add or change a class | Edit **Schedule**. Set `Active` to `no` to pause one; `LastDate` ends it. (With Wix connected, change classes in Wix instead.) |
| Sell a punch pass | Sold in person: a **Packages** row (e.g. `Classes` 10, with an `Expires` date if it has one). Sold on Wix: make it a Pricing Plan and add its name to `wixPacks` in **Config** (e.g. `Single Class = 1, 10 Class Pass = 10`); purchases then appear on their own. |
| Put someone on a monthly plan | Add a row to **Plans**: pick the student, the `Plan` (`1 class/week` or `2 classes/week`) and the `Start` date. Their check-ins show as covered by the plan. When they stop, fill in `End`. Bill the plan in Venmo as you do now. |
| Record a package someone bought | Add a row to **Packages**: pick the student, `Classes` (e.g. 10), `Purchased` date, optional `Expires`. Past drop-ins after the purchase date are covered automatically. |
| Record a cash/Venmo payment for drop-ins | Add a row to **Payments** with the amount (leave `Covers` blank: it pays off their oldest unpaid classes). Students are only ever asked at check-in to pay for that day's classes; anything older than that is yours to follow up, from the Dashboard's **Owes** column or Monday's email (with a Venmo request link). |
| Check a payment a student said they sent | In **Payments**, set `Status` to `confirmed` — or `rejected` if it never arrived (it then shows as owed again). |
| Undo a mistaken check-in | In **Log**, set its `Status` to `void`. |
| Sort out "came for a class that wasn't on the schedule" | A student with no class to check in to can tap **I'm here for a class**, with an optional note. It's a **Log** row with `Status` `unscheduled`: no charge, not counted as a visit, and listed under **To review** on the Dashboard and in Monday's email. Fill in `Class` and set `Status` to `ok` (it then counts as a drop-in, or a credit or plan class), or `void`. |
| Offer the group chat | Put the chat's invite link (e.g. Telegram) in `chatLink` in **Config**. Students see **Join the group chat** after checking in: a full card for their first three check-ins, then one quiet line, until they tap Join or **Hide**. Their choice goes in **Students → Chat** (e.g. `joined 2026-11-07`), so it follows them to any phone, and shows the owner who joined. After changing the link, clear that column to show it to everyone again. The link is only sent to someone who has checked in, but it can still be passed on, so turn on admin approval for the invite link in Telegram. |
| Help a student whose passkey stopped working | Students can save a passkey (Face ID / fingerprint) so a phone that forgets them can check in without the email. It's the random code in **Students → Passkey**. If theirs stops working, clear that cell: their email still works, and they'll be offered a new passkey after their next check-in. Don't edit it otherwise. |
| Rename the studio | Change `studioName` in **Config**. |
| See who owes / who's running low / who's lapsed | The **Dashboard** tab, or Monday's email. |

Don't rename column headers — the script finds columns by name. Adding columns or reordering is fine.

## Backups and restoring

Every night around 2am the script copies the data tabs into a new spreadsheet in the
**Check-in backups** folder of the Sheet owner's Drive (yours for dev, the studio's for prod), named like *Studio Check-ins — backup
2026-11-04 02:00*. It keeps every backup from the last 30 days and the first one of each month
before that; older ones go to Drive's trash, which itself keeps them another 30 days. The copies
contain no script, so opening one never changes anything. **Check-in → Back up now** makes one on
demand, worth doing before any big edit. If a nightly backup ever fails, Google emails the owner.

To undo a mistake:

- **A recent slip** (a deleted row, a bad sort): **File → Version history** in the Sheet itself.
  Google keeps this automatically, and you can copy old cells out without restoring everything.
- **Anything older, or a tab gone wrong:** open the backup from the right day, copy the rows you
  need and paste them back into the live Sheet. Paste rows; don't replace whole tabs.

Both copies live in the studio's Google account, so they protect against mistakes, not against
losing the account. Keep the account's recovery phone and email up to date.

## Connecting Wix (read-only)

The script can read the studio's Wix site: the Bookings classes, their sessions and the Pricing
Plans. Once connected, the class schedule comes from Wix and nobody has to type it.

1. **The key.** A Wix account owner or co-owner creates it in the
   [API Keys Manager](https://manage.wix.com/account/api-keys). Give it access to **this site
   only**, with just the Bookings, Calendar, Pricing Plans and **Read Members** permissions. Wix
   keys always allow changes as well as reads; the script itself only ever reads (`Wix.gs` lists
   the few read calls it's allowed to make).
2. **Use a separate key per copy.** One key goes in the dev copy. The prod key is made at
   handover and pasted straight into the studio's script, so it never leaves the studio.
3. **Store it.** In the Apps Script editor, open **Project Settings** (gear icon), scroll to
   **Script Properties → Edit script properties**, and add:
   - `wixApiKey`: the key
   - `wixAccountId`: the Wix account ID that came with the key
   - `wixSiteId` *(optional)*: the long code after `/dashboard/` in the Wix dashboard's
     address. Leave it out if you don't have it: the test below looks it up from the account and
     saves it if the account has one site, or lists the sites so you can copy the right ID.

   Click **Save script properties**. Then delete the message the key arrived in.

   Anyone who can edit the Sheet can see these values, so give edit access only to people you'd
   trust with the key. If a key may have leaked, delete it in Wix and make a new one.
4. **Check it.** In the Sheet (not the script editor), reload the page; a **Check-in** menu
   appears after **Help**. Choose **Check-in → Test the Wix connection (read-only)**. (Or, in
   the editor, pick `wixTest` in the function dropdown and click **Run**.) The first run asks
   permission to "connect to an external service". It fills a **Wix preview** tab with the
   classes, the next 7 days of sessions, the plans, a count of plan purchases (no names) and
   whether buyers can be matched to students. If a section says 403, the key is missing that
   permission or is for a different site.
5. **Turn on the schedule.** Choose **Check-in → Get classes and purchases from Wix now (and
   every hour)**.
   It fills a **Wix schedule** tab with every class session in the next two weeks and keeps it
   up to date every hour, so new classes, holidays and cancellations in Wix reach check-in on
   their own. Check-in reads this tab together with **Schedule**:
   - Don't edit the **Wix schedule** tab; it's rewritten every hour. Change classes in Wix.
   - A class typed in **Schedule** with the same name as a Wix class is ignored, so Wix
     decides when it runs. Once Wix is on, delete those typed rows. Typed classes Wix doesn't
     have keep working.
   - `wixSkip` in **Config** leaves classes out by words in their name (starts as `Kids`; e.g.
     `Kids, Private`). Run **First-time setup** once to add it to an older Config tab.
   - Prices: a Wix class with a fixed price uses it; "custom" prices use `dropInPrice`.
   - If Wix can't be reached, check-in keeps the last copy. Google emails the owner only if it
     has failed for a whole day.
6. **Plan purchases** come along on the same hourly run, into a **Wix purchases** tab that
   check-in reads like **Packages** and **Plans**:
   - Plans named in `wixPacks` in **Config** are class passes: `Single Class = 1` means each
     purchase is one prepaid class, so that student isn't asked to pay by Venmo at check-in.
     Every other plan (e.g. Adult Monthly) covers all classes from its start to its end, like a
     **Plans** row.
   - Unfinished checkouts, refunded purchases and plans matching `wixSkip` (Kids) are left out.
   - Each purchase is matched to a student by their Wix login email, so the key needs **Read
     Members**. Without it the purchases are listed but match no one. `CheckedInAs` shows who
     each one matched; a blank one means that email hasn't checked in yet (or used a different
     email). If so, the owner can add a **Packages** or **Plans** row for them by hand.
   - Don't edit this tab; to correct a purchase, change it in Wix.

## Updating: dev first, then prod

1. Make the change and run `node scripts/test_logic.js`. `node scripts/serve.js` previews the page
   against a fake studio; add `?dev` to the preview URL to use your dev Sheet instead.
2. Commit, then try it on dev:
   ```bash
   git push origin main               # the page, on your github.io address
   node scripts/push.js dev --deploy  # the script, on your dev Sheet
   ```
   Check it with your phone and the dev sticker.
3. When it's right, bump `APP_VERSION` in `Logic.gs` if you haven't, commit, and ship it to the
   studio:
   ```bash
   git push studio main
   node scripts/push.js prod --deploy
   git tag 1.0.1 && git push studio 1.0.1
   ```
   `push.js prod` refuses uncommitted changes, so the studio only ever runs a commit you can find.

If a change adds a column or a Config key, run **Check-in → First-time setup** in each Sheet after
pushing. It only adds what's missing and never touches existing data.

