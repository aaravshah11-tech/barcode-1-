import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, sunPosition, isDark } from '../../shared/sun.js';

const near = (ms, iso, min = 3) => assert.ok(Math.abs(ms - Date.parse(iso)) < min * 60000, `${new Date(ms).toISOString()} should be about ${iso}`);

test('London midsummer and midwinter', () => {
  const s = sunTimes(Date.parse('2024-06-21T12:00:00Z'), 51.5074, -0.1278);
  near(s.sunrise, '2024-06-21T03:43:00Z'); near(s.sunset, '2024-06-21T20:21:00Z');
  const w = sunTimes(Date.parse('2024-12-21T12:00:00Z'), 51.5074, -0.1278);
  near(w.sunrise, '2024-12-21T08:04:00Z'); near(w.sunset, '2024-12-21T15:53:00Z');
});

test('Sydney (southern hemisphere, east)', () => {
  const s = sunTimes(Date.parse('2024-06-21T02:00:00Z'), -33.8688, 151.2093);
  near(s.sunrise, '2024-06-20T20:59:00Z', 4); near(s.sunset, '2024-06-21T06:54:00Z', 4);
});

test('polar day and night', () => {
  assert.equal(sunTimes(Date.parse('2024-06-21T12:00:00Z'), 78.2, 15.6).polar, 'day');
  assert.equal(sunTimes(Date.parse('2024-12-21T12:00:00Z'), 78.2, 15.6).polar, 'night');
});

test('sun position', () => {
  const p = sunPosition(Date.parse('2024-06-21T12:02:00Z'), 51.5074, -0.1278);
  assert.ok(p.altitude > 61 && p.altitude < 62.5, `midsummer noon in London ~62°, got ${p.altitude}`);
  assert.ok(Math.abs(p.azimuth - 180) < 3, 'due south at noon');
  assert.ok(isDark(Date.parse('2024-06-21T23:30:00Z'), 51.5, -0.13));
  assert.ok(!isDark(Date.parse('2024-06-21T12:00:00Z'), 51.5, -0.13));
});
