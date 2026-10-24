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

  // 1. Impact ≈ peak rotation speed (hands are fastest just before the ball).
  let impact = 0;
  for (let i = 1; i < mag.length; i++) if (mag[i] > mag[impact]) impact = i;
  if (mag[impact] < minPeak) return null;

  // 2. Dominant axis + its sign during the downswing.
  const win = samples.slice(Math.max(0, impact - 10), impact + 1);
  const sums = ['gx', 'gy', 'gz'].map((k) => win.reduce((a, s) => a + s[k], 0));
  const axisIdx = sums.map(Math.abs).indexOf(Math.max(...sums.map(Math.abs)));
  const axis = ['gx', 'gy', 'gz'][axisIdx];
  const sign = Math.sign(sums[axisIdx]) || 1;
  const signed = smooth(samples.map((s) => s[axis] * sign), 3); // + = downswing direction

  // 3. Top of backswing: last point before impact where the rotation reverses (signed rate crosses from − to +).
  let top = -1;
  for (let i = impact; i > 0; i--) {
    if (signed[i - 1] <= 0 && signed[i] > 0) { top = i; break; }
  }
  if (top < 0) {
    // No clean reversal: use the slowest moment in the second before impact.
    const from = Math.max(0, impact - Math.round(1000 / avgDt(samples)));
    top = from;
    for (let i = from; i < impact; i++) if (mag[i] < mag[top]) top = i;
  }

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
  for (let i = impact + 1; i < mag.length; i++) if (mag[i] < startTh * 1.5) { finish = i; break; }

  const t = (i) => samples[i].t;
  const backswingMs = t(top) - t(start);
  const downswingMs = t(impact) - t(top);
  const peakRotation = mag[impact];
  const handSpeed = (peakRotation * Math.PI / 180) * radius; // m/s
  const tempo = downswingMs > 0 ? backswingMs / downswingMs : null;
  // Rough confidence: a real swing has a backswing, a reversal and a fast downswing.
  const quality = !seenBack ? 'low' : tempo && tempo > 1.2 && tempo < 6 && downswingMs > 120 && downswingMs < 600 ? 'good' : 'check';
  return {
    start, top, impact, finish, axis,
    times: { start: t(start), top: t(top), impact: t(impact), finish: t(finish) },
    tempo, backswingMs, downswingMs, swingMs: backswingMs + downswingMs, totalMs: t(finish) - t(start),
    peakRotation, handSpeed, handSpeedMph: handSpeed * 2.23694, handSpeedKmh: handSpeed * 3.6, quality,
  };
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
export function syntheticSwing({ backMs = 900, downMs = 300, peak = 1500, backPeak = 260, hz = 100, still = 400, axis = 'gz', noise = 0 } = {}) {
  const out = [];
  const dt = 1000 / hz;
  let t = 0;
  const push = (rate, acc = 9.8) => {
    const n = () => (noise ? (Math.random() - 0.5) * noise : 0);
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
  while (t < t2 + 500) push(peak * Math.cos((Math.PI / 2) * Math.min(1, (t - t2) / 450)), 30);
  for (let i = 0; i < hz * 0.6; i++) push(0);
  return out;
}

/** Averages for a list of swings with metrics. */
export function averages(swings) {
  const ok = swings.filter((s) => s.metrics?.tempo);
  const avg = (k) => (ok.length ? ok.reduce((a, s) => a + s.metrics[k], 0) / ok.length : null);
  return { count: ok.length, tempo: avg('tempo'), backswingMs: avg('backswingMs'), downswingMs: avg('downswingMs'), peakRotation: avg('peakRotation'), handSpeedMph: avg('handSpeedMph') };
}
