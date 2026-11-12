/**
 * Code.gs — the Google side: reading and writing the Sheet, the web API,
 * the owner's menu, the Dashboard tab and the weekly email.
 * The rules themselves live in Logic.gs.
 *
 * Deployed as a web app (Execute as: Me, Who has access: Anyone). It is only
 * ever called with fetch() from the check-in page, never opened as a page,
 * so students never see Google's "created by an Apps Script user" banner.
 */

const TAB_KEYS = { Config: 'config', Schedule: 'schedule', Students: 'students', Log: 'log', Packages: 'packages', Plans: 'plans', Payments: 'payments', Tags: 'tags' };
// Written by the Wix sync (Wix.gs), never by hand; absent until it first runs. Defined here,
// not in Wix.gs, because top-level code can't rely on another file having loaded first.
const WIX_SCHEDULE_TAB = 'Wix schedule';
const WIX_PURCHASES_TAB = 'Wix purchases';
TAB_KEYS[WIX_SCHEDULE_TAB] = 'wixSchedule';
TAB_KEYS[WIX_PURCHASES_TAB] = 'wixPurchases';
const TODAY_TAB = 'Today';

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
  // The page pings while a new student types their email, so Google has the script warmed up by
  // the time they tap Check in. Answered without the lock or the Sheet.
  if (req && req.action === 'ping') return json_({ ok: true, version: APP_VERSION });
  // `timing: true` in a request adds where the time went (ms) to the answer; numbers only.
  const t = [Date.now()];
  const mark = function (label) { t.push(label, Date.now()); };
  // The Today tab, rewritten after a check-in by a follow-up request from the page, so the
  // student never waits for it (see writeToday_). No lock: it only writes Today, from a fresh read.
  if (req && req.action === 'todayTab') {
    try { writeToday_(readBook_(), nowParts_()); } catch (err) { console.warn('Today tab not updated: ' + err); }
    return json_({ ok: true });
  }
  // Only reads (the owner page's lists) skip the lock, so they never queue behind check-ins.
  const readOnly = req && req.action === 'owner' && (req.op === 'today' || req.op === 'students');
  // One lock around read → decide → write, so a double tap cannot slip a
  // second check-in in between the duplicate check and the append.
  const lock = readOnly ? null : LockService.getScriptLock();
  try {
    if (lock) lock.waitLock(15000);
    mark('lock');
    ss_();
    mark('open');
    const book = readBook_();
    mark('read');
    const now = nowParts_();
    const io = sheetIo_(book);
    const res = handleRequest_(book, req, now, io);
    mark('handle');
    // A new row was written: the page then asks for the Today tab to be rewritten (action
    // 'todayTab'), after it has shown the student their answer.
    const wrote = res.wrote || (res.ok && (res.status === 'ok' || res.status === 'reset' || (res.status === 'unscheduled' && !res.already)));
    if (wrote) res.todayTab = true;
    if (io.wroteAny) SpreadsheetApp.flush(); // the writes land before the next request gets the lock
    mark('flush');
    if (req.timing) {
      res.ms = {};
      for (let i = 1; i < t.length; i += 2) res.ms[t[i]] = t[i + 1] - t[i - 1];
    }
    return json_(res);
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Something went wrong on the studio side. Please try again.' });
  } finally {
    if (lock) try { lock.releaseLock(); } catch (e2) { /* never held */ }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------- sheet -----------------------------------

// Opened once per run: in the web app there's no "active" spreadsheet, and opening it by ID
// is one of the slowest calls there is, so it must not happen again for every helper.
let SS_ = null, TZ_ = null;
function ss_() {
  if (SS_) return SS_;
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return (SS_ = active);
  const id = PropertiesService.getScriptProperties().getProperty('spreadsheetId');
  if (!id) throw new Error('Run setup() once from the Apps Script editor first.');
  return (SS_ = SpreadsheetApp.openById(id));
}

function tz_() { return TZ_ || (TZ_ = ss_().getSpreadsheetTimeZone()); }

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

// Date columns, by header. The fast read gets dates as day numbers and needs to know which
// columns hold them (a Price of 20 and a date are both just numbers there).
const DATE_HEADERS = ['When', 'ClassDate', 'FirstSeen', 'Purchased', 'Expires', 'End', 'Date', 'FirstDate', 'LastDate'];
const DATE_HEADERS_BY_TAB = { Plans: ['Start'] }; // Schedule's Start is a time of day, not a date

/** A Sheets day number (days since 1899-12-30, in the Sheet's own wall-clock time) → Logic.gs's strings. */
function serialToText_(n) {
  const ms = Math.round(n * 86400) * 1000 - 25569 * 86400000;
  const iso = new Date(ms).toISOString(); // UTC here is just a calendar: no time zone is applied
  if (n < 1) return iso.slice(11, 16);    // a time on its own
  return iso.slice(11, 19) === '00:00:00' ? iso.slice(0, 10) : iso.slice(0, 10) + ' ' + iso.slice(11, 19);
}

/**
 * Every tab as arrays of objects keyed by header, in ONE call to the Sheets API
 * (reading tab by tab took seconds). Falls back to the tab-by-tab read if the
 * Sheets advanced service isn't available.
 */
function readBook_() {
  const ss = ss_();
  let ranges;
  try {
    const have = ss.getSheets().map(function (s) { return s.getName(); });
    const tabs = Object.keys(TAB_KEYS).filter(function (t) { return have.indexOf(t) >= 0; });
    const res = Sheets.Spreadsheets.Values.batchGet(ss.getId(), {
      ranges: tabs.map(function (t) { return "'" + t.replace(/'/g, "''") + "'"; }),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    ranges = {};
    tabs.forEach(function (t, i) { ranges[t] = (res.valueRanges[i] && res.valueRanges[i].values) || []; });
  } catch (e) {
    console.warn('Fast read failed, reading tab by tab: ' + e);
    return readBookSlow_();
  }
  const book = { headers: {} };
  Object.keys(TAB_KEYS).forEach(function (tab) {
    const values = ranges[tab] || [];
    const headers = values.length ? values[0].map(function (h) { return String(h).trim(); }) : SCHEMA[tab];
    const dates = DATE_HEADERS.concat(DATE_HEADERS_BY_TAB[tab] || []);
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      if (!v.some(function (x) { return x !== '' && x != null; })) continue;
      const obj = { _row: i + 1 };
      headers.forEach(function (h, j) {
        if (!h) return;
        const x = j < v.length ? v[j] : '';
        obj[h] = typeof x === 'number' && dates.indexOf(h) >= 0 ? serialToText_(x) : x;
      });
      rows.push(obj);
    }
    book.headers[tab] = headers;
    book[TAB_KEYS[tab]] = rows;
  });
  fillClassIds_(ss, book);
  return book;
}

/** The original tab-by-tab read; only used if the fast one fails. */
function readBookSlow_() {
  const ss = ss_(), tz = tz_();
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
      const shown = tab === 'Schedule' || tab === WIX_SCHEDULE_TAB ? range.getDisplayValues() : null;
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

// New students allowed per hour, across everyone. A real studio signs up a handful; this only
// stops a script from filling the Sheet with made-up ones.
const NEW_STUDENTS_PER_HOUR = 40;

function sheetIo_(book) {
  const ss = ss_(), tz = tz_();
  return {
    newId: function (prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10); },
    // The studio page's links, {name: key}: admins (menu) and teachers (made on the page's Team tab).
    ownerKeys: ownerKeys_,
    teacherKeys: teacherKeys_,
    saveTeacherKeys: saveTeacherKeys_,
    newKey: newLinkKey_,
    allowNewStudent: function () {
      const cache = CacheService.getScriptCache();
      const key = 'newStudents:' + Utilities.formatDate(new Date(), tz, 'yyyyMMddHH');
      const n = Number(cache.get(key) || 0);
      if (n >= NEW_STUDENTS_PER_HOUR) return false;
      cache.put(key, String(n + 1), 2 * 60 * 60); // only ever touched inside doPost's lock
      return true;
    },
    // Changes cells of a row that was read from the Sheet (a tester's reset voids rows this way).
    wroteAny: false,
    update: function (tab, row, fields) {
      if (!row._row) return;
      this.wroteAny = true;
      const sh = ss.getSheetByName(tab);
      Object.keys(fields).forEach(function (h) {
        let col = book.headers[tab].indexOf(h) + 1;
        if (!col) col = addHeader_(sh, book.headers[tab], h); // a tab from before this column existed
        sh.getRange(row._row, col).setValue(toCell_(fields[h], tz));
      });
    },
    append: function (tab, row) {
      this.wroteAny = true;
      const headers = book.headers[tab];
      const sh = ss.getSheetByName(tab);
      // A column the tab doesn't have yet (Log's By, on a Sheet from before it existed) is added first.
      Object.keys(row).forEach(function (h) {
        if (str_(row[h]) !== '' && headers.indexOf(h) < 0 && (SCHEMA[tab] || []).indexOf(h) >= 0) addHeader_(sh, headers, h);
      });
      sh.appendRow(headers.map(function (h) { return toCell_(row[h], tz); }));
    },
  };
}

/** Adds a header at the right of row 1 (bold), records it in `headers`, and returns its column number. */
function addHeader_(sh, headers, h) {
  let last = headers.length;
  while (last > 0 && !headers[last - 1]) last--; // after the last real header, not after stray blank ones
  sh.getRange(1, last + 1).setValue(h).setFontWeight('bold');
  headers[last] = h;
  return last + 1;
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
  return textSafe_(v);
}

/**
 * Text that came from a student (a name, a note) or from Wix is written as text, never as a
 * formula: Sheets runs anything starting with = (and treats + - @ specially), so a "name" like
 * =IMPORTDATA(…) could otherwise act inside the owner's Sheet. The leading ' is how Sheets
 * marks text; it isn't part of the value read back.
 */
function textSafe_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}
function textSafeGrid_(grid) {
  return grid.map(function (r) { return r.map(textSafe_); });
}

// ----------------------------------- owner -----------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Check-in')
    .addItem('Check someone in…', 'checkInSomeone')
    .addItem('Refresh dashboard', 'refreshDashboard')
    .addItem('Email me the weekly summary now', 'sendWeeklySummary')
    .addItem('Back up now', 'backupNow')
    .addSeparator()
    .addItem('Turn on the Monday email and nightly backups', 'installTriggers')
    .addItem('Make a code for a new sign or tag…', 'makeTagCode')
    .addItem('Make an admin link for the studio page…', 'makeOwnerLink')
    .addItem('Rename a studio page link…', 'renameOwnerLink')
    .addItem('Turn off a studio page link…', 'turnOffOwnerLink')
    .addItem('Make test links for testers (dev copy)', 'makeTestLinks')
    .addItem('First-time setup', 'setup')
    .addItem('Test the Wix connection (read-only)', 'wixTest')
    .addItem('Get classes and purchases from Wix now (and every hour)', 'wixSyncNow')
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
    if (sh) {
      // An older tab gets any columns added since, on the right; nothing is moved or renamed.
      const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
      SCHEMA[tab].forEach(function (h) { if (have.indexOf(h) < 0) addHeader_(sh, have, h); });
      return;
    }
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
      ['', 'Example: Dance 101', 'Mon', '7:00 PM', 60, '', 'no'],
      ['', 'Example: Company Practice', 'Wed', '5:00 PM', 120, 0, 'no'],
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
  // Log status: ok (counts), void (undone), unscheduled (came for a class not on the schedule; to review).
  const log = ss.getSheetByName('Log');
  const statusCol = log.getRange(1, 1, 1, log.getLastColumn()).getValues()[0].indexOf('Status') + 1;
  if (statusCol) log.getRange(2, statusCol, Math.max(log.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['ok', 'void', UNSCHEDULED], true).setAllowInvalid(true).build());

  // Tag codes are text, never numbers or dates.
  const tags = ss.getSheetByName('Tags');
  const codeCol = tags.getRange(1, 1, 1, tags.getLastColumn()).getValues()[0].indexOf('Code') + 1;
  if (codeCol) tags.getRange(2, codeCol, Math.max(tags.getMaxRows() - 1, 1), 1).setNumberFormat('@');

  if (!ss.getSheetByName('Dashboard')) ss.insertSheet('Dashboard', 0);
  if (!ss.getSheetByName(TODAY_TAB)) ss.insertSheet(TODAY_TAB, 0); // first, so it's what the Sheets app opens to
  const extra = ss.getSheetByName('Sheet1');
  if (extra && extra.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(extra);

  if (Session.getScriptTimeZone() !== ss.getSpreadsheetTimeZone()) {
    SpreadsheetApp.getUi().alert('Time zones differ: the script uses ' + Session.getScriptTimeZone() +
      ' and the sheet uses ' + ss.getSpreadsheetTimeZone() + '. Check-ins follow the sheet. Set File → Settings → Time zone ' +
      'in the sheet to match, or change timeZone in apps-script/appsscript.json and push again.');
  }
  refreshDashboard();
}

/** The Today tab (todayRows_ in Logic.gs). Cheap enough to run after every check-in. */
function writeToday_(book, now) {
  const rows = todayRows_(book, now);
  const width = 3;
  const grid = rows.map(function (r) { const out = r.slice(0, width); while (out.length < width) out.push(''); return out; });
  const ss = ss_();
  const sh = ss.getSheetByName(TODAY_TAB) || ss.insertSheet(TODAY_TAB, 0);
  // This runs inside a check-in, so it's a fixed handful of calls however many classes there are:
  // the values and every row's formatting each go in one call.
  const head = grid.map(function (r, i) { return i > 0 && !!r[0] && /checked in$| so far$/.test(r[1]); });
  const each = function (fn) { return grid.map(function (r, i) { return r.map(function () { return fn(i); }); }); };
  sh.clear();
  sh.getRange(1, 1, grid.length, width)
    .setValues(textSafeGrid_(grid))
    .setFontWeights(each(function (i) { return head[i] ? 'bold' : 'normal'; }))
    .setBackgrounds(each(function (i) { return head[i] ? '#ccf5f4' : null; }))
    .setFontStyles(each(function (i) { return i === 0 ? 'italic' : 'normal'; }))
    .setFontColors(each(function (i) { return i === 0 ? '#666666' : null; }));
}

function refreshDashboard() {
  const book = readBook_();
  try { writeToday_(book, nowParts_()); } catch (e) { console.warn('Today tab not updated: ' + e); }
  const rows = dashboardRows_(book, nowParts_());
  const width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
  const grid = rows.map(function (r) { const out = r.slice(); while (out.length < width) out.push(''); return out; });
  const ss = ss_();
  const sh = ss.getSheetByName('Dashboard') || ss.insertSheet('Dashboard', 0);
  sh.clear();
  sh.getRange(1, 1, grid.length, width).setValues(textSafeGrid_(grid));
  sh.getRange(1, 1).setFontStyle('italic').setFontColor('#666666');
  grid.forEach(function (r, i) {
    if (r[0] === 'Student' || r[0] === 'Last 14 days') sh.getRange(i + 1, 1, 1, width).setFontWeight('bold').setBackground('#ccf5f4');
  });
  const owesCol = rows[2].indexOf('Owes') + 1;
  if (grid.length > 3) sh.getRange(4, owesCol, grid.length - 3, 1).setNumberFormat('$#,##0.00;-$#,##0.00;""');
  sh.setFrozenRows(0);
}

/**
 * Owner menu: check in a student who has no phone with them, or is new at the
 * door. Asks who and which of today's classes, then applies the same rules as
 * the page (a pass or plan covers it, otherwise it's a drop-in). For another
 * day, the owner adds a row to Log by hand.
 */
function checkInSomeone() {
  const ui = SpreadsheetApp.getUi();
  const ask = function (title, text) {
    const r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
  };
  let book = readBook_();
  const now = nowParts_();
  const classes = allClassesToday_(book, now.date);
  if (!classes.length) {
    ui.alert('No classes on today\'s schedule. To record a class on another day, add a row to the Log tab by hand.');
    return;
  }

  const who = ask('Check someone in', 'Their email, or their name as it appears in the Students tab:');
  if (!who) return;
  let email = '', name = '';
  if (validEmail_(cleanEmail_(who))) {
    email = cleanEmail_(who);
    if (!findStudentByEmail_(book, email)) {
      name = ask('New student', email + ' hasn\'t checked in before. Their name:');
      if (!name) return;
    }
  } else {
    const sid = resolveStudentId_(book, who);
    const s = (book.students || []).filter(function (x) { return String(x.StudentID) === sid; })[0];
    if (!s) {
      ui.alert('No single student is called "' + who + '". Try their email (for someone new, their email and then their name).');
      return;
    }
    email = cleanEmail_(s.Email);
  }

  let picked;
  if (classes.length === 1) {
    const c = classes[0];
    if (ui.alert('Check in', 'Check ' + (name || who) + ' in to ' + c.name + ' at ' + fmtTime_(c.start) + '?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    picked = [c.id];
  } else {
    const list = classes.map(function (c, i) { return (i + 1) + '.  ' + fmtTime_(c.start) + '  ' + c.name; }).join('\n');
    const nums = ask('Which class?', list + '\n\nType the number. For several, separate them with commas (e.g. 1, 2).');
    if (!nums) return;
    picked = nums.split(/[^0-9]+/).filter(String).map(Number).map(function (n) { return classes[n - 1]; });
    if (!picked.length || picked.some(function (c) { return !c; })) {
      ui.alert('Please type a number from the list.');
      return;
    }
    picked = picked.map(function (c) { return c.id; });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let res;
  try {
    book = readBook_(); // fresh, in case a student checked in while the owner was typing
    // By: whoever is using the menu (their Google email), so the Log says who checked them in.
    let by = '';
    try { by = Session.getActiveUser().getEmail(); } catch (e) { /* not available */ }
    res = ownerCheckin_(book, { email: email, name: name, classIds: picked }, now, sheetIo_(book), by || 'Sheet menu');
    if (res.ok) writeToday_(book, now);
  } finally {
    lock.releaseLock();
  }
  if (!res.ok) {
    ui.alert(res.error || 'That didn\'t work.');
    return;
  }
  const t = res.account && res.account.these;
  const how = !t ? '' : [t.plan ? 'covered by their plan' : '', t.package ? 'used ' + t.package + ' from their class pass' : '',
    t.free ? 'free' : '', t.dropin ? 'drop-in, ' + t.dropinLabel : ''].filter(String).join('; ');
  const done = res.checkins.map(function (c) { return c.name + (c.already ? ' (already checked in)' : ''); }).join(', ');
  ui.alert('Checked in', ((findStudentByEmail_(book, email) || {}).Name || res.student.name) + ': ' + done + '.' + (how ? '\n' + how.charAt(0).toUpperCase() + how.slice(1) + '.' : '') +
    (res.account && res.account.owed > 0 ? '\nThey owe ' + res.account.owedLabel + ' in total.' : ''), ui.ButtonSet.OK);
}

/**
 * Owner menu: a new random code for a sign, sticker or totem, added to the Tags
 * tab, and the address to write to its NFC tag and QR code. Once Tags has an
 * active code, only addresses with one of them can check in. A code that leaks
 * (a photo of the QR code passed around) is retired by setting Active to no.
 */
function makeTagCode() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('New sign or tag', 'A name for it, so the Log shows where each check-in came from (e.g. Front door, Totem 2):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const name = r.getResponseText().trim().slice(0, 40) || 'Sign';
  const code = newTagCode_();
  const ss = ss_();
  const sh = ss.getSheetByName('Tags');
  if (!sh) { ui.alert('Run Check-in → First-time setup first; it adds the Tags tab.'); return; }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const row = { Code: code, Name: name, Active: 'yes', Notes: 'Made ' + nowParts_().date };
  sh.appendRow(headers.map(function (h) { return textSafe_(row[h] == null ? '' : row[h]); }));
  const book = readBook_();
  const page = configFrom_(book.config).pageUrl;
  const url = page ? page.replace(/[?#].*$/, '').replace(/\/?$/, '/') + '?t=' + code : '';
  const first = tagsFrom_(book).length === 1;
  ui.alert('Code for ' + name, (url ? 'Write this address to its NFC tag and QR code:\n\n' + url
    : 'Its address is your check-in page\'s address followed by ?t=' + code +
      '\n(Put the page address in pageUrl in Config and this shows it in full.)') +
    (first ? '\n\nThis is the first code, so from now on only signs with a code in the Tags tab can check people in. ' +
      'Rewrite any older sticker or QR code with its new address.' : ''), ui.ButtonSet.OK);
}

// The studio page's links. Admins ({name: key} in Script Properties → ownerKeys) are made here in
// the Sheet's menu; teachers (→ teacherKeys) are made by an admin on the page's Team tab, and can
// be turned off from either place (renamed here). Keys are only ever compared, never sent out
// (except once, to the admin who just made a teacher's link).
function ownerKeys_() {
  const props = PropertiesService.getScriptProperties();
  let keys = {};
  try { keys = JSON.parse(props.getProperty('ownerKeys') || '{}') || {}; } catch (e) { keys = {}; }
  const legacy = props.getProperty('ownerKey');
  if (legacy && !keys.Owner) keys.Owner = legacy;
  return keys;
}

function saveOwnerKeys_(keys) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ownerKeys', JSON.stringify(keys));
  props.deleteProperty('ownerKey'); // now kept in ownerKeys (as "Owner")
}

function teacherKeys_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('teacherKeys') || '{}') || {}; } catch (e) { return {}; }
}

function saveTeacherKeys_(keys) {
  PropertiesService.getScriptProperties().setProperty('teacherKeys', JSON.stringify(keys));
}

/** 24 letters ≈ 96 random bits. */
function newLinkKey_() { return newTagCode_() + newTagCode_(); }

/** Every link by name, for the menu: "Caress (admin), Dee (teacher)". */
function linkList_() {
  const a = ownerKeys_(), t = teacherKeys_();
  return Object.keys(a).map(function (n) { return { name: n, role: 'admin', keys: a, save: saveOwnerKeys_ }; })
    .concat(Object.keys(t).map(function (n) { return { name: n, role: 'teacher', keys: t, save: saveTeacherKeys_ }; }));
}
function linkNames_(list) { return list.map(function (l) { return l.name + ' (' + l.role + ')'; }).join(', '); }
function findLink_(list, typed) {
  const t = String(typed || '').trim().toLowerCase();
  return list.filter(function (l) { return l.name.toLowerCase() === t; })[0] || null;
}

/** The page's address from Config → pageUrl, for showing a link in full ('' if it isn't set). */
function pageBase_() {
  const page = configFrom_(readBook_().config).pageUrl;
  return page ? page.replace(/[?#].*$/, '').replace(/[^/]*$/, '') : '';
}

/**
 * Menu: a private admin link to the studio page (web/owner.html) for one person's phone, named
 * after them. Admins can do everything there, including making teacher links. Making one for a
 * name that already has a link replaces it (the old one stops working), so a lost phone or a link
 * sent to the wrong person is fixed by running this again.
 */
function makeOwnerLink() {
  const ui = SpreadsheetApp.getUi();
  const keys = ownerKeys_();
  const list = linkList_();
  const r = ui.prompt('Admin link', 'Who is this admin link for? An admin can do everything on the studio page, ' +
    'including making links for teachers there. Their name is recorded on each check-in they make (e.g. Caress).' +
    (list.length ? '\n\nLinks so far: ' + linkNames_(list) + '. Using an admin\'s name replaces their link.' : ''), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const typed = r.getResponseText().replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!typed) return;
  const found = findLink_(list, typed);
  if (found && found.role === 'teacher') {
    ui.alert(found.name + ' has a teacher link. Turn it off first (menu: Turn off a studio page link…), then make the admin link.');
    return;
  }
  const name = found ? found.name : typed;
  if (keys[name] && ui.alert('Replace ' + name + '\'s link?', 'Their current link will stop working, and they\'ll need the new one.',
    ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  keys[name] = newLinkKey_();
  saveOwnerKeys_(keys);
  const base = pageBase_();
  ui.alert('Admin link for ' + name, (base ? base + 'owner.html#k=' + keys[name]
    : 'Your check-in page\'s address followed by owner.html#k=' + keys[name] + '\n(Put the page address in pageUrl in Config and this shows it in full.)') +
    '\n\nSend it to ' + name + ' only. They open it once on their phone and it remembers them; ' +
    'they can add it to their home screen. Anyone with this link can see student names and emails and change plans.', ui.ButtonSet.OK);
}

/**
 * Menu: renames a link (admin or teacher) without changing it, so its holder needs nothing new.
 * Check-ins already made with it keep the old name in Log → By.
 */
function renameOwnerLink() {
  const ui = SpreadsheetApp.getUi();
  const list = linkList_();
  if (!list.length) { ui.alert('There are no links yet.'); return; }
  const r1 = ui.prompt('Rename a link', 'Which link? ' + linkNames_(list), ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const from = findLink_(list, r1.getResponseText());
  if (!from) { ui.alert('No link is called "' + r1.getResponseText().trim() + '".'); return; }
  const r2 = ui.prompt('Rename ' + from.name + '\'s link', 'New name (e.g. Caress). The link itself stays the same.', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const to = r2.getResponseText().replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!to || to === from.name) return;
  if (list.some(function (l) { return l.name !== from.name && l.name.toLowerCase() === to.toLowerCase(); })) {
    ui.alert('There is already a link called ' + to + '.');
    return;
  }
  from.keys[to] = from.keys[from.name];
  delete from.keys[from.name];
  from.save(from.keys);
  ui.alert(from.name + '\'s link is now called ' + to + '. It still works as before; from now on its check-ins say "' + to + '".');
}

/** Menu: stops one person's link (admin or teacher) working. */
function turnOffOwnerLink() {
  const ui = SpreadsheetApp.getUi();
  const list = linkList_();
  if (!list.length) { ui.alert('There are no links yet.'); return; }
  const r = ui.prompt('Turn off a link', 'Whose link? ' + linkNames_(list), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const l = findLink_(list, r.getResponseText());
  if (!l) { ui.alert('No link is called "' + r.getResponseText().trim() + '".'); return; }
  delete l.keys[l.name];
  l.save(l.keys);
  ui.alert(l.name + '\'s link is turned off.');
}

/** Letters only, so Sheets never mistakes a code for a number (like 12e45). 12 letters ≈ 48 random bits. */
function newTagCode_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12).replace(/[0-9a-f]/g, function (h) {
    return 'abcdefghjkmnpqrs'.charAt(parseInt(h, 16));
  });
}

const TEST_LINKS_TAB = 'Test links';

/**
 * Owner menu, dev copy only: one link per test scenario (TEST_SCENARIOS in
 * Logic.gs), as Tags rows with a Scenario, listed in a "Test links" tab ready
 * to copy into a message for testers. Running it again reuses the same links.
 * Every tester can use the same links: each one is told apart by their email.
 */
function makeTestLinks() {
  const ui = SpreadsheetApp.getUi();
  const book = readBook_();
  const cfg = configFrom_(book.config);
  if (!/^(y|yes|true|on|1)$/i.test(cfg.testScenarios)) {
    ui.alert('Test links only work in your dev copy, with testScenarios set to yes in Config. Set it there first (never in the studio\'s copy).');
    return;
  }
  if (!cfg.pageUrl) { ui.alert('Put the check-in page\'s address in pageUrl in Config first.'); return; }
  const ss = ss_();
  const sh = ss.getSheetByName('Tags');
  if (!sh) { ui.alert('Run Check-in → First-time setup first; it adds the Tags tab.'); return; }
  let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (headers.indexOf('Scenario') < 0) { // a Tags tab made before test links existed
    sh.getRange(1, headers.length + 1).setValue('Scenario').setFontWeight('bold');
    headers = headers.concat(['Scenario']);
  }
  const page = cfg.pageUrl.replace(/[?#].*$/, '').replace(/\/?$/, '/');
  const rows = [
    ['Test links for testers. Copy the lines below into a message: each tester taps one link at a time on their phone.'],
    ['Each tester is told apart by the email they enter, so everyone can use the same links. Any time, any day: the classes are pretend ones around the moment they tap.'],
    [],
    ['#', 'What happens', 'What to try', 'Link'],
  ];
  TEST_SCENARIOS.forEach(function (s, i) {
    const have = (book.tags || []).filter(function (t) { return String(t.Scenario).toLowerCase() === s.id && !isNo_(t.Active); })[0];
    let code = have && String(have.Code);
    if (!code) {
      code = newTagCode_();
      const row = { Code: code, Name: 'Test: ' + s.label, Active: 'yes', Notes: 'Test link, made ' + nowParts_().date, Scenario: s.id };
      sh.appendRow(headers.map(function (h) { return textSafe_(row[h] == null ? '' : row[h]); }));
    }
    rows.push([i + 1, s.label, s.try, page + '?t=' + code]);
  });
  const out = ss.getSheetByName(TEST_LINKS_TAB) || ss.insertSheet(TEST_LINKS_TAB);
  out.clear();
  const grid = rows.map(function (r) { const c = r.slice(); while (c.length < 4) c.push(''); return c; });
  out.getRange(1, 1, grid.length, 4).setValues(textSafeGrid_(grid));
  out.getRange(4, 1, 1, 4).setFontWeight('bold').setBackground('#ccf5f4');
  out.activate();
  ss.toast('Test links are in the "' + TEST_LINKS_TAB + '" tab. Turn testScenarios back to no to switch them all off.', 'Test links', 10);
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
    s.review.length ? section("To review: came for a class that wasn't on the schedule", s.review.map(function (o) {
      return '<li>' + esc(o.name) + ' — ' + esc(o.day) + (o.note ? ': “' + esc(o.note) + '”' : '') + '</li>';
    })) + '<p style="margin:4px 0 0;color:#777">In the Log tab, fill in the Class and set Status to ok, or void if they didn\'t take one.</p>' : '',
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
