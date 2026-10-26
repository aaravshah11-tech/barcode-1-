import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSample, addSpeed, emptyStats, uptimePct, median, mbps, summary } from '../../shared/netstats.js';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';

const MIN = 60000;

test('internet monitor: outages, uptime, summaries', () => {
  let s = emptyStats(), t = Date.now() - 100 * MIN;
  const step = (ms) => { const r = addSample(s, t, ms); s = r.stats; t += MIN; return r; };
  for (let i = 0; i < 90; i++) step(20 + (i % 5));
  assert.equal(step(null).change, 'down');
  for (let i = 0; i < 9; i++) assert.equal(step(null).change, null);
  const back = step(25);
  assert.equal(back.change, 'up');
  assert.equal(back.downFor, 10 * MIN);
  assert.equal(s.outages.length, 1);
  assert.equal(uptimePct(s.samples, t, 24), 90.1);
  assert.equal(median([3, 1, 2, null]), 2);
  assert.equal(mbps(1_000_000, 1000), 8);
  s = addSpeed(s, { t, down: 50, up: 10 });
  const sum = summary(s, t);
  assert.equal(sum.online, true); assert.equal(sum.latency, 25); assert.equal(sum.speed.at(-1).down, 50); assert.equal(sum.outages.length, 1);
  assert.ok(sum.recent.length <= 121, 'dashboards only get the last 2 hours');
  for (let i = 0; i < 2000; i++) step(30);
  assert.ok(s.samples.length <= 24 * 60 + 1, 'keeps 24 hours of samples');
});

test('comms: to one Agent, a room, everyone; offline Agents get it later; acknowledgements', async () => {
  const db = await openStore({ memory: true });
  const hq = new HQ({ db });
  hq.saveHouse({ floors: [{ id: 'f0', name: 'Ground', rooms: [{ id: 'k', name: 'Kitchen', points: [[0, 0], [4, 0], [4, 4], [0, 4]] }] }] });
  const a = hq.claimPairCode(hq.newPairCode().code), b = hq.claimPairCode(hq.newPairCode().code);
  hq.placeAgent(a.agentId, { floorId: 'f0', x: 1, y: 1 });
  const sentA = [];
  hq.agentOnline(db.agent(a.agentId), { token: a.token, sendRaw: (x) => sentA.push(JSON.parse(x)), close() {} });
  const r = hq.sendMessage({ target: 'all', text: '  Dinner   is ready ', speak: true });
  assert.deepEqual([r.delivered, r.queued], [1, 1], 'the offline Agent gets it when it reconnects');
  const cmd = sentA.find((m) => m.cmd?.action === 'message').cmd;
  assert.equal(cmd.payload.text, 'Dinner is ready'); assert.equal(cmd.payload.speak, true);
  assert.equal(hq.sendMessage({ target: 'room:k', text: 'Kitchen only' }).delivered, 1);
  assert.equal(hq.sendMessage({ target: 'room:nowhere', text: 'x' }), null);
  assert.equal(hq.sendMessage({ target: 'all', text: '   ' }), null);
  hq.agentAck(a.agentId, cmd.payload.id);
  hq.agentAck(a.agentId, cmd.payload.id);
  assert.equal(hq.messages.find((m) => m.id === cmd.payload.id).acks.length, 1, 'acknowledged once');
  assert.ok(db.events({ kind: 'comms' }).some((e) => /acknowledged: “Dinner is ready”/.test(e.message)));
  const sentB = [];
  hq.agentOnline(db.agent(b.agentId), { token: b.token, sendRaw: (x) => sentB.push(JSON.parse(x)), close() {} });
  await new Promise((res) => setTimeout(res, 700));
  assert.ok(sentB.some((m) => m.cmd?.action === 'message' && m.cmd.payload.text === 'Dinner is ready'), 'delivered on reconnect');
});
