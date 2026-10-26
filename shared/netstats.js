// Network intel maths (pure, unit tested): internet latency samples, uptime %, outages, speed tests.
//   samples: [{ t, ms }]  — ms = round-trip time in milliseconds, or null when the internet was down
const MIN = 60000;

export function emptyStats() { return { samples: [], speed: [], outages: [] }; }

/** Add one check result; keeps the last 24 h. Returns { stats, change: 'down'|'up'|null, downFor }. */
export function addSample(stats, t, ms) {
  const s = { samples: [...(stats?.samples || [])], speed: [...(stats?.speed || [])], outages: [...(stats?.outages || [])] };
  const prev = s.samples.at(-1);
  s.samples.push({ t, ms: ms == null ? null : Math.round(ms) });
  while (s.samples.length && t - s.samples[0].t > 24 * 60 * MIN) s.samples.shift();
  let change = null, downFor = 0;
  const wasDown = prev && prev.ms == null, isDown = ms == null;
  if (isDown && !wasDown) { change = 'down'; s.outages.push({ from: t, to: null }); }
  if (!isDown && wasDown) {
    change = 'up';
    const o = s.outages.at(-1);
    if (o && o.to == null) { o.to = t; downFor = t - o.from; }
  }
  while (s.outages.length > 50) s.outages.shift();
  return { stats: s, change, downFor };
}

export function addSpeed(stats, result) {
  const speed = [...(stats?.speed || []), result].slice(-48);
  return { ...stats, speed };
}

/** Share of checks in the last `hours` where the internet was up (0–100), or null with no data. */
export function uptimePct(samples, now, hours = 24) {
  const recent = samples.filter((s) => now - s.t <= hours * 60 * MIN);
  if (!recent.length) return null;
  return Math.round((recent.filter((s) => s.ms != null).length / recent.length) * 1000) / 10;
}

export function median(nums) {
  const a = nums.filter((n) => n != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/** Megabits per second from bytes moved in a number of milliseconds. */
export const mbps = (bytes, ms) => (ms > 0 ? Math.round(((bytes * 8) / (ms / 1000) / 1e6) * 10) / 10 : null);

/** What the dashboards receive (small): last 2 h of samples for the chart, plus summaries. */
export function summary(stats, now) {
  const samples = stats?.samples || [];
  const last = samples.at(-1);
  return {
    online: last ? last.ms != null : null,
    latency: last?.ms ?? null,
    median1h: median(samples.filter((s) => now - s.t <= 60 * MIN).map((s) => s.ms)),
    uptime24h: uptimePct(samples, now, 24),
    recent: samples.filter((s) => now - s.t <= 120 * MIN),
    speed: (stats?.speed || []).slice(-12),
    outages: (stats?.outages || []).slice(-5).reverse(),
    checkedAt: last?.t ?? null,
  };
}
