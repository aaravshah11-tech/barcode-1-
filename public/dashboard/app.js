// SENTINEL Command Centre.
import { esc, $, $$, toast, sheet, confirmBox, typewrite, clock, dayClock, ago, qrSvg, api, LOGO } from '/shared/ui.js';
import { boot } from '/shared/boot.js';
import { Radar } from '/shared/radar.js';
import { missionById } from '/shared/missions.js';
import { openSettings } from '/dashboard/settings.js';

const app = $('#app');
const S = { agents: [], events: [], threat: null, people: [], settings: { fx: true, mode: 'auto' }, missions: [], network: null, filter: 'all', ws: null, open: null };
let radar = null;

// ---------------- login / first-time password ----------------
async function start() {
  let auth;
  try { auth = await api('/api/auth'); } catch { app.innerHTML = gateHtml('<p>Can’t reach HQ. Is it running?</p>'); return; }
  if (auth.loggedIn) return main();
  if (auth.needsSetup && !auth.local) {
    app.innerHTML = gateHtml(`<p>HQ needs a password first. Open <b class="mono">https://localhost:${location.port || 443}</b> on the HQ computer itself and create one there.</p>`);
    return;
  }
  const setup = auth.needsSetup;
  app.innerHTML = gateHtml(`
    <p class="muted small">${setup ? 'First time here. Choose a password for the Command Centre. You’ll need it to log in from other devices.' : 'Enter the HQ password.'}</p>
    <form data-gate>
      <label class="field"><span>Password</span><input type="password" name="pw" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="6" required autofocus></label>
      ${setup ? '<label class="field"><span>Again</span><input type="password" name="pw2" autocomplete="new-password" minlength="6" required></label>' : ''}
      <p class="c-red small" data-err></p>
      <button class="btn-primary" style="width:100%">${setup ? 'Create password' : 'Log in'}</button>
    </form>`);
  $('[data-gate]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (setup && f.pw.value !== f.pw2.value) { $('[data-err]').textContent = 'The two passwords don’t match.'; return; }
    try { await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: { password: f.pw.value } }); main(); } catch (x) { $('[data-err]').textContent = x.message; }
  });
}
const gateHtml = (inner) => `<div class="gate"><div class="panel">${LOGO}<h1 class="mono glitch" style="text-align:center;letter-spacing:.2em;color:var(--green)">SENTINEL // HQ</h1><div style="margin-top:14px">${inner}</div></div></div>`;

// ---------------- the Command Centre ----------------
async function main() {
  let state;
  try { state = await api('/api/state'); } catch (x) { if (x.status === 401) return start(); throw x; }
  apply(state);
  document.body.classList.toggle('fx', S.settings.fx);
  await boot({ fx: S.settings.fx });
  shell();
  renderAll();
  connect();
  setInterval(tick, 1000);
}

function apply(st) {
  S.agents = st.agents; S.events = st.events; S.threat = st.threat; S.people = st.people; S.settings = st.settings; S.missions = st.missions;
  if (st.network) S.network = st.network;
}

function shell() {
  app.innerHTML = `
  <header class="top">
    ${LOGO}<div class="brand glitch">SENTINEL <small>// HQ</small></div>
    <span class="threat" data-threat aria-live="polite"></span>
    <span class="spacer"></span>
    <div class="presence" role="group" aria-label="Who's home">
      <button data-mode="auto" title="Use Wi-Fi recon to tell who’s home">AUTO</button><button data-mode="home">HOME</button><button data-mode="away" class="away">AWAY</button>
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
      <section class="panel"><div class="panel-head"><h2>Who’s home</h2><button class="btn-ghost small" data-people>Manage</button></div><div class="people" data-peoplelist></div></section>
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
    try { S.settings = await api('/api/settings', { method: 'PATCH', body: { mode: b.dataset.mode } }); renderTop(); } catch (x) { toast(x.message, { kind: 'err' }); }
  } else if ('recruit' in b.dataset) recruit();
  else if ('settings' in b.dataset) openSettings(S, { onChange: (s) => { S.settings = s; document.body.classList.toggle('fx', s.fx); radar?.setFx(s.fx); } });
  else if ('people' in b.dataset) openSettings(S, { tab: 'people', onChange: (s) => { S.settings = s; } });
  else if (b.dataset.agent) openAgent(b.dataset.agent);
  else if (b.dataset.filter) { S.filter = b.dataset.filter; $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderLog(); }
  else if ('older' in b.dataset) {
    const oldest = S.events.at(-1)?.id;
    if (!oldest) return;
    const more = await api(`/api/log?before=${oldest}&limit=150`);
    if (!more.length) { b.textContent = 'No older entries'; b.disabled = true; return; }
    S.events.push(...more);
    renderLog();
  }
}

// ---------------- live link ----------------
function connect(delay = 1000) {
  const ws = new WebSocket(`wss://${location.host}/ws`);
  S.ws = ws;
  ws.onmessage = (m) => {
    if (m.data === 'pong') return;
    const msg = JSON.parse(m.data);
    if (msg.t === 'state') { apply(msg); renderAll(); }
    else if (msg.t === 'agent') { upsert(msg.agent); renderAgents(); if (S.open === msg.agent.id) refreshDrawer(); }
    else if (msg.t === 'agentRemoved') { S.agents = S.agents.filter((a) => a.id !== msg.id); renderAgents(); }
    else if (msg.t === 'event') addEvent(msg.event);
    else if (msg.t === 'threat') { S.threat = msg.threat; renderTop(); }
    else if (msg.t === 'settings') { S.settings = msg.settings; renderTop(); }
    else if (msg.t === 'people') { S.people = msg.people; renderPeople(); }
  };
  ws.onopen = () => { delay = 1000; $('[data-reason]')?.classList.remove('c-red'); };
  ws.onclose = async () => {
    const r = $('[data-reason]');
    if (r) { r.textContent = 'Lost contact with HQ — reconnecting…'; r.classList.add('c-red'); }
    try { const a = await api('/api/auth'); if (!a.loggedIn) return location.reload(); } catch { /* HQ down */ }
    setTimeout(() => connect(Math.min(15000, delay * 2)), delay);
  };
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
  const list = S.people.filter((p) => p.enabled);
  box.innerHTML = list.length ? list.map((p) => `<span class="person"><span class="dot ${p.home ? 'on' : ''}"></span>${esc(p.name)} <span class="muted">${p.home ? 'HOME' : 'AWAY'}</span></span>`).join('')
    : `<span class="muted small">No one tracked yet. ${S.settings.mode === 'auto' ? 'Add people under Manage, or use HOME / AWAY at the top.' : `Presence set by hand: <b>${S.settings.mode.toUpperCase()}</b>.`}</span>`;
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
  const box = drawer.body.querySelector('[data-drawer]');
  drawer.body.dataset.mission = a.mission;
  const m = missionById(a.mission);
  box.innerHTML = `<div class="drawer-grid">
    <div data-live>${liveHtml(a)}</div>
    <form class="row" data-rename><label class="field grow" style="margin:0"><span>Codename</span><input name="codename" value="${esc(a.codename)}" maxlength="24" autocomplete="off"></label>
      <label class="field grow" style="margin:0"><span>Where is it?</span><input name="name" value="${esc(a.name)}" placeholder="e.g. Hallway" maxlength="40" autocomplete="off"></label><button style="align-self:end">Save</button></form>
    <div><h2 style="margin-bottom:8px">Mission</h2><div class="missions">${S.missions.map((x) => `<button class="mission" data-mission="${x.id}" aria-pressed="${x.id === a.mission}"><b>${x.glyph} ${esc(x.name)}</b><span>${esc(x.summary)}</span></button>`).join('')}</div></div>
    ${m?.settings.length ? `<form data-msettings><h2 style="margin-bottom:8px">${esc(m.name)} settings</h2>${m.settings.map((s) => settingField(s, a.settings?.[s.key] ?? s.default)).join('')}<button class="btn-primary">Send to Agent</button></form>` : ''}
    <div class="row"><button data-cmd="find" ${a.online ? '' : 'disabled'}>◎ Find it (flash + beep)</button><button data-cmd="reload" ${a.online ? '' : 'disabled'}>↻ Restart Agent page</button><span class="grow"></span><button class="btn-danger" data-remove>Disconnect</button></div>
  </div>`;
  box.querySelectorAll('input[type=range]').forEach((r) => r.addEventListener('input', () => {
    const def = m.settings.find((s) => s.key === r.name);
    box.querySelector(`[data-out="${r.name}"]`).textContent = `${r.value}${def.unit || ''}`;
  }));
  box.querySelector('[data-rename]').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { upsert(await api(`/api/agents/${a.id}`, { method: 'PATCH', body: { codename: e.target.codename.value, name: e.target.name.value } })); renderAgents(); refreshDrawer(); toast('Saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
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
    try { upsert(await api(`/api/agents/${a.id}`, { method: 'PATCH', body: { settings } })); toast(a.online ? 'Settings sent to the Agent' : 'Saved — the Agent gets them when it reconnects'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mission && b.dataset.mission !== a.mission) {
      try { const na = await api(`/api/agents/${a.id}`, { method: 'PATCH', body: { mission: b.dataset.mission } }); upsert(na); renderAgents(); drawAgent(na); toast(`${na.codename}: ${missionById(na.mission).name}`); } catch (x) { toast(x.message, { kind: 'err' }); }
    } else if (b.dataset.cmd) {
      try { await api(`/api/agents/${a.id}/command`, { method: 'POST', body: { action: b.dataset.cmd } }); toast(b.dataset.cmd === 'find' ? `${a.codename} is flashing and beeping` : 'Restarting the Agent page'); } catch (x) { toast(x.message, { kind: 'err' }); }
    } else if ('remove' in b.dataset) {
      if (!(await confirmBox(`Disconnect ${a.codename}?`, 'It stops being an Agent straight away and forgets HQ. You can recruit it again later with a new QR code.', { ok: 'Disconnect', danger: true }))) return;
      try { await api(`/api/agents/${a.id}`, { method: 'DELETE' }); drawer?.close(); toast(`${a.codename} disconnected`); } catch (x) { toast(x.message, { kind: 'err' }); }
    }
  });
}

// ---------------- recruiting ----------------
async function recruit() {
  let p;
  try { p = await api('/api/pair', { method: 'POST' }); } catch (x) { return toast(x.message, { kind: 'err' }); }
  const before = new Set(S.agents.map((a) => a.id));
  const s = sheet(`<div class="recruit">
      <div class="qr" data-qr aria-label="QR code to recruit an Agent"></div>
      <div>
        <ol>
          <li>On the old phone or tablet (on your home Wi-Fi), open the <b>Camera</b> and scan this code.</li>
          <li>First time only: follow the steps to trust HQ (about a minute).</li>
          <li>It appears on the radar. Then pick its mission.</li>
        </ol>
        <p class="small muted" style="margin-top:14px">No camera? Open <span class="mono c-green">http://${esc(p.address)}:${esc(p.httpPort)}</span> on the device and type:</p>
        <div class="code-big" data-code>${esc(p.code)}</div>
        <p class="small muted" data-timer></p>
        <p class="small c-amber" ${p.address === '127.0.0.1' ? '' : 'hidden'}>HQ can’t see a Wi-Fi address. Is this computer connected to your home Wi-Fi?</p>
      </div></div>`, { title: 'Recruit an Agent', wide: true, onClose: () => { clearInterval(timer); off(); } });
  s.body.querySelector('[data-qr]').innerHTML = await qrSvg(p.joinUrl);
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

start();
