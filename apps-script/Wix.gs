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
 *   wixSiteId   the site's ID: the long code after /dashboard/ in the Wix dashboard's address
 */

const WIX_API = 'https://www.wixapis.com';
const WIX_READS = {
  services: { method: 'post', path: '/bookings/v2/services/query' }, // Wix posts its queries, but they only read
  events: { method: 'post', path: '/calendar/v3/events/query' },
  plans: { method: 'post', path: '/pricing-plans/v3/plans/query' },
  orders: { method: 'get', path: '/pricing-plans/v2/orders' },
};
const WIX_PREVIEW_TAB = 'Wix preview';
const WIX_MAX_PAGES = 20;

function wixRead_(name, body, query) {
  const call = WIX_READS[name];
  if (!call) throw new Error('Not an allowed Wix read: ' + name);
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('wixApiKey'), site = props.getProperty('wixSiteId');
  if (!key || !site) throw new Error('Add wixApiKey and wixSiteId under Apps Script → Project Settings → Script Properties.');
  const qs = Object.keys(query || {}).map(function (k) {
    return [].concat(query[k]).map(function (v) { return encodeURIComponent(k) + '=' + encodeURIComponent(v); }).join('&');
  }).join('&');
  const options = {
    method: call.method,
    headers: { Authorization: key, 'wix-site-id': site },
    muteHttpExceptions: true,
    followRedirects: false, // the key only ever goes to wixapis.com
  };
  if (call.method === 'post') {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body || {});
  }
  const res = UrlFetchApp.fetch(WIX_API + call.path + (qs ? '?' + qs : ''), options);
  const code = res.getResponseCode();
  if (code !== 200) {
    const hint = code === 401 || code === 403 ? ' Check the key, the site ID, and that the key has this permission.' : '';
    throw new Error('Wix said ' + code + ' to "' + name + '".' + hint + ' ' + res.getContentText().slice(0, 200));
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

  const width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
  const grid = rows.map(function (r) { const c = r.slice(); while (c.length < width) c.push(''); return c; });
  const sh = ss.getSheetByName(WIX_PREVIEW_TAB) || ss.insertSheet(WIX_PREVIEW_TAB);
  sh.clear();
  sh.getRange(1, 1, grid.length, width).setNumberFormat('@').setValues(grid);
  sh.activate();
}
