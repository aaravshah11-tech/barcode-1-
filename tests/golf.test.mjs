import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwing, syntheticSwing, isStill, swingFinished, averages, refineImpact, calibrate, radiusFor, settingsFor, groupSessions, currentSession, tempoSpread } from '../js/tools/golf/analysis.js';

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

test('impact refined by the accelerometer jolt near peak rotation', () => {
  const s = syntheticSwing({ backMs: 900, downMs: 300, peak: 1500, spikeMs: 30 });
  const r = analyzeSwing(s);
  const peakT = s[r.peak].t;
  assert.equal(r.impactFrom, 'accel');
  near(r.times.impact - peakT, 30, 10, 'impact 30 ms after peak');
  near(r.downswingMs, 330, 40, 'downswing includes the last 30 ms');
  near(r.peakRotation, 1500, 60, 'peak speed unchanged');
  // No jolt (e.g. practice swing with no ball): fall back to peak rotation.
  const r2 = analyzeSwing(syntheticSwing({ spikeMs: null }));
  assert.equal(r2.impactFrom, 'rotation');
  assert.equal(r2.impact, r2.peak);
  // A jolt far from the peak (phone knocked after the swing) is ignored.
  const r3 = analyzeSwing(syntheticSwing({ spikeMs: 300 }));
  assert.equal(r3.impactFrom, 'rotation');
  // Noisy accelerometer: small wobble isn't mistaken for a strike.
  const noisy = syntheticSwing({ spikeMs: null }).map((x) => ({ ...x, ay: x.ay + (Math.random() - 0.5) * 2 }));
  assert.equal(refineImpact(noisy, analyzeSwing(noisy).peak).source, 'rotation');
});

test('calibration from still + practice swings', () => {
  const still = syntheticSwing({ noise: 12 }).slice(0, 40);
  const swings = [1100, 1250, 1400].map((peak) => syntheticSwing({ peak, noise: 6 }));
  const c = calibrate({ still, swings });
  assert.equal(c.swings, 3);
  assert.ok(c.stillThreshold >= 10 && c.stillThreshold <= 40, 'still threshold ' + c.stillThreshold);
  near(c.minPeak, 550, 40, 'minPeak = half the gentlest swing');
  near(c.avgTempo, 3, 0.4, 'baseline tempo');
  // A gentle swinger's swings are now detected even though the default 350°/s would miss a 300°/s swing.
  const soft = syntheticSwing({ peak: 320, backPeak: 80 });
  assert.equal(analyzeSwing(soft), null);
  const c2 = calibrate({ still, swings: [300, 340, 360].map((peak) => syntheticSwing({ peak, backPeak: 80 })) });
  assert.ok(analyzeSwing(soft, settingsFor({ calibration: c2 })), 'detected with calibrated settings');
  // Height → arm radius
  near(radiusFor(180), 0.7, 0.02, 'glove radius for 180 cm');
  assert.ok(radiusFor(150, 'forearm') < radiusFor(150, 'glove'));
  assert.equal(radiusFor(null, 'forearm'), 0.55);
  assert.deepEqual(settingsFor(null), { radius: 0.7, minPeak: 350, startThreshold: 30, stillThreshold: 15 });
});

test('practice sessions: old swings grouped by 30-minute gaps, new ones by sessionId', () => {
  const M = 60000, T0 = Date.UTC(2026, 9, 24, 10);
  const sw = [
    { id: 'a', t: T0 }, { id: 'b', t: T0 + 10 * M }, { id: 'c', t: T0 + 35 * M },   // one session (gaps ≤ 30 min)
    { id: 'd', t: T0 + 120 * M },                                                     // new session
    { id: 'e', t: T0 + 125 * M, golferId: 'jo' },                                     // different golfer
    { id: 'f', t: T0 + 300 * M, sessionId: 's1' }, { id: 'g', t: T0 + 400 * M, sessionId: 's1' }, // explicit session
    { id: 'h', t: T0 + 130 * M, sessionId: 'auto-d' },                                // a new swing joined an old auto session
  ];
  const g = groupSessions(sw);
  assert.deepEqual(g.map((x) => [x.id, x.swings.map((s) => s.id).join('')]), [['s1', 'fg'], ['auto-d', 'dh'], ['auto-e', 'e'], ['auto-a', 'abc']]);
  const before = sw.filter((s) => !s.sessionId || s.sessionId !== 's1');
  assert.equal(currentSession(before, '', T0 + 140 * M), 'auto-d');
  assert.equal(currentSession(before, '', T0 + 200 * M), null);
  assert.equal(currentSession(sw, '', T0 + 410 * M), 's1');
  assert.equal(currentSession(sw, 'jo', T0 + 150 * M), 'auto-e');
  near(tempoSpread([{ metrics: { tempo: 3 } }, { metrics: { tempo: 2 } }, { metrics: { tempo: 2.5 } }]), 0.5, 0.001, 'spread');
  assert.equal(tempoSpread([{ metrics: { tempo: 3 } }]), null);
});
