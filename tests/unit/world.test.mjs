import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDir, shadowVector, hull, shadowPolygon, skyPhase, nightVision, rainAlert, roundMinutes, particleCount } from '../../shared/world.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('compass → floor-plan directions', () => {
  let [x, y] = planDir(0); near(x, 0); near(y, -1); // north = up
  [x, y] = planDir(90); near(x, 1); near(y, 0); // east = right
  [x, y] = planDir(90, 90); near(x, 0); near(y, -1); // the top of the plan faces east → east is up
});

test('shadows fall away from the sun, longer when it is low', () => {
  const sv = shadowVector({ azimuth: 180, altitude: 45 }); // sun due south, 45° up
  near(sv.dx, 0); near(sv.dy, -1); near(sv.k, 1); // shadow points north (up), as long as the wall is high
  assert.ok(shadowVector({ azimuth: 180, altitude: 10 }).k > 5);
  assert.equal(shadowVector({ azimuth: 180, altitude: -3 }), null, 'no shadow at night');
  const poly = shadowPolygon([[0, 0], [4, 0], [4, 3], [0, 3]], 2.5, sv);
  const ys = poly.map((p) => p[1]);
  near(Math.min(...ys), -2.5); // a 2.5 m room casts a 2.5 m shadow at 45°
  assert.equal(hull([[0, 0], [1, 1], [2, 0], [1, 0.2], [1, -1]]).length, 4);
});

test('day phases and night vision', () => {
  assert.equal(skyPhase(30), 'day'); assert.equal(skyPhase(3), 'golden'); assert.equal(skyPhase(-3), 'twilight'); assert.equal(skyPhase(-20), 'night'); assert.equal(skyPhase(null), null);
  assert.equal(nightVision('auto', { altitude: -5 }), true);
  assert.equal(nightVision('auto', { altitude: 10 }), false);
  assert.equal(nightVision('on', { altitude: 10 }), true);
  assert.equal(nightVision('off', { altitude: -50 }), false);
  assert.equal(nightVision('auto', { now: new Date(2026, 0, 1, 23, 0) }), true, 'no location: the night hours are used');
  assert.equal(nightVision('auto', { now: new Date(2026, 0, 1, 12, 0) }), false);
});

test('rain alert once per wet spell', () => {
  let s = null, r;
  r = rainAlert(s, { rainIn: null }); assert.equal(r.alert, null); s = r.state;
  r = rainAlert(s, { rainIn: 90 }); assert.equal(r.alert, null, 'more than an hour away: not yet'); s = r.state;
  r = rainAlert(s, { rainIn: 22 }); assert.equal(r.alert, 22); s = r.state;
  r = rainAlert(s, { rainIn: 10 }); assert.equal(r.alert, null, 'already warned'); s = r.state;
  r = rainAlert(s, { rainIn: 0 }); assert.equal(r.state, 'wet'); s = r.state;
  r = rainAlert(s, { rainIn: 30 }); assert.equal(r.alert, null, 'still the same wet spell'); s = r.state;
  r = rainAlert(s, { rainIn: null }); s = r.state; assert.equal(s, null, 'dry again');
  assert.equal(rainAlert(s, { rainIn: 40 }).alert, 40, 'next shower: warned again');
  assert.equal(roundMinutes(22), 20); assert.equal(roundMinutes(2), 5);
  assert.equal(particleCount('low', 'clear'), 0);
  assert.ok(particleCount('high', 'rain', 2) > particleCount('low', 'rain', 2));
});
