import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing, syntheticSwing, isStill, swingFinished, averages } from '../js/tools/golf/analysis.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('3:1 swing: phases, tempo, speed', () => {
  const s = syntheticSwing({ backMs: 900, downMs: 300, peak: 1500 });
  const r = analyzeSwing(s, { radius: 0.7 });
  assert.ok(r);
  near(r.tempo, 3, 0.35, 'tempo');
  near(r.backswingMs, 900, 80, 'backswing');
  near(r.downswingMs, 300, 40, 'downswing');
  near(r.peakRotation, 1500, 60, 'peak');
  near(r.handSpeed, (1500 * Math.PI / 180) * 0.7, 1, 'hand speed m/s');
  near(r.handSpeedMph, 41, 2, 'mph');
  assert.equal(r.axis, 'gz');
  assert.equal(r.quality, 'good');
  assert.ok(r.times.start < r.times.top && r.times.top < r.times.impact && r.times.impact < r.times.finish);
});

test('quick 2:1 swing on another axis with noise, phone flipped', () => {
  const s = syntheticSwing({ backMs: 600, downMs: 300, peak: -1200, backPeak: -200, axis: 'gx', noise: 8 });
  const r = analyzeSwing(s);
  near(r.tempo, 2, 0.35, 'tempo');
  assert.equal(r.axis, 'gx');
});

test('no swing in gentle movement', () => {
  const s = syntheticSwing({ peak: 200, backPeak: 50 });
  assert.equal(analyzeSwing(s), null);
});

test('recorder helpers', () => {
  const s = syntheticSwing();
  assert.ok(isStill(s.slice(0, 40), 300));
  assert.ok(!isStill(s.slice(0, 120), 300));
  assert.ok(swingFinished(s));
  assert.ok(!swingFinished(s.slice(0, Math.floor(s.length * 0.7))));
  const a = averages([{ metrics: { tempo: 3, backswingMs: 900, downswingMs: 300, peakRotation: 1500, handSpeedMph: 40 } }, { metrics: { tempo: 2, backswingMs: 600, downswingMs: 300, peakRotation: 1300, handSpeedMph: 36 } }, { metrics: null }]);
  assert.equal(a.count, 2);
  assert.equal(a.tempo, 2.5);
});
