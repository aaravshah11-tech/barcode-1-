// The live link: WebSockets to every dashboard and Agent.
//   Dashboard  ← state, agent, event, threat …            (logged-in browsers)
//   Agent      → hello(token), status, event, grid, pong   ← welcome, signed cmd
import { WebSocketServer } from 'ws';
import { sameOrigin } from './security.js';

const OFFLINE_GRACE = 20000; // a quick Wi-Fi blip shouldn't fill the Mission Log with offline/online
const HEARTBEAT = 20000;

export function attachHub(server, { hq, sessionOf }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const offlineTimers = new Map();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'https://hq');
    if (url.pathname !== '/ws') return socket.destroy();
    // Only pages served by HQ itself may connect.
    if (!sameOrigin(req)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (sessionOf(req)) dashboard(ws); else agent(ws);
    });
  });

  // Ping everyone regularly; drop connections that stop answering.
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) { ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
  }, HEARTBEAT);
  wss.on('close', () => clearInterval(beat));

  function dashboard(ws) {
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const client = { send: (text) => ws.readyState === 1 && ws.send(text) };
    hq.dashboards.add(client);
    ws.send(JSON.stringify(hq.snapshot()));
    ws.on('message', (raw) => { if (String(raw) === 'ping') ws.send('pong'); });
    ws.on('close', () => hq.dashboards.delete(client));
  }

  function agent(ws) {
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    let me = null;
    let conn = null;
    const deny = setTimeout(() => ws.close(4401, 'Who are you?'), 8000);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!me) {
        if (msg.t !== 'hello') return;
        const a = hq.agentByToken(String(msg.token || ''));
        if (!a) { ws.send(JSON.stringify({ t: 'denied', reason: 'This device is not paired with HQ (or was disconnected). Scan a new QR code.' })); return ws.close(4401, 'Not paired'); }
        clearTimeout(deny);
        me = a;
        clearTimeout(offlineTimers.get(a.id));
        offlineTimers.delete(a.id);
        conn = { token: String(msg.token), sendRaw: (text) => ws.readyState === 1 && ws.send(text), close: (why) => ws.close(4000, why) };
        ws.send(JSON.stringify(hq.agentOnline(a, conn)));
        if (a.mission === 'intel') ws.send(JSON.stringify(hq.snapshot()));
        if (msg.status) hq.agentStatus(a.id, msg.status);
        return;
      }
      if (msg.t === 'status') hq.agentStatus(me.id, msg);
      else if (msg.t === 'event') hq.agentEvent(me.id, msg);
      else if (msg.t === 'grid') hq.agentSetGrid(me.id, String(msg.key || ''), msg.cells);
      else if (msg.t === 'ping') conn.sendRaw(JSON.stringify({ t: 'pong' }));
    });
    ws.on('close', () => {
      clearTimeout(deny);
      if (!me) return;
      const id = me.id;
      const c = conn;
      offlineTimers.set(id, setTimeout(() => { offlineTimers.delete(id); hq.agentOffline(id, c); }, OFFLINE_GRACE));
    });
  }

  return wss;
}
