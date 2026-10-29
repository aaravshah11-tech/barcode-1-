// Agent diagnostics history (battery, link time). Pure, unit tested.
//   samples: [{ t, b: battery % (0–100) | null, c: charging, r: link round-trip ms | null }]
export const DIAG_EVERY = 5 * 60000;   // keep one reading every 5 minutes…
export const DIAG_KEEP = 48 * 3600000; // …for 48 hours

/** Add a reading (only if 5 minutes have passed, or the battery changed by 5 points or charging changed). */
export function addDiagSample(samples = [], s, now) {
  const last = samples.at(-1);
  const b = typeof s.battery === 'number' ? Math.round(s.battery * 100) : null;
  const c = typeof s.charging === 'boolean' ? s.charging : last?.c ?? null;
  const r = typeof s.rtt === 'number' ? s.rtt : null;
  const changed = last && ((b != null && last.b != null && Math.abs(b - last.b) >= 5) || (c !== null && last.c !== null && c !== last.c));
  if (last && now - last.t < DIAG_EVERY && !changed) {
    // fill in a missing value on the latest reading instead of adding a new one
    if (last.b == null && b != null) last.b = b;
    if (last.r == null && r != null) last.r = r;
    return samples;
  }
  const out = samples.filter((x) => now - x.t <= DIAG_KEEP);
  out.push({ t: now, b: b ?? last?.b ?? null, c, r });
  return out;
}

/**
 * Battery alerts: 'low' under 20 %, 'critical' under 10 % (not while charging). Each fires once,
 * until the battery is charged back above 30 %. Returns { alert: 'low'|'critical'|null, state }.
 */
export function batteryAlert(prev = null, battery, charging) {
  if (typeof battery !== 'number') return { alert: null, state: prev };
  const pct = battery * 100;
  if (charging || pct >= 30) return { alert: null, state: null };
  if (pct < 10 && prev !== 'critical') return { alert: 'critical', state: 'critical' };
  if (pct < 20 && !prev) return { alert: 'low', state: 'low' };
  return { alert: null, state: prev };
}

/** Rough hours of battery left from the readings (null when charging / not enough data). */
export function hoursLeft(samples) {
  const run = [];
  for (let i = samples.length - 1; i >= 0; i--) { const s = samples[i]; if (s.c || s.b == null) break; run.unshift(s); }
  if (run.length < 2) return null;
  const a = run[0], z = run.at(-1), used = a.b - z.b, hrs = (z.t - a.t) / 3600000;
  if (used < 2 || hrs < 0.5) return null;
  return Math.round((z.b / (used / hrs)) * 10) / 10;
}

export function fmtDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d) return `${d} d ${h % 24} h`;
  if (h) return `${h} h ${m % 60} min`;
  return `${m} min`;
}
