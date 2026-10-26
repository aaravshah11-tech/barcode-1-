// Alerts on THIS device (the HQ computer or a linked phone) while SENTINEL is open on it:
// a notification, plus a siren beep and red flash for THREAT RED. Choices are saved per device.
import { registerTab } from './settings.js';
import { esc, $, toast } from '../shared/ui.js';
import { inQuietHours, ruleFor } from '../shared/alert-rules.js';

const KEY = 'sentinel.alerts';
export const RULES = [
  { key: 'awayMotion', label: 'THREAT RED: an armed sensor goes off (AWAY, NIGHT, LOCKDOWN) or PANIC', default: true },
  { key: 'knock', label: 'Someone presses a DOOR PANEL', default: true },
  { key: 'door', label: 'A door is opened (even when someone’s home)', default: false },
  { key: 'sound', label: 'Loud sound (when someone’s home)', default: false },
  { key: 'offline', label: 'An Agent goes offline', default: true },
];
const defaults = { ...Object.fromEntries(RULES.map((r) => [r.key, r.default])), beep: true, quietStart: '', quietEnd: '' };
export function prefs() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; } }
const savePrefs = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };

const last = new Map();
export const sent = []; // for the automated tests
let swReg = null;
async function registration() {
  if (swReg || !('serviceWorker' in navigator)) return swReg;
  try { swReg = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url).href); await navigator.serviceWorker.ready; } catch { swReg = null; }
  return swReg;
}
if ('Notification' in window && Notification.permission === 'granted') registration();

export async function notifyEvent(ev, S) {
  if (Date.now() - ev.ts > 60000) return; // only new things
  const r = ruleFor(ev);
  if (!r) return;
  const p = prefs();
  if (!p[r.rule]) return;
  if (!r.red && inQuietHours(p.quietStart, p.quietEnd)) return;
  if (Date.now() - (last.get(r.rule) || 0) < 30000) return; // at most one of each kind every 30 s
  last.set(r.rule, Date.now());
  sent.push({ ...r, at: Date.now() });
  if (r.red) { flash(); if (p.beep) siren(); }
  await show(r.title, r.body, r.rule, r.red);
}

async function show(title, body, tag, red = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = { body, tag, renotify: true, requireInteraction: red, icon: new URL('../shared/icons/icon-192.png', import.meta.url).href };
  try { const reg = await registration(); if (reg) { await reg.showNotification(title, opts); return true; } } catch { /* fall back */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}

function flash() {
  const el = document.createElement('div');
  el.className = 'red-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
let ac = null;
addEventListener('pointerdown', () => { try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch { /* no audio */ } }, { capture: true });
function siren() {
  if (!ac) return;
  for (let i = 0; i < 6; i++) {
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.35;
    o.frequency.setValueAtTime(i % 2 ? 660 : 990, t);
    g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.32);
  }
}

function render(body, S) {
  const p = prefs();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  body.innerHTML = `
    <h2 style="margin-bottom:8px">Notifications on this device</h2>
    <p class="small" style="margin-top:0" data-perm>${perm === 'granted' ? '<span class="dot on"></span> Notifications are <b>on</b> for this device.'
      : perm === 'denied' ? '<span class="c-red">Notifications are blocked for this site.</span> Allow them in the browser’s site settings (padlock icon), then reload.'
        : perm === 'unsupported' ? `<span class="c-amber">This browser can’t show notifications${ios ? ' unless SENTINEL is added to the Home Screen and opened from there' : ''}.</span> You’ll still get the on-screen flash and beep.`
          : 'Turn them on to hear about THREAT RED and the rest while SENTINEL is in the background.'}</p>
    <div class="row">${perm === 'default' ? '<button class="btn-primary" data-allow>Turn on notifications</button>' : ''}<button data-test>Send a test alert</button></div>
    <p class="small muted">Alerts work while SENTINEL is open on this device (it can be in a background tab on a computer). On a phone, keep SENTINEL open on screen — phones pause pages in the background.</p>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">Alert me about</h2>
    <div class="alert-rules">${RULES.map((r) => `<label class="row small"><input type="checkbox" data-rule="${r.key}" ${p[r.key] ? 'checked' : ''}> ${esc(r.label)}</label>`).join('')}
      <label class="row small"><input type="checkbox" data-rule="beep" ${p.beep ? 'checked' : ''}> Beep and flash for THREAT RED</label></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">Quiet hours</h2>
    <form class="row" data-quiet style="align-items:flex-end">
      <label class="field" style="margin:0"><span>From</span><input type="time" name="quietStart" value="${esc(p.quietStart)}"></label>
      <label class="field" style="margin:0"><span>Until</span><input type="time" name="quietEnd" value="${esc(p.quietEnd)}"></label>
      <button>Save</button><button type="button" class="btn-ghost" data-noquiet>No quiet hours</button>
    </form>
    <p class="small muted">During quiet hours only THREAT RED gets through. Everything is still written in the Mission Log.</p>`;
  $('[data-allow]', body)?.addEventListener('click', async () => {
    const r = await Notification.requestPermission();
    if (r === 'granted') { await registration(); await show('SENTINEL // ALERTS ONLINE', 'This device will now show SENTINEL alerts.', 'test'); toast('Notifications on'); }
    else toast('Notifications were not allowed.', { kind: 'err' });
    render(body, S);
  });
  $('[data-test]', body).addEventListener('click', async () => {
    const ok = await show('SENTINEL test alert', 'If you can read this, alerts work on this device.', 'test');
    flash(); if (prefs().beep) siren();
    toast(ok ? 'Test alert sent' : 'Flash and beep only — notifications aren’t on for this device');
  });
  body.querySelectorAll('[data-rule]').forEach((cb) => cb.addEventListener('change', () => { savePrefs({ ...prefs(), [cb.dataset.rule]: cb.checked }); toast('Saved'); }));
  const quiet = (a, b) => { savePrefs({ ...prefs(), quietStart: a, quietEnd: b }); toast(a ? `Quiet ${a}–${b}` : 'Quiet hours off'); };
  $('[data-quiet]', body).addEventListener('submit', (e) => { e.preventDefault(); quiet(e.target.quietStart.value, e.target.quietEnd.value); });
  $('[data-noquiet]', body).addEventListener('click', () => { quiet('', ''); body.querySelector('[name=quietStart]').value = ''; body.querySelector('[name=quietEnd]').value = ''; });
}
registerTab('alerts', render);
