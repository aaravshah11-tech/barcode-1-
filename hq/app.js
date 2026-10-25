// SENTINEL Command Centre.
import { esc, $, $$, toast, sheet, confirmBox, typewrite, clock, dayClock, ago, qrSvg, LOGO } from '../shared/ui.js';
import { boot } from '../shared/boot.js';
import { Radar } from '../shared/radar.js';
import { missionById } from '../shared/missions.js';
import { openSettings } from './settings.js';
import { startLocal, startRemote, linkPhone, viewerCreds } from './transport.js';
import { notifyEvent } from './alerts.js';

const app = $('#app');
const MODE = document.documentElement.dataset.mode === 'remote' ? 'remote' : 'hq';
const S = { agents: [], events: [], threat: null, settings: { fx: true, mode: 'home' }, missions: [], info: {}, filter: 'all', open: null, mode: MODE, api: (...a) => T.api(...a) };
let radar = null;

// ---------------- connect to HQ's brain ----------------
let T = null; // transport: { api, onMessage, local }
let net = { state: 'connecting' };

async function start() {
  app.innerHTML = gateHtml('<p class="mono muted" style="text-align:center">CONNECTING…</p>');
  try {
    if (MODE === 'hq') T = await startLocal({ onStatus: setNet });
    else {
      const p = new URLSearchParams(location.hash.slice(1));
      if (p.get('link') && p.get('hq')) return linkScreen(p.get('hq'), p.get('link'));
      if (!viewerCreds()) return notLinked();
      T = startRemote({ onStatus: setNet, onDenied: (why) => notLinked(why) });
    }
  } catch (x) {
    app.innerHTML = gateHtml(`<p>${esc(x.message)}</p>`);
    return;
  }
  main();
}
const gateHtml = (inner) => `<div class="gate"><div class="panel">${LOGO}<h1 class="mono glitch" style="text-align:center;letter-spacing:.2em;color:var(--green)">SENTINEL // HQ</h1><div style="margin-top:14px">${inner}</div></div></div>`;

function notLinked(why = '') {
  app.innerHTML = gateHtml(`${why ? `<p class="c-red small">${esc(why)}</p>` : ''}
    <p>This phone isn’t linked to an HQ yet.</p>
    <ol class="small" style="line-height:1.7;padding-left:20px"><li>On the HQ computer open <b>⚙ Settings → Phones</b>.</li><li>Press <b>Link a phone</b>.</li><li>Scan the QR code with this phone’s camera.</li></ol>
    <p class="small muted">Want to make this device an Agent instead? Use <b>＋ Recruit</b> on HQ.</p>`);
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
  net = s;
  const el = $('[data-net]');
  if (!el) return;
  const label = { online: MODE === 'hq' ? 'HQ ONLINE' : 'LINKED', connecting: 'CONNECTING', offline: 'OFFLINE', taken: 'IN USE ELSEWHERE' }[s.state] || s.state;
  el.innerHTML = `<span class="dot ${s.state === 'online' ? 'on' : s.state === 'connecting' ? 'warn' : 'alert'}"></span>${label}`;
  el.title = s.detail || '';
  const r = $('[data-reason]');
  if (r) { if (s.state === 'online') { r.classList.remove('c-red'); renderTop(); } else if (s.detail) { r.textContent = s.detail; r.classList.add('c-red'); } }
}

// ---------------- the Command Centre ----------------
async function main() {
  let state;
  try { state = await T.api('/state'); } catch (x) {
    app.innerHTML = gateHtml(`<p>${esc(x.message)}</p><p class="small muted">Is the HQ page open on the HQ computer? Retrying…</p>`);
    T.onMessage((m) => { if (m.t === 'state' && !state) { state = m; launch(state); } });
    return;
  }
  launch(state);
}
let launched = false;
async function launch(state) {
  if (launched) return;
  launched = true;
  apply(state);
  T.onMessage(onMsg);
  document.body.classList.toggle('fx', S.settings.fx);
  await boot({ fx: S.settings.fx });
  shell();
  renderAll();
  setNet(net);
  setInterval(tick, 1000);
  if (MODE === 'hq') keepAwake();
}

function apply(st) {
  S.agents = st.agents; S.events = st.events; S.threat = st.threat; S.settings = st.settings; S.missions = st.missions; S.info = st.info || {};
}

function shell() {
  app.innerHTML = `
  <header class="top">
    ${LOGO}<div class="brand glitch">SENTINEL <small>// HQ</small></div>
    <span class="threat" data-threat aria-live="polite"></span>
    <span class="spacer"></span>
    <span class="net" data-net></span>
    <div class="presence" role="group" aria-label="Is anyone home?">
      <button data-mode="home">HOME</button><button data-mode="away" class="away">AWAY</button>
    </div>
    <span class="clock" data-clock></span>
    <button class="btn-primary" data-recruit>＋ Recruit</button>
    <button class="icon-btn" data-settings aria-label="Settings">⚙</button>
  </header>
  <main class="grid">
    <div class="col">
      <section class="panel radar-panel" aria-label="Radar">
        <div class="radar-wrap"><canvas data-radar role="img"></canvas></div>
        <p class="threat-reason" data-reason></p>
      </section>
      <section class="panel"><div class="panel-head"><h2>Who’s home</h2></div><div class="people" data-peoplelist></div></section>
    </div>
    <div class="col">
      <section class="panel"><div class="panel-head"><h2>Agents <span data-count></span></h2></div><div class="agents" data-agents></div></section>
      <section class="panel"><div class="panel-head"><h2>Mission Log</h2>
        <div class="filters" role="group" aria-label="Filter">${[['all', 'All'], ['alerts', 'Alerts'], ['motion', 'Motion'], ['door', 'Door'], ['agent', 'Agents']].map(([k, l]) => `<button data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}</div></div>
        <ol class="log" data-log aria-live="polite"></ol>
        <div class="row" style="justify-content:center;margin-top:8px"><button class="btn-ghost small" data-older>Load older</button></div>
      </section>
    </div>
  </main>`;
  radar = new Radar($('[data-radar]'), { onPick: openAgent, fx: S.settings.fx });
  app.addEventListener('click', onClick);
}

async function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) {
    try { S.settings = await T.api('/settings', { method: 'PATCH', body: { mode: b.dataset.mode } }); renderTop(); renderPeople(); } catch (x) { toast(x.message, { kind: 'err' }); }
  } else if ('recruit' in b.dataset) recruit();
  else if ('settings' in b.dataset) openSettings(S, { onChange: (s) => { S.settings = s; document.body.classList.toggle('fx', s.fx); radar?.setFx(s.fx); } });
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

// ---------------- live updates from HQ ----------------
function onMsg(msg) {
  if (msg.t === 'state') { apply(msg); renderAll(); }
  else if (msg.t === 'agent') { upsert(msg.agent); renderAgents(); if (S.open === msg.agent.id) refreshDrawer(); }
  else if (msg.t === 'agentRemoved') { S.agents = S.agents.filter((a) => a.id !== msg.id); renderAgents(); }
  else if (msg.t === 'event') { addEvent(msg.event); notifyEvent(msg.event, S); }
  else if (msg.t === 'threat') { S.threat = msg.threat; renderTop(); renderPeople(); }
  else if (msg.t === 'settings') { S.settings = msg.settings; renderTop(); renderPeople(); document.body.classList.toggle('fx', S.settings.fx); radar?.setFx(S.settings.fx); }
  else if (msg.t === 'viewers') S.onViewers?.(msg.viewers);
  else if (msg.t === 'frame') liveFrame(msg);
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
  const li = logItem(ev, true);
  ol.prepend(li);
  typewrite(li.querySelector('[data-msg]'), li.querySelector('[data-msg]').dataset.text, { fx: S.settings.fx });
  while (ol.children.length > 300) ol.lastChild.remove();
  renderRadar();
}

// ---------------- rendering ----------------
function renderAll() { renderTop(); renderAgents(); renderLog(); renderPeople(); }

function renderTop() {
  const t = S.threat || { level: 'GREEN', reason: '' };
  const el = $('[data-threat]');
  if (el) { el.className = `threat ${t.level}`; el.innerHTML = `<span class="dot ${t.level === 'GREEN' ? 'on' : t.level === 'AMBER' ? 'warn' : 'alert'}"></span>THREAT ${t.level}`; }
  const r = $('[data-reason]');
  if (r && !r.classList.contains('c-red')) r.textContent = `> ${t.reason || ''}`;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.settings.mode)));
  document.title = `${t.level === 'GREEN' ? '' : `[${t.level}] `}SENTINEL // Command Centre`;
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
  const batt = a.online && typeof st.battery === 'number' ? `${Math.round(st.battery * 100)}%${st.charging ? '⚡' : ''}` : '';
  const level = a.online && typeof st.level === 'number' ? (a.mission === 'sound' ? `${Math.round(st.level)} dB` : a.mission === 'light' ? `${Math.round(st.level)}% light` : '') : '';
  return `<button class="agent ${a.online ? '' : 'offline'}" data-agent="${esc(a.id)}">
    <span class="dot ${a.online ? (recentLevel(a.id) ? 'warn' : 'on') : ''}"></span>
    <span class="a-name"><small>${esc(a.label)}</small>${esc(a.codename)}${a.name ? ` <small>· ${esc(a.name)}</small>` : ''}</span>
    <span class="a-mission">${m ? `${m.glyph} ${esc(m.name)}` : ''}</span>
    <span class="a-sub"><span>${a.online ? '<span class="c-green">ONLINE</span>' : 'OFFLINE'}</span><span data-ago="${a.online ? (st.at || a.lastSeen || '') : (a.lastSeen || '')}">last signal ${ago(a.online ? st.at || a.lastSeen : a.lastSeen)}</span>${batt ? `<span class="batt">▮ ${batt}</span>` : ''}${level ? `<span>${level}</span>` : ''}${st.state ? `<span>${esc(st.state)}</span>` : ''}</span>
  </button>`;
}

function renderAgents() {
  const box = $('[data-agents]');
  if (!box) return;
  $('[data-count]').textContent = S.agents.length ? `(${S.agents.filter((a) => a.online).length}/${S.agents.length} online)` : '';
  box.innerHTML = S.agents.length ? S.agents.map(agentCard).join('')
    : '<div class="empty"><div class="big">NO AGENTS YET</div>Press <b>＋ Recruit</b> and scan the QR code with an old phone or tablet.</div>';
  renderRadar();
}

const KIND = { motion: 'MOTION', door: 'DOOR', sound: 'SOUND', light: 'LIGHT', knock: 'KNOCK', agent: 'AGENT', system: 'SYSTEM', threat: 'THREAT', arrival: 'HOME', departure: 'AWAY', recon: 'RECON' };
const matchesFilter = (e) => S.filter === 'all' || (S.filter === 'alerts' ? e.level !== 'info' : S.filter === 'agent' ? e.kind === 'agent' : e.kind === S.filter);
function logItem(e, fresh = false) {
  const li = document.createElement('li');
  li.innerHTML = `<time datetime="${new Date(e.ts).toISOString()}">${esc(dayClock(e.ts))}</time><span class="${esc(e.level)}"><span class="k">[${KIND[e.kind] || e.kind.toUpperCase()}]</span><span data-msg data-text="${esc(e.message)}">${fresh ? '' : esc(e.message)}</span></span>`;
  return li;
}
function renderLog() {
  const ol = $('[data-log]');
  if (!ol) return;
  ol.replaceChildren(...S.events.filter(matchesFilter).slice(0, 300).map((e) => logItem(e)));
  if (!ol.children.length) ol.innerHTML = '<li><time></time><span class="muted">Nothing logged yet.</span></li>';
}

function renderPeople() {
  const box = $('[data-peoplelist]');
  if (!box) return;
  const away = S.settings.mode === 'away';
  box.innerHTML = `<div class="presence-state ${away ? 'away' : ''}"><span class="dot ${away ? 'warn' : 'on'}"></span><b>${away ? 'AWAY — nobody’s home' : 'HOME — someone’s in'}</b></div>
    <p class="small muted" style="margin:6px 0 0">${away ? 'Any motion, door or noise now is THREAT RED. Press HOME when you’re back.' : 'Press AWAY when everyone leaves, so movement counts as an intruder (THREAT RED).'}</p>`;
}

function tick() {
  const c = $('[data-clock]');
  if (c) c.textContent = clock(Date.now());
  $$('[data-ago]').forEach((el) => { const t = Number(el.dataset.ago); el.textContent = `last signal ${ago(t)}`; });
}

// ---------------- one Agent ----------------
let drawer = null;
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
  if (drawer.body.dataset.mission !== a.mission) drawAgent(a);
}
function liveHtml(a) {
  const st = a.status || {};
  return `<dl class="kv">
    <dt>Status</dt><dd>${a.online ? '<span class="c-green">ONLINE</span>' : 'OFFLINE'}${st.state ? ` · ${esc(st.state)}` : ''}</dd>
    <dt>Last signal</dt><dd>${esc(ago(a.online ? st.at || a.lastSeen : a.lastSeen))}</dd>
    <dt>Battery</dt><dd>${typeof st.battery === 'number' ? `${Math.round(st.battery * 100)}%${st.charging ? ' (charging)' : ''}` : 'not shared by this device'}</dd>
    ${typeof st.level === 'number' ? `<dt>Reading</dt><dd>${esc(Math.round(st.level))}${a.mission === 'sound' ? ' dB' : '%'}</dd>` : ''}
    <dt>Recruited</dt><dd>${esc(new Date(a.createdAt).toLocaleString('en-GB'))}</dd>
    <dt>Device</dt><dd class="small">${esc(shortUa(a.ua))}</dd></dl>`;
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
    <form class="row" data-rename><label class="field grow" style="margin:0"><span>Codename</span><input name="codename" value="${esc(a.codename)}" maxlength="24" autocomplete="off"></label>
      <label class="field grow" style="margin:0"><span>Where is it?</span><input name="name" value="${esc(a.name)}" placeholder="e.g. Hallway" maxlength="40" autocomplete="off"></label><button style="align-self:end">Save</button></form>
    <div><h2 style="margin-bottom:8px">Mission</h2><div class="missions">${S.missions.map((x) => `<button class="mission" data-mission="${x.id}" aria-pressed="${x.id === a.mission}"><b>${x.glyph} ${esc(x.name)}</b><span>${esc(x.summary)}</span></button>`).join('')}</div></div>
    ${m?.settings.length ? `<form data-msettings><h2 style="margin-bottom:8px">${esc(m.name)} settings</h2>${m.settings.map((s) => settingField(s, a.settings?.[s.key] ?? s.default)).join('')}<button class="btn-primary">Send to Agent</button></form>` : ''}
    <div class="row"><button class="btn-primary" data-liveview ${a.online ? '' : 'disabled'}>📷 Live view</button><button data-cmd="find" ${a.online ? '' : 'disabled'}>◎ Find it (flash + beep)</button><button data-cmd="reload" ${a.online ? '' : 'disabled'}>↻ Restart Agent page</button><span class="grow"></span><button class="btn-danger" data-remove>Disconnect</button></div>
  </div>`;
  box.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    const def = m.settings.find((s) => s.key === r.name);
    box.querySelector(`[data-out="${r.name}"]`).textContent = `${r.value}${def.unit || ''}`;
  }));
  box.querySelector('[data-rename]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { upsert(await T.api(`/agents/${a.id}`, { method: 'PATCH', body: { codename: e.target.codename.value, name: e.target.name.value } })); renderAgents(); refreshDrawer(); toast('Saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
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
          <li>It appears on the radar a few seconds later. Then pick its mission.</li>
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
