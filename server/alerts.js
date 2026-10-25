// Alerts to your phone (web push). HQ encrypts a short text ("Motion while nobody's home")
// and hands it to your phone's push service (Apple or Google), which can't read it.
// Only event text is ever sent — never pictures or sound.
import webpush from 'web-push';
import { newId } from './security.js';
import { ACTIVITY_KINDS } from './threat.js';

/** What each alert switch means. Defaults are what a new phone gets. */
export const RULES = [
  { key: 'awayMotion', label: 'Motion, door or noise while nobody’s home', help: 'The big one. Still alerts during quiet hours.', default: true },
  { key: 'arrival', label: 'Someone arrives home', default: true },
  { key: 'departure', label: 'Someone leaves home', default: false },
  { key: 'door', label: 'A door is opened (even when someone’s home)', default: false },
  { key: 'knock', label: 'Someone presses a DOOR PANEL', default: true },
  { key: 'sound', label: 'Loud sound (when someone’s home)', default: false },
  { key: 'offline', label: 'An Agent goes offline', default: true },
];
const defaults = () => Object.fromEntries(RULES.map((r) => [r.key, r.default]));
const THROTTLE_MS = 30000; // at most one alert of each type per phone every 30 s

/** Is "now" inside quiet hours? Handles ranges that cross midnight (22:00 → 07:00). */
export function inQuietHours(start, end, date = new Date()) {
  if (!start || !end || start === end) return false;
  const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const now = date.getHours() * 60 + date.getMinutes(), a = mins(start), b = mins(end);
  return a < b ? now >= a && now < b : now >= a || now < b;
}

export function startAlerts({ hq, db, log = () => {} }) {
  let vapid = db.getSetting('vapid');
  if (!vapid?.publicKey) { vapid = webpush.generateVAPIDKeys(); db.setSetting('vapid', vapid); }
  // Apple's push service insists on a contact address; it is never used to contact anyone.
  webpush.setVapidDetails('mailto:sentinel-hq@example.com', vapid.publicKey, vapid.privateKey);

  const lastSent = new Map(); // `${subId}:${rule}` -> time
  const results = new Map(); // subId -> { at, ok, error }

  async function sendTo(sub, payload) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), { TTL: 3600, urgency: payload.level === 'alert' ? 'high' : 'normal', timeout: 10000 });
      results.set(sub.id, { at: Date.now(), ok: true });
      return true;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { db.removePushSub(sub.id); log(`  Alerts: “${sub.label}” unsubscribed — removed.`); }
      results.set(sub.id, { at: Date.now(), ok: false, error: e.statusCode ? `push service said ${e.statusCode}` : e.message });
      return false;
    }
  }

  /** Send to every phone that has `rule` switched on (respecting quiet hours and the 30 s limit). */
  function alert(rule, payload) {
    const s = hq.settings();
    const quiet = inQuietHours(s.quietStart, s.quietEnd) && rule !== 'awayMotion';
    if (quiet) return 0;
    let n = 0;
    for (const sub of db.pushSubs()) {
      const rules = { ...defaults(), ...sub.rules };
      if (!rules[rule]) continue;
      const k = `${sub.id}:${rule}`, now = Date.now();
      if (now - (lastSent.get(k) || 0) < THROTTLE_MS) continue;
      lastSent.set(k, now);
      sendTo(sub, { tag: rule, url: '/', ...payload });
      n++;
    }
    return n;
  }

  const onEvent = (ev) => {
    const msg = ev.message;
    if (ev.kind === 'arrival') return alert('arrival', { title: '🏠 Home', body: msg, level: 'info' });
    if (ev.kind === 'departure') return alert('departure', { title: '🚪 Left home', body: msg, level: 'info' });
    if (!ACTIVITY_KINDS.has(ev.kind)) return;
    if (hq.threat?.away) return alert('awayMotion', { title: '🔴 SENTINEL: THREAT RED', body: `${msg} — nobody’s home`, level: 'alert' });
    if (ev.kind === 'door' && /opened/i.test(msg)) return alert('door', { title: '🚪 Door opened', body: msg, level: 'warn' });
    if (ev.kind === 'knock') return alert('knock', { title: '🔔 Someone’s at the door', body: msg, level: 'warn' });
    if (ev.kind === 'sound') return alert('sound', { title: '🔊 Loud sound', body: msg, level: 'warn' });
  };
  const onOffline = (a) => alert('offline', { title: '⚠ Agent offline', body: `AGENT ${a.codename} has lost contact with HQ`, level: 'warn' });
  hq.on('event', onEvent);
  hq.on('agentOffline', onOffline);

  const view = () => ({
    publicKey: vapid.publicKey,
    rules: RULES,
    subs: db.pushSubs().map((s) => ({ id: s.id, label: s.label, rules: { ...defaults(), ...s.rules }, createdAt: s.createdAt, service: hostOf(s.endpoint), endpoint: s.endpoint, last: results.get(s.id) || null })),
  });

  async function api(req, res, url, { sendJson, readJson }) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/push')) return false;
    if (p === '/api/push' && m === 'GET') return sendJson(res, 200, view());
    if (p === '/api/push/subscribe' && m === 'POST') {
      const { subscription: s, label } = await readJson(req);
      const ok = s && typeof s.endpoint === 'string' && s.endpoint.length < 2000 && s.endpoint.startsWith('https://')
        && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
      if (!ok) return sendJson(res, 400, { error: 'That doesn’t look like a push subscription.' });
      const existing = db.pushSubs().find((x) => x.endpoint === s.endpoint);
      const sub = db.savePushSub({ id: existing?.id || newId(), endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, label: String(label || 'My phone').trim().slice(0, 40) || 'My phone', rules: existing?.rules || defaults() });
      hq.logEvent({ kind: 'system', message: `Alerts switched on for “${sub.label}”` });
      sendTo(sub, { title: 'SENTINEL // ALERTS ONLINE', body: 'This device will now get SENTINEL alerts.', tag: 'test', level: 'info', url: '/' });
      return sendJson(res, 200, { ...view(), id: sub.id });
    }
    if (p === '/api/push/unsubscribe' && m === 'POST') {
      const { endpoint } = await readJson(req);
      db.removePushSub(String(endpoint || ''));
      return sendJson(res, 200, view());
    }
    const mm = p.match(/^\/api\/push\/([\w-]{1,40})(\/test)?$/);
    const sub = mm && db.pushSubs().find((x) => x.id === mm[1]);
    if (!sub) return sendJson(res, 404, { error: 'No such device.' });
    if (mm[2] && m === 'POST') {
      const ok = await sendTo(sub, { title: '🛰 SENTINEL test alert', body: 'If you can read this, alerts work.', tag: 'test', level: 'info', url: '/' });
      return ok ? sendJson(res, 200, view()) : sendJson(res, 502, { error: `Couldn’t deliver: ${results.get(sub.id)?.error}. Is HQ connected to the internet?` });
    }
    if (m === 'PATCH') {
      const b = await readJson(req);
      if (b.rules && typeof b.rules === 'object') db.updatePushRules(sub.id, Object.fromEntries(RULES.map((r) => [r.key, r.key in b.rules ? !!b.rules[r.key] : { ...defaults(), ...sub.rules }[r.key]])));
      if (typeof b.label === 'string' && b.label.trim()) db.savePushSub({ ...db.pushSubs().find((x) => x.id === sub.id), label: b.label.trim().slice(0, 40) });
      return sendJson(res, 200, view());
    }
    if (m === 'DELETE') { db.removePushSub(sub.id); return sendJson(res, 200, view()); }
    return false;
  }

  return { api, publicApi: async () => false, alert, stop() { hq.off('event', onEvent); hq.off('agentOffline', onOffline); } };
}

function hostOf(endpoint) {
  try {
    const h = new URL(endpoint).hostname;
    return /apple/.test(h) ? 'Apple' : /google|fcm/.test(h) ? 'Google' : /mozilla/.test(h) ? 'Mozilla' : /windows|notify/.test(h) ? 'Microsoft' : h;
  } catch { return '?'; }
}
