// Preview-mode backend: the real rules from Logic.gs, run in the browser
// against a fake studio kept in localStorage. Lets the page be clicked
// through with no Google account. Loaded only when config.apiUrl is blank
// or the URL has ?mock — the deployed page never touches it.
window.MockBackend = (function () {
  'use strict';
  var KEY = 'rhythm.mockBook';
  var memory = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowParts() {
    var d = new Date();
    var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return { date: date, minutes: d.getHours() * 60 + d.getMinutes(), stamp: date + ' ' + hm + ':' + pad(d.getSeconds()) };
  }
  function hhmm(min) { min = Math.max(0, Math.min(1439, min)); return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  // Classes are placed relative to the current time so every scenario works whenever you open it.
  function scheduleFor(scenario) {
    var now = nowParts();
    var today = DAY_LABELS[dowOf_(now.date)];
    var tomorrow = DAY_LABELS[dowOf_(addDays_(now.date, 1))];
    var base = Math.ceil(now.minutes / 5) * 5;
    var rows = [];
    if (scenario === 'one') rows.push({ ClassID: 'K1', Class: 'Dance 101', Days: today, Start: hhmm(base + 10), Minutes: 60 });
    if (scenario === 'two') {
      rows.push({ ClassID: 'K3', Class: 'Company Practice', Days: today, Start: hhmm(base + 10), Minutes: 60, Price: 0 });
      rows.push({ ClassID: 'K1', Class: 'Dance 101', Days: today, Start: hhmm(base + 25), Minutes: 60 });
    }
    if (scenario === 'series') {
      rows.push({ ClassID: 'K1', Class: 'Dance 101', Days: today, Start: hhmm(base + 10), Minutes: 60 });
      rows.push({ ClassID: 'K5', Class: 'Adult Hip Hop', Days: today, Start: hhmm(base + 70), Minutes: 75 });
    }
    // Ended 40 minutes ago: someone who forgot, checking in on the way out.
    if (scenario === 'late') rows.push({ ClassID: 'K1', Class: 'Dance 101', Days: today, Start: hhmm(base - 100), Minutes: 60 });
    // Here two hours early: nothing open yet, but the class can already be picked.
    if (scenario === 'early') rows.push({ ClassID: 'K5', Class: 'Adult Hip Hop', Days: today, Start: hhmm(base + 120), Minutes: 75 });
    if (scenario === 'free') rows.push({ ClassID: 'K3', Class: 'Company Practice', Days: today, Start: hhmm(base + 5), Minutes: 60, Price: 0 });
    rows.push({ ClassID: 'K4', Class: 'Adult Hip Hop', Days: tomorrow, Start: '19:15', Minutes: 75 });
    return rows;
  }

  function fresh(scenario, keep) {
    return {
      scenario: scenario,
      config: [
        { Key: 'studioName', Value: (window.CHECKIN_CONFIG || {}).studioName || 'Your Studio' },
        { Key: 'venmoHandle', Value: 'your-studio' },
        { Key: 'dropInPrice', Value: 20 },
      ],
      schedule: scheduleFor(scenario),
      students: keep ? keep.students : [],
      log: keep ? keep.log : [],
      packages: keep ? keep.packages : [],
      plans: keep ? keep.plans || [] : [],
      payments: keep ? keep.payments : [],
    };
  }

  function load() {
    try { var s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* fall through */ }
    return memory || fresh('one');
  }
  function save(book) {
    memory = book;
    try { localStorage.setItem(KEY, JSON.stringify(book)); } catch (e) { /* memory only */ }
  }

  function handle(req) {
    var book = load();
    book.schedule = scheduleFor(book.scenario); // keep "starting soon" true as time passes
    if (!book.config.some(function (r) { return r.Key === 'chatLink'; })) {
      book.config.push({ Key: 'chatLink', Value: 'https://t.me/+preview-only-not-a-real-group' });
    }
    var io = {
      newId: function (p) { return p + Math.random().toString(36).slice(2, 10); },
      append: function () { /* rows are already in book */ },
      update: function () { /* the row in book was already changed */ },
      ownerKey: function () { return 'previewownerkeypreviewowner'; }, // owner.js uses the same in preview
    };
    var res = handleRequest_(book, JSON.parse(JSON.stringify(req)), nowParts(), io);
    save(book);
    return new Promise(function (resolve) { setTimeout(function () { resolve(JSON.parse(JSON.stringify(res))); }, 450); });
  }

  function me() {
    try { return JSON.parse(localStorage.getItem('rhythm.student') || 'null'); } catch (e) { return null; }
  }

  function toolbar() {
    var book = load();
    var bar = document.createElement('div');
    bar.className = 'mockbar';
    bar.innerHTML =
      '<b>Preview</b>' +
      '<select id="mk-scn" aria-label="Scenario">' +
        '<option value="one">One class starting</option>' +
        '<option value="two">Two classes starting</option>' +
        '<option value="series">Two in a row</option>' +
        '<option value="late">Forgot — class just ended</option>' +
        '<option value="early">Early for a class later today</option>' +
        '<option value="free">Free class starting</option>' +
        '<option value="none">No class now</option>' +
      '</select>' +
      '<button id="mk-pack">+10-class pack</button>' +
      '<button id="mk-plan">+Monthly plan</button>' +
      '<button id="mk-forget">Forget me</button>' +
      '<button id="mk-reset">Reset</button>';
    document.body.appendChild(bar);
    document.body.classList.add('mock');
    var sel = bar.querySelector('#mk-scn');
    sel.value = book.scenario;
    sel.addEventListener('change', function () { save(fresh(sel.value, load())); location.reload(); });
    bar.querySelector('#mk-pack').addEventListener('click', function () {
      var who = me();
      if (!who) return alert('Check in once first, so the pack has someone to belong to.');
      var b = load();
      b.packages.push({ PackageID: 'PK' + (b.packages.length + 1), Student: who.email, Classes: 10, Purchased: addDays_(nowParts().date, -1) });
      save(b);
      location.reload();
    });
    bar.querySelector('#mk-plan').addEventListener('click', function () {
      var who = me();
      if (!who) return alert('Check in once first, so the plan has someone to belong to.');
      var b = load();
      b.plans = b.plans || [];
      b.plans.push({ PlanID: 'PL' + (b.plans.length + 1), Student: who.email, Plan: '2 classes/week', Start: addDays_(nowParts().date, -1) });
      save(b);
      location.reload();
    });
    bar.querySelector('#mk-forget').addEventListener('click', function () {
      try { localStorage.removeItem('rhythm.student'); } catch (e) { /* ignore */ }
      location.reload();
    });
    bar.querySelector('#mk-reset').addEventListener('click', function () {
      try { localStorage.removeItem(KEY); localStorage.removeItem('rhythm.student'); } catch (e) { /* ignore */ }
      memory = null;
      location.reload();
    });
  }

  toolbar();
  return { handle: handle };
})();
