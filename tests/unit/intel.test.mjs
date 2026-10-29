import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWeather, describe, weatherKind, forecastUrl, roughly } from '../../shared/weather.js';
import { addDiagSample, batteryAlert, hoursLeft, fmtDuration, DIAG_EVERY } from '../../shared/diag.js';
import { buildBriefing, dayStart } from '../../shared/briefing.js';

test('weather: Open-Meteo reply → plain words, rain warning', () => {
  const now = Date.parse('2026-10-26T10:10:00Z');
  const j = {
    utc_offset_seconds: 0,
    current: { temperature_2m: 11.6, apparent_temperature: 9.2, weather_code: 3, wind_speed_10m: 12.4, precipitation: 0, cloud_cover: 96, is_day: 1 },
    hourly: { time: ['2026-10-26T10:00', '2026-10-26T11:00', '2026-10-26T12:00'], precipitation_probability: [10, 30, 80], precipitation: [0, 0, 1.2], weather_code: [3, 3, 63] },
    daily: { temperature_2m_max: [13.2], temperature_2m_min: [6.8] },
  };
  const w = parseWeather(j, now);
  assert.equal(w.temp, 12); assert.equal(w.feels, 9); assert.equal(w.text, 'Overcast'); assert.equal(w.kind, 'cloud');
  assert.equal(w.high, 13); assert.equal(w.low, 7); assert.equal(w.wind, 12);
  assert.equal(w.rainIn, 110, 'rain expected at 12:00, 110 minutes away');
  assert.equal(w.next.length, 3);
  assert.equal(parseWeather({ ...j, current: { ...j.current, weather_code: 61 } }, now).rainIn, 0, 'raining now');
  assert.throws(() => parseWeather({}), /unexpected/);
  assert.equal(describe(95), 'Thunderstorm'); assert.equal(weatherKind(73), 'snow'); assert.equal(describe(1234), 'Unknown');
  assert.equal(roughly(51.507351), 51.51);
  assert.ok(forecastUrl(51.507351, -0.127758).includes('latitude=51.51&longitude=-0.13'), 'only a rough position leaves the device');
});

test('diagnostics: one reading per 5 minutes, battery alerts once', () => {
  let s = addDiagSample([], { battery: 0.8, charging: false, rtt: 40 }, 0);
  s = addDiagSample(s, { battery: 0.79 }, 60000);
  assert.equal(s.length, 1, 'too soon, nothing new');
  s = addDiagSample(s, { battery: 0.74 }, 120000);
  assert.equal(s.length, 2, 'a 5-point drop is kept straight away');
  s = addDiagSample(s, { charging: true }, 180000);
  assert.equal(s.length, 3, 'plugging in is kept straight away');
  s = addDiagSample(s, { rtt: 55 }, 180000 + DIAG_EVERY);
  assert.equal(s.at(-1).b, 74, 'battery carried forward');
  assert.equal(addDiagSample([{ t: 0, b: 50, c: false, r: 1 }], { battery: 0.5 }, 49 * 3600000).length, 1, 'older than 48 h dropped');

  let st = null, r;
  r = batteryAlert(st, 0.5, false); assert.equal(r.alert, null); st = r.state;
  r = batteryAlert(st, 0.18, false); assert.equal(r.alert, 'low'); st = r.state;
  r = batteryAlert(st, 0.17, false); assert.equal(r.alert, null, 'only once'); st = r.state;
  r = batteryAlert(st, 0.09, false); assert.equal(r.alert, 'critical'); st = r.state;
  r = batteryAlert(st, 0.09, true); assert.equal(r.state, null, 'charging resets');
  r = batteryAlert(null, 0.05, false); assert.equal(r.alert, 'critical');

  const drain = [{ t: 0, b: 80, c: false }, { t: 3600000, b: 70, c: false }];
  assert.equal(hoursLeft(drain), 7);
  assert.equal(hoursLeft([{ t: 0, b: 80, c: true }]), null);
  assert.equal(fmtDuration(3 * 3600000 + 5 * 60000), '3 h 5 min');
  assert.equal(fmtDuration(26 * 3600000), '1 d 2 h');
});

test('briefing: yesterday summed up', () => {
  const now = new Date(2026, 9, 26, 7, 0).getTime();
  const from = dayStart(now, 1), to = dayStart(now, 0);
  const at = (h, m = 0) => new Date(2026, 9, 25, h, m).getTime();
  const house = { floors: [{ rooms: [{ id: 'k', name: 'Kitchen' }, { id: 'h', name: 'Hall' }] }] };
  const agents = [{ id: 'a', label: 'AGENT-01', codename: 'PUMA', place: { roomId: 'k' }, online: true }, { id: 'b', label: 'AGENT-02', codename: 'RAVEN', place: { roomId: 'h' }, online: false }];
  const events = [
    { ts: at(8), kind: 'system', message: 'Security mode: AWAY — x', data: { mode: 'away', from: 'home' } },
    { ts: at(9), kind: 'motion', agentId: 'a', level: 'alert', message: 'AGENT-01 PUMA: motion' },
    { ts: at(17, 30), kind: 'system', message: 'Security mode: HOME — x' },
    { ts: at(18), kind: 'motion', agentId: 'a', level: 'info', message: 'm' },
    { ts: at(18, 5), kind: 'motion', agentId: 'a', level: 'info', message: 'm' },
    { ts: at(19), kind: 'door', agentId: 'b', level: 'info', message: 'd' },
    { ts: at(21), kind: 'agent', agentId: 'b', level: 'warn', message: 'AGENT-02 “RAVEN” offline' },
    { ts: at(22), kind: 'system', message: 'Internet connection lost' },
    { ts: now - 1000, kind: 'motion', agentId: 'a', message: 'today — not in yesterday’s briefing' },
  ];
  const b = buildBriefing({ events, agents, house, from, to, diag: { a: [{ t: at(12), b: 35 }, { t: at(20), b: 22 }] }, now });
  assert.equal(b.counts.events, 8);
  assert.equal(b.counts.activity, 4);
  assert.equal(b.counts.alerts, 1);
  assert.equal(b.counts.outages, 1);
  assert.equal(b.headline, '1 alert raised');
  assert.deepEqual(b.busiest[0], { name: 'Kitchen', count: 3 });
  assert.equal(b.busiestHour, 18);
  assert.deepEqual(b.departures, [at(8)]);
  assert.deepEqual(b.arrivals, [at(17, 30)], 'AWAY → HOME (from an old log line without data) counts as an arrival');
  const raven = b.health.find((h) => h.id === 'b');
  assert.equal(raven.offline, 1); assert.equal(raven.ok, false);
  assert.equal(b.health.find((h) => h.id === 'a').minBattery, 22);
  assert.match(b.summary, /busiest in the Kitchen/);
  assert.match(b.summary, /1 Agent needs attention/);
  assert.ok(buildBriefing({ events: [], agents: [], from, to }).empty);
});

test('weather: 15-minute steps give a precise rain time', () => {
  const now = Date.parse('2026-10-26T10:02:00Z');
  const j = {
    utc_offset_seconds: 0,
    current: { temperature_2m: 10, weather_code: 3, precipitation: 0 },
    hourly: { time: ['2026-10-26T10:00', '2026-10-26T11:00'], precipitation_probability: [20, 90], precipitation: [0, 2], weather_code: [3, 63] },
    minutely_15: { time: ['2026-10-26T10:00', '2026-10-26T10:15', '2026-10-26T10:30'], precipitation: [0, 0, 0.4] },
  };
  assert.equal(parseWeather(j, now).rainIn, 28, 'rain from 10:30 → 28 minutes away (not 58 from the hourly forecast)');
  assert.ok(forecastUrl(51.5, -0.1).includes('minutely_15=precipitation'));
});
