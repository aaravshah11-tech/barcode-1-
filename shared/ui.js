// Small UI helpers shared by the Command Centre and Agents.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function toast(msg, { kind = '', ms = 3500 } = {}) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** A dialog. Returns { el, body, close }. */
export function sheet(html, { title = '', onClose, wide = false } = {}) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${wide ? 'style="width:min(900px,100%)"' : ''}>
    ${title ? `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn btn-ghost" data-close aria-label="Close">✕</button></div>` : ''}
    <div class="sheet-body">${html}</div></div>`;
  let closed = false;
  const prevFocus = document.activeElement;
  const api = {
    el: back.querySelector('.sheet'), body: back.querySelector('.sheet-body'),
    close() { if (closed) return; closed = true; back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); prevFocus?.focus?.(); },
  };
  const onKey = (e) => { if (e.key === 'Escape') api.close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) api.close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  setTimeout(() => (back.querySelector('[autofocus]') || back.querySelector('.sheet button, .sheet input'))?.focus(), 30);
  return api;
}

export function confirmBox(title, message, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const s = sheet(`<p>${esc(message)}</p><div class="row" style="justify-content:flex-end;margin-top:16px"><button data-close>Cancel</button><button class="${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button></div>`, { title, onClose: () => resolve(result) });
    s.body.querySelector('[data-ok]').onclick = () => { result = true; s.close(); };
  });
}

/** Set an element's text (the old typewriter effect is gone; kept for older callers). */
export function typewrite(el, text) { el.textContent = text; return Promise.resolve(); }

export const clock = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dayClock = (ts) => { const d = new Date(ts); const today = new Date().toDateString() === d.toDateString(); return today ? clock(ts) : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock(ts)}`; };
export function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** SVG QR code for a link (uses the bundled qrcode-generator library). */
export async function qrSvg(text, { cell = 6 } = {}) {
  if (!window.qrcode) await loadScript(new URL('../vendor/qrcode.js', import.meta.url).href);
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin: 3, scalable: true });
}
export function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`)); document.head.appendChild(s); });
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(data?.error || `HQ said ${res.status}`), { status: res.status });
  return data;
}

/** The SENTINEL mark: a plain hexagon with a horizontal bar (no animation). */
export const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5 28 9.5v13L16 29.5 4 22.5v-13z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 16h12" stroke="currentColor" stroke-width="2"/></svg>`;

/** Classification banners across the top and bottom of the screen (styled like system markings). */
export const CLASSIFICATION = 'SENTINEL // RESTRICTED – HOUSEHOLD';
export function classificationBanners(text = CLASSIFICATION, { top = true, bottom = true } = {}) {
  document.querySelectorAll('.cbanner').forEach((b) => b.remove());
  for (const [on, pos] of [[top, 'top'], [bottom, 'bottom']]) {
    if (!on) continue;
    const el = document.createElement('div');
    el.className = `cbanner ${pos}`;
    el.setAttribute('role', 'note');
    el.textContent = text;
    document.body.appendChild(el);
  }
  document.body.classList.toggle('has-cb', top && bottom);
}
