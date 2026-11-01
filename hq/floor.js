// OPERATIONS FLOOR panels: Current Picture, Triage summary, Agent Fleet, Perimeter, Activity Timeline.
// Pure helpers (summary, lanes) are exported for tests; render functions draw into the workspace panels.
import { esc, $, dayClock } from '../shared/ui.js';
import { MODE_INFO, ACTIVITY_KINDS } from '../shared/threat.js';
import { missionById } from '../shared/missions.js';
import { SEV_RANK, ageText } from '../shared/triage.js';

const H = 3600000;
const SEV_LABEL = { CRITICAL: 'Critical', HIGH: 'Alert', MEDIUM: 'Advisory', LOW: 'Info' };
export const sevWord = (s) => SEV_LABEL[s] || s;
const ago = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };

/** Where an Agent is: a room inside, or an outside zone ('front' | 'garden' | 'garage'). */
export function zoneOf(agent, house) {
  const p = agent?.place;
  if (!p) return null;
  if (p.zone) return p.zone; // outside zone (set in the house builder / PERIMETER WATCH)
  for (const f of house?.floors || []) {
    const r = f.rooms.find((x) => x.id === p.roomId);
    if (r) return /garage|shed|workshop/i.test(r.name) ? 'garage' : 'inside';
  }
  return 'inside';
}
/** Which Activity Timeline lane an event belongs on. */
export function laneOf(ev, agents = [], house = null) {
  if (ev.kind === 'device' || ev.kind === 'network' || (ev.kind === 'system' && /^Internet connection/.test(ev.message || ''))) return 'network';
  if (!ACTIVITY_KINDS.has(ev.kind) && ev.kind !== 'perimeter' && ev.kind !== 'tamper') return null;
  const a = agents.find((x) => x.id === ev.agentId);
  const z = ev.data?.zone || zoneOf(a, house);
  return ['front', 'garden', 'garage'].includes(z) ? z : 'inside';
}
export const LANES = [['inside', 'Inside'], ['front', 'Front'], ['garden', 'Garden'], ['garage', 'Garage'], ['network', 'Network']];

/** The one-line picture (until the Analyst writes it): plain, evidence-based, no guessing. */
export function pictureSummary({ alerts = [], events = [], agents = [], mode = 'home', now = Date.now() }) {
  const open = alerts.filter((a) => ['new', 'acknowledged', 'escalated'].includes(a.status)).sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.ts - a.ts);
  const recent = alerts.filter((a) => now - a.ts < 4 * H && SEV_RANK[a.severity] >= 2);
  const significant = alerts.filter((a) => SEV_RANK[a.severity] >= 2).sort((a, b) => b.ts - a.ts)[0] || null;
  const offline = agents.filter((a) => !a.online);
  const parts = [];
  if (open.length) parts.push(`${open.length} open alert${open.length === 1 ? '' : 's'}; most serious: ${open[0].title} (${open[0].id}).`);
  else if (!recent.length) parts.push(`Quiet. No alerts in the last 4 hours.`);
  else parts.push(`${recent.length} alert${recent.length === 1 ? '' : 's'} in the last 4 hours, all handled.`);
  const act = events.filter((e) => ACTIVITY_KINDS.has(e.kind) && now - e.ts < H).length;
  parts.push(act ? `${act} sensor event${act === 1 ? '' : 's'} in the last hour.` : 'No sensor activity in the last hour.');
  if (offline.length) parts.push(`${offline.length} Agent${offline.length === 1 ? '' : 's'} offline: ${offline.map((a) => a.codename).join(', ')}.`);
  return { state: (MODE_INFO[mode]?.label || mode).toUpperCase(), text: parts.join(' '), significant, since: significant ? now - significant.ts : null, source: 'auto' };
}

/** Fleet rows: problems first (offline, low battery, recent tamper), then by number. */
export function fleetOrder(agents) {
  const score = (a) => (!a.online ? 3 : 0) + ((a.status?.battery ?? 1) < 0.2 && !a.status?.charging ? 2 : 0) + (a.lastTamper && Date.now() - a.lastTamper.ts < 6 * H ? 2 : 0);
  return [...agents].sort((a, b) => score(b) - score(a) || (a.number || 0) - (b.number || 0));
}
const bars = (rtt) => (rtt == null ? 0 : rtt < 80 ? 4 : rtt < 200 ? 3 : rtt < 500 ? 2 : 1);
export function fleetRow(a, house) {
  const st = a.status || {}, m = missionById(a.mission);
  const batt = typeof st.battery === 'number' ? st.battery : typeof a.battery === 'number' ? a.battery : null;
  const room = (() => { for (const f of house?.floors || []) { const r = f.rooms.find((x) => x.id === a.place?.roomId); if (r) return r.name; } return a.place?.zone ? a.place.zone[0].toUpperCase() + a.place.zone.slice(1) : 'Not placed'; })();
  const problem = !a.online ? 'OFFLINE' : batt != null && batt < 0.2 && !st.charging ? 'LOW BATTERY' : a.lastTamper && Date.now() - a.lastTamper.ts < 6 * H ? `TAMPER: ${a.lastTamper.type.toUpperCase()}` : '';
  const sig = a.online ? bars(st.rtt) : 0;
  return `<button class="agent fleet-row ${a.online ? '' : 'offline'}" data-agent="${esc(a.id)}" draggable="true">
    <span class="dot ${a.online ? (problem ? 'warn' : 'on') : ''}" aria-hidden="true"></span>
    <span class="a-name"><span class="mono small muted">${esc(a.label)}</span> ${esc(a.codename)}${problem ? ` <span class="badge-mini">${esc(problem)}</span>` : ''}<small>${esc(room)} · ${m ? esc(m.name) : ''}</small></span>
    <span class="a-meta"><span class="sig" title="Signal">${[1, 2, 3, 4].map((i) => `<i class="${i <= sig ? 'on' : ''}" style="height:${i * 3}px"></i>`).join('')}</span>
      <span class="batbar" title="Battery ${batt != null ? Math.round(batt * 100) + '%' : 'unknown'}${st.charging ? ' (charging)' : ''}"><i style="width:${batt != null ? Math.round(batt * 100) : 0}%"></i></span>
      <span class="sr-only">${a.online ? 'ONLINE' : 'OFFLINE'}</span><span class="a-sub" data-ago="${a.online ? (st.at || a.lastSeen || '') : (a.lastSeen || '')}"></span></span>
  </button>`;
}

export function renderPicture(S, override = null) {
  const box = $('[data-picture]');
  if (!box) return;
  const p = pictureSummary({ alerts: S.alerts, events: S.events, agents: S.agents, mode: S.settings.mode, now: Date.now() });
  const text = override?.text || p.text;
  box.innerHTML = `<div class="pic-state m-${esc(S.settings.mode || 'home')}"><span class="kfig">${esc(p.state)}</span><span class="small muted">${esc(MODE_INFO[S.settings.mode || 'home']?.summary || '')}</span></div>
    <p class="pic-text">${esc(text)}</p>
    <div class="pic-foot"><span><span class="lbl">Last significant</span><small>${p.significant ? `${esc(dayClock(p.significant.ts))} · ${esc(p.significant.title)}` : 'None recorded'}</small></span><b class="mono kfig-sm" data-picsince="${p.significant?.ts || ''}">${p.since != null ? ago(p.since) : '—'}</b></div>
    <div class="lbl pic-src">${override?.text ? `Analyst · ${esc(dayClock(override.at))}` : 'Automatic summary'}</div>`;
}

export function renderTriageSummary(S) {
  const box = $('[data-sevsum2]');
  if (!box) return;
  const open = (S.alerts || []).filter((a) => a.status === 'new');
  box.innerHTML = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => { const n = open.filter((a) => a.severity === s).length; return `<div class="sc sc-${s}"><span class="lbl">${sevWord(s)}</span><b class="${n ? '' : 'zero'}">${n}</b></div>`; }).join('');
}

export function renderPerimeterMini(S) {
  const box = $('[data-perimini]');
  if (!box) return;
  const zones = [['front', 'Front / driveway'], ['garden', 'Back garden'], ['garage', 'Garage / shed']];
  const outside = (S.events || []).filter((e) => ['front', 'garden', 'garage'].includes(laneOf(e, S.agents, S.house)));
  const watchers = (z) => S.agents.filter((a) => zoneOf(a, S.house) === z);
  const w = S.weather;
  box.innerHTML = zones.map(([z, label]) => {
    const last = outside.find((e) => laneOf(e, S.agents, S.house) === z);
    const n = watchers(z).length, alert = last && Date.now() - last.ts < 30 * 60000 && last.level !== 'info';
    return `<div class="row zrow"><span class="dot ${!n ? '' : alert ? 'alert' : 'on'}"></span><span class="grow">${label}<small>${!n ? 'No Agent watching' : last ? `${esc(last.message.replace(/^AGENT-\d+ [A-Z0-9 _-]+: /, ''))} · ${esc(dayClock(last.ts))}` : 'Clear'}</small></span></div>`;
  }).join('') + (w ? `<div class="wx-mini"><div><span class="lbl">Temp</span><b class="mono">${Math.round(w.temp)}°</b></div><div><span class="lbl">Wind</span><b class="mono">${Math.round(w.wind ?? 0)} mph</b></div><div><span class="lbl">Rain</span><b class="mono">${w.precip ?? 0} mm</b></div></div>` : '<p class="small muted">Weather needs your town: <button class="link-btn" data-setloc>set location</button></p>');
}

/**
 * ACTIVITY TIMELINE: 24 h, one lane per zone. Hover a mark for details; drag along the track to scrub —
 * the map replays to that moment.  env = { S, scrub(t) }
 */
export function renderTimeline(env) {
  const box = $('[data-acttl]');
  if (!box) return;
  const { S } = env, now = Date.now(), from = now - 24 * H;
  const evs = (S.tlEvents || S.events || []).filter((e) => e.ts >= from);
  const x = (t) => ((t - from) / (now - from)) * 100;
  const marks = (lane) => evs.filter((e) => laneOf(e, S.agents, S.house) === lane).slice(0, 400)
    .map((e) => `<i class="${e.level === 'alert' ? 'a' : e.level === 'warn' ? 'v' : ''}" style="left:${x(e.ts).toFixed(2)}%" data-tip="${esc(`${dayClock(e.ts)} · ${e.message.replace(/^AGENT-\d+ [A-Z0-9 _-]+: /, '')}`)}"></i>`).join('');
  const ticks = [0, 4, 8, 12, 16, 20, 24].map((h) => { const t = from + h * H; return `<span style="left:${(h / 24) * 100}%">${h === 24 ? 'now' : new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>`; }).join('');
  box.innerHTML = `<div class="tl-grid">${LANES.map(([k, l]) => `<span class="lbl">${l}</span><div class="tl-lane" data-lane="${k}">${marks(k)}</div>`).join('')}
    <span></span><div class="tl-ticks">${ticks}</div></div><div class="tl-scrub" data-tlscrub hidden></div><div class="tl-tip mono" data-tltip hidden></div>`;
  if (box.dataset.wired) return;
  box.dataset.wired = '1';
  const grid = () => box.querySelector('.tl-lane').getBoundingClientRect();
  const timeAt = (clientX) => { const r = grid(); const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width)); return Date.now() - 24 * H + f * 24 * H; };
  let dragging = false;
  const move = (e) => {
    const tip = box.querySelector('[data-tltip]'), mark = e.target.closest?.('[data-tip]');
    if (mark && !dragging) { tip.hidden = false; tip.textContent = mark.dataset.tip; const br = box.getBoundingClientRect(); tip.style.left = `${Math.min(br.width - 260, Math.max(0, e.clientX - br.left + 10))}px`; tip.style.top = `${e.clientY - br.top - 30}px`; }
    else if (!dragging) tip.hidden = true;
    if (dragging) setScrub(timeAt(e.clientX));
  };
  const setScrub = (t) => {
    const r = grid(), br = box.getBoundingClientRect(), s = box.querySelector('[data-tlscrub]');
    s.hidden = false; s.style.left = `${r.left - br.left + ((t - (Date.now() - 24 * H)) / (24 * H)) * r.width}px`;
    s.dataset.time = new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    env.scrub(t);
  };
  box.addEventListener('pointerdown', (e) => { if (!e.target.closest('.tl-lane')) return; dragging = true; box.setPointerCapture?.(e.pointerId); setScrub(timeAt(e.clientX)); e.preventDefault(); });
  box.addEventListener('pointermove', move);
  box.addEventListener('pointerup', () => { dragging = false; });
  box.addEventListener('pointerleave', () => { box.querySelector('[data-tltip]').hidden = true; });
}
