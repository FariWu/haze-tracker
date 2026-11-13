/* Shared by the page (index.html) and the service worker (sw.js).
 * Fetches NEA PSI / PM2.5 data from data.gov.sg, converts it, stores settings
 * in IndexedDB (readable from the service worker) and sends alert notifications.
 */
'use strict';

const API = {
  psi: 'https://api-open.data.gov.sg/v2/real-time/api/psi',
  pm25: 'https://api-open.data.gov.sg/v2/real-time/api/pm25',
};

const REGIONS = ['central', 'north', 'south', 'east', 'west'];

const METRIC_LABEL = {
  psi24: '24-hour PSI',
  psi1: '1-hour PSI (est.)',
};

// NEA PSI bands. textColor is the readable colour to use on top of `color`.
const BANDS = [
  { max: 50, label: 'Good', color: '#2e9e4f', textColor: '#ffffff' },
  { max: 100, label: 'Moderate', color: '#2f7fd1', textColor: '#ffffff' },
  { max: 200, label: 'Unhealthy', color: '#f2c200', textColor: '#1b1b1b' },
  { max: 300, label: 'Very Unhealthy', color: '#ef7d00', textColor: '#1b1b1b' },
  { max: Infinity, label: 'Hazardous', color: '#c62828', textColor: '#ffffff' },
];

function bandFor(value) {
  if (value == null || Number.isNaN(value)) {
    return { label: 'No data', color: '#8a93a0', textColor: '#ffffff' };
  }
  return BANDS.find((b) => value <= b.max);
}

// PM2.5 concentration (ug/m3) -> PSI sub-index, linear within each segment.
const PM25_SEGMENTS = [
  [0, 12, 0, 50],
  [12, 55, 50, 100],
  [55, 150, 100, 200],
  [150, 250, 200, 300],
  [250, 350, 300, 400],
  [350, 500, 400, 500],
];

function pm25ToPsi(conc) {
  if (conc == null || Number.isNaN(conc) || conc < 0) return null;
  if (conc >= 500) return 500;
  const [c0, c1, i0, i1] = PM25_SEGMENTS.find(([, hi]) => conc <= hi);
  return i0 + ((conc - c0) * (i1 - i0)) / (c1 - c0);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('NEA data service returned HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== undefined && json.code !== 0) {
      throw new Error(json.errorMsg || 'NEA data service error');
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function firstItem(json) {
  const items = json && json.data && json.data.items;
  return items && items.length ? items[items.length - 1] : null;
}

/* Returns:
 * { fetchedAt, psiTime, pm25Time,
 *   regions: { central: { psi24, pm25, psi1 }, ... } }
 */
async function fetchReadings() {
  const [psiRes, pmRes] = await Promise.allSettled([getJson(API.psi), getJson(API.pm25)]);
  if (psiRes.status === 'rejected' && pmRes.status === 'rejected') throw psiRes.reason;

  const psiItem = psiRes.status === 'fulfilled' ? firstItem(psiRes.value) : null;
  const pmItem = pmRes.status === 'fulfilled' ? firstItem(pmRes.value) : null;
  const psiR = (psiItem && psiItem.readings && psiItem.readings.psi_twenty_four_hourly) || {};
  const pmR = (pmItem && pmItem.readings && pmItem.readings.pm25_one_hourly) || {};

  const regions = {};
  for (const r of REGIONS) {
    const pm25 = num(pmR[r]);
    const est = pm25ToPsi(pm25);
    regions[r] = {
      psi24: num(psiR[r]),
      pm25,
      psi1: est == null ? null : Math.round(est),
    };
  }
  return {
    fetchedAt: Date.now(),
    psiTime: psiItem ? psiItem.timestamp : null,
    pm25Time: pmItem ? pmItem.timestamp : null,
    regions,
  };
}

function metricValue(data, region, metric) {
  const r = data && data.regions && data.regions[region];
  return r ? r[metric] : null;
}

/* ---------- IndexedDB key/value store (shared with the service worker) ---------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('haze-tracker', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Notifications ---------- */

async function showAlert(title, body, tag) {
  const reg = self.registration || (await navigator.serviceWorker.ready);
  await reg.showNotification(title, {
    body,
    tag: tag || 'haze-alert',
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
  });
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Notifies once when the chosen reading rises to/above the threshold, then waits
 * until it has dropped back below before it can notify again. */
async function checkAndNotify(data) {
  const s = await dbGet('settings');
  if (!s || !s.enabled) return { notified: false, reason: 'disabled' };
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { notified: false, reason: 'no-permission' };
  }
  const value = metricValue(data, s.region, s.metric);
  if (value == null) return { notified: false, reason: 'no-data' };

  const state = (await dbGet('state')) || { above: false };
  const above = value >= s.threshold;
  let notified = false;
  if (above && !state.above) {
    const band = bandFor(value);
    await showAlert(
      'Haze alert: ' + cap(s.region) + ' PSI ' + value,
      METRIC_LABEL[s.metric] + ' in the ' + s.region + ' has reached ' + value +
        ' (' + band.label + '), at or above your threshold of ' + s.threshold + '.'
    );
    notified = true;
  }
  await dbSet('state', { above, last: value, at: Date.now() });
  return { notified, value, above };
}
