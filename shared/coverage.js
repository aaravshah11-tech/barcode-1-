// COVERAGE: what each Agent can actually watch on the floor plan, which rooms nobody watches
// (blind spots) and which outside doors/windows have no sensor on them. Pure geometry, metres.
import { pointInPolygon, centroid, openingEnds, bbox, OPENING_KINDS } from './house.js';

/** What each mission senses. camera = a wedge (field of view, range); area = a circle; tripwire = a door. */
export const SENSING = {
  motion: { type: 'camera', fov: 60, range: 5, entry: true, label: 'Camera (motion)' },
  light: { type: 'camera', fov: 70, range: 6, entry: false, label: 'Camera (light level only)' },
  sound: { type: 'area', range: 5, entry: false, label: 'Microphone (sound level)' },
  door: { type: 'tripwire', range: 1.5, entry: true, label: 'Door tripwire' },
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
    return { id: a.id, codename: a.codename, mission: a.mission, online: !!a.online, x: a.place.x, y: a.place.y, dir: Math.round(dir), roomId: room?.id || null, ...SENSING[a.mission] };
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
  return {
    floors, rooms: allRooms, entries: allEntries,
    pct: cellsAll ? Math.round((coveredAll / cellsAll) * 100) : 0,
    blind: allRooms.filter((r) => r.blind), unmonitored: allEntries.filter((e) => e.unmonitored),
  };
}
