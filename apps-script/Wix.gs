/**
 * Wix.gs — read-only access to the studio's Wix site (Bookings classes, Pricing Plans).
 *
 * Wix API keys can't be made read-only, so this file is the guard: every call
 * to Wix goes through wixRead_(), which only knows the read calls listed in
 * WIX_READS. Nothing here can create, change or cancel anything in Wix.
 *
 * The key and site ID live in Script Properties (Apps Script → Project
 * Settings → Script Properties), never in this code or in GitHub:
 *   wixApiKey   the API key from the Wix API Keys Manager
 *   wixAccountId  the Wix account ID (only used to find the site ID)
 *   wixSiteId     the site's ID. Optional at first: with the account ID, "Test the Wix
 *                 connection" looks it up, and saves it if the account has one site.
 */

const WIX_API = 'https://www.wixapis.com';
const WIX_READS = {
  services: { method: 'post', path: '/bookings/v2/services/query' }, // Wix posts its queries, but they only read
  events: { method: 'post', path: '/calendar/v3/events/query' },
  plans: { method: 'post', path: '/pricing-plans/v3/plans/query' },
  orders: { method: 'get', path: '/pricing-plans/v2/orders' },
  sites: { method: 'post', path: '/site-list/v2/sites/query', account: true }, // finds wixSiteId
  member: { method: 'get', path: '/members/v1/members/{id}' }, // a plan buyer's login email (needs "Read Members")
};
const WIX_PREVIEW_TAB = 'Wix preview';
const WIX_MAX_PAGES = 20;

function wixRead_(name, body, query, id) {
  const call = WIX_READS[name];
  if (!call) throw new Error('Not an allowed Wix read: ' + name);
  // The only variable part of a path is a Wix ID, so nothing else can be slipped into the URL.
  if ((call.path.indexOf('{id}') >= 0) !== !!id || (id && !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Bad Wix ID for ' + name);
  const path = id ? call.path.replace('{id}', id) : call.path;
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('wixApiKey');
  // Most calls are about one site (wix-site-id); listing the sites is about the account (wix-account-id).
  const target = call.account ? ['wix-account-id', props.getProperty('wixAccountId'), 'wixAccountId']
    : ['wix-site-id', props.getProperty('wixSiteId'), 'wixSiteId'];
  const missing = [key ? '' : 'wixApiKey', target[1] ? '' : target[2]].filter(String);
  if (missing.length) throw new Error('Add ' + missing.join(' and ') + ' under Apps Script → Project Settings → Script Properties.');
  const headers = { Authorization: key };
  headers[target[0]] = target[1];
  const qs = Object.keys(query || {}).map(function (k) {
    return [].concat(query[k]).map(function (v) { return encodeURIComponent(k) + '=' + encodeURIComponent(v); }).join('&');
  }).join('&');
  const options = {
    method: call.method,
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: false, // the key only ever goes to wixapis.com
  };
  if (call.method === 'post') {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body || {});
  }
  const res = UrlFetchApp.fetch(WIX_API + path + (qs ? '?' + qs : ''), options);
  const code = res.getResponseCode();
  if (code !== 200) {
    const hint = code === 401 || code === 403 ? ' Check the key, the site ID, and that the key has this permission.' : '';
    const err = new Error('Wix said ' + code + ' to "' + name + '".' + hint + ' ' + res.getContentText().slice(0, 200));
    err.status = code;
    throw err;
  }
  return JSON.parse(res.getContentText() || '{}');
}

// ------------------------------- the reads ---------------------------------

function wixServices_() {
  const out = [];
  for (let page = 0; page < WIX_MAX_PAGES; page++) {
    const r = wixRead_('services', { query: { paging: { limit: 100, offset: out.length } } });
    const got = r.services || [];
    out.push.apply(out, got);
    if (got.length < 100) break;
  }
  return out;
}

/** Calendar events between two local times ('yyyy-MM-ddTHH:mm:ss') in the studio's time zone. */
function wixEvents_(fromLocal, toLocal, tz) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < WIX_MAX_PAGES; page++) {
    const body = { fromLocalDate: fromLocal, toLocalDate: toLocal, timeZone: tz, query: cursor ? { cursorPaging: { cursor: cursor } } : { cursorPaging: { limit: 100 } } };
    const r = wixRead_('events', body);
    out.push.apply(out, r.events || []);
    const meta = r.pagingMetadata || {};
    cursor = meta.hasNext && meta.cursors && meta.cursors.next;
    if (!cursor) break;
  }
  return out;
}

function wixPlans_() {
  const out = [];
  let cursor = null;
  for (let page = 0; page < WIX_MAX_PAGES; page++) {
    const r = wixRead_('plans', { query: { cursorPaging: cursor ? { cursor: cursor } : { limit: 100 } } });
    out.push.apply(out, r.plans || []);
    const meta = r.pagingMetadata || {};
    cursor = meta.cursors && meta.cursors.next;
    if (!cursor || !(r.plans || []).length) break;
  }
  return out;
}

function wixSites_() {
  const r = wixRead_('sites', { query: { cursorPaging: { limit: 100 } } });
  return r.sites || [];
}

/**
 * With only a key and account ID: list the account's sites. If there's exactly
 * one, save its ID as wixSiteId (a Script Property of this script, nothing in
 * Wix) and return null so the test carries on. Otherwise return rows for the
 * preview so the owner can pick one.
 */
function wixFindSite_(props) {
  if (props.getProperty('wixSiteId') || !props.getProperty('wixAccountId')) return null;
  const sites = wixSites_().filter(function (s) { return !s.trashedDate; });
  if (sites.length === 1) {
    props.setProperty('wixSiteId', sites[0].id);
    return null;
  }
  const rows = [[], [sites.length ? 'This Wix account has ' + sites.length + ' sites. Copy the right Site ID into the wixSiteId Script Property, then run the test again.'
    : 'No sites found for this account. Check wixAccountId, and that the key can read site data.'], ['Site', 'Address', 'Paid plan', 'Site ID']];
  sites.forEach(function (s) { rows.push([s.displayName || s.name || '', s.viewUrl || '', s.premium ? 'yes' : '', s.id]); });
  return rows;
}

function wixOrders_() {
  const out = [];
  for (let page = 0; page < WIX_MAX_PAGES; page++) {
    const r = wixRead_('orders', null, { limit: 50, offset: out.length });
    const got = r.orders || [];
    out.push.apply(out, got);
    if (got.length < 50) break;
  }
  return out;
}

// ------------------------- the schedule sync -------------------------------

const WIX_SYNC_DAYS = 14;

/**
 * Copies the next two weeks of Wix class sessions into the "Wix schedule" tab,
 * which check-in reads alongside Schedule (see classesFrom_ in Logic.gs). The
 * tab is rewritten each time; nothing is read from it back into Wix.
 * If Wix can't be reached, the tab is left as it was, so check-in carries on
 * with the last good copy. Runs hourly once wixSyncNow() has been used.
 */
function wixSyncSchedule() {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone(), props = PropertiesService.getScriptProperties();
  let rows;
  try {
    if (wixFindSite_(props)) throw new Error('The Wix account has several sites; run "Test the Wix connection" to pick one.');
    const services = {};
    wixServices_().forEach(function (s) {
      const pay = s.payment || {};
      const price = pay.rateType === 'FIXED' && pay.fixed && pay.fixed.price ? Number(pay.fixed.price.value)
        : pay.rateType === 'NO_FEE' ? 0 : null;
      services[s.id] = { name: s.name, price: isNaN(price) ? null : price };
    });
    const now = new Date();
    const from = Utilities.formatDate(now, tz, "yyyy-MM-dd'T'00:00:00");
    const to = Utilities.formatDate(new Date(now.getTime() + (WIX_SYNC_DAYS - 1) * 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd'T'23:59:59");
    const sessions = wixEvents_(from, to, tz).map(function (ev) {
      return {
        title: ev.title, serviceId: ev.externalScheduleId, type: ev.type, status: ev.status,
        start: (ev.adjustedStart || ev.start || {}).localDate, end: (ev.adjustedEnd || ev.end || {}).localDate,
      };
    });
    rows = wixScheduleRows_(sessions, services, configFrom_(readBook_().config));
  } catch (e) {
    return wixSyncFailed_(props, e);
  }

  wixWriteTab_(ss, WIX_SCHEDULE_TAB, WIX_SCHEDULE_HEADERS, rows, 'Leave classes out with wixSkip in Config.');
  props.setProperty('wixLastSync', String(Date.now()));
  props.deleteProperty('wixLastError');

  // Plan purchases ride along on the same hourly run. Their trouble never holds up the schedule.
  try {
    const n = wixSyncPurchases_(ss, tz);
    props.setProperty('wixPurchasesNote', n.note);
  } catch (e) {
    props.setProperty('wixPurchasesNote', 'Could not read purchases (kept the last copy): ' + e.message);
    console.warn('Wix purchases sync failed; keeping the last copy. ' + e.message);
  }
  try { writeToday_(readBook_(), nowParts_()); } catch (e) { /* the next check-in redoes it */ }
  return rows.length;
}

/** Rewrites a tab the Wix sync owns, as plain text, under the same lock as doPost so a check-in never reads it half-written. */
function wixWriteTab_(ss, tab, headers, rows, note) {
  const grid = [headers].concat(rows.map(function (r) {
    return headers.map(function (h) { return r[h] == null ? '' : r[h]; });
  }));
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    sh.clear();
    sh.getRange(1, 1, grid.length, grid[0].length).setNumberFormat('@').setValues(textSafeGrid_(grid));
    sh.getRange(1, 1, 1, grid[0].length).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A1').setNote('Filled in from Wix every hour — edits here are overwritten. Last update: ' +
      Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm') + '. ' + note);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------- plan purchases -----------------------------------

/**
 * Wix Pricing Plans purchases → the "Wix purchases" tab, which check-in reads
 * like Packages and Plans (see wixPurchaseRows_ in Logic.gs). Each buyer is
 * matched by their Wix login email, which needs the key's "Read Members"
 * permission. Without it the purchases are still listed, matched to nobody.
 * A Wix error other than a missing permission throws, so the last good copy stays.
 */
function wixSyncPurchases_(ss, tz) {
  const day = function (iso) { return iso ? Utilities.formatDate(new Date(iso), tz, 'yyyy-MM-dd') : ''; };
  const orders = wixOrders_().map(function (o) {
    const price = ((((o.pricing || {}).prices || [])[0] || {}).price || {}).total;
    return {
      id: o.id, planName: o.planName, status: o.status, payment: o.lastPaymentStatus,
      start: day(o.startDate), end: day(o.endDate), memberId: (o.buyer || {}).memberId,
      amount: price != null ? price : o.planPrice,
    };
  });
  const book = readBook_();
  const cfg = configFrom_(book.config);
  // Look up only the buyers whose purchases count; a first pass with no emails says which.
  const wanted = {};
  wixPurchaseRows_(orders, {}, cfg, book).forEach(function (r) { if (r.WixMember) wanted[r.WixMember] = true; });
  const emails = {};
  let note = '';
  try {
    Object.keys(wanted).forEach(function (id) { emails[id] = wixMemberEmail_(id); });
  } catch (e) {
    if (e.status !== 403 && e.status !== 401) throw e;
    note = 'Buyers can\'t be matched to students yet: the Wix key needs the "Read Members" permission.';
    Object.keys(emails).forEach(function (k) { delete emails[k]; });
  }
  const rows = wixPurchaseRows_(orders, emails, cfg, book);
  wixWriteTab_(ss, WIX_PURCHASES_TAB, WIX_PURCHASE_HEADERS, rows,
    'Class passes are the plans named in wixPacks in Config; other plans count like a monthly plan. ' + note);
  return { count: rows.length, note: note };
}

/** A member's login email, remembered for 6 hours so the hourly sync isn't a lookup per buyer every time. */
function wixMemberEmail_(memberId) {
  const cache = CacheService.getScriptCache();
  const key = 'wixMember:' + memberId;
  const hit = cache.get(key);
  if (hit != null) return hit;
  let m;
  try {
    m = (wixRead_('member', null, { fieldsets: 'EXTENDED' }, memberId).member) || {};
  } catch (e) {
    if (e.status !== 404) throw e;
    m = {}; // the member was deleted in Wix; their purchase matches nobody
  }
  const email = String(m.loginEmail || '').trim().toLowerCase();
  cache.put(key, email, 6 * 60 * 60);
  return email;
}

/**
 * A short Wix outage shouldn't email the owner every hour: the error is kept
 * quietly, and only raised (so Google emails the owner) once there has been no
 * good sync for a day.
 */
function wixSyncFailed_(props, e) {
  props.setProperty('wixLastError', new Date().toISOString() + ' ' + e.message);
  const last = Number(props.getProperty('wixLastSync') || 0);
  if (Date.now() - last > 24 * 60 * 60 * 1000) throw new Error('Could not get classes from Wix: ' + e.message);
  console.warn('Wix sync failed; keeping the last copy. ' + e.message);
  return null;
}

/** Owner menu: sync now, and make sure it keeps syncing every hour. */
function wixSyncNow() {
  const n = wixSyncSchedule();
  const have = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'wixSyncSchedule'; });
  if (!have) ScriptApp.newTrigger('wixSyncSchedule').timeBased().everyHours(1).create();
  const purchases = PropertiesService.getScriptProperties().getProperty('wixPurchasesNote') || '';
  const msg = (n == null ? 'Wix could not be reached just now; check-in keeps the last copy.' :
    n + ' class sessions in the next ' + WIX_SYNC_DAYS + ' days are in the "' + WIX_SCHEDULE_TAB + '" tab, and plan purchases in "' +
    WIX_PURCHASES_TAB + '". Both update every hour.') + (purchases ? ' ' + purchases : '');
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Wix', 10); } catch (e) { /* not opened from the Sheet */ }
  try { ss_().getSheetByName(WIX_SCHEDULE_TAB).activate(); } catch (e) { /* first run failed */ }
}

// ------------------------- owner menu: test it -----------------------------

/**
 * Reads the Wix site and writes what it finds to a "Wix preview" tab: the
 * classes, the next 7 days of sessions, the pricing plans, and a count of plan
 * purchases (no names or emails). Writes nothing to Wix and changes no other
 * tab. Each section reports its own error, so a missing permission shows up
 * against the part that needs it.
 */
function wixTest() {
  const ss = ss_(), tz = ss.getSpreadsheetTimeZone();
  const rows = [['Read from Wix ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + ' — read-only; nothing was changed in Wix.']];
  let pick = null;
  try {
    pick = wixFindSite_(PropertiesService.getScriptProperties());
  } catch (e) {
    pick = [[], ['Could not list the sites: ' + e.message]];
  }
  if (pick) return wixWritePreview_(ss, rows.concat(pick));
  const section = function (title, header, fill) {
    rows.push([], [title]);
    try {
      const body = fill();
      rows.push(header);
      if (body.length) rows.push.apply(rows, body); else rows.push(['(none)']);
    } catch (e) {
      rows.push(['Could not read: ' + e.message]);
    }
  };

  section('Classes and services (Bookings)', ['Name', 'Type', 'Price', 'Capacity', 'Hidden', 'Wix ID'], function () {
    return wixServices_().map(function (s) {
      const price = s.payment && s.payment.fixed && s.payment.fixed.price;
      return [s.name, s.type, price ? price.value + ' ' + (price.currency || '') : (s.payment && s.payment.rateType) || '', s.defaultCapacity || '', s.hidden ? 'yes' : '', s.id];
    });
  });

  const day = 24 * 60 * 60 * 1000, now = new Date();
  const from = Utilities.formatDate(now, tz, "yyyy-MM-dd'T'00:00:00");
  const to = Utilities.formatDate(new Date(now.getTime() + 7 * day), tz, "yyyy-MM-dd'T'23:59:59");
  section('Sessions in the next 7 days (Calendar)', ['Day', 'Start', 'End', 'Title', 'Type', 'Status', 'Service ID'], function () {
    return wixEvents_(from, to, tz).map(function (ev) {
      const start = ((ev.adjustedStart || ev.start || {}).localDate || '').split('T');
      const end = ((ev.adjustedEnd || ev.end || {}).localDate || '').split('T');
      return [start[0] || '', (start[1] || '').slice(0, 5), (end[1] || '').slice(0, 5), ev.title || '', ev.type || '', ev.status || '', ev.externalScheduleId || ''];
    });
  });

  section('Pricing plans', ['Name', 'Visibility', 'Pricing (raw)', 'Wix ID'], function () {
    return wixPlans_().map(function (p) {
      return [p.name || '', p.visibility || '', JSON.stringify(p.pricingVariants || p.pricing || '').slice(0, 300), p.id || ''];
    });
  });

  section('Plan purchases (counts only)', ['Plan', 'Status', 'Paid by', 'Orders'], function () {
    const counts = {};
    wixOrders_().forEach(function (o) {
      const k = [o.planName || o.planId || '?', o.status || '', o.type || ''].join('\u0001');
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.keys(counts).sort().map(function (k) { return k.split('\u0001').concat([counts[k]]); });
  });

  // One lookup, to show whether buyers can be matched to students. The email itself isn't shown.
  section('Matching buyers to students (Members)', ['Result'], function () {
    const buyer = wixOrders_().map(function (o) { return (o.buyer || {}).memberId; }).filter(Boolean)[0];
    if (!buyer) return [['No plan purchases to try it on.']];
    try {
      return [[wixRead_('member', null, { fieldsets: 'EXTENDED' }, buyer).member.loginEmail
        ? 'OK: a buyer\'s login email can be read, so purchases will match students who check in with the same email.'
        : 'The member was found but has no login email.']];
    } catch (e) {
      return [[e.status === 403 || e.status === 401 ? 'Not yet: the key needs the "Read Members" permission.' : 'Could not check: ' + e.message]];
    }
  });

  wixWritePreview_(ss, rows);
}

function wixWritePreview_(ss, rows) {
  const width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
  const grid = rows.map(function (r) { const c = r.slice(); while (c.length < width) c.push(''); return c; });
  const sh = ss.getSheetByName(WIX_PREVIEW_TAB) || ss.insertSheet(WIX_PREVIEW_TAB);
  sh.clear();
  sh.getRange(1, 1, grid.length, width).setNumberFormat('@').setValues(textSafeGrid_(grid));
  sh.activate();
}
