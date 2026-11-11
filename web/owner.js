// The owner's page: today's classes, students' monthly plans and class passes, and the
// "I'm here for a class" visits to sort out, so the owner never has to edit the Sheet.
// Opened from a private link (owner.html#k=…) made by the Sheet's menu; the key is kept on the
// phone and sent with every request. Deliberately nothing about money yet (payments, prices).
(function () {
  'use strict';

  var CFG = window.CHECKIN_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var ENV = (function () {
    if (params.has('mock')) return null;
    var host = location.hostname;
    if (CFG.prod && CFG.prod.host === host) return { name: 'prod', apiUrl: CFG.prod.apiUrl };
    if (CFG.dev && (CFG.dev.host === host || params.has('dev'))) return { name: 'dev', apiUrl: CFG.dev.apiUrl };
    return null;
  })();
  var MOCK = !ENV || !ENV.apiUrl;
  var KEY_STORE = 'rhythm.ownerKey';
  var MOCK_KEY = 'previewownerkeypreviewowner'; // matches mock.js
  var app = document.getElementById('app');
  var tabs = document.getElementById('tabs');

  // ------------------------------------------------------------------ key
  // The link's key arrives after the # (never sent to any server), is kept on this phone, and is
  // taken out of the address bar so it doesn't linger in a screenshot or a shared link.
  var key = (function () {
    var m = location.hash.match(/[#&]k=([A-Za-z0-9]+)/);
    if (m) {
      try { localStorage.setItem(KEY_STORE, m[1]); } catch (e) { /* kept for this visit only */ }
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* fine */ }
      return m[1];
    }
    if (MOCK) return MOCK_KEY;
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  })();

  // ------------------------------------------------------------------ api
  function api(op, extra) {
    var req = Object.assign({ action: 'owner', op: op, key: key }, extra || {});
    if (MOCK) return window.MockBackend.handle(req);
    return fetch(ENV.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // a "simple" request: no CORS preflight
      body: JSON.stringify(req),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // -------------------------------------------------------------- helpers
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function on(sel, ev, fn) { var el = app.querySelector(sel); if (el) el.addEventListener(ev, fn); }
  function all(sel) { return Array.prototype.slice.call(app.querySelectorAll(sel)); }
  function render(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function busy() { render('<div class="card center"><div class="spinner" aria-hidden="true"></div></div>'); }
  function setStudio(name) {
    if (!name) return;
    document.getElementById('studio').textContent = name;
    document.title = name;
  }
  function noteHtml(msg, bad) { return msg ? '<p class="' + (bad ? 'error' : 'flash') + '" role="status">' + esc(msg) + '</p>' : ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------------------------------------------------------------- state
  var state = { tab: 'today', today: null, students: null, filter: '' };

  function setTab(tab) {
    state.tab = tab;
    tabs.hidden = false;
    Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
      if (b.getAttribute('data-tab') === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function setExtrasCount() {
    var n = state.today ? state.today.extras.length : 0;
    var c = document.getElementById('extras-count');
    c.textContent = n;
    c.hidden = !n;
  }

  // Loads (or reloads) what a tab needs, then shows it.
  function show(tab, msg, bad) {
    setTab(tab);
    var need = tab === 'students' ? 'students' : 'today';
    busy();
    api(need).then(function (res) {
      if (!handled(res)) return;
      state[need] = res;
      if (need === 'today') setExtrasCount();
      draw(msg, bad);
    }).catch(function () { viewError('Couldn\'t reach the studio\'s records. Check your signal and try again.', function () { show(tab, msg, bad); }); });
  }

  // After a change: the answer carries the fresh data for the tab it came from.
  function after(res, kind) {
    if (!handled(res)) return;
    if (res.today || res.classes) { state.today = res; setExtrasCount(); }
    if (res.students) state.students = res;
    draw(res.ok ? res.done : res.error, !res.ok);
  }

  // A refused key or a server error; true when the answer can be shown.
  function handled(res) {
    setStudio(res && res.studio);
    if (res && res.status === 'needKey') { viewNeedKey(); return false; }
    if (res && !res.ok && !res.classes && !res.students) { draw(res.error || 'That didn\'t work.', true); return false; }
    return true;
  }

  function draw(msg, bad) {
    var need = state.tab === 'students' ? 'students' : 'today';
    if (!state[need]) return viewError(msg || 'That didn\'t load.', function () { show(state.tab); });
    if (state.tab === 'students') return viewStudents(msg, bad);
    if (state.tab === 'extras') return viewExtras(msg, bad);
    return viewToday(msg, bad);
  }

  // ---------------------------------------------------------------- views
  function viewNeedKey() {
    tabs.hidden = true;
    render('<div class="card center"><h1>Owner page</h1>' +
      '<p>This phone doesn\'t have a working owner link. Please open the link you were sent again, or ask for a new one.</p></div>');
  }

  function viewError(msg, retry) {
    render('<div class="card center"><p>' + esc(msg) + '</p><button class="btn" id="retry" type="button">Try again</button></div>');
    on('#retry', 'click', retry);
  }

  // `shown`: names whose balance is already on the page, so it appears once, not under every class.
  function peopleHtml(people, shown) {
    if (!people.length) return '<p class="muted small" style="margin:6px 0 0">Nobody yet.</p>';
    return '<ul class="people">' + people.map(function (p) {
      var owes = p.owes && !shown[p.name];
      shown[p.name] = true;
      return '<li><span>' + esc(p.name) +
          '<button class="linkish remove" type="button" data-undo="' + esc(p.checkinId) + '" data-who="' + esc(p.name) + '">remove</button>' +
          (p.by ? '<span class="by">checked in by ' + esc(p.by) + '</span>' : '') + '</span>' +
        '<span class="how">' + esc(p.how) +
        (owes ? '<span class="owes">owes ' + esc(p.owes) + ' in all</span>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }

  function viewToday(msg, bad) {
    var d = state.today;
    var total = d.classes.concat(d.other).reduce(function (n, c) { return n + c.people.length; }, 0);
    var shown = {};
    render(noteHtml(msg, bad) +
      '<div class="headline"><h1>' + esc(d.dateLabel) + '</h1>' +
        '<p class="muted small">' + plural(total, 'check-in', 'check-ins') + ' so far · updated ' + esc(d.time) +
        ' · <button class="linkish" id="refresh" type="button">Refresh</button></p></div>' +
      '<button class="btn" id="checkin" type="button">Check someone in</button>' +
      (d.classes.length || d.other.length ? '' : '<div class="card center"><p class="muted">No classes today.</p></div>') +
      d.classes.map(function (c) {
        return '<section class="card slim"><h2>' + esc(c.time) + ' · ' + esc(c.name) +
          '<span class="n">' + c.people.length + '</span></h2>' + peopleHtml(c.people, shown) +
          '<button class="btn secondary" type="button" data-roster="' + esc(c.id) + '">Take attendance</button></section>';
      }).join('') +
      d.other.map(function (c) {
        return '<section class="card slim"><h2>' + esc(c.name) + '<span class="n">' + c.people.length + '</span></h2>' + peopleHtml(c.people, shown) + '</section>';
      }).join('') +
      (d.extras.length ? '<button class="btn secondary" id="goextras" type="button">' + plural(d.extras.length, 'visit', 'visits') + ' to sort out</button>' : '') +
      '<p class="muted small center" style="margin-top:14px">"Owes" is for your information: payments stay in the spreadsheet for now.</p>');
    on('#refresh', 'click', function () { show('today'); });
    on('#checkin', 'click', viewCheckin);
    on('#goextras', 'click', function () { setTab('extras'); draw(); });
    all('[data-roster]').forEach(function (b) {
      b.addEventListener('click', function () { viewRoster(b.getAttribute('data-roster')); });
    });
    all('[data-undo]').forEach(function (b) {
      b.addEventListener('click', function () {
        var li = b.closest('section').querySelector('h2').firstChild.textContent;
        if (!confirm('Remove ' + b.getAttribute('data-who') + ' from ' + li.replace(/^.* · /, '') + '? It won\'t count as a class.')) return;
        b.disabled = true;
        b.textContent = 'removing…';
        api('undo', { checkinId: b.getAttribute('data-undo') }).then(function (res) { state.students = null; after(res); })
          .catch(function () { alert('Couldn\'t reach the studio\'s records. Nothing was changed. Please try again.'); draw(); });
      });
    });
  }

  // The attendance checklist for one class: its usual students first, then everyone else.
  function viewRoster(classId) {
    if (!state.students) {
      busy();
      return api('students').then(function (res) { if (handled(res)) { state.students = res; viewRoster(classId); } })
        .catch(function () { viewError('Couldn\'t reach the studio\'s records.', function () { viewRoster(classId); }); });
    }
    var c = state.today.classes.filter(function (x) { return x.id === classId; })[0];
    if (!c) return draw();
    var inClass = {};
    c.people.forEach(function (p) { inClass[p.studentId] = true; });
    var byId = {};
    state.students.students.forEach(function (s) { byId[s.id] = s; });
    var usual = c.usual.filter(function (id) { return byId[id]; }).map(function (id) { return byId[id]; });
    var isUsual = {};
    usual.forEach(function (s) { isUsual[s.id] = true; });
    var rest = state.students.students.filter(function (s) { return !isUsual[s.id]; });
    var row = function (s) {
      var here = inClass[s.id];
      return '<label class="pick' + (here ? ' done' : '') + '" data-name="' + esc((s.name + ' ' + s.email).toLowerCase()) + '">' +
        '<input type="checkbox" value="' + esc(s.id) + '"' + (here ? ' checked disabled' : '') + '>' +
        '<span class="pname">' + esc(s.name) + '</span>' + (here ? '<span class="time">in</span>' : '') + '</label>';
    };
    render('<p><button class="linkish" id="back" type="button">‹ Today</button></p>' +
      '<div class="headline"><h1>' + esc(c.name) + '</h1><p class="muted small">' + esc(c.time) + ' · tick who\'s here</p></div>' +
      '<input id="rfind" type="search" autocomplete="off" placeholder="Find a name">' +
      (usual.length ? '<p class="group">Usually in this class</p>' + usual.map(row).join('') : '') +
      (rest.length ? '<p class="group">' + (usual.length ? 'Everyone else' : 'Students') + '</p>' + rest.map(row).join('') : '') +
      (!usual.length && !rest.length ? '<p class="muted">No students yet. Use "Check someone in" for someone new.</p>' : '') +
      '<p class="muted small" style="margin-top:12px">Someone new? Use "Check someone in" on Today, with their email.</p>' +
      '<div class="stickybar"><button class="btn" id="rgo" type="button" disabled>Check in</button></div>');
    var go = app.querySelector('#rgo');
    var count = function () {
      var n = all('.pick input:checked:not(:disabled)').length;
      go.disabled = !n;
      go.textContent = n ? 'Check in ' + n : 'Check in';
    };
    all('.pick input').forEach(function (i) { i.addEventListener('change', count); });
    app.querySelector('#rfind').addEventListener('input', function (e) {
      var q = e.target.value.trim().toLowerCase();
      all('.pick').forEach(function (l) { l.hidden = !!q && l.getAttribute('data-name').indexOf(q) < 0; });
    });
    on('#back', 'click', function () { draw(); });
    go.addEventListener('click', function () {
      var ids = all('.pick input:checked:not(:disabled)').map(function (i) { return i.value; });
      go.disabled = true;
      go.textContent = 'Checking in…';
      api('checkinMany', { classId: classId, studentIds: ids }).then(function (res) {
        if (res.ok) { state.students = null; after(res); return; }
        if (res.status === 'needKey') return viewNeedKey();
        alert(res.error || 'That didn\'t work.');
        count();
      }).catch(function () {
        // Safe to tap again: anyone already checked in comes back as already in.
        alert('Couldn\'t reach the studio\'s records. Please try again.');
        count();
      });
    });
  }

  function studentLine(s) {
    var bits = [];
    if (s.plan) bits.push(s.plan); else if (s.plans.some(function (p) { return p.future; })) bits.push('plan starts soon');
    if (s.wixPlan && !s.plan) bits.push('plan on Wix');
    if (s.credits != null) bits.push(plural(s.credits, 'class', 'classes') + ' left on pass');
    if (!bits.length) bits.push('drop-in');
    return bits.join(' · ');
  }

  function viewStudents(msg, bad) {
    var d = state.students;
    render(noteHtml(msg, bad) +
      '<label for="find">Find a student</label>' +
      '<input id="find" type="search" autocomplete="off" placeholder="Name or email" value="' + esc(state.filter) + '">' +
      '<ul class="list" id="slist"></ul>');
    var input = app.querySelector('#find');
    var list = app.querySelector('#slist');
    var fill = function () {
      var q = state.filter = input.value.trim().toLowerCase();
      var hits = d.students.filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) >= 0 || s.email.indexOf(q) >= 0; });
      list.innerHTML = hits.length ? hits.map(function (s) {
        return '<li><button type="button" data-id="' + esc(s.id) + '"><b>' + esc(s.name) + '</b>' +
          '<span class="muted small">' + esc(studentLine(s)) + (s.last ? ' · last in ' + esc(s.last) : '') + '</span></button></li>';
      }).join('') : '<li class="muted small" style="padding:10px 0">No student matches. Students appear here after their first check-in.</li>';
    };
    input.addEventListener('input', fill);
    list.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (b) viewStudent(b.getAttribute('data-id'));
    });
    fill();
  }

  function viewStudent(id, msg, bad) {
    var d = state.students;
    var s = d.students.filter(function (x) { return x.id === id; })[0];
    if (!s) return viewStudents();
    var running = s.plans.filter(function (p) { return !p.future; });
    // Preselect the plan they're not on already (the first one for someone with none).
    var current = running.length ? running[running.length - 1].plan : '';
    var preset = d.planChoices.filter(function (c) { return c !== current; })[0];
    render(noteHtml(msg, bad) +
      '<p><button class="linkish" id="back" type="button">‹ All students</button></p>' +
      '<div class="card slim"><h2>' + esc(s.name) + '</h2><p class="muted small">' + esc(s.email) + '</p>' +
        '<p>' + esc(studentLine(s)) + (s.expires ? ' (pass expires ' + esc(s.expires) + ')' : '') + '</p></div>' +

      '<section class="card slim"><h2>Monthly plan</h2>' +
        (s.plans.length ? s.plans.map(function (p) {
          return '<div class="planrow"><span>' + esc(p.plan) + '<br><span class="muted small">' + (p.future ? 'starts ' : 'since ') + esc(p.startLabel || 'the start') + '</span></span>' +
            '<button class="btn secondary small" type="button" data-end="' + esc(p.id) + '">' + (p.future ? 'Cancel' : 'End today') + '</button></div>';
        }).join('') : '<p class="muted small">No monthly plan' + (s.wixPlan ? ' here (they have one on Wix)' : '') + '.</p>') +
        '<p style="margin:16px 0 6px"><b>' + (running.length ? 'Change to' : 'Start a plan') + '</b></p>' +
        d.planChoices.map(function (c) {
          return '<label class="pick"><input type="radio" name="plan" value="' + esc(c) + '"' + (c === preset ? ' checked' : '') + '><span class="pname">' + esc(c) + '</span></label>';
        }).join('') +
        '<label for="pstart">Starting</label><input id="pstart" type="date" value="' + esc(d.today) + '">' +
        '<p class="muted small" style="margin-top:6px">Pick an earlier day to cover classes they\'ve already been to.' +
          (running.length ? ' Their current plan ends the day before.' : '') + '</p>' +
        '<button class="btn" id="saveplan" type="button">Save plan</button></section>' +

      '<section class="card slim"><h2>Class pass</h2>' +
        '<label for="pcount">Number of classes</label><input id="pcount" type="number" inputmode="numeric" min="1" max="100" value="10">' +
        '<label for="pexp">Expires (optional)</label><input id="pexp" type="date">' +
        '<button class="btn" id="addpass" type="button">Add class pass</button></section>');

    on('#back', 'click', function () { viewStudents(); });
    all('[data-end]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = s.plans.filter(function (x) { return x.id === b.getAttribute('data-end'); })[0];
        if (!confirm((p.future ? 'Cancel ' : 'End ') + s.name + '\'s ' + p.plan.toLowerCase() + (p.future ? '?' : ' today? Today\'s classes stay covered.'))) return;
        send(b, 'endPlan', { planId: p.id }, id);
      });
    });
    on('#saveplan', 'click', function (e) {
      var pick = app.querySelector('input[name=plan]:checked');
      send(e.currentTarget, 'startPlan', { studentId: id, plan: pick && pick.value, start: app.querySelector('#pstart').value }, id);
    });
    on('#addpass', 'click', function (e) {
      send(e.currentTarget, 'addPass', { studentId: id, classes: app.querySelector('#pcount').value, expires: app.querySelector('#pexp').value }, id);
    });
  }

  // A change from a student's page; stays on that student with the result.
  function send(btn, op, extra, studentId) {
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = 'Saving…';
    api(op, extra).then(function (res) {
      setStudio(res.studio);
      if (res.status === 'needKey') return viewNeedKey();
      if (res.students) state.students = res;
      state.today = null; // stale now; reloaded when Today is opened
      viewStudent(studentId, res.ok ? res.done : res.error || 'That didn\'t work.', !res.ok);
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = label;
      alert('Couldn\'t reach the studio\'s records. Nothing was changed. Please try again.');
    });
  }

  function viewCheckin() {
    var d = state.today;
    if (!state.students) {
      busy();
      return api('students').then(function (res) { if (handled(res)) { state.students = res; viewCheckin(); } })
        .catch(function () { viewError('Couldn\'t reach the studio\'s records.', viewCheckin); });
    }
    var classes = d.classes;
    render('<p><button class="linkish" id="back" type="button">‹ Today</button></p>' +
      '<div class="card slim"><h2>Check someone in</h2>' +
      (classes.length ? '' : '<p class="muted">There are no classes on today\'s schedule.</p>') +
      '<label for="who">Who?</label><input id="who" type="search" autocomplete="off" placeholder="Start typing a name or email">' +
      '<ul class="list compact" id="whohits"></ul>' +
      '<div id="newone" hidden><p class="muted small">Someone new: their email and name.</p>' +
        '<label for="nemail">Email</label><input id="nemail" type="email" autocomplete="off">' +
        '<label for="nname">Name</label><input id="nname" autocomplete="off"></div>' +
      '<p class="small" style="margin-top:8px"><button class="linkish" id="isnew" type="button">Someone new?</button></p>' +
      '<p style="margin:14px 0 0"><b>Which class?</b></p>' +
      classes.map(function (c) {
        return '<label class="pick"><input type="checkbox" value="' + esc(c.id) + '"' + (classes.length === 1 ? ' checked' : '') + '>' +
          '<span class="pname">' + esc(c.name) + '</span><span class="time">' + esc(c.time) + '</span></label>';
      }).join('') +
      '<button class="btn" id="go" type="button" disabled>Check in</button></div>');

    var picked = null; // a student id
    var who = app.querySelector('#who');
    var hits = app.querySelector('#whohits');
    var go = app.querySelector('#go');
    var newone = app.querySelector('#newone');
    var ready = function () {
      var anyClass = all('.pick input:checked').length > 0;
      var someone = picked || (!newone.hidden && app.querySelector('#nemail').value.trim() && app.querySelector('#nname').value.trim());
      go.disabled = !(anyClass && someone);
    };
    who.addEventListener('input', function () {
      picked = null;
      var q = who.value.trim().toLowerCase();
      var list = q ? state.students.students.filter(function (s) { return s.name.toLowerCase().indexOf(q) >= 0 || s.email.indexOf(q) >= 0; }).slice(0, 6) : [];
      hits.innerHTML = list.map(function (s) {
        return '<li><button type="button" data-id="' + esc(s.id) + '"><b>' + esc(s.name) + '</b><span class="muted small">' + esc(s.email) + '</span></button></li>';
      }).join('');
      ready();
    });
    hits.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      picked = b.getAttribute('data-id');
      var s = state.students.students.filter(function (x) { return x.id === picked; })[0];
      who.value = s.name;
      hits.innerHTML = '';
      newone.hidden = true;
      ready();
    });
    on('#isnew', 'click', function () { newone.hidden = false; picked = null; who.value = ''; hits.innerHTML = ''; app.querySelector('#nemail').focus(); ready(); });
    all('#nemail, #nname, .pick input').forEach(function (el) { el.addEventListener('input', ready); el.addEventListener('change', ready); });
    on('#back', 'click', function () { draw(); });
    go.addEventListener('click', function () {
      var ids = all('.pick input:checked').map(function (i) { return i.value; });
      var extra = picked ? { studentId: picked, classIds: ids }
        : { email: app.querySelector('#nemail').value.trim(), name: app.querySelector('#nname').value.trim(), classIds: ids };
      go.disabled = true;
      go.textContent = 'Checking in…';
      api('checkin', extra).then(function (res) {
        if (res.ok) { state.students = null; after(res); return; }
        if (res.status === 'needKey') return viewNeedKey();
        go.disabled = false;
        go.textContent = 'Check in';
        alert(res.error || 'That didn\'t work.');
      }).catch(function () {
        go.disabled = false;
        go.textContent = 'Check in';
        alert('Couldn\'t reach the studio\'s records. Nobody was checked in. Please try again.');
      });
    });
  }

  function viewExtras(msg, bad) {
    var d = state.today;
    render(noteHtml(msg, bad) +
      '<p class="muted small">Students who tapped "I\'m here for a class" when nothing was on the schedule. Match each to its class, or remove it if it wasn\'t one.</p>' +
      (d.extras.length ? '' : '<div class="card center"><p class="muted">Nothing to sort out.</p></div>') +
      d.extras.map(function (x) {
        return '<section class="card slim" data-id="' + esc(x.id) + '"><h2>' + esc(x.name) + '<span class="n">' + esc(x.dayLabel) + '</span></h2>' +
          (x.note ? '<p>They wrote: <b>' + esc(x.note) + '</b></p>' : '<p class="muted small">No note.</p>') +
          '<label>Which class was it?</label><select class="which">' +
            x.classes.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.time + ' · ' + c.name) + '</option>'; }).join('') +
            '<option value="">Another class (type its name)</option></select>' +
          '<input class="other" placeholder="Class name"' + (x.classes.length ? ' hidden' : '') + ' value="' + esc(x.classes.length ? '' : x.note) + '">' +
          '<button class="btn match" type="button">Check them in</button>' +
          '<button class="btn secondary remove" type="button">Not a class: remove</button></section>';
      }).join(''));
    all('section[data-id]').forEach(function (sec) {
      var id = sec.getAttribute('data-id');
      var sel = sec.querySelector('.which');
      var other = sec.querySelector('.other');
      if (!sel.value) other.hidden = false;
      sel.addEventListener('change', function () { other.hidden = !!sel.value; if (!sel.value) other.focus(); });
      var go = function (btn, extra) {
        all('section[data-id] .btn').forEach(function (b) { b.disabled = true; });
        btn.textContent = 'Saving…';
        api('sortOut', Object.assign({ checkinId: id }, extra)).then(after).catch(function () {
          alert('Couldn\'t reach the studio\'s records. Nothing was changed. Please try again.');
          draw();
        });
      };
      sec.querySelector('.match').addEventListener('click', function (e) {
        if (!sel.value && !other.value.trim()) { other.focus(); return; }
        go(e.currentTarget, sel.value ? { classId: sel.value } : { className: other.value.trim() });
      });
      sec.querySelector('.remove').addEventListener('click', function (e) {
        if (confirm('Remove this visit? It won\'t count as a class.')) go(e.currentTarget, { remove: true });
      });
    });
  }

  // ---------------------------------------------------------------- start
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    var tab = b.getAttribute('data-tab');
    if (tab === 'extras' && state.today) { setTab(tab); return draw(); }
    show(tab);
  });

  function start() {
    var logo = document.querySelector('.logo');
    if (logo) {
      var fail = function () { logo.parentNode.classList.add('nologo'); };
      if (logo.complete && !logo.naturalWidth) fail(); else logo.addEventListener('error', fail);
    }
    setStudio(CFG.studioName);
    if (!key) return viewNeedKey();
    show('today');
  }

  if (MOCK) {
    var load = function (src, next) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = next;
      s.onerror = function () { viewError('Preview mode needs scripts/serve.js (could not load ' + src + ').', function () { location.reload(); }); };
      document.body.appendChild(s);
    };
    load('../apps-script/Logic.gs', function () { load('mock.js', start); });
  } else {
    start();
  }
})();
