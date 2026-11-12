// Filled in once per copy — see docs/SETUP.md ("Dev and prod").
// The page picks its backend by the address it is opened on. Anywhere else
// (your computer, or a blank apiUrl) it runs in preview mode against a fake,
// in-browser studio; add ?dev on your computer to use the dev backend instead.
window.CHECKIN_CONFIG = {
  // The studio's copy: their GitHub Pages domain and their Apps Script web app URL (ends in /exec).
  // googleClientId: the studio page's "Sign in with Google" (SETUP.md, "Google sign-in"). Blank = links only.
  prod: { host: 'checkin.theirstudio.com', apiUrl: '', googleClientId: '' },
  // Your test copy: your GitHub Pages address and your Apps Script web app URL.
  dev: { host: 'rhyerbiz.github.io', apiUrl: 'https://script.google.com/macros/s/AKfycbzg0xYYg-RhbbJPZL4ZOyYAfyaf_DwpfcmTWHwMkAok47fLKvxzJSX7E5HNUeYxTYFT/exec', googleClientId: '753139388871-trgj144ag2ggnvr5o024ju5f7dfh2hig.apps.googleusercontent.com' },
  // Shown only until a phone's first check-in; after that the Sheet's studioName is used.
  studioName: 'Your Studio',
};
