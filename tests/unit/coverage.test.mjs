// Coverage map, Agent register and tamper detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, isExterior, angleTo } from '../../shared/coverage.js';
import { TEMPLATES } from '../../shared/house.js';
import { hardwareFromUA, uptimePct } from '../../shared/register.js';
import { makeMoveWatch, makeCoverWatch, frameStats } from '../../agent/lib/tamper-core.js';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';

const house = TEMPLATES.house.make();
const f0 = house.floors[0];
const room = (n) => f0.rooms.find((r) => r.name === n);

test('coverage: outside doors/windows are found; inner doors are not', () => {
  const ext = f0.openings.filter((o) => isExterior(f0, o)).map((o) => `${room2(o.roomId)} ${o.kind}`);
  function room2(id) { return f0.rooms.find((r) => r.id === id).name; }
  assert.ok(ext.includes('Hall door'), 'front door');
  assert.ok(ext.includes('Living room window') && ext.includes('Kitchen window'));
  assert.ok(!ext.includes('Living room door'), 'living room → hall is an inside door');
});

test('coverage: no Agents → every room is a blind spot and every entry is unmonitored', () => {
  const c = coverage(house, []);
  assert.equal(c.pct, 0);
  assert.equal(c.blind.length, house.floors.reduce((n, f) => n + f.rooms.length, 0));
  assert.ok(c.unmonitored.length >= 4);
});

test('coverage: a camera covers a wedge of its own room and watches the entry it faces', () => {
  const hall = room('Hall'); // 0..3 × 4.5..7.5, front door on the bottom wall
  const agents = [{ id: 'a1', codename: 'WOLF', mission: 'motion', online: true, place: { floorId: 'f0', x: 1.5, y: 4.8, dir: 180 } }]; // top of the hall, facing down to the door
  const c = coverage(house, agents);
  const h = c.rooms.find((r) => r.id === hall.id);
  assert.ok(h.pct > 30, `hall covered ${h.pct}%`);
  assert.ok(!h.blind);
  assert.equal(c.rooms.find((r) => r.name === 'Kitchen').pct, 0, 'walls block the camera');
  const front = c.entries.find((e) => e.roomId === hall.id && e.kind === 'door');
  assert.deepEqual(front.monitoredBy, ['a1'], 'front door watched');
  // facing the other way: the door is no longer watched
  const c2 = coverage(house, [{ ...agents[0], place: { ...agents[0].place, dir: 0 } }]);
  assert.ok(c2.entries.find((e) => e.id === front.id).unmonitored);
  // a door tripwire Agent next to the door watches it whatever it faces
  const c3 = coverage(house, [{ id: 'd1', mission: 'door', place: { floorId: 'f0', x: 1.5, y: 7.2 } }]);
  assert.deepEqual(c3.entries.find((e) => e.id === front.id).monitoredBy, ['d1']);
  assert.equal(Math.round(angleTo([0, 0], [1, 0])), 90, '90° = right on the plan');
});

test('register: hardware from the browser, uptime from the log', () => {
  assert.equal(hardwareFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1').text, 'iPhone · iOS 17.5 · Safari');
  assert.equal(hardwareFromUA('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36').text, 'Pixel 7 · Android 14 · Chrome');
  const H = 3600000, t0 = 1e12;
  const ev = (h, m) => ({ ts: t0 + h * H, kind: 'agent', agentId: 'a', message: `AGENT-01 “WOLF” ${m}` });
  const events = [ev(0, 'recruited'), ev(0, 'online'), ev(6, 'offline'), ev(8, 'online')];
  assert.equal(uptimePct(events, 'a', t0, t0 + 10 * H, true), 80, 'down 2 h of 10');
  assert.equal(uptimePct(events, 'a', t0 + 6 * H, t0 + 8 * H, false), 0);
  assert.equal(uptimePct([], 'a', t0, t0 + H, true), 100);
});

test('tamper (on the Agent): picked up → moved; lens covered → covered, then uncovered', () => {
  const w = makeMoveWatch();
  let out = [];
  for (let t = 0; t <= 6000; t += 100) out.push(w([0, 9.8, 0], t)); // upright, still
  for (let t = 6100; t <= 9000; t += 100) out.push(w([0, 0, 9.8], t)); // laid flat
  assert.equal(out.filter(Boolean).join(), 'moved');
  const w2 = makeMoveWatch();
  out = [];
  for (let t = 0; t <= 9000; t += 100) out.push(w2([0.3 * Math.sin(t), 9.8, 0.2], t)); // small shakes
  assert.equal(out.filter(Boolean).length, 0, 'small shakes are ignored');
  const c = makeCoverWatch();
  const flat = frameStats(new Uint8Array(100).fill(3)), room = frameStats(Uint8Array.from({ length: 100 }, (_, i) => 60 + (i % 40)));
  const res = [];
  for (let t = 0; t < 4000; t += 200) res.push(c(room, t));
  for (let t = 4000; t < 8000; t += 200) res.push(c(flat, t));
  for (let t = 8000; t < 9000; t += 200) res.push(c(room, t));
  assert.equal(res.filter(Boolean).join(), 'covered,uncovered');
});

test('tamper (at HQ): unplugged, fast drain and unexpected offline → explained Triage alerts', async () => {
  const clock = { t: Date.UTC(2026, 9, 29, 12) };
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => clock.t });
  const api = makeApi({ hq, db, auth: makeAuth({ db }) });
  const call = (m, p, b) => api(m, p, b, { remote: false });
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  const conn = { token, sendRaw() {}, close() {} };
  hq.agentOnline(db.agent(agentId), conn);
  hq.agentStatus(agentId, { battery: 0.9, charging: true });
  hq.agentStatus(agentId, { battery: 0.9, charging: false });
  let al = await call('GET', '/alerts');
  assert.ok(al.some((a) => a.source === 'tamper' && /^Agent unplugged/.test(a.title)), 'unplugged');
  for (let i = 1; i <= 4; i++) { clock.t += 10 * 60000; hq.agentStatus(agentId, { battery: 0.9 - i * 0.05 }); }
  al = await call('GET', '/alerts');
  assert.ok(al.some((a) => /^Battery draining fast/.test(a.title) && /% per hour/.test(a.explanation)), 'drain');
  await call('PATCH', '/settings', { mode: 'away' });
  hq.agentOffline(agentId, undefined);
  al = await call('GET', '/alerts');
  const off = al.find((a) => /^Agent offline unexpectedly/.test(a.title));
  assert.ok(off && off.severity === 'HIGH' && /didn’t run flat/.test(off.explanation) && /AWAY/.test(off.explanation), 'offline while AWAY → HIGH, explained');
  // the Agent's own report
  hq.agentOnline(db.agent(agentId), conn);
  hq.agentEvent(agentId, { kind: 'tamper', message: 'Agent moved (picked up or turned)', data: { type: 'moved' } });
  al = await call('GET', '/alerts');
  assert.ok(al.some((a) => /^Agent moved/.test(a.title)));
  const reg = await call('GET', '/register');
  assert.equal(reg[0].lastTamper.type, 'moved');
  assert.ok(reg[0].tampers.length >= 4);
  // register: mission history + calibration + notes
  await call('PATCH', `/agents/${agentId}`, { mission: 'motion' });
  await call('PATCH', `/agents/${agentId}`, { notes: 'Charger in the hall socket', calibrated: true });
  const r = (await call('GET', '/register'))[0];
  assert.deepEqual(r.missionLog.map((x) => x.mission), ['standby', 'motion']);
  assert.equal(r.notes, 'Charger in the hall socket');
  assert.ok(r.calibratedAt);
  assert.ok(typeof r.uptime7d === 'number');
});
