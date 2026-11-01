import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthScore, phaseAt, profileMission, staleAgents, fleetSummary } from '../../shared/fleet.js';
import { cellOf, maskRects, maskFrame, pickDetection, describe, makeSpeedGuard } from '../../agent/lib/perimeter-core.js';
import { armable, cleanSettings, hqEditable, missionById } from '../../shared/missions.js';
import { isArmed } from '../../shared/threat.js';

test('health score: a healthy online Agent scores 100, problems cost points with reasons', () => {
  assert.equal(healthScore({ online: true, battery: 0.9, charging: true, uptime7d: 100, version: '4.0.0' }, '4.0.0').score, 100);
  const h = healthScore({ online: false, battery: 0.15, charging: false, uptime7d: 70, tampers7d: 1, version: '3.8.0', armable: false }, '4.0.0');
  assert.ok(h.score < 30);
  assert.equal(h.grade, 'poor');
  for (const w of ['offline', 'battery low', 'old version 3.8.0', 'privacy masks not confirmed']) assert.ok(h.notes.includes(w), w);
});

test('day/night: sunrise and sunset when the location is known, 07:00–20:00 otherwise', () => {
  const london = { lat: 51.5, lon: -0.12 };
  assert.equal(phaseAt(Date.UTC(2026, 5, 21, 12), london), 'day');
  assert.equal(phaseAt(Date.UTC(2026, 5, 21, 23), london), 'night');
  const noon = new Date(2026, 0, 10, 12).getTime(), late = new Date(2026, 0, 10, 22).getTime();
  assert.equal(phaseAt(noon, null), 'day');
  assert.equal(phaseAt(late, null), 'night');
  const a = { mission: 'motion', profiles: { on: true, day: 'standby', night: 'motion' } };
  assert.equal(profileMission(a, 'day'), 'standby');
  assert.equal(profileMission(a, 'night'), null, 'already on its night mission');
  assert.equal(profileMission({ ...a, profiles: { ...a.profiles, on: false } }, 'day'), null);
});

test('stale Agents and the weekly fleet summary', () => {
  const now = 10_000_000;
  const s = staleAgents([{ id: 'a', online: false, lastSeen: now - 20 * 60000, codename: 'A' }, { id: 'b', online: false, lastSeen: now - 5 * 60000 }, { id: 'c', online: true, lastSeen: now - 60 * 60000 }], now, 15);
  assert.deepEqual(s.map((x) => [x.id, x.mins]), [['a', 20]]);
  const sum = fleetSummary([{ label: 'AGENT-01', codename: 'A', online: true, health: { score: 100, notes: [] } }, { label: 'AGENT-02', codename: 'B', online: false, health: { score: 50, notes: ['offline'] } }]);
  assert.equal(sum.avg, 75);
  assert.match(sum.headline, /1 of 2 Agents online/);
  assert.deepEqual(sum.lines, ['AGENT-02 B: 50/100 — offline']);
});

test('PERIMETER WATCH: privacy masks are blacked out before anything looks at the picture', () => {
  assert.equal(cellOf(0, 0, 320, 240), 0);
  assert.equal(cellOf(319, 239, 320, 240), 47);
  assert.deepEqual(maskRects([0], 320, 240)[0].slice(0, 2), [0, 0]);
  const f = new Uint8ClampedArray(64 * 48).fill(200);
  maskFrame(f, 64, 48, [0, 47]);
  assert.equal(f[0], 0, 'top-left square masked');
  assert.equal(f[64 * 48 - 1], 0, 'bottom-right square masked');
  assert.equal(f[64 * 20 + 30], 200, 'the middle is untouched');
  assert.equal(f.filter((v) => v === 0).length, 2 * 8 * 8);
});

test('PERIMETER WATCH: only people/vehicles/animals, never in masked or ignored squares', () => {
  const person = { class: 'person', score: 0.9, bbox: [140, 100, 40, 80] }; // centre (160,140) → square 28
  const car = { class: 'car', score: 0.8, bbox: [0, 0, 30, 30] }; // square 0
  const cat = { class: 'cat', score: 0.9, bbox: [290, 200, 20, 20] };
  const chair = { class: 'chair', score: 0.99, bbox: [100, 100, 10, 10] };
  const o = { w: 320, h: 240, confidence: 55 };
  assert.equal(pickDetection([car, person], { ...o, classes: 'people_vehicles' }).group, 'person', 'people come first');
  assert.equal(pickDetection([car, person], { ...o, classes: 'people_vehicles', mask: [28] }).group, 'vehicle', 'a person in a masked square is never reported');
  assert.equal(pickDetection([car], { ...o, classes: 'people_vehicles', ignore: [0] }), null);
  assert.equal(pickDetection([cat], { ...o, classes: 'people_vehicles' }), null);
  assert.equal(pickDetection([cat], { ...o, classes: 'all' }).group, 'animal');
  assert.equal(pickDetection([chair], { ...o, classes: 'all' }), null);
  assert.equal(pickDetection([{ ...person, score: 0.4 }], { ...o, classes: 'people' }), null, 'below the certainty threshold');
  assert.equal(describe('person', 'front'), 'Person detected (front / driveway)');
  assert.equal(describe('motion', 'garden'), 'Movement seen (garden) — motion only');
  const g = makeSpeedGuard(2500);
  g.add(3000); g.add(3000); assert.equal(g.slow, false); g.add(3000); assert.equal(g.slow, true);
});

test('outside Agents can’t be armed until their privacy masks are confirmed', () => {
  assert.equal(armable({ mission: 'perimeter', settings: {} }), false);
  assert.equal(armable({ mission: 'perimeter', settings: { masksConfirmed: true } }), true);
  assert.equal(armable({ mission: 'motion', place: { zone: 'front' } }), false, 'a plain camera outside has no masks');
  assert.equal(armable({ mission: 'motion', place: { roomId: 'r1' } }), true);
  assert.equal(armable({ mission: 'door', place: { zone: 'garage' } }), true, 'no camera, nothing to mask');
  const def = missionById('perimeter');
  assert.deepEqual(def.settings.filter(hqEditable).map((s) => s.key), ['watch', 'classes', 'sensitivity', 'confidence', 'cooldown', 'camera']);
  assert.equal(cleanSettings('perimeter', {}).masksConfirmed, false);
  assert.equal(isArmed('away', {}, 'perimeter'), true);
});

test('HQ: a PERIMETER WATCH Agent reports nothing until its masks are confirmed on the Agent; HQ can’t confirm them', async () => {
  const { openStore } = await import('../../hq/brain/store.js');
  const { HQ } = await import('../../hq/brain/hq.js');
  const { makeApi } = await import('../../hq/brain/api.js');
  const { makeAuth } = await import('../../hq/brain/auth.js');
  const clock = { t: Date.UTC(2026, 9, 29, 12) };
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => clock.t });
  hq.localRole = 'DIRECTOR';
  const call = makeApi({ hq, db, auth: makeAuth({ db }) });
  const api = (m, p, b) => call(m, p, b, { remote: false });
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  const sent = [];
  hq.agentOnline(db.agent(agentId), { token, sendRaw: (t) => sent.push(t), close() {} });
  await api('PATCH', `/agents/${agentId}`, { mission: 'perimeter', settings: { masksConfirmed: true, mask: [1, 2], watch: 'garden' } });
  let a = db.agent(agentId);
  assert.equal(a.settings.masksConfirmed, false, 'HQ can’t confirm masks');
  assert.deepEqual(a.settings.mask, [], 'HQ can’t set masks');
  assert.equal(a.settings.watch, 'garden');
  assert.equal(hq.agentEvent(agentId, { kind: 'perimeter', message: 'Person detected (garden)', data: { class: 'person' } }), null, 'not armed: dropped');
  hq.agentSetup(agentId, { mask: [0, 1, 8], ignore: [5], watch: 'front', confirmed: true });
  a = db.agent(agentId);
  assert.equal(a.settings.masksConfirmed, true);
  assert.deepEqual(a.settings.mask, [0, 1, 8]);
  await api('PATCH', '/settings', { mode: 'away' });
  const ev = hq.agentEvent(agentId, { kind: 'perimeter', message: 'Person detected (front / driveway)', data: { class: 'person', zone: 'front', score: 88, picture: 'data:image/jpeg;base64,'.padEnd(500, 'A') } });
  assert.equal(ev.level, 'alert');
  assert.equal(ev.data.class, 'person');
  assert.equal(ev.data.picture, undefined, 'long strings (pictures) are dropped');
  // changing the camera clears the masks again
  await api('PATCH', `/agents/${agentId}`, { settings: { camera: 'user' } });
  assert.equal(db.agent(agentId).settings.masksConfirmed, false);
  // the live view route is gone
  await assert.rejects(api('POST', `/agents/${agentId}/live`, { on: true }), /no live view/);
  // fleet: registry row, bulk identify, profiles
  hq.agentStatus(agentId, { battery: 0.8, charging: false, version: '0.1.0' });
  const reg = await api('GET', '/register');
  assert.equal(reg[0].version, '0.1.0');
  assert.ok(reg[0].health.notes.includes('old version 0.1.0'));
  assert.ok(reg[0].health.notes.includes('privacy masks not confirmed'));
  sent.length = 0;
  const r = await api('POST', '/agents/bulk', { ids: [agentId], action: 'identify' });
  assert.equal(r.done, 1);
  assert.ok(sent.some((t) => t.includes('"action":"find"')));
  await api('POST', '/agents/bulk', { ids: [agentId], action: 'mission', mission: 'standby' });
  assert.equal(db.agent(agentId).mission, 'standby');
  await api('PATCH', `/agents/${agentId}`, { profiles: { on: true, day: 'motion', night: 'standby' } });
  assert.equal(db.agent(agentId).profiles?.day, 'motion', 'profile saved');
  clock.t = new Date(2026, 9, 29, 12).getTime();
  hq.fleet.tick();
  assert.equal(db.agent(agentId).mission, 'motion', 'daytime profile applied');
  hq.fleet.tick();
  assert.equal(db.agent(agentId).missionLog.filter((m) => m.mission === 'motion').length, 1, 'applied once');
  hq.stop(); hq.fleet.stop();
});
