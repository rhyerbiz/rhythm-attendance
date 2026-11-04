# Studio check-in

Students tap their phone on the sign by the door (or scan its QR code) and they're checked in.
The studio gets a Google Sheet that fills itself in, a Dashboard of who owes and who's lapsing,
and a Monday-morning email. No app to install, no Wi-Fi at the studio, no monthly costs.

**Version 1.0** — adult classes with a static NFC tag and QR code.

## How it works

```
NFC tag / QR  →  check-in page (GitHub Pages)  →  Apps Script API  →  Google Sheet
                 on the student's phone             (free)             Dashboard + weekly email
```

- **First visit:** email (and name, if the studio is new to them). After that the phone remembers
  them: tap, and you're in. If the phone forgets, it's just the email again.
- **The class is picked automatically** from the schedule and the time. If more than one could be
  meant, the student ticks the right ones. Staying for a series? Tick them all at once.
- **Forgot on the way in?** Check-in stays open until 90 minutes after class ends.
- **Monthly plans** cover every class while they run. **Packages count down** on the confirmation screen. Drop-ins get a one-tap **Pay with Venmo**
  button with the amount and a note already filled in.

## Try it locally

```bash
node scripts/serve.js
```

Open http://localhost:8642/. With no API configured, the page runs the real rules against a fake
studio in your browser; a toolbar at the bottom switches scenarios.

```bash
node scripts/test_logic.js
```

## Set it up for real

See [docs/SETUP.md](docs/SETUP.md). Project rules and the plan for later versions are in
[CLAUDE.md](CLAUDE.md).
