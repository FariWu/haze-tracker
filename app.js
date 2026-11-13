'use strict';

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 5 * 60 * 1000;
const CACHE_KEY = 'haze-last-data';

let latest = null;
let settings = { region: 'central', metric: 'psi24', threshold: 100, enabled: true };

/* ---------- formatting ---------- */

function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statHtml(label, value, extra) {
  const band = bandFor(value);
  return (
    '<div class="stat" style="--c:' + band.color + ';--t:' + band.textColor + '">' +
    '<span class="label">' + label + '</span>' +
    '<span class="value">' + (value == null ? '–' : value) + '</span>' +
    '<span class="pill">' + band.label + '</span>' +
    (extra ? '<span class="pm">' + extra + '</span>' : '') +
    '</div>'
  );
}

/* ---------- rendering ---------- */

function render(data, stale) {
  const wrap = $('regions');
  wrap.innerHTML = REGIONS.map((r) => {
    const d = data.regions[r];
    const band = bandFor(d.psi24 != null ? d.psi24 : d.psi1);
    const watching = settings.enabled && settings.region === r ? ' watching' : '';
    return (
      '<article class="card' + watching + '" style="--c:' + band.color + '">' +
      '<h3>' + cap(r) + (watching ? ' · alert set' : '') + '</h3>' +
      '<div class="stats">' +
      statHtml('24-hour PSI', d.psi24) +
      statHtml('1-hour PSI (est.)', d.psi1, d.pm25 == null ? '' : 'PM2.5 ' + d.pm25 + ' µg/m³') +
      '</div></article>'
    );
  }).join('');

  const t24 = fmtTime(data.psiTime);
  const t1 = fmtTime(data.pm25Time);
  const parts = [];
  if (t24) parts.push('24-hour PSI as of ' + t24);
  if (t1) parts.push('1-hour as of ' + t1);
  $('updated').textContent = (stale ? 'Offline · ' : '') + (parts.join(' · ') || 'No readings available');
}

function showBanner(msg) {
  const b = $('banner');
  b.textContent = msg || '';
  b.hidden = !msg;
}

function setStatus(msg) {
  $('status').textContent = msg || '';
}

function updateThresholdHint() {
  const v = Number($('threshold').value);
  const band = bandFor(v);
  $('threshold-band').textContent = Number.isFinite(v) && v > 0 ? 'That is the "' + band.label + '" level.' : '';
}

/* ---------- data ---------- */

async function loadData(manual) {
  const btn = $('refresh');
  btn.classList.add('spin');
  try {
    const data = await fetchReadings();
    const hasAny = REGIONS.some((r) => data.regions[r].psi24 != null || data.regions[r].psi1 != null);
    if (!hasAny) throw new Error('NEA returned no readings');
    latest = data;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    showBanner('');
    render(data, false);
    try {
      await checkAndNotify(data);
    } catch (e) { /* notifications are best effort */ }
  } catch (err) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { /* ignore */ }
    if (cached) {
      latest = cached;
      render(cached, true);
      showBanner('Could not update just now, showing the last saved readings.');
    } else {
      $('regions').innerHTML = '';
      $('updated').textContent = 'No data';
      showBanner('Could not load PSI data (' + err.message + '). Check your connection and try again.');
    }
  } finally {
    btn.classList.remove('spin');
  }
}

/* ---------- settings ---------- */

async function loadSettings() {
  try {
    const saved = await dbGet('settings');
    if (saved) settings = Object.assign(settings, saved);
  } catch (e) { /* IndexedDB unavailable: keep defaults */ }
  $('region').value = settings.region;
  $('metric').value = settings.metric;
  $('threshold').value = settings.threshold;
  $('enabled').checked = settings.enabled;
  updateThresholdHint();
}

async function registerBackgroundCheck() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return false;
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state !== 'granted') return false;
    await reg.periodicSync.register('haze-check', { minInterval: 60 * 60 * 1000 });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensurePermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
  }
  return Notification.permission;
}

async function onSave(ev) {
  ev.preventDefault();
  const threshold = Math.round(Number($('threshold').value));
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 500) {
    setStatus('Enter a PSI threshold between 1 and 500.');
    return;
  }
  settings = {
    region: $('region').value,
    metric: $('metric').value,
    threshold,
    enabled: $('enabled').checked,
  };

  let perm = 'granted';
  if (settings.enabled) perm = await ensurePermission();

  try {
    await dbSet('settings', settings);
    await dbSet('state', { above: false });
  } catch (e) {
    setStatus('Could not save settings on this browser.');
    return;
  }

  if (latest) render(latest, false);

  if (!settings.enabled) {
    setStatus('Alerts are off.');
    return;
  }
  if (perm === 'unsupported') {
    setStatus('Saved, but this browser cannot show notifications. On iPhone, add the app to the Home Screen first.');
    return;
  }
  if (perm !== 'granted') {
    setStatus('Saved, but notifications are blocked. Allow them in your browser or phone settings.');
    return;
  }

  const bg = await registerBackgroundCheck();
  let msg = 'Saved. You will be notified when the ' + settings.region + ' ' + METRIC_LABEL[settings.metric] +
    ' reaches ' + threshold + ' or more.';
  if (latest) {
    try {
      const res = await checkAndNotify(latest);
      if (res.above) msg += ' It is already at ' + res.value + ' now.';
    } catch (e) { /* ignore */ }
  }
  msg += bg ? ' Background checks are on.' : ' Keep the app open for checks.';
  setStatus(msg);
}

async function onTest() {
  const perm = await ensurePermission();
  if (perm !== 'granted') {
    setStatus(perm === 'unsupported'
      ? 'This browser cannot show notifications.'
      : 'Notifications are blocked. Allow them in your browser or phone settings.');
    return;
  }
  try {
    await showAlert('Haze Tracker test', 'Notifications are working.', 'haze-test');
    setStatus('Test notification sent.');
  } catch (e) {
    setStatus('Could not show a notification: ' + e.message);
  }
}

/* ---------- install prompt ---------- */

let deferredPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function setupInstall() {
  if (isStandalone()) return;
  const panel = $('install-panel');
  const text = $('install-text');
  const btn = $('install');

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) {
    text.textContent = 'In Safari, tap the Share button, then "Add to Home Screen".';
    panel.hidden = false;
  } else {
    text.textContent = 'Install Haze Tracker on your phone for quick access and alerts.';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    panel.hidden = false;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { panel.hidden = true; });
}

/* ---------- start ---------- */

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  $('settings').addEventListener('submit', onSave);
  $('test').addEventListener('click', onTest);
  $('refresh').addEventListener('click', () => loadData(true));
  $('threshold').addEventListener('input', updateThresholdHint);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadData(false);
  });
  setupInstall();
  await loadSettings();
  await loadData(false);
  setInterval(() => {
    if (document.visibilityState === 'visible') loadData(false);
  }, REFRESH_MS);
}

init();
