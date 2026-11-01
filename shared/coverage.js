// COVERAGE: what each Agent can actually watch on the floor plan, which rooms nobody watches
// (blind spots) and which outside doors/windows have no sensor on them. Pure geometry, metres.
import { pointInPolygon, centroid, openingEnds, bbox, area, OPENING_KINDS, ZONE_TYPES } from './house.js';

/** What each mission senses. camera = a wedge (field of view, range); area = a circle; tripwire = a door. */
export const SENSING = {
  motion: { type: 'camera', fov: 60, range: 5, entry: true, label: 'Camera (motion)' },
  light: { type: 'camera', fov: 70, range: 6, entry: false, label: 'Camera (light level only)' },
  sound: { type: 'area', range: 5, entry: false, label: 'Microphone (sound level)' },
  door: { type: 'tripwire', range: 1.5, entry: true, label: 'Door tripwire' },
  perimeter: { type: 'camera', fov: 70, range: 12, entry: true, outward: true, label: 'Perimeter watch (looks outside)' },
};
const CELL = 0.25;
const rad = (d) => (d * Math.PI) / 180;
/** Facing: degrees clockwise from the top of the plan (0 = up, 90 = right). */
export const facingVector = (deg) => [Math.sin(rad(deg)), -Math.cos(rad(deg))];
export function angleTo([ax, ay], [bx, by]) { return ((Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI + 360) % 360; }
const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const roomOf = (floor, p) => floor.rooms.find((r) => pointInPolygon(p, r.points)) || null;

/** Does this sensor see point p (same room only — walls block cameras and dull sound)? */
export function sees(sensor, p, floor) {
  const s = SENSING[sensor.mission];
  if (!s) return false;
  const d = Math.hypot(p[0] - sensor.x, p[1] - sensor.y);
  if (d > s.range) return false;
  if (sensor.roomId && roomOf(floor, p)?.id !== sensor.roomId) return false;
  if (s.type === 'camera') return d < 0.3 || diff(angleTo([sensor.x, sensor.y], p), sensor.dir) <= s.fov / 2;
  if (s.type === 'tripwire') return d <= 1.0;
  return true;
}

/** An opening is "outside" if the space just beyond it (away from its room) is not in any room. */
export function isExterior(floor, o) {
  const e = openingEnds(floor, o), r = floor.rooms.find((x) => x.id === o.roomId);
  if (!e || !r) return false;
  const nx = -Math.sin(e.angle), ny = Math.cos(e.angle);
  const inward = pointInPolygon([e.mid[0] + nx * 0.25, e.mid[1] + ny * 0.25], r.points) ? 1 : -1;
  const out = [e.mid[0] - inward * nx * 0.3, e.mid[1] - inward * ny * 0.3];
  return !floor.rooms.some((x) => pointInPolygon(out, x.points));
}

/** Agents on this floor as sensors, with a facing (default: towards the middle of their room). */
export function sensorsOn(floor, agents) {
  return agents.filter((a) => a.place?.floorId === floor.id && SENSING[a.mission]).map((a) => {
    const room = roomOf(floor, [a.place.x, a.place.y]);
    const dir = Number.isFinite(a.place.dir) ? a.place.dir : room ? angleTo([a.place.x, a.place.y], centroid(room.points)) : 0;
    return { id: a.id, codename: a.codename, mission: a.mission, online: !!a.online, x: a.place.x, y: a.place.y, dir: Math.round(dir), ...SENSING[a.mission], roomId: SENSING[a.mission].outward || a.place.zone ? null : room?.id || null };
  });
}

/**
 * Coverage for the whole house. Returns per floor: covered cells, rooms with % covered (blind = under 15 %),
 * outside doors/windows and who watches them, plus totals.
 */
export function coverage(house, agents) {
  const floors = [], allRooms = [], allEntries = [];
  let cellsAll = 0, coveredAll = 0;
  for (const f of house?.floors || []) {
    const sensors = sensorsOn(f, agents);
    const cells = [], rooms = [];
    for (const r of f.rooms) {
      const b = bbox(r.points);
      let total = 0, covered = 0;
      for (let x = b.minX + CELL / 2; x < b.maxX; x += CELL) {
        for (let y = b.minY + CELL / 2; y < b.maxY; y += CELL) {
          if (!pointInPolygon([x, y], r.points)) continue;
          total++;
          const by = sensors.filter((s) => s.roomId === r.id && sees(s, [x, y], f));
          if (by.length) { covered++; cells.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, by.length]); }
        }
      }
      cellsAll += total; coveredAll += covered;
      const pct = total ? Math.round((covered / total) * 100) : 0;
      const room = { id: r.id, name: r.name, floorId: f.id, floor: f.name, pct, blind: pct < 15, sensors: sensors.filter((s) => s.roomId === r.id).map((s) => s.id) };
      rooms.push(room); allRooms.push(room);
    }
    const entries = [];
    for (const o of f.openings || []) {
      if (o.kind === 'arch' || !isExterior(f, o)) continue;
      const e = openingEnds(f, o), r = f.rooms.find((x) => x.id === o.roomId);
      if (!e || !r) continue;
      // a point just inside the room, where someone coming in would be
      const nx = -Math.sin(e.angle), ny = Math.cos(e.angle);
      const sign = pointInPolygon([e.mid[0] + nx * 0.25, e.mid[1] + ny * 0.25], r.points) ? 1 : -1;
      const inside = [e.mid[0] + sign * nx * 0.4, e.mid[1] + sign * ny * 0.4];
      const by = sensors.filter((s) => s.entry && (s.type === 'tripwire' ? Math.hypot(e.mid[0] - s.x, e.mid[1] - s.y) <= s.range : sees(s, inside, f))).map((s) => s.id);
      const entry = { id: o.id, floorId: f.id, floor: f.name, kind: o.kind, label: OPENING_KINDS[o.kind]?.label || o.kind, room: r.name, roomId: r.id, mid: e.mid, a: e.a, b: e.b, monitoredBy: by, unmonitored: !by.length };
      entries.push(entry); allEntries.push(entry);
    }
    floors.push({ id: f.id, name: f.name, cell: CELL, cells, rooms, entries, sensors });
  }
  // the grounds: Agents placed outside, and PERIMETER WATCH Agents looking out through a window
  const site = house?.site;
  if (site?.rooms?.length && house.floors?.[0]) {
    const f0 = house.floors[0];
    const sensors = sensorsOn(f0, agents).filter((s) => s.outward || agents.find((a) => a.id === s.id)?.place?.zone);
    const cells = [], rooms = [];
    for (const z of site.rooms.filter((r) => r.type !== 'plot' && !ZONE_TYPES[r.type]?.building)) {
      const b = bbox(z.points), C = 0.5;
      let total = 0, covered = 0;
      for (let x = b.minX + C / 2; x < b.maxX; x += C) for (let y = b.minY + C / 2; y < b.maxY; y += C) {
        if (!pointInPolygon([x, y], z.points) || f0.rooms.some((r) => pointInPolygon([x, y], r.points))) continue;
        total++;
        if (sensors.some((s) => sees(s, [x, y], site))) { covered++; cells.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, 1]); }
      }
      const pct = total ? Math.round((covered / total) * 100) : 0;
      const room = { id: z.id, name: z.name, floorId: 'site', floor: 'Outside', pct, blind: pct < 15, sensors: [], zone: ZONE_TYPES[z.type]?.zone || null };
      rooms.push(room); allRooms.push(room);
    }
    const entries = (site.openings || []).map((o) => {
      const e = openingEnds(site, o), z = site.rooms.find((r) => r.id === o.roomId);
      if (!e || !z) return null;
      const by = sensors.filter((s) => (s.type === 'tripwire' ? Math.hypot(e.mid[0] - s.x, e.mid[1] - s.y) <= s.range : sees(s, e.mid, site))).map((s) => s.id);
      const entry = { id: o.id, floorId: 'site', floor: 'Outside', kind: o.kind, label: OPENING_KINDS[o.kind]?.label || 'Gate', room: z.name, roomId: z.id, mid: e.mid, a: e.a, b: e.b, monitoredBy: by, unmonitored: !by.length };
      allEntries.push(entry);
      return entry;
    }).filter(Boolean);
    floors.push({ id: 'site', name: 'Outside', cell: 0.5, cells, rooms, entries, sensors });
  }
  return {
    floors, rooms: allRooms, entries: allEntries,
    pct: cellsAll ? Math.round((coveredAll / cellsAll) * 100) : 0,
    blind: allRooms.filter((r) => r.blind), unmonitored: allEntries.filter((e) => e.unmonitored),
    suggestion: suggestAgent(house, allEntries, allRooms),
  };
}

/** Where to put the next Agent: facing the first unwatched door/gate, else in the biggest blind room. */
export function suggestAgent(house, entries, rooms) {
  const e = entries.find((x) => x.unmonitored && x.floorId !== 'site' && /door|sliding|garage/.test(x.kind)) || entries.find((x) => x.unmonitored);
  if (e) {
    const f = e.floorId === 'site' ? house.site : house.floors.find((x) => x.id === e.floorId);
    const r = f?.rooms.find((x) => x.id === e.roomId);
    if (r) {
      const c = centroid(r.points), dx = c[0] - e.mid[0], dy = c[1] - e.mid[1], d = Math.hypot(dx, dy) || 1, k = Math.min(2.5, d * 0.7);
      const x = Math.round((e.mid[0] + (dx / d) * k) * 100) / 100, y = Math.round((e.mid[1] + (dy / d) * k) * 100) / 100;
      return { floorId: e.floorId === 'site' ? house.floors[0].id : e.floorId, x, y, dir: Math.round(angleTo([x, y], e.mid)), text: `Put a MOTION WATCH Agent in ${r.name}, facing the ${e.label.toLowerCase()} (${e.floor}).` };
    }
  }
  const blind = rooms.filter((r) => r.blind && r.floorId !== 'site').map((r) => ({ r, f: house.floors.find((x) => x.id === r.floorId) })).filter((x) => x.f)
    .map(({ r, f }) => ({ r, f, room: f.rooms.find((x) => x.id === r.id) })).sort((a, b) => area(b.room.points) - area(a.room.points))[0];
  if (blind) { const c = centroid(blind.room.points); return { floorId: blind.f.id, x: c[0], y: c[1], dir: 0, text: `Nothing watches ${blind.r.name} (${blind.f.name}). An Agent in a corner there would cover most of it.` }; }
  return null;
}
