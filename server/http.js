// HQ's web server: pages, the dashboard's API, pairing, and the plain-HTTP "trust this HQ" setup page.
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR, HTTPS_PORT, HTTP_PORT, mainAddress, lanAddresses, hostName } from './config.js';
import { randomToken, sha256, hashPassword, checkPassword, sameOrigin, isLocalRequest } from './security.js';
import { missionById } from '../public/shared/missions.js';
import { toCsv } from './export.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss: https:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(self), microphone=(self), accelerometer=(self), gyroscope=(self), screen-wake-lock=(self)',
};
const COOKIE = 'sentinel_sid';
const SESSION_DAYS = 60;

const isLocal = isLocalRequest;
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

/** Tiny "slow down" guard for logins and pairing codes. */
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return list.length <= max;
  };
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const text = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...(isBuf || typeof body === 'string' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers });
  res.end(text);
}
const sendJson = (res, status, obj, headers) => send(res, status, obj, headers);

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Too big'), { status: 413 }); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}

function serveStatic(req, res, urlPath, { root = PUBLIC_DIR } = {}) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return send(res, 400, 'Bad path'); }
  const file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) return send(res, 403, 'Forbidden');
  let target = file;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch { return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }); }
  fs.readFile(target, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const headers = { 'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (target.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
    send(res, 200, data, headers);
  });
}

export function makeHandlers({ hq, db, certs, extra = {} }) {
  const loginLimit = limiter(10, 10 * 60000);
  const pairLimit = limiter(20, 10 * 60000);
  const httpsBase = (host) => `https://${host}:${HTTPS_PORT}`;
  const joinUrl = (code) => `http://${mainAddress()}:${HTTP_PORT}/join?c=${encodeURIComponent(code)}`;

  const sessionOf = (req) => { const sid = cookies(req)[COOKIE]; return sid && db.sessionValid(sha256(sid)) ? sid : null; };
  const needsSetup = () => !db.getSetting('adminHash');
  const network = () => ({
    address: mainAddress(), addresses: lanAddresses(), host: hostName(), httpsPort: HTTPS_PORT, httpPort: HTTP_PORT,
    dashboardUrl: httpsBase(mainAddress()), setupUrl: `http://${mainAddress()}:${HTTP_PORT}/`, certMethod: certs?.meta?.method || '', certNames: certs?.meta ? [...certs.meta.ips, ...certs.meta.dns] : [],
    tailscaleUrls: lanAddresses().filter((a) => a.tailscale).map((a) => httpsBase(a.address)),
  });

  // ---------- the HTTPS server: dashboard, Agents, API ----------
  async function https(req, res) {
    const url = new URL(req.url, 'https://hq');
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) return await api(req, res, url);
      if (p === '/join') return send(res, 302, '', { Location: `/agent/#pair=${encodeURIComponent(url.searchParams.get('c') || '')}` });
      if (p === '/' || p === '/index.html') return serveStatic(req, res, '/dashboard/index.html');
      if (p === '/agent' ) return send(res, 302, '', { Location: '/agent/' });
      if (p === '/sentinel-ca.crt') return sendCa(res);
      return serveStatic(req, res, p);
    } catch (e) {
      if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' });
      if (!e.status) console.error(e);
    }
  }

  function sendCa(res) {
    // The *public* half of HQ's certificate authority. Phones install this once to trust HQ.
    send(res, 200, certs.ca, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="SENTINEL-HQ.crt"' });
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    const ip = req.socket.remoteAddress;

    // ----- public -----
    if (p === '/api/ping') return sendJson(res, 200, { ok: true, hq: 'SENTINEL' }, { 'Access-Control-Allow-Origin': '*' });
    if (p === '/api/auth' && m === 'GET') return sendJson(res, 200, { needsSetup: needsSetup(), loggedIn: !!sessionOf(req), local: isLocal(req) });
    if (p === '/api/setup' && m === 'POST') {
      if (!needsSetup()) return sendJson(res, 409, { error: 'HQ already has a password.' });
      if (!isLocal(req)) return sendJson(res, 403, { error: 'Set the password on the HQ computer itself (open https://localhost:' + HTTPS_PORT + ').' });
      const { password } = await readJson(req);
      if (String(password || '').length < 6) return sendJson(res, 400, { error: 'Use at least 6 characters.' });
      db.setSetting('adminHash', hashPassword(password));
      hq.logEvent({ kind: 'system', message: 'HQ password set' });
      return startSession(res);
    }
    if (p === '/api/login' && m === 'POST') {
      if (!loginLimit(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait 10 minutes.' });
      const { password } = await readJson(req);
      if (!checkPassword(password, db.getSetting('adminHash'))) return sendJson(res, 401, { error: 'Wrong password.' });
      return startSession(res);
    }
    if (p === '/api/pair/claim' && m === 'POST') {
      if (!pairLimit(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      const { code, ua } = await readJson(req);
      const creds = hq.claimPairCode(code, { ua: ua || req.headers['user-agent'] || '' });
      if (!creds) return sendJson(res, 400, { error: 'That code is wrong, used or expired. Ask HQ for a new QR code.' });
      return sendJson(res, 200, creds);
    }
    if (p === '/api/logout' && m === 'POST') {
      const sid = cookies(req)[COOKIE];
      if (sid) db.removeSession(sha256(sid));
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
    }
    if (extra.publicApi) { const done = await extra.publicApi(req, res, url, { sendJson, readJson }); if (done !== false) return; }

    // ----- everything else needs the HQ password -----
    if (!sessionOf(req)) return sendJson(res, 401, { error: 'Please log in.' });
    // Basic protection against other websites poking the API from your browser.
    if (m !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Wrong origin.' });

    if (p === '/api/state' && m === 'GET') return sendJson(res, 200, { ...hq.snapshot(), network: network() });
    if (p === '/api/network' && m === 'GET') return sendJson(res, 200, network());
    if (p === '/api/pair' && m === 'POST') {
      const { code, expiresAt } = hq.newPairCode();
      return sendJson(res, 200, { code, expiresAt, joinUrl: joinUrl(code), ...network() });
    }
    let mm;
    if ((mm = p.match(/^\/api\/agents\/([\w-]+)$/))) {
      if (m === 'PATCH') {
        const body = await readJson(req);
        if (body.mission && !missionById(body.mission)) return sendJson(res, 400, { error: 'Unknown mission.' });
        const a = hq.updateAgent(mm[1], body);
        return a ? sendJson(res, 200, hq.agentView(a)) : sendJson(res, 404, { error: 'No such Agent.' });
      }
      if (m === 'DELETE') return hq.removeAgent(mm[1]) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'No such Agent.' });
    }
    if ((mm = p.match(/^\/api\/agents\/([\w-]+)\/command$/)) && m === 'POST') {
      const { action } = await readJson(req);
      if (!['find', 'reload', 'wake'].includes(action)) return sendJson(res, 400, { error: 'Unknown command.' });
      const ok = hq.command(mm[1], action, {});
      if (ok && action === 'find') hq.logEvent({ kind: 'agent', agentId: mm[1], message: `Locating ${hq.db.agent(mm[1])?.codename}: flashing and beeping` });
      return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, { error: 'That Agent is offline.' });
    }
    if (p === '/api/log' && m === 'GET') {
      const before = Number(url.searchParams.get('before')) || null;
      return sendJson(res, 200, db.events({ before, limit: Math.min(500, Number(url.searchParams.get('limit')) || 100), kind: url.searchParams.get('kind') || null }));
    }
    if (p === '/api/export' && m === 'GET') {
      const events = db.allEvents();
      const agents = new Map(db.agents().map((a) => [a.id, a]));
      const stamp = new Date().toISOString().slice(0, 10);
      if (url.searchParams.get('format') === 'csv') {
        return send(res, 200, toCsv(events, agents), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sentinel-mission-log-${stamp}.csv"` });
      }
      return send(res, 200, JSON.stringify({ exported: new Date().toISOString(), agents: [...agents.values()].map(({ ua, ...a }) => a), events }, null, 2), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="sentinel-mission-log-${stamp}.json"` });
    }
    if (p === '/api/settings' && m === 'PATCH') return sendJson(res, 200, hq.updateSettings(await readJson(req)));
    if (p === '/api/password' && m === 'POST') {
      const { current, next } = await readJson(req);
      if (!checkPassword(current, db.getSetting('adminHash'))) return sendJson(res, 401, { error: 'Current password is wrong.' });
      if (String(next || '').length < 6) return sendJson(res, 400, { error: 'Use at least 6 characters.' });
      db.setSetting('adminHash', hashPassword(next));
      db.removeAllSessions();
      hq.logEvent({ kind: 'system', message: 'HQ password changed' });
      return startSession(res);
    }
    if (extra.api) { const done = await extra.api(req, res, url, { sendJson, readJson }); if (done !== false) return; }
    return sendJson(res, 404, { error: 'Not found' });
  }

  function startSession(res) {
    const sid = randomToken();
    db.addSession(sha256(sid), Date.now() + SESSION_DAYS * 86400000);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${sid}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict` });
  }

  // ---------- the plain-HTTP server: only the "trust HQ" setup page ----------
  function http(req, res) {
    const url = new URL(req.url, 'http://hq');
    const p = url.pathname;
    if (p === '/' || p === '/join' || p === '/setup' || p === '/setup/') return serveStatic(req, res, '/setup/index.html');
    if (p === '/setup/config.json') return sendJson(res, 200, { httpsPort: HTTPS_PORT, host: mainAddress() });
    if (p === '/sentinel-ca.crt') return sendCa(res);
    if (p.startsWith('/setup/') || p.startsWith('/shared/')) return serveStatic(req, res, p);
    // Anything else: go to the secure site.
    const host = (req.headers.host || mainAddress()).replace(/:\d+$/, '');
    return send(res, 302, '', { Location: `${httpsBase(host)}${req.url}` });
  }

  return { https, http, sessionOf, network };
}
