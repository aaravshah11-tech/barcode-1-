// WALL DISPLAY: a read-only screen for an iPad on the wall. Linked once with a QR code from HQ
// (Settings › Phones › Wall Display); no sign-in, no buttons that change anything — HQ refuses any change
// from it. It rotates through Situation → Perimeter → Agents → Timeline, and stays on Situation while an
// Alert or Critical is waiting.
import { dial } from '../shared/link.js';
import { esc, LOGO, classificationBanners } from '../shared/ui.js';
import { classification } from '../shared/brand.js';
import { MODE_INFO } from '../shared/threat.js';
import { SEV_LABEL, SEV_RANK, ageText } from '../shared/triage.js';
import { missionById } from '../shared/missions.js';
import { laneOf, LANES } from './floor.js';
import { compass } from '../shared/weather.js';

const KEY = 'sentinel.wall';
const root = document.getElementById('wall');
const SCREENS = [['situation', 'Situation'], ['perimeter', 'Perimeter'], ['agents', 'Agents'], ['timeline', 'Timeline']];
const ROTATE_S = Math.min(120, Math.max(8, Number(new URLSearchParams(location.search).get('rotate')) || 20));
const clock = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const short = (m) => String(m || '').replace(/^AGENT-\d+ [^:]+: /, '');
const strip = (t) => String(t || '').replace(/\s*\[(ALT-\d{6}|INC-\d{4}-\d{4}|EVT-\d+)\]/g, '');

let creds = load(), link = null, connected = false, retry = 2000, screen = 0, lastSwitch = Date.now();
const W = { state: null, events: [], alerts: [], agents: [], perimeter: null, tl: [], picture: null, at: 0 };
const pending = new Map();
let reqId = 0;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function save(c) { creds = c; try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* private mode */ } }

// ---------- linking (once) ----------
function pairScreen(hqId, code, error = '') {
  classificationBanners(classification('FIRST DESK', 'WALL DISPLAY – READ ONLY'));
  root.innerHTML = `<div class="wall-pair">${LOGO}<h1>Wall Display</h1>
    ${hqId ? `<p>Give this screen a name, then press Link. It will show SENTINEL read-only — nobody can change anything from it.</p>
      <form data-wpair><input name="label" maxlength="40" value="Wall Display" aria-label="Name for this display"><button class="btn-primary">Link this display</button></form>`
    : '<p>This screen isn’t linked yet. On the HQ computer open <b>Settings › Phones › Wall Display</b> and scan the QR code with this iPad.</p>'}
    ${error ? `<p class="c-red">${esc(error)}</p>` : ''}</div>`;
  root.querySelector('[data-wpair]')?.addEventListener('submit', (e) => { e.preventDefault(); claim(hqId, code, e.target.elements.label.value); });
}
function claim(hqId, code, label) {
  root.innerHTML = '<div class="wall-pair"><p>Linking…</p></div>';
  let l = null, done = false;
  const finish = (err, m) => { if (done) return; done = true; l?.close(); if (err) pairScreen(hqId, code, err); else { save({ hqId, token: m.token, label: m.label }); history.replaceState(null, '', location.pathname + location.search); connect(); } };
  dial(hqId, {
    onOpen: () => l?.send({ t: 'claim', code, ua: navigator.userAgent, label }),
    onMessage: (m) => { if (m.t === 'claimed' && m.role === 'wall') finish(null, m); else if (m.t === 'claimed') finish('That QR code is for something else. Make a Wall Display code on HQ.'); else if (m.t === 'claimError') finish(m.error); },
    onClose: (why) => finish(why),
  }).then((x) => { l = x; if (done) x.close(); else if (x.open) x.send({ t: 'claim', code, ua: navigator.userAgent, label }); }, (e) => finish(e.message));
}

// ---------- the live link ----------
async function connect() {
  classificationBanners(classification('FIRST DESK', 'WALL DISPLAY – READ ONLY'));
  if (!root.querySelector('.wall-frame')) frame();
  const l = await dial(creds.hqId, {
    onOpen: () => { retry = 2000; l.send({ t: 'viewer', token: creds.token }); },
    onMessage,
    onClose: () => { connected = false; drawStatus(); setTimeout(connect, retry); retry = Math.min(30000, retry * 2); },
  }).catch(() => { setTimeout(connect, retry); retry = Math.min(30000, retry * 2); return null; });
  if (l) link = l;
}
function api(path) {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    pending.set(id, { resolve, reject });
    if (!link?.send({ t: 'api', id, method: 'GET', path })) { pending.delete(id); reject(new Error('offline')); }
    setTimeout(() => { if (pending.delete(id)) reject(new Error('timeout')); }, 15000);
  });
}
function onMessage(m) {
  if (m.t === 'denied') { save(null); pairScreen(); return; }
  if (m.t === 'res') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.data) : p.reject(new Error(m.error))); return; }
  if (m.t === 'state') { connected = true; W.state = m; W.events = m.events || []; W.alerts = m.alerts || []; W.agents = m.agents || []; W.picture = m.picture; W.at = Date.now(); refresh(); draw(); return; }
  if (!W.state) return;
  W.at = Date.now();
  if (m.t === 'event') { W.events.unshift(m.event); W.events.length = Math.min(W.events.length, 300); W.tl.unshift(m.event); }
  else if (m.t === 'alert') { const i = W.alerts.findIndex((a) => a.id === m.alert.id); if (i >= 0) W.alerts[i] = m.alert; else W.alerts.unshift(m.alert); }
  else if (m.t === 'agent') { const i = W.agents.findIndex((a) => a.id === m.agent.id); if (i >= 0) W.agents[i] = m.agent; else W.agents.push(m.agent); }
  else if (m.t === 'agentRemoved') W.agents = W.agents.filter((a) => a.id !== m.id);
  else if (m.t === 'threat') W.state.threat = m.threat;
  else if (m.t === 'settings') W.state.settings = m.settings;
  else if (m.t === 'weather') W.state.weather = m.weather;
  else if (m.t === 'analyst' && m.note.kind === 'picture') W.picture = m.note;
  else return;
  clearTimeout(W.t); W.t = setTimeout(draw, 300);
}
async function refresh() {
  try { W.perimeter = await api('/perimeter'); } catch { /* keep the last */ }
  try { W.tl = await api(`/log?since=${Date.now() - 86400000}&limit=3000`); } catch { /* keep */ }
  draw();
}
setInterval(() => { if (connected) refresh(); }, 60000);
setInterval(() => { if (link?.open) link.send({ t: 'ping' }); }, 15000);

// ---------- drawing ----------
function frame() {
  root.innerHTML = `<header class="wall-head"><span class="wall-logo">${LOGO}</span><b>SENTINEL</b><span class="wall-state" data-wstate></span><span class="grow"></span>
      <span class="wall-dots" data-wdots></span><span class="wall-link" data-wlink></span><span class="wall-clock mono" data-wclock></span></header>
    <section class="wall-body" data-wbody aria-live="polite"></section>`;
  root.addEventListener('click', () => { screen = (screen + 1) % SCREENS.length; lastSwitch = Date.now(); draw(); }); // tap = next screen
}
const urgent = () => W.alerts.filter((a) => a.status === 'new' && SEV_RANK[a.severity] >= SEV_RANK.ALERT).sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.ts - a.ts);
function drawStatus() {
  const l = root.querySelector('[data-wlink]');
  if (l) { l.textContent = connected ? 'LIVE' : 'HQ OFFLINE — reconnecting'; l.className = `wall-link ${connected ? 'on' : 'off'}`; }
}
function draw() {
  const body = root.querySelector('[data-wbody]');
  if (!body || !W.state) { drawStatus(); return; }
  const mode = W.state.settings?.mode || 'home';
  document.body.dataset.state = mode;
  const u = urgent();
  const which = u.length ? 'situation' : SCREENS[screen][0];
  root.querySelector('[data-wstate]').innerHTML = `<span class="m-${mode}">${esc(MODE_INFO[mode].label.toUpperCase())}</span> · THREAT ${esc(W.state.threat?.level || 'GREEN')}`;
  root.querySelector('[data-wdots]').innerHTML = SCREENS.map(([k, l]) => `<i class="${k === which ? 'on' : ''}" title="${l}"></i>`).join('');
  root.dataset.urgent = u.length ? u[0].severity : '';
  body.dataset.screen = which;
  body.innerHTML = { situation, perimeter, agents, timeline }[which]();
  drawStatus();
}
function situation() {
  const mode = W.state.settings?.mode || 'home', u = urgent();
  const open = W.alerts.filter((a) => a.status === 'new' && a.severity !== 'INFO').sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.ts - a.ts);
  const pic = W.picture?.text ? strip(W.picture.text) : null;
  const last = W.events.find((e) => ['motion', 'door', 'perimeter', 'knock', 'sound'].includes(e.kind));
  return `${u.length ? `<div class="wall-urgent sev-${u[0].severity}"><b>${esc(SEV_LABEL[u[0].severity].toUpperCase())}</b> ${esc(u[0].title)} <span class="mono">${esc(ageText(Date.now() - u[0].ts))}</span></div>` : ''}
    <div class="w-sit"><div class="w-state m-${mode}"><span class="w-label">Alert State</span><span class="w-big">${esc(MODE_INFO[mode].label.toUpperCase())}</span><span class="w-sub">${esc(MODE_INFO[mode].summary)}</span></div>
      <div class="w-pic"><span class="w-label">Current Picture${W.picture ? ` · ${W.picture.auto ? 'automatic' : 'Analyst'} ${clock(W.picture.ts)}` : ''}</span><p>${esc(pic || `${open.length ? `${open.length} alert${open.length === 1 ? '' : 's'} waiting.` : 'Nothing waiting in Triage.'}${last ? ` Last activity: ${short(last.message)} at ${clock(last.ts)}.` : ''}`)}</p></div></div>
    <div class="w-alerts"><span class="w-label">Waiting in Triage</span>${open.length ? `<ol>${open.slice(0, 6).map((a) => `<li><span class="sev sev-${a.severity}">${esc(SEV_LABEL[a.severity])}</span><span class="grow">${esc(a.title)}</span><span class="mono">${esc(ageText(Date.now() - a.ts))}</span></li>`).join('')}</ol>` : '<p class="muted">Nothing waiting.</p>'}</div>`;
}
function perimeter() {
  const p = W.perimeter, w = W.state.weather;
  return `<div class="w-zones">${(p?.zones || []).map((z) => `<div class="w-zone"><span class="w-label">${esc(z.label)}</span>
      <div class="w-counts"><span><b>${z.counts.person}</b>people</span><span><b>${z.counts.vehicle}</b>vehicles</span><span><b>${z.counts.animal}</b>animals</span></div>
      <p>${z.last ? `${clock(z.last.ts)} · ${esc(short(z.last.message))}` : '<span class="muted">Nothing today</span>'}</p>${!z.watchers.length ? '<p class="muted">No Agent</p>' : ''}</div>`).join('') || '<p class="muted">Loading…</p>'}</div>
    <div class="w-row"><div class="w-visits"><span class="w-label">Front door today</span>${p?.visits?.length ? `<ol>${p.visits.slice(0, 4).map((v) => `<li><span class="mono">${clock(v.start)}</span> ${esc(v.label)} <span class="muted">— ${esc(v.outcome)}</span></li>`).join('')}</ol>` : '<p class="muted">No visits.</p>'}</div>
      <div class="w-wx"><span class="w-label">Weather${w?.place ? ` · ${esc(w.place)}` : ''}</span>${w ? `<span class="w-big">${Math.round(w.temp)}°</span><p>${esc(w.text)} · wind ${w.wind} mph ${esc(compass(w.windDir))}${w.rainIn != null ? ` · rain ${w.rainIn ? `in ~${w.rainIn} min` : 'now'}` : ''}</p>` : '<p class="muted">Not set.</p>'}</div></div>`;
}
function agents() {
  return `<div class="w-agents">${W.agents.map((a) => { const b = a.status?.battery ?? a.battery; return `<div class="w-agent ${a.online ? '' : 'off'}"><span class="w-label">${esc(a.label)}</span><b>${esc(a.codename)}</b>
    <span>${esc(missionById(a.mission)?.name || a.mission)}</span><span class="w-st"><i class="dot ${a.online ? 'on' : ''}"></i>${a.online ? 'ONLINE' : 'OFFLINE'}${typeof b === 'number' ? ` · ${Math.round(b * 100)}%` : ''}</span></div>`; }).join('') || '<p class="muted">No Agents yet.</p>'}</div>`;
}
function timeline() {
  const now = Date.now(), from = now - 86400000, x = (t) => ((t - from) / 86400000) * 100;
  const evs = (W.tl.length ? W.tl : W.events).filter((e) => e.ts >= from);
  return `<span class="w-label">Activity · last 24 hours</span><div class="w-tl">${LANES.map(([k, l]) => `<div class="w-lane"><span>${l}</span><div>${evs.filter((e) => laneOf(e, W.agents, W.state.house) === k).slice(0, 400).map((e) => `<i class="${e.level === 'alert' ? 'a' : ''}" style="left:${x(e.ts).toFixed(2)}%"></i>`).join('')}</div></div>`).join('')}
    <div class="w-axis">${[0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${clock(from + h * 3600000)}</span>`).join('')}</div></div>`;
}

// rotate, tick the clock, and nudge the picture now and then so nothing burns in
setInterval(() => {
  const c = root.querySelector('[data-wclock]'); if (c) c.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (Date.now() - lastSwitch >= ROTATE_S * 1000) { screen = (screen + 1) % SCREENS.length; lastSwitch = Date.now(); draw(); }
}, 1000);
setInterval(() => { root.style.transform = `translate(${Math.round(Math.random() * 6 - 3)}px, ${Math.round(Math.random() * 6 - 3)}px)`; }, 300000);
let wake = null;
async function keepAwake() { try { if (!wake || wake.released) wake = await navigator.wakeLock?.request('screen'); } catch { /* needs a tap */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
addEventListener('pointerdown', keepAwake, { once: true });
keepAwake();

window.__wall = { get W() { return W; }, get screen() { return root.querySelector('[data-wbody]')?.dataset.screen; }, api, raw(msg) { return new Promise((resolve) => { const id = ++reqId; pending.set(id, { resolve: (d) => resolve({ ok: true, d }), reject: (e) => resolve({ ok: false, error: e.message }) }); link?.send({ ...msg, id }); }); } }; // for the automated tests
const p = new URLSearchParams(location.hash.slice(1));
if (p.get('pair') && p.get('hq')) pairScreen(p.get('hq'), p.get('pair'));
else if (creds?.token) connect();
else pairScreen();
