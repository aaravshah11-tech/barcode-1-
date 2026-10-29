// TAMPER checks that run on the Agent (no picture or motion data ever leaves the phone):
//  - moved: the phone was picked up or turned (its gravity direction changed and stayed changed)
//  - covered: the camera picture suddenly went completely dark and flat (lens covered)
// Pure functions so they can be tested without a phone.

const deg = (r) => (r * 180) / Math.PI;
function angleBetween(a, b) {
  const la = Math.hypot(...a), lb = Math.hypot(...b);
  if (!la || !lb) return 0;
  const c = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
  return deg(Math.acos(c));
}

/** Feed accelerometer readings (with gravity). Returns 'moved' once when the phone's angle changes by >20° for 1.5 s. */
export function makeMoveWatch({ threshold = 20, hold = 1500, settle = 4000 } = {}) {
  let g = null, base = null, since = null, started = null, away = null;
  return function step([x, y, z], now) {
    if (![x, y, z].every(Number.isFinite)) return null;
    g = g ? g.map((v, i) => v * 0.85 + [x, y, z][i] * 0.15) : [x, y, z]; // smooth out shakes
    started ??= now;
    if (now - started < settle) { base = g; return null; } // let it settle after starting
    const off = angleBetween(base, g);
    if (off > threshold) { away ??= now; if (now - away >= hold && !since) { since = now; return 'moved'; } }
    else { away = null; }
    // once it has been still in a new position for 30 s, that becomes the new normal
    if (since && now - since > 30000 && off > threshold) { base = g; since = null; away = null; }
    else if (since && off <= threshold) since = null;
    return null;
  };
}

/** Camera frame statistics (0–255 grey values). */
export function frameStats(f) {
  let s = 0, s2 = 0;
  for (let i = 0; i < f.length; i++) { s += f[i]; s2 += f[i] * f[i]; }
  const mean = s / f.length;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / f.length - mean * mean)) };
}

/** Feed frame stats ~5×/s. Returns 'covered' when the view goes black and flat for 3 s after being normal, 'uncovered' when it comes back. */
export function makeCoverWatch({ dark = 14, flat = 5, hold = 3000 } = {}) {
  let normal = null, darkSince = null, covered = false;
  return function step({ mean, sd }, now) {
    const isDark = mean < dark && sd < flat;
    if (!isDark) {
      if (mean > 30) normal = normal == null ? mean : normal * 0.95 + mean * 0.05;
      darkSince = null;
      if (covered && mean > 25) { covered = false; return 'uncovered'; }
      return null;
    }
    darkSince ??= now;
    if (!covered && normal != null && normal > 35 && now - darkSince >= hold) { covered = true; return 'covered'; }
    return null;
  };
}
