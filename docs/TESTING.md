# Testing the check-in, with fellow students

The first part is for you, the builder. Everything after **"For the tester"** can be sent to them
as it is, with the links from your **Test links** tab pasted in where it says.

## Before you hand it out

Everything runs on the **dev** copy: your Sheet, your Apps Script, your GitHub Pages address.
Nothing a tester does reaches the studio's accounts.

1. Dev works end to end for you on your own phone (SETUP steps 1–5).
2. In the dev Sheet's **Config**:
   - `venmoHandle`: the studio's (what students expect to see), or your own so a slip could only
     reach you. Testers are asked not to send a payment either way. With real students as
     testers, the studio's handle is less confusing than a stranger's.
   - `chatLink`: the real group is fine if the testers are already in it; otherwise blank, or a
     throwaway Telegram group.
   - `pageUrl`: your page's address (`https://<you>.github.io/rhythm-attendance/`).
   - `testScenarios`: **yes**. This is what makes test links work. Never set it in the studio's copy.
3. Choose **Check-in → Make test links for testers (dev copy)**. It fills a **Test links** tab
   with one link per scenario plus **Start over**. The first, "A regular on a monthly plan",
   shows what most students see: covered by their plan, nothing to pay. Copy the lines into your message below.
   Running it again gives the same links.

**How test links work:** each one pretends that scenario's classes are on, placed around the
moment it's tapped (late at night, around 8:50pm instead), and starts fresh every time it's
opened: that tester's earlier check-ins on that link are voided first. So testers can try
everything any day, at any hour, from anywhere. The page is exactly what a student sees (plus
the DEV badge): nothing on it says "test" beyond the class names. The check-ins are real rows in your dev
Sheet, with class names ending "(test)", so you can watch **Today**, **Log** and the
**Dashboard** fill in. Several testers can use the same links: each is told apart by their email,
and **Start over** only clears that tester's own test check-ins.

Afterwards, set `testScenarios` back to **no** to switch every test link off at once. Test rows
can stay: dev data never reaches the studio.

The real sticker is still worth one tap at a real class, to test NFC and the Wix schedule.

---

## For the tester

Thanks for trying this out! It's a test version of a check-in for the studio. Normally you tap
your phone on a sign by the door (or scan its QR code), and that's it: you're checked in. The
owner gets a spreadsheet that fills itself in.

**This is a test copy.** Nothing here is real: it doesn't use up any class, and it isn't the
studio's records. Please **don't send any real Venmo payment**. Where a Venmo button appears,
check that Venmo opens with the right amount, then back out without paying.

Instead of the sign, you'll use the links below. Each one pretends a different situation is
happening right now (a class about to start, two at once, and so on), so you can try them all from
home, any time. Open them on your phone, one at a time, in this order. If a link opens inside
Messenger or another app, tap its menu (⋯ or ⋮) and choose to open it in your browser (Chrome or
Safari): the page can't remember you or offer a passkey inside an app. Each link starts fresh
every time you open it, so you can repeat any of them. (Late in the evening, the class times
shown may be earlier than your clock. That's expected.)

**Start over any time:** the **Start over** link clears only your own test check-ins and makes
your phone forget you, so you can run through everything again.

*(Paste the links from the Test links tab into the parts below: what happens, what to try, and
the link.)*

### Things to look out for as you go

- **Does each screen make sense for the situation it imitates?** That's the main thing.
- Anything confusing or worded strangely, even if it worked.
- Anything slow: roughly how long you waited.
- Anything that looked broken: text cut off, buttons hard to tap, odd colours in dark mode.

### Part 1: your first visit

*Imitates a new student's first day.* Tap link 1. It asks for your email and your name, once.
If you've tried these before, tap **Start over** first.
It shows the usual case, a regular on a monthly plan: covered, nothing to pay.

### Part 2: coming back

*Imitates a regular on later visits.* Your phone remembers you now, so there's nothing to type.
If any of these asks for your email, tell me. **These treat you as a drop-in student** (no
monthly plan or class pass), so you'll see what you'd owe each time.

On the first of these it may offer **Save a passkey**: please try it (Face ID or fingerprint).
You'll use it in Part 3.

*(Links 2–8.)*

### Part 3: when a phone forgets you

*Imitates a phone that has forgotten a student (iPhones can, after a week without a visit).*

1. Tap **Start over**, then any test link. It should ask only for your email, not your name:
   the studio already knows you.
2. Tap **Start over** again, then a test link. This time tap the email box and pick your passkey
   from the suggestions above the keyboard (older phones show a **Check in with a passkey**
   button instead). It should check you in without typing anything.

### Part 4 (optional): brand new again

To see the first-visit screen again, tap **Start over** and use a different email, like
`yourname+test2@gmail.com`.

### Also worth trying

- On a drop-in test, tap the Venmo button, back out of Venmo without paying, then tap
  **Yes, I paid** instead of **Not yet**: it should say "Sent by Venmo"
  with the right amount. Then open a different link: it should ask only for that new class, not
  the earlier one you didn't pay for.
- Try **Not you? Switch person** at the bottom: it should ask only for your email.
- If the group chat button shows, tap it, or tap **Already in the group? Hide this**: either way
  it shouldn't come back after that.

### Reporting a problem

Send a message with:

- **Which link** you tapped, and what you tapped on the page.
- **What happened**, and what you expected instead.
- **A screenshot** if you can.
- **Your phone** (e.g. iPhone 13, Pixel 7), and the **time** it happened, so it can be found in
  the records.

Thank you, this really helps!
