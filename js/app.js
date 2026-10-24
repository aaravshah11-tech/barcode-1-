// App entry: boot, hash router, header status, service worker.
import * as store from './store.js';
import * as link from './sync/peer-link.js';
import { fillPendingLookups } from './pending.js';
import { toast, closeAllSheets, esc } from './ui.js';
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
    waiting: 'Waiting for phone',
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
  await route();
  link.autoStart();
  registerServiceWorker();
  fillPendingLookups();
}

boot();
