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
  Students: ['StudentID', 'Name', 'Email', 'Phone', 'Venmo', 'FirstSeen', 'Notes', 'Chat', 'Passkey'],
  // By: who checked them in when it wasn't the student (an owner page link's name, or the Sheet
  // menu user's email). Blank = the student did it themselves.
  Log: ['CheckinID', 'When', 'ClassDate', 'StudentID', 'Student', 'ClassID', 'Class', 'Price', 'Source', 'Status', 'Note', 'By'],
  Packages: ['PackageID', 'Student', 'Classes', 'Purchased', 'Expires', 'Amount', 'Note'],
  Plans: ['PlanID', 'Student', 'Plan', 'Start', 'End', 'Note'],
  Payments: ['PaymentID', 'Student', 'Amount', 'Date', 'For', 'Status', 'Method', 'Note', 'Covers'],
  Tags: ['Code', 'Name', 'Active', 'Notes', 'Scenario'],
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
  wixPacks: 'Single Class = 1',
  chatLink: '',
  pageUrl: '',
  testScenarios: 'no',
};

const CONFIG_NOTES = {
  studioName: 'Shown on the check-in page and in emails.',
  venmoHandle: "The studio's Venmo username, without the @.",
  dropInPrice: 'Default price of one class. A class can override it in Schedule → Price (0 = free).',
  opensMinutesBefore: 'Check-in opens this many minutes before a class starts.',
  lateMinutesAfterEnd: 'Check-in stays open this many minutes after a class ends, for anyone who forgot on the way in.',
  ownerEmail: 'Where the weekly summary goes. Blank = the account that owns this sheet.',
  lapsedAfterDays: 'A regular who has not been in for this many days shows as lapsed.',
  chatLink: "Invite link to the studio's group chat (e.g. a Telegram invite link). Students see a Join button after checking in, until they join or hide it (Students → Chat). Blank = no button. After changing the link, clear the Chat column to show it to everyone again.",
  testScenarios: 'Your dev copy only: yes lets the test links from "Make test links for testers" pretend classes are on. Leave it no in the studio\'s copy.',
  pageUrl: 'The check-in page\'s address (e.g. https://checkin.yourstudio.com/). Used to show the full address for a new sign\'s NFC tag and QR code.',
  wixPacks: 'Wix pricing plans that are class passes, with how many classes each, e.g. "Single Class = 1, 10 Class Pass = 10". A purchase becomes credits, like a Packages row. Any other Wix plan counts like a Plans row (covers every class while it runs).',
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
function validEmail_(v) { return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

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
  const skip = wixSkipWords_(cfg);
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

/** Header of the "Wix purchases" tab the Wix sync writes. */
const WIX_PURCHASE_HEADERS = ['OrderID', 'Student', 'Plan', 'Kind', 'Classes', 'Start', 'End', 'Status', 'Amount', 'CheckedInAs', 'WixMember'];

/** 'Single Class = 1, 10 Class Pass = 10' → [{name: 'single class', classes: 1}, …] */
function wixPacks_(cfg) {
  return str_(cfg.wixPacks).split(',').map(function (part) {
    const m = part.match(/^\s*(.*?)\s*=\s*(\d+)\s*$/);
    return m && m[1] ? { name: m[1].toLowerCase(), classes: +m[2] } : null;
  }).filter(Boolean);
}

function wixSkipWords_(cfg) {
  return str_(cfg.wixSkip).toLowerCase() === 'none' ? [] :
    str_(cfg.wixSkip).toLowerCase().split(',').map(function (w) { return w.trim(); }).filter(String);
}

/**
 * Wix Pricing Plans orders → rows for the "Wix purchases" tab. Check-in reads
 * them like the owner's Packages and Plans rows (see allPackages_ / allPlans_).
 *   orders: [{ id, planName, status, payment, start: 'yyyy-MM-dd', end, memberId, amount }]
 *           (dates already in the studio's time zone; end '' = runs until cancelled)
 *   emails: { <memberId>: login email }  (missing = not looked up; the row matches nobody)
 * A plan named in wixPacks is a class pass: that many credits, valid Start → End.
 * Any other plan covers every class from Start to End, like a monthly plan.
 * Unfinished checkouts, refunded or failed payments, and plans matching
 * wixSkip (e.g. Kids) are left out.
 */
function wixPurchaseRows_(orders, emails, cfg, book) {
  const packs = wixPacks_(cfg);
  const skip = wixSkipWords_(cfg);
  const rows = [];
  (orders || []).forEach(function (o) {
    const status = str_(o.status).toUpperCase();
    if (['ACTIVE', 'ENDED', 'CANCELED', 'PAUSED'].indexOf(status) < 0) return; // DRAFT/PENDING = never bought
    if (['REFUNDED', 'FAILED'].indexOf(str_(o.payment).toUpperCase()) >= 0) return;
    const plan = str_(o.planName);
    const lower = plan.toLowerCase();
    if (!plan || !dayStr_(o.start) || skip.some(function (w) { return lower.indexOf(w) >= 0; })) return;
    const pack = packs.filter(function (p) { return lower.indexOf(p.name) >= 0; })[0];
    const email = cleanEmail_((emails || {})[str_(o.memberId)]);
    const student = email ? findStudentByEmail_(book || {}, email) : null;
    rows.push({
      OrderID: str_(o.id), Student: email, Plan: plan,
      Kind: pack ? 'package' : 'plan', Classes: pack ? pack.classes : '',
      Start: dayStr_(o.start), End: dayStr_(o.end), Status: status.toLowerCase(),
      Amount: str_(o.amount) === '' ? '' : num_(o.amount, ''),
      CheckedInAs: student ? str_(student.Name) : '', WixMember: str_(o.memberId),
    });
  });
  return rows.sort(function (a, b) { return a.Start < b.Start ? 1 : a.Start > b.Start ? -1 : 0; });
}

/** The owner's Packages rows plus class passes bought on Wix. */
function allPackages_(book) {
  return (book.packages || []).concat((book.wixPurchases || []).filter(function (r) {
    return str_(r.Kind) === 'package';
  }).map(function (r) {
    return { PackageID: r.OrderID, Student: r.Student, Classes: r.Classes, Purchased: r.Start, Expires: r.End, Amount: r.Amount, Note: 'Wix' };
  }));
}

/** The owner's Plans rows plus plans bought on Wix. */
function allPlans_(book) {
  return (book.plans || []).concat((book.wixPurchases || []).filter(function (r) {
    return str_(r.Kind) === 'plan';
  }).map(function (r) {
    return { PlanID: r.OrderID, Student: r.Student, Plan: r.Plan, Start: r.Start, End: r.End, Note: 'Wix' };
  }));
}

/** The ClassID of a Log row, by CheckinID. */
function classIdOf_(book, checkinId) {
  const l = (book.log || []).filter(function (x) { return str_(x.CheckinID) === checkinId; })[0];
  return l ? str_(l.ClassID) : '';
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
  const starts = {};
  classesFrom_(book, cfg).forEach(function (c) { prices[c.id] = c.price; starts[c.id] = c.start; });
  // A class's start time, for telling two sessions of one class apart. Wix ClassIDs end in HHMM,
  // so the time is known even once the session has dropped off the synced schedule.
  const startOf = function (id) {
    if (id in starts) return starts[id];
    const m = id.match(/-(\d{2})(\d{2})$/);
    return m && id.charAt(0) === 'W' ? (+m[1]) * 60 + (+m[2]) : null;
  };

  const packages = allPackages_(book).filter(function (p) {
    return resolveStudentId_(book, p.Student) === studentId && num_(p.Classes, 0) > 0;
  }).map(function (p) {
    return {
      id: str_(p.PackageID), left: num_(p.Classes, 0),
      purchased: dayStr_(p.Purchased), expires: dayStr_(p.Expires),
    };
  });

  const plans = allPlans_(book).filter(function (p) {
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
    const item = { id: str_(l.CheckinID), day: day, className: str_(l.Class), start: startOf(str_(l.ClassID)), covered: 'free', price: 0, packageId: '' };
    if (price <= 0) return item;
    // The "regular on a monthly plan" test link (dev only) is covered as if by a plan.
    const plan = str_(l.ClassID).indexOf('T-regular-') === 0 ? { label: TEST_PLAN_LABEL } : planOn(day);
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

  // What's still unpaid, per drop-in. A payment made from the check-in page names the check-ins
  // it was for (Payments → Covers), and pays those first; anything else (the owner's typed-in
  // payments, or money left over) pays off the oldest unpaid drop-ins.
  const left = {};
  items.forEach(function (i) { if (i.covered === 'dropin') left[i.id] = i.price; });
  let paid = 0, pending = 0, pool = 0;
  (book.payments || []).forEach(function (p) {
    if (resolveStudentId_(book, p.Student) !== studentId) return;
    const status = str_(p.Status).toLowerCase();
    if (status === 'rejected' || status === 'void' || str_(p.For).toLowerCase() === 'package') return;
    let amt = num_(p.Amount, 0);
    paid = round2_(paid + amt);
    if (status === 'declared') pending = round2_(pending + amt);
    str_(p.Covers).split(/[\s,]+/).filter(Boolean).forEach(function (id) {
      if (!(id in left) || amt <= 0) return;
      const take = Math.min(left[id], amt);
      left[id] = round2_(left[id] - take);
      amt = round2_(amt - take);
    });
    pool = round2_(pool + amt);
  });
  const unpaid = [];
  items.forEach(function (i) {
    if (!(i.id in left)) return;
    const take = Math.min(left[i.id], pool);
    left[i.id] = round2_(left[i.id] - take);
    pool = round2_(pool - take);
    if (left[i.id] > 0) unpaid.push({ id: i.id, day: i.day, className: i.className, start: i.start, amount: left[i.id] });
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
    unpaid: unpaid,                   // the drop-ins making up `owed`, oldest first
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
  // The page only ever asks for the classes just checked in to. Older unpaid classes are the
  // owner's to follow up (Dashboard, Monday email): an old "debt" may simply be a cash payment
  // not typed in yet, and a check-in is the wrong moment to surprise someone with it.
  const unpaid = led.unpaid.filter(function (u) { return ids.indexOf(u.id) >= 0; });
  const due = round2_(unpaid.reduce(function (n, u) { return n + u.amount; }, 0));
  let pay = null;
  if (due > 0 && cfg.venmoHandle) {
    // The Venmo note names what's being paid for: "Salsa 1 + Bachata 2 Mon Nov 2".
    const byDay = [];
    unpaid.forEach(function (u) {
      const d = byDay.filter(function (x) { return x.day === u.day; })[0];
      if (d) d.names.push(u.className); else byDay.push({ day: u.day, names: [u.className] });
    });
    const what = byDay.map(function (d) { return d.names.join(' + ') + ' ' + fmtDay_(d.day); }).join('; ');
    pay = {
      amount: due,
      label: money_(due),
      url: venmoPayUrl_(cfg.venmoHandle, due, cfg.studioName + ': ' + what + ' (' + str_(student.Name) + ')'),
    };
  }
  return {
    creditsLeft: led.creditsLeft,
    hasPackage: led.hasPackage,
    // (The "regular" test link has no Plans row, so it names its pretend plan here.)
    plan: led.plan || (mine.some(function (i) { return /^T-regular-/.test(classIdOf_(book, i.id)); }) ? TEST_PLAN_LABEL : ''),
    nextExpiry: led.nextExpiry ? fmtDay_(led.nextExpiry) : '',
    expiresSoon: !!led.nextExpiry && led.nextExpiry <= addDays_(today, 14),
    owed: led.owed,                    // the whole balance: for the owner's menu, not shown on the page
    owedLabel: money_(Math.abs(led.owed)),
    due: due,                          // what the page asks for: the unpaid part of these check-ins
    dueLabel: money_(due),
    pending: led.pending,
    // How each of these check-ins is covered, so the page can say which class costs what.
    items: mine.map(function (i) { return { id: i.id, covered: i.covered, price: i.price, priceLabel: money_(i.price) }; }),
    these: mine.length ? {
      plan: count('plan'), package: count('package'), free: count('free'), dropin: dropins.length,
      dropinTotal: dropinTotal, dropinLabel: money_(dropinTotal),
    } : null,
    pay: pay,
  };
}

// -------------------------------- requests ---------------------------------

/**
 * Active rows of the Tags tab: one per sign, sticker or totem, each with its own code.
 * A row with a Scenario is a test link (see TEST_SCENARIOS); those only count when Config
 * testScenarios is yes, so they can never act in the studio's copy.
 */
function tagsFrom_(book) {
  const testing = /^(y|yes|true|on|1)$/i.test(configFrom_(book.config).testScenarios);
  return (book.tags || []).filter(function (t) {
    return str_(t.Code) && !isNo_(t.Active) && (!str_(t.Scenario) || testing);
  }).map(function (t) {
    return { code: str_(t.Code), name: str_(t.Name) || str_(t.Code), scenario: str_(t.Scenario).toLowerCase() };
  });
}

// --------------------------- test links (dev only) ---------------------------

/**
 * Scenarios a tester can try at any time of day, one link each. The dev API
 * pretends the scenario's classes are on, placed around the moment of the tap
 * (as the preview does); everything else is the real page and the real Sheet.
 * Their check-ins have ClassIDs starting "T-" and class names ending "(test)".
 */
const TEST_PLAN_LABEL = 'Adult Monthly (test)';
const TEST_SCENARIOS = [
  { id: 'regular', label: 'A regular on a monthly plan (the usual)', try: 'Check in. It should say your monthly plan covers it: nothing to pay.' },
  { id: 'one', label: 'A class is about to start', try: 'Check in. You should be checked straight in, with what you owe for a drop-in.' },
  { id: 'two', label: 'Two classes at the same time', try: 'Pick one or both classes.' },
  { id: 'series', label: 'Staying for two classes in a row (Dance 101, then Hip Hop)', try: 'Check in to Dance 101, then add Hip Hop from "Taking another class today?". Both are drop-ins, so you owe for two.' },
  { id: 'early', label: "You're early (class in 2 hours)", try: 'You can check in now, or not yet.' },
  { id: 'late', label: 'You forgot: class ended 40 minutes ago', try: 'You should still be checked in.' },
  { id: 'free', label: 'A class with nothing extra to pay (a Company practice)', try: 'Check in. Nothing to pay.' },
  { id: 'none', label: 'No class today', try: 'Try "Here for a class that isn\'t listed?" with a short note.' },
  { id: 'reset', label: 'Start over', try: 'Clears your test check-ins (only yours) and makes this phone forget you.' },
];

/** The pretend classes for a scenario, around `now`, shaped like classFrom_() makes them. */
function testClasses_(scenario, now, cfg) {
  const base = Math.ceil(now.minutes / 5) * 5;
  // The studio's own classes (as in Wix), so testers see names they know.
  const mk = function (n, name, start, minutes, price, day) {
    day = day || now.date;
    return {
      id: 'T-' + scenario + '-' + n, name: name + ' (test)', days: [dowOf_(day)],
      start: start, minutes: minutes, price: price == null ? cfg.dropInPrice : price,
      active: true, first: day, last: day,
    };
  };
  switch (scenario) {
    case 'regular': return [mk(1, 'Adult Hip Hop', base + 10, 75)];
    case 'one': return [mk(1, 'Dance 101', base + 10, 60)];
    case 'two': return [mk(1, 'Company Practice', base + 10, 60, 0), mk(2, 'Dance 101', base + 20, 60)];
    case 'series': return [mk(1, 'Dance 101', base + 10, 60), mk(2, 'Adult Hip Hop', base + 70, 75)];
    case 'early': return [mk(1, 'Adult Hip Hop', base + 120, 75)];
    case 'late': return [mk(1, 'Dance 101', base - 100, 60)];
    case 'free': return [mk(1, 'Company Practice', base + 5, 60, 0)];
    case 'none': return [mk(1, 'Adult Hip Hop', 19 * 60 + 15, 75, null, addDays_(now.date, 1))];
    default: return [];
  }
}

/**
 * The clock a test link runs on. The scenarios need from 100 minutes before the tap ("late")
 * to 120 after it ("early") inside the same day, so late at night it
 * stops at 8:50pm and just after midnight it waits at 2am. Only the class times shown move;
 * the check-in is still recorded at the real time (now.stamp) on the real day.
 */
function testClock_(now) {
  return Object.assign({}, now, { minutes: Math.max(120, Math.min(now.minutes, 20 * 60 + 50)) });
}

/**
 * "Start over" for one tester: voids their test check-ins (never real ones,
 * never anyone else's) and the payments they declared today, so what they owe
 * resets too. Soft, like every delete here: Status = void.
 */
function resetTester_(book, student, now, io) {
  const sid = str_(student.StudentID);
  const testSources = {};
  (book.tags || []).forEach(function (t) { if (str_(t.Scenario)) testSources[str_(t.Name) || str_(t.Code)] = true; });
  let cleared = 0;
  (book.log || []).forEach(function (l) {
    const isTest = str_(l.ClassID).indexOf('T-') === 0 || testSources[str_(l.Source)];
    if (str_(l.StudentID) !== sid || !isTest || str_(l.Status).toLowerCase() === 'void') return;
    l.Status = 'void';
    io.update('Log', l, { Status: 'void' });
    cleared++;
  });
  (book.payments || []).forEach(function (p) {
    if (resolveStudentId_(book, p.Student) !== sid || str_(p.Status).toLowerCase() !== 'declared' || dayStr_(p.Date) !== now.date) return;
    p.Status = 'void';
    io.update('Payments', p, { Status: 'void' });
  });
  // …and the group chat card and the passkey offer start over for them too.
  ['Chat', 'Passkey'].forEach(function (h) {
    if (!str_(student[h])) return;
    student[h] = '';
    const f = {}; f[h] = '';
    io.update('Students', student, f);
  });
  return cleared;
}

/**
 * Opening a test link starts its situation fresh: this tester's earlier check-ins on
 * this same link (its pretend classes, or its "here for a class" row) are voided, and so
 * are payments they declared for those check-ins. Never real rows, never anyone else's,
 * never other links. Only the opening request does this, not picking a class afterwards.
 */
function freshTestLink_(book, student, scenario, source, io) {
  const sid = str_(student.StudentID);
  const prefix = 'T-' + scenario + '-';
  const gone = {};
  (book.log || []).forEach(function (l) {
    if (str_(l.StudentID) !== sid || str_(l.Status).toLowerCase() === 'void') return;
    const mine = str_(l.ClassID).indexOf(prefix) === 0 ||
      (str_(l.Status).toLowerCase() === UNSCHEDULED && str_(l.Source) === source);
    if (!mine) return;
    gone[str_(l.CheckinID)] = true;
    l.Status = 'void';
    io.update('Log', l, { Status: 'void' });
  });
  (book.payments || []).forEach(function (p) {
    const covers = str_(p.Covers).split(/\s+/).filter(Boolean);
    if (str_(p.Status).toLowerCase() !== 'declared' || !covers.length) return;
    if (!covers.every(function (id) { return gone[id]; })) return;
    p.Status = 'void';
    io.update('Payments', p, { Status: 'void' });
  });
}

// ------------------------------- group chat ---------------------------------

// The full Join card for a student's first few check-ins, then one quiet line.
const CHAT_FULL_VISITS = 3;

/**
 * How the page should show the group chat for this student: 'full', 'mini' or
 * '' (not at all). Decided here from the Students tab's Chat column and their
 * check-ins, so it follows the person, not the phone: Safari clearing the
 * phone's storage, or a new phone, changes nothing.
 */
function chatMode_(book, cfg, student) {
  if (!/^https:\/\/\S+$/.test(cfg.chatLink) || str_(student.Chat)) return '';
  const visits = liveLog_(book).filter(function (l) { return str_(l.StudentID) === str_(student.StudentID); }).length;
  return visits < CHAT_FULL_VISITS ? 'full' : 'mini'; // counted before today's check-in is written
}

/** The student tapped Join or "Hide this": recorded in Students → Chat, so the card stops showing. */
function chatChoice_(book, req, now, io) {
  const student = findStudentByEmail_(book, cleanEmail_(req.email));
  const choice = str_(req.choice) === 'hidden' ? 'hidden' : 'joined';
  if (!student) return { ok: false, error: "We couldn't find you." };
  if (!str_(student.Chat)) {
    student.Chat = choice + ' ' + now.date;
    io.update('Students', student, { Chat: student.Chat });
  }
  return { ok: true };
}

/**
 * Where a check-in came from, and whether it may go ahead. The URL on each NFC
 * tag and QR code carries ?t=<code>, a random code from the Tags tab (kept in
 * the Sheet, never in the repo). Once Tags has an active code, a check-in
 * needs one, so someone who only found the website can't check in; the Log's
 * Source says which sign was used. With no tags yet, anything goes and is
 * recorded as before (static / direct / unverified). The rotating totem will
 * send a time step and signature, to be verified here.
 */
function codeSource_(book, code) {
  const t = str_(code && code.t);
  const tags = tagsFrom_(book);
  if (tags.length) {
    const tag = tags.filter(function (x) { return x.code === t; })[0];
    return tag ? { ok: true, source: tag.name, scenario: tag.scenario } : { ok: false };
  }
  return { ok: true, source: !t ? 'direct' : t === 'static' ? 'static' : 'unverified' };
}

// Anyone can type any email into the page, so the answer carries only the first name
// (all the page shows), never the full name stored in Students.
function studentView_(s) {
  return { id: str_(s.StudentID), name: str_(s.Name).split(' ')[0], email: cleanEmail_(s.Email) };
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
  if (action === 'todayTab') return { ok: true }; // Code.gs rewrites the Today tab; nothing to decide here
  if (action === 'checkin') return checkin_(book, cfg, req, now, io, {});
  if (action === 'declarePayment') return declarePayment_(book, cfg, req, now, io);
  if (action === 'chat') return chatChoice_(book, req, now, io);
  if (action === 'passkey') return passkeySaved_(book, req, io);
  if (action === 'owner') return ownerRequest_(book, cfg, req, now, io);
  return { ok: false, error: 'Unknown request.' };
}

// -------------------------------- owner page --------------------------------
//
// web/owner.html: the studio's phone page for admins and teachers, so nobody has to edit the Sheet.
// (Still called "owner" in code and the file name, so links already handed out keep working.) Every
// request carries the key of a named link, checked before anything else; without it nothing is read
// or written. Deliberately no
// money here (payments, prices): that waits until the owner has said how she wants it.

const PLAN_CHOICES = ['Monthly, 1 class a week', 'Monthly, 2 classes a week'];
const OWNER_NOTE = 'Owner page';

/** The key from the link against the one in Script Properties. Never accepts a short or missing key. */
function ownerKeyOk_(given, real) {
  const g = str_(given), r = str_(real);
  if (r.length < 20 || g.length !== r.length) return false;
  let diff = 0;
  for (let i = 0; i < r.length; i++) diff |= r.charCodeAt(i) ^ g.charCodeAt(i);
  return diff === 0;
}

/** A real calendar day as 'yyyy-MM-dd' (so not Feb 30). */
function validDay_(v) {
  const s = str_(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Whose owner page link this is: each link has a name ({name: key} from Script Properties), so
 * the Log can say who checked someone in. '' = no link matches.
 */
function ownerWho_(given, keys) {
  let who = '';
  Object.keys(keys || {}).forEach(function (name) { if (ownerKeyOk_(given, keys[name])) who = name; });
  return who;
}

/** Adds "· removed by Rob Nov 11"-style history to a row's Note, keeping what was there. */
function noteWith_(note, text) { return str_(note) ? str_(note) + ' · ' + text : text; }

// Two kinds of link. An admin link (Script Properties → ownerKeys, made by the Sheet menu) opens
// everything. A teacher link (→ teacherKeys, made by an admin on the page's Team tab) opens only
// check-ins: Today without money, Take attendance and remove. Teachers never see emails, plans,
// passes or balances, and the server refuses everything else for them (not just hidden buttons).
const TEACHER_OPS = ['today', 'students', 'checkin', 'checkinMany', 'undo'];

/** Whose link this is and what it may do: {name, role: 'admin'|'teacher'}, or null. */
function staffWho_(given, admins, teachers) {
  const a = ownerWho_(given, admins);
  if (a) return { name: a, role: 'admin' };
  const t = ownerWho_(given, teachers);
  return t ? { name: t, role: 'teacher' } : null;
}

function ownerRequest_(book, cfg, req, now, io) {
  const staff = staffWho_(req.key, adminKeys_(io), io.teacherKeys ? io.teacherKeys() : {});
  if (!staff) {
    return { ok: false, status: 'needKey', error: "This link isn't valid any more. Please ask for a new one." };
  }
  const op = str_(req.op);
  if (staff.role !== 'admin' && TEACHER_OPS.indexOf(op) < 0) {
    return { ok: false, error: 'Only an admin can do that.', role: staff.role, who: staff.name };
  }
  const res = staffOp_(book, cfg, req, now, io, staff, op);
  if (staff.role === 'teacher') teacherView_(res);
  res.role = staff.role;
  res.who = staff.name;
  return res;
}

function staffOp_(book, cfg, req, now, io, staff, op) {
  const who = staff.name;
  if (op === 'today') return ownerToday_(book, cfg, now);
  if (op === 'students') return ownerStudents_(book, cfg, now);
  if (op === 'startPlan') return ownerStartPlan_(book, cfg, req, now, io, who);
  if (op === 'endPlan') return ownerEndPlan_(book, cfg, req, now, io, who);
  if (op === 'addPass') return ownerAddPass_(book, cfg, req, now, io, who);
  if (op === 'sortOut') return ownerSortOut_(book, cfg, req, now, io, who);
  if (op === 'checkin') return ownerCheckinFromPage_(book, cfg, req, now, io, who);
  if (op === 'checkinMany') return ownerCheckinMany_(book, cfg, req, now, io, who);
  if (op === 'undo') return ownerUndo_(book, cfg, req, now, io, who);
  if (op === 'team') return team_(io);
  if (op === 'addTeacher') return addTeacher_(req, io);
  if (op === 'removeTeacher') return removeTeacher_(req, io);
  return { ok: false, error: 'Unknown request.' };
}

/** A teacher's answer: who's in, never how they paid, what they owe, their email or plans. */
function teacherView_(res) {
  const people = function (list) { (list || []).forEach(function (p) { p.how = ''; p.owes = ''; }); };
  (res.classes || []).forEach(function (c) { people(c.people); });
  (res.other || []).forEach(function (c) { people(c.people); });
  if (res.extras) res.extras = [];
  if (res.students) {
    res.students = res.students.map(function (s) { return { id: s.id, name: s.name }; });
    delete res.planChoices;
  }
  return res;
}

/** The Team tab: everyone's link by name (never the keys). */
function team_(io) {
  const names = function (keys) { return Object.keys(keys || {}).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }); };
  return { ok: true, admins: names(adminKeys_(io)), teachers: names(io.teacherKeys ? io.teacherKeys() : {}) };
}

/** Admin links, {name: key}. (A copy from before named links has one key, called "Owner".) */
function adminKeys_(io) {
  return io.ownerKeys ? io.ownerKeys() : io.ownerKey ? { Owner: io.ownerKey() } : {};
}

/** A teacher's name as typed: tidied, and starting with a letter so the Sheet never reads it as a formula. */
function staffName_(v) {
  const s = str_(v).replace(/\s+/g, ' ').trim().slice(0, 30);
  return /^[A-Za-zÀ-ɏ]/.test(s) ? s : '';
}

/**
 * Makes a teacher's link and returns its key once (the page builds the link from it). `replace`
 * gives an existing teacher a new link, so a lost phone or a link sent to the wrong person is fixed.
 */
function addTeacher_(req, io) {
  const typed = staffName_(req.name);
  if (!typed) return Object.assign(team_(io), { ok: false, error: "Please type the teacher's name." });
  const teachers = io.teacherKeys();
  const same = function (keys) { return Object.keys(keys || {}).filter(function (n) { return n.toLowerCase() === typed.toLowerCase(); })[0]; };
  if (same(adminKeys_(io))) return Object.assign(team_(io), { ok: false, error: typed + ' already has an admin link.' });
  const name = same(teachers) || typed;
  if (teachers[name] && !req.replace) return Object.assign(team_(io), { ok: false, error: "There's already a teacher called " + name + '.' });
  teachers[name] = io.newKey();
  io.saveTeacherKeys(teachers);
  return Object.assign(team_(io), { name: name, newKey: teachers[name],
    done: req.replace ? name + ' has a new link. The old one has stopped working.' : name + "'s link is ready." });
}

function removeTeacher_(req, io) {
  const teachers = io.teacherKeys();
  const name = Object.keys(teachers).filter(function (n) { return n === str_(req.name); })[0];
  if (!name) return Object.assign(team_(io), { ok: false, error: 'That link was already turned off.' });
  delete teachers[name];
  io.saveTeacherKeys(teachers);
  return Object.assign(team_(io), { done: name + "'s link is turned off." });
}

/** Today's classes with who's in and how each is covered, plus everything waiting to be sorted out. */
function ownerToday_(book, cfg, now) {
  const log = liveLog_(book).filter(function (l) { return dayStr_(l.ClassDate) === now.date; });
  const ledgers = {};
  const ledger = function (sid) { return ledgers[sid] || (ledgers[sid] = ledgerFor_(book, cfg, sid, now.date)); };
  const person = function (l) {
    const led = ledger(str_(l.StudentID));
    const item = led.items.filter(function (i) { return i.id === str_(l.CheckinID); })[0];
    return {
      name: str_(l.Student), studentId: str_(l.StudentID), checkinId: str_(l.CheckinID), by: str_(l.By),
      how: item ? COVERED_LABELS[item.covered] + (item.covered === 'dropin' ? ' ' + money_(item.price) : '') : '',
      owes: led.owed > 0 ? money_(led.owed) : '', // shown for information only
    };
  };
  // Who usually comes to each class (by name: a Wix class has a new ClassID every session), over
  // the last six weeks, most often first. The attendance checklist lists them first.
  const since = addDays_(now.date, -42);
  const usualFor = function (name) {
    const n = {};
    liveLog_(book).forEach(function (l) {
      const d = dayStr_(l.ClassDate);
      if (d >= since && d < now.date && str_(l.Class) === name) n[str_(l.StudentID)] = (n[str_(l.StudentID)] || 0) + 1;
    });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; });
  };
  const seen = {};
  const classes = allClassesToday_(book, now.date).map(function (c) {
    const mine = log.filter(function (l) { return str_(l.ClassID) === c.id; });
    mine.forEach(function (l) { seen[str_(l.CheckinID)] = true; });
    return { id: c.id, name: c.name, time: fmtTime_(c.start), people: mine.map(person), usual: usualFor(c.name) };
  });
  const other = {};
  log.filter(function (l) { return !seen[str_(l.CheckinID)]; }).forEach(function (l) {
    const k = str_(l.Class) || '(no class filled in)';
    (other[k] = other[k] || []).push(person(l));
  });
  return {
    ok: true, studio: cfg.studioName, version: APP_VERSION,
    dateLabel: fmtDay_(now.date), time: fmtTime_(now.minutes),
    classes: classes,
    other: Object.keys(other).sort().map(function (k) { return { name: k, people: other[k] }; }),
    extras: reviewItems_(book).map(function (r) {
      return {
        id: r.id, name: r.name, note: r.note, dayLabel: r.day === now.date ? 'Today' : fmtDay_(r.day),
        classes: allClassesToday_(book, r.day).map(function (c) { return { id: c.id, name: c.name, time: fmtTime_(c.start) }; }),
      };
    }),
  };
}

/** The owner's own Plans rows (not Wix ones), each with an id the page can send back. */
function ownPlans_(book) {
  return (book.plans || []).map(function (p, i) {
    return { row: p, id: str_(p.PlanID) || '#' + i, sid: resolveStudentId_(book, p.Student),
      plan: str_(p.Plan) || 'Monthly plan', start: dayStr_(p.Start), end: dayStr_(p.End) };
  });
}

function ownerStudents_(book, cfg, now) {
  const own = ownPlans_(book);
  const wix = allPlans_(book).filter(function (p) { return str_(p.Note) === 'Wix'; });
  return {
    ok: true, studio: cfg.studioName, dateLabel: fmtDay_(now.date), today: now.date,
    planChoices: PLAN_CHOICES,
    students: (book.students || []).map(function (s) {
      const sid = str_(s.StudentID);
      const led = ledgerFor_(book, cfg, sid, now.date);
      const days = liveLog_(book).filter(function (l) { return str_(l.StudentID) === sid; })
        .map(function (l) { return dayStr_(l.ClassDate); }).sort();
      return {
        id: sid, name: str_(s.Name), email: cleanEmail_(s.Email),
        plan: led.plan,
        // Plans she can end: running now or starting later.
        plans: own.filter(function (p) { return p.sid === sid && (!p.end || p.end >= now.date); }).map(function (p) {
          return { id: p.id, plan: p.plan, start: p.start, startLabel: p.start ? fmtDay_(p.start) : '', future: !!p.start && p.start > now.date };
        }),
        wixPlan: wix.some(function (p) {
          return resolveStudentId_(book, p.Student) === sid && (!dayStr_(p.End) || dayStr_(p.End) >= now.date);
        }),
        credits: led.hasPackage ? led.creditsLeft : null,
        expires: led.nextExpiry ? fmtDay_(led.nextExpiry) : '',
        last: days.length ? fmtDay_(days[days.length - 1]) : '',
      };
    }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; }),
  };
}

function studentById_(book, id) {
  return (book.students || []).filter(function (s) { return str_(s.StudentID) === str_(id); })[0] || null;
}

/**
 * Puts a student on a monthly plan from `start` (today by default; an earlier day covers the
 * check-ins since then, as everything is recalculated). A plan they already have ends the day before.
 */
function ownerStartPlan_(book, cfg, req, now, io, who) {
  const s = studentById_(book, req.studentId);
  if (!s) return { ok: false, error: 'That student wasn\'t found.' };
  const plan = PLAN_CHOICES.indexOf(str_(req.plan)) >= 0 ? str_(req.plan) : '';
  if (!plan) return { ok: false, error: 'Please pick a plan.' };
  const start = str_(req.start) || now.date;
  if (!validDay_(start) || start > addDays_(now.date, 62) || start < addDays_(now.date, -400)) {
    return { ok: false, error: 'Please pick a start date.' };
  }
  const sid = str_(s.StudentID);
  ownPlans_(book).forEach(function (p) {
    if (p.sid !== sid || (p.end && p.end < start)) return;
    // Ends the day before. One that hadn't started by then ends before it starts: it never runs.
    p.row.End = addDays_(start, -1);
    io.update('Plans', p.row, { End: p.row.End });
  });
  const row = { PlanID: io.newId('PL'), Student: cleanEmail_(s.Email) || str_(s.Name), Plan: plan, Start: start, End: '', Note: OWNER_NOTE + ' (' + str_(who) + ')' };
  (book.plans = book.plans || []).push(row);
  io.append('Plans', row);
  return Object.assign(ownerStudents_(book, cfg, now), { wrote: true, done: str_(s.Name) + ' is on ' + plan.toLowerCase() + ' from ' + fmtDay_(start) + '.' });
}

/** Ends one of the owner's plans: today by default, so today's classes are still covered. */
function ownerEndPlan_(book, cfg, req, now, io, who) {
  const p = ownPlans_(book).filter(function (x) { return x.id === str_(req.planId); })[0];
  if (!p) return { ok: false, error: 'That plan wasn\'t found.' };
  let end = str_(req.end) || now.date;
  if (!validDay_(end)) return { ok: false, error: 'Please pick an end date.' };
  const never = !!p.start && end < p.start;
  if (never) end = addDays_(p.start, -1); // hadn't started yet: it never runs
  p.row.End = end;
  io.update('Plans', p.row, { End: end });
  const s = studentById_(book, p.sid);
  return Object.assign(ownerStudents_(book, cfg, now), { wrote: true,
    done: (s ? str_(s.Name) + '\'s plan' : 'The plan') + (never ? ' is removed.' : ' ends ' + fmtDay_(end) + '.') });
}

/** A class pass: a number of classes from today, with an optional expiry. No price: that's the money side. */
function ownerAddPass_(book, cfg, req, now, io, who) {
  const s = studentById_(book, req.studentId);
  if (!s) return { ok: false, error: 'That student wasn\'t found.' };
  const n = Math.round(num_(req.classes, 0));
  if (!(n >= 1 && n <= 100)) return { ok: false, error: 'How many classes? (1 to 100)' };
  const expires = str_(req.expires);
  if (expires && (!validDay_(expires) || expires < now.date)) return { ok: false, error: 'Please pick an expiry date after today, or leave it empty.' };
  const row = { PackageID: io.newId('PK'), Student: cleanEmail_(s.Email) || str_(s.Name), Classes: n, Purchased: now.date, Expires: expires, Amount: '', Note: OWNER_NOTE + ' (' + str_(who) + ')' };
  (book.packages = book.packages || []).push(row);
  io.append('Packages', row);
  return Object.assign(ownerStudents_(book, cfg, now), { wrote: true,
    done: str_(s.Name) + ' has a ' + n + '-class pass' + (expires ? ', until ' + fmtDay_(expires) : '') + '.' });
}

/**
 * An "I'm here for a class" visit: matched to a class (one on that day's schedule, or a name
 * she types), which makes it a normal check-in, or removed (void) if it wasn't a class.
 */
function ownerSortOut_(book, cfg, req, now, io, who) {
  const l = unscheduledLog_(book).filter(function (x) { return str_(x.CheckinID) === str_(req.checkinId); })[0];
  if (!l) return Object.assign(ownerToday_(book, cfg, now), { ok: false, error: 'That one was already sorted out.' });
  const day = dayStr_(l.ClassDate);
  let fields;
  if (req.remove) {
    fields = { Status: 'void' };
  } else if (str_(req.classId)) {
    const c = allClassesToday_(book, day).filter(function (x) { return x.id === str_(req.classId); })[0];
    if (!c) return { ok: false, error: 'That class isn\'t on the schedule that day.' };
    const dup = liveLog_(book).some(function (x) {
      return str_(x.StudentID) === str_(l.StudentID) && dayStr_(x.ClassDate) === day && str_(x.ClassID) === c.id;
    });
    if (dup) return { ok: false, error: str_(l.Student) + ' is already checked in to ' + c.name + ' that day. Remove this one instead.' };
    fields = { ClassID: c.id, Class: c.name, Status: 'ok' };
  } else {
    const name = str_(req.className).replace(/\s+/g, ' ').slice(0, 80);
    if (!name) return { ok: false, error: 'Which class was it?' };
    fields = { Class: name, Status: 'ok' };
  }
  fields.Note = noteWith_(l.Note, (req.remove ? 'removed by ' : 'matched by ') + str_(who) + ' ' + fmtDay_(now.date));
  Object.keys(fields).forEach(function (k) { l[k] = fields[k]; });
  io.update('Log', l, fields);
  return Object.assign(ownerToday_(book, cfg, now), { wrote: true,
    done: req.remove ? 'Removed.' : str_(l.Student) + ' is checked in to ' + fields.Class + '.' });
}

/**
 * The attendance checklist: several known students into one class today. Someone already in
 * comes back as already, so a double tap or a retry is harmless.
 */
function ownerCheckinMany_(book, cfg, req, now, io, who) {
  const classId = str_(req.classId);
  if (!allClassesToday_(book, now.date).some(function (c) { return c.id === classId; })) return { ok: false, error: 'That class isn\'t on today\'s schedule.' };
  const ids = [].concat(req.studentIds || []).map(str_).filter(Boolean);
  const newEmail = cleanEmail_(req.email); // "Someone new?": one person typed in, with the ticks
  if (!ids.length && !newEmail) return { ok: false, error: 'Tick someone first.' };
  if (ids.length > 100) return { ok: false, error: 'That\'s too many at once.' };
  const added = [], already = [];
  if (newEmail) { // first, so a mistyped email stops everything before anyone is written
    const res = ownerCheckin_(book, { email: newEmail, name: str_(req.name), classIds: [classId] }, now, io, who);
    if (!res.ok) return { ok: false, error: !validEmail_(newEmail) ? 'That email doesn\'t look right.'
      : res.needName ? 'They\'re new: add their name too.' : res.error || 'That didn\'t work.' };
    (res.status === 'ok' ? added : already).push(str_((findStudentByEmail_(book, newEmail) || {}).Name || res.student.name).split(' ')[0]);
  }
  ids.forEach(function (id) {
    const s = studentById_(book, id);
    if (!s || !cleanEmail_(s.Email)) return;
    const res = ownerCheckin_(book, { email: cleanEmail_(s.Email), classIds: [classId] }, now, io, who);
    if (!res.ok) return;
    (res.status === 'ok' ? added : already).push(str_(s.Name).split(' ')[0]);
  });
  return Object.assign(ownerToday_(book, cfg, now), { wrote: added.length > 0,
    done: (added.length ? 'Checked in ' + added.length + ': ' + added.join(', ') + '.' : 'Nobody new to check in.') +
      (already.length ? ' Already in: ' + already.join(', ') + '.' : '') });
}

/** Removes one of today's check-ins (a mistaken tick): Status = void, like every delete here. */
function ownerUndo_(book, cfg, req, now, io, who) {
  const l = liveLog_(book).filter(function (x) { return str_(x.CheckinID) === str_(req.checkinId) && dayStr_(x.ClassDate) === now.date; })[0];
  if (!l) return Object.assign(ownerToday_(book, cfg, now), { ok: false, error: 'That check-in was already removed.' });
  l.Status = 'void';
  l.Note = noteWith_(l.Note, 'removed by ' + str_(who) + ' ' + fmtTime_(now.minutes));
  io.update('Log', l, { Status: 'void', Note: l.Note });
  return Object.assign(ownerToday_(book, cfg, now), { wrote: true, done: str_(l.Student) + ' is no longer checked in to ' + (str_(l.Class) || 'that class') + '.' });
}

/** "Check someone in" on the owner page: the menu's rules (any class today, Source = owner). */
function ownerCheckinFromPage_(book, cfg, req, now, io, who) {
  let email = cleanEmail_(req.email);
  if (str_(req.studentId)) {
    const s = studentById_(book, req.studentId);
    if (!s) return { ok: false, error: 'That student wasn\'t found.' };
    email = cleanEmail_(s.Email);
  }
  const ids = [].concat(req.classIds || []).map(str_).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'Pick a class.' };
  const res = ownerCheckin_(book, { email: email, name: str_(req.name), classIds: ids }, now, io, who);
  if (!res.ok) return res;
  const done = res.checkins.map(function (c) { return c.name + (c.already ? ' (already in)' : ''); }).join(', ');
  return Object.assign(ownerToday_(book, cfg, now), { wrote: res.status === 'ok',
    done: ((findStudentByEmail_(book, email) || {}).Name || res.student.name) + ': ' + done + '.' });
}

// --------------------------------- passkeys ---------------------------------
//
// Optional, so a phone that forgets a student (Safari clears a page's storage after 7 days
// without interaction) can check in with Face ID / fingerprint instead of typing their email.
// The passkey lives in the phone's keychain, which that clean-up doesn't touch. Its "user
// handle" is the student's email (see emailFromPasskey_; early ones had a random handle), also
// sent here to Students → Passkey to mark that they have one. Checking in with the passkey
// sends the handle back. There's no signature check (Apps Script can't verify one), so a
// passkey is worth exactly what knowing the student's email is worth, never more.

function validPasskeyHandle_(h) { return /^[A-Za-z0-9_-]{8,100}$/.test(str_(h)); }

/**
 * New passkeys carry the student's email itself as their handle (base64url of the plain-ASCII
 * email): a passkey is worth what an email is worth anyway, and this way it still works after
 * the Sheet's Passkey cell is cleared, or for an email the Sheet doesn't know yet. Older
 * passkeys carry a random handle, found through the Passkey column. Returns '' if it isn't one.
 */
function emailFromPasskey_(handle) {
  const h = str_(handle);
  if (!validPasskeyHandle_(h)) return '';
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = 0, n = 0, out = '';
  for (let i = 0; i < h.length; i++) {
    n = (n << 6) | abc.indexOf(h.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const c = (n >> bits) & 255;
      if (c < 32 || c > 126) return ''; // not plain text: a random handle
      out += String.fromCharCode(c);
    }
  }
  const email = cleanEmail_(out);
  return validEmail_(email) ? email : '';
}

function findStudentByPasskey_(book, handle) {
  const h = str_(handle);
  if (!validPasskeyHandle_(h)) return null;
  return (book.students || []).filter(function (s) { return str_(s.Passkey) === h; })[0] || null;
}

/** The page saved a passkey for this student: keep its handle (replacing any older one). */
function passkeySaved_(book, req, io) {
  if (!codeSource_(book, req.code).ok) return { ok: false, status: 'needTag', error: 'To check in, tap or scan the sign at the studio.' };
  const student = findStudentByEmail_(book, cleanEmail_(req.email));
  if (!student || !validPasskeyHandle_(req.handle)) return { ok: false, error: 'That passkey could not be saved.' };
  student.Passkey = str_(req.handle);
  io.update('Students', student, { Passkey: student.Passkey });
  return { ok: true };
}

/**
 * The owner checks someone in from the Sheet's menu (no phone with them, or new
 * at the door). Same rules as the page, except any class today can be picked
 * at any time of day. Only Code.gs calls this; the web API can't reach it.
 */
function ownerCheckin_(book, req, now, io, by) {
  return checkin_(book, configFrom_(book.config), req, now, io, { anyTimeToday: true, source: 'owner', by: str_(by) });
}

/** Every class on today, earliest first. */
function allClassesToday_(book, day) {
  return classesFrom_(book, configFrom_(book.config)).filter(function (c) { return classIsOn_(c, day); })
    .sort(function (a, b) { return a.start - b.start; });
}

function checkin_(book, cfg, req, now, io, opts) {
  let email = cleanEmail_(req.email);
  const name = str_(req.name).replace(/\s+/g, ' ').slice(0, 80);
  // The sign's code first, before anything is written: no code, no new student, no check-in.
  const from = opts.source ? { ok: true, source: opts.source } : codeSource_(book, req.code);
  // badCode: the link carried a code that isn't (or is no longer) an active sign's. The page then
  // says so, so a student at a broken sign tells the studio instead of being sent back to it.
  if (!from.ok) return { ok: false, status: 'needTag', badCode: !!str_((req.code || {}).t), error: 'To check in, tap or scan the sign at the studio.' };
  // Checking in with a passkey instead of an email (see passkeySaved_).
  if (req.passkey) {
    const byKey = findStudentByPasskey_(book, req.passkey);
    email = byKey ? cleanEmail_(byKey.Email) : emailFromPasskey_(req.passkey);
    if (!email) return { ok: false, status: 'needDetails', error: 'That passkey isn\'t recognized any more. Please enter your email.' };
  }
  if (!validEmail_(email)) return { ok: false, status: 'needDetails', error: 'Please enter a valid email.' };

  // A tester's "Start over" link: only ever touches the student with this email.
  if (from.scenario === 'reset') {
    const who = findStudentByEmail_(book, email);
    return { ok: true, studio: cfg.studioName, status: 'reset', cleared: who ? resetTester_(book, who, now, io) : 0 };
  }

  // A returning student only needs their email; the name is asked for the first time only.
  let student = findStudentByEmail_(book, email);
  let isNew = false;
  if (!student) {
    // A passkey brought the email: send it back so the page can show it, filled in, with the name box.
    if (!name) return { ok: false, status: 'needDetails', needName: true, error: 'Please enter your name.', email: req.passkey ? email : undefined };
    // A cap on sign-ups (Code.gs: so many an hour), so a script can't fill the Sheet with made-up students.
    if (io.allowNewStudent && !io.allowNewStudent()) {
      return { ok: false, status: 'busy', error: 'Lots of new sign-ups right now. Please let your instructor know you\'re here.' };
    }
    student = { StudentID: io.newId('S'), Name: name, Email: email, FirstSeen: now.stamp };
    book.students.push(student);
    io.append('Students', student);
    isNew = true;
  }

  // The chat link is only ever sent to someone who has checked in, never put in the page itself,
  // and only while they haven't joined or hidden it (Students → Chat).
  const chatMode = chatMode_(book, cfg, student);
  const base = { ok: true, studio: cfg.studioName, student: studentView_(student), isNew: isNew,
    chatLink: chatMode ? cfg.chatLink : '', chatMode: chatMode,
    hasPasskey: !!str_(student.Passkey),
    // Offer to save one only to a returning student without one: a first visit has enough on it.
    passkeyOffer: !str_(student.Passkey) && liveLog_(book).some(function (l) { return str_(l.StudentID) === str_(student.StudentID); }) };
  // A test link (dev only) swaps the real schedule for its scenario's pretend classes, on a
  // pretend clock late at night, so every scenario still fits in the day (see testClock_).
  if (from.scenario) {
    now = testClock_(now);
    // Opening the link (not picking classes on it afterwards) starts its situation over.
    const opening = !req.unscheduled && ![].concat(req.classIds || [], req.classId || []).filter(Boolean).length;
    if (opening) freshTestLink_(book, student, from.scenario, from.source, io);
  }
  const classes = from.scenario ? testClasses_(from.scenario, now, cfg) : classesFrom_(book, cfg);
  const avail = opts.anyTimeToday
    ? allClassesToday_(book, now.date).map(function (c) { return { klass: c, open: true }; })
    : todaysClasses_(classes, now, cfg);
  const source = from.source;
  const sid = str_(student.StudentID);

  // "I'm here for a class anyway": recorded for the owner to sort out, charged nothing. One per
  // student per day (a retry or second tap returns the same row), like a repeat check-in.
  if (req.unscheduled) {
    const note = str_(req.note).replace(/\s+/g, ' ').slice(0, 200);
    const mine = unscheduledLog_(book).filter(function (l) {
      return str_(l.StudentID) === sid && dayStr_(l.ClassDate) === now.date;
    })[0];
    // The class they typed comes back, so the page can say what was noted (their own words).
    if (mine) return Object.assign(base, { status: 'unscheduled', checkinId: str_(mine.CheckinID), already: true, note: str_(mine.Note) });
    const row = {
      CheckinID: io.newId('C'), When: now.stamp, ClassDate: now.date,
      StudentID: sid, Student: str_(student.Name), ClassID: '', Class: '',
      Price: '', Source: source, Status: UNSCHEDULED, Note: note,
    };
    book.log.push(row);
    io.append('Log', row);
    return Object.assign(base, { status: 'unscheduled', checkinId: row.CheckinID, already: false, note: note });
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
        // When check-in opens for it, as a real time ("6:30pm"), and whether that's today.
        status: 'noClass', next: next ? Object.assign(classView_(next.klass, next.day), {
          opens: fmtTime_(Math.max(0, next.klass.start - cfg.opensMinutesBefore)), today: next.day === now.date,
          done: next.day === now.date && !!doneRow(next.klass), // already checked in to it, early
        }) : null,
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
      Price: c.price, Source: source, Status: 'ok', Note: '', By: opts.by || '',
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
  if (!(amount > 0)) return { ok: false, error: 'That amount looks wrong.' };
  // The page only ever offers to pay what the check-ins it names still owe (or, with none named,
  // the whole balance). Anything more would let someone who knows a student's email wipe out
  // what that student owes, or build them a credit.
  const ids = [].concat(req.checkinIds || []).map(str_).filter(Boolean);
  const view = function () { return { ok: true, account: accountView_(book, cfg, student, now.date, ids) }; };
  const owed = ids.length ? accountView_(book, cfg, student, now.date, ids).due
    : ledgerFor_(book, cfg, str_(student.StudentID), now.date).owed;
  if (owed <= 0) return view(); // already paid: a second "Yes, I paid" records nothing
  if (amount > owed) return { ok: false, error: 'That amount looks wrong.' };
  // Recorded by name to match the owner's dropdown, unless the name is shared — then by email.
  const who = resolveStudentId_(book, student.Name) === str_(student.StudentID) ? str_(student.Name) : cleanEmail_(student.Email);
  const row = {
    PaymentID: io.newId('P'), Student: who, Amount: amount, Date: now.date,
    For: 'dropin', Status: 'declared', Method: 'venmo', Note: str_(req.note).slice(0, 200),
    Covers: ids.join(' '), // pays for these check-ins first (see ledgerFor_)
  };
  book.payments.push(row);
  io.append('Payments', row);
  return view();
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

const COVERED_LABELS = { plan: 'plan', package: 'class pass', free: 'free class', dropin: 'drop-in' };

/**
 * The "Today" tab: every class today with who has checked in and how each is
 * covered, plus anyone here for a class that isn't on the schedule. Code.gs
 * rewrites it after each check-in, so the owner can glance at it in the Sheets app.
 */
function todayRows_(book, now) {
  const cfg = configFrom_(book.config);
  const log = liveLog_(book).filter(function (l) { return dayStr_(l.ClassDate) === now.date; });
  const ledgers = {};
  const ledger = function (sid) { return ledgers[sid] || (ledgers[sid] = ledgerFor_(book, cfg, sid, now.date)); };
  const rows = [['Today, ' + fmtDay_(now.date) + ' — updated ' + fmtTime_(now.minutes) +
    '. Rewritten after every check-in; edits here are overwritten.']];
  const section = function (title, lines) {
    rows.push([], [title, lines.length + ' checked in', '']);
    lines.forEach(function (l) {
      const led = ledger(str_(l.StudentID));
      const item = led.items.filter(function (i) { return i.id === str_(l.CheckinID); })[0];
      rows.push([str_(l.Student),
        item ? COVERED_LABELS[item.covered] + (item.covered === 'dropin' ? ' ' + money_(item.price) : '') : '',
        led.owed > 0 ? 'owes ' + money_(led.owed) + (led.pending ? ' (says they sent ' + money_(led.pending) + ')' : '') : '']);
    });
  };
  const classes = allClassesToday_(book, now.date);
  const seen = {};
  classes.forEach(function (c) {
    const mine = log.filter(function (l) { return str_(l.ClassID) === c.id; });
    mine.forEach(function (l) { seen[str_(l.CheckinID)] = true; });
    section(fmtTime_(c.start) + ' · ' + c.name, mine);
  });
  // Check-ins for a class no longer on today's schedule (cancelled in Wix afterwards), or rows the owner fixed by hand.
  const other = {};
  log.filter(function (l) { return !seen[str_(l.CheckinID)]; }).forEach(function (l) {
    const k = str_(l.Class) || '(no class filled in)';
    (other[k] = other[k] || []).push(l);
  });
  Object.keys(other).sort().forEach(function (k) { section(k, other[k]); });
  const here = unscheduledLog_(book).filter(function (l) { return dayStr_(l.ClassDate) === now.date; });
  if (here.length) {
    rows.push([], ["Here for a class that isn't on the schedule", here.length + ' so far', '']);
    here.forEach(function (l) { rows.push([str_(l.Student), str_(l.Note), '']); });
  }
  if (!classes.length && !log.length && !here.length) rows.push([], ['No classes today.']);
  return rows;
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
