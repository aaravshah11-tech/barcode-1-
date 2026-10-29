// REPLAY (play back a day's sensor events on the map, fast) and HEATMAP (which rooms were busiest).
// Works on the 3D map and on the flat plan. Nothing new is stored: it reads the Mission Log.
import { esc, $, toast } from '../shared/ui.js';
import { replayable, indexAfter, roomCounts, SPEEDS, clockOf } from '../shared/replay.js';
import { dayStart } from '../shared/briefing.js';
import { ACTIVITY_KINDS } from '../shared/threat.js';

const SPEED_LABEL = { 60: '1 min/s', 300: '5 min/s', 900: '15 min/s', 3600: '1 h/s' };
const KIND = { motion: 'MOTION', door: 'DOOR', sound: 'SOUND', light: 'LIGHT', knock: 'PANEL' };

/**
 * env = { S, api, map3d(): Map3D|null, ensureRooms(): Promise<boolean> (switches to a view with rooms),
 *         renderPlan(), planFlash(roomId) }
 */
export function createTimeline(env) {
  const { S } = env;
  S.heat = { on: false, days: 1, counts: {}, max: 0, unplaced: 0, total: 0 };
  let heatEvents = []; // the events behind the heatmap (for live updates)
  let rp = null; // the replay in progress

  const where = (agentId) => {
    const a = S.agents.find((x) => x.id === agentId);
    for (const f of S.house?.floors || []) { const r = f.rooms.find((x) => x.id === a?.place?.roomId); if (r) return r.name; }
    return a ? a.name || a.codename : 'Unknown';
  };
  const roomName = (id) => { for (const f of S.house?.floors || []) { const r = f.rooms.find((x) => x.id === id); if (r) return r.name; } return ''; };

  // ---------- heatmap ----------
  function applyHeat(events) {
    Object.assign(S.heat, roomCounts(events, S.agents, S.house));
    env.map3d()?.setHeat(S.heat.on ? S.heat.counts : null);
    env.renderPlan();
    renderLegend();
  }
  async function setHeat(on, days = S.heat.days) {
    S.heat.on = on; S.heat.days = days;
    $$btn('[data-heat]', on);
    if (!on) { env.map3d()?.setHeat(null); env.renderPlan(); renderLegend(); return; }
    if (!(await env.ensureRooms())) { S.heat.on = false; $$btn('[data-heat]', false); return; }
    if (rp) { applyHeat(rp.events.slice(0, rp.idx)); return; }
    const from = days === 1 ? dayStart(Date.now(), 0) : Date.now() - days * 86400000;
    try { heatEvents = (await env.api(`/log?since=${from}&limit=20000`)).filter((e) => ACTIVITY_KINDS.has(e.kind)); } catch (x) { toast(x.message, { kind: 'err' }); return; }
    applyHeat(heatEvents);
  }
  function renderLegend() {
    const box = $('[data-heatlegend]');
    if (!box) return;
    box.hidden = !S.heat.on;
    if (!S.heat.on) return;
    const period = rp ? `Replay so far · ${clockOf(rp.t).slice(0, 5)}` : S.heat.days === 1 ? 'Today' : 'Last 7 days';
    box.innerHTML = `<div class="hl-head"><b>Busiest rooms</b>${rp ? '' : `<span class="filters"><button data-heatdays="1" aria-pressed="${S.heat.days === 1}">Today</button><button data-heatdays="7" aria-pressed="${S.heat.days === 7}">7 days</button></span>`}</div>
      <div class="hl-ramp" aria-hidden="true">${[1, 2, 3, 4, 5].map((l) => `<i class="h${l}"></i>`).join('')}</div>
      <div class="hl-scale small muted"><span>Fewer</span><span>${S.heat.max ? `${S.heat.max} events` : 'More'}</span></div>
      <div class="small muted">${period} · ${S.heat.total} sensor event${S.heat.total === 1 ? '' : 's'} in rooms${S.heat.unplaced ? ` · ${S.heat.unplaced} from Agents not on the map` : ''}</div>`;
  }
  /** A live event while the heatmap is on (not replaying): count it straight away. */
  function liveEvent(ev) {
    if (!S.heat.on || rp || !ACTIVITY_KINDS.has(ev.kind)) return;
    heatEvents.push(ev);
    applyHeat(heatEvents);
  }
  /** Text for pointing at a room. */
  function heatTip(roomId) {
    if (!S.heat.on || !roomId) return null;
    const n = S.heat.counts[roomId] || 0;
    return `${roomName(roomId)} · ${n} event${n === 1 ? '' : 's'}`;
  }

  // ---------- replay ----------
  async function startReplay(daysAgo = 0) {
    if (!(await env.ensureRooms())) return false;
    stopReplay(false);
    const now = Date.now(), from = dayStart(now, daysAgo), to = daysAgo ? dayStart(now, daysAgo - 1) - 1 : now;
    let events;
    try { events = replayable(await env.api(`/log?since=${from}&limit=20000`), from, to); } catch (x) { toast(x.message, { kind: 'err' }); return false; }
    rp = { daysAgo, from, to, t: from, idx: 0, events, speed: S.replaySpeed || 300, playing: events.length > 0, last: performance.now(), raf: 0, feed: [] };
    // start just before the first event, so there's no long wait
    if (events.length) rp.t = Math.max(from, events[0].ts - 5 * 60000);
    rp.idx = indexAfter(events, rp.t);
    $$btn('[data-replay]', true);
    renderBar();
    if (S.heat.on) applyHeat([]);
    rp.raf = requestAnimationFrame(frame);
    return true;
  }
  function stopReplay(restoreHeat = true) {
    if (!rp) return;
    cancelAnimationFrame(rp.raf);
    rp = null;
    const bar = $('[data-replaybar]');
    if (bar) { bar.hidden = true; bar.innerHTML = ''; }
    $$btn('[data-replay]', false);
    if (restoreHeat && S.heat.on) setHeat(true, S.heat.days);
  }
  function frame(now) {
    if (!rp) return;
    const dt = Math.min(0.25, (now - rp.last) / 1000);
    rp.last = now;
    if (rp.playing) {
      rp.t = Math.min(rp.to, rp.t + dt * rp.speed * 1000);
      const end = indexAfter(rp.events, rp.t);
      const due = rp.events.slice(rp.idx, end);
      rp.idx = end;
      due.slice(-6).forEach(fire); // at high speed only the latest few are animated (all are counted)
      if (due.length) { rp.feed.unshift(...due.slice(-3).reverse()); rp.feed.length = Math.min(rp.feed.length, 3); if (S.heat.on) applyHeat(rp.events.slice(0, rp.idx)); }
      if (rp.t >= rp.to) rp.playing = false;
      updateBar();
    }
    if (rp.playing) rp.raf = requestAnimationFrame(frame);
  }
  function fire(ev) {
    env.map3d()?.event(ev);
    const a = S.agents.find((x) => x.id === ev.agentId);
    if (a?.place?.roomId) env.planFlash(a.place.roomId, ev.level === 'alert');
  }
  function seek(t) {
    rp.t = Math.max(rp.from, Math.min(rp.to, t));
    rp.idx = indexAfter(rp.events, rp.t);
    rp.feed = rp.events.slice(Math.max(0, rp.idx - 3), rp.idx).reverse();
    if (S.heat.on) applyHeat(rp.events.slice(0, rp.idx));
    updateBar();
  }
  function play(on) {
    if (!rp) return;
    if (on && rp.t >= rp.to) seek(rp.events.length ? Math.max(rp.from, rp.events[0].ts - 5 * 60000) : rp.from);
    rp.playing = on;
    rp.last = performance.now();
    cancelAnimationFrame(rp.raf);
    if (on) rp.raf = requestAnimationFrame(frame);
    updateBar();
  }

  function renderBar() {
    const bar = $('[data-replaybar]');
    if (!bar || !rp) return;
    bar.hidden = false;
    const span = rp.to - rp.from || 1;
    // one tick per event (nearby ones merge), alerts in red
    const seen = new Set();
    const ticks = rp.events.map((e) => { const x = Math.round(((e.ts - rp.from) / span) * 400); const k = `${x}${e.level === 'alert' ? 'a' : ''}`; if (seen.has(k)) return ''; seen.add(k); return `<i class="${e.level === 'alert' ? 'alert' : ''}" style="left:${(x / 4).toFixed(2)}%"></i>`; }).join('');
    bar.innerHTML = `<div class="rp-row">
        <span class="rp-tag mono">Replay</span>
        <button class="icon-btn" data-rpplay aria-label="Play or pause"></button>
        <b class="mono rp-clock" data-rpclock></b>
        <span class="filters" role="group" aria-label="Day"><button data-rpday="0" aria-pressed="${rp.daysAgo === 0}">Today</button><button data-rpday="1" aria-pressed="${rp.daysAgo === 1}">Yesterday</button></span>
        <span class="filters" role="group" aria-label="Speed">${SPEEDS.map((v) => `<button data-rpspeed="${v}" aria-pressed="${v === rp.speed}">${SPEED_LABEL[v]}</button>`).join('')}</span>
        <span class="grow"></span>
        <button class="icon-btn btn-ghost" data-rpexit aria-label="Exit replay" title="Exit replay">✕</button>
      </div>
      <div class="rp-track"><div class="rp-ticks" aria-hidden="true">${ticks}</div>
        <input type="range" data-rpseek min="${rp.from}" max="${rp.to}" step="1000" value="${rp.t}" aria-label="Replay time"></div>
      <div class="rp-scale small muted mono"><span>${clockOf(rp.from).slice(0, 5)}</span><span data-rpcount></span><span>${rp.daysAgo ? '24:00' : 'now'}</span></div>
      <ol class="rp-feed mono small" data-rpfeed aria-live="off"></ol>`;
    updateBar();
  }
  function updateBar() {
    const bar = $('[data-replaybar]');
    if (!bar || !rp || bar.hidden) return;
    bar.querySelector('[data-rpclock]').textContent = clockOf(rp.t);
    const seekEl = bar.querySelector('[data-rpseek]');
    if (document.activeElement !== seekEl || rp.playing) seekEl.value = rp.t;
    bar.querySelector('[data-rpplay]').textContent = rp.playing ? '❚❚' : '▶';
    bar.querySelector('[data-rpplay]').setAttribute('aria-pressed', String(rp.playing));
    bar.querySelector('[data-rpcount]').textContent = rp.events.length ? `${rp.idx} / ${rp.events.length} events` : 'No sensor events on this day';
    bar.querySelector('[data-rpfeed]').innerHTML = rp.feed.map((e) => `<li class="${e.level === 'alert' ? 'c-red' : ''}">${clockOf(e.ts)} · ${KIND[e.kind] || e.kind.toUpperCase()} · ${esc(where(e.agentId))}</li>`).join('');
    if (S.heat.on) renderLegend();
  }

  // replay bar + legend controls
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.heatdays) setHeat(true, Number(b.dataset.heatdays));
    if (!rp) return;
    if ('rpplay' in b.dataset) play(!rp.playing);
    else if ('rpexit' in b.dataset) stopReplay();
    else if (b.dataset.rpspeed) { rp.speed = S.replaySpeed = Number(b.dataset.rpspeed); b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
    else if (b.dataset.rpday) startReplay(Number(b.dataset.rpday));
  });
  document.addEventListener('input', (e) => { if (rp && e.target.matches('[data-rpseek]')) seek(Number(e.target.value)); });

  function $$btn(sel, on) { document.querySelectorAll(sel).forEach((x) => x.setAttribute('aria-pressed', String(on))); }

  return {
    setHeat, startReplay, stopReplay, liveEvent, heatTip, play, seek,
    get replaying() { return !!rp; },
    get state() { return rp && { t: rp.t, idx: rp.idx, total: rp.events.length, playing: rp.playing, speed: rp.speed }; },
    /** After the map was rebuilt (view switch, house edit): put the heatmap and bar back. */
    refresh() { env.map3d()?.setHeat(S.heat.on ? S.heat.counts : null); renderLegend(); if (rp) renderBar(); },
  };
}
