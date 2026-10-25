// "SENTINEL // HQ ONLINE" boot animation. Once per visit; tap/click or any key skips it.
import { LOGO, reducedMotion } from './ui.js';

export function boot({ title = 'SENTINEL // HQ ONLINE', lines = ['INITIALISING SENTINEL', 'SECURE CHANNEL', 'AGENT NETWORK'], key = 'sentinel.booted', fx = true } = {}) {
  try { if (sessionStorage.getItem(key)) return Promise.resolve(); sessionStorage.setItem(key, '1'); } catch { /* private mode */ }
  const quick = !fx || reducedMotion();
  const el = document.createElement('div');
  el.className = 'boot';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="boot-inner">${LOGO}<div class="boot-lines mono" aria-hidden="true"></div><div class="boot-title glitch mono">${title}</div></div>`;
  document.body.appendChild(el);
  const out = el.querySelector('.boot-lines');
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; el.classList.add('boot-out'); setTimeout(() => { el.remove(); resolve(); }, quick ? 0 : 450); };
    el.addEventListener('click', finish);
    addEventListener('keydown', finish, { once: true });
    if (quick) { el.classList.add('boot-show-title'); return setTimeout(finish, 500); }
    lines.forEach((l, i) => setTimeout(() => {
      const row = document.createElement('div');
      row.textContent = `> ${l} ${'.'.repeat(Math.max(3, 26 - l.length))} OK`;
      out.appendChild(row);
    }, 250 + i * 330));
    setTimeout(() => el.classList.add('boot-show-title'), 250 + lines.length * 330);
    setTimeout(finish, 900 + lines.length * 330 + 900);
  });
}
