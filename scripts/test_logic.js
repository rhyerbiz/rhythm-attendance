// Tests for apps-script/Logic.gs. Run: node scripts/test_logic.js
// Logic.gs is loaded into a VM exactly as Apps Script would see it — no Google services needed.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Logic.gs'), 'utf8'), ctx);
const L = (expr) => vm.runInContext(expr, ctx);
const fn = (name) => L(name);
// Values made inside the VM are from another realm; compare them as plain data.
const same = (actual, expected) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);

let passed = 0;
function test(name, body) {
  try { body(); passed++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

// 2026-11-02 is a Monday.
const MON = '2026-11-02';
function at(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return { date, minutes: h * 60 + m, stamp: date + ' ' + hhmm + ':00' };
}
function makeBook(extra) {
  return Object.assign({
    config: [{ Key: 'studioName', Value: 'Rhythm' }, { Key: 'venmoHandle', Value: '@rhythm-studio' }, { Key: 'dropInPrice', Value: '20' }],
    schedule: [
      { ClassID: 'K1', Class: 'Salsa 1', Days: 'Mon, Wed', Start: '7:00 PM', Minutes: 60 },
      { ClassID: 'K2', Class: 'Bachata 2', Days: 'Monday', Start: '20:00', Minutes: 60 },
      { ClassID: 'K3', Class: 'Open Practice', Days: 'Fri', Start: '6pm', Price: 0 },
    ],
    students: [], log: [], packages: [], payments: [],
  }, extra || {});
}
let ids = 0; // shared, so ids stay unique across requests as they do for real
function makeIo() {
  const written = [];
  return { written, newId: (p) => p + (++ids), append: (tab, row) => written.push([tab, row]) };
}
function checkin(book, now, req) {
  return fn('handleRequest_')(book, Object.assign({ action: 'checkin', name: 'Jess Lee', email: 'Jess@Example.com', code: { t: 'static' } }, req || {}), now, makeIo());
}

// ---------------------------------------------------------------- parsing
test('parseTime_ accepts the ways an owner types a time', () => {
  const p = fn('parseTime_');
  assert.strictEqual(p('7:00 PM'), 19 * 60);
  assert.strictEqual(p('7pm'), 19 * 60);
  assert.strictEqual(p('7:30p.m.'), 19 * 60 + 30);
  assert.strictEqual(p('19:00'), 19 * 60);
  assert.strictEqual(p('7:00:00 PM'), 19 * 60); // how Sheets displays a time cell
  assert.strictEqual(p('19:30:00'), 19 * 60 + 30);
  assert.strictEqual(p('12:15am'), 15);
  assert.strictEqual(p('12pm'), 12 * 60);
  assert.strictEqual(p(0.75), 18 * 60);
  assert.strictEqual(p('25:00'), null);
  assert.strictEqual(p('13pm'), null);
  assert.strictEqual(p('soon'), null);
});

test('parseDays_ accepts lists and full names', () => {
  const p = fn('parseDays_');
  assert.deepStrictEqual(Array.from(p('Mon, Wed')), [1, 3]);
  assert.deepStrictEqual(Array.from(p('Tuesday & Thursday')), [2, 4]);
  assert.deepStrictEqual(Array.from(p('sun/sat')), [6, 7]);
  assert.deepStrictEqual(Array.from(p('')), []);
});

test('date helpers cross month ends and know the weekday', () => {
  assert.strictEqual(fn('addDays_')('2026-10-31', 1), '2026-11-01');
  assert.strictEqual(fn('addDays_')('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(fn('dowOf_')(MON), 1);
  assert.strictEqual(fn('dowOf_')('2026-11-08'), 7);
  assert.strictEqual(fn('fmtDay_')(MON), 'Mon Nov 2');
});

// --------------------------------------------------------------- check-in
test('a new student is created and checked in to the open class', () => {
  const book = makeBook();
  const res = checkin(book, at(MON, '18:50'));
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.isNew, true);
  assert.strictEqual(res.checkins.length, 1);
  assert.strictEqual(res.checkins[0].name, 'Salsa 1');
  assert.strictEqual(book.students[0].Email, 'jess@example.com');
  assert.strictEqual(book.log[0].Source, 'static');
  assert.strictEqual(book.log[0].Price, 20);
});

test('check-in opens 30 min before a class and stays open 90 min after it ends', () => {
  // Salsa 19:00–20:00 (late until 21:30); Bachata 20:00–21:00 opens 19:30 (late until 22:30).
  assert.strictEqual(checkin(makeBook(), at(MON, '18:29')).status, 'noClass');
  assert.strictEqual(checkin(makeBook(), at(MON, '18:30')).checkins[0].id, 'K1');
  assert.strictEqual(checkin(makeBook(), at(MON, '19:29')).checkins[0].id, 'K1');
  assert.strictEqual(checkin(makeBook(), at(MON, '19:30')).status, 'choose');
  assert.strictEqual(checkin(makeBook(), at(MON, '21:31')).checkins[0].id, 'K2');
  assert.strictEqual(checkin(makeBook(), at(MON, '22:30')).checkins[0].id, 'K2');
  assert.strictEqual(checkin(makeBook(), at(MON, '22:31')).status, 'noClass');
});

test('the window is configurable', () => {
  const book = makeBook();
  book.config.push({ Key: 'opensMinutesBefore', Value: '45' }, { Key: 'lateMinutesAfterEnd', Value: '30' });
  assert.strictEqual(checkin(book, at(MON, '18:15')).status, 'ok');
  assert.strictEqual(checkin(makeBook({ config: book.config }), at(MON, '20:31')).checkins[0].id, 'K2');
});

test('forgot on the way in: checks in on the way out, after class ends', () => {
  const book = makeBook();
  // 21:25: Salsa ended at 20:00 but is still in its late window; Bachata is open too.
  const res = checkin(book, at(MON, '21:25'));
  assert.strictEqual(res.status, 'choose');
  assert.strictEqual(checkin(book, at(MON, '21:25'), { classIds: ['K1'] }).status, 'ok');
  assert.strictEqual(book.log[0].ClassID, 'K1');
  assert.strictEqual(checkin(makeBook(), at(MON, '21:31'), { classIds: ['K1'] }).status, 'closed');
});

test('a series: several classes in one check-in, including ones not open yet', () => {
  const book = makeBook();
  const first = checkin(book, at(MON, '18:40'));
  same(first.checkins.map((c) => c.id), ['K1']);
  same(first.more.map((c) => [c.id, c.open]), [['K2', false]]);
  const res = checkin(book, at(MON, '18:41'), { classIds: ['K1', 'K2'] });
  assert.strictEqual(res.status, 'ok');
  same(res.checkins.map((c) => [c.id, c.already]), [['K1', true], ['K2', false]]);
  assert.strictEqual(res.more.length, 0);
  assert.strictEqual(book.log.length, 2);
  assert.strictEqual(res.account.owed, 40);
  assert.strictEqual(res.account.these.dropin, 2);
  // Both picked at once from the start: one note names both.
  const both = checkin(makeBook(), at(MON, '18:40'), { classIds: ['K1', 'K2'] });
  assert.ok(decodeURIComponent(both.account.pay.url).includes('Salsa 1 + Bachata 2 Mon Nov 2'));
});

test('a series with one credit left: the package covers one, the other is a drop-in', () => {
  const book = makeBook({
    students: [{ StudentID: 'S9', Name: 'Jess Lee', Email: 'jess@example.com' }],
    packages: [{ PackageID: 'P1', Student: 'jess@example.com', Classes: 1, Purchased: '2026-10-01' }],
  });
  const res = checkin(book, at(MON, '18:40'), { classIds: ['K1', 'K2'], name: '' });
  assert.strictEqual(res.account.these.package, 1);
  assert.strictEqual(res.account.these.dropin, 1);
  assert.strictEqual(res.account.creditsLeft, 0);
  assert.strictEqual(res.account.owed, 20);
  assert.ok(decodeURIComponent(res.account.pay.url).includes('Bachata 2 Mon Nov 2'));
  // Each check-in says how it was covered, so the page can label the classes one by one.
  const how = res.checkins.map((c) => res.account.items.filter((i) => i.id === c.checkinId)[0]);
  same(how.map((i) => [i.covered, i.priceLabel]), [['package', '$0'], ['dropin', '$20']]);
});

test('before any class opens, later classes today can be checked in to early', () => {
  const res = checkin(makeBook(), at(MON, '12:00'));
  assert.strictEqual(res.status, 'noClass');
  same(res.later.map((c) => c.id), ['K1', 'K2']);
  assert.strictEqual(checkin(makeBook(), at(MON, '12:00'), { classIds: ['K2'] }).status, 'ok');
});

test('no class: says what is next, including later in the week', () => {
  let res = checkin(makeBook(), at(MON, '12:00'));
  assert.strictEqual(res.status, 'noClass');
  assert.strictEqual(res.next.name, 'Salsa 1');
  assert.strictEqual(res.next.day, MON);
  // A real time for when check-in opens (Salsa at 7pm, opening 30 minutes before), and whether it's today.
  assert.strictEqual(res.next.opens, '6:30pm');
  assert.strictEqual(res.next.today, true);
  res = checkin(makeBook(), at(MON, '22:45'));
  assert.strictEqual(res.next.name, 'Salsa 1');
  assert.strictEqual(res.next.day, '2026-11-04');
  assert.strictEqual(res.next.opens, '6:30pm');
  assert.strictEqual(res.next.today, false);
  assert.strictEqual(res.later.length, 0);
  res = checkin(makeBook({ config: [{ Key: 'opensMinutesBefore', Value: '45' }] }), at(MON, '12:00'));
  assert.strictEqual(res.next.opens, '6:15pm');
  // Checked in early to tonight's class, then tapped again at lunch: the page can say they're all set.
  const early = makeBook();
  assert.strictEqual(checkin(early, at(MON, '12:00')).next.done, false);
  checkin(early, at(MON, '12:01'), { classIds: ['K1'] });
  assert.strictEqual(checkin(early, at(MON, '12:05')).next.done, true);
  // A brand-new student who taps between classes is still remembered.
  const book = makeBook();
  checkin(book, at(MON, '12:00'));
  assert.strictEqual(book.students.length, 1);
  assert.strictEqual(book.log.length, 0);
});

test('two classes open at once asks which, listing every class left today', () => {
  const book = makeBook();
  book.schedule.push({ ClassID: 'K4', Class: 'Salsa 2', Days: 'Mon', Start: '19:15' });
  const res = checkin(book, at(MON, '18:55'));
  assert.strictEqual(res.status, 'choose');
  same(res.options.map((o) => [o.id, o.open, o.done]), [['K1', true, false], ['K4', true, false], ['K2', false, false]]);
  const res2 = checkin(book, at(MON, '18:55'), { classIds: ['K4'] });
  assert.strictEqual(res2.status, 'ok');
  assert.strictEqual(res2.checkins[0].name, 'Salsa 2');
  // Asked again, the class already checked in to shows as done.
  checkin(book, at(MON, '18:55'), { classIds: ['K4'] });
  same(checkin(book, at(MON, '19:31')).options.map((o) => o.done), [false, true, false]);
});

test('back-to-back: a second tap picks the class not yet checked in', () => {
  const book = makeBook();
  book.schedule.push({ ClassID: 'K4', Class: 'Salsa 2', Days: 'Mon', Start: '19:15' });
  checkin(book, at(MON, '18:55'), { classIds: ['K1'] });
  const res = checkin(book, at(MON, '19:10'));
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.checkins[0].id, 'K4');
  const again = checkin(book, at(MON, '19:12'));
  assert.strictEqual(again.status, 'already');
  assert.strictEqual(book.log.length, 2);
});

test('a double tap does not check in twice', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  const res = checkin(book, at(MON, '18:56'));
  assert.strictEqual(res.status, 'already');
  assert.strictEqual(book.log.length, 1);
});

test('a voided check-in no longer counts', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  book.log[0].Status = 'void';
  assert.strictEqual(checkin(book, at(MON, '18:56')).status, 'ok');
});

test('a class picked by id must be on today and not closed', () => {
  const res = checkin(makeBook(), at(MON, '18:55'), { classIds: ['K3'] });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'closed');
});

test('inactive classes and date ranges are respected', () => {
  const book = makeBook();
  book.schedule[0].Active = 'no';
  assert.strictEqual(checkin(book, at(MON, '18:55')).status, 'noClass');
  const book2 = makeBook();
  book2.schedule[0].FirstDate = '2026-11-09';
  assert.strictEqual(checkin(book2, at(MON, '18:55')).status, 'noClass');
});

test('the student is matched by email, case-insensitively, keeping the stored name', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  const res = checkin(book, at(MON, '19:40'), { email: ' JESS@example.COM ', name: 'J' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(book.students.length, 1);
  assert.strictEqual(res.student.name, 'Jess'); // first name only: anyone can type any email
});

test('bad details are refused', () => {
  assert.strictEqual(checkin(makeBook(), at(MON, '18:55'), { email: 'nope' }).ok, false);
  assert.strictEqual(checkin(makeBook(), at(MON, '18:55'), { name: '' }).ok, false);
});

test('email first: a known email needs no name; a new one asks for it', () => {
  const book = makeBook();
  const fresh = checkin(book, at(MON, '18:55'), { name: '' });
  assert.strictEqual(fresh.status, 'needDetails');
  assert.strictEqual(fresh.needName, true);
  assert.strictEqual(book.students.length, 0);
  checkin(book, at(MON, '18:55'));
  const back = checkin(book, at(MON, '18:56'), { name: '' });
  assert.strictEqual(back.status, 'already');
  assert.strictEqual(back.student.name, 'Jess');
  assert.strictEqual(book.students[0].Name, 'Jess Lee');
});

test('with no tags yet, any code works and its source is recorded', () => {
  const src = (code) => fn('codeSource_')({}, code).source;
  assert.strictEqual(src({ t: 'static' }), 'static');
  assert.strictEqual(src({}), 'direct');
  assert.strictEqual(src(null), 'direct');
  assert.strictEqual(src({ t: '59441023', s: 'abc' }), 'unverified');
});

const TAGS = [
  { Code: 'kqmzabhrdpsn', Name: 'Front door', Active: 'yes' },
  { Code: 'pfjxwaecnbrd', Name: 'Totem 2' },
  { Code: 'retiredcode1', Name: 'Old QR', Active: 'no' },
];

test('once there are tags, only their codes check in, and the Log says which sign', () => {
  const book = makeBook({ tags: TAGS });
  const res = checkin(book, at(MON, '18:55'), { code: { t: 'pfjxwaecnbrd' } });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(book.log[0].Source, 'Totem 2');
  for (const code of [{ t: 'static' }, {}, null, { t: 'retiredcode1' }, { t: 'KQMZABHRDPSN' }]) {
    const no = checkin(makeBook({ tags: TAGS }), at(MON, '18:55'), { code });
    assert.strictEqual(no.ok, false);
    assert.strictEqual(no.status, 'needTag');
    // A code that isn't an active sign's is told apart from no code at all.
    assert.strictEqual(no.badCode, !!(code && code.t), JSON.stringify(code));
  }
});

test('without a code nothing is written: no new student, no unscheduled row', () => {
  const book = makeBook({ tags: TAGS });
  checkin(book, at(MON, '18:55'), { code: { t: 'nope' } });
  checkin(book, at(MON, '12:00'), { code: {}, unscheduled: true, note: 'hi' });
  assert.strictEqual(book.students.length, 0);
  assert.strictEqual(book.log.length, 0);
});

test('the owner\'s check-in needs no code', () => {
  const book = makeBook({ tags: TAGS });
  const res = fn('ownerCheckin_')(book, { email: 'jess@example.com', name: 'Jess Lee', classIds: ['K1'] }, at(MON, '21:00'), makeIo());
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(book.log[0].Source, 'owner');
});

// ------------------------------------------------------------------ money
test('no package: a drop-in is owed and a Venmo link offered', () => {
  const res = checkin(makeBook(), at(MON, '18:55'));
  assert.strictEqual(res.account.these.dropin, 1);
  assert.strictEqual(res.account.owed, 20);
  assert.ok(res.account.pay.url.startsWith('https://venmo.com/rhythm-studio?txn=pay&amount=20.00&note='));
  assert.ok(decodeURIComponent(res.account.pay.url).includes('Salsa 1 Mon Nov 2'));
});

test('no Venmo handle configured: owed but no pay link', () => {
  const book = makeBook();
  book.config = book.config.filter((r) => r.Key !== 'venmoHandle');
  const res = checkin(book, at(MON, '18:55'));
  assert.strictEqual(res.account.owed, 20);
  assert.strictEqual(res.account.pay, null);
});

test('a package covers check-ins and counts down', () => {
  const book = makeBook({ packages: [{ PackageID: 'P1', Student: 'jess@example.com', Classes: 10, Purchased: '2026-11-01' }] });
  book.students.push({ StudentID: 'S9', Name: 'Jess Lee', Email: 'jess@example.com' });
  const res = checkin(book, at(MON, '18:55'));
  assert.strictEqual(res.account.these.package, 1);
  assert.strictEqual(res.account.creditsLeft, 9);
  assert.strictEqual(res.account.owed, 0);
  assert.strictEqual(res.account.pay, null);
});

test('packages can be entered by name, and the one expiring first is used first', () => {
  const book = makeBook({
    students: [{ StudentID: 'S9', Name: 'Jess Lee', Email: 'jess@example.com' }],
    packages: [
      { PackageID: 'P1', Student: 'Jess Lee', Classes: 5, Purchased: '2026-10-01' },
      { PackageID: 'P2', Student: 'Jess Lee', Classes: 5, Purchased: '2026-10-15', Expires: '2026-11-30' },
    ],
  });
  checkin(book, at(MON, '18:55'));
  const led = fn('ledgerFor_')(book, fn('configFrom_')(book.config), 'S9', MON);
  assert.strictEqual(led.items[0].packageId, 'P2');
  assert.strictEqual(led.creditsLeft, 9);
});

test('an expired package does not cover a class, and expired credits are not shown', () => {
  const book = makeBook({
    students: [{ StudentID: 'S9', Name: 'Jess Lee', Email: 'jess@example.com' }],
    packages: [{ PackageID: 'P1', Student: 'jess@example.com', Classes: 5, Purchased: '2026-09-01', Expires: '2026-10-31' }],
  });
  const res = checkin(book, at(MON, '18:55'));
  assert.strictEqual(res.account.these.dropin, 1);
  assert.strictEqual(res.account.creditsLeft, 0);
});

test('a package bought later (but dated earlier) retroactively covers past drop-ins', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  const sid = book.students[0].StudentID;
  book.packages.push({ PackageID: 'P1', Student: 'jess@example.com', Classes: 10, Purchased: MON });
  const led = fn('ledgerFor_')(book, fn('configFrom_')(book.config), sid, MON);
  assert.strictEqual(led.owed, 0);
  assert.strictEqual(led.creditsLeft, 9);
});

test('a monthly plan covers every paid class while it runs, ahead of package credits', () => {
  const book = makeBook({
    students: [{ StudentID: 'S9', Name: 'Jess Lee', Email: 'jess@example.com' }],
    packages: [{ PackageID: 'P1', Student: 'jess@example.com', Classes: 10, Purchased: '2026-10-01' }],
    plans: [{ PlanID: 'PL1', Student: 'Jess Lee', Plan: '2 classes/week', Start: '2026-11-01', End: '2026-11-30' }],
  });
  // Three classes in one week: weekly limits aren't enforced yet.
  const res = checkin(book, at(MON, '18:40'), { classIds: ['K1', 'K2'] });
  assert.strictEqual(res.account.these.plan, 2);
  assert.strictEqual(res.account.plan, '2 classes/week');
  assert.strictEqual(checkin(book, at('2026-11-04', '18:55')).account.these.plan, 1);
  assert.strictEqual(res.account.owed, 0);
  assert.strictEqual(res.account.pay, null);
  assert.strictEqual(res.account.creditsLeft, 10); // the package is untouched
  // After the plan ends, the package takes over.
  const dec = checkin(book, at('2026-12-02', '18:55'));
  assert.strictEqual(dec.account.these.package, 1);
  assert.strictEqual(dec.account.plan, '');
});

test('a plan with no end date is ongoing; one starting later does not cover today', () => {
  const ongoing = makeBook({ plans: [{ PlanID: 'PL1', Student: 'jess@example.com', Plan: '1 class/week', Start: '2026-01-01' }] });
  ongoing.students.push({ StudentID: 'S9', Name: 'Jess Lee', Email: 'jess@example.com' });
  assert.strictEqual(checkin(ongoing, at(MON, '18:55')).account.these.plan, 1);
  const later = makeBook({ plans: [{ PlanID: 'PL1', Student: 'jess@example.com', Plan: '1 class/week', Start: '2026-12-01' }] });
  later.students.push({ StudentID: 'S9', Name: 'Jess Lee', Email: 'jess@example.com' });
  assert.strictEqual(checkin(later, at(MON, '18:55')).account.these.dropin, 1);
});

test('free classes cost nothing', () => {
  const res = checkin(makeBook(), at('2026-11-06', '17:45'));
  assert.strictEqual(res.checkins[0].name, 'Open Practice');
  assert.strictEqual(res.account.these.free, 1);
  assert.strictEqual(res.account.owed, 0);
});

test('the price is fixed at check-in time; later price changes do not rewrite history', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  book.schedule[0].Price = 25;
  const sid = book.students[0].StudentID;
  assert.strictEqual(fn('ledgerFor_')(book, fn('configFrom_')(book.config), sid, MON).owed, 20);
});

test('declaring a payment clears what is owed, and rejecting it brings it back', () => {
  const book = makeBook();
  const res = checkin(book, at(MON, '18:55'));
  const io = makeIo();
  const pay = fn('handleRequest_')(book, { action: 'declarePayment', email: 'jess@example.com', amount: 20, checkinIds: [book.log[0].CheckinID] }, at(MON, '18:56'), io);
  assert.strictEqual(pay.ok, true);
  assert.strictEqual(pay.account.owed, 0);
  assert.strictEqual(pay.account.pending, 20);
  assert.strictEqual(io.written[0][0], 'Payments');
  book.payments[0].Status = 'rejected';
  const sid = res.student.id;
  assert.strictEqual(fn('ledgerFor_')(book, fn('configFrom_')(book.config), sid, MON).owed, 20);
});

test('silly payment amounts are refused', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  const h = fn('handleRequest_');
  assert.strictEqual(h(book, { action: 'declarePayment', email: 'jess@example.com', amount: -5 }, at(MON, '19:00'), makeIo()).ok, false);
  assert.strictEqual(h(book, { action: 'declarePayment', email: 'nobody@example.com', amount: 5 }, at(MON, '19:00'), makeIo()).ok, false);
});

test('a declared payment can\'t be more than is owed, and nothing is recorded when nothing is owed', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  const h = fn('handleRequest_');
  // Someone who knows Jess's email can't wipe out more than she owes, or build her a credit.
  assert.strictEqual(h(book, { action: 'declarePayment', email: 'jess@example.com', amount: 500 }, at(MON, '19:00'), makeIo()).ok, false);
  assert.strictEqual(book.payments.length, 0);
  assert.strictEqual(h(book, { action: 'declarePayment', email: 'jess@example.com', amount: 20 }, at(MON, '19:00'), makeIo()).ok, true);
  // A second "Yes, I paid" (a lost answer, a double tap) doesn't record a second payment.
  const again = h(book, { action: 'declarePayment', email: 'jess@example.com', amount: 20 }, at(MON, '19:01'), makeIo());
  assert.strictEqual(again.ok, true);
  assert.strictEqual(again.account.owed, 0);
  assert.strictEqual(book.payments.length, 1);
});

test('an over-long email is refused, and new sign-ups stop when the hourly cap is reached', () => {
  assert.strictEqual(checkin(makeBook(), at(MON, '18:55'), { email: 'a'.repeat(250) + '@example.com' }).ok, false);
  const book = makeBook();
  const io = Object.assign(makeIo(), { allowNewStudent: () => false });
  const res = fn('handleRequest_')(book, { action: 'checkin', name: 'Bot', email: 'bot1@example.com' }, at(MON, '18:55'), io);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 'busy');
  assert.strictEqual(book.students.length, 0);
  // Students the studio already knows aren't affected.
  checkin(book, at(MON, '18:50'));
  assert.strictEqual(fn('handleRequest_')(book, { action: 'checkin', email: 'jess@example.com' }, at(MON, '18:55'), io).ok, true);
});

test('a check-in asks only for its own classes; older unpaid ones are left to the owner', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));                      // Monday: not paid
  const res = checkin(book, at('2026-11-04', '18:55')); // Wednesday
  assert.strictEqual(res.account.owed, 40);             // the whole balance, for the owner
  assert.strictEqual(res.account.due, 20);              // what the page asks for: today's class
  assert.strictEqual(res.account.pay.amount, 20);
  const note = decodeURIComponent(res.account.pay.url);
  assert.ok(note.includes('Salsa 1 Wed Nov 4') && !note.includes('Mon Nov 2'));
});

test('a Wix class that has left the synced schedule keeps its start time in the ledger', () => {
  const book = makeBook({ schedule: [] });
  book.students.push({ StudentID: 'S1', Name: 'Jess Lee', Email: 'jess@example.com' });
  book.log.push({ CheckinID: 'C1', ClassDate: '2026-10-26', StudentID: 'S1', Student: 'Jess Lee', ClassID: 'Wc0549875-1915', Class: 'Dance 101', Price: 20, Status: 'ok' });
  const led = fn('ledgerFor_')(book, fn('configFrom_')(book.config), 'S1', MON);
  same(led.unpaid.map((u) => [u.className, u.day, u.start]), [['Dance 101', '2026-10-26', 19 * 60 + 15]]);
});

test('"Yes, I paid" pays for the check-ins it names; payments without that pay off the oldest first', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));                      // Monday: not paid
  const wed = checkin(book, at('2026-11-04', '18:55'));
  const h = fn('handleRequest_');
  const paid = h(book, { action: 'declarePayment', email: 'jess@example.com', amount: 20, checkinIds: [wed.checkins[0].checkinId] }, at('2026-11-04', '19:00'), makeIo());
  assert.strictEqual(paid.ok, true);
  assert.strictEqual(book.payments[0].Covers, wed.checkins[0].checkinId);
  assert.strictEqual(paid.account.due, 0);              // Wednesday is paid…
  const led = () => fn('ledgerFor_')(book, fn('configFrom_')(book.config), book.students[0].StudentID, '2026-11-04');
  same(led().unpaid.map((u) => [u.day, u.amount]), [['2026-11-02', 20]]); // …Monday still isn't
  // More than Wednesday owed is refused; a second "Yes, I paid" records nothing.
  assert.strictEqual(h(book, { action: 'declarePayment', email: 'jess@example.com', amount: 40, checkinIds: [wed.checkins[0].checkinId] }, at('2026-11-04', '19:01'), makeIo()).ok, true);
  assert.strictEqual(book.payments.length, 1);
  // The owner types in $25 cash with no Covers: it pays Monday, and $5 is left as credit.
  book.payments.push({ PaymentID: 'P2', Student: 'jess@example.com', Amount: 25, Date: '2026-11-05', Status: 'confirmed' });
  same(led().unpaid, []);
  assert.strictEqual(led().owed, -5);
});

// ---------------------------------------------------------------- reports
test('dashboard and weekly summary flag owing, low and lapsed students', () => {
  const book = makeBook({
    students: [
      { StudentID: 'S1', Name: 'Ana', Email: 'ana@example.com', Venmo: '@ana' },
      { StudentID: 'S2', Name: 'Ben', Email: 'ben@example.com' },
    ],
    packages: [{ PackageID: 'P1', Student: 'ben@example.com', Classes: 4, Purchased: '2026-09-01' }],
    log: ['2026-09-07', '2026-09-14', '2026-09-21'].map((d, i) => ({ CheckinID: 'C' + i, ClassDate: d, StudentID: 'S2', Student: 'Ben', ClassID: 'K1', Class: 'Salsa 1', Status: 'ok' }))
      .concat([{ CheckinID: 'C9', ClassDate: MON, StudentID: 'S1', Student: 'Ana', ClassID: 'K1', Class: 'Salsa 1', Price: 20, Status: 'ok' }]),
  });
  const now = at('2026-11-03', '09:00');
  const sum = fn('weeklySummary_')(book, now);
  same(sum.owes.map((o) => o.name), ['Ana']);
  assert.ok(sum.owes[0].requestUrl.includes('recipients=ana'));
  same(sum.lowCredits.map((o) => o.name), ['Ben']);
  same(sum.lapsed.map((o) => o.name), ['Ben']);
  assert.strictEqual(sum.visits, 1);
  const rows = fn('dashboardRows_')(book, now);
  const ana = rows.find((r) => r[0] === 'Ana');
  const col = (h) => rows[2].indexOf(h);
  assert.strictEqual(ana[col('Owes')], 20);
  assert.ok(ana[col('Flag')].includes('owes $20'));
});

test('a monthly plan shows on the Dashboard and silences an old used-up package', () => {
  const book = makeBook({
    students: [{ StudentID: 'S2', Name: 'Ben', Email: 'ben@example.com' }],
    packages: [{ PackageID: 'P1', Student: 'Ben', Classes: 1, Purchased: '2026-09-01' }],
    plans: [{ PlanID: 'PL1', Student: 'Ben', Plan: '1 class/week', Start: '2026-10-01' }],
    log: [{ CheckinID: 'C1', ClassDate: '2026-09-07', StudentID: 'S2', Student: 'Ben', ClassID: 'K1', Class: 'Salsa 1', Price: 20, Status: 'ok' }],
  });
  const now = at('2026-11-03', '09:00');
  const rows = fn('dashboardRows_')(book, now);
  const ben = rows.find((r) => r[0] === 'Ben');
  assert.strictEqual(ben[rows[2].indexOf('Plan')], '1 class/week');
  assert.strictEqual(ben[rows[2].indexOf('Flag')], '');
  assert.strictEqual(fn('weeklySummary_')(book, now).lowCredits.length, 0);
});

// ------------------------------------------------------- unscheduled + chat
test('"here for a class" records an unscheduled row, charges nothing, and a retry returns the same row', () => {
  const book = makeBook({ students: [{ StudentID: 'S1', Name: 'Jess Lee', Email: 'jess@example.com' }] });
  const now = at('2026-11-03', '12:00'); // a Tuesday: nothing on the schedule
  const io = makeIo();
  const res = fn('handleRequest_')(book, { action: 'checkin', email: 'jess@example.com', unscheduled: true, note: '  Tango   makeup ', code: { t: 'static' } }, now, io);
  assert.strictEqual(res.status, 'unscheduled');
  assert.strictEqual(res.already, false);
  same(io.written.map(([t, r]) => [t, r.Status, r.Class, r.Note]), [['Log', 'unscheduled', '', 'Tango makeup']]);
  const again = fn('handleRequest_')(book, { action: 'checkin', email: 'jess@example.com', unscheduled: true, code: { t: 'static' } }, now, makeIo());
  assert.strictEqual(again.already, true);
  assert.strictEqual(again.checkinId, res.checkinId);
  // The page repeats what was noted, both times.
  assert.strictEqual(res.note, 'Tango makeup');
  assert.strictEqual(again.note, 'Tango makeup');
  // Not a visit and not owed until the owner sorts it out.
  const led = fn('ledgerFor_')(book, fn('configFrom_')(book.config), 'S1', now.date);
  assert.strictEqual(led.owed, 0);
  const rows = fn('dashboardRows_')(book, now);
  const jess = rows.find((r) => r[0] === 'Jess Lee');
  assert.strictEqual(jess[rows[2].indexOf('Visits (all)')], 0);
  assert(rows.some((r) => String(r[0]).startsWith('To review')));
  assert(rows.some((r) => r[1] === 'Jess Lee' && r[2] === 'Tango makeup'));
  same(fn('weeklySummary_')(book, now).review, [{ name: 'Jess Lee', day: 'Tue Nov 3', note: 'Tango makeup' }]);
});

test('once the owner fills in Class and sets ok, it counts as a drop-in', () => {
  const book = makeBook({
    students: [{ StudentID: 'S1', Name: 'Jess Lee', Email: 'jess@example.com' }],
    log: [{ CheckinID: 'C9', ClassDate: '2026-11-03', StudentID: 'S1', Student: 'Jess Lee', ClassID: '', Class: 'Tango', Price: '', Status: 'ok' }],
  });
  const now = at('2026-11-04', '09:00');
  assert.strictEqual(fn('ledgerFor_')(book, fn('configFrom_')(book.config), 'S1', now.date).owed, 20);
  assert(!fn('dashboardRows_')(book, now).some((r) => String(r[0]).startsWith('To review')));
});

test('chatLink goes to checked-in students only when it is an https link', () => {
  const withLink = (v) => makeBook({ config: makeBook().config.concat([{ Key: 'chatLink', Value: v }]) });
  assert.strictEqual(checkin(withLink('https://t.me/+abc123'), at(MON, '18:50')).chatLink, 'https://t.me/+abc123');
  assert.strictEqual(checkin(withLink('javascript:alert(1)'), at(MON, '18:50')).chatLink, '');
  assert.strictEqual(checkin(makeBook(), at(MON, '18:50')).chatLink, '');
  assert.strictEqual(checkin(withLink('https://t.me/+abc123'), at('2026-11-03', '12:00')).chatLink, 'https://t.me/+abc123'); // noClass too
  assert.strictEqual(fn('handleRequest_')(withLink('https://t.me/+abc123'), { action: 'ping' }, at(MON, '12:00'), makeIo()).chatLink, undefined);
});

test('the chat card is full for the first three check-ins, then one line, and gone once joined or hidden', () => {
  const book = makeBook({ config: makeBook().config.concat([{ Key: 'chatLink', Value: 'https://t.me/+abc123' }]) });
  const days = ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16'];
  const modes = days.map((d) => checkin(book, at(d, '18:50')).chatMode);
  same(modes, ['full', 'full', 'full', 'mini', 'mini']);
  // Joining is recorded in Students → Chat, so it follows the person, whatever phone they use.
  const io = updIo();
  assert.strictEqual(fn('handleRequest_')(book, { action: 'chat', email: 'JESS@example.com', choice: 'joined' }, at('2026-11-16', '19:00'), io).ok, true);
  assert.strictEqual(book.students[0].Chat, 'joined 2026-11-16');
  assert.strictEqual(io.updated[0][0], 'Students');
  const after = checkin(book, at('2026-11-18', '18:50'));
  assert.strictEqual(after.chatMode, '');
  assert.strictEqual(after.chatLink, '');
  // Hiding works the same; an unknown email changes nothing.
  checkin(book, at('2026-11-18', '18:51'), { email: 'sam@example.com', name: 'Sam Park' });
  fn('handleRequest_')(book, { action: 'chat', email: 'sam@example.com', choice: 'hidden' }, at('2026-11-18', '19:00'), updIo());
  assert.strictEqual(book.students[1].Chat, 'hidden 2026-11-18');
  assert.strictEqual(fn('handleRequest_')(book, { action: 'chat', email: 'nobody@example.com' }, at('2026-11-18', '19:00'), updIo()).ok, false);
});

// ------------------------------------------------------------------ passkeys
const HANDLE = 'aB3_-xYz'.repeat(6); // 48 url-safe characters, like the page's base64url of 32 random bytes

test('a saved passkey checks the student in without their email, and is never sent back', () => {
  const book = makeBook();
  const first = checkin(book, at(MON, '18:55'));
  assert.strictEqual(first.hasPasskey, false);
  assert.strictEqual(first.passkeyOffer, false); // not on a first visit
  assert.strictEqual(checkin(book, at(MON, '19:50'), { classIds: ['K2'] }).passkeyOffer, true); // a returning student
  const io = updIo();
  const saved = fn('handleRequest_')(book, { action: 'passkey', email: 'jess@example.com', handle: HANDLE, code: { t: 'static' } }, at(MON, '18:56'), io);
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(book.students[0].Passkey, HANDLE);
  assert.strictEqual(io.updated[0][0], 'Students');
  // Safari forgot her: no email, just the passkey's handle.
  const res = checkin(book, at('2026-11-04', '18:55'), { email: '', name: '', passkey: HANDLE });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.student.email, 'jess@example.com');
  assert.strictEqual(res.hasPasskey, true);
  assert.strictEqual(res.passkeyOffer, false); // already has one
  assert.ok(!JSON.stringify(res).includes(HANDLE));
});

test('an unknown or malformed passkey falls back to asking for the email; saving needs a valid handle and the sign', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  const unknown = checkin(book, at(MON, '18:56'), { email: '', passkey: 'Q'.repeat(43) });
  assert.strictEqual(unknown.ok, false);
  assert.strictEqual(unknown.status, 'needDetails');
  assert.strictEqual(checkin(book, at(MON, '18:56'), { email: '', passkey: 'short' }).status, 'needDetails');
  const h = fn('handleRequest_');
  assert.strictEqual(h(book, { action: 'passkey', email: 'jess@example.com', handle: 'short', code: { t: 'static' } }, at(MON, '19:00'), updIo()).ok, false);
  assert.strictEqual(h(book, { action: 'passkey', email: 'nobody@example.com', handle: HANDLE, code: { t: 'static' } }, at(MON, '19:00'), updIo()).ok, false);
  const tagged = makeBook({ tags: [{ Code: 'realsigncode', Name: 'Front door', Active: 'yes' }] });
  checkin(tagged, at(MON, '18:55'), { code: { t: 'realsigncode' } });
  assert.strictEqual(h(tagged, { action: 'passkey', email: 'jess@example.com', handle: HANDLE, code: {} }, at(MON, '19:00'), updIo()).status, 'needTag');
  assert.strictEqual(tagged.students[0].Passkey, undefined);
});

const emailHandle = (e) => Buffer.from(e).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('a passkey carrying the email still works after the Passkey cell is cleared (e.g. Start over)', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  book.students[0].Passkey = ''; // cleared
  const res = checkin(book, at('2026-11-04', '18:55'), { email: '', name: '', passkey: emailHandle('Jess@Example.com') });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.student.email, 'jess@example.com');
});

test('a passkey for an email the studio doesn\'t know asks only for the name, with the email filled in', () => {
  const book = makeBook();
  const res = checkin(book, at(MON, '18:55'), { email: '', name: '', passkey: emailHandle('new.person@example.com') });
  assert.strictEqual(res.status, 'needDetails');
  assert.strictEqual(res.needName, true);
  assert.strictEqual(res.email, 'new.person@example.com');
  assert.strictEqual(book.students.length, 0);
  // A plain email check-in never echoes an email back in that answer.
  assert.strictEqual(checkin(makeBook(), at(MON, '18:55'), { email: 'x@example.com', name: '' }).email, undefined);
});

// ------------------------------------------------------------------ Wix sync
const WIX_SESSIONS = [
  { title: 'Dance 101', serviceId: 'c0549875-d10f', start: '2026-11-09T19:00:00', end: '2026-11-09T20:00:00', status: 'CONFIRMED', type: 'CLASS' },
  { title: 'Kids Hip Hop', serviceId: '2d2cfc33-16a5', start: '2026-11-10T17:00:00', end: '2026-11-10T18:00:00', status: 'CONFIRMED', type: 'CLASS' },
  { title: 'Adult Hip Hop', serviceId: 'e4bab154-f6a6', start: '2026-11-11T19:15:00', end: '2026-11-11T20:30:00', status: 'CONFIRMED', type: 'CLASS' },
  { title: 'Adult Hip Hop', serviceId: 'e4bab154-f6a6', start: '2026-11-04T19:15:00', end: '2026-11-04T20:30:00', status: 'CANCELLED', type: 'CLASS' },
  { title: 'Daycare Session', serviceId: '58d29389', start: '2026-11-09T09:00:00', end: '2026-11-09T10:00:00', status: 'CONFIRMED', type: 'APPOINTMENT' },
  { title: 'Couples', serviceId: 'fdcc1b4d', start: '2026-11-12T18:00:00', end: '2026-11-12T19:00:00', status: 'CONFIRMED', type: 'CLASS' },
];
const WIX_SERVICES = { fdcc1b4d: { name: 'Couples Dance Class', price: 40 } };
const wixCfg = (skip) => fn('configFrom_')(skip == null ? [] : [{ Key: 'wixSkip', Value: skip }]);

test('Wix sessions become dated schedule rows; cancelled, appointments and kids are left out', () => {
  const rows = fn('wixScheduleRows_')(WIX_SESSIONS, WIX_SERVICES, wixCfg());
  same(rows.map((r) => [r.Class, r.Days, r.Start, r.Minutes, r.FirstDate, r.LastDate, r.Price]), [
    ['Dance 101', 'Mon', '19:00', 60, '2026-11-09', '2026-11-09', ''],
    ['Adult Hip Hop', 'Wed', '19:15', 75, '2026-11-11', '2026-11-11', ''],
    ['Couples', 'Thu', '18:00', 60, '2026-11-12', '2026-11-12', 40],
  ]);
  assert.strictEqual(rows[0].ClassID, 'Wc0549875-1900');
});

test('wixSkip takes several words, and "none" keeps every class', () => {
  const names = (skip) => fn('wixScheduleRows_')(WIX_SESSIONS, WIX_SERVICES, wixCfg(skip)).map((r) => r.Class);
  same(names('kids, couples'), ['Dance 101', 'Adult Hip Hop']);
  same(names('none'), ['Dance 101', 'Kids Hip Hop', 'Adult Hip Hop', 'Couples']);
});

test('a Wix session checks in like a typed class, only on its own date', () => {
  const wixSchedule = fn('wixScheduleRows_')(WIX_SESSIONS, WIX_SERVICES, wixCfg());
  const book = makeBook({ schedule: [], wixSchedule: wixSchedule });
  const res = checkin(book, at('2026-11-09', '18:50'));
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.checkins[0].name, 'Dance 101');
  // Same weekday, a week later: no session in Wix, so nothing is open.
  assert.strictEqual(checkin(makeBook({ schedule: [], wixSchedule: wixSchedule }), at('2026-11-16', '18:50')).status, 'noClass');
});

test('a typed class Wix also has is left to Wix; other typed classes keep working', () => {
  const wixSchedule = fn('wixScheduleRows_')(WIX_SESSIONS, WIX_SERVICES, wixCfg());
  const typed = [
    { ClassID: 'K1', Class: 'dance 101', Days: 'Mon', Start: '7:00 PM', Minutes: 60 },
    { ClassID: 'K2', Class: 'Ballet', Days: 'Mon', Start: '8:00 PM', Minutes: 60 },
  ];
  const on = (day) => fn('todaysClasses_')(fn('classesFrom_')({ schedule: typed, wixSchedule: wixSchedule }, wixCfg()), at(day, '18:50'), wixCfg())
    .map((t) => t.klass.id);
  same(on('2026-11-09'), ['Wc0549875-1900', 'K2']); // Wix's Dance 101 replaces the typed one
  same(on('2026-11-16'), ['K2']);                    // no Dance 101 in Wix that week (e.g. cancelled): none at all
});

test('two sessions of one class on the same day are separate check-ins', () => {
  const two = [
    { title: 'Salsa', serviceId: 'aaaa1111', start: '2026-11-09T17:00:00', end: '2026-11-09T18:00:00', status: 'CONFIRMED', type: 'CLASS' },
    { title: 'Salsa', serviceId: 'aaaa1111', start: '2026-11-09T18:15:00', end: '2026-11-09T19:15:00', status: 'CONFIRMED', type: 'CLASS' },
  ];
  const rows = fn('wixScheduleRows_')(two, {}, wixCfg());
  assert.strictEqual(rows.length, 2);
  assert.notStrictEqual(rows[0].ClassID, rows[1].ClassID);
});

// ------------------------------------------------------------ Wix purchases
const ORDERS = [
  { id: 'o1', planName: 'Single Class', status: 'ACTIVE', payment: 'PAID', start: '2026-10-30', end: '2026-11-29', memberId: 'm1', amount: '25' },
  { id: 'o2', planName: 'Single Class', status: 'DRAFT', payment: '', start: '2026-10-30', end: '', memberId: 'm2' },
  { id: 'o3', planName: 'Adult Monthly', status: 'ACTIVE', payment: 'PAID', start: '2026-10-15', end: '', memberId: 'm2', amount: '90' },
  { id: 'o4', planName: 'Kids Monthly', status: 'ACTIVE', payment: 'PAID', start: '2026-10-15', end: '', memberId: 'm3' },
  { id: 'o5', planName: 'Single Class', status: 'ACTIVE', payment: 'REFUNDED', start: '2026-10-30', end: '', memberId: 'm3' },
  { id: 'o6', planName: 'Adult Monthly', status: 'ENDED', payment: 'PAID', start: '2026-08-01', end: '2026-09-01', memberId: 'm4' },
];
const EMAILS = { m1: 'Jess@Example.com', m2: 'sam@example.com' };
const purchaseRows = (book, emails, cfgRows) => fn('wixPurchaseRows_')(ORDERS, emails == null ? EMAILS : emails, fn('configFrom_')(cfgRows || []), book || {});

test('Wix purchases: passes become credits, other plans count as plans; drafts, refunds and kids are left out', () => {
  const book = makeBook({ students: [{ StudentID: 'S1', Name: 'Jess Lee', Email: 'jess@example.com' }] });
  const rows = purchaseRows(book);
  same(rows.map((r) => [r.OrderID, r.Student, r.Kind, r.Classes, r.Start, r.End, r.Status, r.Amount, r.CheckedInAs]), [
    ['o1', 'jess@example.com', 'package', 1, '2026-10-30', '2026-11-29', 'active', 25, 'Jess Lee'],
    ['o3', 'sam@example.com', 'plan', '', '2026-10-15', '', 'active', 90, ''],
    ['o6', '', 'plan', '', '2026-08-01', '2026-09-01', 'ended', '', ''],
  ]);
});

test('wixPacks names the class passes and how many classes each holds', () => {
  const rows = purchaseRows({}, {}, [{ Key: 'wixPacks', Value: 'Single Class = 1, Adult Monthly = 8' }]);
  same(rows.map((r) => [r.OrderID, r.Kind, r.Classes]), [['o1', 'package', 1], ['o3', 'package', 8], ['o6', 'package', 8]]);
});

test('a Single Class bought on Wix covers a check-in instead of asking for Venmo', () => {
  const book = makeBook({ students: [{ StudentID: 'S1', Name: 'Jess Lee', Email: 'jess@example.com' }] });
  book.wixPurchases = purchaseRows(book);
  const res = checkin(book, at(MON, '18:45'));
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.account.these.package, 1);
  assert.strictEqual(res.account.owed, 0);
  assert.strictEqual(res.account.pay, null);
  // The second class that day is a drop-in: the pass held one class.
  const res2 = checkin(book, at(MON, '19:45'), { classIds: ['K2'] });
  assert.strictEqual(res2.account.owed, 20);
});

test('a monthly plan bought on Wix covers classes while it runs; without the email it matches nobody', () => {
  const sam = { StudentID: 'S2', Name: 'Sam Park', Email: 'sam@example.com' };
  const book = makeBook({ students: [sam] });
  book.wixPurchases = purchaseRows(book);
  const res = checkin(book, at(MON, '18:45'), { email: 'sam@example.com' });
  assert.strictEqual(res.account.these.plan, 1);
  assert.strictEqual(res.account.plan, 'Adult Monthly');
  const noEmails = makeBook({ students: [sam] });
  noEmails.wixPurchases = purchaseRows(noEmails, {});
  assert.strictEqual(checkin(noEmails, at(MON, '18:45'), { email: 'sam@example.com' }).account.owed, 20);
});

// ----------------------------------------------------------- owner check-in
test('the owner can check someone in to any class today, at any time, marked as owner', () => {
  const book = makeBook();
  const io = makeIo();
  const late = at(MON, '23:30'); // Salsa ended at 8pm; far outside the page's window
  assert.strictEqual(checkin(makeBook(), late).status, 'noClass');
  const res = fn('ownerCheckin_')(book, { email: 'new@example.com', name: 'New Person', classIds: ['K1'] }, late, io);
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(book.log[0].Source, 'owner');
  assert.strictEqual(book.log[0].Class, 'Salsa 1');
  // Not a class today → refused. Again → already.
  assert.strictEqual(fn('ownerCheckin_')(book, { email: 'new@example.com', classIds: ['K3'] }, late, io).ok, false);
  assert.strictEqual(fn('ownerCheckin_')(book, { email: 'new@example.com', classIds: ['K1'] }, late, io).status, 'already');
});

test('the web API cannot ask for the owner\'s any-time check-in', () => {
  const res = checkin(makeBook(), at(MON, '23:30'), { classIds: ['K1'], anyTimeToday: true, source: 'owner' });
  assert.strictEqual(res.ok, false);
});

// ------------------------------------------------------------------ test links
const TEST_TAGS = [
  { Code: 'realsigncode', Name: 'Front door', Active: 'yes' },
  { Code: 'testonecodex', Name: 'Test: one', Active: 'yes', Scenario: 'one' },
  { Code: 'testtwocodex', Name: 'Test: two', Active: 'yes', Scenario: 'two' },
  { Code: 'testnonecode', Name: 'Test: none', Active: 'yes', Scenario: 'none' },
  { Code: 'testresetcod', Name: 'Test: reset', Active: 'yes', Scenario: 'reset' },
];
const testBook = (on) => makeBook({ tags: TEST_TAGS, config: [{ Key: 'dropInPrice', Value: '20' }, { Key: 'testScenarios', Value: on ? 'yes' : 'no' }] });
function updIo() { const io = makeIo(); io.updated = []; io.update = (tab, row, f) => io.updated.push([tab, row.CheckinID || row.PaymentID, f]); return io; }

test('a test link pretends its classes are on, at any hour, with real check-ins in the Log', () => {
  const book = testBook(true);
  const res = checkin(book, at('2026-11-03', '10:02'), { code: { t: 'testonecodex' } }); // a Tuesday morning, no real class
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.checkins[0].name, 'Dance 101 (test)');
  assert.strictEqual(res.checkins[0].time, '10:15am');
  assert.strictEqual(book.log[0].ClassID, 'T-one-1');
  assert.strictEqual(book.log[0].Source, 'Test: one');
  assert.strictEqual(res.account.owed, 20);
  assert.strictEqual(checkin(book, at('2026-11-03', '10:02'), { code: { t: 'testtwocodex' } }).status, 'choose');
  const none = checkin(book, at('2026-11-03', '10:02'), { code: { t: 'testnonecode' } });
  assert.strictEqual(none.status, 'noClass');
  assert.strictEqual(none.next.day, '2026-11-04');
});

test('test links: "two" mixes a free class with a drop-in, "series" is two drop-ins', () => {
  const book = makeBook({ tags: TEST_TAGS.concat([{ Code: 'testseriesxx', Name: 'Test: series', Active: 'yes', Scenario: 'series' }]),
    config: [{ Key: 'dropInPrice', Value: '20' }, { Key: 'testScenarios', Value: 'yes' }, { Key: 'venmoHandle', Value: 'studio' }] });
  const two = checkin(book, at('2026-11-03', '10:02'), { code: { t: 'testtwocodex' }, classIds: ['T-two-1', 'T-two-2'] });
  same(two.checkins.map((c) => two.account.items.filter((i) => i.id === c.checkinId)[0].covered), ['free', 'dropin']);
  assert.strictEqual(two.account.due, 20);
  const series = checkin(book, at('2026-11-03', '10:02'), { code: { t: 'testseriesxx' }, classIds: ['T-series-1', 'T-series-2'] });
  same(series.checkins.map((c) => c.name), ['Dance 101 (test)', 'Adult Hip Hop (test)']);
  assert.strictEqual(series.account.these.dropin, 2);
  assert.strictEqual(series.account.due, 40);
});

test('the "regular" test link shows the usual case: covered by a monthly plan, nothing to pay', () => {
  const book = makeBook({ tags: TEST_TAGS.concat([{ Code: 'testregularx', Name: 'Test: regular', Active: 'yes', Scenario: 'regular' }]),
    config: [{ Key: 'dropInPrice', Value: '20' }, { Key: 'testScenarios', Value: 'yes' }, { Key: 'venmoHandle', Value: 'studio' }] });
  const res = checkin(book, at('2026-11-03', '10:02'), { code: { t: 'testregularx' } });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.checkins[0].name, 'Adult Hip Hop (test)');
  assert.strictEqual(res.account.these.plan, 1);
  assert.strictEqual(res.account.plan, 'Adult Monthly (test)');
  assert.strictEqual(res.account.due, 0);
  assert.strictEqual(res.account.pay, null);
  // The other test links are still drop-ins for the same person.
  assert.strictEqual(checkin(book, at('2026-11-03', '10:03'), { code: { t: 'testonecodex' } }).account.due, 20);
});

test('late at night and just after midnight, every test link still shows its situation', () => {
  const tags = ['two', 'early', 'late', 'series'].map((s) => ({ Code: 'test' + s + 'codex'.slice(0, 8 - s.length), Name: 'Test: ' + s, Active: 'yes', Scenario: s }));
  const run = (s, hhmm) => {
    const book = makeBook({ tags, config: [{ Key: 'dropInPrice', Value: '20' }, { Key: 'testScenarios', Value: 'yes' }] });
    const code = tags.find((t) => t.Scenario === s).Code;
    return { book, res: checkin(book, at('2026-11-07', hhmm), { code: { t: code } }) };
  };
  for (const hhmm of ['22:51', '23:55', '00:20']) {
    const two = run('two', hhmm).res;
    assert.strictEqual(two.status, 'choose', 'two at ' + hhmm);
    assert.notStrictEqual(two.options[0].time, two.options[1].time);
    const early = run('early', hhmm).res;
    assert.strictEqual(early.status, 'noClass', 'early at ' + hhmm);
    assert.strictEqual(early.testClock, undefined); // nothing test-specific on the page
    const late = run('late', hhmm);
    assert.strictEqual(late.res.status, 'ok', 'late at ' + hhmm);
    assert.strictEqual(late.book.log[0].ClassDate, '2026-11-07'); // the real day
    assert.strictEqual(run('series', hhmm).res.status, 'ok', 'series at ' + hhmm);
  }
});

test('opening a test link starts its situation fresh, for that tester and that link only', () => {
  const tags = [
    { Code: 'realsigncode', Name: 'Front door', Active: 'yes' },
    { Code: 'testearlycod', Name: 'Test: early', Active: 'yes', Scenario: 'early' },
    { Code: 'testtwocodex', Name: 'Test: two', Active: 'yes', Scenario: 'two' },
    { Code: 'testnonecode', Name: 'Test: none', Active: 'yes', Scenario: 'none' },
  ];
  const book = makeBook({ tags, config: [{ Key: 'dropInPrice', Value: '20' }, { Key: 'testScenarios', Value: 'yes' }, { Key: 'venmoHandle', Value: 'studio' }] });
  const io = updIo();
  const go = (t, extra, email) => fn('handleRequest_')(book, Object.assign({ action: 'checkin', email: email || 'jess@example.com', name: email ? 'Sam' : 'jess', code: { t } }, extra || {}), at('2026-11-07', '14:00'), io);
  // Check in early, then open the early link again: it's "You're early" again, not "all set".
  const first = go('testearlycod');
  assert.strictEqual(first.status, 'noClass');
  assert.strictEqual(go('testearlycod', { classIds: [first.later[0].id] }).status, 'ok');
  const again = go('testearlycod');
  assert.strictEqual(again.status, 'noClass');
  assert.strictEqual(again.next.done, false);
  // Two at once: picking both, then reopening, asks again; the payment declared for them is voided too.
  assert.strictEqual(go('testtwocodex').status, 'choose');
  const both = go('testtwocodex', { classIds: ['T-two-1', 'T-two-2'] });
  assert.strictEqual(both.status, 'ok');
  fn('handleRequest_')(book, { action: 'declarePayment', email: 'jess@example.com', amount: 20, checkinIds: both.checkins.map((c) => c.checkinId) }, at('2026-11-07', '14:01'), io);
  assert.strictEqual(book.payments.filter((p) => p.Status === 'declared').length, 1);
  assert.strictEqual(go('testtwocodex').status, 'choose');
  assert.strictEqual(book.payments.filter((p) => p.Status === 'declared').length, 0);
  // "Here for a class" on the no-class link: reopening lets you do it again.
  assert.strictEqual(go('testnonecode', { unscheduled: true, note: 'x' }).already, false);
  go('testnonecode');
  assert.strictEqual(go('testnonecode', { unscheduled: true, note: 'x' }).already, false);
  // Never another link's rows, another tester's, or real ones.
  go('testearlycod', { classIds: ['T-early-1'] }, 'sam@example.com');
  book.log.push({ CheckinID: 'REAL1', ClassDate: '2026-11-07', StudentID: book.students[0].StudentID, ClassID: 'K1', Class: 'Salsa', Price: 20, Status: 'ok', Source: 'Front door' });
  go('testearlycod');
  const live = (pred) => book.log.filter((l) => l.Status !== 'void' && pred(l)).length;
  assert.strictEqual(live((l) => l.CheckinID === 'REAL1'), 1);
  assert.strictEqual(live((l) => l.ClassID === 'T-early-1' && l.Student !== 'jess'), 1); // Sam's
});

test('test links do nothing unless testScenarios is yes; the real sign still works', () => {
  const book = testBook(false);
  assert.strictEqual(checkin(book, at(MON, '18:55'), { code: { t: 'testonecodex' } }).status, 'needTag');
  assert.strictEqual(checkin(book, at(MON, '18:55'), { code: { t: 'testresetcod' } }).status, 'needTag');
  assert.strictEqual(checkin(book, at(MON, '18:55'), { code: { t: 'realsigncode' } }).status, 'ok');
});

test('"Start over" voids only that tester\'s test check-ins and today\'s declared payments', () => {
  const book = testBook(true);
  checkin(book, at(MON, '18:55'), { code: { t: 'realsigncode' } });                                              // Jess, real
  checkin(book, at(MON, '18:56'), { code: { t: 'testonecodex' } });                                              // Jess, test
  checkin(book, at(MON, '18:57'), { code: { t: 'testnonecode' }, unscheduled: true, note: 'x' });                // Jess, test (unscheduled)
  checkin(book, at(MON, '18:58'), { code: { t: 'testonecodex' }, email: 'sam@example.com', name: 'Sam Park' }); // Sam, test
  fn('handleRequest_')(book, { action: 'declarePayment', email: 'jess@example.com', amount: 20 }, at(MON, '19:00'), makeIo());
  const io = updIo();
  const res = fn('handleRequest_')(book, { action: 'checkin', email: 'jess@example.com', code: { t: 'testresetcod' } }, at(MON, '19:05'), io);
  assert.strictEqual(res.status, 'reset');
  assert.strictEqual(res.cleared, 2);
  same(book.log.map((l) => [l.Student, l.ClassID, l.Status]), [
    ['Jess Lee', 'K1', 'ok'], ['Jess Lee', 'T-one-1', 'void'], ['Jess Lee', '', 'void'], ['Sam Park', 'T-one-1', 'ok'],
  ]);
  assert.strictEqual(book.payments[0].Status, 'void');
  assert.strictEqual(io.updated.length, 3);
  // After the reset the same test link checks in afresh.
  assert.strictEqual(checkin(book, at(MON, '19:06'), { code: { t: 'testonecodex' } }).status, 'ok');
  // An unknown email resets nothing and isn't made a student.
  const n = book.students.length;
  assert.strictEqual(fn('handleRequest_')(book, { action: 'checkin', email: 'new@example.com', code: { t: 'testresetcod' } }, at(MON, '19:07'), updIo()).cleared, 0);
  assert.strictEqual(book.students.length, n);
});

// ------------------------------------------------------------------ Today tab
test('Today lists every class today with who came and how it was covered', () => {
  const book = makeBook({ packages: [{ PackageID: 'PK1', Student: 'sam@example.com', Classes: 5, Purchased: '2026-10-01' }] });
  checkin(book, at(MON, '18:45'));                                                   // Jess: drop-in
  checkin(book, at(MON, '18:46'), { email: 'sam@example.com', name: 'Sam Park' }); // Sam: class pass
  checkin(book, at(MON, '19:50'), { email: 'ana@example.com', name: 'Ana Ruiz', classIds: ['K2'] });
  checkin(book, at(MON, '21:50'), { email: 'lee@example.com', name: 'Lee Kim', unscheduled: true, note: 'private lesson' });
  const rows = fn('todayRows_')(book, at(MON, '22:00'));
  const text = JSON.parse(JSON.stringify(rows)).filter((r) => r.length > 1);
  same(text, [
    ['7:00pm · Salsa 1', '2 checked in', ''],
    ['Jess Lee', 'drop-in $20', 'owes $20'],
    ['Sam Park', 'class pass', ''],
    ['8:00pm · Bachata 2', '1 checked in', ''],
    ['Ana Ruiz', 'drop-in $20', 'owes $20'],
    ["Here for a class that isn't on the schedule", '1 so far', ''],
    ['Lee Kim', 'private lesson', ''],
  ]);
  assert.ok(/^Today, Mon Nov 2 — updated 10:00pm/.test(rows[0][0]));
});

test('Today on a day with no classes says so', () => {
  const rows = fn('todayRows_')(makeBook(), at('2026-11-03', '12:00'));
  assert.strictEqual(rows[rows.length - 1][0], 'No classes today.');
});

// ---------------------------------------------------------------- owner page
const OWNER_KEY = 'ownerkeyownerkeyownerkey';
function ownerIo(key) {
  const io = updIo();
  io.appended = [];
  io.append = (tab, row) => io.appended.push([tab, row]);
  io.ownerKey = () => key === undefined ? OWNER_KEY : key;
  return io;
}
function owner(book, req, now, io) {
  return fn('handleRequest_')(book, Object.assign({ action: 'owner', key: OWNER_KEY }, req), now || at(MON, '19:10'), io || ownerIo());
}
// A Monday with Jess checked in to Salsa 1 as a drop-in, and Sam here for a class not on the schedule.
function ownerBook() {
  const book = makeBook();
  checkin(book, at(MON, '18:50'), { classIds: ['K1'] });
  checkin(book, at(MON, '18:51'), { email: 'sam@example.com', name: 'Sam Park', unscheduled: true, note: 'Tango makeup' });
  return book;
}
const jessId = (book) => book.students.find((s) => s.Email === 'jess@example.com').StudentID;

test('owner page: nothing without the right key, and no key set means nobody gets in', () => {
  const book = ownerBook();
  for (const [key, real] of [['', OWNER_KEY], ['wrong-key-wrong-key-wron', OWNER_KEY], [OWNER_KEY.slice(0, 10), OWNER_KEY], ['', ''], ['short', 'short']]) {
    const res = fn('handleRequest_')(book, { action: 'owner', key, op: 'students' }, at(MON, '19:10'), ownerIo(real));
    assert.strictEqual(res.status, 'needKey', JSON.stringify([key, real]));
    assert.strictEqual(res.students, undefined);
  }
  // The check-in API can't ask for owner powers either: it's an ordinary check-in, not the owner's.
  checkin(book, at(MON, '19:00'), { classIds: ['K2'], source: 'owner', anyTimeToday: true });
  assert.notStrictEqual(book.log.find((l) => l.ClassID === 'K2').Source, 'owner');
});

test('owner page: today shows who is in, how each is covered, and what needs sorting out', () => {
  const res = owner(ownerBook(), { op: 'today' });
  assert.strictEqual(res.ok, true);
  same(res.classes.map((c) => [c.name, c.people.map((p) => [p.name, p.how, p.owes])]),
    [['Salsa 1', [['Jess Lee', 'drop-in $20', '$20']]], ['Bachata 2', []]]);
  same(res.extras.map((x) => [x.name, x.note, x.dayLabel, x.classes.map((c) => c.id)]), [['Sam Park', 'Tango makeup', 'Today', ['K1', 'K2']]]);
});

test('owner page: a monthly plan covers check-ins from its start date, and replaces an older plan', () => {
  const book = ownerBook();
  const io = ownerIo();
  const res = owner(book, { op: 'startPlan', studentId: jessId(book), plan: 'Monthly, 1 class a week', start: '2026-11-01' }, null, io);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.wrote, true);
  same(io.appended.map(([t, r]) => [t, r.Student, r.Plan, r.Start, r.End]), [['Plans', 'jess@example.com', 'Monthly, 1 class a week', '2026-11-01', '']]);
  // Today's check-in is now covered, with nothing owed.
  same(owner(book, { op: 'today' }).classes[0].people.map((p) => [p.name, p.how, p.owes]), [['Jess Lee', 'plan', '']]);
  // Moving to 2 classes a week from the 15th ends the first plan on the 14th.
  const io2 = ownerIo();
  owner(book, { op: 'startPlan', studentId: jessId(book), plan: 'Monthly, 2 classes a week', start: '2026-11-15' }, null, io2);
  same(io2.updated.map(([t, , f]) => [t, f]), [['Plans', { End: '2026-11-14' }]]);
  const jess = owner(book, { op: 'students' }).students.find((s) => s.name === 'Jess Lee');
  same(jess.plans.map((p) => [p.plan, p.start, p.future]), [['Monthly, 1 class a week', '2026-11-01', false], ['Monthly, 2 classes a week', '2026-11-15', true]]);
  // Only the listed plans, and real dates.
  assert.strictEqual(owner(book, { op: 'startPlan', studentId: jessId(book), plan: 'Free forever' }).ok, false);
  assert.strictEqual(owner(book, { op: 'startPlan', studentId: jessId(book), plan: 'Monthly, 1 class a week', start: '2026-02-30' }).ok, false);
});

test('owner page: ending a plan today keeps today covered; ending one not started yet removes it', () => {
  const book = ownerBook();
  owner(book, { op: 'startPlan', studentId: jessId(book), plan: 'Monthly, 1 class a week', start: '2026-10-01' });
  const id = owner(book, { op: 'students' }).students.find((s) => s.name === 'Jess Lee').plans[0].id;
  const res = owner(book, { op: 'endPlan', planId: id });
  assert.ok(res.done.includes('ends Mon Nov 2'), res.done);
  same(owner(book, { op: 'today' }).classes[0].people[0].how, 'plan');
  assert.strictEqual(owner(book, { op: 'students' }).students.find((s) => s.name === 'Jess Lee').plans.length, 1); // still runs today
  owner(book, { op: 'startPlan', studentId: jessId(book), plan: 'Monthly, 2 classes a week', start: '2026-12-01' });
  const later = owner(book, { op: 'students' }).students.find((s) => s.name === 'Jess Lee').plans.find((p) => p.future);
  assert.ok(owner(book, { op: 'endPlan', planId: later.id }).done.includes('is removed'));
});

test('owner page: a class pass is a Packages row with no price, and it covers the next classes', () => {
  const book = ownerBook();
  const io = ownerIo();
  const res = owner(book, { op: 'addPass', studentId: jessId(book), classes: 10, expires: '2027-02-01' }, null, io);
  same(io.appended.map(([t, r]) => [t, r.Student, r.Classes, r.Purchased, r.Expires, r.Amount]), [['Packages', 'jess@example.com', 10, MON, '2027-02-01', '']]);
  same(res.students.find((s) => s.name === 'Jess Lee').credits, 9); // today's class used one
  assert.strictEqual(owner(book, { op: 'addPass', studentId: jessId(book), classes: 0 }).ok, false);
});

test('owner page: an "I\'m here for a class" visit is matched to a class, or removed', () => {
  const book = ownerBook();
  const sam = owner(book, { op: 'today' }).extras[0];
  const io = ownerIo();
  const res = owner(book, { op: 'sortOut', checkinId: sam.id, classId: 'K2' }, null, io);
  same(io.updated.map(([t, , f]) => [t, f]), [['Log', { ClassID: 'K2', Class: 'Bachata 2', Status: 'ok', Note: 'Tango makeup · matched by Owner Mon Nov 2' }]]);
  same(res.extras, []);
  same(res.classes[1].people.map((p) => [p.name, p.how]), [['Sam Park', 'drop-in $20']]);
  // Typed name, for a class not on that day's schedule; and removal.
  const b2 = ownerBook();
  const id2 = owner(b2, { op: 'today' }).extras[0].id;
  assert.strictEqual(owner(b2, { op: 'sortOut', checkinId: id2, className: '  Tango  ' }).done, 'Sam Park is checked in to Tango.');
  const b3 = ownerBook();
  const id3 = owner(b3, { op: 'today' }).extras[0].id;
  owner(b3, { op: 'sortOut', checkinId: id3, remove: true });
  assert.strictEqual(b3.log.find((l) => l.CheckinID === id3).Status, 'void');
  assert.strictEqual(owner(b3, { op: 'sortOut', checkinId: id3, remove: true }).ok, false); // already done
});

test('owner page: matching to a class they already checked in to is refused', () => {
  const book = ownerBook();
  checkin(book, at(MON, '18:52'), { email: 'sam@example.com', classIds: ['K1'] });
  const id = owner(book, { op: 'today' }).extras[0].id;
  const res = owner(book, { op: 'sortOut', checkinId: id, classId: 'K1' });
  assert.strictEqual(res.ok, false);
  assert.ok(/already checked in/.test(res.error));
});

test('owner page: check someone in to any class today, by student or as someone new', () => {
  const book = ownerBook();
  const res = owner(book, { op: 'checkin', studentId: jessId(book), classIds: ['K2'] }, at(MON, '12:00'));
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.done, 'Jess Lee: Bachata 2.');
  assert.strictEqual(book.log.filter((l) => l.ClassID === 'K2')[0].Source, 'owner');
  const fresh = owner(book, { op: 'checkin', email: 'new@example.com', name: 'Nia Lowe', classIds: ['K1'] }, at(MON, '12:00'));
  assert.strictEqual(fresh.done, 'Nia Lowe: Salsa 1.');
  assert.strictEqual(owner(book, { op: 'checkin', email: 'x@example.com', classIds: ['K1'] }).ok, false); // new needs a name
});

test('owner page: the attendance checklist lists a class\'s usual students first, and checks in several at once', () => {
  const book = makeBook();
  const WED = '2026-10-28', MON2 = '2026-10-26';
  // Salsa 1 regulars: Ana twice, Ben once; Cy only ever came to Bachata.
  checkin(book, at(MON2, '18:50'), { email: 'ana@example.com', name: 'Ana Ruiz', classIds: ['K1'] });
  checkin(book, at(WED, '18:50'), { email: 'ana@example.com', classIds: ['K1'] });
  checkin(book, at(WED, '18:51'), { email: 'ben@example.com', name: 'Ben Cho', classIds: ['K1'] });
  checkin(book, at(MON2, '19:50'), { email: 'cy@example.com', name: 'Cy Moss', classIds: ['K2'] });
  const id = (e) => book.students.find((s) => s.Email === e).StudentID;
  const today = owner(book, { op: 'today' }, at(MON, '18:30'));
  same(today.classes.find((c) => c.id === 'K1').usual, [id('ana@example.com'), id('ben@example.com')]);
  same(today.classes.find((c) => c.id === 'K2').usual, [id('cy@example.com')]);
  // Ben taps in himself; then the owner ticks Ana and Ben.
  checkin(book, at(MON, '18:50'), { email: 'ben@example.com', classIds: ['K1'] });
  const res = owner(book, { op: 'checkinMany', classId: 'K1', studentIds: [id('ana@example.com'), id('ben@example.com')] }, at(MON, '19:05'));
  assert.strictEqual(res.done, 'Checked in 1: Ana. Already in: Ben.');
  assert.strictEqual(res.wrote, true);
  same(res.classes.find((c) => c.id === 'K1').people.map((p) => p.name).sort(), ['Ana Ruiz', 'Ben Cho']);
  assert.strictEqual(book.log.filter((l) => l.ClassDate === MON && l.Student === 'Ana Ruiz')[0].Source, 'owner');
  // Only a class on today's schedule, and only known students.
  assert.strictEqual(owner(book, { op: 'checkinMany', classId: 'K3', studentIds: [id('cy@example.com')] }, at(MON, '19:05')).ok, false);
  assert.strictEqual(owner(book, { op: 'checkinMany', classId: 'K1', studentIds: ['nobody'] }, at(MON, '19:05')).done, 'Nobody new to check in.');
  // "Someone new?" on the same list: typed in alongside the ticks, checked before anyone is written.
  const rows = book.log.length;
  assert.strictEqual(owner(book, { op: 'checkinMany', classId: 'K2', studentIds: [id('cy@example.com')], email: 'dee@example' }, at(MON, '19:05')).error, 'That email doesn\'t look right.');
  assert.strictEqual(owner(book, { op: 'checkinMany', classId: 'K2', studentIds: [id('cy@example.com')], email: 'dee@example.com' }, at(MON, '19:05')).error, 'They\'re new: add their name too.');
  assert.strictEqual(book.log.length, rows);
  const both = owner(book, { op: 'checkinMany', classId: 'K2', studentIds: [id('cy@example.com')], email: 'Dee@Example.com', name: 'Dee Lane' }, at(MON, '19:05'));
  assert.strictEqual(both.done, 'Checked in 2: Dee, Cy.');
  assert.strictEqual(book.students.find((s) => s.Email === 'dee@example.com').Name, 'Dee Lane');
  // A typed email that's already a student just checks them in; no name needed.
  assert.strictEqual(owner(book, { op: 'checkinMany', classId: 'K1', email: 'cy@example.com' }, at(MON, '19:05')).done, 'Checked in 1: Cy.');
});

test('owner page: Remove undoes one of today\'s check-ins, and only today\'s', () => {
  const book = ownerBook();
  checkin(book, at('2026-10-28', '18:50'), { classIds: ['K1'] }); // Jess, last Wednesday
  const jess = owner(book, { op: 'today' }).classes[0].people[0];
  const io = ownerIo();
  const res = owner(book, { op: 'undo', checkinId: jess.checkinId }, null, io);
  same(io.updated.map(([t, , f]) => [t, f]), [['Log', { Status: 'void', Note: 'removed by Owner 7:10pm' }]]);
  assert.strictEqual(res.done, 'Jess Lee is no longer checked in to Salsa 1.');
  same(res.classes[0].people, []);
  assert.strictEqual(owner(book, { op: 'undo', checkinId: jess.checkinId }).ok, false); // already removed
  const old = book.log.find((l) => l.ClassDate === '2026-10-28').CheckinID;
  assert.strictEqual(owner(book, { op: 'undo', checkinId: old }).ok, false); // not today's
});

test('owner page: each link has a name, and the Log says who checked someone in', () => {
  const book = ownerBook();
  const keys = { Caress: 'caresskeycaresskeycaress', Rob: 'robkeyrobkeyrobkeyrobkey' };
  const io = () => { const x = ownerIo(); delete x.ownerKey; x.ownerKeys = () => keys; return x; };
  const as = (key, req, now) => fn('handleRequest_')(book, Object.assign({ action: 'owner', key }, req), now || at(MON, '19:10'), io());
  // Sam taps in himself: By stays blank.
  checkin(book, at(MON, '18:55'), { email: 'sam@example.com', classIds: ['K1'] });
  // Rob checks Jess into Bachata from his own link; Caress removes Sam.
  as(keys.Rob, { op: 'checkin', studentId: jessId(book), classIds: ['K2'] });
  const sam = as(keys.Caress, { op: 'today' }).classes[0].people.find((p) => p.name === 'Sam Park');
  as(keys.Caress, { op: 'undo', checkinId: sam.checkinId });
  const row = (cls, who) => book.log.find((l) => l.ClassID === cls && l.Student === who);
  assert.strictEqual(row('K1', 'Jess Lee').By, '');          // tapped in herself (ownerBook)
  assert.strictEqual(row('K2', 'Jess Lee').By, 'Rob');
  assert.strictEqual(row('K1', 'Sam Park').Note, 'removed by Caress 7:10pm');
  same(as(keys.Caress, { op: 'today' }).classes[1].people.map((p) => [p.name, p.by]), [['Jess Lee', 'Rob']]);
  // Plans and passes say whose link made them; a key not in the list gets nothing.
  as(keys.Caress, { op: 'addPass', studentId: jessId(book), classes: 5 });
  assert.strictEqual(book.packages[0].Note, 'Owner page (Caress)');
  assert.strictEqual(as('nobodykeynobodykeynobody', { op: 'today' }).status, 'needKey');
  // The Sheet menu passes the user's email the same way.
  fn('ownerCheckin_')(book, { email: 'sam@example.com', classIds: ['K2'] }, at(MON, '19:20'), makeIo(), 'rob@example.com');
  assert.strictEqual(row('K2', 'Sam Park').By, 'rob@example.com');
});

test('studio page: a teacher link does check-ins only, and an admin makes and turns off teacher links', () => {
  const book = ownerBook();
  const admins = { Caress: 'caresskeycaresskeycaress' };
  let teachers = {};
  let n = 0;
  const io = () => {
    const x = ownerIo(); delete x.ownerKey;
    x.ownerKeys = () => admins;
    x.teacherKeys = () => JSON.parse(JSON.stringify(teachers));
    x.saveTeacherKeys = (k) => { teachers = k; };
    x.newKey = () => 'teacherkey' + String(++n).padStart(14, 'x');
    return x;
  };
  const as = (key, req) => fn('handleRequest_')(book, Object.assign({ action: 'owner', key }, req), at(MON, '19:10'), io());
  // Caress makes Dee's link; the key comes back once, the team list never shows keys.
  const made = as(admins.Caress, { op: 'addTeacher', name: '  Dee   Ray ' });
  assert.strictEqual(made.ok, true);
  assert.strictEqual(made.name, 'Dee Ray');
  same([made.admins, made.teachers, made.role, made.who], [['Caress'], ['Dee Ray'], 'admin', 'Caress']);
  const dee = made.newKey;
  assert.strictEqual(teachers['Dee Ray'], dee);
  assert.strictEqual(JSON.stringify(as(admins.Caress, { op: 'team' })).indexOf(dee), -1);
  // Names: taken, an admin's, or not starting with a letter (it would be a formula in the Sheet).
  assert.strictEqual(as(admins.Caress, { op: 'addTeacher', name: 'dee ray' }).ok, false);
  assert.strictEqual(as(admins.Caress, { op: 'addTeacher', name: 'caress' }).ok, false);
  assert.strictEqual(as(admins.Caress, { op: 'addTeacher', name: '=HYPERLINK(1)' }).ok, false);
  // Dee sees who's in, but not how they paid, what they owe, emails, plans or visits to sort out.
  const today = as(dee, { op: 'today' });
  same([today.ok, today.role, today.who], [true, 'teacher', 'Dee Ray']);
  same(today.classes[0].people.map((p) => [p.name, p.how, p.owes]), [['Jess Lee', '', '']]);
  same(today.extras, []);
  const list = as(dee, { op: 'students' });
  assert.ok(list.students.length);
  list.students.forEach((s) => same(Object.keys(s).sort(), ['id', 'name']));
  // She can take attendance and remove a check-in; the Log says it was her.
  const sam = book.students.find((s) => s.Email === 'sam@example.com').StudentID;
  assert.strictEqual(as(dee, { op: 'checkinMany', classId: 'K2', studentIds: [sam] }).ok, true);
  const row = book.log.find((l) => l.ClassID === 'K2' && l.Student === 'Sam Park');
  assert.strictEqual(row.By, 'Dee Ray');
  assert.strictEqual(as(dee, { op: 'undo', checkinId: row.CheckinID }).ok, true);
  // Nothing else, and the server refuses it whatever the page shows.
  for (const op of ['startPlan', 'endPlan', 'addPass', 'sortOut', 'team', 'addTeacher', 'removeTeacher']) {
    const res = as(dee, { op, studentId: jessId(book), plan: 'Monthly, 1 class a week', classes: 5, name: 'Dee Ray', remove: true });
    assert.strictEqual(res.ok, false, op);
    assert.strictEqual(res.error, 'Only an admin can do that.', op);
  }
  same([(book.plans || []).length, (book.packages || []).length, Object.keys(teachers)], [0, 0, ['Dee Ray']]);
  // Show link gives the same link again (it keeps working); a new link replaces the old one; turning it off stops it.
  const shown = as(admins.Caress, { op: 'showTeacherLink', name: 'Dee Ray' });
  same([shown.ok, shown.newKey], [true, dee]);
  assert.strictEqual(as(dee, { op: 'showTeacherLink', name: 'Dee Ray' }).error, 'Only an admin can do that.');
  assert.strictEqual(as(dee, { op: 'today' }).role, 'teacher');
  const again = as(admins.Caress, { op: 'addTeacher', name: 'Dee Ray', replace: true });
  assert.notStrictEqual(again.newKey, dee);
  assert.strictEqual(as(dee, { op: 'today' }).status, 'needKey');
  assert.strictEqual(as(again.newKey, { op: 'today' }).role, 'teacher');
  same(as(admins.Caress, { op: 'removeTeacher', name: 'Dee Ray' }).teachers, []);
  assert.strictEqual(as(again.newKey, { op: 'today' }).status, 'needKey');
  assert.strictEqual(as(admins.Caress, { op: 'removeTeacher', name: 'Dee Ray' }).ok, false);
});

// The page's own scripts aren't run here, but a syntax error in one blanks the live page.
test('the check-in page scripts parse', () => {
  for (const f of ['web/app.js', 'web/owner.js', 'web/mock.js', 'web/config.js', 'apps-script/Code.gs', 'apps-script/Wix.gs']) {
    new vm.Script(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
  }
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
