// Your house, as HQ stores it. Everything is in metres, seen from above (x → right, y → down).
//   house = { floors: [{ id, name, height, rooms: [{ id, name, points: [[x, y], …], height? }],
//                        openings: [{ id, kind: 'door'|'window', roomId, edge, t, width }] }],
//             trace: { [floorId]: { scale, x, y, opacity, w, h } },   // a floor-plan picture to draw over
//             model: { name, kind, size, scale, x, y, rot, floorId } } // an imported 3D scan
// Pictures and 3D files themselves are kept separately in HQ's browser storage (they're big).

const MAX = { floors: 8, rooms: 80, points: 64, openings: 200, coord: 500 };
const num = (v, d, lo = -MAX.coord, hi = MAX.coord) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const txt = (v, d, n = 30) => String(v ?? d).replace(/[<>]/g, '').trim().slice(0, n) || d;
const id = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : Math.random().toString(36).slice(2, 10));

export const newId = () => Math.random().toString(36).slice(2, 10);
export const emptyHouse = () => ({ version: 1, floors: [{ id: 'f0', name: 'Ground floor', height: 2.5, rooms: [], openings: [] }], trace: {}, model: null });

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
      id: id(o.id), kind: o.kind === 'window' ? 'window' : 'door', roomId: String(o.roomId), edge: Math.max(0, Math.floor(num(o.edge, 0, 0, MAX.points))),
      t: num(o.t, 0.5, 0, 1), width: num(o.width, o.kind === 'window' ? 1.2 : 0.9, 0.3, 5),
    })).filter((o) => roomIds.has(o.roomId) && o.edge < rooms.find((r) => r.id === o.roomId).points.length);
    return { id: id(f.id || `f${i}`), name: txt(f.name, i ? `Floor ${i}` : 'Ground floor'), height: num(f.height, 2.5, 1.8, 10), rooms, openings };
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
/** Which room is a point in (for placing Agents)? */
export const roomAt = (floor, p) => floor.rooms.find((r) => pointInPolygon(p, r.points)) || null;

// ---------- quick-start templates ----------
const rect = (name, x, y, w, h) => ({ id: newId(), name, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
export const TEMPLATES = {
  flat: { name: '1-bed flat', make: () => {
    const lounge = rect('Living room', 0, 0, 5, 4), kitchen = rect('Kitchen', 5, 0, 3, 4), hall = rect('Hall', 0, 4, 3, 2), bath = rect('Bathroom', 3, 4, 2.5, 2), bed = rect('Bedroom', 5.5, 4, 2.5, 3);
    return { floors: [{ id: 'f0', name: 'Flat', height: 2.5, rooms: [lounge, kitchen, hall, bath, bed], openings: [door(hall, 3, 0.5), door(lounge, 2, 0.4), door(bath, 3, 0.5), door(bed, 3, 0.3), win(lounge, 0, 0.5), win(kitchen, 0, 0.5), win(bed, 1, 0.5)] }] };
  } },
  house: { name: '3-bed house (2 floors)', make: () => {
    const lounge = rect('Living room', 0, 0, 5, 4.5), kitchen = rect('Kitchen', 5, 0, 4, 4.5), hall = rect('Hall', 0, 4.5, 3, 3), dining = rect('Dining room', 3, 4.5, 6, 3);
    const b1 = rect('Main bedroom', 0, 0, 5, 4.5), b2 = rect('Bedroom 2', 5, 0, 4, 4.5), land = rect('Landing', 0, 4.5, 3, 3), b3 = rect('Bedroom 3', 3, 4.5, 3, 3), bath = rect('Bathroom', 6, 4.5, 3, 3);
    return { floors: [
      { id: 'f0', name: 'Ground floor', height: 2.5, rooms: [lounge, kitchen, hall, dining], openings: [door(hall, 2, 0.5), door(lounge, 2, 0.3), door(dining, 3, 0.5), door(kitchen, 3, 0.5), win(lounge, 0, 0.5), win(kitchen, 0, 0.5), win(dining, 2, 0.5)] },
      { id: 'f1', name: 'First floor', height: 2.4, rooms: [b1, b2, land, b3, bath], openings: [door(b1, 2, 0.3), door(land, 1, 0.5), door(b3, 3, 0.5), door(bath, 3, 0.5), door(b2, 3, 0.5), win(b1, 0, 0.5), win(b2, 0, 0.5), win(bath, 2, 0.5)] },
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
