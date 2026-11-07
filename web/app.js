// The check-in page. Opened by tapping the NFC tag or scanning the QR code,
// whose URL carries the check-in code (?t=static for now). The first visit
// asks for an email (and a name, if the studio hasn't seen that email);
// after that the phone remembers them and a tap is a one-step check-in.
(function () {
  'use strict';

  var CFG = window.CHECKIN_CONFIG || {};
  var params = new URLSearchParams(location.search);
  // Which backend: the studio's (prod) or the builder's test copy (dev), by the page's address.
  var ENV = (function () {
    if (params.has('mock')) return null;
    var host = location.hostname;
    if (CFG.prod && CFG.prod.host === host) return { name: 'prod', apiUrl: CFG.prod.apiUrl };
    if (CFG.dev && (CFG.dev.host === host || params.has('dev'))) return { name: 'dev', apiUrl: CFG.dev.apiUrl };
    return null;
  })();
  var MOCK = !ENV || !ENV.apiUrl;
  var CODE = { t: params.get('t') || '', s: params.get('s') || '' };
  var KEY = 'rhythm.student';
  var STUDIO_KEY = 'rhythm.studio';
  var app = document.getElementById('app');

  // ------------------------------------------------------------- storage
  // Wrapped: private browsing and blocked storage throw. Without storage the
  // page still works; it just asks for the email each time.
  function loadMe() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function saveMe(me) {
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) { /* not remembered */ }
  }
  function forgetMe() {
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing stored */ }
  }
  // Ask the browser not to clear what we saved. Safari may still clear it after
  // 7 days without the student interacting with the page; then it just asks for the email again.
  function keepStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { /* declined */ });
    } catch (e) { /* unsupported */ }
  }
  // The studio name comes from the Sheet with every answer; remembering it means
  // config.js only matters on a phone's very first visit.
  var studioName = (function () {
    try { return localStorage.getItem(STUDIO_KEY) || CFG.studioName || ''; } catch (e) { return CFG.studioName || ''; }
  })();

  // ----------------------------------------------------------------- api
  // `opts.keepalive`: let the request finish even if the page is being left (e.g. Telegram opening).
  function api(req, opts) {
    if (MOCK) return window.MockBackend.handle(req);
    // text/plain keeps this a "simple" request: no CORS preflight, which Apps Script can't answer.
    return fetch(ENV.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(req),
      keepalive: !!(opts && opts.keepalive),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Check-ins are safe to retry: the server treats a repeat as "already checked in".
  function apiRetry(req, tries) {
    return api(req).catch(function (err) {
      if (tries <= 1) throw err;
      return new Promise(function (res) { setTimeout(res, 900); }).then(function () { return apiRetry(req, tries - 1); });
    });
  }

  // ------------------------------------------------------------- helpers
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function firstName(name) { return String(name || '').split(' ')[0]; }
  function setStudio(name) {
    if (name && name !== studioName) {
      studioName = name;
      try { localStorage.setItem(STUDIO_KEY, name); } catch (e) { /* shown, not remembered */ }
    }
    document.getElementById('studio').textContent = studioName;
    document.title = 'Check in' + (studioName ? ' · ' + studioName : '');
  }
  function render(html) {
    app.innerHTML = html;
    var focus = app.querySelector('[autofocus]');
    if (focus) focus.focus();
  }
  function on(sel, evt, fn) {
    var el = app.querySelector(sel);
    if (el) el.addEventListener(evt, fn);
  }
  var CHECK = '<div class="check" aria-hidden="true"><svg viewBox="0 0 52 52"><path d="M14 27 l8 8 l17 -18"/></svg></div>';
  function notYou() {
    return '<p class="foot"><button class="linkish" id="notyou">Not you? Switch person</button></p>';
  }
  function bindNotYou() {
    on('#notyou', 'click', function () { forgetMe(); viewRegister({}); });
  }

  // "Join our group chat". The API decides whether and how to show it (res.chatMode: 'full' for a
  // student's first few check-ins, then 'mini', one quiet line), from the Students tab, so it follows
  // the person rather than the phone. Join or "Hide this" is sent back and recorded there.
  var chatChosen = false; // tapped on this visit: don't redraw it while they're still on the page
  function chatHtml(res) {
    var link = res && res.chatLink;
    if (!link || !res.chatMode || chatChosen) return '';
    var hide = '<button class="linkish" id="chathide" type="button">Already in the group? Hide this</button>';
    if (res.chatMode === 'mini') {
      return '<p class="foot small chatmini" id="chatcard">' +
        '<a id="chat" href="' + esc(link) + '" target="_blank" rel="noopener">Join the studio\'s group chat</a>' +
        ' · <button class="linkish" id="chathide" type="button">Hide</button></p>';
    }
    return '<div class="card center" id="chatcard">' +
      '<p style="margin:0 0 2px"><b>Join the studio\'s group chat</b></p>' +
      '<p class="small muted">Class updates, news and practice partners.</p>' +
      '<a class="btn secondary" id="chat" href="' + esc(link) + '" target="_blank" rel="noopener">Join the group chat</a>' +
      '<p class="foot" style="margin:10px 0 0">' + hide + '</p>' +
      '</div>';
  }
  function bindChat(res) {
    var done = function (choice, delay) {
      chatChosen = true;
      // Fire and forget: keepalive lets it finish while Telegram opens. If it's lost, the card
      // simply shows again next time.
      api({ action: 'chat', email: res.student.email, choice: choice }, { keepalive: true }).catch(function () { /* shown again next time */ });
      setTimeout(function () { var c = app.querySelector('#chatcard'); if (c) c.remove(); }, delay);
    };
    on('#chat', 'click', function () { done('joined', 400); });
    on('#chathide', 'click', function () { done('hidden', 0); });
  }

  // A list of today's classes to tick. Ones already checked in to show as done.
  function pickerHtml(options, button) {
    return '<div class="picks">' + options.map(function (o) {
      return '<label class="pick' + (o.done ? ' done' : '') + '">' +
        '<input type="checkbox" value="' + esc(o.id) + '"' + (o.done ? ' checked disabled' : '') + '>' +
        '<span class="pname">' + esc(o.name) + '</span>' +
        '<span class="time">' + (o.done ? 'Checked in' : esc(o.time)) + '</span></label>';
    }).join('') + '</div>' +
      '<button class="btn" id="pickgo" disabled>' + esc(button) + '</button>';
  }
  // `keep`: classes already on screen, re-sent so the answer lists them all (the server says "already").
  function bindPicker(me, button, keep) {
    var boxes = Array.prototype.slice.call(app.querySelectorAll('.pick input:not([disabled])'));
    var go = app.querySelector('#pickgo');
    var picked = function () { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); };
    boxes.forEach(function (b) {
      b.addEventListener('change', function () {
        var n = picked().length;
        go.disabled = !n;
        go.textContent = n > 1 ? button + ' (' + n + ' classes)' : button;
      });
    });
    go.addEventListener('click', function () { checkin(me, (keep || []).concat(picked())); });
  }

  // --------------------------------------------------------------- views
  // Email first: a returning student whose phone forgot them just picks their
  // email from autofill. The name is asked only when the studio doesn't know the email.
  // While someone types their email, wake the API up, so Google has started the script by the
  // time they tap Check in. Once per page load; the answer doesn't matter.
  var warmed = false;
  function warmUp() {
    if (warmed || MOCK) return;
    warmed = true;
    api({ action: 'ping' }).catch(function () { /* only a head start */ });
  }

  // ------------------------------------------------------------ passkeys
  // Optional: if Safari ever forgets this student (it clears page storage after 7 days without
  // interaction), a passkey in the phone's keychain lets them check in with Face ID or a
  // fingerprint instead of typing their email. The passkey only carries a random handle that
  // the Sheet links to them (Logic.gs: passkeySaved_). Anything that fails falls back to email.
  var PASSKEY_KEY = 'rhythm.passkey'; // 'declined' once they tap Not now on this phone
  function passkeysUsable() {
    return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
  }
  function randomBytes(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  function b64url(buf) {
    var s = '', b = new Uint8Array(buf);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function passkeyRequest(extra) {
    return navigator.credentials.get(Object.assign({ publicKey: {
      challenge: randomBytes(32), rpId: location.hostname, userVerification: 'preferred', timeout: 60000,
    } }, extra)).then(function (cred) {
      var h = cred && cred.response && cred.response.userHandle;
      if (!h || !h.byteLength) throw new Error('no handle');
      checkin({ name: '', email: '', passkey: b64url(h) });
    });
  }
  // Passkey autofill: the keyboard's suggestions above the email box include "Sign in with passkey"
  // only on a phone that has one for this site, so a new student sees an ordinary email box.
  var pkAutofill = null;
  function stopPasskeyAutofill() { if (pkAutofill) { pkAutofill.abort(); pkAutofill = null; } }
  function startPasskeyAutofill() {
    stopPasskeyAutofill();
    pkAutofill = new AbortController();
    passkeyRequest({ mediation: 'conditional', signal: pkAutofill.signal }).catch(function (e) {
      if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return; // typed an email instead
      viewRegister({}, 'That passkey didn\'t work. Please enter your email instead.');
    });
  }
  // Older phones without autofill get a button. Called straight from the tap: Safari only allows
  // Face ID prompts from one, so nothing is awaited first.
  function passkeyCheckIn() {
    stopPasskeyAutofill();
    passkeyRequest({}).catch(function (e) {
      if (e && e.name === 'NotAllowedError') return; // cancelled, or no passkey here: the email box is still there
      viewRegister({}, 'That passkey didn\'t work. Please enter your email instead.');
    });
  }
  // After a check-in: offer to save one, if this student has none and this phone can.
  function offerPasskey(me, res) {
    var declined = false;
    try { declined = localStorage.getItem(PASSKEY_KEY) === 'declined'; } catch (e) { /* ask */ }
    if (!passkeysUsable() || !res.passkeyOffer || declined || !me.email) return;
    var check = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    (check ? check.call(PublicKeyCredential) : Promise.resolve(false)).then(function (ok) {
      var foot = app.querySelector(':scope > .foot:last-child'); // the page's "Not you?" line, not a card's
      if (!ok || !foot || app.querySelector('#pkcard')) return;
      var card = document.createElement('div');
      card.className = 'card center';
      card.id = 'pkcard';
      card.innerHTML =
        '<p style="margin:0 0 2px"><b>Skip typing your email next time</b></p>' +
        '<p class="small muted">If this phone ever forgets you, check in with Face ID or your fingerprint instead.</p>' +
        '<button class="btn secondary" id="pksave" type="button">Save a passkey</button>' +
        '<p class="foot" style="margin:10px 0 0"><button class="linkish" id="pkno" type="button">Not now</button></p>';
      app.insertBefore(card, foot);
      card.querySelector('#pkno').addEventListener('click', function () {
        try { localStorage.setItem(PASSKEY_KEY, 'declined'); } catch (e) { /* asked again next time */ }
        card.remove();
      });
      card.querySelector('#pksave').addEventListener('click', function () {
        // The passkey carries the email itself (it's worth what the email is worth), so it keeps
        // working even if the Sheet forgets it. A rare email over 64 bytes gets a random handle.
        var mail = new TextEncoder().encode(me.email);
        var id = mail.length <= 64 && /^[ -~]+$/.test(me.email) ? mail : randomBytes(32), handle = b64url(id);
        navigator.credentials.create({ publicKey: {
          rp: { name: studioName || 'Studio check-in', id: location.hostname },
          user: { id: id, name: me.email, displayName: (res.student && res.student.name) || me.email },
          challenge: randomBytes(32),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
          attestation: 'none', timeout: 60000,
        } }).then(function () {
          return api({ action: 'passkey', email: me.email, handle: handle, code: CODE });
        }).then(function (r) {
          if (!r.ok) throw new Error(r.error || 'not saved');
          card.innerHTML = '<p style="margin:0"><b>Passkey saved ✓</b></p>' +
            '<p class="small muted" style="margin:4px 0 0">If this phone ever asks for your email, you can check in with your passkey instead.</p>';
        }).catch(function (e) {
          if (e && e.name === 'NotAllowedError') return; // they cancelled: leave the offer up
          card.innerHTML = '<p class="small muted" style="margin:0">Couldn\'t save a passkey on this phone. That\'s fine: your email still works.</p>';
        });
      });
    }).catch(function () { /* no offer */ });
  }

  function viewRegister(prefill, error, askName) {
    warmUp();
    stopPasskeyAutofill();
    render(
      '<form class="card" id="reg" novalidate>' +
        (askName
          ? '<h1>Welcome!</h1><p class="muted">Looks like this is your first time. What\'s your name?</p>' +
            '<label for="name">Your name</label>' +
            '<input id="name" name="name" autocomplete="name" autocapitalize="words" required autofocus value="' + esc(prefill.name) + '">'
          : '<h1>Check in</h1><p class="muted">Enter your email. This phone will remember you next time.</p>') +
        '<label for="email">Email</label>' +
        '<input id="email" name="email" type="email" inputmode="email" autocomplete="' + (askName ? 'email' : 'email webauthn') + '" autocapitalize="off" required value="' + esc(prefill.email) + '"' + (askName ? '' : ' autofocus') + '>' +
        (error ? '<div class="error" role="alert">' + esc(error) + '</div>' : '') +
        '<button class="btn" type="submit">Check in</button>' +
        '<p class="small muted" style="margin-top:12px">Use the same email you book or pay with, so your classes and packages line up.</p>' +
      '</form>'
    );
    // A returning student whose phone forgot them: offer their passkey, if this phone can have one.
    if (!askName && passkeysUsable()) {
      var cond = PublicKeyCredential.isConditionalMediationAvailable;
      (cond ? cond.call(PublicKeyCredential) : Promise.resolve(false)).then(function (autofill) {
        var form = app.querySelector('#reg');
        if (!form) return; // already moved on
        if (autofill) return startPasskeyAutofill();
        var card = document.createElement('div');
        card.className = 'card center';
        card.id = 'pkin';
        card.innerHTML = '<p class="small muted" style="margin:0 0 4px">Saved a passkey before?</p>' +
          '<button class="btn secondary" id="pkgo" type="button">Check in with a passkey</button>';
        form.parentNode.insertBefore(card, form.nextSibling);
        card.querySelector('#pkgo').addEventListener('click', passkeyCheckIn);
      }).catch(function () { /* email only */ });
    }
    on('#reg', 'submit', function (e) {
      e.preventDefault();
      var nameEl = app.querySelector('#name');
      var me = { name: nameEl ? nameEl.value.trim() : '', email: app.querySelector('#email').value.trim() };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(me.email)) return viewRegister(me, 'Please enter a valid email.', askName);
      if (askName && !me.name) return viewRegister(me, 'Please enter your name.', true);
      saveMe(me);
      keepStorage();
      checkin(me);
    });
  }

  function viewBusy(me) {
    render(
      '<div class="card center">' +
        (me.name ? '<h1>Hi ' + esc(firstName(me.name)) + '!</h1>' : '') +
        '<div class="spinner" aria-hidden="true"></div>' +
        '<p class="muted">Checking you in…</p>' +
      '</div>'
    );
  }

  function viewError(message, retry) {
    render(
      '<div class="card center">' +
        '<h1>Hmm.</h1>' +
        '<p>' + esc(message) + '</p>' +
        '<button class="btn" id="retry">Try again</button>' +
        '<p class="small muted" style="margin-top:14px">Still stuck? Let your instructor know you\'re here.</p>' +
      '</div>' + notYou()
    );
    on('#retry', 'click', retry);
    bindNotYou();
  }

  // A tester's "Start over" link: their test check-ins are cleared, and this phone forgets them.
  function viewReset(res) {
    forgetMe();
    render(
      '<div class="card center">' +
        CHECK +
        '<h1>Starting over</h1>' +
        '<p>' + (res.cleared ? 'Your ' + res.cleared + ' test check-in' + (res.cleared > 1 ? 's are' : ' is') + ' cleared'
          : 'You had no test check-ins to clear') + ', and this phone has forgotten you.</p>' +
        '<p class="small muted">Tap any test link to try again. Only your own test check-ins were touched.</p>' +
      '</div>'
    );
  }

  // Opened without a sign's code (a bookmark, a shared link, a retired QR code).
  function viewNeedTag() {
    render(
      '<div class="card center">' +
        '<h1>Check in at the studio</h1>' +
        '<p>Tap your phone on the check-in sign by the door, or scan its QR code with your camera.</p>' +
        '<p class="small muted" style="margin-top:14px">This page only checks you in from the sign, so nobody can check in from home.</p>' +
      '</div>'
    );
  }

  function viewChoose(me, res) {
    render(
      '<div class="card">' +
        '<h1>Which class, ' + esc(firstName(res.student.name)) + '?</h1>' +
        '<p class="muted">Tick every class you\'re taking today.</p>' +
        pickerHtml(res.options, 'Check in') +
      '</div>' + notYou()
    );
    bindPicker(me, 'Check in');
    bindNotYou();
  }

  function viewNoClass(me, res) {
    var next = res.next;
    var later = res.later || [];
    // The next class is later today and can already be picked below: they're early, not stuck.
    var early = next && next.today && later.some(function (o) { return o.id === next.id; });
    var opensLine = !next ? '' : next.done
      ? 'You\'re already checked in for it. See you there!'
      : early
        ? 'Check in now below, or tap the sign again any time from ' + esc(next.opens) + '.'
        : 'Check-in opens at ' + esc(next.opens) + (next.today ? '.' : ' that day.');
    render(
      '<div class="card center">' +
        '<h1>' + (next && next.done ? 'You\'re all set' : early ? 'You\'re early' : 'No class to check in to right now') + '</h1>' +
        (next
          ? '<p>Next up: <b>' + esc(next.name) + '</b><br>' + (next.today ? 'Today' : esc(next.dayLabel)) + ' at ' + esc(next.time) + '</p>' +
            '<p class="small muted">' + opensLine + '</p>'
          : '<p class="muted">There are no classes on the schedule this week.</p>') +
        (res.isNew ? '<p class="small muted" style="margin-top:14px">You\'re all set up — next time it\'s just a tap.</p>' : '') +
      '</div>' +
      (later.length
        ? '<div class="card"><p style="margin:0"><b>Staying for classes later today?</b></p>' +
          '<p class="small muted">You can check in to them now.</p>' + pickerHtml(later, 'Check in early') + '</div>'
        : '') +
      // A class that isn't on the schedule (a makeup, a change): recorded for the studio, charged nothing.
      '<div class="card"><p style="margin:0"><b>Here for a class that isn\'t listed?</b></p>' +
        '<p class="small muted">Let the studio know you came. They\'ll match it to the right class.</p>' +
        '<label for="unote">Which class? (optional)</label>' +
        '<input id="unote" maxlength="200" autocomplete="off" placeholder="e.g. Company practice">' +
        '<button class="btn secondary" id="anyway">I\'m here for a class</button>' +
      '</div>' +
      chatHtml(res) +
      notYou()
    );
    if (later.length) bindPicker(me, 'Check in early');
    on('#anyway', 'click', function () {
      checkin(me, [], { unscheduled: true, note: app.querySelector('#unote').value.trim() });
    });
    bindChat(res);
    bindNotYou();
  }

  function viewUnscheduled(me, res) {
    render(
      '<div class="card center">' +
        CHECK +
        '<h1>' + (res.already ? 'Already noted' : 'Thanks, ' + esc(firstName(res.student.name)) + '!') + '</h1>' +
        '<p class="muted">The studio knows you\'re here and will match it to your class.</p>' +
      '</div>' +
      chatHtml(res) +
      notYou()
    );
    bindChat(res);
    bindNotYou();
  }

  function accountHtml(res) {
    var a = res.account;
    var t = a && a.these;
    if (!t) return '';
    var rows = [];
    if (t.plan) {
      rows.push('<div class="row"><span>Covered by your plan</span><span class="paid">✓</span></div>' +
        (a.plan ? '<p class="small muted" style="margin:6px 0 0">' + esc(a.plan) + '</p>' : ''));
    }
    if (t.package) {
      rows.push('<div class="row"><span>Classes left in your package</span><span class="amount">' + a.creditsLeft + '</span></div>' +
        (a.expiresSoon ? '<p class="small muted" style="margin:6px 0 0">Expires ' + esc(a.nextExpiry) + '</p>' : '') +
        (a.creditsLeft === 0 ? '<p class="small" style="margin:6px 0 0">' + (t.dropin ? 'Your package ran out — the rest are drop-ins.' : 'That was your last one — ask about a new package.') + '</p>' : ''));
    }
    var what = t.dropin > 1 ? t.dropin + ' drop-ins' : 'Drop-in';
    // Only these check-ins are ever asked for: older unpaid classes are the owner's to follow up.
    if (res.justPaid) {
      // Just said "Yes, I paid": confirm what they actually sent.
      rows.push('<div class="row"><span>Sent by Venmo</span><span class="paid">' + esc(res.justPaid) + ' ✓</span></div>' +
        '<p class="small muted" style="margin:6px 0 0">Thanks! The studio will confirm your payment.</p>');
    } else if (t.dropin && a.due <= 0) {
      rows.push('<div class="row"><span>' + what + ' ' + esc(t.dropinLabel) + '</span><span class="paid">Paid ✓</span></div>');
    } else if (t.dropin) {
      var dueRow = '<div class="row"><span>' + what + '</span><span class="amount">' + esc(a.dueLabel) + '</span></div>';
      if (!a.pay) {
        rows.push(dueRow + '<p class="small muted" style="margin:6px 0 0">Please pay the studio before or after class.</p>');
      } else {
        return '<div class="acct" id="paybox">' + rows.join('<hr>') + (rows.length ? '<hr>' : '') + dueRow +
          '<a class="btn venmo" id="venmo" href="' + esc(a.pay.url) + '" target="_blank" rel="noopener">Pay ' + esc(a.pay.label) + ' with Venmo</a>' +
          '<p class="small muted" style="margin:10px 0 0">Have a package or paying another way? Just let the studio know.</p>' +
          '</div>';
      }
    }
    if (!rows.length && t.free) rows.push('No charge for ' + (t.free > 1 ? 'these classes.' : 'this class.'));
    return rows.length ? '<div class="acct">' + rows.join('<hr>') + '</div>' : '';
  }

  function viewDone(me, res) {
    var already = res.status === 'already';
    var list = res.checkins;
    var more = res.more || [];
    render(
      '<div class="card center">' +
        CHECK +
        '<h1>' + (already ? 'Already checked in' : 'You\'re in, ' + esc(firstName(res.student.name)) + '!') + '</h1>' +
        (list.length === 1
          ? '<p class="klass">' + esc(list[0].name) + '</p><p class="muted">' + esc(list[0].dayLabel) + ' · ' + esc(list[0].time) + '</p>'
          : '<ul class="klasses">' + list.map(function (c) {
              return '<li><span class="klass">' + esc(c.name) + '</span><span class="muted">' + esc(c.time) + '</span></li>';
            }).join('') + '</ul>') +
        accountHtml(res) +
      '</div>' +
      (more.length
        ? '<div class="card"><p style="margin:0 0 4px"><b>Taking another class today?</b></p>' + pickerHtml(more, 'Check in') + '</div>'
        : '') +
      chatHtml(res) +
      notYou()
    );
    if (more.length) bindPicker(me, 'Check in', list.map(function (c) { return c.id; }));
    bindChat(res);
    bindNotYou();
    offerPasskey(me, res);
    on('#venmo', 'click', function () {
      // Venmo opens in its app; when they come back, ask whether it went through.
      setTimeout(function () { viewPayConfirm(me, res); }, 600);
    });
  }

  function viewPayConfirm(me, res) {
    var box = app.querySelector('#paybox');
    if (!box) return;
    var a = res.account;
    box.innerHTML =
      '<p style="margin:0 0 4px"><b>Did the ' + esc(a.pay.label) + ' payment go through?</b></p>' +
      '<button class="btn" id="paid">Yes, I paid</button>' +
      '<button class="btn secondary" id="notyet">Not yet</button>' +
      '<p class="small muted" id="payerr" style="margin:10px 0 0"></p>';
    box.querySelector('#notyet').addEventListener('click', function () { viewDone(me, res); });
    box.querySelector('#paid').addEventListener('click', function () {
      var btn = box.querySelector('#paid');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      var ids = res.checkins.map(function (c) { return c.checkinId; });
      // Not retried: a lost response after a successful save would record the payment twice.
      api({ action: 'declarePayment', email: me.email, amount: a.pay.amount, checkinIds: ids, note: 'Venmo, from the check-in page' })
        .then(function (r) {
          if (!r.ok) throw new Error(r.error || 'Could not save that.');
          res.account = r.account;
          res.justPaid = a.pay.label; // what they actually sent, earlier classes included
          viewDone(me, res);
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Yes, I paid';
          box.querySelector('#payerr').textContent = 'That didn\'t save (' + err.message + '). Please try again.';
        });
    });
  }

  // ---------------------------------------------------------------- flow
  // `extra`: {unscheduled, note} for "I'm here for a class" (safe to retry: one per day).
  function checkin(me, classIds, extra) {
    stopPasskeyAutofill();
    viewBusy(me);
    var retry = function () { checkin(me, classIds, extra); };
    var req = { action: 'checkin', name: me.name || '', email: me.email, classIds: classIds || [], code: CODE };
    if (me.passkey) req.passkey = me.passkey; // checking in with a passkey instead of an email
    if (extra) { req.unscheduled = !!extra.unscheduled; req.note = extra.note || ''; }
    apiRetry(req, 3)
      .then(function (res) {
        setStudio(res.studio);
        if (res.student) saveMe(me = { name: res.student.name, email: res.student.email });
        if (!res.ok && res.status === 'needTag') return viewNeedTag();
        if (!res.ok && res.status === 'needDetails') {
          // A passkey for an email the studio doesn't know yet: show that email, and ask the name.
          if (res.email) me = { name: '', email: res.email };
          return viewRegister({ name: me.name, email: me.email }, res.needName ? '' : res.error, !!res.needName);
        }
        if (!res.ok) return viewError(res.error || 'Something went wrong.', retry);
        if (res.status === 'choose') return viewChoose(me, res);
        if (res.status === 'noClass') return viewNoClass(me, res);
        if (res.status === 'unscheduled') return viewUnscheduled(me, res);
        if (res.status === 'reset') return viewReset(res);
        viewDone(me, res);
      })
      .catch(function () {
        viewError('We couldn\'t reach the check-in system. Check your signal and try again.', retry);
      });
  }

  // If the logo can't load, show the studio's name instead (handled here, not inline, for the page's CSP).
  function logoFallback() {
    var logo = document.querySelector('.logo');
    if (!logo) return;
    var fail = function () { logo.parentNode.classList.add('nologo'); };
    if (logo.complete && !logo.naturalWidth) fail();
    else logo.addEventListener('error', fail);
  }

  function start() {
    logoFallback();
    setStudio();
    // Never mistake the test copy for the real one.
    if (!MOCK && ENV.name === 'dev') {
      var badge = document.createElement('span');
      badge.className = 'envbadge';
      badge.textContent = 'DEV';
      document.querySelector('.top').appendChild(badge);
    }
    var me = loadMe();
    if (me && me.email) checkin(me);
    else viewRegister({});
  }

  if (MOCK) {
    // Preview mode: run the real rules (Logic.gs) in the browser. Never used once apiUrl is set.
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
