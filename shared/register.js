// AGENT REGISTER helpers: what hardware an Agent is, and how much of the time it was online.

/** "iPhone · iOS 17.5 · Safari" from a browser's user-agent string (best effort). */
export function hardwareFromUA(ua = '') {
  ua = String(ua);
  let device = 'Unknown device', os = '', browser = '';
  const ios = ua.match(/(iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/);
  const android = ua.match(/Android (\d+(?:\.\d+)?)(?:;\s*([^;)]+))?/);
  if (ios) { device = ios[1]; os = `iOS ${ios[2]}.${ios[3]}`; }
  else if (android) {
    os = `Android ${android[1]}`;
    const model = (android[2] || '').replace(/Build\/.*/, '').trim();
    device = model && !/^(K|wv|Linux|U)$/.test(model) ? model : 'Android phone';
  } else if (/Macintosh/.test(ua)) { device = /Mobile\//.test(ua) ? 'iPad' : 'Mac'; os = 'macOS'; }
  else if (/Windows/.test(ua)) { device = 'Windows PC'; os = 'Windows'; }
  else if (/CrOS/.test(ua)) { device = 'Chromebook'; os = 'ChromeOS'; }
  else if (/Linux/.test(ua)) { device = 'Linux computer'; os = 'Linux'; }
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { device, os, browser, text: [device, os, browser].filter(Boolean).join(' · ') };
}

/**
 * Share of time online between `from` and `to`, from the Mission Log's "… online" / "… offline" entries
 * for this Agent. `onlineNow` decides the state at the end. Returns 0–100 (or null if no data at all).
 */
export function uptimePct(events, agentId, from, to, onlineNow = false) {
  const marks = events.filter((e) => e.agentId === agentId && e.kind === 'agent' && /\b(online|offline|recruited)\b/.test(e.message || '') && e.ts <= to)
    .sort((a, b) => a.ts - b.ts).map((e) => ({ ts: e.ts, on: !/\boffline\b/.test(e.message) }));
  if (!marks.length) return onlineNow ? 100 : null;
  // state at `from`: the last mark before it (or the first mark's opposite… unknown → start counting at the first mark)
  const before = marks.filter((m) => m.ts <= from).at(-1);
  let t = before ? from : Math.max(from, marks[0].ts), on = before ? before.on : marks[0].on;
  const start = t;
  let up = 0;
  for (const m of marks.filter((x) => x.ts > t)) { if (on) up += m.ts - t; t = m.ts; on = m.on; }
  if (on || onlineNow) up += to - t;
  const span = to - start;
  return span > 0 ? Math.round(Math.min(1, up / span) * 1000) / 10 : null;
}
