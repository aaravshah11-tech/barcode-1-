// HQ's side of the link: waits for Agents and linked phones to call, checks who they are,
// and passes their messages to HQ's brain. (Same job the old server's WebSocket hub did.)
import { loadPeerJs, peerOptions, parse, signalOverride } from '../../shared/link.js';
import { pairCode } from '../../shared/crypto.js';

const ID_KEY = 'sentinel.hq.id';
const OFFLINE_GRACE = 20000; // a quick Wi-Fi blip shouldn't fill the Mission Log with offline/online
const SILENT_LIMIT = 40000; // no message (not even a ping) for this long = the device has gone
const MAX_MSG = 64 * 1024;

export function hqId() {
  let id = null;
  try { id = localStorage.getItem(ID_KEY); } catch { /* ignore */ }
  if (!id) { id = `sntl-${pairCode(8).toLowerCase()}`; // short enough to type: the "HQ code"
    try { localStorage.setItem(ID_KEY, id); } catch { /* ignore */ } }
  return id;
}

/**
 * Starts listening. `api(method, path, body, who)` answers linked phones.
 * onStatus({ state: 'connecting'|'online'|'offline'|'taken', detail }) keeps the dashboard informed.
 */
export async function startHost({ hq, api, onStatus = () => {} }) {
  const Peer = await loadPeerJs();
  const id = hqId();
  const offlineTimers = new Map();
  const conns = new Set();
  let peer = null, takenTries = 0, claimFails = [];

  hq.info = { ...hq.info, hqId: id, signal: signalOverride() };

  function open() {
    onStatus({ state: 'connecting' });
    peer = new Peer(id, peerOptions());
    peer.on('open', () => { takenTries = 0; onStatus({ state: 'online' }); });
    peer.on('connection', handle);
    peer.on('disconnected', () => { onStatus({ state: 'offline', detail: 'Lost the internet connection — retrying…' }); setTimeout(() => { if (!peer.destroyed) try { peer.reconnect(); } catch { /* ignore */ } }, 3000); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // Usually the old connection from a moment ago (page reload). If it persists, HQ is open elsewhere.
        peer.destroy();
        if (++takenTries > 6) return onStatus({ state: 'taken', detail: 'HQ is already open in another tab or window. Close the other one, then reload this page.' });
        onStatus({ state: 'connecting', detail: 'Taking over from the previous HQ session…' });
        setTimeout(open, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        onStatus({ state: 'offline', detail: 'No internet connection — Agents can’t find HQ until it’s back. Retrying…' });
        if (peer.destroyed) setTimeout(open, 5000);
        else setTimeout(() => { if (peer.disconnected && !peer.destroyed) try { peer.reconnect(); } catch { /* ignore */ } }, 5000);
      }
    });
  }

  function handle(conn) {
    conns.add(conn);
    let role = null, me = null, conn2 = null, lastMsg = Date.now(), dash = null;
    const send = (obj) => { if (conn.open) try { conn.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch { /* closing */ } };
    const close = () => { try { conn.close(); } catch { /* ignore */ } };
    const deny = setTimeout(() => { if (!role) close(); }, 10000);
    const watch = setInterval(() => { if (Date.now() - lastMsg > SILENT_LIMIT) close(); }, 5000);

    conn.on('data', async (raw) => {
      lastMsg = Date.now();
      if (typeof raw === 'string' && raw.length > MAX_MSG) return;
      const msg = parse(raw);
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') return send({ t: 'pong' });

      if (!role) {
        // ----- a new device with a one-time code -----
        if (msg.t === 'claim') {
          const now = Date.now();
          claimFails = claimFails.filter((t) => now - t < 60000);
          if (claimFails.length >= 10) return send({ t: 'claimError', error: 'Too many wrong codes. Wait a minute and try again.' });
          const creds = hq.claimPairCode(String(msg.code || ''), { ua: String(msg.ua || ''), label: String(msg.label || '') });
          if (!creds) { claimFails.push(now); return send({ t: 'claimError', error: 'That code is wrong, used or expired. Ask HQ for a new QR code.' }); }
          return send({ t: 'claimed', ...creds });
        }
        // ----- an Agent saying hello -----
        if (msg.t === 'hello') {
          const a = hq.agentByToken(String(msg.token || ''));
          if (!a) { send({ t: 'denied', reason: 'This device is not recruited by this HQ (or was disconnected). Scan a new QR code.' }); return setTimeout(close, 300); }
          clearTimeout(deny);
          role = 'agent'; me = a;
          clearTimeout(offlineTimers.get(a.id)); offlineTimers.delete(a.id);
          conn2 = { token: String(msg.token), sendRaw: (text) => send(text), close };
          send(hq.agentOnline(a, conn2));
          if (a.mission === 'intel') send(hq.snapshot());
          if (msg.status) hq.agentStatus(a.id, msg.status);
          return;
        }
        // ----- a linked phone opening the Command Centre -----
        if (msg.t === 'viewer') {
          const v = hq.viewerByToken(String(msg.token || ''));
          if (!v) { send({ t: 'denied', reason: 'This phone is no longer linked to HQ. Link it again from HQ’s Settings.' }); return setTimeout(close, 300); }
          clearTimeout(deny);
          role = 'viewer'; me = v;
          hq.db.updateViewer(v.id, { lastSeen: Date.now() });
          dash = { send: (text) => send(text), viewerId: v.id };
          hq.dashboards.add(dash);
          send(hq.snapshot());
          return;
        }
        return close();
      }

      if (role === 'agent') {
        if (msg.t === 'status') hq.agentStatus(me.id, msg);
        else if (msg.t === 'event') hq.agentEvent(me.id, msg);
        else if (msg.t === 'grid') hq.agentSetGrid(me.id, String(msg.key || ''), msg.cells);
      } else if (role === 'viewer' && msg.t === 'api') {
        try { send({ t: 'res', id: msg.id, ok: true, data: await api(String(msg.method || 'GET'), String(msg.path || ''), msg.body, { remote: true }) }); } catch (e) { send({ t: 'res', id: msg.id, ok: false, status: e.status || 500, error: e.message }); }
      }
    });

    const gone = () => {
      if (!conns.delete(conn)) return;
      clearTimeout(deny); clearInterval(watch);
      if (dash) hq.dashboards.delete(dash);
      if (role === 'agent') {
        const aid = me.id, c = conn2;
        offlineTimers.set(aid, setTimeout(() => { offlineTimers.delete(aid); hq.agentOffline(aid, c); }, OFFLINE_GRACE));
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
    conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') { close(); gone(); } });
  }

  // A phone that was unlinked is cut off straight away.
  hq.on('viewerRemoved', (vid) => { for (const d of hq.dashboards) if (d.viewerId === vid) { d.send(JSON.stringify({ t: 'denied', reason: 'This phone was unlinked from HQ.' })); hq.dashboards.delete(d); } });

  open();
  return { id, stop() { peer?.destroy(); } };
}
