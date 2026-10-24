// App entry: boot, hash router, header status, service worker.
import * as store from './store.js';
import * as link from './sync/relay-link.js';
import { fillPendingLookups } from './pending.js';
import { toast, closeAllSheets, esc, icon, openSheet, confirmDialog } from './ui.js';
import * as library from './views/library.js';
import * as scan from './views/scan.js';
import * as book from './views/book.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';
import * as linkView from './views/link.js';

const routes = { '': library, scan, book, stats, settings, link: linkView };
const view = document.getElementById('view');
let cleanup = null;
let renderId = 0;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', params: parts.slice(1) };
}

function updateNav() {
  const { name, params } = parseHash();
  const key = name === 'scan' ? (params[0] === 'where' ? 'where' : 'scan') : name === 'link' ? 'settings' : name === 'book' ? 'library' : name || 'library';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}

async function route() {
  const id = ++renderId;
  const { name, params } = parseHash();
  // A phone in scanner-only mode only has the scan and link screens.
  if (store.isScannerMode() && !['scan', 'link'].includes(name)) {
    location.replace('#/scan');
    return;
  }
  const mod = routes[name] || library;
  closeAllSheets();
  if (cleanup) { try { await cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  if (id !== renderId) return;
  view.innerHTML = '';
  window.scrollTo(0, 0);
  updateNav();
  const page = document.createElement('div');
  view.appendChild(page);
  try {
    cleanup = (await mod.render(page, params)) || null;
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="empty"><div class="art">⚠️</div><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Back to library</a></div>`;
  }
}

// ---------- header pills ----------
function renderLinkPill(st) {
  const pill = document.getElementById('link-pill');
  if (!st.role) { pill.hidden = true; return; }
  pill.hidden = false;
  const label = {
    connected: st.role === 'host' ? `Linked · ${st.devices.join(', ')}` : 'Linked to computer',
    waiting: st.role === 'host' ? 'Waiting for phone' : 'Waiting for computer',
    connecting: 'Connecting…',
    error: 'Link offline',
  }[st.state] || 'Link';
  pill.textContent = label;
  pill.className = `pill ${st.state === 'connected' ? 'pill-ok' : st.state === 'error' ? 'pill-danger' : 'pill-warn'}`;
}

function renderOnline() {
  document.getElementById('offline-pill').hidden = navigator.onLine !== false;
}

// ---------- notifications for books arriving from another device ----------
function watchRemoteAdds() {
  store.onChange(({ changes, origin, source }) => {
    if (origin !== 'remote') return;
    const added = changes.filter((c) => c.store === 'books' && !c.record.deleted && (!c.prev || c.prev.deleted)).map((c) => c.record);
    if (!added.length) return;
    const from = link.peerNameOf(source) || 'your other device';
    if (added.length === 1) {
      const b = added[0];
      library.setFlash(b.id);
      toast(`📱 Added on ${from}: ${b.title}`, { kind: 'ok', actionLabel: 'View', onAction: () => { location.hash = `#/book/${b.id}`; } });
    } else if (added.length <= 50) {
      toast(`📱 ${added.length} books arrived from ${from}`, { kind: 'ok' });
    }
  });
}

// ---------- scanner-only mode ----------
let scannerMode = null;
function applyScannerMode() {
  const on = store.isScannerMode();
  document.body.classList.toggle('scanner-mode', on);
  document.getElementById('mode-pill').hidden = !on;
  if (scannerMode !== null && on !== scannerMode) route();
  scannerMode = on;
}

function openModeSheet() {
  const st = link.getState();
  const linked = st.role === 'guest' && st.state === 'connected';
  const s = openSheet(`
    <p>This phone is set up as a <b>scanner</b>. Books you scan are sent to ${linked ? `<b>${esc(st.devices.join(', ') || 'your computer')}</b>` : 'your computer'}. Browse the library, stats and settings there.</p>
    <div class="banner ${linked ? 'banner-ok' : 'banner-warn'}">${icon(linked ? 'check' : 'link')}<div class="grow">${linked ? 'Connected to your computer.' : 'Not connected to your computer right now. Scans are kept here and sent when it reconnects.'}</div></div>
    <a class="btn btn-block" href="#/link" data-close>${icon('link')} Link settings</a>
    <button class="btn btn-ghost btn-block" data-full style="margin-top:8px">Use the full app on this phone</button>`, { title: 'Scanner mode' });
  s.body.querySelector('[data-full]').onclick = async () => {
    s.close();
    if (await confirmDialog({ title: 'Use the full app here?', message: 'This phone will show the library, stats and settings too. It stays linked. You can switch back in Settings.', confirmLabel: 'Use full app' })) {
      await store.setSetting('scannerMode', false);
      location.hash = '#/';
    }
  };
}

function setupScannerMode() {
  applyScannerMode();
  document.getElementById('mode-pill').addEventListener('click', openModeSheet);
  store.onChange(({ changes }) => {
    if (changes.some((c) => c.store === 'meta' && ['scannerMode', 'linkedHost'].includes(c.record.key))) applyScannerMode();
  });
  // In scanner mode, tapping a book shows where it lives instead of opening the full book page.
  document.addEventListener('click', (e) => {
    if (!store.isScannerMode()) return;
    const a = e.target.closest('a[href^="#/book/"]');
    if (!a) return;
    e.preventDefault();
    const b = store.getBook(decodeURIComponent(a.getAttribute('href').slice(7)));
    if (b) openSheet(`${scan.whereHtml(b)}<button class="btn btn-primary btn-block" data-close style="margin-top:12px">Done</button>`, { title: 'Where is it?' });
  }, true);
}

// ---------- service worker ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('nosw')) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of Shelf is ready.', { actionLabel: 'Update', timeout: 15000, onAction: () => sw.postMessage('skipWaiting') });
        }
      });
    });
  }).catch((e) => console.warn('Service worker not registered', e));
  // Reload only when an update takes over, not on the very first install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}

// ---------- boot ----------
async function boot() {
  try {
    await store.init();
  } catch (e) {
    view.innerHTML = `<div class="empty"><div class="art">⚠️</div><h2>Shelf can’t save data in this browser</h2><p class="muted">${esc(e.message)} Private/incognito windows sometimes block storage — try a normal window.</p></div>`;
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('hashchange', route);
  document.addEventListener('shelf:route', updateNav);
  window.addEventListener('online', () => { renderOnline(); fillPendingLookups(); });
  window.addEventListener('offline', renderOnline);
  renderOnline();
  link.onState(renderLinkPill);
  watchRemoteAdds();
  setupScannerMode();
  await route();
  link.autoStart();
  registerServiceWorker();
  fillPendingLookups();
}

boot();
