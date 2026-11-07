# Testing the check-in, with fellow students

The first part is for you, the builder. Everything after **"For the tester"** can be sent to them
as it is, with the links from your **Test links** tab pasted in where it says.

## Before you hand it out

Everything runs on the **dev** copy: your Sheet, your Apps Script, your GitHub Pages address.
Nothing a tester does reaches the studio's accounts.

1. Dev works end to end for you on your own phone (SETUP steps 1–5).
2. In the dev Sheet's **Config**:
   - `venmoHandle`: **your own** Venmo username, so a test payment could only ever reach you.
     Testers are asked not to send one, but a slip then costs nothing.
   - `chatLink`: blank, or a throwaway Telegram group, so the Join button can be tried.
   - `pageUrl`: your page's address (`https://<you>.github.io/rhythm-attendance/`).
   - `testScenarios`: **yes**. This is what makes test links work. Never set it in the studio's copy.
3. Choose **Check-in → Make test links for testers (dev copy)**. It fills a **Test links** tab
   with one link per scenario plus **Start over**. Copy the lines into your message below.
   Running it again gives the same links.

**How test links work:** each one pretends that scenario's classes are on, placed around the
moment it's tapped, so testers can try everything any day, at any hour, from anywhere. The page
is exactly what a student sees (plus the DEV badge). The check-ins are real rows in your dev
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
home, any time. Open them on your phone, one at a time, in this order. The first one asks for
your email and name; after that your phone remembers you.

**Start over any time:** the **Start over** link clears only your own test check-ins and makes
your phone forget you, so you can run through everything again (the next link asks for your
email).

*(Paste the links from the Test links tab here: what happens, what to try, and the link. Put the
Start over link right under the paragraph above.)*

### Things to look out for as you go

- **Does each screen make sense for the situation the link describes?** That's the main thing.
- Tap a link **twice**: the second time should say you're already checked in.
- Tap the **Venmo** button once and back out: does Venmo open with the amount filled in? Back on
  the page, tap **Not yet**.
- On another test, tap **Yes, I paid** instead: it should say "Sent by Venmo" with the right
  amount. Then open a different link: it should ask only for that new class, not the earlier one
  you didn't pay for.
- Try **Not you? Switch person** at the bottom: it should ask only for your email.
- From your second check-in it may offer **Save a passkey**: try it (Face ID or fingerprint).
  Then tap **Not you? Switch person**, tap the email box, and pick your passkey from the
  suggestions above the keyboard (older phones show a **Check in with a passkey** button
  instead). It should check you in without your email.
- If the group chat button shows, tap it, or tap **Already in the group? Hide this**: either way
  it shouldn't come back after that.
- Anything confusing or worded strangely, even if it worked.
- Anything slow: roughly how long you waited.
- Anything that looked broken: text cut off, buttons hard to tap, odd colours in dark mode.

### Reporting a problem

Send a message with:

- **Which link** you tapped, and what you tapped on the page.
- **What happened**, and what you expected instead.
- **A screenshot** if you can.
- **Your phone** (e.g. iPhone 13, Pixel 7), and the **time** it happened, so it can be found in
  the records.

Thank you, this really helps!
