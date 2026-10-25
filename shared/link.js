// How SENTINEL devices find each other with nothing installed: WebRTC (built into every modern browser),
// via the PeerJS library. A free public "matchmaking" server (PeerJS) only introduces the devices;
// after that they talk directly and everything between them is encrypted. On your home Wi-Fi the
// data goes straight from phone to computer.

const SIGNAL_KEY = 'sentinel.signal';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } } };

// Tests (or a self-hosted matchmaking server) can choose another server with ?signal=host:port
{
  const s = new URLSearchParams(location.search).get('signal') || new URLSearchParams(location.hash.slice(1)).get('signal');
  if (s) store.set(SIGNAL_KEY, s === 'default' ? '' : s);
}
export const signalOverride = () => store.get(SIGNAL_KEY) || '';

export function peerOptions() {
  const s = signalOverride();
  if (!s) return { debug: 0 }; // PeerJS's free cloud server, Google STUN and PeerJS's relay
  const [host, port] = s.split(':');
  const local = /^(127\.|localhost)/.test(host);
  return { host, port: Number(port) || 9000, path: '/', secure: !local, debug: 0, config: { iceServers: local ? [] : [{ urls: 'stun:stun.l.google.com:19302' }] } };
}

let loading = null;
export function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/peerjs.min.js', import.meta.url).href;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => { loading = null; reject(new Error('Couldn’t load the connection library. Check the internet connection.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export const parse = (data) => { try { return typeof data === 'string' ? JSON.parse(data) : data; } catch { return null; } };

/**
 * Connect to HQ (by its ID). Calls onOpen(), onMessage(obj), onClose(reason) — onClose exactly once.
 * Returns { send(obj), close() }.
 */
let client = null;
export async function dial(hqId, { onOpen, onMessage, onClose, timeout = 15000 }) {
  const Peer = await loadPeerJs();
  let closed = false, conn = null, timer = null;
  const done = (why) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    client?.off?.('error', onPeerError);
    try { conn?.close(); } catch { /* ignore */ }
    onClose?.(why);
  };
  const onPeerError = (e) => {
    if (e.type === 'peer-unavailable') done('HQ is offline (is the HQ page open on the computer?)');
    else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) done('No internet connection to find HQ');
  };
  if (!client || client.destroyed) client = new Peer(peerOptions());
  if (client.disconnected && !client.destroyed) try { client.reconnect(); } catch { /* ignore */ }
  client.on('error', onPeerError);
  const go = () => {
    if (closed) return;
    conn = client.connect(hqId, { reliable: true, serialization: 'json' });
    conn.on('open', () => { clearTimeout(timer); onOpen?.(); });
    conn.on('data', (d) => { const m = parse(d); if (m) onMessage?.(m); });
    conn.on('close', () => done('Connection closed'));
    conn.on('error', () => done('Connection error'));
    conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') done(`Link ${s}`); });
  };
  timer = setTimeout(() => done('HQ didn’t answer in time'), timeout);
  if (client.open) go(); else client.once('open', go);
  return {
    send(obj) { if (closed || !conn?.open) return false; try { conn.send(JSON.stringify(obj)); return true; } catch { return false; } },
    close() { done('closed'); },
    get open() { return !closed && !!conn?.open; },
  };
}
