// LIVE WORLD on the dashboard: where the sun is for your location, so the 3D map is lit by the real
// sun and the house casts its real shadow. (Night vision, weather particles and the cinematic camera
// were removed in the professional redesign.)
import { $ } from '../shared/ui.js';
import { sunPosition } from '../shared/sun.js';
import { skyPhase, PHASE_LABEL } from '../shared/world.js';

/** env = { S, map3d(): Map3D|null } */
export function createWorld(env) {
  const { S } = env;
  let lastKey = '', state = null, nowOverride = null;

  function compute(now = nowOverride ?? Date.now()) {
    const loc = S.settings.location;
    const sun = loc ? sunPosition(now, loc.lat, loc.lon) : null;
    return { sun: sun && { azimuth: Math.round(sun.azimuth), altitude: Math.round(sun.altitude * 2) / 2 }, phase: sun ? skyPhase(sun.altitude) : null, northDeg: S.settings.northDeg || 0, cloud: S.weather?.cloud ?? 0 };
  }
  function update(force = false) {
    state = compute();
    const key = JSON.stringify(state);
    const chip = $('[data-worldchip]');
    if (chip) { chip.textContent = state.phase ? `${PHASE_LABEL[state.phase]}${state.sun.altitude > 0 ? ` · sun ${Math.round(state.sun.altitude)}°` : ''}` : ''; chip.hidden = !state.phase; }
    if (!force && key === lastKey) return state;
    const m = env.map3d();
    if (m) { m.setWorld(state); lastKey = key; }
    return state;
  }
  setInterval(() => update(), 60000);
  return { update, compute, get state() { return state; }, _setNow(ms) { nowOverride = ms; return update(true); } };
}
