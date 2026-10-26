// SENTINEL Agent: pairs with HQ, stays connected, obeys signed orders and runs its mission.
// Privacy rule: missions process camera/microphone data on this device only and send HQ nothing but
// events and numbers ("motion detected", "72 dB").
import { esc, LOGO, toast } from '../shared/ui.js';
import { canonical } from '../shared/canonical.js';
import { missionById, cleanSettings } from '../shared/missions.js';
import { boot } from '../shared/boot.js';
import { dial } from '../shared/link.js';
import { openCamera, activeCamera } from './lib/camera.js';
import { applyTheme } from '../shared/themes.js';

const KEY = 'sentinel.agent';
const main = document.getElementById('main');
const banner = document.querySelector('[data-banner]');
const dimEl = document.querySelector('[data-dim]');
const findEl = document.querySelector('[data-find]');
const enc = new TextEncoder();

let creds = load();
let link = null; // the encrypted link to HQ
let pinger = null, lastMsg = 0;
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('./sw.js', import.meta.url).href).catch(() => {});
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('pair') && p.get('hq')) {
    history.replaceState(null, '', location.pathname);
    await claim(p.get('hq'), p.get('pair'));
    return;
  }
  if (!creds?.hqId) return notRecruited();
  await boot({ title: 'SENTINEL // AGENT ONLINE', lines: ['WAKING AGENT', 'SECURE CHANNEL', 'CONTACTING HQ'], key: 'sentinel.agentBooted', fx });
  shell();
  connect();
}

/** Swap the one-time code for this Agent's own secret key. */
function claimWith(hqId, code) {
  return new Promise((resolve, reject) => {
    let l = null, done = false;
    const finish = (fn, v) => { if (done) return; done = true; fn(v); l?.close(); };
    dial(hqId, {
      onOpen: () => l.send({ t: 'claim', code, ua: navigator.userAgent }),
      onMessage: (m) => {
        if (m.t === 'claimed' && m.role === 'agent') finish(resolve, m);
        else if (m.t === 'claimed') finish(reject, new Error('That code is for linking a phone, not recruiting an Agent.'));
        else if (m.t === 'claimError') finish(reject, new Error(m.error));
      },
      onClose: (why) => finish(reject, new Error(why)),
    }).then((x) => { l = x; if (done) x.close(); }, (e) => finish(reject, e));
  });
}

async function claim(hqId, code) {
  main.innerHTML = `<div class="big-msg">${LOGO}<h1>RECRUITING…</h1><p class="muted mono">Contacting HQ and exchanging the one-time code</p></div>`;
  try {
    const data = await claimWith(hqId, code);
    save({ hqId, agentId: data.agentId, token: data.token, codename: data.codename, label: data.label, recruited: Date.now() });
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
    <p>This device isn’t an Agent yet. On HQ press <b>＋ Recruit</b> and scan the QR code — or type both codes here:</p>
    ${error ? `<p class="c-red mono small">${esc(error)}</p>` : ''}
    <form data-code class="codes">
      <label><span class="small muted">HQ code</span><input name="hq" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" class="mono" aria-label="HQ code"></label>
      <label><span class="small muted">Recruit code</span><input name="code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" class="mono" aria-label="Recruit code"></label>
      <button class="btn-primary">Join</button></form></div>`;
  main.querySelector('[data-code]').addEventListener('submit', (e) => {
    e.preventDefault();
    const hq = e.target.hq.value.replace(/[^a-z0-9]/gi, '').toLowerCase(), code = e.target.code.value.trim();
    if (hq && code) claim(`sntl-${hq}`, code);
  });
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
    stopped = true; link?.close(); stopMission(); save(null); banner.hidden = true; notRecruited();
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
  if (live && connected) { banner.textContent = 'LIVE VIEW – HQ IS WATCHING THIS CAMERA'; banner.className = 'banner-active watching live'; return; }
  banner.textContent = connected ? `SENTINEL AGENT ACTIVE – ${def.name}` : `SENTINEL AGENT – ${def.name} – RECONNECTING TO HQ`;
  banner.className = `banner-active ${!connected ? 'offline' : def.needs.some((n) => n === 'camera' || n === 'microphone') ? 'watching' : ''}`;
  const linkEl = document.querySelector('[data-link]');
  if (linkEl) linkEl.textContent = connected ? 'Linked to HQ · encrypted' : stopped ? 'Disconnected' : `Lost contact with HQ — reconnecting…${lastWhy ? ` (${lastWhy})` : ''}`;
}

// ---------------- link to HQ ----------------
let lastWhy = '', dialing = false;
async function connect() {
  if (stopped || !creds || dialing) return;
  dialing = true;
  const l = await dial(creds.hqId, {
    onOpen: () => { retry = 1000; lastWhy = ''; l.send({ t: 'hello', token: creds.token, status: statusNow() }); },
    onMessage: (m) => { lastMsg = Date.now(); onMessage(m); },
    onClose: (why) => {
      dialing = false;
      clearInterval(pinger);
      const was = connected;
      connected = false;
      lastWhy = why;
      setBanner();
      if (stopped) return;
      if (was) mission.inst?.onLink?.(false);
      setTimeout(connect, retry);
      retry = Math.min(15000, retry * 2);
    },
  }).catch((e) => { dialing = false; lastWhy = e.message; setBanner(); setTimeout(connect, 5000); return null; });
  if (!l) return;
  link = l;
  lastMsg = Date.now();
  clearInterval(pinger);
  // Keep the link alive, and notice quickly if HQ has gone.
  pinger = setInterval(() => { l.send({ t: 'ping' }); if (Date.now() - lastMsg > 40000) l.close(); }, 10000);
}
addEventListener('online', () => { if (!connected) { retry = 1000; link?.close(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); if (!connected && !stopped && creds && !dialing) connect(); } sendStatus(); });

const sentLog = []; // every message this Agent sent (the tests check none of them is a picture or sound)
function send(obj) {
  if (connected && link?.open) { sentLog.push(JSON.stringify(obj)); if (sentLog.length > 2000) sentLog.shift(); return link.send(obj); }
  return false;
}

async function onMessage(msg) {
  if (msg.t === 'welcome') {
    connected = true;
    creds = { ...creds, codename: msg.codename, label: msg.label, name: msg.name || '' };
    save(creds);
    hmacKey = await crypto.subtle.importKey('raw', enc.encode(creds.token), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (typeof msg.now === 'number') hqOffset = msg.now - Date.now();
    applyConfig(msg);
    while (outbox.length) send(outbox.shift());
    mission.inst?.onLink?.(true);
    return;
  }
  if (msg.t === 'denied') { stopped = true; save(null); stopMission(); link?.close(); notRecruited(msg.reason); return; }
  if (msg.t === 'cmd') {
    if (!(await verify(msg.cmd))) { console.warn('[agent] ignored an order that was not signed by my HQ'); return; }
    lastCmd = msg.cmd;
    return command(msg.cmd);
  }
  if (msg.t === 'pong') return;
  if (msg.t === 'hqping') { send({ t: 'hqpong', ts: msg.ts }); return; }
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
  else if (cmd.action === 'live') { if (p.on) startLive(); else stopLive(); }
  else if (cmd.action === 'alarm') { if (p.on) alarmOn(p); else alarmOff(); }
  else if (cmd.action === 'message') showMessage(p);
  else if (cmd.action === 'disconnect') {
    stopped = true; save(null); stopMission(); link?.close();
    banner.hidden = true;
    main.innerHTML = `<div class="big-msg">${LOGO}<h1>DISCONNECTED BY HQ</h1><p>This device is no longer an Agent. To use it again, scan a new Recruit QR code.</p></div>`;
  }
}

function applyConfig(c) {
  if (typeof c.fx === 'boolean') { fx = c.fx; document.body.classList.toggle('fx', fx); }
  if (c.theme) applyTheme(c.theme);
  if (typeof c.name === 'string') { creds.name = c.name; save(creds); }
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
    const mod = await import(`./missions/${def.id}.js`);
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

// ---------------- LIVE VIEW: HQ asked to see the camera ----------------
// Only while HQ keeps asking (it renews every 20 s); small JPEGs, shown at HQ and never saved.
// The red banner above says so the whole time.
let live = null; // { until, own, timer, opening }
let frameNo = 0;
async function startLive() {
  if (live) { live.until = Date.now() + 30000; return; }
  live = { until: Date.now() + 30000, own: null, timer: null, opening: false };
  wake();
  setBanner();
  live.timer = setInterval(async () => {
    if (!live) return;
    if (Date.now() > live.until || !connected) return stopLive();
    let cam = activeCamera() || live.own;
    if (!cam && !live.opening) {
      live.opening = true;
      try { live.own = await openCamera(mission.settings?.camera || 'environment'); } catch (e) { send({ t: 'frame', error: e.message }); stopLive(); return; } finally { if (live) live.opening = false; }
      cam = live.own;
    }
    const data = cam?.snapshot();
    if (!data) return;
    // The link only carries small messages, so send the picture in pieces.
    const id = ++frameNo, size = 12000, n = Math.ceil(data.length / size);
    for (let i = 0; i < n; i++) send({ t: 'frame', id, i, n, part: data.slice(i * size, (i + 1) * size) });
  }, 700);
}
function stopLive() {
  if (!live) return;
  clearInterval(live.timer);
  live.own?.stop();
  live = null;
  setBanner();
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

// ---------------- COMMS: a message from HQ, full screen (read aloud if asked) ----------------
const shownMsgs = new Set();
function showMessage({ id, text = '', from = 'HQ', speak = false, ts = Date.now() }) {
  if (!id || shownMsgs.has(id)) return;
  shownMsgs.add(id);
  wake();
  document.querySelector('.comms-screen')?.remove();
  const el = document.createElement('div');
  el.className = 'comms-screen';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-label', 'Message from HQ');
  el.innerHTML = `<div class="comms-card"><div class="comms-head">Incoming transmission · ${esc(String(from))} · ${new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
    <p class="comms-text">${esc(String(text))}</p><button class="btn-primary" data-ack>Acknowledge</button></div>`;
  document.body.appendChild(el);
  navigator.vibrate?.([120, 80, 120]);
  if (audio) { const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.12); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.32); }
  if (speak && 'speechSynthesis' in window) {
    try { const u = new SpeechSynthesisUtterance(String(text)); u.lang = 'en-GB'; u.rate = 0.95; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* speech not available */ }
  }
  el.querySelector('[data-ack]').addEventListener('click', () => { send({ t: 'ack', id }); el.remove(); try { speechSynthesis.cancel(); } catch { /* ignore */ } });
}

// ---------------- ALARM PROTOCOL (LOCKDOWN / PANIC): flash red, optional siren ----------------
// Only HQ can start it (signed order). It stops by itself after the set time, or when HQ stands down.
let alarmState = null;
function alarmOn({ reason = 'ALARM', seconds = 30, siren = false, volume = 0.6 }) {
  alarmOff();
  wake();
  const el = document.createElement('div');
  el.className = 'alarm-screen';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div><div class="alarm-title">${esc(String(reason))}</div><div class="alarm-sub">SENTINEL ALARM PROTOCOL</div></div>`;
  document.body.appendChild(el);
  alarmState = { el, stopAt: Date.now() + Math.min(300, Math.max(3, seconds)) * 1000, timer: null };
  navigator.vibrate?.([500, 200, 500, 200, 500]);
  const tick = () => {
    if (!alarmState) return;
    if (Date.now() > alarmState.stopAt) return alarmOff();
    if (siren && audio) {
      const g = audio.createGain(), o = audio.createOscillator(), t = audio.currentTime;
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(700, t); o.frequency.linearRampToValueAtTime(1400, t + 0.45); o.frequency.linearRampToValueAtTime(700, t + 0.9);
      g.gain.setValueAtTime(Math.min(1, Math.max(0, volume)) * 0.5, t); g.gain.setValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.92);
    }
    alarmState.timer = setTimeout(tick, 950);
  };
  tick();
}
function alarmOff() { if (!alarmState) return; clearTimeout(alarmState.timer); alarmState.el.remove(); alarmState = null; }

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

window.__agent = { get mission() { return mission; }, get connected() { return connected; }, get lastCmd() { return lastCmd; }, verify, sent: sentLog }; // for the automated tests
init();
