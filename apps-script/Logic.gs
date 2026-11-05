/**
 * Logic.gs — the check-in rules, with no Google services in it.
 *
 * Loaded three ways: by Apps Script (next to Code.gs), by the Node tests
 * (scripts/test_logic.js) and by the local preview's mock backend
 * (web/mock.js). Keep it free of SpreadsheetApp, Utilities and friends.
 *
 * Everything here works on wall-clock values in the studio's time zone:
 * days are 'yyyy-MM-dd' strings and times are minutes after midnight.
 * Code.gs does the converting, so no time-zone arithmetic lives here.
 */

const APP_VERSION = '1.0.0';

// Header names ARE the contract between the Sheet, this file and the mock.
// Columns may be reordered or added in the Sheet; renaming one breaks it.
const SCHEMA = {
  Config: ['Key', 'Value', 'Notes'],
  Schedule: ['ClassID', 'Class', 'Days', 'Start', 'Minutes', 'Price', 'Active', 'FirstDate', 'LastDate'],
  Students: ['StudentID', 'Name', 'Email', 'Phone', 'Venmo', 'FirstSeen', 'Notes'],
  Log: ['CheckinID', 'When', 'ClassDate', 'StudentID', 'Student', 'ClassID', 'Class', 'Price', 'Source', 'Status', 'Note'],
  Packages: ['PackageID', 'Student', 'Classes', 'Purchased', 'Expires', 'Amount', 'Note'],
  Plans: ['PlanID', 'Student', 'Plan', 'Start', 'End', 'Note'],
  Payments: ['PaymentID', 'Student', 'Amount', 'Date', 'For', 'Status', 'Method', 'Note'],
};

const DEFAULT_CONFIG = {
  studioName: 'Your Studio',
  venmoHandle: '',
  dropInPrice: 20,
  opensMinutesBefore: 30,
  lateMinutesAfterEnd: 90,
  ownerEmail: '',
  lapsedAfterDays: 21,
  wixSkip: 'Kids',
  chatLink: '',
};

const CONFIG_NOTES = {
  studioName: 'Shown on the check-in page and in emails.',
  venmoHandle: "The studio's Venmo username, without the @.",
  dropInPrice: 'Default price of one class. A class can override it in Schedule → Price (0 = free).',
  opensMinutesBefore: 'Check-in opens this many minutes before a class starts.',
  lateMinutesAfterEnd: 'Check-in stays open this many minutes after a class ends, for anyone who forgot on the way in.',
  ownerEmail: 'Where the weekly summary goes. Blank = the account that owns this sheet.',
  lapsedAfterDays: 'A regular who has not been in for this many days shows as lapsed.',
  chatLink: "Invite link to the studio's group chat (e.g. a Telegram invite link). Students see a Join button after checking in. Blank = no button.",
  wixSkip: 'Wix classes to leave out of check-in: words in the class name, separated by commas (e.g. Kids, Private). "none" = take them all.',
};

const DAY_KEYS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ------------------------------ small helpers ------------------------------

function str_(v) { return v == null ? '' : String(v).trim(); }
function num_(v, dflt) { const n = typeof v === 'number' ? v : parseFloat(str_(v).replace(/[$,]/g, '')); return isFinite(n) ? n : dflt; }
function round2_(n) { return Math.round(n * 100) / 100; }
function isNo_(v) { return /^(n|no|false|0|off|inactive)$/i.test(str_(v)); }
function cleanEmail_(v) { return str_(v).toLowerCase(); }
function validEmail_(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

/** 'Mon, Wed' / 'Tuesday & Thursday' / 'sat' → [1, 3] (ISO: 1 = Monday). */
function parseDays_(v) {
  const out = [];
  str_(v).toLowerCase().split(/[^a-z]+/).forEach(function (tok) {
    const d = DAY_KEYS[tok.slice(0, 3)];
    if (d && out.indexOf(d) < 0) out.push(d);
  });
  return out.sort();
}

/** '7:00 PM' / '7pm' / '19:00' / '7:30p.m.' → minutes after midnight, or null. */
function parseTime_(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) return Math.round(v * 1440); // a Sheets time fraction
  const m = str_(v).toLowerCase().match(/^(\d{1,2})(?::(\d{2})(?::\d{2})?)?\s*(?:([ap])\.?m?\.?)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'p' ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

function fmtTime_(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return ((h + 11) % 12 + 1) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
}

/** First 10 chars of a 'yyyy-MM-dd…' value, or '' if it is not one. */
function dayStr_(v) {
  const s = str_(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function addDays_(day, n) {
  const p = day.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.toISOString().slice(0, 10);
}

function dowOf_(day) {
  const p = day.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() || 7;
}

function fmtDay_(day) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = day.split('-');
  return DAY_LABELS[dowOf_(day)] + ' ' + months[+p[1] - 1] + ' ' + (+p[2]);
}

function money_(n) {
  return '$' + (Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2));
}

// --------------------------------- reading ---------------------------------

function configFrom_(rows) {
  const cfg = Object.assign({}, DEFAULT_CONFIG);
  (rows || []).forEach(function (r) {
    const k = str_(r.Key);
    if (!(k in DEFAULT_CONFIG) || str_(r.Value) === '') return;
    cfg[k] = typeof DEFAULT_CONFIG[k] === 'number' ? num_(r.Value, DEFAULT_CONFIG[k]) : str_(r.Value);
  });
  cfg.venmoHandle = cfg.venmoHandle.replace(/^@/, '');
  return cfg;
}

function classFrom_(r, cfg) {
  const name = str_(r.Class);
  const days = parseDays_(r.Days);
  const start = parseTime_(r.Start);
  return {
    // A blank ClassID is filled in by Code.gs; the fallback only matters to the tests and mock.
    id: str_(r.ClassID) || (name + '|' + days.join('') + '|' + start),
    name: name,
    days: days,
    start: start,
    minutes: num_(r.Minutes, 60),
    price: str_(r.Price) === '' ? cfg.dropInPrice : num_(r.Price, cfg.dropInPrice),
    active: !isNo_(r.Active),
    first: dayStr_(r.FirstDate),
    last: dayStr_(r.LastDate),
  };
}

/**
 * The owner's Schedule tab plus the "Wix schedule" tab the Wix sync writes.
 * A typed class with the same name as one in Wix is left out: Wix decides when
 * that class runs, so a session cancelled in Wix can't come back from a row
 * typed before Wix was connected, and nothing shows twice. Typed classes Wix
 * doesn't have keep working.
 */
function classesFrom_(book, cfg) {
  const ok = function (c) { return c.name && c.start != null && c.days.length; };
  const wix = (book.wixSchedule || []).map(function (r) { return classFrom_(r, cfg); }).filter(ok);
  const inWix = {};
  wix.forEach(function (c) { inWix[c.name.toLowerCase()] = true; });
  const typed = (book.schedule || []).map(function (r) { return classFrom_(r, cfg); })
    .filter(function (c) { return ok(c) && !inWix[c.name.toLowerCase()]; });
  return typed.concat(wix);
}

/** Header of the "Wix schedule" tab: the Schedule columns plus where each row came from. */
const WIX_SCHEDULE_HEADERS = SCHEMA.Schedule.concat(['WixService']);

/**
 * Wix calendar sessions → rows for the "Wix schedule" tab, one per session,
 * each on its own date (FirstDate = LastDate), so classIsOn_() needs nothing new.
 *   sessions: [{ title, serviceId, start: 'yyyy-MM-ddTHH:mm[:ss]', end, status, type }]
 *   services: { <serviceId>: { name, price: number|null } }  (price null = use dropInPrice)
 * Cancelled sessions, appointments and classes matching cfg.wixSkip are left out.
 * The ClassID is the same for a service at the same start time every week, so
 * the Dashboard and Log treat "Dance 101, Mon 7pm" as one class over time, while
 * two sessions of a class on the same day stay separate check-ins.
 */
function wixScheduleRows_(sessions, services, cfg) {
  const skip = str_(cfg.wixSkip).toLowerCase() === 'none' ? [] :
    str_(cfg.wixSkip).toLowerCase().split(',').map(function (w) { return w.trim(); }).filter(String);
  const rows = [], seen = {};
  (sessions || []).forEach(function (s) {
    if (str_(s.status).toUpperCase() === 'CANCELLED') return;
    if (['CLASS', 'COURSE'].indexOf(str_(s.type).toUpperCase()) < 0) return;
    const svc = services[s.serviceId] || {};
    const name = str_(s.title) || str_(svc.name);
    const lower = name.toLowerCase();
    if (!name || skip.some(function (w) { return lower.indexOf(w) >= 0; })) return;
    const day = dayStr_(s.start);
    const start = parseTime_(str_(s.start).slice(11, 16));
    const end = parseTime_(str_(s.end).slice(11, 16));
    if (!day || start == null) return;
    const hhmm = str_(s.start).slice(11, 16);
    const id = 'W' + str_(s.serviceId).replace(/-/g, '').slice(0, 8) + '-' + hhmm.replace(':', '');
    if (seen[day + '|' + id]) return;
    seen[day + '|' + id] = true;
    rows.push({
      ClassID: id,
      Class: name,
      Days: DAY_LABELS[dowOf_(day)],
      Start: hhmm,
      Minutes: end != null && end > start ? end - start : 60,
      Price: svc.price == null ? '' : svc.price,
      Active: 'yes',
      FirstDate: day,
      LastDate: day,
      WixService: str_(s.serviceId),
    });
  });
  return rows.sort(function (a, b) { return (a.FirstDate + a.Start) < (b.FirstDate + b.Start) ? -1 : 1; });
}

function classIsOn_(c, day) {
  return c.active && c.days.indexOf(dowOf_(day)) >= 0 &&
    (!c.first || day >= c.first) && (!c.last || day <= c.last);
}

function findStudentByEmail_(book, email) {
  return (book.students || []).filter(function (s) { return cleanEmail_(s.Email) === email; })[0] || null;
}

/**
 * The owner types a student into Packages/Payments by email or by name.
 * Email wins; a name only counts when exactly one student has it.
 */
function resolveStudentId_(book, ref) {
  const r = str_(ref).toLowerCase();
  if (!r) return '';
  const students = book.students || [];
  const byEmail = students.filter(function (s) { return cleanEmail_(s.Email) === r; });
  if (byEmail.length) return str_(byEmail[0].StudentID);
  const byName = students.filter(function (s) { return str_(s.Name).toLowerCase() === r; });
  return byName.length === 1 ? str_(byName[0].StudentID) : '';
}

/** Check-ins that count: not voided, and not an unscheduled one still waiting for the owner. */
function liveLog_(book) {
  return (book.log || []).filter(function (l) {
    const st = str_(l.Status).toLowerCase();
    return st !== 'void' && st !== UNSCHEDULED && dayStr_(l.ClassDate);
  });
}

// A student who came for a class that isn't on the schedule. It costs nothing and counts as no
// visit until the owner fills in Class and sets Status to ok (or void).
const UNSCHEDULED = 'unscheduled';
function unscheduledLog_(book) {
  return (book.log || []).filter(function (l) { return str_(l.Status).toLowerCase() === UNSCHEDULED; });
}

// --------------------------------- classes ---------------------------------

/**
 * Today's classes that can still be checked in to at `now` ({date, minutes}),
 * earliest first, as {klass, open}. A class is `open` from opensMinutesBefore
 * its start until lateMinutesAfterEnd after it ends, so someone who forgot can
 * check in on the way out. Later classes today aren't open yet but can be
 * picked early, so a student staying for a series checks in to all of it at once.
 */
function todaysClasses_(classes, now, cfg) {
  return classes.filter(function (c) {
    return classIsOn_(c, now.date) && now.minutes <= c.start + c.minutes + cfg.lateMinutesAfterEnd;
  }).sort(function (a, b) { return a.start - b.start; }).map(function (c) {
    return { klass: c, open: now.minutes >= c.start - cfg.opensMinutesBefore };
  });
}

/** The next class whose check-in has not opened yet, within a week. */
function nextClass_(classes, now, cfg) {
  for (let i = 0; i <= 7; i++) {
    const day = addDays_(now.date, i);
    const on = classes.filter(function (c) {
      return classIsOn_(c, day) && (i > 0 || c.start - cfg.opensMinutesBefore > now.minutes);
    }).sort(function (a, b) { return a.start - b.start; });
    if (on.length) return { klass: on[0], day: day };
  }
  return null;
}

function classView_(c, day) {
  return { id: c.id, name: c.name, time: fmtTime_(c.start), day: day, dayLabel: fmtDay_(day) };
}

// --------------------------------- money -----------------------------------

/**
 * Everything a student owes and holds, derived from the rows every time —
 * never stored — so a package typed in late, a voided check-in or a corrected
 * price fixes every figure at once.
 *
 * A check-in on a day the student has a monthly plan (Plans: Start to End,
 * End blank = ongoing) is covered by the plan. How many classes a week the
 * plan allows isn't enforced yet, and the monthly fee isn't tracked here:
 * the owner bills plans in Venmo. Otherwise each check-in uses one credit
 * from the package that runs out soonest among those valid on the class
 * date; with none, it is a drop-in at the price
 * written into the Log row when they checked in (a later price change does
 * not rewrite history). Payments for drop-ins come off the total.
 */
function ledgerFor_(book, cfg, studentId, today) {
  const prices = {};
  classesFrom_(book, cfg).forEach(function (c) { prices[c.id] = c.price; });

  const packages = (book.packages || []).filter(function (p) {
    return resolveStudentId_(book, p.Student) === studentId && num_(p.Classes, 0) > 0;
  }).map(function (p) {
    return {
      id: str_(p.PackageID), left: num_(p.Classes, 0),
      purchased: dayStr_(p.Purchased), expires: dayStr_(p.Expires),
    };
  });

  const plans = (book.plans || []).filter(function (p) {
    return resolveStudentId_(book, p.Student) === studentId;
  }).map(function (p) {
    return { label: str_(p.Plan) || 'Monthly plan', start: dayStr_(p.Start), end: dayStr_(p.End) };
  });
  const planOn = function (day) {
    return plans.filter(function (p) { return (!p.start || p.start <= day) && (!p.end || p.end >= day); })[0] || null;
  };

  const checkins = liveLog_(book).filter(function (l) { return str_(l.StudentID) === studentId; })
    .sort(function (a, b) {
      return dayStr_(a.ClassDate) < dayStr_(b.ClassDate) ? -1 : dayStr_(a.ClassDate) > dayStr_(b.ClassDate) ? 1 :
        str_(a.When) < str_(b.When) ? -1 : str_(a.When) > str_(b.When) ? 1 : 0;
    });

  let charges = 0;
  const items = checkins.map(function (l) {
    const day = dayStr_(l.ClassDate);
    const price = str_(l.Price) !== '' ? num_(l.Price, cfg.dropInPrice) :
      (str_(l.ClassID) in prices ? prices[str_(l.ClassID)] : cfg.dropInPrice);
    const item = { id: str_(l.CheckinID), day: day, className: str_(l.Class), covered: 'free', price: 0, packageId: '' };
    if (price <= 0) return item;
    const plan = planOn(day);
    if (plan) {
      item.covered = 'plan';
      return item;
    }
    const pkg = packages.filter(function (p) {
      return p.left > 0 && (!p.purchased || p.purchased <= day) && (!p.expires || p.expires >= day);
    }).sort(function (a, b) {
      return (a.expires || '9999') < (b.expires || '9999') ? -1 : (a.expires || '9999') > (b.expires || '9999') ? 1 :
        a.purchased < b.purchased ? -1 : a.purchased > b.purchased ? 1 : 0;
    })[0];
    if (pkg) {
      pkg.left--;
      item.covered = 'package';
      item.packageId = pkg.id;
    } else {
      item.covered = 'dropin';
      item.price = price;
      charges = round2_(charges + price);
    }
    return item;
  });

  let paid = 0, pending = 0;
  (book.payments || []).forEach(function (p) {
    if (resolveStudentId_(book, p.Student) !== studentId) return;
    const status = str_(p.Status).toLowerCase();
    if (status === 'rejected' || status === 'void' || str_(p.For).toLowerCase() === 'package') return;
    const amt = num_(p.Amount, 0);
    paid = round2_(paid + amt);
    if (status === 'declared') pending = round2_(pending + amt);
  });

  const valid = packages.filter(function (p) { return p.left > 0 && (!p.expires || p.expires >= today); });
  const expiries = valid.map(function (p) { return p.expires; }).filter(Boolean).sort();
  return {
    items: items,
    creditsLeft: valid.reduce(function (n, p) { return n + p.left; }, 0),
    hasPackage: packages.length > 0,
    nextExpiry: expiries[0] || '',
    plan: planOn(today) ? planOn(today).label : '',
    owed: round2_(charges - paid),   // negative = credit on account
    pending: pending,                 // declared by the student, not yet confirmed by the owner
  };
}

/**
 * A Venmo link that opens the app with the payment filled in.
 * Format to re-check on real phones before each release: Venmo has changed it before.
 */
function venmoPayUrl_(handle, amount, note) {
  return 'https://venmo.com/' + encodeURIComponent(handle) + '?txn=pay&amount=' + amount.toFixed(2) +
    '&note=' + encodeURIComponent(note);
}

function venmoChargeUrl_(handle, amount, note) {
  return 'https://venmo.com/?txn=charge&recipients=' + encodeURIComponent(handle.replace(/^@/, '')) +
    '&amount=' + amount.toFixed(2) + '&note=' + encodeURIComponent(note);
}

/** The student's account, with `these` summing up how the given check-ins were covered. */
function accountView_(book, cfg, student, today, checkinIds) {
  const ids = [].concat(checkinIds || []).map(str_);
  const led = ledgerFor_(book, cfg, str_(student.StudentID), today);
  const mine = led.items.filter(function (i) { return ids.indexOf(i.id) >= 0; });
  const count = function (k) { return mine.filter(function (i) { return i.covered === k; }).length; };
  const dropins = mine.filter(function (i) { return i.covered === 'dropin'; });
  const dropinTotal = round2_(dropins.reduce(function (n, i) { return n + i.price; }, 0));
  let pay = null;
  if (led.owed > 0 && cfg.venmoHandle) {
    const what = dropins.length && led.owed === dropinTotal
      ? dropins.map(function (i) { return i.className; }).join(' + ') + ' ' + fmtDay_(dropins[0].day) : 'class drop-ins';
    pay = {
      amount: led.owed,
      label: money_(led.owed),
      url: venmoPayUrl_(cfg.venmoHandle, led.owed, cfg.studioName + ': ' + what + ' (' + str_(student.Name) + ')'),
    };
  }
  return {
    creditsLeft: led.creditsLeft,
    hasPackage: led.hasPackage,
    plan: led.plan,
    nextExpiry: led.nextExpiry ? fmtDay_(led.nextExpiry) : '',
    expiresSoon: !!led.nextExpiry && led.nextExpiry <= addDays_(today, 14),
    owed: led.owed,
    owedLabel: money_(Math.abs(led.owed)),
    pending: led.pending,
    these: mine.length ? {
      plan: count('plan'), package: count('package'), free: count('free'), dropin: dropins.length,
      dropinTotal: dropinTotal, dropinLabel: money_(dropinTotal),
    } : null,
    pay: pay,
  };
}

// -------------------------------- requests ---------------------------------

/**
 * The check-in code's source. A static sticker/QR sends t=static; the
 * rotating totem will send a time step and signature, verified here then.
 * Until that exists, anything else is recorded but marked unverified.
 */
function codeSource_(code) {
  const t = str_(code && code.t);
  if (!t) return 'direct';
  if (t === 'static') return 'static';
  return 'unverified';
}

function studentView_(s) {
  return { id: str_(s.StudentID), name: str_(s.Name), email: cleanEmail_(s.Email) };
}

/**
 * The single entry point for the web API. `now` is {date, minutes, stamp}
 * in studio time; `io` persists rows ({newId(prefix), append(tab, row)}).
 * Rows are also pushed into `book` so the answer reflects the write.
 */
function handleRequest_(book, req, now, io) {
  const cfg = configFrom_(book.config);
  const action = str_(req && req.action);
  if (action === 'ping') return { ok: true, studio: cfg.studioName, version: APP_VERSION };
  if (action === 'checkin') return checkin_(book, cfg, req, now, io);
  if (action === 'declarePayment') return declarePayment_(book, cfg, req, now, io);
  return { ok: false, error: 'Unknown request.' };
}

function checkin_(book, cfg, req, now, io) {
  const email = cleanEmail_(req.email);
  const name = str_(req.name).replace(/\s+/g, ' ').slice(0, 80);
  if (!validEmail_(email)) return { ok: false, status: 'needDetails', error: 'Please enter a valid email.' };

  // A returning student only needs their email; the name is asked for the first time only.
  let student = findStudentByEmail_(book, email);
  let isNew = false;
  if (!student) {
    if (!name) return { ok: false, status: 'needDetails', needName: true, error: 'Please enter your name.' };
    student = { StudentID: io.newId('S'), Name: name, Email: email, FirstSeen: now.stamp };
    book.students.push(student);
    io.append('Students', student);
    isNew = true;
  }

  // The chat link is only ever sent to someone who has checked in, never put in the page itself.
  const chatLink = /^https:\/\/\S+$/.test(cfg.chatLink) ? cfg.chatLink : '';
  const base = { ok: true, studio: cfg.studioName, student: studentView_(student), isNew: isNew, chatLink: chatLink };
  const classes = classesFrom_(book, cfg);
  const avail = todaysClasses_(classes, now, cfg);
  const sid = str_(student.StudentID);

  // "I'm here for a class anyway": recorded for the owner to sort out, charged nothing. One per
  // student per day (a retry or second tap returns the same row), like a repeat check-in.
  if (req.unscheduled) {
    const note = str_(req.note).replace(/\s+/g, ' ').slice(0, 200);
    const mine = unscheduledLog_(book).filter(function (l) {
      return str_(l.StudentID) === sid && dayStr_(l.ClassDate) === now.date;
    })[0];
    if (mine) return Object.assign(base, { status: 'unscheduled', checkinId: str_(mine.CheckinID), already: true });
    const row = {
      CheckinID: io.newId('C'), When: now.stamp, ClassDate: now.date,
      StudentID: sid, Student: str_(student.Name), ClassID: '', Class: '',
      Price: '', Source: codeSource_(req.code), Status: UNSCHEDULED, Note: note,
    };
    book.log.push(row);
    io.append('Log', row);
    return Object.assign(base, { status: 'unscheduled', checkinId: row.CheckinID, already: false });
  }
  const doneRow = function (c) {
    return liveLog_(book).filter(function (l) {
      return str_(l.StudentID) === sid && dayStr_(l.ClassDate) === now.date && str_(l.ClassID) === c.id;
    })[0] || null;
  };
  const option = function (a) {
    return Object.assign(classView_(a.klass, now.date), { open: a.open, done: !!doneRow(a.klass) });
  };

  // Which classes: the ones the student picked, or the one open class not yet checked in to.
  const ids = [].concat(req.classIds || [], req.classId || []).map(str_).filter(Boolean);
  let picked = [];
  if (ids.length) {
    for (let i = 0; i < ids.length; i++) {
      const a = avail.filter(function (x) { return x.klass.id === ids[i]; })[0];
      if (!a) return { ok: false, status: 'closed', error: "That class can't be checked in to right now." };
      if (picked.indexOf(a) < 0) picked.push(a);
    }
  } else {
    const open = avail.filter(function (a) { return a.open; });
    if (!open.length) {
      const next = nextClass_(classes, now, cfg);
      return Object.assign(base, {
        status: 'noClass', next: next ? classView_(next.klass, next.day) : null,
        later: avail.filter(function (a) { return !doneRow(a.klass); }).map(option),
      });
    }
    const remaining = open.filter(function (a) { return !doneRow(a.klass); });
    if (remaining.length > 1) return Object.assign(base, { status: 'choose', options: avail.map(option) });
    picked = [remaining[0] || open[open.length - 1]];
  }

  const results = picked.map(function (a) {
    const c = a.klass;
    const existing = doneRow(c);
    if (existing) return Object.assign(classView_(c, now.date), { checkinId: str_(existing.CheckinID), already: true });
    const row = {
      CheckinID: io.newId('C'), When: now.stamp, ClassDate: now.date,
      StudentID: sid, Student: str_(student.Name), ClassID: c.id, Class: c.name,
      Price: c.price, Source: codeSource_(req.code), Status: 'ok', Note: '',
    };
    book.log.push(row);
    io.append('Log', row);
    return Object.assign(classView_(c, now.date), { checkinId: row.CheckinID, already: false });
  });
  return Object.assign(base, {
    status: results.some(function (r) { return !r.already; }) ? 'ok' : 'already',
    checkins: results,
    // Other classes today they could add, e.g. the rest of a series.
    more: avail.filter(function (a) { return picked.indexOf(a) < 0 && !doneRow(a.klass); }).map(option),
    account: accountView_(book, cfg, student, now.date, results.map(function (r) { return r.checkinId; })),
  });
}

/** The student says they sent a Venmo payment. Counts at once; the owner can confirm or reject it. */
function declarePayment_(book, cfg, req, now, io) {
  const student = findStudentByEmail_(book, cleanEmail_(req.email));
  if (!student) return { ok: false, error: "We couldn't find you — please check in first." };
  const amount = round2_(num_(req.amount, 0));
  if (!(amount > 0 && amount <= 2000)) return { ok: false, error: 'That amount looks wrong.' };
  // Recorded by name to match the owner's dropdown, unless the name is shared — then by email.
  const who = resolveStudentId_(book, student.Name) === str_(student.StudentID) ? str_(student.Name) : cleanEmail_(student.Email);
  const row = {
    PaymentID: io.newId('P'), Student: who, Amount: amount, Date: now.date,
    For: 'dropin', Status: 'declared', Method: 'venmo', Note: str_(req.note).slice(0, 200),
  };
  book.payments.push(row);
  io.append('Payments', row);
  return { ok: true, account: accountView_(book, cfg, student, now.date, [].concat(req.checkinIds || [])) };
}

// ------------------------------ owner reports ------------------------------

function studentStats_(book, cfg, today) {
  const log = liveLog_(book);
  const monthAgo = addDays_(today, -30);
  return (book.students || []).map(function (s) {
    const sid = str_(s.StudentID);
    const mine = log.filter(function (l) { return str_(l.StudentID) === sid; });
    const days = mine.map(function (l) { return dayStr_(l.ClassDate); }).sort();
    const led = ledgerFor_(book, cfg, sid, today);
    const last = days[days.length - 1] || '';
    return {
      id: sid, name: str_(s.Name), email: cleanEmail_(s.Email), venmo: str_(s.Venmo).replace(/^@/, ''),
      last: last,
      visits30: days.filter(function (d) { return d >= monthAgo; }).length,
      visits: days.length,
      creditsLeft: led.creditsLeft, hasPackage: led.hasPackage, nextExpiry: led.nextExpiry, plan: led.plan,
      owed: led.owed, pending: led.pending,
      lapsed: days.length >= 3 && !!last && last < addDays_(today, -cfg.lapsedAfterDays) && last >= addDays_(today, -120),
    };
  }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
}

function sessionsSince_(book, fromDay) {
  const map = {};
  liveLog_(book).forEach(function (l) {
    const day = dayStr_(l.ClassDate);
    if (day < fromDay) return;
    const key = day + '|' + str_(l.ClassID) + '|' + str_(l.Class); // owner-fixed unscheduled rows may have no ClassID
    if (!map[key]) map[key] = { day: day, name: str_(l.Class), who: [] };
    map[key].who.push(str_(l.Student));
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : a.name < b.name ? -1 : 1; });
}

/** Unscheduled check-ins still waiting for the owner, newest first. */
function reviewItems_(book) {
  return unscheduledLog_(book).filter(function (l) { return dayStr_(l.ClassDate); }).map(function (l) {
    return { day: dayStr_(l.ClassDate), name: str_(l.Student), note: str_(l.Note), id: str_(l.CheckinID) };
  }).sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : 0; });
}

/** The Dashboard tab as a 2-D array (ragged; Code.gs pads it). */
function dashboardRows_(book, now) {
  const cfg = configFrom_(book.config);
  const stats = studentStats_(book, cfg, now.date);
  const rows = [
    ['Dashboard — rebuilt ' + now.stamp + '. Edits here are overwritten; change the other tabs instead.'],
    [],
    ['Student', 'Email', 'Last visit', 'Visits (30 days)', 'Visits (all)', 'Plan', 'Credits left', 'Owes', 'Flag'],
  ];
  stats.forEach(function (s) {
    const flags = [];
    if (s.owed > 0) flags.push('owes ' + money_(s.owed) + (s.pending ? ' (' + money_(s.pending) + ' unconfirmed)' : ''));
    if (s.hasPackage && !s.plan && s.creditsLeft <= 1) flags.push(s.creditsLeft ? '1 credit left' : 'package used up');
    if (s.lapsed) flags.push('lapsed');
    rows.push([s.name, s.email, s.last ? fmtDay_(s.last) : '', s.visits30, s.visits, s.plan,
      s.hasPackage ? s.creditsLeft : '', s.owed > 0 ? s.owed : '', flags.join('; ')]);
  });
  const review = reviewItems_(book);
  if (review.length) {
    rows.push([], ['To review: came for a class that wasn\'t on the schedule. In Log, fill in Class and set Status to ok (or void).'],
      ['Day', 'Student', 'Their note', 'CheckinID']);
    review.forEach(function (r) { rows.push([fmtDay_(r.day), r.name, r.note, r.id]); });
  }
  rows.push([], ['Last 14 days', 'Class', 'Count', 'Who']);
  sessionsSince_(book, addDays_(now.date, -13)).forEach(function (x) {
    rows.push([fmtDay_(x.day), x.name, x.who.length, x.who.join(', ')]);
  });
  return rows;
}

/** What the owner's weekly email says. */
function weeklySummary_(book, now) {
  const cfg = configFrom_(book.config);
  const stats = studentStats_(book, cfg, now.date);
  const sessions = sessionsSince_(book, addDays_(now.date, -7));
  return {
    studio: cfg.studioName,
    sessions: sessions.map(function (x) { return { day: fmtDay_(x.day), name: x.name, count: x.who.length, who: x.who }; }),
    visits: sessions.reduce(function (n, x) { return n + x.who.length; }, 0),
    owes: stats.filter(function (s) { return s.owed > 0; }).map(function (s) {
      return {
        name: s.name, amount: s.owed, label: money_(s.owed), pending: s.pending,
        requestUrl: s.venmo ? venmoChargeUrl_(s.venmo, s.owed, cfg.studioName + ' classes') : '',
      };
    }),
    lowCredits: stats.filter(function (s) { return s.hasPackage && !s.plan && s.creditsLeft <= 1; })
      .map(function (s) { return { name: s.name, creditsLeft: s.creditsLeft }; }),
    lapsed: stats.filter(function (s) { return s.lapsed; })
      .map(function (s) { return { name: s.name, last: fmtDay_(s.last) }; }),
    review: reviewItems_(book).map(function (r) { return { name: r.name, day: fmtDay_(r.day), note: r.note }; }),
    newStudents: (book.students || []).filter(function (s) { return dayStr_(s.FirstSeen) >= addDays_(now.date, -7); })
      .map(function (s) { return str_(s.Name); }),
  };
}
