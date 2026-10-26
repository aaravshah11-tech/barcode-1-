import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHouse, emptyHouse, area, bbox, centroid, pointInPolygon, nearestWall, openingEnds, roomAt, snap, TEMPLATES } from '../../shared/house.js';

const square = { id: 'r1', name: 'Kitchen', points: [[0, 0], [4, 0], [4, 3], [0, 3]] };

test('room maths: area, size, centre, inside', () => {
  assert.equal(area(square.points), 12);
  assert.deepEqual(bbox(square.points), { minX: 0, minY: 0, maxX: 4, maxY: 3, w: 4, h: 3 });
  assert.deepEqual(centroid(square.points), [2, 1.5]);
  const L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  assert.equal(area(L), 12);
  assert.ok(pointInPolygon([1, 3], L));
  assert.ok(!pointInPolygon([3, 3], L), 'the cut-out corner of an L-shaped room is outside');
  assert.equal(snap(1.23, 0.1), 1.2);
  assert.equal(snap(1.23, 0), 1.23);
});

test('doors and windows sit on walls', () => {
  const floor = { rooms: [square], openings: [] };
  const w = nearestWall(floor, [2, -0.2]);
  assert.equal(w.roomId, 'r1'); assert.equal(w.edge, 0); assert.ok(Math.abs(w.t - 0.5) < 1e-9); assert.ok(Math.abs(w.dist - 0.2) < 1e-9);
  const e = openingEnds(floor, { roomId: 'r1', edge: 0, t: 0.5, width: 1 });
  assert.deepEqual(e.a, [1.5, 0]); assert.deepEqual(e.b, [2.5, 0]);
  const atEnd = openingEnds(floor, { roomId: 'r1', edge: 0, t: 1, width: 1 });
  assert.deepEqual(atEnd.b, [4, 0], 'a door at the very end of a wall stays on the wall');
  assert.equal(roomAt(floor, [1, 1]).name, 'Kitchen');
  assert.equal(roomAt(floor, [9, 9]), null);
});

test('house data is always cleaned up', () => {
  const dirty = {
    floors: [{ id: 'f0', name: '<b>Ground</b>', height: 99, rooms: [square, { id: 'bad', points: [[0, 0], [1, 1]] }, { name: 'x'.repeat(100), points: [[0, 0], [1e9, 0], [0, 'NaN']] }],
      openings: [{ kind: 'door', roomId: 'r1', edge: 1, t: 3, width: 0.1 }, { kind: 'door', roomId: 'ghost', edge: 0 }, { kind: 'hack', roomId: 'r1', edge: 99 }] }],
    trace: { f0: { scale: -1, opacity: 9 }, nope: { scale: 1 } },
    model: { name: 'scan.glb', kind: 'exe', size: 5 },
  };
  const h = sanitizeHouse(dirty);
  assert.equal(h.floors[0].name, 'bGround/b');
  assert.equal(h.floors[0].height, 10);
  assert.equal(h.floors[0].rooms.length, 2, 'rooms with fewer than 3 corners are dropped');
  assert.equal(h.floors[0].rooms[1].name.length, 30);
  assert.equal(h.floors[0].rooms[1].points[1][0], 500, 'coordinates are limited to sensible sizes');
  assert.equal(h.floors[0].openings.length, 1, 'openings on missing rooms/walls are dropped');
  assert.deepEqual([h.floors[0].openings[0].t, h.floors[0].openings[0].width], [1, 0.3]);
  assert.deepEqual(Object.keys(h.trace), ['f0']);
  assert.equal(h.trace.f0.scale, 0.0001);
  assert.equal(h.model.kind, 'glb');
  assert.deepEqual(sanitizeHouse(null), emptyHouse());
});

test('templates make valid houses', () => {
  for (const t of Object.values(TEMPLATES)) {
    const h = sanitizeHouse(t.make());
    assert.ok(h.floors.length >= 1);
    for (const f of h.floors) { assert.ok(f.rooms.length >= 4); assert.ok(f.openings.length >= 4); assert.ok(f.openings.every((o) => openingEnds(f, o))); }
  }
});
