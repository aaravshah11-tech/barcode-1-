// Your house, as HQ stores it. Everything is in metres, seen from above (x → right, y → down).
//   house = { floors: [{ id, name, height, rooms: [{ id, name, points: [[x, y], …], height? }],
//                        openings: [{ id, kind: OPENING_KINDS, roomId, edge, t, width }],
//                        fixtures: [{ id, kind: 'stairs'|'spiral'|'wall'|'column', x, y, w, d, rot }] }],
//               (fixtures = the building's structure: stairs, inner walls, pillars — never furniture.
//                x, y = centre; w = width (a wall's length); d = depth (stairs: length of the flight);
//                rot = degrees clockwise; stairs go UP in the direction they point)
//             trace: { [floorId]: { scale, x, y, opacity, w, h } },   // a floor-plan picture to draw over
//             model: { name, kind, size, scale, x, y, rot, floorId } } // an imported 3D scan
// Pictures and 3D files themselves are kept separately in HQ's browser storage (they're big).

const MAX = { floors: 8, rooms: 80, points: 64, openings: 200, fixtures: 120, coord: 500 };

/** Kinds of gap in a wall. `opens` = it's a door of some sort (it flashes when a door Agent trips). */
export const OPENING_KINDS = {
  door: { label: 'Door', width: 0.9, top: 2.0, opens: true },
  window: { label: 'Window', width: 1.2, bottom: 0.9, top: 2.1 },
  arch: { label: 'Archway (no door)', width: 1.0, top: 2.1 },
  sliding: { label: 'Sliding / patio door', width: 1.8, top: 2.1, opens: true },
  garage: { label: 'Garage door', width: 2.4, top: 2.1, opens: true },
};
/** Parts of the building you can add (structure only — no furniture). */
export const FIXTURE_KINDS = {
  stairs: { label: 'Stairs', w: 0.9, d: 3.2, min: 0.5 },
  spiral: { label: 'Spiral stairs', w: 1.6, d: 1.6, min: 1 },
  wall: { label: 'Inner wall', w: 3, d: 0.1, min: 0.05 },
  column: { label: 'Pillar', w: 0.3, d: 0.3, min: 0.1 },
};
const num = (v, d, lo = -MAX.coord, hi = MAX.coord) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const txt = (v, d, n = 30) => String(v ?? d).replace(/[<>]/g, '').trim().slice(0, n) || d;
const id = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : Math.random().toString(36).slice(2, 10));

export const newId = () => Math.random().toString(36).slice(2, 10);
export const emptyHouse = () => ({ version: 1, floors: [{ id: 'f0', name: 'Ground floor', height: 2.5, rooms: [], openings: [], fixtures: [] }], trace: {}, model: null });

/** Clean up a house from anywhere (the editor, a backup, a linked phone) so it's always safe to use. */
export function sanitizeHouse(h) {
  const out = emptyHouse();
  const floors = Array.isArray(h?.floors) ? h.floors.slice(0, MAX.floors) : [];
  if (floors.length) out.floors = floors.map((f, i) => {
    const rooms = (Array.isArray(f.rooms) ? f.rooms : []).slice(0, MAX.rooms).map((r, j) => ({
      id: id(r.id), name: txt(r.name, `Room ${j + 1}`),
      points: (Array.isArray(r.points) ? r.points : []).slice(0, MAX.points).map((p) => [round(num(p?.[0], 0)), round(num(p?.[1], 0))]),
      ...(r.height != null && Number.isFinite(Number(r.height)) ? { height: num(r.height, 2.5, 1, 10) } : {}),
    })).filter((r) => r.points.length >= 3);
    const roomIds = new Set(rooms.map((r) => r.id));
    const openings = (Array.isArray(f.openings) ? f.openings : []).slice(0, MAX.openings).map((o) => ({
      id: id(o.id), kind: OPENING_KINDS[o.kind] ? o.kind : 'door', roomId: String(o.roomId), edge: Math.max(0, Math.floor(num(o.edge, 0, 0, MAX.points))),
      t: num(o.t, 0.5, 0, 1), width: num(o.width, (OPENING_KINDS[o.kind] || OPENING_KINDS.door).width, 0.3, 6),
    })).filter((o) => roomIds.has(o.roomId) && o.edge < rooms.find((r) => r.id === o.roomId).points.length);
    const fixtures = (Array.isArray(f.fixtures) ? f.fixtures : []).slice(0, MAX.fixtures).filter((x) => FIXTURE_KINDS[x?.kind]).map((x) => {
      const k = FIXTURE_KINDS[x.kind];
      return { id: id(x.id), kind: x.kind, x: round(num(x.x, 0)), y: round(num(x.y, 0)), w: round(num(x.w, k.w, k.min, 30)), d: round(num(x.d, k.d, x.kind === 'wall' ? 0.05 : k.min, 30)), rot: round(((num(x.rot, 0, -3600, 3600) % 360) + 360) % 360) };
    });
    return { id: id(f.id || `f${i}`), name: txt(f.name, i ? `Floor ${i}` : 'Ground floor'), height: num(f.height, 2.5, 1.8, 10), rooms, openings, fixtures };
  });
  const floorIds = new Set(out.floors.map((f) => f.id));
  for (const [fid, t] of Object.entries(h?.trace || {})) {
    if (!floorIds.has(fid) || !t) continue;
    out.trace[fid] = { scale: num(t.scale, 0.02, 0.0001, 10), x: num(t.x, 0), y: num(t.y, 0), opacity: num(t.opacity, 0.5, 0.05, 1), w: num(t.w, 0, 0, 20000), h: num(t.h, 0, 0, 20000) };
  }
  if (h?.model && typeof h.model === 'object') {
    out.model = { name: txt(h.model.name, 'scan', 80), kind: ['glb', 'gltf', 'obj', 'usdz'].includes(h.model.kind) ? h.model.kind : 'glb', size: num(h.model.size, 0, 0, 1e9),
      scale: num(h.model.scale, 1, 0.001, 1000), x: num(h.model.x, 0), y: num(h.model.y, 0), rot: num(h.model.rot, 0, -360, 360), floorId: floorIds.has(h.model.floorId) ? h.model.floorId : out.floors[0].id };
  }
  return out;
}
const round = (n) => Math.round(n * 1000) / 1000;

// ---------- geometry ----------
export const snap = (v, step) => (step ? Math.round(Math.round(v / step) * step * 1000) / 1000 : v);
export function area(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) { const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
export function bbox(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
export function centroid(points) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) { const b = bbox(points); return [b.minX + b.w / 2, b.minY + b.h / 2]; }
  return [cx / (3 * a), cy / (3 * a)];
}
export function pointInPolygon([x, y], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Closest wall to a point: { roomId, edge, t (0–1 along it), dist }. */
export function nearestWall(floor, [x, y]) {
  let best = null;
  for (const r of floor.rooms) {
    for (let i = 0; i < r.points.length; i++) {
      const [ax, ay] = r.points[i], [bx, by] = r.points[(i + 1) % r.points.length];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy, dist = Math.hypot(x - px, y - py);
      if (!best || dist < best.dist) best = { roomId: r.id, edge: i, t, dist, len: Math.sqrt(len2) };
    }
  }
  return best;
}
/** Where an opening (door/window) sits: its two ends in metres. */
export function openingEnds(floor, o) {
  const r = floor.rooms.find((x) => x.id === o.roomId);
  if (!r) return null;
  const [ax, ay] = r.points[o.edge], [bx, by] = r.points[(o.edge + 1) % r.points.length];
  const len = Math.hypot(bx - ax, by - ay) || 1e-9, half = Math.min(o.width, len) / 2 / len;
  const t = Math.max(half, Math.min(1 - half, o.t));
  const at = (k) => [ax + (bx - ax) * k, ay + (by - ay) * k];
  return { a: at(t - half), b: at(t + half), mid: at(t), angle: Math.atan2(by - ay, bx - ax) };
}
/** Turn a point from a fixture's own frame (u across, v along; centre = 0,0) into house metres. */
export function fixturePoint(fx, u, v) {
  const a = (fx.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [round(fx.x + u * c - v * s), round(fx.y + u * s + v * c)];
}
/** The 4 corners of a fixture's footprint. */
export const fixtureCorners = (fx) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => fixturePoint(fx, (i * fx.w) / 2, (j * fx.d) / 2));
/** How many steps a flight needs to climb `rise` metres (about 18 cm each). */
export const stepCount = (rise) => Math.max(3, Math.round(rise / 0.18));
/** Lines to draw a fixture from above: { outline: [[x,y]…], lines: [[a,b]…], arrow: [a,b] | null }. Stairs point UP the way they go. */
export function fixtureLines(fx, rise = 2.75) {
  if (fx.kind === 'spiral') {
    const n = stepCount(rise), r = fx.w / 2, lines = [];
    const turn = 1.5 * Math.PI; // three-quarters of a turn per floor
    for (let k = 0; k <= n; k++) { const a = (k / n) * turn; lines.push([fixturePoint(fx, 0, 0), fixturePoint(fx, Math.sin(a) * r, -Math.cos(a) * r)]); }
    const outline = Array.from({ length: 24 }, (_, k) => fixturePoint(fx, Math.sin((k / 24) * 2 * Math.PI) * r, -Math.cos((k / 24) * 2 * Math.PI) * r));
    return { outline, lines, arrow: null, circle: true };
  }
  const outline = fixtureCorners(fx), lines = [];
  if (fx.kind === 'stairs') {
    const n = stepCount(rise);
    for (let k = 1; k < n; k++) { const v = -fx.d / 2 + (k * fx.d) / n; lines.push([fixturePoint(fx, -fx.w / 2, v), fixturePoint(fx, fx.w / 2, v)]); }
    return { outline, lines, arrow: [fixturePoint(fx, 0, fx.d / 2 - 0.2), fixturePoint(fx, 0, -fx.d / 2 + 0.25)] };
  }
  return { outline, lines, arrow: null };
}
/** Which fixture is under a point (topmost first)? */
export function fixtureAt(floor, p, slack = 0) {
  const list = floor.fixtures || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const fx = list[i];
    const a = (-fx.rot * Math.PI) / 180, dx = p[0] - fx.x, dy = p[1] - fx.y;
    const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(u) <= fx.w / 2 + slack && Math.abs(v) <= fx.d / 2 + slack) return fx;
  }
  return null;
}

/** Which room is a point in (for placing Agents)? */
export const roomAt = (floor, p) => floor.rooms.find((r) => pointInPolygon(p, r.points)) || null;

// ---------- quick-start templates ----------
const rect = (name, x, y, w, h) => ({ id: newId(), name, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
export const TEMPLATES = {
  flat: { name: '1-bed flat', make: () => {
    const lounge = rect('Living room', 0, 0, 5, 4), kitchen = rect('Kitchen', 5, 0, 3, 4), hall = rect('Hall', 0, 4, 3, 2), bath = rect('Bathroom', 3, 4, 2.5, 2), bed = rect('Bedroom', 5.5, 4, 2.5, 3);
    return { floors: [{ id: 'f0', name: 'Flat', height: 2.5, rooms: [lounge, kitchen, hall, bath, bed], openings: [door(hall, 3, 0.5), door(lounge, 2, 0.4), door(bath, 3, 0.5), door(bed, 3, 0.3), win(lounge, 0, 0.5), win(kitchen, 0, 0.5), win(bed, 1, 0.5)], fixtures: [] }] };
  } },
  house: { name: '3-bed house (2 floors)', make: () => {
    const lounge = rect('Living room', 0, 0, 5, 4.5), kitchen = rect('Kitchen', 5, 0, 4, 4.5), hall = rect('Hall', 0, 4.5, 3, 3), dining = rect('Dining room', 3, 4.5, 6, 3);
    const b1 = rect('Main bedroom', 0, 0, 5, 4.5), b2 = rect('Bedroom 2', 5, 0, 4, 4.5), land = rect('Landing', 0, 4.5, 3, 3), b3 = rect('Bedroom 3', 3, 4.5, 3, 3), bath = rect('Bathroom', 6, 4.5, 3, 3);
    return { floors: [
      { id: 'f0', name: 'Ground floor', height: 2.5, rooms: [lounge, kitchen, hall, dining], openings: [door(hall, 2, 0.5), door(lounge, 2, 0.3), door(dining, 3, 0.5), door(kitchen, 3, 0.5), win(lounge, 0, 0.5), win(kitchen, 0, 0.5), win(dining, 2, 0.5)],
        fixtures: [{ id: newId(), kind: 'stairs', x: 2.45, y: 6, w: 0.9, d: 2.8, rot: 0 }] },
      { id: 'f1', name: 'First floor', height: 2.4, rooms: [b1, b2, land, b3, bath], openings: [door(b1, 2, 0.3), door(land, 1, 0.5), door(b3, 3, 0.5), door(bath, 3, 0.5), door(b2, 3, 0.5), win(b1, 0, 0.5), win(b2, 0, 0.5), win(bath, 2, 0.5)], fixtures: [] },
    ] };
  } },
};
function door(room, edge, t) { return { id: newId(), kind: 'door', roomId: room.id, edge, t, width: 0.9 }; }
function win(room, edge, t) { return { id: newId(), kind: 'window', roomId: room.id, edge, t, width: 1.2 }; }

/** Free apps for scanning a room into a 3D file you can import. */
export const SCAN_APPS = [
  { name: 'Scaniverse', where: 'iPhone & Android (free)', how: 'Scan → Share/Export → choose GLB or OBJ.' },
  { name: '3d Scanner App', where: 'iPhone/iPad with LiDAR (free)', how: 'Scan in “LiDAR” or “Room” mode → Share → GLB, OBJ or USDZ.' },
  { name: 'Polycam', where: 'iPhone & Android (free plan, some exports need the paid plan)', how: 'Room/LiDAR mode → Export → GLB.' },
];
