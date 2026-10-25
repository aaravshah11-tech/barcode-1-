// SENTINEL Agent: pairs with HQ, stays connected, obeys signed orders and runs its mission.
// Privacy rule: missions process camera/microphone data on this device only and send HQ nothing but
// events and numbers ("motion detected", "72 dB").
import { esc, LOGO, toast } from '/shared/ui.js';
import { canonical } from '/shared/canonical.js';
import { missionById, cleanSettings } from '/shared/missions.js';
import { boot } from '/shared/boot.js';

const KEY = 'sentinel.agent';
const main = document.getElementById('main');
const banner = document.querySelector('[data-banner]');
const dimEl = document.querySelector('[data-dim]');
const findEl = document.querySelector('[data-find]');
const enc = new TextEncoder();

let creds = load();
let ws = null;
let connected = false;
let retry = 1000;
let stopped = false; // disconnected by HQ
let hqOffset = 0; // HQ clock minus ours
const seenNonces = [];
let fx = true;
let mission = { id: null, settings: null, inst: null };
let hmacKey = null;
const outbox = [];
let lastState = null;
let lastCmd = null;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function save(c) { creds = c; try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* private mode */ } }

// ---------------- start ----------------
async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/agent/sw.js', { scope: '/agent/' }).catch(() => {});
  const code = new URLSearchParams(location.hash.slice(1)).get('pair');
  if (code) {
    history.replaceState(null, '', '/agent/');
    await claim(code);
    return;
  }
  if (!creds) return notRecruited();
  await boot({ title: 'SENTINEL // AGENT ONLINE', lines: ['WAKING AGENT', 'SECURE CHANNEL', 'CONTACTING HQ'], key: 'sentinel.agentBooted', fx });
  shell();
  connect();
}

async function claim(code, msgEl = null) {
  main.innerHTML = `<div class="big-msg">${LOGO}<h1>RECRUITING…</h1><p class="muted mono">Exchanging the one-time code with HQ</p></div>`;
  try {
    const r = await fetch('/api/pair/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ua: navigator.userAgent }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'HQ said no.');
    save({ agentId: data.agentId, token: data.token, codename: data.codename, label: data.label, recruited: Date.now() });
    stopped = false;
    main.innerHTML = `<div class="big-msg">${LOGO}<h1>WELCOME, ${esc(data.codename)}</h1><p class="mono">${esc(data.label)} has joined HQ.</p><p class="small muted">Tip: add this page to your home screen so it opens full-screen and stays paired.</p></div>`;
    setTimeout(() => { shell(); connect(); }, 1500);
  } catch (e) {
    notRecruited(e.message);
  }
}

function notRecruited(error = '') {
  banner.hidden = true;
  main.innerHTML = `<div class="big-msg">${LOGO}<h1>NOT RECRUITED</h1>
    <p>This device isn’t an Agent yet. On HQ press <b>＋ Recruit</b> and scan the QR code — or type the code here:</p>
    ${error ? `<p class="c-red mono small">${esc(error)}</p>` : ''}
    <form data-code class="row" style="justify-content:center"><input name="code" maxlength="8" autocomplete="off" autocapitalize="characters" class="mono" style="max-width:200px;text-align:center;letter-spacing:.3em;font-size:1.4rem" aria-label="Recruit code"><button class="btn-primary">Join</button></form></div>`;
  main.querySelector('[data-code]').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.code.value.trim(); if (v) claim(v); });
}

// ---------------- screen ----------------
function shell() {
  main.innerHTML = `
    <div class="id-card">${LOGO}<div class="grow"><div class="who"><small data-label>${esc(creds.label)}</small><span data-codename>${esc(creds.codename)}</span></div>
      <div class="link-state" data-link>Contacting HQ…</div></div></div>
    <section class="mission-area panel" data-area aria-live="polite"></section>
    <div class="foot"><span data-batt></span><span data-wake></span><span class="grow"></span><button class="btn-ghost small" data-leave>Leave HQ</button></div>`;
  main.querySelector('[data-leave]').addEventListener('click', () => {
    if (!confirm('Stop being an Agent? This device forgets HQ. (Remove it on HQ too.)')) return;
    stopped = true; ws?.close(); stopMission(); save(null); banner.hidden = true; notRecruited();
  });
  setBanner();
  keepAwake();
  watchBattery();
  armDimmer();
}

function setBanner() {
  if (!creds) { banner.hidden = true; return; }
  const def = missionById(mission.id || 'standby');
  banner.hidden = false;
  banner.textContent = connected ? `SENTINEL AGENT ACTIVE – ${def.name}` : `SENTINEL AGENT – ${def.name} – RECONNECTING TO HQ`;
  banner.className = `banner-active ${!connected ? 'offline' : def.needs.some((n) => n === 'camera' || n === 'microphone') ? 'watching' : ''}`;
  const link = document.querySelector('[data-link]');
  if (link) link.textContent = connected ? `Linked to HQ · ${location.host}` : stopped ? 'Disconnected' : 'Lost contact with HQ — reconnecting…';
}

// ---------------- link to HQ ----------------
function connect() {
  if (stopped || !creds) return;
  ws = new WebSocket(`wss://${location.host}/ws`);
  ws.onopen = () => { retry = 1000; ws.send(JSON.stringify({ t: 'hello', token: creds.token, status: statusNow() })); };
  ws.onmessage = (m) => onMessage(JSON.parse(m.data));
  ws.onclose = () => {
    const was = connected;
    connected = false;
    setBanner();
    if (stopped) return;
    if (was) mission.inst?.onLink?.(false);
    setTimeout(connect, retry);
    retry = Math.min(15000, retry * 2);
  };
}
addEventListener('online', () => { if (!connected && ws?.readyState !== 0) { retry = 1000; ws?.close(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); if (!connected && !stopped && creds && ws?.readyState === 3) connect(); } sendStatus(); });

function send(obj) {
  if (connected && ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}

async function onMessage(msg) {
  if (msg.t === 'welcome') {
    connected = true;
    creds = { ...creds, codename: msg.codename, label: msg.label };
    save(creds);
    hmacKey = await crypto.subtle.importKey('raw', enc.encode(creds.token), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (typeof msg.now === 'number') hqOffset = msg.now - Date.now();
    applyConfig(msg);
    while (outbox.length) send(outbox.shift());
    mission.inst?.onLink?.(true);
    return;
  }
  if (msg.t === 'denied') { stopped = true; save(null); stopMission(); notRecruited(msg.reason); return; }
  if (msg.t === 'cmd') {
    if (!(await verify(msg.cmd))) { console.warn('[agent] ignored an order that was not signed by my HQ'); return; }
    lastCmd = msg.cmd;
    return command(msg.cmd);
  }
  if (msg.t === 'pong') return;
  if (msg.t === 'state') lastState = msg;
  mission.inst?.onHq?.(msg); // INTEL SCREEN gets the dashboard's live updates
}

/** Only obey orders signed by my own HQ, recently, and only once each. */
async function verify(cmd) {
  if (!cmd || !hmacKey || typeof cmd.sig !== 'string') return false;
  const { sig, ...body } = cmd;
  const raw = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((sig.length + 3) % 4)), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('HMAC', hmacKey, raw, enc.encode(canonical(body)));
  if (!ok) return false;
  if (Math.abs(Date.now() + hqOffset - body.ts) > 120000) return false;
  if (seenNonces.includes(body.nonce)) return false;
  seenNonces.push(body.nonce);
  if (seenNonces.length > 300) seenNonces.shift();
  return true;
}

function command(cmd) {
  const p = cmd.payload || {};
  if (cmd.action === 'configure') applyConfig(p);
  else if (cmd.action === 'find') findMe();
  else if (cmd.action === 'wake') wake();
  else if (cmd.action === 'reload') location.reload();
  else if (cmd.action === 'disconnect') {
    stopped = true; save(null); stopMission(); ws?.close();
    banner.hidden = true;
    main.innerHTML = `<div class="big-msg">${LOGO}<h1>DISCONNECTED BY HQ</h1><p>This device is no longer an Agent. To use it again, scan a new Recruit QR code.</p></div>`;
  }
}

function applyConfig(c) {
  if (typeof c.fx === 'boolean') { fx = c.fx; document.body.classList.toggle('fx', fx); }
  if (c.codename) { creds.codename = c.codename; save(creds); const el = document.querySelector('[data-codename]'); if (el) el.textContent = c.codename; }
  if (c.mission) runMission(c.mission, c.settings || {});
  setBanner();
}

// ---------------- missions (plug-ins in /agent/missions/) ----------------
let runId = 0;
async function runMission(id, settings, force = false) {
  const def = missionById(id) || missionById('standby');
  const clean = cleanSettings(def.id, settings);
  if (!force && mission.id === def.id && mission.inst?.update) { mission.settings = clean; mission.inst.update(clean); return; }
  if (!force && mission.id === def.id && JSON.stringify(mission.settings) === JSON.stringify(clean)) return;
  const my = ++runId;
  await stopMission();
  mission = { id: def.id, settings: clean, inst: null };
  setBanner();
  const area = document.querySelector('[data-area]');
  if (!area) return;
  area.innerHTML = `<div class="mission-title">${def.glyph} ${esc(def.name)}</div><div data-mission-body></div>`;
  const body = area.querySelector('[data-mission-body]');
  try {
    const mod = await import(`/agent/missions/${def.id}.js`);
    if (my !== runId) return;
    mission.inst = (await mod.start(makeCtx(def, clean, body))) || {};
  } catch (e) {
    body.innerHTML = `<p class="c-red mono small">Mission failed to start: ${esc(e.message)}</p>`;
    sendStatus({ state: `error: ${e.message}`.slice(0, 80) });
  }
  armDimmer();
}
async function stopMission() {
  const inst = mission.inst;
  mission.inst = null;
  try { await inst?.stop?.(); } catch (e) { console.warn(e); }
}

function makeCtx(def, settings, root) {
  let lastStatus = 0, pending = null;
  return {
    def, settings, root, fx: () => fx, agent: () => ({ ...creds, token: undefined }),
    /** Tell HQ something happened. Text and numbers only — never images or audio. */
    report(kind, message, data = {}, level = 'info') {
      const msg = { t: 'event', kind, message: String(message).slice(0, 140), data, level };
      if (!send(msg)) { outbox.push(msg); if (outbox.length > 50) outbox.shift(); }
    },
    /** Live reading for the dashboard (throttled). */
    status(s) {
      pending = { ...pending, ...s };
      const now = Date.now();
      if (now - lastStatus < 2000) return;
      lastStatus = now;
      sendStatus(pending);
      pending = null;
    },
    setGrid(key, cells) { send({ t: 'grid', key, cells }); },
    /** Some permissions (iPhone motion sensors, sound) need a tap. Shows a big button and runs fn inside the tap. */
    withTap(label, fn) {
      return new Promise((resolve, reject) => {
        const el = document.createElement('div');
        el.className = 'activate';
        el.innerHTML = `<div><p class="mono muted">${esc(def.name)} needs your permission</p><button class="btn-primary">${esc(label)}</button></div>`;
        el.querySelector('button').addEventListener('click', async () => { try { resolve(await fn()); } catch (e) { reject(e); } finally { el.remove(); } }, { once: true });
        document.body.appendChild(el);
      });
    },
    keepBright(on) { noDim = on; armDimmer(); },
    restart() { runMission(def.id, mission.settings, true); },
    /** Latest Command Centre snapshot from HQ (INTEL SCREEN). */
    lastState: () => lastState,
  };
}

// ---------------- status, battery, wake lock, dimming ----------------
let battery = null;
function statusNow() {
  return { battery: battery ? battery.level : undefined, charging: battery ? battery.charging : undefined, visible: document.visibilityState === 'visible' };
}
function sendStatus(extra = {}) { send({ t: 'status', ...statusNow(), ...extra }); }
async function watchBattery() {
  try {
    battery = await navigator.getBattery?.();
    if (!battery) { const el = document.querySelector('[data-batt]'); if (el) el.textContent = ''; return; }
    const show = () => { const el = document.querySelector('[data-batt]'); if (el) el.textContent = `▮ ${Math.round(battery.level * 100)}%${battery.charging ? ' ⚡' : ''}`; sendStatus(); };
    battery.addEventListener('levelchange', show);
    battery.addEventListener('chargingchange', show);
    show();
  } catch { /* not supported (iPhone) */ }
}
setInterval(() => sendStatus(), 30000);

let wakeLock = null;
async function keepAwake() {
  const el = document.querySelector('[data-wake]');
  if (!('wakeLock' in navigator)) { if (el) el.textContent = '⚠ Set Auto-Lock to “Never” so the screen stays on'; return; }
  try {
    if (!wakeLock || wakeLock.released) wakeLock = await navigator.wakeLock.request('screen');
    if (el) el.textContent = 'Screen kept awake';
  } catch { if (el) el.textContent = 'Tap the screen once to keep it awake'; addEventListener('pointerdown', keepAwake, { once: true }); }
}

let dimTimer = null, noDim = false;
const NO_DIM = new Set(['panel', 'intel']);
function armDimmer() {
  clearTimeout(dimTimer);
  if (!creds || noDim || NO_DIM.has(mission.id)) { dimEl.hidden = true; return; }
  dimTimer = setTimeout(() => { dimEl.hidden = false; tickDim(); }, 60000);
}
function tickDim() { if (dimEl.hidden) return; dimEl.querySelector('[data-dimclock]').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); setTimeout(tickDim, 15000); }
function wake() { dimEl.hidden = true; armDimmer(); }
dimEl.addEventListener('click', wake);
addEventListener('pointerdown', () => { if (dimEl.hidden) armDimmer(); }, true);

// ---------------- find me: flash + beep ----------------
let audio = null;
addEventListener('pointerdown', () => { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* no audio */ } }, { capture: true });
function findMe() {
  wake();
  findEl.hidden = false;
  findEl.querySelector('[data-findname]').textContent = creds?.codename || '';
  navigator.vibrate?.([300, 150, 300, 150, 300, 150, 600]);
  let n = 0;
  const beep = () => {
    if (!audio || findEl.hidden) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = n % 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.25, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.26);
    if (++n < 24) setTimeout(beep, 420);
  };
  beep();
  const stop = () => { findEl.hidden = true; };
  findEl.addEventListener('click', stop, { once: true });
  setTimeout(stop, 12000);
}

window.__agent = { get mission() { return mission; }, get connected() { return connected; }, get lastCmd() { return lastCmd; }, verify }; // for the automated tests
init();
