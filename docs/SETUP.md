# Setting it up

About an hour, start to finish. Do it **in the studio's own accounts**, not yours, so the system
never depends on you. Nothing here costs money.

## 1. The Sheet and the script

1. Signed in as the studio's Google account, create a new Google Sheet named something like
   *Studio Check-ins*. Check **File → Settings → Time zone** is the studio's.
2. **Extensions → Apps Script.** Then either:
   - **With clasp** (easier for updates):
     ```bash
     npm install -g @google/clasp
     clasp login
     cp .clasp.json.example .clasp.json     # paste in the Script ID from Project Settings
     clasp push
     ```
   - **Or by hand:** create `Logic.gs` and `Code.gs` in the editor and paste the files from
     `apps-script/`. Turn on **Project Settings → Show "appsscript.json"** and paste that too.
3. In **Project Settings**, set the time zone to match the Sheet's (the manifest ships with
   `America/Chicago` as a placeholder).
4. Select `setup` in the function dropdown and **Run**. Approve the permissions (it is the studio's
   own script asking to use the studio's own sheet and send it email). This builds the tabs.
5. Back in the Sheet, fill in:
   - **Config:** `studioName`, `venmoHandle`, `dropInPrice`, `ownerEmail`. The check-in page
     picks up `studioName` from here — change it in the Sheet and phones show the new name from
     their next check-in. Check-in opens 30 minutes before a class and stays open until 90
     minutes after it ends (`opensMinutesBefore`, `lateMinutesAfterEnd`).
   - **Schedule:** one row per class. `Days` can be `Mon, Wed`; `Start` can be `7:00 PM`.
     Leave `ClassID` blank (it fills itself in). Set `Active` to `yes`, and delete the examples.
6. **Check-in → Turn on the Monday-morning email** (from the Sheet's menu).

## 2. Deploy the API

1. In Apps Script: **Deploy → New deployment → Web app**.
   *Execute as:* **Me**. *Who has access:* **Anyone**.
2. Copy the URL ending in `/exec`. Opening it in a browser should show
   `{"ok":true,"service":"rhythm-attendance",...}`.
3. **When updating later**, use **Deploy → Manage deployments → ✏️ → Version: New version**.
   A *new deployment* gets a new URL and the page would stop working.

## 3. Publish the check-in page

1. Put the `/exec` URL in `web/config.js`. (Its `studioName` is only a fallback for a phone's very
   first visit; the Sheet's Config tab is the one that counts.)
2. Push this repo to a **public** GitHub repository owned by the studio (GitHub Pages is free for
   public repos; nothing secret lives in the repo — the page has to know the API URL anyway).
3. **Settings → Pages → Source: GitHub Actions.** The workflow in `.github/workflows/pages.yml`
   publishes `web/` on every push to `main`.
4. **Custom domain** — so the URL on the sign is the studio's and outlives any hosting choice:
   - In GitHub **Settings → Pages → Custom domain**, enter `checkin.theirstudio.com`.
   - In Wix: **Domains → ⋯ → Manage DNS records → CNAME → Add record**, host `checkin`,
     value `<github-user>.github.io`.
   - Once it verifies, tick **Enforce HTTPS**.

## 4. The tag and the QR code

The URL on both is, permanently:

```
https://checkin.theirstudio.com/?t=static
```

Decide it before printing anything — it is baked into the sign. (When the rotating-code totem
arrives it serves the same page with a changing `t` and `s`, so nothing else changes.)

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

## Day to day, for the owner

| To… | Do this |
|---|---|
| Add or change a class | Edit **Schedule**. Set `Active` to `no` to pause one; `LastDate` ends it. |
| Put someone on a monthly plan | Add a row to **Plans**: pick the student, the `Plan` (`1 class/week` or `2 classes/week`) and the `Start` date. Their check-ins show as covered by the plan. When they stop, fill in `End`. Bill the plan in Venmo as you do now. |
| Record a package someone bought | Add a row to **Packages**: pick the student, `Classes` (e.g. 10), `Purchased` date, optional `Expires`. Past drop-ins after the purchase date are covered automatically. |
| Record a cash/Venmo payment for drop-ins | Add a row to **Payments** with the amount. |
| Check a payment a student said they sent | In **Payments**, set `Status` to `confirmed` — or `rejected` if it never arrived (it then shows as owed again). |
| Undo a mistaken check-in | In **Log**, set its `Status` to `void`. |
| Rename the studio | Change `studioName` in **Config**. |
| See who owes / who's running low / who's lapsed | The **Dashboard** tab, or Monday's email. |

Don't rename column headers — the script finds columns by name. Adding columns or reordering is fine.
