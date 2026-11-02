import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneOf, zoneStatus, frontVisits, openDoors } from '../../shared/perimeter.js';
import { compass, tileOf, parseWeather } from '../../shared/weather.js';

const M = 60000, T0 = Date.UTC(2026, 10, 2, 10);
const agents = [
  { id: 'cam', codename: 'OWL', mission: 'perimeter', settings: { watch: 'front', masksConfirmed: true }, online: true },
  { id: 'gar', codename: 'BADGER', mission: 'door', place: { zone: 'garage' }, online: true },
  { id: 'hall', codename: 'WREN', mission: 'door', place: { roomId: 'r1' }, online: true },
  { id: 'shed', codename: 'MOLE', mission: 'motion', place: { roomId: 'r2' }, online: false },
];
const house = { floors: [{ rooms: [{ id: 'r1', name: 'Hall' }, { id: 'r2', name: 'Shed' }] }] };
const person = (t, zone = 'front') => ({ id: t, ts: T0 + t * M, kind: 'perimeter', agentId: 'cam', message: 'Person detected', data: { class: 'person', zone } });

test('zones: PERIMETER WATCH area, outside places and garage/shed rooms', () => {
  assert.deepEqual(agents.map((a) => zoneOf(a, house)), ['front', 'garage', 'inside', 'garage']);
  const s = zoneStatus('front', { events: [person(1), person(2), { ts: T0, kind: 'perimeter', agentId: 'cam', data: { class: 'vehicle', zone: 'front' } }], agents, house, since: T0 - M });
  assert.deepEqual([s.counts.person, s.counts.vehicle, s.online, s.watchers[0].codename], [2, 1, 1, 'OWL']);
  assert.equal(zoneStatus('garden', { events: [], agents, house, since: 0 }).watchers.length, 0);
});

test('front-door visits: visitor, caller, possible delivery, lingering', () => {
  const ev = [
    person(0), person(1), { id: 'd', ts: T0 + 2 * M, kind: 'door', agentId: 'hall', message: 'Door opened' }, // let in
    person(30), // brief, nobody answered
    person(60), { id: 'k', ts: T0 + 61 * M, kind: 'knock', message: 'Door panel pressed' }, person(62), // rang, no answer
    person(90), person(92), person(94), person(96), // 6 minutes, no answer
  ];
  const v = frontVisits(ev, { agents, house, now: T0 + 200 * M });
  assert.deepEqual(v.map((x) => x.label), ['Lingering', 'Caller', 'Possible delivery or passer-by', 'Visitor']);
  assert.equal(v[3].outcome, 'door answered');
  assert.equal(v[1].outcome, 'rang the door panel, nobody answered');
  assert.equal(v[0].mins, 6);
  assert.equal(frontVisits([person(0, 'garden')], { agents, house }).length, 0, 'garden is not the front door');
});

test('garage door left open, closed again', () => {
  const ev = [{ ts: T0, kind: 'door', agentId: 'gar', message: 'Door opened' }];
  assert.deepEqual(openDoors(ev, { agents, house, now: T0 + 20 * M }).map((d) => [d.codename, d.mins]), [['BADGER', 20]]);
  ev.push({ ts: T0 + 21 * M, kind: 'door', agentId: 'gar', message: 'Door closed' });
  assert.equal(openDoors(ev, { agents, house, now: T0 + 30 * M }).length, 0);
  assert.equal(openDoors([{ ts: T0, kind: 'door', agentId: 'hall', message: 'Door opened' }], { agents, house, now: T0 + 60 * M }).length, 0, 'indoor doors are not timed');
});

test('weather station helpers', () => {
  assert.equal(compass(225), 'SW'); assert.equal(compass(359), 'N'); assert.equal(compass(null), '');
  assert.deepEqual(tileOf(51.5, -0.12, 7), { x: 63, y: 42, z: 7 });
  const w = parseWeather({ utc_offset_seconds: 0, current: { temperature_2m: 10, wind_speed_10m: 20, wind_gusts_10m: 41.4, wind_direction_10m: 250, relative_humidity_2m: 80, weather_code: 3 },
    hourly: { time: ['2026-11-02T10:00', '2026-11-02T11:00'], temperature_2m: [10, 11], precipitation_probability: [10, 20], precipitation: [0, 0], weather_code: [3, 3] }, daily: { precipitation_sum: [1.2] } }, T0);
  assert.deepEqual([w.gust, w.windDir, w.humidity, w.rainToday, w.hours.length, w.hours[1].temp], [41, 250, 80, 1.2, 2, 11]);
});

test('HQ: garage left open → one alert; someone lingering → one advisory', async () => {
  const { openStore } = await import('../../hq/brain/store.js');
  const { HQ } = await import('../../hq/brain/hq.js');
  const clock = { t: new Date(2026, 10, 2, 14).getTime() };
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => clock.t });
  const { agentId } = hq.claimPairCode(hq.newPairCode().code);
  hq.updateAgent(agentId, { mission: 'door' });
  db.updateAgent(agentId, { place: { floorId: 'f', x: 1, y: 1, zone: 'garage' } });
  hq.logEvent({ kind: 'door', agentId, message: 'AGENT-01 X: Door opened' });
  clock.t += 10 * M; hq.perimeter.tick();
  assert.equal(hq.ops.alerts().filter((a) => /left open/.test(a.title)).length, 0, 'not yet');
  clock.t += 6 * M; hq.perimeter.tick(); hq.perimeter.tick();
  const al = hq.ops.alerts().filter((a) => /left open/.test(a.title));
  assert.equal(al.length, 1);
  assert.equal(al[0].severity, 'ADVISORY', 'daytime while HOME');
  assert.match(al[0].explanation, /Open for 16 minutes/);
  const v = hq.perimeter.view();
  assert.equal(v.open[0].mins, 16);
  assert.equal(v.zones.find((z) => z.zone === 'garage').counts.door, 1);
});

test('link: big messages go in pieces and are joined again', async () => {
  globalThis.location ||= { search: '', hash: '' };
  const { sendText, makeJoiner, parse } = await import('../../shared/link.js');
  const sent = [], conn = { send: (t) => sent.push(t) };
  const big = JSON.stringify({ t: 'state', events: Array.from({ length: 900 }, (_, i) => ({ id: i, message: `event number ${i} with some text` })) });
  sendText(conn, big);
  assert.ok(sent.length > 1 && sent.every((t) => JSON.stringify(t).length <= 15000), `split into ${sent.length} pieces under 16 KB`);
  const join = makeJoiner();
  const out = sent.map((t) => join(parse(t)));
  assert.deepEqual(out.slice(0, -1), new Array(sent.length - 1).fill(null));
  assert.equal(out.at(-1).events.length, 900);
  sendText(conn, '{"t":"ping"}');
  assert.deepEqual(join(parse(sent.at(-1))), { t: 'ping' }, 'small messages unchanged');
  assert.equal(join({ t: '_part', id: 'x', i: 5, n: 2, d: 'a' }), null, 'nonsense pieces ignored');
});
