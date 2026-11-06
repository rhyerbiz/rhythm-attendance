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
  res = checkin(makeBook(), at(MON, '22:45'));
  assert.strictEqual(res.next.name, 'Salsa 1');
  assert.strictEqual(res.next.day, '2026-11-04');
  assert.strictEqual(res.later.length, 0);
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
  assert.strictEqual(res.student.name, 'Jess Lee');
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
  assert.strictEqual(back.student.name, 'Jess Lee');
});

test('code source is recorded', () => {
  const src = fn('codeSource_');
  assert.strictEqual(src({ t: 'static' }), 'static');
  assert.strictEqual(src({}), 'direct');
  assert.strictEqual(src(null), 'direct');
  assert.strictEqual(src({ t: '59441023', s: 'abc' }), 'unverified');
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

test('owed adds up across several unpaid drop-ins', () => {
  const book = makeBook();
  checkin(book, at(MON, '18:55'));
  const res = checkin(book, at('2026-11-04', '18:55'));
  assert.strictEqual(res.account.owed, 40);
  assert.ok(decodeURIComponent(res.account.pay.url).includes('class drop-ins'));
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

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
