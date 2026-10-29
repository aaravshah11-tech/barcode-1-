// LIVE WORLD on the dashboard: works out the sun, night vision and weather for the 3D map, and runs
// CINEMATIC mode (when nobody has touched HQ for a while the camera circles the house and the
// intel panels take turns). Display choices are per device (an old laptop can switch effects off).
import { $, $$, esc, clock } from '../shared/ui.js';
import { sunPosition } from '../shared/sun.js';
import { skyPhase, nightVision, PHASE_LABEL } from '../shared/world.js';
import { MODE_INFO } from '../shared/threat.js';
import { rainLine } from './intel.js';

const KEY = 'sentinel.world';
export const worldPrefs = (mode = 'hq') => { try { return { nv: 'auto', weatherFx: true, cineMin: mode === 'hq' ? 5 : 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { nv: 'auto', weatherFx: true, cineMin: 0 }; } };
export const setWorldPrefs = (p, mode) => { try { localStorage.setItem(KEY, JSON.stringify({ ...worldPrefs(mode), ...p })); } catch { /* private window */ } dispatchEvent(new Event('sentinel:world')); };
const WET = new Set(['rain', 'snow', 'storm']);
const FOCUS = ['.p-intel', '.p-net', '.p-log', '.p-agents', '.p-home', '.p-comms'];

/**
 * env = { S, mode, map3d(): Map3D|null, show3d(): Promise<boolean> (switch to the 3D map if possible),
 *         restoreView(view), canCinematic(): boolean, isUnlocked(): boolean }
 */
export function createWorld(env) {
  const { S } = env;
  let lastKey = '', state = null, nowOverride = null;
  let cine = null, lastInput = Date.now();

  /** What the 3D map should show right now. */
  function compute(now = nowOverride ?? Date.now()) {
    const p = worldPrefs(env.mode), loc = S.settings.location;
    const sun = loc ? sunPosition(now, loc.lat, loc.lon) : null;
    const phase = sun ? skyPhase(sun.altitude) : null;
    const nv = nightVision(p.nv, { altitude: sun ? sun.altitude : null, now: new Date(now), nightStart: S.settings.nightStart, nightEnd: S.settings.nightEnd });
    const w = S.weather;
    const kind = w ? (w.wetNow ? (WET.has(w.kind) ? w.kind : 'rain') : WET.has(w.kind) ? 'cloud' : w.kind) : null;
    return { sun: sun && { azimuth: Math.round(sun.azimuth), altitude: Math.round(sun.altitude * 2) / 2 }, phase, nv, northDeg: S.settings.northDeg || 0,
      weather: p.weatherFx && w ? { kind, precip: w.precip, cloud: w.cloud, wind: w.wind } : null, effects: p.weatherFx };
  }
  /** Recalculate, and update the map only when something visible changed. */
  function update(force = false) {
    state = compute();
    const key = JSON.stringify(state);
    renderChip();
    if (!force && key === lastKey) return state;
    const m = env.map3d();
    if (m) { m.setWorld(state); lastKey = key; }
    return state;
  }
  function renderChip() {
    const chip = $('[data-worldchip]');
    if (!chip || !state) return;
    const parts = [];
    if (state.nv) parts.push('<b class="nv-tag">Night vision</b>');
    else if (state.phase) parts.push(`${PHASE_LABEL[state.phase]}${state.sun.altitude > 0 ? ` · sun ${Math.round(state.sun.altitude)}°` : ''}`);
    if (state.weather && WET.has(state.weather.kind)) parts.push(state.weather.kind === 'snow' ? 'Snow' : state.weather.kind === 'storm' ? 'Storm' : 'Rain');
    chip.innerHTML = parts.join(' · ');
    chip.hidden = !parts.length;
  }
  setInterval(() => update(), 60000);

  // ---------- CINEMATIC ----------
  const onInput = (e) => {
    if (e.type === 'pointermove') { const d = Math.hypot(e.movementX || 0, e.movementY || 0); if (d < 4) return; }
    lastInput = Date.now();
    if (cine) stopCinematic();
  };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, onInput, { capture: true, passive: true });
  setInterval(() => {
    const min = worldPrefs(env.mode).cineMin;
    if (!cine && min && env.isUnlocked() && Date.now() - lastInput > min * 60000 && env.canCinematic()) startCinematic();
  }, 5000);

  async function startCinematic() {
    if (cine) return true;
    const prevView = S.mapView;
    if (!(await env.show3d())) return false;
    cine = { prevView, i: 0, timer: null };
    env.map3d()?.cinematic(true);
    document.body.classList.add('cinematic');
    const cap = $('[data-cinecap]');
    if (cap) cap.hidden = false;
    const step = () => {
      $$('.cine-focus').forEach((x) => x.classList.remove('cine-focus'));
      const panels = FOCUS.map((s) => $(s)).filter(Boolean);
      panels[cine.i % panels.length]?.classList.add('cine-focus');
      renderCaption(cine.i);
      cine.i++;
    };
    step();
    cine.timer = setInterval(step, 6000);
    return true;
  }
  function stopCinematic() {
    if (!cine) return;
    clearInterval(cine.timer);
    const prev = cine.prevView;
    cine = null;
    document.body.classList.remove('cinematic');
    $$('.cine-focus').forEach((x) => x.classList.remove('cine-focus'));
    const cap = $('[data-cinecap]');
    if (cap) cap.hidden = true;
    env.map3d()?.cinematic(false);
    if (prev && prev !== S.mapView) env.restoreView(prev);
  }
  function renderCaption(i) {
    const cap = $('[data-cinecap]');
    if (!cap) return;
    const t = S.threat || { level: 'GREEN', reason: '' };
    const on = S.agents.filter((a) => a.online).length;
    const last = S.events.find((e) => e.kind !== 'system');
    const lines = [
      `${clock(Date.now())} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}`,
      `THREAT LEVEL ${t.level} · ${(t.reason || '').toUpperCase()}`,
      `${MODE_INFO[S.settings.mode || 'home'].label.toUpperCase()} MODE · ${on}/${S.agents.length} AGENTS ONLINE`,
      S.weather ? `${S.weather.temp}° ${S.weather.text.toUpperCase()} · ${rainLine(S.weather).toUpperCase()}` : null,
      state?.phase ? `${PHASE_LABEL[state.phase].toUpperCase()}${state.nv ? ' · NIGHT VISION' : ''}` : null,
      last ? `LAST REPORT ${clock(last.ts)} · ${last.message.toUpperCase()}` : null,
    ].filter(Boolean);
    cap.innerHTML = `<span class="cine-tag">Sentinel · surveillance</span><div class="cine-line">${esc(lines[i % lines.length])}</div>`;
  }

  return {
    update, compute, startCinematic, stopCinematic,
    get cinematic() { return !!cine; },
    get state() { return state; },
    /** for the automated tests: pretend it's another time; or that nobody has touched HQ for a while */
    _setNow(ms) { nowOverride = ms; return update(true); },
    _idleFor(ms) { lastInput = Date.now() - ms; },
  };
}
