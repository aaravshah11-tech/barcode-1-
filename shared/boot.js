// Boot sequence: SENTINEL logo, "decrypting" progress bars, system checks scrolling past, then the title.
// Once per visit; tap/click or any key skips it.
import { LOGO, reducedMotion } from './ui.js';
import { sfx } from './sfx.js';

const CHECKS = ['QUANTUM KEY EXCHANGE', 'AGENT NETWORK HANDSHAKE', 'SIGNAL INTEGRITY', 'MISSION LOG INDEX', 'THREAT MATRIX', 'HOLOGRAPHIC DISPLAY', 'PERIMETER SENSORS',
  'SECURE COMMS RELAY', 'CIPHER ENGINE', 'BIOMETRIC SCANNER', 'SATELLITE UPLINK', 'COUNTERMEASURES'];

export function boot({ title = 'SENTINEL // HQ ONLINE', lines = null, key = 'sentinel.booted', fx = true } = {}) {
  try { if (sessionStorage.getItem(key)) return Promise.resolve(); sessionStorage.setItem(key, '1'); } catch { /* private mode */ }
  const quick = !fx || reducedMotion();
  const checks = lines || CHECKS;
  const el = document.createElement('div');
  el.className = 'boot';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="boot-inner">${LOGO}
    <div class="boot-bars mono" aria-hidden="true">${['DECRYPTING SECURE CHANNEL', 'LOADING INTEL', 'CALIBRATING SENSORS'].map((l) => `<div class="boot-bar"><span>${l}</span><i><b></b></i><em>0%</em></div>`).join('')}</div>
    <div class="boot-lines mono" aria-hidden="true"></div>
    <div class="boot-title glitch mono">${title}</div><div class="boot-skip mono">TAP TO SKIP</div></div>`;
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
      const start = 150 + i * 260, len = 900 + i * 250;
      for (let s = 0; s <= 10; s++) later(() => { const pct = Math.min(100, Math.round(s * 10 + (s < 10 ? Math.random() * 6 : 0))); b.style.width = `${pct}%`; em.textContent = `${pct}%`; }, start + (len * s) / 10);
    });
    // system checks scrolling past
    checks.forEach((l, i) => later(() => {
      const row = document.createElement('div');
      row.textContent = `> ${l} ${'.'.repeat(Math.max(3, 28 - l.length))} OK`;
      out.appendChild(row);
      while (out.children.length > 6) out.firstChild.remove();
      sfx('type');
    }, 300 + i * 150));
    const end = 300 + checks.length * 150 + 200;
    later(() => { el.classList.add('boot-show-title'); sfx('granted'); }, end);
    later(finish, end + 1300);
  });
}
