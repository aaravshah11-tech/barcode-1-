// SENTINEL — household security operations console.
import { esc, $, $$, toast, sheet, confirmBox, clock, dayClock, ago, qrSvg, LOGO, classificationBanners } from '../shared/ui.js';
import { Radar } from '../shared/radar.js';
import { missionById } from '../shared/missions.js';
import { openSettings } from './settings.js';
import { startLocal, startRemote, linkPhone, viewerCreds } from './transport.js';
import { notifyEvent } from './alerts.js';
import { lockScreen } from './lock.js';
import { applyTheme } from '../shared/themes.js';
import { sfx, sfxPrefs, setSfx, onSfx } from '../shared/sfx.js';
import { openBuilder } from './builder.js';
import { icon } from '../shared/icons.js';
import { MODES, MODE_INFO, suggestMode, ACTIVITY_KINDS } from '../shared/threat.js';
import { centroid, openingEnds, bbox, fixtureLines } from '../shared/house.js';
import { createTerminal } from './terminal.js';
import { renderIntel as drawIntel } from './intel.js';
import { openBriefing, maybeAutoBriefing } from './briefing.js';
import { renderDiagnostics } from './diagnostics.js';
import { createTimeline } from './timeline.js';
import { createWorld } from './world.js';
import { heatLevel, heatOpacity } from '../shared/replay.js';
import { voicePrefs, voiceSupported, createPushToTalk, speak } from './voice.js';
import { createWorkspace } from './workspace.js';
import { openPalette, paletteOpen } from './palette.js';
import { createTriage } from './views/triage.js';
import { createIncidents } from './views/incidents.js';
import { createAnalysis } from './views/analysis.js';
import { createCoverage } from './views/coverage.js';
import { createRegister } from './views/register.js';
import { ageText, SEV_RANK } from '../shared/triage.js';

const app = $('#app');
const MODE = document.documentElement.dataset.mode === 'remote' ? 'remote' : 'hq';
const S = { agents: [], events: [], threat: null, settings: { mode: 'home' }, missions: [], info: {}, filter: 'all', open: null, mode: MODE, api: (...a) => T.api(...a) };
let radar = null;
const HAS_GL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();

// ---------------- connect to HQ's brain ----------------
let T = null; // transport: { api, onMessage, local }
let net = { state: 'connecting' };
let unlocked = false;

async function start() {
  classificationBanners();
  app.innerHTML = gateHtml('<p class="muted small">Connecting…</p>');
  try {
    if (MODE === 'hq') {
      T = await startLocal({ onStatus: setNet });
      apply(await T.api('/state'));
      T.onMessage(onMsg);
    } else {
      const p = new URLSearchParams(location.hash.slice(1));
      if (p.get('link') && p.get('hq')) return linkScreen(p.get('hq'), p.get('link'));
      if (!viewerCreds()) return notLinked();
      // A linked phone sees nothing until HQ says "locked" (show the login) or sends the state (still logged in).
      await new Promise((resolve) => {
        T = startRemote({ onStatus: setNet, onDenied: (why) => notLinked(why), onLocked: () => { if (unlocked) lockNow('Your session ended. Log in again.'); else resolve(); } });
        T.onMessage((m) => { if (m.t === 'state') { apply(m); if (!unlocked && !S.ready) { S.ready = true; resolve(); } } });
      });
      T.onMessage(onMsg);
    }
  } catch (x) {
    app.innerHTML = gateHtml(`<p>${esc(x.message)}</p>`);
    return;
  }
  applyTheme(S.settings.theme);
  if (!S.ready || MODE === 'hq') await unlock();
  launch();
}
const gateHtml = (inner) => `<div class="gate"><div class="login-panel"><div class="login-brand">${LOGO}<div><b>SENTINEL</b><small>Household security operations</small></div></div><div>${inner}</div></div></div>`;

/** Show the codename + PIN screen until the Director logs in. */
async function unlock(reason = '') {
  unlocked = false;
  radar?.destroy(); radar = null;
  const who = await lockScreen(app, T.api, { remote: MODE === 'remote', reason });
  S.operator = who?.codename || S.operator;
  S.role = who?.role || 'DIRECTOR';
  S.sessionStart = Date.now();
  if (MODE === 'remote') apply(await waitForState());
  unlocked = true;
}
const waitForState = () => new Promise((resolve) => { const f = (m) => { if (m.t === 'state') { T.onMessage.off?.(f); resolve(m); } }; T.onMessage(f); setTimeout(() => resolve(S.snapshot || { ...S }), 4000); });

/** Lock the Command Centre (after inactivity, or by hand). HQ keeps guarding the house meanwhile. */
async function lockNow(reason = 'Locked.') {
  if (!unlocked) return;
  unlocked = false;
  closeAllSheets();
  term.close(); ptt.stop();
  try { await T.api('/auth/lock', { method: 'POST', body: {} }); } catch { /* fine */ }
  await unlock(reason);
  launch();
}
function closeAllSheets() { $$('.sheet-backdrop').forEach((b) => b.remove()); drawer = null; S.open = null; liveView = null; }

// Auto-lock after the chosen minutes without a tap, click or key.
let lastActive = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastActive = Date.now(); }, { capture: true, passive: true });
setInterval(() => {
  const min = S.settings.autoLockMin;
  if (unlocked && min && Date.now() - lastActive > min * 60000) lockNow(`Auto-locked after ${min} min without activity.`);
}, 10000);

function notLinked(why = '') {
  app.innerHTML = gateHtml(`${why ? `<p class="c-red small">${esc(why)}</p>` : ''}
    <p>This phone isn’t linked to an HQ yet.</p>
    <ol class="small" style="line-height:1.7;padding-left:20px"><li>On the HQ computer open <b>Settings → Phones</b>.</li><li>Press <b>Link a phone</b>.</li><li>Scan the QR code with this phone’s camera.</li></ol>
    <p class="small muted">To make this device an Agent instead, use <b>Recruit</b> on HQ.</p>`);
}

function linkScreen(hqId, code) {
  history.replaceState(null, '', location.pathname);
  app.innerHTML = gateHtml(`<p>Link this phone to HQ so you can see the Command Centre from anywhere.</p>
    <form data-link><label class="field"><span>Name for this phone</span><input name="label" value="${esc(guessDevice())}" maxlength="40" required></label>
    <p class="c-red small" data-err></p><button class="btn-primary" style="width:100%">Link this phone</button></form>`);
  $('[data-link]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Linking…';
    try { await linkPhone(hqId, code, e.target.label.value.trim()); toast('Linked to HQ'); start(); } catch (x) { $('[data-err]').textContent = x.message; btn.disabled = false; btn.textContent = 'Try again'; }
  });
}
const guessDevice = () => { const ua = navigator.userAgent; return /iPhone/.test(ua) ? 'My iPhone' : /iPad/.test(ua) ? 'My iPad' : /Android/.test(ua) ? 'My phone' : 'My laptop'; };

function setNet(s) {
  const was = net.state;
  net = s;
  const el = $('[data-net]');
  if (was !== s.state && unlocked && s.state === 'offline') sfx('warn');
  renderNetwork(); renderStatus();
  if (!el) return;
  const label = { online: MODE === 'hq' ? 'Uplink' : 'Linked', connecting: 'Connecting', offline: 'Offline', taken: 'In use elsewhere' }[s.state] || s.state;
  el.innerHTML = `<span class="dot ${s.state === 'online' ? 'on' : s.state === 'connecting' ? 'warn' : 'alert'}"></span>${label}`;
  el.title = s.detail || '';
  const r = $('[data-reason]');
  if (r) { if (s.state === 'online') { r.classList.remove('c-red'); renderTop(); } else if (s.detail) { r.textContent = s.detail; r.classList.add('c-red'); } }
}

// ---------------- the Command Centre ----------------
let ticker = null;
function launch() {
  shell();
  renderAll();
  setNet(net);
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
  tick();
  if (MODE === 'hq') keepAwake();
  setTimeout(() => maybeAutoBriefing(S), 1200);
  if (MODE === 'hq' && /^#(iss|ship=|flight=|quake=)/.test(location.hash)) openGlobal(); // a link straight to an item
}

function apply(st) {
  S.agents = st.agents; S.events = st.events; S.threat = st.threat; S.settings = st.settings; S.missions = st.missions; S.info = st.info || {}; S.house = st.house || S.house; S.net = st.net || S.net; S.messages = st.messages || S.messages || []; S.weather = st.weather ?? S.weather ?? null;
  S.alerts = st.alerts || S.alerts || []; S.incidents = st.incidents || S.incidents || [];
}

// ---------------- the console frame: app bar, navigation rail, views, status bar ----------------
/** Views in the left rail. Later parts register more (Triage, Incidents, Agents, Network, Reports, Audit). */
const VIEWS = [];
export function registerView(v) { if (!VIEWS.some((x) => x.id === v.id)) VIEWS.push(v); }
const allowed = (v) => !v.roles || v.roles.includes(S.role || 'DIRECTOR');
let currentView = null;
try { S.view = localStorage.getItem('sentinel.view') || 'ops'; } catch { S.view = 'ops'; }

function shell() {
  app.innerHTML = `
  <div class="frame">
    <header class="appbar">
      <div class="ab-brand">${LOGO}<span><b>SENTINEL</b><small>${MODE === 'hq' ? 'Headquarters' : 'Remote console'}</small></span></div>
      <span class="ab-view" data-viewtitle></span>
      <span class="threat" data-threat aria-live="polite"></span>
      <span class="grow"></span>
      <button class="ab-search" data-palette title="Command palette (Ctrl+K)" aria-label="Command palette">${icon('search')}<span class="hide-phone">Search or run a command</span><span class="hide-phone ab-keys"><kbd>Ctrl</kbd><kbd>K</kbd></span></button>
      <div class="presence hide-phone" role="group" aria-label="Alert state">
        ${MODES.map((m) => `<button data-mode="${m}" class="${m}" title="Alert state: ${MODE_INFO[m].label}">${MODE_INFO[m].label}</button>`).join('')}
      </div>
      <span class="net hide-phone" data-net></span>
      <button class="icon-btn ptt" data-ptt hidden aria-label="Hold to give a voice command" title="Hold to talk (or hold V)">${icon('mic')}</button>
      <button class="icon-btn" data-global aria-label="Global intel" title="Global intel (G)">${icon('globe')}</button>
      <button class="icon-btn" data-terminal aria-label="Terminal" title="Terminal (\`)">${icon('terminal')}</button>
      <button class="icon-btn" data-mute aria-label="Alert sounds on/off" title="Alert sounds on/off"></button>
      <button class="icon-btn hide-phone" data-fullscreen aria-label="Full screen" title="Full screen">${icon('fullscreen')}</button>
      ${MODE === 'hq' ? `<button class="small" data-recruit title="Recruit an Agent">${icon('plus')}<span class="hide-phone">Recruit</span></button>` : ''}
      <button class="icon-btn" data-settings aria-label="Settings" title="Settings">${icon('settings')}</button>
      <button class="icon-btn" data-lock aria-label="Lock" title="Lock (Shift+L)">${icon('lock')}</button>
    </header>
    <nav class="rail" aria-label="Views" data-rail></nav>
    <main class="viewroot" data-viewroot></main>
    <footer class="statusbar" data-statusbar role="status" aria-label="Status"></footer>
  </div>`;
  renderMute(); renderPtt();
  if (!VIEWS.find((v) => v.id === S.view && allowed(v))) S.view = 'ops';
  showView(S.view, true);
  if (!shellWired) { app.addEventListener('click', onClick); shellWired = true; }
}
function renderRail() {
  const rail = $('[data-rail]');
  if (!rail) return;
  rail.innerHTML = VIEWS.filter(allowed).map((v, i) => `<button data-view="${v.id}" aria-current="${v.id === S.view ? 'page' : 'false'}" title="${esc(v.label)} (${i + 1})">${icon(v.icon)}<span>${esc(v.label)}</span>${v.badge ? `<b class="rail-badge" data-badge="${v.id}" hidden></b>` : ''}</button>`).join('')
    + `<span class="grow"></span><button data-global title="Global intel (G)">${icon('globe')}<span>Global</span></button><button data-settings title="Settings">${icon('settings')}<span>Settings</span></button>`;
  for (const v of VIEWS) v.badge?.();
}
function showView(id, force = false) {
  const v = VIEWS.find((x) => x.id === id && allowed(x)) || VIEWS[0];
  if (!force && currentView === v.id) return;
  if (currentView) VIEWS.find((x) => x.id === currentView)?.leave?.();
  currentView = S.view = v.id;
  try { localStorage.setItem('sentinel.view', v.id); } catch { /* ignore */ }
  const t = $('[data-viewtitle]');
  if (t) t.textContent = v.label;
  renderRail();
  const root = $('[data-viewroot]');
  root.dataset.view = v.id;
  root.innerHTML = '';
  v.render(root);
  renderAll();
}

// ---------------- OPERATIONS: the configurable workspace ----------------
const OPS_PANELS = () => [
  { id: 'map', title: 'Site map', defaultW: 6, defaultH: 15, minW: 3, minH: 7, html: `<div class="panel-head"><h2>Site map</h2>
      <div class="filters" role="group" aria-label="Map view">${HAS_GL ? '<button data-mapview="3d">3D</button>' : ''}<button data-mapview="plan">Plan</button><button data-mapview="radar">Overview</button></div>
      <button class="small" data-replay aria-pressed="false" title="Play back the day’s events on the map">${icon('play')}Replay</button>
      <button class="small" data-heat aria-pressed="${!!S.heat?.on}" title="Show which rooms were busiest">${icon('heat')}Heatmap</button>
      ${MODE === 'hq' ? `<button class="small" data-build title="Edit floor plan">${icon('house')}<span class="hide-narrow">Floor plan</span></button>` : ''}</div>
    <div class="radar-wrap"><canvas data-radar role="img" hidden></canvas><div class="plan" data-plan hidden></div>
      <div class="map3d" data-map3d hidden></div>
      <div class="map3d-ui" data-map3dui hidden><div class="filters" data-floorbtns></div><span class="world-chip mono" data-worldchip hidden></span><span class="grow"></span><button class="small" data-iso aria-pressed="${!!S.iso}" title="Isometric view">Iso</button><button class="small" data-explode aria-pressed="false" title="Pull the floors apart">${icon('layers')}Explode</button><button class="small" data-fit3d title="Show the whole house" aria-label="Show the whole house">${icon('fit')}</button></div>
      <div class="map-hint" data-maphint hidden></div>
      <div class="heat-legend" data-heatlegend hidden></div><div class="map-tip mono" data-maptip hidden></div>
      <div class="replay-bar" data-replaybar hidden></div></div><p class="threat-reason" data-reason></p>` },
  { id: 'queue', title: 'Alert queue', defaultW: 3, defaultH: 8, html: '<div class="panel-head"><h2>Alert queue <span data-qcount></span></h2><button class="small" data-view="triage" title="Open the Triage queue (2)">Open</button></div><div class="wp-body"><ol class="mini-queue" data-minique></ol></div>' },
  { id: 'state', title: 'Alert state', defaultW: 3, defaultH: 7, html: '<div class="panel-head"><h2>Alert state</h2></div><div class="wp-body" data-peoplelist></div>' },
  { id: 'agents', title: 'Agents', defaultW: 3, defaultH: 9, html: '<div class="panel-head"><h2>Agents <span data-count></span></h2></div><div class="wp-body agents" data-agents></div>' },
  { id: 'network', title: 'Network', defaultW: 3, defaultH: 9, html: '<div class="panel-head"><h2>Network</h2></div><div class="wp-body"><dl class="kv netinfo" data-network></dl><div data-netchart></div><div data-netextra></div></div>' },
  { id: 'comms', title: 'Messages', defaultW: 3, defaultH: 8, html: `<div class="panel-head"><h2>Messages to Agents</h2></div><div class="wp-body">
      <form data-comms class="comms-form">
        <select name="target" aria-label="Send to" data-commstarget></select>
        <input name="text" maxlength="200" placeholder="Message, e.g. Dinner is ready" required autocomplete="off">
        <div class="row" style="justify-content:space-between"><label class="row small" style="gap:6px"><input type="checkbox" name="speak" checked> Read aloud on the Agent</label><button class="btn-primary">Send</button></div>
        <div class="quick">${['Dinner is ready', 'Lights out in 10 minutes', 'Leaving in 5 minutes', 'Come downstairs'].map((q) => `<button type="button" class="small" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      </form>
      <ol class="sent" data-sent></ol></div>` },
  { id: 'situation', title: 'Situation', defaultW: 3, defaultH: 12, html: '<div class="panel-head"><h2>Situation</h2></div><div class="wp-body" data-intel></div>' },
  { id: 'log', title: 'Event log', defaultW: 6, defaultH: 9, html: `<div class="panel-head"><h2>Event log</h2>
      <div class="filters" role="group" aria-label="Filter">${[['all', 'All'], ['alerts', 'Alerts'], ['motion', 'Motion'], ['door', 'Door'], ['agent', 'Agents']].map(([k, l]) => `<button data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}</div></div>
      <div class="wp-body"><ol class="log" data-log aria-live="polite"></ol>
      <div class="row" style="justify-content:center;margin-top:6px"><button class="btn-ghost small" data-older>Load older</button></div></div>` },
];
export const OPS_EXTRA_PANELS = []; // later parts add panels (e.g. the Triage queue)
const OPS_PRESETS = {
  Standard: [{ id: 'state', x: 0, y: 0, w: 3, h: 7 }, { id: 'agents', x: 0, y: 7, w: 3, h: 9 }, { id: 'network', x: 0, y: 16, w: 3, h: 9 }, { id: 'map', x: 3, y: 0, w: 6, h: 16 }, { id: 'log', x: 3, y: 16, w: 6, h: 9 }, { id: 'queue', x: 9, y: 0, w: 3, h: 8 }, { id: 'comms', x: 9, y: 8, w: 3, h: 8 }, { id: 'situation', x: 9, y: 16, w: 3, h: 9 }],
  'Map focus': [{ id: 'map', x: 0, y: 0, w: 9, h: 19 }, { id: 'state', x: 9, y: 0, w: 3, h: 7 }, { id: 'queue', x: 9, y: 7, w: 3, h: 6 }, { id: 'log', x: 9, y: 13, w: 3, h: 6 }, { id: 'agents', x: 0, y: 19, w: 4, h: 8 }, { id: 'network', x: 4, y: 19, w: 4, h: 8, hidden: true }, { id: 'comms', x: 8, y: 19, w: 4, h: 8, hidden: true }, { id: 'situation', x: 8, y: 19, w: 4, h: 8, hidden: true }],
  'Event review': [{ id: 'queue', x: 0, y: 0, w: 7, h: 6 }, { id: 'log', x: 0, y: 6, w: 7, h: 12 }, { id: 'map', x: 7, y: 0, w: 5, h: 18 }, { id: 'state', x: 0, y: 18, w: 4, h: 7 }, { id: 'agents', x: 4, y: 18, w: 4, h: 7 }, { id: 'network', x: 8, y: 18, w: 4, h: 7 }, { id: 'comms', x: 0, y: 25, w: 6, h: 8, hidden: true }, { id: 'situation', x: 6, y: 25, w: 6, h: 8, hidden: true }],
};
let ws = null;
registerView({
  id: 'ops', label: 'Operations', icon: 'grid',
  render(root) {
    ws = createWorkspace(root, {
      panels: [...OPS_PANELS(), ...OPS_EXTRA_PANELS.map((f) => f())], presets: OPS_PRESETS,
      onRender: () => {
        radar?.destroy?.(); radar = null;
        const c = $('[data-radar]');
        if (c) radar = new Radar(c, { onPick: openAgent, fx: false });
        map3d?.destroy(); map3d = null;
        if (S.mapView === undefined) S.mapView = houseHasRooms() ? (HAS_GL ? '3d' : 'plan') : 'radar';
        launchMapView();
        renderAll(); setNet(net);
      },
    });
    ws.render();
  },
  leave() { map3d?.destroy(); map3d = null; radar?.destroy?.(); radar = null; ws = null; },
});
window.__ws = () => ws; // for the automated tests

// ---------------- TRIAGE + INCIDENTS (see views/) ----------------
const triage = createTriage({ S, api: (...a) => T.api(...a), openIncident: (id) => openIncident(id) });
const incidents = createIncidents({ S, api: (...a) => T.api(...a), playback: (w) => { showView('ops'); setTimeout(() => timeline.startWindow(w), 300); } });
function openIncident(id) { incidents.preselect(id); if (S.view === 'incidents') incidents.open(id); else showView('incidents'); }
const unhandled = () => (S.alerts || []).filter((a) => a.status === 'new');
registerView({
  id: 'triage', label: 'Triage', icon: 'inbox', render: (root) => triage.render(root),
  badge() { const b = $('[data-badge="triage"]'); if (!b) return; const u = unhandled(); b.hidden = !u.length; b.textContent = u.length > 99 ? '99+' : u.length; b.classList.toggle('crit', u.some((a) => SEV_RANK[a.severity] >= 3)); b.classList.toggle('warn', !u.some((a) => SEV_RANK[a.severity] >= 3) && u.some((a) => a.severity === 'MEDIUM')); },
});
registerView({
  id: 'incidents', label: 'Incidents', icon: 'case', render: (root) => incidents.render(root),
  badge() { const b = $('[data-badge="incidents"]'); if (!b) return; const n = (S.incidents || []).filter((i) => i.status === 'open' || i.status === 'investigating').length; b.hidden = !n; b.textContent = n; },
});
const analysis = createAnalysis({ S, api: (...a) => T.api(...a) });
registerView({ id: 'analysis', label: 'Analysis', icon: 'pulse', render: (root) => analysis.render(root) });
const coverageView = createCoverage({ S, api: (...a) => T.api(...a) });
registerView({ id: 'coverage', label: 'Coverage', icon: 'shield', render: (root) => coverageView.render(root) });
const registerViewer = createRegister({ S, api: (...a) => T.api(...a) });
registerView({ id: 'register', label: 'Agents', icon: 'agent', render: (root) => registerViewer.render(root) });
let viewRefresh = null;
/** Coverage and the Agent register follow Agent changes (debounced). */
function refreshAgentViews() { clearTimeout(viewRefresh); viewRefresh = setTimeout(() => { if (S.view === 'coverage') coverageView.refresh(); else if (S.view === 'register') registerViewer.refresh(); }, 400); }
function renderQueue() {
  const box = $('[data-minique]');
  if (!box) return;
  const u = unhandled().sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.ts - a.ts), now = Date.now();
  const c = $('[data-qcount]'); if (c) c.textContent = u.length ? `(${u.length})` : '';
  box.innerHTML = u.length ? u.slice(0, 8).map((a) => `<li><button data-view="triage" data-qalert="${a.id}"><span class="sev sev-${a.severity}">${a.severity}</span><span class="grow">${esc(a.title)}${a.count > 1 ? ` ×${a.count}` : ''}</span><span class="mono small muted" data-qage="${a.ts}">${ageText(now - a.ts)}</span></button></li>`).join('')
    : '<li class="small muted empty">No unhandled alerts.</li>';
}
function upsertBy(list, item) { const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = item; else list.unshift(item); }

// ---------------- status bar ----------------
function hqHealth() {
  const issues = [];
  if (net.state !== 'online') issues.push(`Uplink ${net.state}`);
  if (S.net && S.net.online === false) issues.push('Internet down');
  if (MODE === 'hq' && S.info.persistent === false) issues.push('Storage not persistent');
  return { ok: !issues.length, issues };
}
const hms = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return [t / 3600, (t / 60) % 60, t % 60].map((x) => String(Math.floor(x)).padStart(2, '0')).join(':'); };
function renderStatus() {
  const sb = $('[data-statusbar]');
  if (!sb) return;
  if (!sb.firstChild) {
    sb.innerHTML = `
      <span class="sb"><i>Operator</i><b data-sbop></b></span>
      <span class="sb"><i>Role</i><b data-sbrole></b></span>
      <span class="sb"><i>Session</i><b class="mono" data-sbsess></b></span>
      <span class="sb"><i>Alert state</i><b data-sbstate></b></span>
      <span class="sb hide-phone"><i>UTC</i><b class="mono" data-sbutc></b></span>
      <span class="sb"><i>Local</i><b class="mono" data-sblocal></b></span>
      <span class="sb"><i>HQ</i><b data-sbhealth></b></span>
      <span class="sb"><i>Agents</i><b class="mono" data-sbagents></b></span>
      <span class="grow"></span>
      <span class="sb hide-phone sb-keys"><kbd>Ctrl</kbd><kbd>K</kbd> commands · <kbd>?</kbd> shortcuts</span>`;
  }
  const set = (k, v) => { const el = sb.querySelector(`[data-${k}]`); if (el && el.innerHTML !== v) el.innerHTML = v; };
  const now = Date.now(), h = hqHealth(), mode = S.settings.mode || 'home';
  set('sbop', esc(S.operator || '—'));
  set('sbrole', esc(S.role || 'DIRECTOR'));
  set('sbsess', hms(now - (S.sessionStart || now)));
  set('sbstate', `<span class="state-chip m-${mode}">${MODE_INFO[mode].label.toUpperCase()}</span>`);
  set('sbutc', new Date(now).toISOString().slice(11, 19));
  set('sblocal', clock(now));
  set('sbhealth', `<span class="dot ${h.ok ? 'on' : 'warn'}"></span> ${h.ok ? 'Nominal' : 'Degraded'}`);
  sb.querySelector('[data-sbhealth]').title = h.ok ? 'All HQ services running' : h.issues.join(' · ');
  set('sbagents', `${S.agents.filter((a) => a.online).length}/${S.agents.length}`);
}

// ---------------- command palette + keyboard shortcuts ----------------
function paletteActions() {
  const A = [];
  VIEWS.filter(allowed).forEach((v, i) => A.push({ group: 'Go to', label: v.label, keys: String(i + 1), run: () => showView(v.id) }));
  A.push({ group: 'Go to', label: 'Global intel', keys: 'G', keywords: ['iss', 'aircraft', 'earthquakes', 'ships', 'globe'], run: () => openGlobal() });
  A.push({ group: 'Go to', label: 'Settings', keywords: ['preferences', 'location', 'theme'], run: () => openSettings(S, { onChange: (x) => { S.settings = x; settingsChanged(); } }) });
  A.push({ group: 'Go to', label: 'Terminal', keys: '`', run: () => term.open() });
  for (const m of MODES) A.push({ group: 'Alert state', label: `Set ${MODE_INFO[m].label.toUpperCase()}`, hint: MODE_INFO[m].summary, keywords: [m, 'mode', 'state'], run: () => setMode(m) });
  A.push({ group: 'Alert state', label: 'Raise PANIC', keywords: ['emergency'], run: () => panic() });
  A.push({ group: 'Alert state', label: 'Stand down alarm', keywords: ['silence', 'siren'], run: () => T.api('/alarm/stop', { method: 'POST' }).then(() => toast('Alarm stood down')) });
  const toOps = async () => { if (S.view !== 'ops') showView('ops'); };
  if (HAS_GL) A.push({ group: 'Map', label: '3D view', run: async () => { await toOps(); S.mapView = '3d'; launchMapView(); } });
  A.push({ group: 'Map', label: 'Plan view', run: async () => { await toOps(); S.mapView = 'plan'; launchMapView(); } });
  A.push({ group: 'Map', label: 'Overview', run: async () => { await toOps(); S.mapView = 'radar'; launchMapView(); } });
  if (HAS_GL) A.push({ group: 'Map', label: 'Isometric on/off', run: async () => { await toOps(); toggleIso(); } });
  A.push({ group: 'Map', label: 'Replay today', run: async () => { await toOps(); timeline.startReplay(0); } });
  A.push({ group: 'Map', label: 'Replay yesterday', run: async () => { await toOps(); timeline.startReplay(1); } });
  A.push({ group: 'Map', label: 'Heatmap on/off', run: async () => { await toOps(); timeline.setHeat(!S.heat.on); } });
  if (MODE === 'hq') A.push({ group: 'Map', label: 'Edit floor plan', run: () => $('[data-build]') ? $('[data-build]').click() : openBuilder(S, { files: T.files, onClose: () => launchMapView() }) });
  for (const a of S.agents) A.push({ group: 'Agents', label: a.codename, hint: `${a.label}${a.name ? ` · ${a.name}` : ''} · ${a.online ? 'online' : 'offline'}`, keywords: [a.name || '', a.label], run: () => openAgent(a.id) });
  if (MODE === 'hq') A.push({ group: 'Actions', label: 'Recruit an Agent', run: () => recruit() });
  A.push({ group: 'Actions', label: 'Mission briefing', keywords: ['sitrep', 'summary'], run: () => openBriefing(S) });
  if (MODE === 'hq') A.push({ group: 'Actions', label: 'Run internet speed test', run: () => T.api('/net/speedtest', { method: 'POST' }).then((r) => toast(`Speed test: ${r.down} Mbps down`)).catch((x) => toast(x.message, { kind: 'err' })) });
  A.push({ group: 'Actions', label: 'Lock console', keys: 'Shift L', run: () => lockNow('Locked. HQ is still guarding the house.') });
  A.push({ group: 'Actions', label: 'Keyboard shortcuts', keys: '?', run: () => shortcutsSheet() });
  A.push({ group: 'Workspace', label: 'Edit layout', keys: 'Shift E', run: async () => { await toOps(); ws?.setEdit(!ws.edit); } });
  for (const n of ws?.names() || Object.keys(OPS_PRESETS)) A.push({ group: 'Workspace', label: `Layout: ${n}`, run: async () => { await toOps(); ws?.use(n); } });
  return A;
}
function commandPalette() {
  if (!unlocked) return;
  openPalette(paletteActions, { fallback: async (q) => { const r = await term.run(q); toast(r.reply || 'Done', { kind: r.ok ? '' : 'err', ms: 5000 }); } });
}
function shortcutsSheet() {
  const rows = [['Ctrl K', 'Command palette — jump anywhere, run anything'], ['1 – 9', 'Switch view (Operations, Triage, …)'], ['G', 'Global intel'], ['`', 'Terminal'], ['M', 'Map: switch 3D / plan'], ['Shift E', 'Edit the workspace layout'], ['Shift L', 'Lock the console'], ['V (hold)', 'Push-to-talk voice command (if switched on)'], ['↑ ↓ / J K', 'Triage: choose an alert'], ['A E D I', 'Triage: acknowledge · escalate · dismiss · incident'], ['Esc', 'Close a window'], ['?', 'This list']];
  sheet(`<table class="keys-table">${rows.map(([k, d]) => `<tr><td>${k.split(' ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</td><td>${esc(d)}</td></tr>`).join('')}</table>`, { title: 'Keyboard shortcuts' });
}
function toggleIso() { S.iso = !S.iso; try { localStorage.setItem('sentinel.iso', S.iso ? '1' : ''); } catch { /* ignore */ } map3d?.setIso(S.iso); $$('[data-iso]').forEach((b) => b.setAttribute('aria-pressed', String(S.iso))); }
try { S.iso = localStorage.getItem('sentinel.iso') === '1'; } catch { S.iso = false; }
async function setMode(m) {
  if (m === S.settings.mode) return;
  if (m === 'lockdown' && !(await confirmBox('Enter LOCKDOWN?', 'Every Agent is armed. Any activity is an intrusion and Agents may sound the alarm (Settings › Security).', { ok: 'Lockdown', danger: true }))) return;
  try { S.settings = await T.api('/settings', { method: 'PATCH', body: { mode: m } }); renderTop(); renderPeople(); renderStatus(); if (m === 'lockdown') sfx('alert'); } catch (x) { toast(x.message, { kind: 'err' }); }
}
document.addEventListener('keydown', (e) => {
  if (!unlocked) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); commandPalette(); return; }
  if (e.target.matches?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || paletteOpen() || document.querySelector('.sheet-backdrop, .builder, .atlas')) return;
  if (S.view === 'triage' && triage.key(e)) { e.preventDefault(); return; }
  if (e.key === '?') { e.preventDefault(); shortcutsSheet(); }
  else if (e.key === 'L' && e.shiftKey) { e.preventDefault(); lockNow('Locked. HQ is still guarding the house.'); }
  else if (e.key === 'E' && e.shiftKey) { e.preventDefault(); if (S.view !== 'ops') showView('ops'); ws?.setEdit(!ws.edit); }
  else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); openGlobal(); }
  else if (e.key === 'm' || e.key === 'M') { if (S.view === 'ops') { S.mapView = S.mapView === '3d' ? 'plan' : HAS_GL ? '3d' : 'plan'; launchMapView(); } }
  else if (/^[1-9]$/.test(e.key)) { const v = VIEWS.filter(allowed)[Number(e.key) - 1]; if (v) showView(v.id); }
});
let shellWired = false;

function renderMute() { const b = $('[data-mute]'); if (b) { const p = sfxPrefs(); b.innerHTML = icon(p.muted || !p.volume ? 'mute' : 'sound'); b.setAttribute('aria-pressed', String(!p.muted)); } }
onSfx(renderMute);

async function onClick(e) {
  const li = e.target.closest('[data-evagent]');
  if (li) return flyToAgent(li.dataset.evagent);
  const b = e.target.closest('button');
  if (!b) return;
  if ('palette' in b.dataset) { commandPalette(); return; }
  if (b.dataset.view) { if (b.dataset.qalert) triage.select(b.dataset.qalert); showView(b.dataset.view); return; }
  if ('iso' in b.dataset) { toggleIso(); return; }
  if ('terminal' in b.dataset) { term.toggle(); return; }
  if ('global' in b.dataset) { openGlobal(); return; }
  if ('briefing' in b.dataset) { openBriefing(S); return; }
  if ('replay' in b.dataset) { if (timeline.replaying) timeline.stopReplay(); else timeline.startReplay(0); return; }
  if ('heat' in b.dataset) { timeline.setHeat(!S.heat.on); return; }
  if ('setloc' in b.dataset) { openSettings(S, { onChange: (s) => { S.settings = s; settingsChanged(); } }); setTimeout(() => $('[data-locsearch] input')?.focus(), 50); return; }
  if ('mute' in b.dataset) { const p = sfxPrefs(); setSfx({ muted: !(p.muted || !p.volume) ? true : false, volume: p.volume || 0.5 }); return; }
  if ('fullscreen' in b.dataset) { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen isn’t allowed here.')); return; }
  if ('lock' in b.dataset) { lockNow('Locked. HQ is still guarding the house.'); return; }
  if ('build' in b.dataset) { openBuilder(S, { files: T.files, onClose: () => { if (houseHasRooms()) S.mapView = HAS_GL ? '3d' : 'plan'; launchMapView(); } }); return; }
  if (b.dataset.mapview) { S.mapView = b.dataset.mapview; launchMapView(); return; }
  if (b.dataset.floor3d) { map3d?.showFloor(Number(b.dataset.floor3d)); renderFloorButtons(); return; }
  if ('explode' in b.dataset) { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); map3d?.setExplode(on); return; }
  if ('fit3d' in b.dataset) { map3d?.frame(map3d.floorSel); return; }
  if (b.dataset.planfloor) { S.planFloor = Number(b.dataset.planfloor); renderPlan(); return; }
  if ('panic' in b.dataset) return panic();
  if (b.dataset.quick) { const f = $('[data-comms]'); f.text.value = b.dataset.quick; f.text.focus(); return; }
  if ('speedtest' in b.dataset) { b.disabled = true; b.textContent = 'Testing…'; try { const r = await T.api('/net/speedtest', { method: 'POST' }); toast(`Speed test: ${r.down} Mbps down${r.up != null ? ` · ${r.up} Mbps up` : ''}`); } catch (x) { toast(x.message, { kind: 'err' }); } renderNetwork(); return; }
  if ('standdown' in b.dataset) { try { await T.api('/alarm/stop', { method: 'POST' }); toast('Alarm stood down on all Agents'); } catch (x) { toast(x.message, { kind: 'err' }); } return; }
  if (b.dataset.dismiss) { S.dismissed = { ...(S.dismissed || {}), [b.dataset.dismiss]: Date.now() }; renderPeople(); return; }
  if (b.dataset.mode) {
    setMode(b.dataset.mode);  } else if ('recruit' in b.dataset) recruit();
  else if ('settings' in b.dataset) openSettings(S, { onChange: (s) => { S.settings = s; settingsChanged(); } });
  else if (b.dataset.agent) openAgent(b.dataset.agent);
  else if (b.dataset.filter) { S.filter = b.dataset.filter; $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderLog(); }
  else if ('older' in b.dataset) {
    const oldest = S.events.at(-1)?.id;
    if (!oldest) return;
    const more = await T.api(`/log?before=${oldest}&limit=150`);
    if (!more.length) { b.textContent = 'No older entries'; b.disabled = true; return; }
    S.events.push(...more);
    renderLog();
  }
}

// ---------------- replay + heatmap (see timeline.js) ----------------
const timeline = createTimeline({
  S, api: (...a) => T.api(...a), map3d: () => map3d, renderPlan: () => renderPlan(),
  planFlash: (id, alert) => planFlash(id, alert),
  ensureRooms: async () => {
    if (!houseHasRooms()) { toast('Draw your floor plan first (Edit floor plan), then place your Agents on it.', { kind: 'err' }); return false; }
    if (S.mapView === 'radar') { S.mapView = HAS_GL ? '3d' : 'plan'; await launchMapView(); }
    return true;
  },
});
window.__timeline = timeline; // for the automated tests
/** Flash a room on the flat plan (live events and replay). */
function planFlash(roomId, alert) {
  const g = document.querySelector(`[data-plan]:not([hidden]) [data-proom="${roomId}"]`);
  if (!g) return;
  g.classList.remove('hit', 'hit-alert'); void g.getBoundingClientRect();
  g.classList.add(alert ? 'hit-alert' : 'hit');
  clearTimeout(g._t); g._t = setTimeout(() => g.classList.remove('hit', 'hit-alert'), 2500);
}
/** The small read-out over the map (heatmap: "Kitchen · 14 events"). */
function mapTip(text, x, y) {
  const tip = $('[data-maptip]');
  if (!tip) return;
  tip.hidden = !text;
  if (!text) return;
  tip.textContent = text;
  tip.style.left = `${Math.max(4, x + 12)}px`; tip.style.top = `${Math.max(4, y + 12)}px`;
}
document.addEventListener('pointermove', (e) => {
  const plan = e.target.closest?.('[data-plan]');
  if (!plan) return;
  const g = e.target.closest('[data-proom]'), r = plan.parentElement.getBoundingClientRect();
  mapTip(g && timeline.heatTip(g.dataset.proom), e.clientX - r.left, e.clientY - r.top);
});

// ---------------- GLOBAL INTEL (see atlas/atlas.js) ----------------
async function openGlobal(initial = null) {
  try { const { openAtlas } = await import('./atlas/atlas.js'); return await openAtlas(S, { initial }); } catch (x) { console.error(x); toast(`Global intel couldn’t open: ${x.message}`, { kind: 'err' }); return null; }
}

// a link like …/hq/#ship=235052123 pasted while HQ is open
addEventListener('hashchange', async () => {
  if (MODE !== 'hq' || !unlocked || !/^#(iss|ship=|flight=|quake=)/.test(location.hash)) return;
  const { parseHash } = await import('../shared/feeds.js');
  openGlobal(parseHash(location.hash));
});

// ---------------- live world: the real sun lights the 3D map ----------------
const world = createWorld({ S, map3d: () => map3d });
window.__world = world; // for the automated tests

// ---------------- terminal + push-to-talk voice ----------------
const term = createTerminal({
  S, api: (...a) => T.api(...a),
  lock: () => lockNow('Locked. HQ is still guarding the house.'),
  setMapView: (v) => { S.mapView = v; launchMapView(); },
  flyTo: (id) => { const a = S.agents.find((x) => x.id === id); if (a?.place && houseHasRooms() && HAS_GL) flyToAgent(id); },
  openLive: (a) => openLive(a),
  onSettings: (s) => { S.settings = s; settingsChanged(); },
  replay: (daysAgo) => timeline.startReplay(daysAgo),
  stopReplay: () => timeline.stopReplay(),
  heat: (on, days) => timeline.setHeat(on, days),
  global: (initial) => openGlobal(initial),
});
window.__term = term; // for the automated tests
const ptt = createPushToTalk({
  onText: async (text) => {
    const r = await term.run(text, { voice: true });
    toast(`“${text}” — ${r.reply || 'done'}`, { kind: r.ok ? '' : 'err', ms: 5000 });
    speak(r.ok ? r.reply : `Sorry. ${r.reply}`);
  },
  onState: ({ listening, interim, error }) => {
    let box = document.querySelector('.ptt-status');
    if (!box) { box = document.createElement('div'); box.className = 'ptt-status'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    box.hidden = !listening;
    box.innerHTML = `<span class="ptt-dot"></span><b>Listening</b> <span class="muted">release to send</span>${interim ? `<div class="ptt-heard">${esc(interim)}</div>` : ''}`;
    $('[data-ptt]')?.classList.toggle('on', !!listening);
    if (error) toast(error, { kind: 'err', ms: 6000 });
  },
});
function renderPtt() { const b = $('[data-ptt]'); if (b) b.hidden = !(voicePrefs().on && voiceSupported()); }
addEventListener('sentinel:voice', renderPtt);
document.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-ptt]')) { e.preventDefault(); ptt.start(); } });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-ptt]')) e.preventDefault(); });
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { if (ptt.listening) ptt.stop(); });
const typing = (e) => e.target.matches?.('input, textarea, select, [contenteditable]');
document.addEventListener('keydown', (e) => {
  if (!unlocked || typing(e) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.builder')) return;
  if (e.key === '`' && !document.querySelector('.sheet-backdrop')) { e.preventDefault(); term.toggle(); }
  else if ((e.key === 'v' || e.key === 'V') && !e.repeat && voicePrefs().on && voiceSupported()) { e.preventDefault(); ptt.start(); }
});
document.addEventListener('keyup', (e) => { if ((e.key === 'v' || e.key === 'V') && ptt.listening) ptt.stop(); });

// ---------------- live updates from HQ ----------------
function onMsg(msg) {
  if (msg.t === 'state') { apply(msg); renderAll(); }
  else if (msg.t === 'agent') { upsert(msg.agent); renderAgents(); if (S.open === msg.agent.id) refreshDrawer(); agents3d(); refreshAgentViews(); }
  else if (msg.t === 'agentRemoved') { S.agents = S.agents.filter((a) => a.id !== msg.id); renderAgents(); agents3d(); }
  else if (msg.t === 'event') {
    addEvent(msg.event); renderStats();
    if (!timeline.replaying) { map3d?.event(msg.event); const a = S.agents.find((x) => x.id === msg.event.agentId); if (a?.place?.roomId && ACTIVITY_KINDS.has(msg.event.kind)) planFlash(a.place.roomId, msg.event.level === 'alert'); }
    timeline.liveEvent(msg.event);
    if (['correlation', 'anomaly'].includes(msg.event.kind) && S.view === 'analysis') analysis.refresh();
    if (unlocked) eventSound(msg.event); notifyEvent(msg.event, S);
  }
  else if (msg.t === 'threat') { S.threat = msg.threat; renderTop(); renderPeople(); }
  else if (msg.t === 'alert') { upsertBy(S.alerts, msg.alert); renderQueue(); triage.draw(); for (const v of VIEWS) v.badge?.(); }
  else if (msg.t === 'incident') { upsertBy(S.incidents, msg.incident); incidents.changed(msg.incident); renderQueue(); for (const v of VIEWS) v.badge?.(); }
  else if (msg.t === 'settings') { S.settings = msg.settings; settingsChanged(); }
  else if (msg.t === 'viewers') S.onViewers?.(msg.viewers);
  else if (msg.t === 'frame') liveFrame(msg);
  else if (msg.t === 'net') { S.net = msg.net; renderNetwork(); }
  else if (msg.t === 'netTesting') { S.netTesting = msg.on; renderNetwork(); }
  else if (msg.t === 'comms') { S.messages = msg.messages; renderComms(); }
  else if (msg.t === 'weather') { S.weather = msg.weather; renderIntel(); world.update(); }
  else if (msg.t === 'house') { S.house = msg.house; refreshAgentViews(); renderPlan(); map3d?.setHouse(S.house, true); map3d?.setAgents(S.agents); renderFloorButtons(); world.update(true); }
}
let agents3dTimer = null;
function agents3d() { clearTimeout(agents3dTimer); agents3dTimer = setTimeout(() => map3d?.setAgents(S.agents), 150); }
function settingsChanged() {
  const themeWas = document.documentElement.dataset.theme;
  applyTheme(S.settings.theme);
  if (map3d && themeWas !== S.settings.theme) map3d.setTheme();
  renderTop(); renderPeople(); renderIntel(); renderStatus(); world.update();
}
function eventSound(ev) {
  if (Date.now() - ev.ts > 10000) return;
  // sounds only for genuine alerts
  if (ev.level === 'alert' || ev.kind === 'threat' && /RED/.test(ev.message)) sfx('alert');
  else if (ev.level === 'warn') sfx('warn');
}
function upsert(a) { const i = S.agents.findIndex((x) => x.id === a.id); if (i >= 0) S.agents[i] = a; else S.agents.push(a); S.agents.sort((x, y) => x.number - y.number); }

function addEvent(ev) {
  if (S.events.some((x) => x.id === ev.id)) return;
  S.events.unshift(ev);
  if (S.events.length > 600) S.events.length = 600;
  if (ev.agentId && ['motion', 'door', 'sound', 'light', 'knock'].includes(ev.kind)) radar?.pulse(ev.agentId, ev.level === 'alert' ? 'alert' : 'warn');
  if (!matchesFilter(ev)) return;
  const ol = $('[data-log]');
  if (!ol) return;
  const li = logItem(ev);
  ol.prepend(li);
  while (ol.children.length > 300) ol.lastChild.remove();
  renderRadar();
  renderStats();
}

// ---------------- rendering ----------------
function renderAll() { renderTop(); renderAgents(); renderLog(); renderPeople(); renderStats(); renderNetwork(); renderIntel(); renderPlan(); renderComms(); renderStatus(); renderQueue(); for (const v of VIEWS) v.badge?.(); }

// ---------------- the floor plan on the map panel (the 3D map replaces this in the next upgrade) ----------------
const houseHasRooms = () => !!S.house?.floors?.some((f) => f.rooms.length);
async function launchMapView() {
  if (S.mapView === '3d' && !HAS_GL) S.mapView = 'plan';
  $$('[data-mapview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mapview === (S.mapView || 'radar'))));
  const c = $('[data-radar]'), p = $('[data-plan]'), m = $('[data-map3d]'), ui = $('[data-map3dui]');
  if (!c) return;
  c.hidden = S.mapView !== 'radar';
  p.hidden = S.mapView !== 'plan';
  m.hidden = ui.hidden = S.mapView !== '3d';
  renderPlan();
  mapTip(null);
  if (S.mapView === '3d') await start3d();
  timeline.refresh();
}

// ---------------- the 3D house map ----------------
let map3d = null, map3dLoading = null;
async function start3d() {
  if (map3d || map3dLoading) return map3dLoading;
  const box = $('[data-map3d]');
  map3dLoading = (async () => {
    try {
      const { Map3D, getQuality } = await import('./map3d.js');
      if (!box.isConnected) return;
      map3d = new Map3D(box, {
        quality: getQuality(), iso: !!S.iso,
        onPick: (id) => openAgent(id),
        onPlace: (id, floorId, x, y) => placeAgent(id, floorId, x, y),
        onHover: (h) => mapTip(h && timeline.heatTip(h.roomId), h?.x, h?.y),
      });
      map3d.setHouse(S.house);
      map3d.setAgents(S.agents);
      timeline.refresh();
      world.update(true);
      renderFloorButtons();
      if (MODE === 'hq' && S.house.model && T.files) T.files.get('model').then((f) => map3d?.setModel(f, S.house.model));
    } catch (x) { console.error(x); toast(`3D map couldn’t start: ${x.message}. Showing the plan instead.`, { kind: 'err' }); S.mapView = 'plan'; map3d = null; launchMapView(); }
    finally { map3dLoading = null; }
  })();
  return map3dLoading;
}
function renderFloorButtons() {
  const box = $('[data-floorbtns]');
  if (!box || !S.house) return;
  const sel = map3d?.floorSel ?? -1;
  box.innerHTML = (S.house.floors.length > 1 ? `<button data-floor3d="-1" aria-pressed="${sel < 0}">All floors</button>` : '') + S.house.floors.map((f, i) => `<button data-floor3d="${i}" aria-pressed="${sel === i || (sel < 0 && S.house.floors.length === 1)}">${esc(f.name)}</button>`).join('');
}
async function placeAgent(id, floorId, x, y) {
  hint('');
  try { const a = await T.api(`/agents/${id}/place`, { method: 'PUT', body: { floorId, x, y } }); upsert(a); map3d?.setAgents(S.agents); sfx('granted'); toast(`${a.codename} placed on the map`); } catch (x) { toast(x.message, { kind: 'err' }); }
}
/** Mission Log entry clicked: fly the 3D camera to where it happened. */
async function flyToAgent(id) {
  const a = S.agents.find((x) => x.id === id);
  if (!a) return;
  if (!a.place || !houseHasRooms() || !HAS_GL) return openAgent(id);
  if (S.mapView !== '3d') { S.mapView = '3d'; await launchMapView(); }
  if (map3d?.flyTo(id)) { sfx('scan'); $('.wp-map')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}
function hint(text) { const h = $('[data-maphint]'); if (h) { h.textContent = text; h.hidden = !text; } }
/** Start "place on map": the next click on the 3D map puts the Agent there. */
async function startPlacing(a) {
  if (!houseHasRooms()) return toast(MODE === 'hq' ? 'Draw the floor plan first: Edit floor plan.' : 'Build the house on the HQ computer first.');
  drawer?.close();
  S.mapView = '3d';
  await launchMapView();
  if (!map3d) return;
  map3d.placeMode(a.id);
  hint(`Select ${a.codename}'s position on the map — or drag its card from the Agents list`);
  $('.wp-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function renderPlan() {
  const box = $('[data-plan]');
  if (!box || box.hidden) return;
  const h = S.house;
  if (!houseHasRooms()) {
    box.innerHTML = `<div class="empty"><div class="big">No floor plan on file</div>${MODE === 'hq' ? 'Select <b>Edit floor plan</b> to draw the property.' : 'Draw it on the HQ computer: Edit floor plan.'}</div>`;
    return;
  }
  const fi = Math.min(S.planFloor || 0, h.floors.length - 1), f = h.floors[fi];
  const pts = f.rooms.flatMap((r) => r.points);
  const b = pts.length ? bbox(pts) : { minX: 0, minY: 0, w: 10, h: 10 }, pad = 0.6;
  box.innerHTML = `${h.floors.length > 1 ? `<div class="filters plan-floors">${h.floors.map((x, i) => `<button data-planfloor="${i}" aria-pressed="${i === fi}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <svg viewBox="${b.minX - pad} ${b.minY - pad} ${b.w + pad * 2} ${b.h + pad * 2}" role="img" aria-label="Floor plan of ${esc(f.name)}">
      <defs><marker id="p-up" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="fx-head"/></marker></defs>
      ${f.rooms.map((r) => {
        const c = centroid(r.points), fs = Math.max(b.w, b.h) / 38, n = S.heat?.on ? S.heat.counts[r.id] || 0 : null, lvl = n == null ? 0 : heatLevel(n, S.heat.max);
        return `<g class="proom" data-proom="${r.id}"><polygon points="${r.points.join(' ')}" ${lvl ? `style="fill:color-mix(in srgb, var(--amber) ${Math.round(heatOpacity(lvl) * 100)}%, transparent)"` : ''}/>
          <text x="${c[0]}" y="${c[1]}" style="font-size:${fs}px">${esc(r.name)}</text>${n != null ? `<text x="${c[0]}" y="${c[1] + fs * 1.4}" class="heat-n" style="font-size:${fs * 0.85}px">${n}</text>` : ''}</g>`;
      }).join('')}
      ${(f.fixtures || []).map((x) => { const L = fixtureLines(x, f.height + 0.25); return `<g class="fx ${x.kind}"><polygon points="${L.outline.join(' ')}"/>${L.lines.map(([a, c]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${c[0]}" y2="${c[1]}"/>`).join('')}${L.arrow ? `<line class="fx-arrow" marker-end="url(#p-up)" x1="${L.arrow[0][0]}" y1="${L.arrow[0][1]}" x2="${L.arrow[1][0]}" y2="${L.arrow[1][1]}"/>` : ''}</g>`; }).join('')}
      ${f.openings.map((o) => { const e = openingEnds(f, o); return e ? `<line x1="${e.a[0]}" y1="${e.a[1]}" x2="${e.b[0]}" y2="${e.b[1]}" class="op ${o.kind}"/>` : ''; }).join('')}
    </svg>`;
}

function renderTop() {
  const t = S.threat || { level: 'GREEN', reason: '' };
  const el = $('[data-threat]');
  if (el) { el.className = `threat ${t.level}`; el.innerHTML = `Status · ${{ GREEN: 'Normal', AMBER: 'Elevated', RED: 'Alert' }[t.level] || t.level}`; el.title = t.reason || ''; }
  const r = $('[data-reason]');
  if (r && !r.classList.contains('c-red')) r.textContent = `> ${t.reason || ''}`;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.settings.mode)));
  document.title = `${t.level === 'GREEN' ? '' : `[${t.level === 'RED' ? 'ALERT' : 'ELEVATED'}] `}SENTINEL`;
}

function recentLevel(agentId) {
  const now = Date.now();
  const e = S.events.find((x) => x.agentId === agentId && ['motion', 'door', 'sound', 'light', 'knock'].includes(x.kind) && now - x.ts < 60000);
  return e ? (S.threat?.level === 'RED' ? 'alert' : 'warn') : null;
}
function renderRadar() { radar?.setAgents(S.agents.map((a) => ({ ...a, warn: recentLevel(a.id) === 'warn', alert: recentLevel(a.id) === 'alert' }))); }

function agentCard(a) {
  const m = missionById(a.mission);
  const st = a.status || {};
  const batt = a.online && typeof st.battery === 'number' ? `${Math.round(st.battery * 100)}%${st.charging ? ' +' : ''}` : '';
  const level = a.online && typeof st.level === 'number' ? (a.mission === 'sound' ? `${Math.round(st.level)} dB` : a.mission === 'light' ? `${Math.round(st.level)}% light` : '') : '';
  return `<button class="agent ${a.online ? '' : 'offline'}" data-agent="${esc(a.id)}" draggable="true">
    <span class="dot ${a.online ? (recentLevel(a.id) ? 'warn' : 'on') : ''}"></span>
    <span class="a-name"><small>${esc(a.label)}</small>${esc(a.codename)}${a.name ? ` <small>· ${esc(a.name)}</small>` : ''}</span>
    <span class="a-mission">${m ? esc(m.name) : ''}</span>
    <span class="a-sub"><span>${a.online ? '<span class="c-green">ONLINE</span>' : 'OFFLINE'}</span><span data-ago="${a.online ? (st.at || a.lastSeen || '') : (a.lastSeen || '')}">last signal ${ago(a.online ? st.at || a.lastSeen : a.lastSeen)}</span>${batt ? `<span class="batt">${batt}</span>` : ''}${level ? `<span>${level}</span>` : ''}${a.online && st.rtt != null ? `<span class="mono">${st.rtt} ms</span>` : ''}${st.state ? `<span>${esc(st.state)}</span>` : ''}</span>
  </button>`;
}

function renderAgents() {
  const box = $('[data-agents]');
  if (!box) return;
  renderComms();
  if (!box.dataset.drag) { box.dataset.drag = '1'; box.addEventListener('dragstart', (e) => { const id = e.target.closest('[data-agent]')?.dataset.agent; if (id) { e.dataTransfer.setData('text/sentinel-agent', id); e.dataTransfer.effectAllowed = 'move'; if (S.mapView !== '3d' && houseHasRooms()) { S.mapView = '3d'; launchMapView(); } } }); }
  $('[data-count]').textContent = S.agents.length ? `(${S.agents.filter((a) => a.online).length}/${S.agents.length} online)` : '';
  box.innerHTML = S.agents.length ? S.agents.map(agentCard).join('')
    : '<div class="empty"><div class="big">No agents deployed</div>Select <b>Recruit</b> and scan the code with a spare phone or tablet.</div>';
  renderStatus();
  renderRadar();
  renderStats();
  renderNetwork();
}

const KIND = { motion: 'MOTION', door: 'DOOR', sound: 'SOUND', light: 'LIGHT', knock: 'KNOCK', agent: 'AGENT', system: 'SYSTEM', threat: 'THREAT', arrival: 'HOME', departure: 'AWAY', recon: 'RECON' };
const matchesFilter = (e) => S.filter === 'all' || (S.filter === 'alerts' ? e.level !== 'info' : S.filter === 'agent' ? e.kind === 'agent' : e.kind === S.filter);
function logItem(e) {
  const li = document.createElement('li');
  if (e.agentId) { li.dataset.evagent = e.agentId; li.tabIndex = 0; li.title = 'Show on the map'; }
  li.innerHTML = `<time datetime="${new Date(e.ts).toISOString()}">${esc(dayClock(e.ts))}</time><span class="${esc(e.level)}"><span class="k">[${KIND[e.kind] || e.kind.toUpperCase()}]</span><span data-msg>${esc(e.message)}</span></span>`;
  return li;
}
function renderLog() {
  const ol = $('[data-log]');
  if (!ol) return;
  ol.replaceChildren(...S.events.filter(matchesFilter).slice(0, 300).map((e) => logItem(e)));
  if (!ol.children.length) ol.innerHTML = '<li><time></time><span class="muted">Nothing logged yet.</span></li>';
}

/** The Alert state panel: the formal state, what it means, a change log, suggestions, PANIC. */
function renderPeople() {
  const box = $('[data-peoplelist]');
  if (!box) return;
  const mode = S.settings.mode || 'home';
  const lastActivity = S.events.find((e) => ACTIVITY_KINDS.has(e.kind))?.ts || null;
  const sug = suggestMode({ mode, now: new Date(), nightStart: S.settings.nightStart, nightEnd: S.settings.nightEnd, lastActivity });
  const showSug = sug && !(S.dismissed?.[sug.mode] && Date.now() - S.dismissed[sug.mode] < 3600000);
  const changes = S.events.filter((e) => e.kind === 'system' && /^Security mode: /.test(e.message)).slice(0, 5);
  const by = (e) => /\(by ([^)]+)\)/.exec(e.message)?.[1] || 'HQ';
  box.innerHTML = `
    <div class="secmode m-${mode}"><span class="secmode-label">${MODE_INFO[mode].label}</span><span class="small muted">${esc(MODE_INFO[mode].summary)}</span>${changes[0] ? `<span class="small muted mono">Since ${esc(dayClock(changes[0].ts))} · ${esc(by(changes[0]))}</span>` : ''}</div>
    <div class="modes-mobile" role="group" aria-label="Alert state">${MODES.map((m) => `<button data-mode="${m}" class="${m}" aria-pressed="${m === mode}">${MODE_INFO[m].label}</button>`).join('')}</div>
    ${showSug ? `<div class="suggest"><span class="grow small">${esc(sug.why)}</span><button class="small" data-mode="${sug.mode}">Switch to ${MODE_INFO[sug.mode].label}</button><button class="small btn-ghost" data-dismiss="${sug.mode}" aria-label="Not now">Not now</button></div>` : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn-danger panic" data-panic>${icon('alert')}Panic</button>
      ${mode === 'lockdown' ? '<button class="small" data-standdown>Stand down alarm</button>' : ''}
    </div>
    ${changes.length ? `<h3 class="sub">State changes</h3><ol class="state-log">${changes.map((e) => { const st = /^Security mode: (\w+)/.exec(e.message)[1]; return `<li><time>${esc(dayClock(e.ts))}</time><span class="state-chip m-${st.toLowerCase()}">${esc(st)}</span><span class="muted">${esc(by(e))}</span></li>`; }).join('')}</ol>` : ''}`;
}

/** PANIC: hold-to-confirm, then straight to LOCKDOWN with every Agent alerted. */
async function panic() {
  if (!(await confirmBox('Raise PANIC?', 'HQ goes into LOCKDOWN and every Agent is alerted at once.', { ok: 'Raise panic', danger: true }))) return;
  try { S.settings = await T.api('/panic', { method: 'POST' }); renderTop(); renderPeople(); sfx('alert'); toast('PANIC raised — LOCKDOWN in force', { kind: 'err' }); } catch (x) { toast(x.message, { kind: 'err' }); }
}

function tick() {
  $$('[data-ago]').forEach((el) => { const t = Number(el.dataset.ago); el.textContent = `last signal ${ago(t)}`; });
  if (Date.now() % 60000 < 1000) renderPeople();
  renderStatus();
  renderIntel();
  triage.tick();
  const now = Date.now();
  $$('[data-qage]').forEach((el) => { el.textContent = ageText(now - Number(el.dataset.qage)); });
}
/** (The old key-figures strip is now the status bar.) */
function renderStats() { renderStatus(); }

// ---------------- network panel: internet health, speed tests, Agent links ----------------
function renderNetwork() {
  const box = $('[data-network]');
  if (!box) return;
  const n = S.net || {};
  const sp = n.speed?.at(-1);
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  const links = S.agents.filter((a) => a.online);
  box.innerHTML = row('Uplink', `<span class="${net.state === 'online' ? 'c-green' : net.state === 'connecting' ? 'c-amber' : 'c-red'}">${esc(net.state === 'online' ? 'Online' : net.state === 'connecting' ? 'Connecting' : 'Offline')}</span>${MODE === 'hq' && S.info.hqId ? ` <span class="muted">· HQ code ${esc(hqCode())}</span>` : ''}`)
    + row('Internet', n.online == null ? '<span class="muted">checking…</span>' : n.online ? `<span class="c-green">Connected</span> <span class="muted mono">${n.latency} ms</span>` : '<span class="c-red">Down</span>')
    + row('Uptime 24 h', n.uptime24h == null ? '—' : `<span class="mono">${n.uptime24h}%</span>${n.outages?.length ? ` <span class="muted">· ${n.outages.length} outage${n.outages.length === 1 ? '' : 's'}</span>` : ''}`)
    + row('Speed', sp ? `<span class="mono">${sp.down} ↓${sp.up != null ? ` · ${sp.up} ↑` : ''} Mbps</span> <span class="muted">${esc(ago(sp.t))}</span>` : '<span class="muted">not tested yet</span>');
  const chart = $('[data-netchart]');
  if (chart) chart.innerHTML = latencyChart(n.recent || []);
  const extra = $('[data-netextra]');
  if (extra) extra.innerHTML = `
    <div class="row" style="margin-top:8px">${MODE === 'hq' ? `<button class="small" data-speedtest ${S.netTesting ? 'disabled' : ''}>${S.netTesting ? 'Testing…' : 'Run speed test'}</button>` : ''}</div>
    ${links.length ? `<table class="links"><caption class="sr-only">Agent links</caption><thead><tr><th>Agent</th><th>Link</th><th>Battery</th></tr></thead><tbody>${links.map((a) => `<tr><td>${esc(a.codename)}</td><td class="mono">${a.status?.rtt != null ? `${a.status.rtt} ms` : '—'}</td><td class="mono">${typeof a.status?.battery === 'number' ? `${Math.round(a.status.battery * 100)}%` : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    ${n.outages?.length ? `<p class="small muted" style="margin:8px 0 0">Last outage: ${esc(new Date(n.outages[0].from).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }))}${n.outages[0].to ? `, ${Math.max(1, Math.round((n.outages[0].to - n.outages[0].from) / 60000))} min` : ' — ongoing'}</p>` : ''}
    <p class="small" style="margin:8px 0 0;color:var(--dim)">Wi-Fi device scanning isn’t possible from a web page.</p>`;
}

/** Internet latency over the last 2 hours: one line, gaps (and red ticks) where the internet was down. Hover for values. */
function latencyChart(samples) {
  if (samples.length < 2) return '<p class="small muted" style="margin:6px 0">Latency chart appears after a few minutes of checks.</p>';
  const W = 300, H = 64, pad = 2, t1 = samples.at(-1).t, t0 = t1 - 120 * 60000;
  const vals = samples.filter((p) => p.ms != null).map((p) => p.ms);
  const max = Math.max(50, ...vals) * 1.15;
  const x = (t) => pad + ((t - t0) / (t1 - t0)) * (W - pad * 2), y = (ms) => H - 6 - (ms / max) * (H - 14);
  let d = '', pen = false;
  for (const p of samples) { if (p.ms == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.ms).toFixed(1)}`; pen = true; }
  const down = samples.filter((p) => p.ms == null).map((p) => `<rect x="${(x(p.t) - 1.5).toFixed(1)}" y="${H - 4}" width="3" height="4" class="down"/>`).join('');
  return `<figure class="netchart" data-points='${esc(JSON.stringify(samples.map((p) => [p.t, p.ms])))}'>
    <figcaption class="small muted">Internet latency · last 2 h · max ${Math.round(max / 1.15)} ms</figcaption>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Internet latency over the last 2 hours"><line x1="0" x2="${W}" y1="${H - 6}" y2="${H - 6}" class="axis"/><path d="${d}" class="lat"/>${down}<line class="cross" x1="0" x2="0" y1="0" y2="${H}" hidden/></svg>
    <div class="tip mono" hidden></div></figure>`;
}
document.addEventListener('pointermove', (e) => {
  const fig = e.target.closest?.('.netchart');
  document.querySelectorAll('.netchart .tip').forEach((t) => { if (!fig || !fig.contains(t)) t.hidden = true; });
  if (!fig) return;
  const pts = JSON.parse(fig.dataset.points), svg = fig.querySelector('svg'), r = svg.getBoundingClientRect();
  const t1 = pts.at(-1)[0], t0 = t1 - 120 * 60000, t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
  const p = pts.reduce((best, q) => (Math.abs(q[0] - t) < Math.abs(best[0] - t) ? q : best), pts[0]);
  const cross = svg.querySelector('.cross'), tip = fig.querySelector('.tip');
  const cx = ((p[0] - t0) / (t1 - t0)) * 300;
  cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.hidden = false;
  tip.hidden = false;
  tip.textContent = `${new Date(p[0]).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${p[1] == null ? 'down' : `${p[1]} ms`}`;
  tip.style.left = `${Math.min(r.width - 90, Math.max(0, e.clientX - r.left - 40))}px`;
});

// ---------------- comms panel ----------------
function renderComms() {
  const sel = $('[data-commstarget]');
  if (sel) {
    const keep = sel.value;
    const rooms = (S.house?.floors || []).flatMap((f) => f.rooms.filter((r) => S.agents.some((a) => a.place?.roomId === r.id)).map((r) => [`room:${r.id}`, `Room: ${r.name}`]));
    sel.innerHTML = `<option value="all">All Agents</option>${rooms.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}${S.agents.map((a) => `<option value="${esc(a.id)}">${esc(`${a.label} ${a.codename}${a.name ? ` · ${a.name}` : ''}`)}</option>`).join('')}`;
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
  const ol = $('[data-sent]');
  if (ol) ol.innerHTML = (S.messages || []).slice(0, 4).map((m) => `<li><span class="grow">“${esc(m.text)}” <span class="muted">→ ${esc(m.label)}</span></span><span class="small ${m.acks.length >= m.to.length ? 'c-green' : 'muted'}">${m.acks.length}/${m.to.length} ack</span></li>`).join('');
}
document.addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-comms]')) return;
  e.preventDefault();
  const f = e.target;
  try {
    const r = await T.api('/comms', { method: 'POST', body: { target: f.target.value, text: f.text.value, speak: f.speak.checked } });
    toast(r.queued ? `Transmitted to ${r.delivered}; ${r.queued} offline (delivered when they reconnect)` : `Transmitted to ${r.delivered} Agent${r.delivered === 1 ? '' : 's'}`);
    f.text.value = '';
    sfx('blip');
  } catch (x) { toast(x.message, { kind: 'err' }); }
});

// ---------------- intel panel: time, weather, sun, world clocks (see intel.js) ----------------
function renderIntel() { drawIntel($('[data-intel]'), S); }

// ---------------- one Agent ----------------
let drawer = null, diagAt = 0;
function openAgent(id) {
  const a = S.agents.find((x) => x.id === id);
  if (!a) return;
  S.open = id;
  drawer = sheet('<div data-drawer></div>', { title: `${a.label} // ${a.codename}`, wide: true, onClose: () => { S.open = null; drawer = null; } });
  drawAgent(a);
}
function refreshDrawer() {
  const a = S.agents.find((x) => x.id === S.open);
  if (!a || !drawer) return;
  // Only refresh the live status, so forms being edited aren't wiped.
  const s = drawer.body.querySelector('[data-live]');
  if (s) s.innerHTML = liveHtml(a);
  drawer.el.querySelector('.sheet-head h2').textContent = `${a.label} // ${a.codename}`;
  drawer.body.querySelectorAll('[data-mission]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mission === a.mission)));
  drawer.body.querySelectorAll('[data-cmd], [data-liveview]').forEach((b) => { b.disabled = !a.online; });
  const dg = drawer.body.querySelector('[data-diag]');
  if (dg && Date.now() - diagAt > 30000 && !dg.matches(':hover')) { diagAt = Date.now(); renderDiagnostics(dg, a, T.api); }
  if (drawer.body.dataset.mission !== a.mission) drawAgent(a);
}
function liveHtml(a) {
  const st = a.status || {};
  return `<dl class="kv">
    <dt>Status</dt><dd>${a.online ? '<span class="c-green">ONLINE</span>' : 'OFFLINE'}${st.state ? ` · ${esc(st.state)}` : ''}</dd>
    <dt>Last signal</dt><dd>${esc(ago(a.online ? st.at || a.lastSeen : a.lastSeen))}</dd>
    <dt>Battery</dt><dd>${typeof st.battery === 'number' ? `${Math.round(st.battery * 100)}%${st.charging ? ' (charging)' : ''}` : 'not shared by this device'}</dd>
    ${typeof st.level === 'number' ? `<dt>Reading</dt><dd>${esc(Math.round(st.level))}${a.mission === 'sound' ? ' dB' : '%'}</dd>` : ''}
    <dt>Location</dt><dd>${esc(placeName(a))}</dd>
    <dt>Recruited</dt><dd>${esc(new Date(a.createdAt).toLocaleString('en-GB'))}</dd>
    <dt>Device</dt><dd class="small">${esc(shortUa(a.ua))}</dd></dl>`;
}
function placeName(a) {
  if (!a.place) return 'Not positioned — select Place on map';
  const f = S.house?.floors.find((x) => x.id === a.place.floorId);
  const r = f?.rooms.find((x) => x.id === a.place.roomId);
  return f ? `${r ? r.name : 'outside the rooms'} · ${f.name}` : 'on a floor that no longer exists';
}
const shortUa = (ua) => (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (ua.match(/Android [\d.]+; ([^;)]+)/)?.[1] || 'Android') : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : ua.slice(0, 60)) || 'Unknown';

function settingField(s, v) {
  const id = `set-${s.key}`;
  if (s.type === 'number') return `<label class="field"><span>${esc(s.label)}: <b class="c-green" data-out="${s.key}">${esc(v)}${esc(s.unit || '')}</b></span><input id="${id}" type="range" name="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${esc(v)}">${s.help ? `<div class="help">${esc(s.help)}</div>` : ''}</label>`;
  if (s.type === 'toggle') return `<label class="field row"><input type="checkbox" name="${s.key}" ${v ? 'checked' : ''}><span style="margin:0">${esc(s.label)}</span></label>`;
  if (s.type === 'select') return `<label class="field"><span>${esc(s.label)}</span><select name="${s.key}">${s.options.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  if (s.type === 'text') return `<label class="field"><span>${esc(s.label)}</span><input name="${s.key}" value="${esc(v)}" maxlength="${s.max || 60}"></label>`;
  if (s.type === 'grid') return `<div class="field"><span class="small muted">${esc(s.label)}: ${v.length ? `${v.length} zone${v.length === 1 ? '' : 's'} ignored` : 'none'}</span><div class="help">${esc(s.help || '')}</div></div>`;
  return '';
}

function drawAgent(a) {
  if (!drawer || S.open !== a.id) return; // the window was closed meanwhile
  const box = drawer.body.querySelector('[data-drawer]');
  drawer.body.dataset.mission = a.mission;
  const m = missionById(a.mission);
  box.innerHTML = `<div class="drawer-grid">
    <div data-live>${liveHtml(a)}</div>
    <div class="diag" data-diag><p class="small muted">Loading diagnostics…</p></div>
    <form class="row" data-rename><label class="field grow" style="margin:0"><span>Codename</span><input name="codename" value="${esc(a.codename)}" maxlength="24" autocomplete="off"></label>
      <label class="field grow" style="margin:0"><span>Where is it?</span><input name="name" value="${esc(a.name)}" placeholder="e.g. Hallway" maxlength="40" autocomplete="off"></label><button style="align-self:end">Save</button></form>
    <label class="row small" style="gap:8px"><input type="checkbox" data-nightarmed ${a.nightArmed !== false ? 'checked' : ''}> Armed in NIGHT mode <span class="muted">(untick for bedrooms and other rooms in use at night)</span></label>
    <div><h2 style="margin-bottom:8px">Mission</h2><div class="missions">${S.missions.map((x) => `<button class="mission" data-mission="${x.id}" aria-pressed="${x.id === a.mission}"><b>${esc(x.name)}</b><span>${esc(x.summary)}</span></button>`).join('')}</div></div>
    ${m?.settings.length ? `<form data-msettings><h2 style="margin-bottom:8px">${esc(m.name)} settings</h2>${m.settings.map((s) => settingField(s, a.settings?.[s.key] ?? s.default)).join('')}<button class="btn-primary">Send to Agent</button></form>` : ''}
    <div class="row"><button class="btn-primary" data-liveview ${a.online ? '' : 'disabled'}>${icon('camera')}Live view</button><button data-place>${icon('pin')}${a.place ? 'Move on map' : 'Place on map'}</button><button data-cmd="find" ${a.online ? '' : 'disabled'}>${icon('target')}Locate</button><button data-cmd="reload" ${a.online ? '' : 'disabled'}>${icon('refresh')}Restart</button><span class="grow"></span><button class="btn-danger" data-remove>Disconnect</button></div>
  </div>`;
  diagAt = Date.now(); renderDiagnostics(box.querySelector('[data-diag]'), a, T.api);
  box.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    const def = m.settings.find((s) => s.key === r.name);
    box.querySelector(`[data-out="${r.name}"]`).textContent = `${r.value}${def.unit || ''}`;
  }));
  box.querySelector('[data-rename]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { upsert(await T.api(`/agents/${a.id}`, { method: 'PATCH', body: { codename: e.target.codename.value, name: e.target.name.value } })); renderAgents(); refreshDrawer(); toast('Saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  box.querySelector('[data-nightarmed]').addEventListener('change', async (e) => {
    try { upsert(await T.api(`/agents/${a.id}`, { method: 'PATCH', body: { nightArmed: e.target.checked } })); toast(e.target.checked ? `${a.codename} armed at night` : `${a.codename} not armed at night`); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  box.querySelector('[data-msettings]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const settings = {};
    for (const s of m.settings) {
      if (s.type === 'grid') continue;
      const inp = f.elements[s.key];
      settings[s.key] = s.type === 'toggle' ? inp.checked : s.type === 'number' ? Number(inp.value) : inp.value;
    }
    try { upsert(await T.api(`/agents/${a.id}`, { method: 'PATCH', body: { settings } })); toast(a.online ? 'Settings sent to the Agent' : 'Saved — the Agent gets them when it reconnects'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mission && b.dataset.mission !== a.mission) {
      let na;
      try { na = await T.api(`/agents/${a.id}`, { method: 'PATCH', body: { mission: b.dataset.mission } }); } catch (x) { return toast(x.message, { kind: 'err' }); }
      upsert(na); renderAgents(); drawAgent(na); toast(`${na.codename}: ${missionById(na.mission).name}`);
    } else if ('place' in b.dataset) {
      startPlacing(a);
    } else if ('liveview' in b.dataset) {
      openLive(a);
    } else if (b.dataset.cmd) {
      try { await T.api(`/agents/${a.id}/command`, { method: 'POST', body: { action: b.dataset.cmd } }); toast(b.dataset.cmd === 'find' ? `${a.codename} is flashing and beeping` : 'Restarting the Agent page'); } catch (x) { toast(x.message, { kind: 'err' }); }
    } else if ('remove' in b.dataset) {
      if (!(await confirmBox(`Disconnect ${a.codename}?`, 'It stops being an Agent straight away and forgets HQ. You can recruit it again later with a new QR code.', { ok: 'Disconnect', danger: true }))) return;
      try { await T.api(`/agents/${a.id}`, { method: 'DELETE' }); drawer?.close(); toast(`${a.codename} disconnected`); } catch (x) { toast(x.message, { kind: 'err' }); }
    }
  });
}

// ---------------- LIVE VIEW ----------------
// Shows what an Agent's camera sees, only while this window is open. Nothing is recorded or saved,
// and the Agent shows a red “LIVE VIEW” banner the whole time.
let liveView = null;
async function openLive(a) {
  liveView?.close();
  const s = sheet(`<div class="live">
      <div class="live-frame"><img data-liveimg alt="Live camera view from ${esc(a.codename)}"><div class="live-wait mono" data-livewait>CONNECTING TO CAMERA…</div><span class="live-tag mono">● LIVE</span></div>
      <p class="small muted">Live view is not recorded or saved. ${esc(a.codename)} shows a red “LIVE VIEW” banner while you watch. Closing this window stops it.</p>
    </div>`, { title: `LIVE // ${a.codename}`, wide: true, onClose: () => { clearInterval(renew); liveView = null; T.api(`/agents/${a.id}/live`, { method: 'POST', body: { on: false } }).catch(() => {}); } });
  liveView = { id: a.id, sheet: s, close: () => s.close(), last: Date.now() };
  const go = (renewing) => T.api(`/agents/${a.id}/live`, { method: 'POST', body: { on: true, renew: renewing } }).catch((x) => { const w = s.body.querySelector('[data-livewait]'); if (w) { w.textContent = x.message; w.hidden = false; } });
  go(false);
  const renew = setInterval(() => {
    go(true);
    const w = s.body.querySelector('[data-livewait]');
    if (w && Date.now() - liveView.last > 8000) { w.textContent = 'NO PICTURE — is the Agent’s screen on?'; w.hidden = false; }
  }, 10000);
}
function liveFrame(m) {
  if (!liveView || liveView.id !== m.agentId) return;
  const img = liveView.sheet.body.querySelector('[data-liveimg]');
  const w = liveView.sheet.body.querySelector('[data-livewait]');
  if (m.error) { if (w) { w.textContent = m.error; w.hidden = false; } return; }
  liveView.last = Date.now();
  if (img) img.src = m.data;
  if (w) w.hidden = true;
}

// ---------------- recruiting ----------------
/** The link a new device opens: this site's Agent page + HQ's code + the one-time code. */
export function joinLink(page, params) {
  const u = new URL(page, location.href);
  const sig = S.info.signal ? `&signal=${encodeURIComponent(S.info.signal)}` : '';
  u.hash = `${new URLSearchParams(params)}${sig}`;
  return u.href;
}
export const hqCode = () => (S.info.hqId || '').replace(/^sntl-/, '').toUpperCase();

async function recruit() {
  if (!S.info.hqId || net.state !== 'online') return toast(net.detail || 'HQ isn’t connected yet — check this computer’s internet connection.', { kind: 'err' });
  let p;
  try { p = await T.api('/pair', { method: 'POST', body: { role: 'agent' } }); } catch (x) { return toast(x.message, { kind: 'err' }); }
  const link = joinLink('../agent/', { hq: S.info.hqId, pair: p.code });
  const agentPage = new URL('../agent/', location.href);
  const before = new Set(S.agents.map((a) => a.id));
  const s = sheet(`<div class="recruit">
      <div class="qr" data-qr aria-label="QR code to recruit an Agent"></div>
      <div>
        <ol>
          <li>On the old phone or tablet, open the <b>Camera</b> and scan this code.</li>
          <li>Tap the link. Allow the camera/microphone if it asks.</li>
          <li>It appears in the Agents panel a few seconds later. Then pick its mission.</li>
        </ol>
        <p class="small muted" style="margin-top:14px">No camera? On the device open <span class="mono c-green">${esc(agentPage.host + agentPage.pathname)}</span> and type:</p>
        <div class="row" style="gap:18px"><div><div class="small muted">HQ code</div><div class="code-big" data-hqcode>${esc(hqCode())}</div></div><div><div class="small muted">Recruit code</div><div class="code-big" data-code>${esc(p.code)}</div></div></div>
        <p class="small muted" data-timer></p>
      </div></div>`, { title: 'Recruit an Agent', wide: true, onClose: () => { clearInterval(timer); off(); } });
  s.body.querySelector('[data-qr]').innerHTML = await qrSvg(link);
  s.body.querySelector('[data-qr]').dataset.link = link;
  const timer = setInterval(() => {
    const left = Math.max(0, p.expiresAt - Date.now());
    const el = s.body.querySelector('[data-timer]');
    if (el) el.textContent = left ? `Code works once, for ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} more.` : 'Code expired — close and press Recruit again.';
  }, 500);
  // Close with a cheer when the new Agent shows up.
  const watch = setInterval(() => {
    const fresh = S.agents.find((a) => !before.has(a.id));
    if (fresh) { s.close(); toast(`${fresh.label} “${fresh.codename}” recruited`); openAgent(fresh.id); }
  }, 400);
  const off = () => clearInterval(watch);
}

// ---------------- keep the HQ computer's screen awake while HQ is showing ----------------
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed right now */ }
}
document.addEventListener('visibilitychange', () => { if (MODE === 'hq') keepAwake(); });

S.joinLink = joinLink;
S.hqCode = hqCode;
start();
