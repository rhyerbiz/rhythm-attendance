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
3. In **Project Settings**, set the time zone to match the Sheet's (the manifest ships with
   `America/Chicago` as a placeholder).
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

Your dev sticker gets `https://<you>.github.io/rhythm-attendance/?t=static`. Pages opened
there show a **DEV** badge next to the studio name. Make this one now and use it to test.

The studio's sign gets its own address at handover, and that one is permanent:

```
https://checkin.theirstudio.com/?t=static
```

Decide it before printing the sign — it is baked in. (When the rotating-code totem arrives it
serves the same page with a changing `t` and `s`, so nothing else changes.)

- **NFC:** an NTAG213 or NTAG215 sticker. Write a single *URL* record with the free **NFC Tools**
  app, then use *Other → Set password* so nobody else can rewrite it. **Don't use "Lock tag"** —
  that is permanent and you could never change it.
  Embed it in a 3D print by pausing a few layers below the top surface.
- **QR:** any QR generator; print it large (at least 4 cm) with a white border around it.
- Test with an iPhone and an Android before installing.

## 5. Try it end to end

Be the first student: tap, enter your email and name, check in. Then in the Sheet:

- A row appears in **Log** (and **Students**, the first time).
- **Check-in → Refresh dashboard** shows you. The Dashboard also rebuilds whenever the Sheet opens.
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
   it into its Script Properties themselves (see [Connecting Wix](#connecting-wix-read-only-being-built)).
6. Turn on the Monday email and nightly backups in the studio's Sheet, and make sure `ownerEmail`
   in Config is the owner's. If Wix is connected, also choose **Get classes from Wix now (and
   every hour)**. Do these menu items **signed in as the studio's account**: a trigger runs as
   whoever turns it on, so if you click them as yourself they'd keep running under your account.

Your dev copy stays as it is, for trying out changes before they reach the studio.

## Day to day, for the owner

| To… | Do this |
|---|---|
| Add or change a class | Edit **Schedule**. Set `Active` to `no` to pause one; `LastDate` ends it. |
| Put someone on a monthly plan | Add a row to **Plans**: pick the student, the `Plan` (`1 class/week` or `2 classes/week`) and the `Start` date. Their check-ins show as covered by the plan. When they stop, fill in `End`. Bill the plan in Venmo as you do now. |
| Record a package someone bought | Add a row to **Packages**: pick the student, `Classes` (e.g. 10), `Purchased` date, optional `Expires`. Past drop-ins after the purchase date are covered automatically. |
| Record a cash/Venmo payment for drop-ins | Add a row to **Payments** with the amount. |
| Check a payment a student said they sent | In **Payments**, set `Status` to `confirmed` — or `rejected` if it never arrived (it then shows as owed again). |
| Undo a mistaken check-in | In **Log**, set its `Status` to `void`. |
| Sort out "came for a class that wasn't on the schedule" | A student with no class to check in to can tap **I'm here for a class**, with an optional note. It's a **Log** row with `Status` `unscheduled`: no charge, not counted as a visit, and listed under **To review** on the Dashboard and in Monday's email. Fill in `Class` and set `Status` to `ok` (it then counts as a drop-in, or a credit or plan class), or `void`. |
| Offer the group chat | Put the chat's invite link (e.g. Telegram) in `chatLink` in **Config**. Students see **Join the group chat** after checking in, until they tap it once on that phone. The link is only sent to someone who has checked in, but it can still be passed on, so turn on admin approval for the invite link in Telegram. |
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
   only**, with just the Bookings, Calendar, Pricing Plans and Contacts/Members permissions. Wix
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
   classes, the next 7 days of sessions, the plans and a count of plan purchases (no names). If
   a section says 403, the key is missing that permission or is for a different site.
5. **Turn on the schedule.** Choose **Check-in → Get classes from Wix now (and every hour)**.
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

