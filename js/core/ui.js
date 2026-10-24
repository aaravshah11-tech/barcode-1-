// Small UI helpers: escaping, icons, toasts, sheets/dialogs, covers, images.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9L17.5 7M9.5 7V4.5h5V7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  torch: '<path d="M8 3h8l-1 6H9zM9 9h6v4l-1.5 8h-3L9 13z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M2.5 19h19"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
  wifiOff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.5-2.4M14.5 10.1A10 10 0 0 1 19 12.5M2 9a15 15 0 0 1 5-3M12 5c3.6 0 7 1.4 10 4M12 20h.01"/>',
  hand: '<path d="M7 11.5V6a1.5 1.5 0 0 1 3 0v5M10 10.5V4.5a1.5 1.5 0 0 1 3 0v6M13 10.5V5.5a1.5 1.5 0 0 1 3 0v6M16 11V8a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.8a6.5 6.5 0 0 1-5-2.4L4 15.5a1.6 1.6 0 0 1 2.4-2.1L7 14"/>',
  book: '<path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13H7.5A2.5 2.5 0 0 1 5 17.5z"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  box: '<path d="M4 7.5l8-4 8 4v9l-8 4-8-4z"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  next: '<path d="M6 5.5l9 6.5-9 6.5zM18 5.5v13"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8"/>',
  folder: '<path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5h-7L10 5H5A1.5 1.5 0 0 0 3.5 6.5z"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
  print: '<path d="M7 9V4h10v5M7 17H4.5V10h15v7H17"/><rect x="7" y="14" width="10" height="6"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M16 16h2v2"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.6c2.4.1 4.2 1.6 5 4.4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7M9.5 17h5"/>',
  golf: '<path d="M12 18V3.5l6 3-6 3"/><ellipse cx="12" cy="19" rx="6" ry="1.8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  flag: '<path d="M5 21V4M5 4.5h12l-2.5 4 2.5 4H5"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18.5z"/>',
};
export const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${PATHS[name] || ''}</svg>`;

// ---------- toasts ----------
export function toast(message, { actionLabel, onAction, kind = '', timeout = 3500 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="grow">${esc(message)}</div>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  const close = () => el.remove();
  if (actionLabel) el.querySelector('button').onclick = () => { close(); onAction?.(); };
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(close, timeout);
  return close;
}

// ---------- sheets ----------
const openSheets = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openSheets.length) openSheets[openSheets.length - 1].close();
});

/** Show a bottom sheet (centered dialog on desktop). Returns { el, body, close }. */
export function openSheet(html, { onClose, dialog = false, title = '' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet${dialog ? ' dialog' : ''}" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
    <div class="sheet-handle"></div>
    ${title ? `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>` : ''}
    <div class="sheet-body">${html}</div></div>`;
  let closed = false;
  const api = {
    el: backdrop.querySelector('.sheet'),
    body: backdrop.querySelector('.sheet-body'),
    close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      openSheets.splice(openSheets.indexOf(api), 1);
      onClose?.();
    },
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) api.close();
  });
  document.body.appendChild(backdrop);
  openSheets.push(api);
  return api;
}

export const closeAllSheets = () => [...openSheets].forEach((s) => s.close());

export function confirmDialog({ title, message = '', confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const s = openSheet(
      `<h2>${esc(title)}</h2>${message ? `<p class="muted">${esc(message)}</p>` : ''}
       <div class="btn-row" style="margin-top:16px"><button class="btn" data-close>Cancel</button>
       <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button></div>`,
      { dialog: true, onClose: () => resolve(result) },
    );
    s.body.querySelector('[data-ok]').onclick = () => { result = true; s.close(); };
  });
}

export function promptDialog({ title, value = '', placeholder = '', confirmLabel = 'Save', inputmode = 'text' }) {
  return new Promise((resolve) => {
    let result = null;
    const s = openSheet(
      `<form><h2>${esc(title)}</h2>
        <input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="${inputmode}" autocomplete="off" required>
        <div class="btn-row" style="margin-top:16px"><button type="button" class="btn" data-close>Cancel</button>
        <button class="btn btn-primary">${esc(confirmLabel)}</button></div></form>`,
      { dialog: true, onClose: () => resolve(result) },
    );
    const form = s.body.querySelector('form');
    const input = form.v;
    setTimeout(() => { input.focus(); input.select(); }, 50);
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) { result = v; s.close(); }
    };
  });
}

// ---------- covers ----------
const PH_COLORS = ['#7a4b35', '#3d5a6c', '#5b6b3a', '#6d3b5a', '#8a5a1f', '#2f5d55', '#4a4372', '#7b3b3b'];
function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
export function placeholderHtml(title, author) {
  return `<div class="cover-ph" style="--ph:${PH_COLORS[hash(title) % PH_COLORS.length]}" role="img" aria-label="${esc(title)}"><b>${esc(title || 'Untitled')}</b><small>${esc(author || '')}</small></div>`;
}
export function coverHtml(book) {
  const author = (book.authors || [])[0] || '';
  if (!book.cover) return placeholderHtml(book.title, author);
  return `<img class="cover" src="${esc(book.cover)}" alt="Cover of ${esc(book.title)}" loading="lazy" decoding="async" data-title="${esc(book.title)}" data-author="${esc(author)}" referrerpolicy="no-referrer">`;
}
// Swap broken cover images for a generated placeholder.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.classList.contains('cover')) {
    img.outerHTML = placeholderHtml(img.dataset.title, img.dataset.author);
  }
}, true);

// ---------- misc ----------
/** Shrink a photo to a small JPEG data URL so it fits nicely in the database. */
export function resizeImage(file, maxSize = 480, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts + (String(ts).length === 10 ? 'T00:00' : ''));
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

const loaded = new Map();
export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error(`Could not load ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

export const plural = (n, word, many = word + 's') => `${n.toLocaleString()} ${n === 1 ? word : many}`;

export function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** "34:12" style clock from milliseconds. */
export function fmtClock(ms, { tenths = false } = {}) {
  const neg = ms < 0; ms = Math.abs(ms);
  const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${neg ? '-' : ''}${m}:${String(sec).padStart(2, '0')}${tenths ? '.' + Math.floor((ms % 1000) / 100) : ''}`;
}

/** Ask the user to pick one option from a list of big buttons. Resolves to the value or null. */
export function choose(title, options, { columns = 1, cancel = true } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const s = openSheet(`<div class="choice-grid" style="--cols:${columns}">${options.map((o, i) =>
      `<button class="btn btn-lg ${o.primary ? 'btn-primary' : ''}" data-i="${i}" ${o.style ? `style="${o.style}"` : ''}>${o.html ?? esc(o.label)}</button>`).join('')}</div>
      ${cancel ? '<button class="btn btn-ghost btn-block" data-close style="margin-top:10px">Cancel</button>' : ''}`,
    { title, onClose: () => resolve(result) });
    s.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { result = options[+b.dataset.i].value; s.close(); }
    });
  });
}

/** Keep the screen awake (live scoring, clock, golf). Returns release(). */
export async function keepAwake() {
  let lock = null;
  const get = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ } };
  await get();
  const onVis = () => { if (document.visibilityState === 'visible') get(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { document.removeEventListener('visibilitychange', onVis); try { lock?.release(); } catch { /* ignore */ } };
}

export const isPhone = () => /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) || matchMedia('(max-width: 700px)').matches;

/**
 * Draw a long list in batches as you scroll, so thousands of items don't freeze the page.
 * container gets `<div class="wrapClass">…</div>` + an invisible sentinel; more items are added
 * when the sentinel scrolls near the screen. `atLeast` keeps the same number showing after a redraw.
 * Returns { shown(), dispose() }.
 */
export function renderChunked(container, items, html, { wrapClass = '', first = 120, step = 240, atLeast = 0 } = {}) {
  let shown = Math.min(items.length, Math.max(first, atLeast));
  container.innerHTML = `<div class="${wrapClass}">${items.slice(0, shown).map(html).join('')}</div>${shown < items.length ? '<div data-sentinel class="sentinel" aria-hidden="true"></div>' : ''}`;
  const wrap = container.firstElementChild;
  const sentinel = container.querySelector('[data-sentinel]');
  if (!sentinel) return { shown: () => shown, dispose() {} };
  const more = () => {
    const next = Math.min(items.length, shown + step);
    wrap.insertAdjacentHTML('beforeend', items.slice(shown, next).map(html).join(''));
    shown = next;
    if (shown >= items.length) { io?.disconnect(); sentinel.remove(); }
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) more(); }, { rootMargin: '1200px 0px' }) : null;
  if (io) io.observe(sentinel); else while (shown < items.length) more();
  return { shown: () => shown, dispose() { io?.disconnect(); } };
}
