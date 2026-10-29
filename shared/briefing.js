// MISSION BRIEFING: a summary of one day from the Mission Log. Pure, unit tested.
import { ACTIVITY_KINDS } from './threat.js';

const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const modeOf = (e) => e.data?.mode || (e.kind === 'system' && /^Security mode: (\w+)/.exec(e.message)?.[1]?.toLowerCase()) || null;

/** Midnight (local time) at the start of the day `daysAgo` days before `now`. */
export function dayStart(now, daysAgo = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/**
 * events: Mission Log entries (any order). agents: Agent records (with place). house: the floor plan.
 * diag: { [agentId]: samples }. from/to: the period (ms). Returns everything the briefing shows.
 */
export function buildBriefing({ events = [], agents = [], house = null, diag = {}, from, to, now = Date.now() }) {
  const evs = events.filter((e) => e.ts >= from && e.ts < to).sort((a, b) => a.ts - b.ts);
  const rooms = new Map();
  for (const f of house?.floors || []) for (const r of f.rooms) rooms.set(r.id, r.name);
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const where = (id) => { const a = agentById.get(id); return (a && (rooms.get(a.place?.roomId) || a.name || a.codename)) || 'Unknown'; };

  const activity = evs.filter((e) => ACTIVITY_KINDS.has(e.kind));
  const alerts = evs.filter((e) => e.level === 'alert');
  const warnings = evs.filter((e) => e.level === 'warn');

  // busiest rooms and hour
  const perRoom = new Map();
  for (const e of activity) { const k = where(e.agentId); perRoom.set(k, (perRoom.get(k) || 0) + 1); }
  const busiest = [...perRoom].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3);
  const perHour = new Array(24).fill(0);
  for (const e of activity) perHour[new Date(e.ts).getHours()]++;
  const peak = Math.max(...perHour);
  const busiestHour = peak ? perHour.indexOf(peak) : null;

  // comings and goings: AWAY = everyone left; AWAY → HOME = someone came back
  const modes = evs.map((e) => ({ ts: e.ts, mode: modeOf(e), from: e.data?.from || null })).filter((m) => m.mode);
  const departures = [], arrivals = [];
  let prev = null;
  for (const m of modes) {
    const was = m.from || prev;
    if (m.mode === 'away' && was !== 'away') departures.push(m.ts);
    if ((m.mode === 'home' || m.mode === 'night') && (was === 'away' || was === 'lockdown')) arrivals.push(m.ts);
    prev = m.mode;
  }

  const health = agents.map((a) => {
    const offline = evs.filter((e) => e.agentId === a.id && e.kind === 'agent' && /offline$/.test(e.message)).length;
    const samples = (diag[a.id] || []).filter((s) => s.t >= from && s.t < to && s.b != null);
    const minBattery = samples.length ? Math.min(...samples.map((s) => s.b)) : null;
    const lowBattery = evs.some((e) => e.agentId === a.id && /battery (low|critical)/i.test(e.message));
    const ok = !offline && !lowBattery;
    return { id: a.id, label: a.label, codename: a.codename, online: !!a.online, offline, minBattery, lowBattery, ok };
  });

  const outages = evs.filter((e) => e.kind === 'system' && e.message === 'Internet connection lost').length;
  const messages = evs.filter((e) => e.kind === 'comms' && /^Message to/.test(e.message)).length;
  const headline = alerts.length ? `${alerts.length} alert${alerts.length === 1 ? '' : 's'} raised`
    : activity.length ? 'Routine day. No alerts.' : evs.length ? 'All quiet. No activity recorded.' : 'No intelligence for this period.';

  const sentences = [headline];
  if (activity.length) sentences.push(`${activity.length} sensor report${activity.length === 1 ? '' : 's'}${busiest[0] ? `, busiest in the ${busiest[0].name}` : ''}.`);
  if (departures.length || arrivals.length) sentences.push(`${departures.length} departure${departures.length === 1 ? '' : 's'} and ${arrivals.length} arrival${arrivals.length === 1 ? '' : 's'}.`);
  const sick = health.filter((h) => !h.ok);
  sentences.push(agents.length ? (sick.length ? `${sick.length} Agent${sick.length === 1 ? ' needs' : 's need'} attention.` : 'All Agents healthy.') : 'No Agents deployed.');

  return {
    from, to, empty: !evs.length, headline, summary: sentences.join(' '),
    counts: { events: evs.length, activity: activity.length, alerts: alerts.length, warnings: warnings.length, doors: evs.filter((e) => e.kind === 'door').length, messages, outages },
    busiest, busiestHour,
    first: activity[0]?.ts ?? null, last: activity.at(-1)?.ts ?? null,
    departures, arrivals,
    alerts: alerts.slice(-5).map((e) => ({ ts: e.ts, message: e.message })),
    health,
    fmt: { hhmm },
  };
}
