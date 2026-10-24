// ⛳ Golf swing analysis from phone motion sensors (pure functions, unit tested).
//
// Input samples: { t (ms), gx, gy, gz (rotation rate, deg/s), ax, ay, az (acceleration, m/s²) }.
// Everything here is an ESTIMATE: a phone on your glove or forearm only sees how
// your hands/forearm rotate, not the club head.

export const CLUBS = ['Driver', '3 wood', '5 wood', 'Hybrid', '3 iron', '4 iron', '5 iron', '6 iron', '7 iron', '8 iron', '9 iron', 'PW', 'GW', 'SW', 'LW'];
export const RESULTS = [
  { id: 'good', label: 'Good', emoji: '✅' }, { id: 'slice', label: 'Slice', emoji: '↪️' }, { id: 'hook', label: 'Hook', emoji: '↩️' },
  { id: 'thin', label: 'Thin', emoji: '〰️' }, { id: 'fat', label: 'Fat', emoji: '🟫' }, { id: 'topped', label: 'Topped', emoji: '⤵️' },
];
/** Approx. radius from the swing's pivot to the phone (metres) for the hand-speed estimate. */
export const PLACEMENTS = [
  { id: 'glove', label: 'Back of glove / hand', radius: 0.7 },
  { id: 'forearm', label: 'Strapped to forearm', radius: 0.55 },
];

export const magnitude = (s) => Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);

/** Moving average to take the edge off sensor noise. */
export function smooth(values, n = 3) {
  if (n <= 1) return values.slice();
  const out = new Array(values.length);
  const h = Math.floor(n / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(values.length - 1, i + h); j++) { sum += values[j]; c++; }
    out[i] = sum / c;
  }
  return out;
}

/**
 * Find the swing phases and metrics.
 * opts: { radius (m), startThreshold (deg/s), minPeak (deg/s) }
 * Returns null if no swing is found, otherwise
 * { start, top, impact, finish (indexes), times (ms), tempo, backswingMs, downswingMs, swingMs, totalMs,
 *   peakRotation (deg/s), handSpeed (m/s), handSpeedMph, axis, quality }
 */
export function analyzeSwing(samples, opts = {}) {
  const radius = opts.radius ?? 0.7;
  const startTh = opts.startThreshold ?? 30;
  const minPeak = opts.minPeak ?? 350;
  if (!samples || samples.length < 10) return null;
  const mag = smooth(samples.map(magnitude), 3);

  // 1. Peak rotation speed (hands are fastest just before the ball)…
  let peak = 0;
  for (let i = 1; i < mag.length; i++) if (mag[i] > mag[peak]) peak = i;
  if (mag[peak] < minPeak) return null;
  // …then the ball strike itself shows up as a sharp jolt in the accelerometer close to that peak.
  const hit = refineImpact(samples, peak);
  let impact = hit.index;

  // 2. Dominant axis + its sign during the downswing.
  const win = samples.slice(Math.max(0, peak - 10), peak + 1);
  const sums = ['gx', 'gy', 'gz'].map((k) => win.reduce((a, s) => a + s[k], 0));
  const axisIdx = sums.map(Math.abs).indexOf(Math.max(...sums.map(Math.abs)));
  const axis = ['gx', 'gy', 'gz'][axisIdx];
  const sign = Math.sign(sums[axisIdx]) || 1;
  const signed = smooth(samples.map((s) => s[axis] * sign), 3); // + = downswing direction

  // 3. Top of backswing: last point before the peak where the rotation reverses (signed rate crosses from − to +).
  let top = -1;
  for (let i = peak; i > 0; i--) {
    if (signed[i - 1] <= 0 && signed[i] > 0) { top = i; break; }
  }
  if (top < 0) {
    // No clean reversal: use the slowest moment in the second before the peak.
    const from = Math.max(0, peak - Math.round(1000 / avgDt(samples)));
    top = from;
    for (let i = from; i < peak; i++) if (mag[i] < mag[top]) top = i;
  }
  if (impact <= top) impact = peak;

  // 4. Start of backswing: going back from the top, the backswing hump (signed < 0) began when speed rose above the threshold.
  let start = top;
  let seenBack = false;
  for (let i = top - 1; i >= 0; i--) {
    if (signed[i] < -startTh) seenBack = true;
    if (seenBack && mag[i] < startTh) { start = i + 1; break; }
    if (i === 0) start = 0;
  }
  if (!seenBack) start = Math.max(0, top - 1);

  // 5. Finish: after impact, when rotation settles below the threshold.
  let finish = samples.length - 1;
  for (let i = Math.max(impact, peak) + 1; i < mag.length; i++) if (mag[i] < startTh * 1.5) { finish = i; break; }

  const t = (i) => samples[i].t;
  const backswingMs = t(top) - t(start);
  const downswingMs = t(impact) - t(top);
  const peakRotation = mag[peak];
  const handSpeed = (peakRotation * Math.PI / 180) * radius; // m/s
  const tempo = downswingMs > 0 ? backswingMs / downswingMs : null;
  // Rough confidence: a real swing has a backswing, a reversal and a fast downswing.
  const quality = !seenBack ? 'low' : tempo && tempo > 1.2 && tempo < 6 && downswingMs > 120 && downswingMs < 600 ? 'good' : 'check';
  return {
    start, top, impact, finish, peak, axis, impactFrom: impact === hit.index ? hit.source : 'rotation',
    times: { start: t(start), top: t(top), impact: t(impact), finish: t(finish) },
    tempo, backswingMs, downswingMs, swingMs: backswingMs + downswingMs, totalMs: t(finish) - t(start),
    peakRotation, handSpeed, handSpeedMph: handSpeed * 2.23694, handSpeedKmh: handSpeed * 3.6, quality,
  };
}

const accMag = (s) => Math.sqrt((s.ax || 0) ** 2 + (s.ay || 0) ** 2 + (s.az || 0) ** 2);

/**
 * The ball strike is a sharp jolt in acceleration. Look within ±windowMs of peak rotation for the
 * biggest sample-to-sample jump; use it only if it clearly stands out from the movement around it.
 * Returns { index, source: 'accel' | 'rotation', jolt }.
 */
export function refineImpact(samples, peak, { windowMs = 80, minJolt = 6 } = {}) {
  const tp = samples[peak].t;
  const idx = [];
  for (let i = Math.max(1, peak - 40); i < Math.min(samples.length, peak + 41); i++) if (Math.abs(samples[i].t - tp) <= windowMs) idx.push(i);
  if (idx.length < 3) return { index: peak, source: 'rotation', jolt: 0 };
  const d = (i) => Math.abs(accMag(samples[i]) - accMag(samples[i - 1]));
  let best = idx[0];
  for (const i of idx) if (d(i) > d(best)) best = i;
  // Typical movement: the average jump in the window, leaving out the spike itself and its neighbours.
  const rest = idx.filter((i) => Math.abs(i - best) > 1).map(d);
  const typical = rest.length ? rest.reduce((a, v) => a + v, 0) / rest.length : 0;
  const jolt = d(best);
  // The jolt goes up then down: pick the sample where it lands (the first of the pair).
  const index = best > 0 && accMag(samples[best]) < accMag(samples[best - 1]) && d(best - 1) > jolt * 0.5 ? best - 1 : best;
  return jolt >= Math.max(minJolt, typical * 4) ? { index, source: 'accel', jolt } : { index: peak, source: 'rotation', jolt };
}

function avgDt(samples) {
  return samples.length > 1 ? (samples.at(-1).t - samples[0].t) / (samples.length - 1) : 16;
}

/** Is the phone held still? (for arming the recorder) */
export function isStill(samples, ms = 500, threshold = 15) {
  if (!samples.length) return false;
  const end = samples.at(-1).t;
  const recent = samples.filter((s) => s.t >= end - ms);
  return recent.length >= 5 && end - recent[0].t >= ms * 0.8 && recent.every((s) => magnitude(s) < threshold);
}

/** Has a full swing happened in this buffer? (big peak, then settled for a moment) */
export function swingFinished(samples, { minPeak = 350, settleMs = 400, threshold = 45 } = {}) {
  let peakAt = -1, peak = 0;
  for (let i = 0; i < samples.length; i++) { const m = magnitude(samples[i]); if (m > peak) { peak = m; peakAt = i; } }
  if (peak < minPeak) return false;
  const after = samples.slice(peakAt + 1);
  if (!after.length || after.at(-1).t - samples[peakAt].t < settleMs) return false;
  const tail = after.filter((s) => s.t >= after.at(-1).t - settleMs);
  return tail.every((s) => magnitude(s) < threshold);
}

/** Make a realistic synthetic swing for tests and the demo (backswing:downswing ≈ ratio:1). */
export function syntheticSwing({ backMs = 900, downMs = 300, peak = 1500, backPeak = 260, hz = 100, still = 400, axis = 'gz', noise = 0, spikeMs = null, spike = 45 } = {}) {
  const out = [];
  const dt = 1000 / hz;
  let t = 0;
  let peakT = null;
  const push = (rate) => {
    const n = () => (noise ? (Math.random() - 0.5) * noise : 0);
    // Gravity plus a smooth pull that grows with rotation speed (like centripetal force).
    let acc = 9.8 + 20 * (rate / (peak || 1)) ** 2;
    if (spikeMs != null && peakT != null && Math.abs(t - (peakT + spikeMs)) < dt / 2) acc += spike;
    const s = { t: Math.round(t), gx: n(), gy: n(), gz: n(), ax: 0, ay: acc, az: 0 };
    s[axis] += rate;
    out.push(s);
    t += dt;
  };
  for (; t < still;) push(0);
  const t0 = t;
  while (t < t0 + backMs) push(-backPeak * Math.sin(Math.PI * (t - t0) / backMs));
  const t1 = t;
  while (t < t1 + downMs) push(peak * Math.sin((Math.PI / 2) * (t - t1) / downMs));
  const t2 = t;
  peakT = t2;
  while (t < t2 + 500) push(peak * Math.cos((Math.PI / 2) * Math.min(1, (t - t2) / 450)));
  for (let i = 0; i < hz * 0.6; i++) push(0);
  return out;
}

/** Averages for a list of swings with metrics. */
export function averages(swings) {
  const ok = swings.filter((s) => s.metrics?.tempo);
  const avg = (k) => (ok.length ? ok.reduce((a, s) => a + s.metrics[k], 0) / ok.length : null);
  return { count: ok.length, tempo: avg('tempo'), backswingMs: avg('backswingMs'), downswingMs: avg('downswingMs'), peakRotation: avg('peakRotation'), handSpeedMph: avg('handSpeedMph') };
}

// ---------- per-person calibration ----------
/** Distance from the lead shoulder to the phone, from the golfer's height (rough body proportions). */
export function radiusFor(heightCm, placement = 'glove') {
  if (!heightCm || heightCm < 90 || heightCm > 230) return PLACEMENTS.find((p) => p.id === placement)?.radius || 0.7;
  return Math.round((heightCm / 100) * (placement === 'forearm' ? 0.3 : 0.39) * 100) / 100;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pct = (vals, p) => { const a = vals.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; };

/**
 * Work out a golfer's own thresholds from ~3 s held still and a few practice swings.
 * still: samples; swings: [samples, …]. Returns settings for analyzeSwing / isStill / swingFinished.
 */
export function calibrate({ still = [], swings = [] } = {}) {
  const noise = pct(still.map(magnitude), 0.95);
  const stillThreshold = Math.round(clamp(noise * 2 + 6, 10, 40));
  const startThreshold = Math.round(clamp(noise * 2 + 18, 20, 60));
  const found = swings.map((s) => analyzeSwing(s, { startThreshold, minPeak: 150 })).filter(Boolean);
  const peaks = found.map((r) => r.peakRotation);
  const minPeak = peaks.length ? Math.round(clamp(Math.min(...peaks) * 0.5, 150, 600)) : 350;
  const tempos = found.map((r) => r.tempo).filter(Boolean);
  return {
    noise: Math.round(noise * 10) / 10, stillThreshold, startThreshold, minPeak, swings: found.length,
    avgPeak: peaks.length ? Math.round(peaks.reduce((a, v) => a + v, 0) / peaks.length) : null,
    avgTempo: tempos.length ? Math.round((tempos.reduce((a, v) => a + v, 0) / tempos.length) * 100) / 100 : null,
  };
}

/** The settings to analyse with for a golfer profile (or the defaults). */
export function settingsFor(golfer, placement = 'glove') {
  const c = golfer?.calibration || {};
  return {
    radius: radiusFor(golfer?.heightCm, placement),
    minPeak: c.minPeak ?? 350, startThreshold: c.startThreshold ?? 30, stillThreshold: c.stillThreshold ?? 15,
  };
}

// ---------- practice sessions ----------
export const SESSION_GAP = 30 * 60 * 1000;

/**
 * Group swings into practice sessions, newest first.
 * Swings saved with a sessionId keep it; older swings (no sessionId) are grouped per golfer
 * whenever there's a gap of more than 30 minutes, with a stable id "auto-<first swing id>".
 */
export function groupSessions(swings, gap = SESSION_GAP) {
  const asc = swings.slice().sort((a, b) => a.t - b.t);
  const ids = new Map();
  const lastAuto = new Map(); // golferId -> { id, end }
  for (const s of asc) {
    if (s.sessionId) continue;
    const g = s.golferId || '';
    const cur = lastAuto.get(g);
    if (cur && s.t - cur.end <= gap) { cur.end = s.t; ids.set(s.id, cur.id); } else { const n = { id: `auto-${s.id}`, end: s.t }; lastAuto.set(g, n); ids.set(s.id, n.id); }
  }
  const groups = new Map();
  for (const s of asc) {
    const id = s.sessionId || ids.get(s.id);
    if (!groups.has(id)) groups.set(id, { id, swings: [], start: s.t, end: s.t, golferId: s.golferId || '' });
    const g = groups.get(id);
    g.swings.push(s); g.end = s.t;
  }
  return [...groups.values()].sort((a, b) => b.end - a.end);
}

/** Which session should a swing recorded now join? Returns an existing id or null (start a new one). */
export function currentSession(swings, golferId, now, gap = SESSION_GAP) {
  const mine = swings.filter((s) => (s.golferId || '') === (golferId || ''));
  const latest = groupSessions(mine, gap)[0];
  return latest && now - latest.end <= gap ? latest.id : null;
}

/** Spread of tempo (standard deviation) — lower is more consistent. */
export function tempoSpread(swings) {
  const v = swings.map((s) => s.metrics?.tempo).filter(Boolean);
  if (v.length < 2) return null;
  const m = v.reduce((a, x) => a + x, 0) / v.length;
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}
