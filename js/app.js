// HomeBase entry point: boot, router, start menu, header.
import * as store from './core/store.js';
import * as sync from './sync/manager.js';
import { TOOLS, toolById, loadTool, loadHooks } from './tools.js';
import { toast, closeAllSheets, esc, icon, plural, debounce } from './core/ui.js';
import { seedIfEmpty } from './core/locations.js';
import { migrateFromShelf } from './core/migrate.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let cleanup = null;
let renderId = 0;
let current = { tool: null, route: '' };

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', params: parts.slice(1) };
}

const isDark = () => document.documentElement.dataset.theme === 'dark' ||
  (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

function applyToolTheme(t) {
  const app = document.getElementById('app');
  // Set on <html> so pop-up sheets (outside .app) get the tool colour too.
  if (t) document.documentElement.style.setProperty('--tool', isDark() ? t.dark : t.color);
  else document.documentElement.style.removeProperty('--tool');
  app.dataset.tool = t?.id || '';
  document.getElementById('home-btn').hidden = !t;
  document.getElementById('brand-icon').innerHTML = t ? `<span class="tool-emoji">${t.emoji}</span>` : '<img src="icons/icon.svg" alt="" width="28" height="28">';
  document.getElementById('brand-name').textContent = t ? t.name : 'HomeBase';
  document.getElementById('brand').setAttribute('href', t ? `#/${t.id}` : '#/');
  document.title = t ? `${t.name} · HomeBase` : 'HomeBase';
}

function renderNav(t, mod, routeName, subpath = '') {
  const nav = t && mod?.nav;
  tabbar.hidden = !nav?.length;
  if (!nav?.length) { tabbar.innerHTML = ''; return; }
  const parent = t.parent ? toolById(t.parent) : null;
  tabbar.innerHTML = (parent ? `<a href="#/${parent.id}" class="tab-back">${icon('back')}<span>${esc(parent.name)}</span></a>` : '') +
    nav.map((n) => {
      const active = n.match ? n.match.includes(routeName) || n.match.some((x) => x.includes('/') && subpath.startsWith(x)) : n.route.includes('/') ? subpath.startsWith(n.route) : routeName === n.route;
      return `<a href="${n.href || `#/${t.id}${n.route ? '/' + n.route : ''}`}" class="${active ? 'active' : ''} ${n.primary ? 'tab-primary' : ''}"${active ? ' aria-current="page"' : ''}>${n.emoji ? `<span class="nav-emoji" aria-hidden="true">${n.emoji}</span>` : icon(n.icon)}<span>${esc(n.label)}</span></a>`;
    }).join('');
}

/** Things a tool screen can ask the shell to do. */
function makeCtx(t) {
  return {
    tool: t,
    go: (route) => { location.hash = `#/${t.id}${route ? '/' + route : ''}`; },
    hideNav: (hide = true) => { tabbar.hidden = hide || !tabbar.innerHTML; document.body.classList.toggle('nav-hidden', hide); },
  };
}

async function route() {
  const id = ++renderId;
  let { name, params } = parseHash();
  // Pairing links from a QR code open Settings › Pair.
  if (name === 'pair' || name === 'link') { params = [name, ...params]; name = 'settings'; params = ['pair', ...params]; }
  closeAllSheets();
  document.body.classList.remove('nav-hidden');
  if (cleanup) { try { await cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  if (id !== renderId) return;
  window.scrollTo(0, 0);
  const page = document.createElement('div');
  page.className = 'page';

  const t = name ? toolById(name) : null;
  if (!t) {
    current = { tool: null, route: '' };
    applyToolTheme(null);
    renderNav(null);
    view.replaceChildren(page);
    cleanup = renderMenu(page);
    return;
  }
  applyToolTheme(t);
  let mod;
  try { mod = await loadTool(t.id); } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><div class="art">⚠️</div><h2>Couldn’t open ${esc(t.name)}</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Back to menu</a></div>`;
    return;
  }
  if (id !== renderId) return;
  let routeName = params[0] && mod.routes[params[0]] ? params[0] : '';
  const rest = routeName ? params.slice(1) : params;
  current = { tool: t.id, route: routeName };
  renderNav(t, mod, routeName, params.join('/'));
  view.replaceChildren(page);
  try {
    cleanup = (await mod.routes[routeName](page, rest, makeCtx(t))) || null;
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="empty"><div class="art">⚠️</div><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/${t.id}">Back</a></div>`;
  }
}

// ---------- start menu ----------
let lastQuery = ''; // kept while the app is open, so Back returns to your results

function renderMenu(root) {
  root.innerHTML = `
    <div class="menu-head">
      <h1>HomeBase</h1>
      <p class="muted" data-greeting></p>
    </div>
    <div class="global-search" role="search">
      <label class="search">${icon('search')}<span class="sr-only">Search everything</span>
        <input type="search" data-gq placeholder="Search books, items, matches, places…" value="${esc(lastQuery)}" autocomplete="off" enterkeyhint="search" aria-controls="gs-results"></label>
    </div>
    <div id="gs-results" data-results aria-live="polite"></div>
    <div data-menu-body></div>`;
  const $ = (sel) => root.querySelector(sel);
  const input = $('[data-gq]');

  const drawBody = () => {
    const st = sync.getState();
    const linked = st.state === 'connected';
    $('[data-greeting]').textContent = greeting();
    $('[data-menu-body]').innerHTML = `
      <div class="menu-grid">
        ${TOOLS.filter((t) => !t.hidden).map((t) => `
          <a class="tile-tool" href="#/${t.id}" style="--tl:${t.color};--td:${t.dark}">
            <span class="tile-emoji" aria-hidden="true">${t.emoji}</span>
            <span class="tile-name">${esc(t.name)}</span>
            <span class="tile-desc">${esc(t.desc)}</span>
          </a>`).join('')}
      </div>
      <div data-rem-card>${remCard}</div>
      <a class="card sync-card" href="#/settings/pair">
        <span class="sync-dot ${linked ? 'ok' : st.mode === 'off' ? '' : 'warn'}"></span>
        <div class="grow"><b>${linked ? 'Phone & computer in sync' : st.mode === 'off' ? 'Pair your phone and computer' : 'Sync: ' + esc(st.message || st.state)}</b>
          <div class="small muted">${linked ? esc(st.devices?.length ? `With ${st.devices.join(', ')}` : st.mode === 'cloud' ? 'Cloud sync (Supabase) is on' : 'Quick link is on')
            : st.mode === 'off' ? 'Scan on your phone, see it live on your computer' : 'Tap for details'}</div></div>
        ${icon('chev', 'chev')}
      </a>`;
  };

  // Reminders summary under the tools (filled in once the tools' hooks have loaded).
  let remCard = '';
  let remId = 0;
  const refreshReminders = async () => {
    const id = ++remId;
    let list = [];
    try { list = await (await import('./tools/reminders/collect.js')).collectReminders(); } catch (e) { console.error(e); }
    if (id !== remId) return;
    const urgent = list.filter((r) => r.level !== 'info');
    remCard = list.length ? `<a class="card rem-card ${urgent.length ? 'warn' : ''}" href="#/reminders"><span class="rem-bell" aria-hidden="true">🔔</span>
      <div class="grow"><b>${plural(list.length, 'reminder')}${urgent.length ? ` · ${urgent.length} need${urgent.length === 1 ? 's' : ''} attention` : ''}</b>
      <div class="small muted">${list.slice(0, 2).map((r) => esc(`${r.title} (${r.sub})`)).join(' · ')}${list.length > 2 ? ' …' : ''}</div></div>${icon('chev', 'chev')}</a>` : '';
    const slot = $('[data-rem-card]');
    if (slot && slot.innerHTML !== remCard) slot.innerHTML = remCard;
  };

  let searchId = 0;
  const runSearch = async () => {
    const q = input.value.trim();
    lastQuery = q;
    const id = ++searchId;
    const box = $('[data-results]');
    $('[data-menu-body]').hidden = !!q;
    if (!q) { box.innerHTML = ''; return; }
    const hooks = await loadHooks();
    if (id !== searchId) return; // a newer search started while loading
    const groups = hooks.filter((h) => h.search).map((h) => {
      let res = [];
      try { res = h.search(q); } catch (e) { console.error(e); }
      return { tool: h.tool, res };
    }).filter((g) => g.res.length).sort((a, b) => b.res[0].score - a.res[0].score);
    const total = groups.reduce((n, g) => n + g.res.length, 0);
    box.innerHTML = total ? `<p class="small muted gs-count">${plural(total, 'result')}</p>${groups.map((g) => `
      <section class="gs-group" style="--tl:${g.tool.color};--td:${g.tool.dark}"><h2 class="section-title"><span aria-hidden="true">${g.tool.emoji}</span> ${esc(g.tool.name)} <span class="muted">${g.res.length > 6 ? `top 6 of ${g.res.length}` : ''}</span></h2>
        <div class="list">${g.res.slice(0, 6).map((r) => `<a class="list-item gs-hit" href="${esc(r.href)}"><div class="grow"><div class="row-title">${hl(r.title, q)}</div>${r.sub ? `<div class="small muted">${hl(r.sub, q)}</div>` : ''}</div>${icon('chev', 'chev')}</a>`).join('')}</div>
      </section>`).join('')}`
      : `<div class="empty"><div class="art">🔎</div><p class="muted">Nothing found for “${esc(q)}”.</p></div>`;
  };
  const onInput = debounce(runSearch, 90);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; runSearch(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); root.querySelector('.gs-hit')?.focus(); }
    if (e.key === 'Enter') { const first = root.querySelector('.gs-hit'); if (first) location.hash = first.getAttribute('href'); }
  });
  $('[data-results]').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const hits = [...root.querySelectorAll('.gs-hit')];
    const i = hits.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) input.focus(); else hits[Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  // "/" jumps to search from anywhere on the menu.
  const slash = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); input.focus(); } };
  document.addEventListener('keydown', slash);

  drawBody();
  refreshReminders();
  if (lastQuery) runSearch();
  const offSync = sync.onState(drawBody);
  const refreshRemindersSoon = debounce(refreshReminders, 300);
  const refreshGreeting = debounce(() => { const g = $('[data-greeting]'); if (g) g.textContent = greeting(); }, 300);
  const offStore = store.onChange(({ changes }) => {
    if (!changes.some((c) => c.c !== '_local')) return;
    refreshGreeting();
    refreshRemindersSoon();
    if (input.value.trim()) onInput();
  });
  return () => { offSync(); offStore(); document.removeEventListener('keydown', slash); };
}

/** Bold the matching words (matched on the plain text, then made safe for HTML). */
function hl(text, q) {
  const t = String(text ?? '');
  const lower = t.toLowerCase();
  const marks = new Array(t.length).fill(false);
  for (const w of q.toLowerCase().split(/\s+/).filter((x) => x.length > 1)) {
    for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) marks.fill(true, i, i + w.length);
  }
  let out = '', open = false;
  for (let i = 0; i < t.length; i++) {
    if (marks[i] !== open) { out += marks[i] ? '<mark>' : '</mark>'; open = marks[i]; }
    out += esc(t[i]);
  }
  return out + (open ? '</mark>' : '');
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const books = store.all('books').length, items = store.all('items').length, matches = store.all('matches').length;
  const bits = [books && plural(books, 'book'), items && plural(items, 'item'), matches && plural(matches, 'match', 'matches')].filter(Boolean);
  return `${part}. ${bits.length ? bits.join(' · ') : 'Pick a tool to get started.'}`;
}

// ---------- header ----------
function renderSyncPill(st) {
  const pill = document.getElementById('sync-pill');
  if (st.mode === 'off') { pill.hidden = true; return; }
  pill.hidden = false;
  const label = {
    connected: st.mode === 'cloud' ? (st.pending ? `Syncing ${st.pending}` : 'Synced') : `Linked${st.devices?.length ? ' · ' + st.devices.join(', ') : ''}`,
    waiting: st.role === 'host' ? 'Waiting for phone' : 'Waiting for computer',
    connecting: 'Connecting…',
    offline: 'Offline · saved here',
    error: 'Sync problem',
  }[st.state] || 'Sync';
  pill.textContent = label;
  pill.className = `pill ${st.state === 'connected' ? 'pill-ok' : st.state === 'error' ? 'pill-danger' : 'pill-warn'}`;
}

function setupHeader() {
  const offline = () => { document.getElementById('offline-pill').hidden = navigator.onLine !== false; };
  window.addEventListener('online', offline);
  window.addEventListener('offline', offline);
  offline();
  sync.onState(renderSyncPill);
  renderSyncPill(sync.getState());
  document.getElementById('contrast-btn').addEventListener('click', () => {
    const on = document.documentElement.dataset.contrast !== 'high';
    if (on) document.documentElement.dataset.contrast = 'high'; else delete document.documentElement.dataset.contrast;
    try { localStorage.setItem('hb.contrast', on ? 'high' : ''); } catch { /* ignore */ }
    toast(on ? 'Outdoor mode on: high contrast, bigger text' : 'Outdoor mode off');
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyToolTheme(toolById(current.tool)));
}

// Tell the user when something arrives from another device.
const ARRIVALS = {
  books: (r) => `📚 ${r.title}`,
  items: (r) => `📦 ${r.name}`,
  swings: () => '⛳ New swing recorded',
  matches: (r) => `🏆 Match: ${r.title || 'new match'}`,
};
function watchArrivals() {
  store.onChange(({ changes, origin }) => {
    if (origin !== 'remote') return;
    const added = changes.filter((c) => ARRIVALS[c.c] && !c.record.deleted && (!c.prev || c.prev.deleted));
    if (!added.length || added.length > 20) return;
    if (added.length === 1) toast(`From your other device: ${ARRIVALS[added[0].c](added[0].record)}`, { kind: 'ok' });
    else toast(`${added.length} new things arrived from your other device`, { kind: 'ok' });
  });
}

// ---------- service worker ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (new URLSearchParams(location.search).has('nosw')) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of HomeBase is ready.', { actionLabel: 'Update', timeout: 15000, onAction: () => sw.postMessage('skipWaiting') });
        }
      });
    });
  }).catch((e) => console.warn('Service worker not registered', e));
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
    view.innerHTML = `<div class="empty"><div class="art">⚠️</div><h2>HomeBase can’t save data in this browser</h2><p class="muted">${esc(e.message)} Private/incognito windows sometimes block storage — try a normal window.</p></div>`;
    return;
  }
  try { await migrateFromShelf(); } catch (e) { console.warn('Shelf migration skipped', e); }
  await seedIfEmpty();
  navigator.storage?.persist?.().catch(() => {});
  setupHeader();
  watchArrivals();
  window.addEventListener('hashchange', route);
  await route();
  sync.start();
  registerServiceWorker();
  import('./tools/library/pending.js').then((m) => { m.fillPendingLookups(); window.addEventListener('online', m.fillPendingLookups); }).catch(() => {});
}

boot();
