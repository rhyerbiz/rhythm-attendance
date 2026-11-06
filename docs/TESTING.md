# Testing the check-in, with a fellow student

The first part is for you, the builder. Everything after **"For the tester"** can be sent to them
as it is: copy it into a message, or send them a link to this file.

## Before you hand it out

Everything runs on the **dev** copy: your Sheet, your Apps Script, your GitHub Pages address.
Nothing the tester does reaches the studio's accounts.

1. Dev works end to end for you on your own phone (SETUP steps 1–5).
2. In the dev Sheet's **Config**:
   - `venmoHandle`: **your own** Venmo username, so a test payment could only ever reach you. The
     tester is asked not to send one, but a slip then costs nothing.
   - `chatLink`: blank, or a throwaway Telegram group, so the Join button can be tried.
3. **Get classes and purchases from Wix now (and every hour)** has been run, so the real class
   times are there. The tester tries it at the studio around a real class.
4. Fill in the two blanks in "For the tester" below: the page address and where the test sticker is.
5. Afterwards, look at **Today**, **Log**, **Students** and **Payments** in the dev Sheet; each
   step below says what should appear. Void the test rows (Log `Status` = `void`) when you're done,
   or leave them: dev data never reaches the studio.

---

## For the tester

Thanks for trying this out! It's a test version of a check-in for the studio: you tap your phone
on a sticker (or scan a QR code) by the door, and that's it, you're checked in. The owner gets a
spreadsheet that fills itself in.

**This is a test copy.** Nothing here is real: it doesn't use up any class, and it isn't the
studio's records. Please **don't send any real Venmo payment**. Where it says to tap a Venmo
button, check that Venmo opens with the right amount, then back out without paying.

- **The page:** `https://_____________________/?t=static`
- **The test sticker / QR code:** _____________________

### Things to try

Try them in roughly this order. Some need you at the studio around a class time. Don't worry if
you can't do them all.

1. **First check-in.** Within half an hour before a class (or up to 90 minutes after it ends),
   tap the sticker or scan the QR code. Enter your email, then your name.
   *Expected:* "You're in", with the class name, and what you owe for it as a drop-in.
2. **The Venmo button.** Tap **Pay $… with Venmo**. *Expected:* Venmo opens with the amount and
   a note filled in. **Back out without paying.** Back on the page it asks whether the payment
   went through: tap **Not yet**.
3. **Second check-in, another day.** Tap the sticker again at the next class.
   *Expected:* no typing at all. It recognises your phone and checks you straight in.
4. **Tapping twice.** Tap the sticker again right after checking in.
   *Expected:* "Already checked in". You're not checked in or charged twice.
5. **Back-to-back classes**, if you stay for two in a row. *Expected:* you can tick both at once,
   or add the second one under **Taking another class today?**
6. **Too early or no class.** Tap the sticker when no class is about to start (e.g. on another day).
   *Expected:* "No class to check in to right now" and when the next class is. Below that, under
   **Here for a class that isn't listed?**, type a short note (e.g. "testing") and tap
   **I'm here for a class**. *Expected:* "Thanks", and nothing to pay.
7. **The group chat button**, if it shows. Tap it. *Expected:* it opens the chat invite, and the
   button doesn't come back on later check-ins.
8. **Switching person.** Tap **Not you? Switch person** at the bottom, and check in as yourself
   again with the same email. *Expected:* it asks only for your email (your phone may fill it in).
9. **Another phone or browser**, if you have one handy: an iPhone and an Android are the most
   useful pair. Also try the QR code if you tapped the sticker before, or the other way round.

### What to look out for

- Anything confusing or worded strangely, even if it worked.
- Anything slow: say roughly how long you waited.
- Anything that looked broken on your screen: text cut off, buttons hard to tap, wrong colours
  in dark mode.
- Whether the sticker worked first time, or how you had to hold your phone.

### Reporting a problem

Send a message with:

- **What you did** (which step above, and what you tapped).
- **What happened**, and what you expected instead.
- **A screenshot** if you can.
- **Your phone** (e.g. iPhone 13, Pixel 7), and the **time** it happened, so it can be found in
  the records.

Thank you, this really helps!
