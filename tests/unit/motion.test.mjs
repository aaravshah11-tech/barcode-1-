import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDetector } from '../../agent/lib/motion-core.js';

const W = 64, H = 48;
const room = (shade = 90, box = null) => {
  const f = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = shade + ((x * 7 + y * 13) % 11); // a bit of texture
  if (box) for (let y = box.y; y < box.y + box.s; y++) for (let x = box.x; x < box.x + box.s; x++) if (x < W && y < H) f[y * W + x] = 230;
  return f;
};
const run = (frames, opts) => { const d = makeDetector({ W, H }); return frames.map((f) => d.step(f, opts)); };
const warm = Array.from({ length: 8 }, () => room());

test('still room: no motion', () => {
  assert.ok(!run([...warm, ...Array.from({ length: 20 }, () => room())], { sensitivity: 10 }).some((r) => r.motion));
});
test('something moving across the view: motion', () => {
  const moving = Array.from({ length: 12 }, (_, i) => room(90, { x: 4 + i * 4, y: 18, s: 10 }));
  assert.ok(run([...warm, ...moving], { sensitivity: 6 }).some((r) => r.motion));
});
test('a single noisy frame is not motion (needs 2 in a row)', () => {
  const r = run([...warm, room(90, { x: 20, y: 20, s: 12 }), room(), room(), room()], { sensitivity: 6 });
  assert.ok(!r.some((x) => x.motion));
});
test('movement only inside ignored zones: no motion', () => {
  // Box moves within the left two columns, rows 2–3 → cells 16,17,24,25 (8 columns).
  const moving = Array.from({ length: 12 }, (_, i) => room(90, { x: (i % 2) * 6, y: 17, s: 8 }));
  assert.ok(run([...warm, ...moving], { sensitivity: 6 }).some((r) => r.motion), 'seen when watched');
  assert.ok(!run([...warm, ...moving], { sensitivity: 6, ignore: [16, 17, 24, 25] }).some((r) => r.motion), 'ignored');
});
test('lights switched on: treated as a lighting change, not motion', () => {
  const r = run([...warm, room(200), room(200), room(200), room(200)], { sensitivity: 10 });
  assert.ok(!r.some((x) => x.motion));
  assert.ok(r.some((x) => x.lighting));
});
test('lower sensitivity ignores small movements', () => {
  const small = Array.from({ length: 12 }, (_, i) => room(90, { x: 10 + (i % 2) * 5, y: 10, s: 5 }));
  assert.ok(run([...warm, ...small], { sensitivity: 10 }).some((r) => r.motion), 'sensitive: yes');
  assert.ok(!run([...warm, ...small], { sensitivity: 1 }).some((r) => r.motion), 'insensitive: no');
});
