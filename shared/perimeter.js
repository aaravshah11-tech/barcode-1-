// PERIMETER logic: where each Agent watches (inside, front, garden, garage), what happened in each outside
// zone today, front-door visits (visitor / caller / possible delivery / lingering) and doors left open.
// Pure functions, unit tested.
const MIN = 60000;
export const ZONES = [['front', 'Front / driveway'], ['garden', 'Garden'], ['garage', 'Garage / shed']];

/** Where an Agent is: 'inside', or an outside zone ('front' | 'garden' | 'garage'); null if not placed. */
export function zoneOf(agent, house) {
  const p = agent?.place;
  if (agent?.mission === 'perimeter' && agent.settings?.watch) return agent.settings.watch;
  if (!p) return null;
  if (p.zone) return p.zone;
  for (const f of house?.floors || []) {
    const r = f.rooms.find((x) => x.id === p.roomId);
    if (r) return /garage|shed|workshop/i.test(r.name) ? 'garage' : 'inside';
  }
  return 'inside';
}
const zoneOfEvent = (e, agents, house) => e.data?.zone || zoneOf(agents.find((a) => a.id === e.agentId), house);
const isOpened = (e) => e.kind === 'door' && /open/i.test(e.message || '') && !/clos/i.test(e.message || '');
const isClosed = (e) => e.kind === 'door' && /clos/i.test(e.message || '');

/** Today's picture for one zone: watchers, whether it can raise alerts, counts by what was seen, last report. */
export function zoneStatus(zone, { events, agents, house, since }) {
  const watchers = agents.filter((a) => zoneOf(a, house) === zone);
  const evs = events.filter((e) => e.ts >= since && ['perimeter', 'motion', 'door', 'sound', 'light', 'knock'].includes(e.kind) && zoneOfEvent(e, agents, house) === zone);
  const counts = { person: 0, vehicle: 0, animal: 0, motion: 0, door: 0 };
  for (const e of evs) {
    if (e.kind === 'perimeter') counts[e.data?.class in counts ? e.data.class : 'motion']++;
    else if (e.kind === 'door') counts.door += isOpened(e) ? 1 : 0;
    else counts.motion++;
  }
  const unarmed = watchers.filter((a) => a.mission === 'perimeter' && !a.settings?.masksConfirmed);
  return {
    zone, watchers: watchers.map((a) => ({ id: a.id, codename: a.codename, online: !!a.online, mission: a.mission })),
    online: watchers.filter((a) => a.online).length, unarmed: unarmed.map((a) => a.codename),
    counts, last: evs.sort((a, b) => b.ts - a.ts)[0] || null, total: evs.length,
  };
}

/**
 * FRONT-DOOR VISITS: people seen at the front grouped into visits (gaps under 3 minutes), then judged:
 *   Visitor — let in (a door opened during the visit)
 *   Caller — rang the door panel, nobody answered (possible delivery)
 *   Possible delivery or passer-by — there under 2 minutes, nobody answered
 *   Lingering — there 5 minutes or more without being let in
 */
export function frontVisits(events, { agents = [], house = null, since = 0, now = Date.now(), gapMin = 3 } = {}) {
  const front = events.filter((e) => e.ts >= since && e.kind === 'perimeter' && e.data?.class === 'person' && zoneOfEvent(e, agents, house) === 'front').sort((a, b) => a.ts - b.ts);
  const visits = [];
  for (const e of front) {
    const v = visits.at(-1);
    if (v && e.ts - v.end <= gapMin * MIN) { v.end = e.ts; v.sightings++; v.eventIds.push(e.id); }
    else visits.push({ start: e.ts, end: e.ts, sightings: 1, eventIds: [e.id] });
  }
  return visits.map((v) => {
    const near = (e) => e.ts >= v.start - MIN && e.ts <= v.end + 2 * MIN;
    const answered = events.some((e) => near(e) && isOpened(e));
    const rang = events.some((e) => near(e) && e.kind === 'knock');
    const mins = Math.max(0, Math.round((v.end - v.start) / MIN));
    const ongoing = now - v.end < gapMin * MIN;
    const label = answered ? 'Visitor' : mins >= 5 ? 'Lingering' : rang ? 'Caller' : mins < 2 ? 'Possible delivery or passer-by' : 'Caller';
    const outcome = answered ? 'door answered' : rang ? 'rang the door panel, nobody answered' : ongoing ? 'still there' : 'left without the door being opened';
    return { ...v, mins, label, outcome, answered, rang, ongoing, lingering: label === 'Lingering' };
  }).reverse();
}

/** Doors (door Agents in the garage / shed) that are open now, and for how long. */
export function openDoors(events, { agents = [], house = null, now = Date.now(), zones = ['garage'] } = {}) {
  const out = [];
  for (const a of agents.filter((x) => x.mission === 'door' && zones.includes(zoneOf(x, house)))) {
    const last = events.filter((e) => e.agentId === a.id && e.kind === 'door' && (isOpened(e) || isClosed(e))).sort((x, y) => y.ts - x.ts)[0];
    if (last && isOpened(last)) out.push({ agentId: a.id, codename: a.codename, name: a.name || a.codename, since: last.ts, mins: Math.floor((now - last.ts) / MIN) });
  }
  return out;
}
