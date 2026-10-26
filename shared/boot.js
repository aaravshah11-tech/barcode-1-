// Boot sequence: SENTINEL logo, "decrypting" progress bars, system checks scrolling past, then the title.
// Once per visit; tap/click or any key skips it.
import { LOGO, reducedMotion } from './ui.js';
import { sfx } from './sfx.js';

const CHECKS = ['Cryptographic module', 'Session keys', 'Agent network', 'Mission log index', 'Site plan', 'Alerting service', 'Audit trail'];

export function boot({ title = 'Sentinel · Operational', lines = null, key = 'sentinel.booted', fx = true } = {}) {
  try { if (sessionStorage.getItem(key)) return Promise.resolve(); sessionStorage.setItem(key, '1'); } catch { /* private mode */ }
  const quick = !fx || reducedMotion();
  const checks = lines || CHECKS;
  const el = document.createElement('div');
  el.className = 'boot';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="boot-inner">${LOGO}
    <div class="boot-bars mono" aria-hidden="true">${['Establishing secure session', 'Verifying integrity', 'Loading site data'].map((l) => `<div class="boot-bar"><span>${l}</span><i><b></b></i><em>0%</em></div>`).join('')}</div>
    <div class="boot-lines mono" aria-hidden="true"></div>
    <div class="boot-title">${title}</div><div class="boot-skip">Tap to skip</div></div>`;
  document.body.appendChild(el);
  const out = el.querySelector('.boot-lines');
  return new Promise((resolve) => {
    let done = false;
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); el.classList.add('boot-out'); setTimeout(() => { el.remove(); resolve(); }, quick ? 0 : 450); };
    el.addEventListener('click', finish);
    addEventListener('keydown', finish, { once: true });
    if (quick) { el.classList.add('boot-show-title'); return later(finish, 500); }
    sfx('boot');
    // progress bars
    el.querySelectorAll('.boot-bar').forEach((bar, i) => {
      const b = bar.querySelector('b'), em = bar.querySelector('em');
      const start = 100 + i * 180, len = 600 + i * 150;
      for (let s = 0; s <= 10; s++) later(() => { const pct = Math.min(100, Math.round(s * 10 + (s < 10 ? Math.random() * 6 : 0))); b.style.width = `${pct}%`; em.textContent = `${pct}%`; }, start + (len * s) / 10);
    });
    // system checks scrolling past
    checks.forEach((l, i) => later(() => {
      const row = document.createElement('div');
      row.textContent = `${l.padEnd(28, ' ')}OK`;
      out.appendChild(row);
      while (out.children.length > 6) out.firstChild.remove();
      sfx('type');
    }, 200 + i * 110));
    const end = 200 + checks.length * 110 + 300;
    later(() => { el.classList.add('boot-show-title'); sfx('granted'); }, end);
    later(finish, end + 700);
  });
}
