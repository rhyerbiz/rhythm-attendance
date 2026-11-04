// Filled in once per copy — see docs/SETUP.md ("Dev and prod").
// The page picks its backend by the address it is opened on. Anywhere else
// (your computer, or a blank apiUrl) it runs in preview mode against a fake,
// in-browser studio; add ?dev on your computer to use the dev backend instead.
window.CHECKIN_CONFIG = {
  // The studio's copy: their GitHub Pages domain and their Apps Script web app URL (ends in /exec).
  prod: { host: 'checkin.theirstudio.com', apiUrl: '' },
  // Your test copy: your GitHub Pages address and your Apps Script web app URL.
  dev: { host: 'yourname.github.io', apiUrl: '' },
  // Shown only until a phone's first check-in; after that the Sheet's studioName is used.
  studioName: 'Your Studio',
};
