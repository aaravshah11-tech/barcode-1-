// Settings › Alerts: switch on push alerts for this phone, choose which ones, quiet hours.
import { registerTab } from '/dashboard/settings.js';
import { esc, $, toast, api, ago } from '/shared/ui.js';

registerTab('alerts', async (body, S) => {
  body.innerHTML = '<p class="muted">Loading…</p>';
  try { draw(body, S, await api('/api/push'), await mySubscription()); } catch (e) { body.innerHTML = `<p class="c-red">${esc(e.message)}</p>`; }
});

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function mySubscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function enable(publicKey, label) {
  if (!supported()) throw new Error(isIos() && !installed() ? 'On iPhone/iPad, first add the Command Centre to your Home Screen (Share → Add to Home Screen), open it from there, then try again.' : 'This browser can’t receive alerts. Try Chrome, Edge, Firefox or Safari.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked. Allow them for this site in your browser/phone settings, then try again.');
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  return api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label } });
}

function guessName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device';
}

function draw(body, S, P, mine) {
  const st = S.settings;
  const me = mine && P.subs.find((s) => s.endpoint === mine.endpoint);
  body.innerHTML = `
    <h2 style="margin-bottom:8px">This device</h2>
    ${me ? `<p class="small"><span class="dot on"></span> Alerts are <b>on</b> for this device (“${esc(me.label)}”).</p>
      <div class="row"><button data-test="${esc(me.id)}">Send a test alert</button><button class="btn-ghost" data-off>Turn off on this device</button></div>`
    : `<p class="small muted" style="margin-top:0">Do this on <b>your own phone</b> (the one in your pocket), not on an Agent.</p>
      <form class="row" data-enable><input name="label" value="${esc(guessName())}" maxlength="40" aria-label="Device name" style="flex:1;min-width:140px"><button class="btn-primary">🔔 Turn on alerts here</button></form>
      ${isIos() && !installed() ? '<p class="small c-amber">iPhone/iPad: first tap Share → <b>Add to Home Screen</b>, open SENTINEL from your Home Screen, log in, then come back here. Apple only allows alerts for Home Screen apps.</p>' : ''}`}

    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">Devices getting alerts</h2>
    <div data-subs>${P.subs.map((s) => `
      <div class="recon-row" data-sub="${esc(s.id)}">
        <div class="row"><b class="grow">${esc(s.label)}${s.id === me?.id ? ' <span class="tag">THIS DEVICE</span>' : ''}</b>
          <span class="small muted">via ${esc(s.service)} · added ${ago(s.createdAt)}${s.last ? ` · last alert ${s.last.ok ? 'delivered' : `<span class="c-red">failed (${esc(s.last.error)})</span>`}` : ''}</span>
          <button class="small" data-test="${esc(s.id)}">Test</button><button class="btn-ghost small" data-del aria-label="Remove ${esc(s.label)}">✕</button></div>
        <div class="alert-rules">${P.rules.map((r) => `<label class="row small" title="${esc(r.help || '')}"><input type="checkbox" data-rule="${r.key}" ${s.rules[r.key] ? 'checked' : ''}> ${esc(r.label)}</label>`).join('')}</div>
      </div>`).join('') || '<p class="muted small">No devices yet. Open the Command Centre on your phone and press “Turn on alerts here”.</p>'}</div>

    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">Quiet hours</h2>
    <form class="row" data-quiet style="align-items:flex-end">
      <label class="field" style="margin:0"><span>From</span><input type="time" name="quietStart" value="${esc(st.quietStart || '')}"></label>
      <label class="field" style="margin:0"><span>Until</span><input type="time" name="quietEnd" value="${esc(st.quietEnd || '')}"></label>
      <button>Save</button><button type="button" class="btn-ghost" data-noquiet>No quiet hours</button>
    </form>
    <p class="small muted">During quiet hours only “motion while nobody’s home” alerts get through. Everything is still written in the Mission Log.</p>
    <p class="small muted">Privacy: alerts contain only text like “Door opened”. HQ encrypts them before they go through Apple’s or Google’s push service, so they can’t read them. HQ needs an internet connection to send them.</p>`;

  const redraw = async (P2) => draw(body, S, P2 || await api('/api/push'), await mySubscription());
  const call = async (fn, msg) => { try { await redraw(await fn()); if (msg) toast(msg); } catch (e) { toast(e.message, { kind: 'err' }); } };

  $('[data-enable]', body)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Asking permission…';
    call(() => enable(P.publicKey, e.target.label.value), 'Alerts on — a welcome alert is on its way').finally(() => { btn.disabled = false; });
  });
  $('[data-off]', body)?.addEventListener('click', () => call(async () => {
    const sub = await mySubscription();
    const r = await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub?.endpoint } });
    await sub?.unsubscribe();
    return r;
  }, 'Alerts off for this device'));
  body.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', () => call(() => api(`/api/push/${b.dataset.test}/test`, { method: 'POST' }), 'Test alert sent')));
  body.querySelectorAll('[data-sub]').forEach((row) => {
    const id = row.dataset.sub;
    $('[data-del]', row).addEventListener('click', () => call(() => api(`/api/push/${id}`, { method: 'DELETE' }), 'Device removed'));
    row.querySelectorAll('[data-rule]').forEach((cb) => cb.addEventListener('change', () => call(() => api(`/api/push/${id}`, { method: 'PATCH', body: { rules: { [cb.dataset.rule]: cb.checked } } }), 'Saved')));
  });
  const saveQuiet = (quietStart, quietEnd) => call(async () => { S.settings = await api('/api/settings', { method: 'PATCH', body: { quietStart, quietEnd } }); return null; }, quietStart ? `Quiet ${quietStart}–${quietEnd}` : 'Quiet hours off');
  $('[data-quiet]', body).addEventListener('submit', (e) => { e.preventDefault(); saveQuiet(e.target.quietStart.value, e.target.quietEnd.value); });
  $('[data-noquiet]', body).addEventListener('click', () => saveQuiet('', ''));
}
