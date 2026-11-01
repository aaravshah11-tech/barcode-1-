// ALERTS ON THIS DEVICE (the HQ computer or a linked phone) while SENTINEL is open on it.
// Sounds and notifications follow the alert's grade:
//   Info      nothing (it's for the record)
//   Advisory  one soft tone (not in quiet hours); a notification only On Watch or if you chose "from Advisory"
//   Alert     two-tone + notification (not in quiet hours)
//   Critical  two-tone that repeats until someone acknowledges it, red flash, notification — always
// ON WATCH (this device): keeps the screen awake, notifies from Advisory up, and shows ON WATCH in the status strip.
import { registerTab } from './settings.js';
import { esc, $, toast } from '../shared/ui.js';
import { shouldNotify } from '../shared/grading.js';
import { SEV_LABEL, SEV_RANK } from '../shared/triage.js';
import { sfx } from '../shared/sfx.js';

const WATCH_KEY = 'sentinel.onwatch';
export const sent = []; // notifications shown (for the automated tests)
window.__alertsSent = sent;
const seen = new Set();
let swReg = null;
async function registration() {
  if (swReg || !('serviceWorker' in navigator)) return swReg;
  try { swReg = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url).href); await navigator.serviceWorker.ready; } catch { swReg = null; }
  return swReg;
}
if ('Notification' in window && Notification.permission === 'granted') registration();

// ---------- On Watch ----------
let wakeLock = null;
export const onWatch = () => { try { return localStorage.getItem(WATCH_KEY) === '1'; } catch { return false; } };
export async function setOnWatch(on) {
  try { localStorage.setItem(WATCH_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (on) {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
    await keepAwake();
  } else { try { await wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; }
  return on;
}
async function keepAwake() {
  if (!onWatch() || !('wakeLock' in navigator)) return;
  try { if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* needs the page visible */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
if (onWatch()) keepAwake();

/** A new or upgraded alert arrived from HQ. */
export async function notifyAlert(alert, S) {
  if (!alert || alert.status !== 'new' || Date.now() - (alert.lastTs || alert.ts) > 60000) return;
  const key = `${alert.id}:${alert.severity}`;
  if (seen.has(key)) return; // one sound/notification per alert and grade (repeats merge into it)
  seen.add(key);
  const s = S.settings || {}, watch = onWatch();
  const loud = shouldNotify(alert.severity, { now: Date.now(), quiet: s.quiet, onWatch: watch });
  if (alert.severity === 'ADVISORY' && !(s.quiet?.on && inQuiet(s.quiet))) sfx('advisory');
  if (!loud) return;
  if (alert.severity === 'ALERT') sfx('alert');
  if (alert.severity === 'CRITICAL') { sfx('critical'); flash(); }
  const min = watch ? 'ADVISORY' : s.notifyMin || 'ALERT';
  if (SEV_RANK[alert.severity] < SEV_RANK[min] && alert.severity !== 'CRITICAL') return;
  if (!document.hidden && !watch && alert.severity !== 'CRITICAL') return; // you're looking at the screen already
  sent.push({ id: alert.id, severity: alert.severity, at: Date.now() });
  await show(`${SEV_LABEL[alert.severity].toUpperCase()} · ${alert.title}`, `${alert.id}${alert.explanation ? ` — ${alert.explanation}` : ''}`, alert.id, alert.severity === 'CRITICAL');
}
const inQuiet = (q) => { const d = new Date(), t = d.getHours() * 60 + d.getMinutes(), m = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5)), a = m(q.from), b = m(q.to); return a < b ? t >= a && t < b : t >= a || t < b; };

/** Critical alerts repeat their tone every 6 s until someone acknowledges them. */
export function criticalRepeat(S) {
  return setInterval(() => {
    if ((S.alerts || []).some((a) => a.severity === 'CRITICAL' && a.status === 'new' && Date.now() - a.ts < 30 * 60000)) sfx('critical');
  }, 6000);
}
/** The daily digest: a notification on this device. */
export function notifyDigest(d) { if (onWatch() || document.hidden) show(d.title, d.lines.join(' '), 'digest'); }

async function show(title, body, tag, urgent = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const opts = { body, tag, renotify: true, requireInteraction: urgent, icon: new URL('../shared/icons/icon-192.png', import.meta.url).href };
  try { const reg = await registration(); if (reg) { await reg.showNotification(title, opts); return true; } } catch { /* fall back */ }
  try { new Notification(title, opts); return true; } catch { return false; }
}
function flash() {
  const el = document.createElement('div');
  el.className = 'red-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------- Settings › Alerts ----------
function render(body, S) {
  const st = S.settings || {};
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const q = st.quiet || { on: true, from: '23:00', to: '07:00' };
  body.innerHTML = `
    <h2 style="margin-bottom:8px">Notifications on this device</h2>
    <p class="small" style="margin-top:0" data-perm>${perm === 'granted' ? '<span class="dot on"></span> Notifications are <b>on</b> for this device.'
      : perm === 'denied' ? '<span class="c-red">Notifications are blocked for this site.</span> Allow them in the browser’s site settings (padlock icon), then reload.'
        : perm === 'unsupported' ? `<span class="c-amber">This browser can’t show notifications${ios ? ' unless SENTINEL is added to the Home Screen and opened from there' : ''}.</span> You’ll still get the sounds and the red flash.`
          : 'Turn them on to hear about alerts while SENTINEL is in the background.'}</p>
    <div class="row">${perm === 'default' ? '<button class="btn-primary" data-allow>Turn on notifications</button>' : ''}<button data-test>Send a test alert</button></div>
    <p class="small muted">Notifications work while SENTINEL is open on this device (a background tab is fine on a computer). Phones pause pages in the background, so keep SENTINEL on screen there.</p>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">On Watch (this device)</h2>
    <label class="row small"><input type="checkbox" data-onwatch ${onWatch() ? 'checked' : ''}> On Watch: keep this screen awake, notify from Advisory up, and show ON WATCH in the status strip</label>
    <p class="small muted">A web page can keep the screen on but can’t stop the computer sleeping by itself: in macOS System Settings › Lock Screen, set “Turn display off” to Never while on watch, and keep the lid open.</p>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">For every device</h2>
    <form data-alertset class="alert-set">
      <label class="field"><span>Notify from</span><select name="notifyMin">${[['ADVISORY', 'Advisory and above'], ['ALERT', 'Alert and above'], ['CRITICAL', 'Critical only']].map(([v, l]) => `<option value="${v}" ${st.notifyMin === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="row" style="align-items:flex-end"><label class="row small"><input type="checkbox" name="quietOn" ${q.on ? 'checked' : ''}> Quiet hours</label>
        <label class="field" style="margin:0"><span>From</span><input type="time" name="quietFrom" value="${esc(q.from)}"></label>
        <label class="field" style="margin:0"><span>Until</span><input type="time" name="quietTo" value="${esc(q.to)}"></label></div>
      <p class="small muted">During quiet hours only <b>Critical</b> makes a sound or notification. Everything is still in Triage and the log.</p>
      <div class="row" style="align-items:flex-end"><label class="row small"><input type="checkbox" name="digestOn" ${st.digestOn !== false ? 'checked' : ''}> Daily digest at</label>
        <label class="field" style="margin:0"><span>Time</span><input type="time" name="digestTime" value="${esc(st.digestTime || '08:00')}"></label></div>
      <label class="field"><span>Warn when an Agent hasn’t reported for</span><select name="staleMinutes">${[5, 15, 30, 60, 120].map((m) => `<option value="${m}" ${Number(st.staleMinutes || 15) === m ? 'selected' : ''}>${m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}</option>`).join('')}</select></label>
      <button class="btn-primary">Save</button>
    </form>`;
  $('[data-allow]', body)?.addEventListener('click', async () => {
    const r = await Notification.requestPermission();
    if (r === 'granted') { await registration(); await show('SENTINEL — notifications on', 'This device will now show SENTINEL alerts.', 'test'); toast('Notifications on'); }
    else toast('Notifications were not allowed.', { kind: 'err' });
    render(body, S);
  });
  $('[data-test]', body).addEventListener('click', async () => {
    const ok = await show('ALERT · SENTINEL test', 'If you can read this, alerts work on this device.', 'test');
    sfx('alert');
    toast(ok ? 'Test alert sent' : 'Sound only — notifications aren’t on for this device');
  });
  $('[data-onwatch]', body).addEventListener('change', async (e) => { await setOnWatch(e.target.checked); S.onWatch = e.target.checked; S.onWatchChanged?.(); toast(e.target.checked ? 'On Watch' : 'Off watch'); });
  $('[data-alertset]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      S.settings = await S.api('/settings', { method: 'PATCH', body: { notifyMin: f.notifyMin.value, quiet: { on: f.quietOn.checked, from: f.quietFrom.value, to: f.quietTo.value }, digestOn: f.digestOn.checked, digestTime: f.digestTime.value, staleMinutes: Number(f.staleMinutes.value) } });
      toast('Alert settings saved');
    } catch (x) { toast(x.message, { kind: 'err' }); }
  });
}
registerTab('alerts', render);
