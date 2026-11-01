// FLEET helpers: a health score per Agent, day/night mission profiles, "hasn't reported" advisories and
// the weekly fleet summary. Pure functions, unit tested.
import { sunTimes } from './sun.js';

/**
 * Health 0–100 with the reasons points were lost. a = { online, battery (0–1), charging, uptime7d (%),
 * tampers7d, offline24h, version, rtt (ms), armable }.
 */
export function healthScore(a, hqVersion) {
  let score = 100;
  const notes = [];
  const lose = (n, why) => { score -= n; notes.push(why); };
  if (!a.online) lose(40, 'offline');
  if (typeof a.battery === 'number' && !a.charging) {
    if (a.battery < 0.1) lose(25, 'battery critical');
    else if (a.battery < 0.2) lose(15, 'battery low');
    else if (a.battery < 0.5) lose(5, 'not charging');
  }
  if (typeof a.uptime7d === 'number' && a.uptime7d < 95) lose(Math.min(20, Math.round((95 - a.uptime7d) / 2) + 3), `online ${a.uptime7d}% this week`);
  if (a.offline24h > 2) lose(Math.min(15, a.offline24h * 3), `dropped out ${a.offline24h}× today`);
  if (a.tampers7d) lose(Math.min(15, a.tampers7d * 5), `${a.tampers7d} tamper warning${a.tampers7d === 1 ? '' : 's'} this week`);
  if (typeof a.rtt === 'number' && a.rtt > 1500) lose(5, 'slow link');
  if (hqVersion && a.version && a.version !== hqVersion) lose(5, `old version ${a.version}`);
  if (a.armable === false) lose(10, 'privacy masks not confirmed');
  score = Math.max(0, Math.min(100, score));
  return { score, grade: score >= 85 ? 'good' : score >= 60 ? 'fair' : 'poor', notes };
}

/** 'day' or 'night' now: from sunrise/sunset when HQ knows its location, otherwise 07:00–20:00 is day. */
export function phaseAt(now, location) {
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
    const t = sunTimes(now, location.lat, location.lon);
    if (t.polar) return t.polar;
    return now >= t.sunrise && now < t.sunset ? 'day' : 'night';
  }
  const h = new Date(now).getHours();
  return h >= 7 && h < 20 ? 'day' : 'night';
}

/** The mission an Agent with a day/night profile should be on now (null = leave it alone). */
export function profileMission(agent, phase) {
  const p = agent.profiles;
  if (!p?.on) return null;
  const want = phase === 'night' ? p.night : p.day;
  return want && want !== agent.mission ? want : null;
}

/** Agents that have been silent for longer than `minutes` (once per silence: `notified` holds ids already warned). */
export function staleAgents(agents, now, minutes = 15) {
  return agents.filter((a) => !a.online && a.lastSeen && now - a.lastSeen > minutes * 60000)
    .map((a) => ({ id: a.id, codename: a.codename, label: a.label, mins: Math.round((now - a.lastSeen) / 60000) }));
}

/** The weekly fleet health summary: headline numbers and one line per Agent that needs attention. */
export function fleetSummary(rows) {
  if (!rows.length) return { headline: 'No Agents yet.', lines: [], avg: null };
  const avg = Math.round(rows.reduce((s, r) => s + r.health.score, 0) / rows.length);
  const online = rows.filter((r) => r.online).length;
  const attention = rows.filter((r) => r.health.score < 85).sort((a, b) => a.health.score - b.health.score);
  return {
    avg,
    headline: `${online} of ${rows.length} Agents online · average health ${avg}/100 · ${attention.length ? `${attention.length} need${attention.length === 1 ? 's' : ''} attention` : 'nothing needs attention'}.`,
    lines: attention.map((r) => `${r.label} ${r.codename}: ${r.health.score}/100 — ${r.health.notes.join(', ')}`),
  };
}
