/**
 * Code.gs — the Google side: reading and writing the Sheet, the web API,
 * the owner's menu, the Dashboard tab and the weekly email.
 * The rules themselves live in Logic.gs.
 *
 * Deployed as a web app (Execute as: Me, Who has access: Anyone). It is only
 * ever called with fetch() from the check-in page, never opened as a page,
 * so students never see Google's "created by an Apps Script user" banner.
 */

const TAB_KEYS = { Config: 'config', Schedule: 'schedule', Students: 'students', Log: 'log', Packages: 'packages', Plans: 'plans', Payments: 'payments' };

// ------------------------------------ web ------------------------------------

/** Opening the /exec URL in a browser: a health check showing the version and, masked, which account it runs as. */
function doGet() {
  let runsAs = '';
  try { runsAs = Session.getEffectiveUser().getEmail().replace(/^(.{2})[^@]*/, '$1***'); } catch (e) { /* not available */ }
  return json_({ ok: true, service: 'rhythm-attendance', version: APP_VERSION, runsAs: runsAs });
}

/**
 * The page posts JSON as text/plain: a "simple" request, so the browser sends
 * no CORS preflight (Apps Script cannot answer one).
 */
function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  // One lock around read → decide → write, so a double tap cannot slip a
  // second check-in in between the duplicate check and the append.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const book = readBook_();
    return json_(handleRequest_(book, req, nowParts_(), sheetIo_(book)));
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Something went wrong on the studio side. Please try again.' });
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* never held */ }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------- sheet -----------------------------------

function ss_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('spreadsheetId');
  if (!id) throw new Error('Run setup() once from the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}

function tz_() { return ss_().getSpreadsheetTimeZone(); }

function nowParts_() {
  const d = new Date(), tz = tz_();
  const hm = Utilities.formatDate(d, tz, 'HH:mm').split(':');
  return {
    date: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    minutes: (+hm[0]) * 60 + (+hm[1]),
    stamp: Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss'),
  };
}

/**
 * Sheet cells → the strings Logic.gs expects. A time-only cell (Sheets keeps
 * those on 1899-12-30) becomes 'HH:mm'; a midnight date becomes 'yyyy-MM-dd'.
 */
function cell_(v, tz) {
  if (Object.prototype.toString.call(v) !== '[object Date]') return v;
  if (isNaN(v.getTime())) return '';
  if (v.getFullYear() < 1901) return Utilities.formatDate(v, tz, 'HH:mm');
  const s = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  return s.slice(11) === '00:00:00' ? s.slice(0, 10) : s;
}

/** Every tab, read once, as arrays of objects keyed by header. */
function readBook_() {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
  const book = { headers: {} };
  Object.keys(TAB_KEYS).forEach(function (tab) {
    const sh = ss.getSheetByName(tab);
    const rows = [];
    let headers = SCHEMA[tab];
    if (sh && sh.getLastRow() > 0) {
      const range = sh.getDataRange();
      const values = range.getValues();
      // A class's Start is read as displayed ("7:00 PM"): Sheets hands back a time-only cell
      // as an 1899 date, and 1899 time-zone rules can shift it by minutes when formatted.
      const shown = tab === 'Schedule' ? range.getDisplayValues() : null;
      headers = values[0].map(function (h) { return String(h).trim(); });
      for (let i = 1; i < values.length; i++) {
        if (values[i].every(function (v) { return v === ''; })) continue;
        const obj = { _row: i + 1 };
        headers.forEach(function (h, j) { if (h) obj[h] = shown && h === 'Start' ? shown[i][j] : cell_(values[i][j], tz); });
        rows.push(obj);
      }
    }
    book.headers[tab] = headers;
    book[TAB_KEYS[tab]] = rows;
  });
  fillClassIds_(ss, book);
  return book;
}

/** The owner never has to invent a ClassID: a class row without one gets the next K-number. */
function fillClassIds_(ss, book) {
  const col = book.headers.Schedule.indexOf('ClassID') + 1;
  if (!col) return;
  let max = 0;
  book.schedule.forEach(function (r) {
    const m = String(r.ClassID || '').match(/^K(\d+)$/);
    if (m) max = Math.max(max, +m[1]);
  });
  book.schedule.forEach(function (r) {
    if (String(r.ClassID || '').trim() || !String(r.Class || '').trim()) return;
    r.ClassID = 'K' + (++max);
    ss.getSheetByName('Schedule').getRange(r._row, col).setValue(r.ClassID);
  });
}

function sheetIo_(book) {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
  return {
    newId: function (prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10); },
    append: function (tab, row) {
      const headers = book.headers[tab];
      ss.getSheetByName(tab).appendRow(headers.map(function (h) { return toCell_(row[h], tz); }));
    },
  };
}

/**
 * Logic.gs's 'yyyy-MM-dd' / 'yyyy-MM-dd HH:mm:ss' strings → real dates in the
 * sheet's zone, so the owner can sort and filter them and cell_() reads them
 * back exactly. Never left to Sheets' own guessing, which depends on locale.
 */
function toCell_(v, tz) {
  if (v == null) return '';
  if (typeof v !== 'string') return v;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return Utilities.parseDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Utilities.parseDate(v, tz, 'yyyy-MM-dd');
  return v;
}

// ----------------------------------- owner -----------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Check-in')
    .addItem('Refresh dashboard', 'refreshDashboard')
    .addItem('Email me the weekly summary now', 'sendWeeklySummary')
    .addItem('Back up now', 'backupNow')
    .addSeparator()
    .addItem('Turn on the Monday email and nightly backups', 'installTriggers')
    .addItem('First-time setup', 'setup')
    .addItem('Test the Wix connection (read-only)', 'wixTest')
    .addToUi();
  try { refreshDashboard(); } catch (e) { /* setup has not run yet */ }
}

/**
 * Builds any missing tabs with their headers and starter values. Safe to run
 * again: it never touches a tab or a Config key that already exists.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('spreadsheetId', ss.getId());

  Object.keys(SCHEMA).forEach(function (tab) {
    let sh = ss.getSheetByName(tab);
    if (sh) return;
    sh = ss.insertSheet(tab);
    sh.getRange(1, 1, 1, SCHEMA[tab].length).setValues([SCHEMA[tab]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });

  const cfg = ss.getSheetByName('Config');
  const have = cfg.getLastRow() > 1 ? cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    if (have.indexOf(k) < 0) cfg.appendRow([k, DEFAULT_CONFIG[k], CONFIG_NOTES[k] || '']);
  });

  const sched = ss.getSheetByName('Schedule');
  if (sched.getLastRow() === 1) {
    sched.getRange(2, 1, 2, 7).setValues([
      ['', 'Example: Salsa Level 1', 'Mon, Wed', '7:00 PM', 60, '', 'no'],
      ['', 'Example: Open Practice', 'Fri', '6:00 PM', 90, 0, 'no'],
    ]);
    sched.getRange('D:D').setNumberFormat('@'); // keep "7:00 PM" as typed
  }

  // A dropdown of student names where the owner records packages, plans and payments.
  // Typing an email instead is fine too, so invalid entries only warn.
  const names = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName('Students').getRange('B2:B'), true)
    .setAllowInvalid(true).build();
  ['Packages', 'Plans', 'Payments'].forEach(function (tab) {
    const sh = ss.getSheetByName(tab);
    sh.getRange(2, SCHEMA[tab].indexOf('Student') + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(names);
  });
  // Suggested plan names; the owner can type others. Not enforced yet — kept for when weekly limits are.
  const plans = ss.getSheetByName('Plans');
  plans.getRange(2, SCHEMA.Plans.indexOf('Plan') + 1, Math.max(plans.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['1 class/week', '2 classes/week'], true).setAllowInvalid(true).build());

  if (!ss.getSheetByName('Dashboard')) ss.insertSheet('Dashboard', 0);
  const extra = ss.getSheetByName('Sheet1');
  if (extra && extra.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(extra);

  if (Session.getScriptTimeZone() !== ss.getSpreadsheetTimeZone()) {
    SpreadsheetApp.getUi().alert('Time zones differ: the script uses ' + Session.getScriptTimeZone() +
      ' and the sheet uses ' + ss.getSpreadsheetTimeZone() + '. Check-ins follow the sheet. To avoid confusion, set ' +
      'Project Settings → Time zone in the Apps Script editor to match File → Settings in the sheet.');
  }
  refreshDashboard();
}

function refreshDashboard() {
  const book = readBook_();
  const rows = dashboardRows_(book, nowParts_());
  const width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
  const grid = rows.map(function (r) { const out = r.slice(); while (out.length < width) out.push(''); return out; });
  const ss = ss_();
  const sh = ss.getSheetByName('Dashboard') || ss.insertSheet('Dashboard', 0);
  sh.clear();
  sh.getRange(1, 1, grid.length, width).setValues(grid);
  sh.getRange(1, 1).setFontStyle('italic').setFontColor('#666666');
  grid.forEach(function (r, i) {
    if (r[0] === 'Student' || r[0] === 'Last 14 days') sh.getRange(i + 1, 1, 1, width).setFontWeight('bold').setBackground('#f3eefc');
  });
  const owesCol = rows[2].indexOf('Owes') + 1;
  if (grid.length > 3) sh.getRange(4, owesCol, grid.length - 3, 1).setNumberFormat('$#,##0.00;-$#,##0.00;""');
  sh.setFrozenRows(0);
}

function sendWeeklySummary() {
  const book = readBook_();
  const cfg = configFrom_(book.config);
  const s = weeklySummary_(book, nowParts_());
  const esc = function (v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const section = function (title, items) {
    return '<h3 style="margin:18px 0 6px">' + esc(title) + '</h3>' +
      (items.length ? '<ul style="margin:0;padding-left:18px">' + items.join('') + '</ul>' : '<p style="margin:0;color:#777">None.</p>');
  };
  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px">',
    '<h2 style="margin:0 0 4px">' + esc(s.studio) + ' — this week</h2>',
    '<p style="margin:0;color:#555">' + s.visits + ' check-ins across ' + s.sessions.length + ' classes.</p>',
    section('Who owes', s.owes.map(function (o) {
      return '<li>' + esc(o.name) + ' — ' + esc(o.label) + (o.pending ? ' (includes $' + o.pending + ' they say they sent)' : '') +
        (o.requestUrl ? ' · <a href="' + esc(o.requestUrl) + '">Request on Venmo</a>' : '') + '</li>';
    })),
    section('Packages running out', s.lowCredits.map(function (o) {
      return '<li>' + esc(o.name) + ' — ' + (o.creditsLeft ? '1 class left' : 'used up') + '</li>';
    })),
    section("Regulars we haven't seen lately", s.lapsed.map(function (o) {
      return '<li>' + esc(o.name) + ' — last in ' + esc(o.last) + '</li>';
    })),
    section('New this week', s.newStudents.map(function (n) { return '<li>' + esc(n) + '</li>'; })),
    section('Classes', s.sessions.map(function (x) {
      return '<li>' + esc(x.day) + ' · ' + esc(x.name) + ' — ' + x.count + '</li>';
    })),
    '<p style="margin-top:20px;color:#999;font-size:12px">Details are in the Dashboard tab of the check-in sheet.</p>',
    '</div>',
  ].join('');
  MailApp.sendEmail({
    to: cfg.ownerEmail || Session.getEffectiveUser().getEmail(),
    subject: s.studio + ' check-ins: ' + s.visits + ' this week' + (s.owes.length ? ', ' + s.owes.length + ' owing' : ''),
    htmlBody: html,
  });
}

/** The Monday email and the nightly backup. Safe to run again: it replaces its own triggers. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sendWeeklySummary', 'backupNow'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendWeeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(2).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('The summary arrives Mondays around 8am; a backup is made every night around 2am.');
}

// ---------------------------------- backups ----------------------------------

const BACKUP_FOLDER = 'Check-in backups';
const BACKUP_KEEP_DAYS = 30;

/**
 * A dated copy of every data tab, in a "Check-in backups" Drive folder. Only
 * values and formatting are copied, never the script, so a backup can be
 * opened safely and never acts on its own. Keeps every backup from the last
 * 30 days, and before that the first one of each month. A failed nightly run
 * is emailed to the owner by Google.
 */
function backupNow() {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
  const copy = SpreadsheetApp.create(ss.getName() + ' — backup ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
  copy.setSpreadsheetTimeZone(tz);
  const blank = copy.getSheets()[0];
  Object.keys(SCHEMA).forEach(function (tab) {
    const sh = ss.getSheetByName(tab);
    if (sh) sh.copyTo(copy).setName(tab);
  });
  if (copy.getSheets().length > 1) copy.deleteSheet(blank);
  const folder = backupFolder_();
  DriveApp.getFileById(copy.getId()).moveTo(folder);
  pruneBackups_(folder);
  try { SpreadsheetApp.getActiveSpreadsheet().toast('Backed up to the "' + BACKUP_FOLDER + '" folder in Drive.'); } catch (e) { /* nightly run: no sheet open */ }
}

function backupFolder_() {
  const found = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return found.hasNext() ? found.next() : DriveApp.createFolder(BACKUP_FOLDER);
}

/** Old backups go to Drive's trash (recoverable for 30 days), never straight to deletion. */
function pruneBackups_(folder) {
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return a.getDateCreated() - b.getDateCreated(); });
  const monthsKept = {};
  files.forEach(function (f) {
    const month = (f.getName().match(/ — backup (\d{4}-\d{2})-\d{2}/) || [])[1];
    if (!month) return; // not one of ours
    const firstOfMonth = !monthsKept[month];
    monthsKept[month] = true;
    if (f.getDateCreated().getTime() < cutoff && !firstOfMonth) f.setTrashed(true);
  });
}
