// How the Command Centre reaches HQ's brain:
//   startLocal()  — on the HQ computer: the brain runs right here in this page.
//   startRemote() — on a linked phone: talks to the HQ computer over an encrypted link.
// Both give the dashboard the same thing: api(path, {method, body}) and onMessage(fn).
import { openStore } from './brain/store.js';
import { HQ } from './brain/hq.js';
import { makeApi } from './brain/api.js';
import { startHost } from './brain/host.js';
import { makeAuth } from './brain/auth.js';
import { startNetmon } from './brain/netmon.js';
import { dial } from '../shared/link.js';

export async function startLocal({ onStatus }) {
  // Only one HQ per browser: a second tab would fight the first one for HQ's address.
  if (navigator.locks) {
    // After a reload the old page may hold on for a moment, so keep asking for a few seconds.
    let got = false;
    for (let i = 0; i < 12 && !got; i++) {
      got = await new Promise((resolve) => navigator.locks.request('sentinel-hq', { ifAvailable: true }, (lock) => { resolve(!!lock); return lock ? new Promise(() => {}) : undefined; }));
      if (!got) await new Promise((r) => setTimeout(r, 400));
    }
    if (!got) throw Object.assign(new Error('HQ is already open in another tab or window on this computer. Use that one (or close it and reload this page).'), { taken: true });
  }
  const db = await openStore();
  const hq = new HQ({ db }).start();
  const auth = makeAuth({ db, idleMin: () => hq.settings().autoLockMin });
  const netmon = startNetmon({ hq, db });
  hq.netSummary = () => netmon.summary();
  hq.netmon = netmon;
  const call = makeApi({ hq, db, auth });
  const listeners = new Set();
  hq.dashboards.add({ send: (text) => { const msg = JSON.parse(text); listeners.forEach((f) => f(msg)); } });
  let net = { state: 'connecting' };
  const host = await startHost({ hq, api: call, auth, onStatus: (s) => { net = s; hq.info = { ...hq.info, net: s }; onStatus?.(s); } }).catch((e) => { onStatus?.({ state: 'offline', detail: e.message }); return null; });
  if (!host) hq.info = { ...hq.info, hqId: null };
  if (!db.persistent) onStatus?.({ state: net.state, detail: 'This browser won’t let HQ save its Mission Log (private window?). It will be lost when you close the page.' });
  hq.logEvent({ kind: 'system', message: 'HQ session started' });
  window.__hq = { hq, db, api: call, netmon }; // for the automated tests
  return {
    local: true,
    files: { get: (k) => db.getFile(k), put: (k, b) => db.putFile(k, b), del: (k) => db.deleteFile(k) },
    api: async (path, { method = 'GET', body } = {}) => call(method, path, body ? structuredClone(body) : undefined, { remote: false }),
    onMessage: (f) => listeners.add(f),
  };
}

const VIEW_KEY = 'sentinel.viewer';
const load = () => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch { return null; } };
const save = (v) => { try { if (v) localStorage.setItem(VIEW_KEY, JSON.stringify(v)); else localStorage.removeItem(VIEW_KEY); } catch { /* ignore */ } };
export const viewerCreds = load;
export const forgetViewer = () => save(null);

/** Links this phone to HQ with a one-time code (from HQ › Settings › Phones). */
export function linkPhone(hqId, code, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); link?.close?.(); } };
    let link;
    dial(hqId, {
      onOpen: () => link.send({ t: 'claim', code, ua: navigator.userAgent, label }),
      onMessage: (m) => {
        if (m.t === 'claimed' && m.role === 'viewer') { save({ hqId, token: m.token, label: m.label, linkedAt: Date.now() }); finish(resolve, m); }
        else if (m.t === 'claimed') finish(reject, new Error('That code was for recruiting an Agent, not linking a phone.'));
        else if (m.t === 'claimError') finish(reject, new Error(m.error));
      },
      onClose: (why) => finish(reject, new Error(why)),
    }).then((l) => { link = l; }, (e) => finish(reject, e));
  });
}

/** A linked phone's view of HQ. Reconnects by itself. */
const SESSION_KEY = 'sentinel.viewer.session';
const getSession = () => { try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } };
const setSession = (v) => { try { if (v) sessionStorage.setItem(SESSION_KEY, v); else sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } };

export function startRemote({ onStatus, onDenied, onLocked }) {
  const creds = load();
  const listeners = new Set();
  const pending = new Map();
  let link = null, seq = 0, retry = 1000, pinger = null, lastMsg = 0;

  function connect() {
    onStatus?.({ state: 'connecting' });
    dial(creds.hqId, {
      onOpen: () => { link.send({ t: 'viewer', token: creds.token, session: getSession() }); },
      onMessage: (m) => {
        lastMsg = Date.now();
        if (m.t === 'pong') return;
        if (m.t === 'denied') { save(null); onDenied?.(m.reason); return; }
        if (m.t === 'locked') { setSession(''); onStatus?.({ state: 'online' }); onLocked?.(); return; }
        if (m.t === 'res') { const p = pending.get(m.id); if (p) { pending.delete(m.id); if (m.ok) p.resolve(m.data); else p.reject(Object.assign(new Error(m.error), { status: m.status })); } return; }
        if (m.t === 'state') { retry = 1000; onStatus?.({ state: 'online' }); }
        listeners.forEach((f) => f(m));
      },
      onClose: (why) => {
        clearInterval(pinger);
        for (const p of pending.values()) p.reject(new Error('Lost contact with HQ'));
        pending.clear();
        onStatus?.({ state: 'offline', detail: why });
        setTimeout(connect, retry);
        retry = Math.min(15000, retry * 2);
      },
    }).then((l) => {
      link = l;
      lastMsg = Date.now();
      clearInterval(pinger);
      pinger = setInterval(() => { link.send({ t: 'ping' }); if (Date.now() - lastMsg > 40000) link.close(); }, 10000);
    }, (e) => { onStatus?.({ state: 'offline', detail: e.message }); setTimeout(connect, 5000); });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && link && !link.open) { retry = 1000; } });
  connect();

  return {
    local: false,
    api: (path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      if (path === '/auth/unlock' || path === '/auth/lock') { const orig = resolve; resolve = (d) => { setSession(path === '/auth/unlock' ? d?.session : ''); orig(d); }; }
      if (!link?.send({ t: 'api', id, method, path, body })) return reject(new Error('Not connected to HQ right now.'));
      pending.set(id, { resolve, reject });
      setTimeout(() => { if (pending.delete(id)) reject(new Error('HQ didn’t answer.')); }, 15000);
    }),
    onMessage: (f) => listeners.add(f),
  };
}
