import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../server/db.js';
import { HQ } from '../../server/hq.js';
import { computeThreat } from '../../server/threat.js';
import { hashPassword, checkPassword, signCommand, verifyCommand, pickCodename, CODENAMES } from '../../server/security.js';
import { cleanSettings, MISSIONS } from '../../public/shared/missions.js';
import { toCsv } from '../../server/export.js';

const MIN = 60000;
const mkHQ = (now = { t: Date.now() }) => { const db = openDb(':memory:'); return { db, hq: new HQ({ db, now: () => now.t }), now }; };

test('password hashing', () => {
  const h = hashPassword('hunter22');
  assert.ok(checkPassword('hunter22', h));
  assert.ok(!checkPassword('hunter23', h));
  assert.ok(!checkPassword('x', 'garbage'));
});

test('signed commands: right secret only, no stale replays', () => {
  const cmd = signCommand('agent-secret', { action: 'mission', payload: { mission: 'motion', settings: { b: 1, a: 2 } } });
  assert.ok(verifyCommand('agent-secret', cmd));
  assert.ok(!verifyCommand('other-secret', cmd), 'another HQ / wrong key');
  assert.ok(!verifyCommand('agent-secret', { ...cmd, payload: { mission: 'standby' } }), 'tampered');
  assert.ok(!verifyCommand('agent-secret', cmd, { now: cmd.ts + 5 * MIN }), 'too old');
});

test('codenames are unique until they run out', () => {
  const taken = [];
  for (let i = 0; i < CODENAMES.length; i++) taken.push(pickCodename(taken));
  assert.equal(new Set(taken).size, CODENAMES.length);
  assert.match(pickCodename(taken), /^[A-Z]+-\d+$/);
});

test('mission settings: defaults, limits, junk removed', () => {
  assert.deepEqual(cleanSettings('motion', {}), { sensitivity: 6, cooldown: 30, camera: 'environment', ignore: [] });
  assert.deepEqual(cleanSettings('motion', { sensitivity: 99, cooldown: 'x', camera: 'hack', ignore: [3, 3, 1, 999, 'a'], evil: 1 }), { sensitivity: 10, cooldown: 30, camera: 'environment', ignore: [1, 3] });
  assert.deepEqual(cleanSettings('standby', { x: 1 }), {});
  assert.ok(MISSIONS.every((m) => m.id && m.name && Array.isArray(m.settings)));
});

test('pairing: one-time codes, single use, expiry', () => {
  const { hq, db, now } = mkHQ();
  const { code } = hq.newPairCode();
  const creds = hq.claimPairCode(code.toLowerCase().split('').join(' '), { ua: 'Test phone' });
  assert.ok(creds && creds.token && creds.codename);
  assert.equal(creds.label, 'AGENT-01');
  assert.equal(hq.claimPairCode(code), null, 'second use refused');
  const second = hq.newPairCode();
  now.t += 11 * MIN;
  assert.equal(hq.claimPairCode(second.code), null, 'expired');
  assert.equal(hq.agentByToken(creds.token).id, creds.agentId);
  assert.equal(hq.agentByToken('nope'), null);
  assert.ok(db.events({}).some((e) => /AGENT-01 “.+” recruited/.test(e.message)));
});

test('agents: missions, settings, only expected events, removal', () => {
  const { hq, db } = mkHQ();
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  const sent = [];
  hq.agentOnline(db.agent(agentId), { token, sendRaw: (t) => sent.push(JSON.parse(t)), close() {} });
  const a = hq.updateAgent(agentId, { mission: 'motion', settings: { sensitivity: 9 }, codename: ' hawkeye ' });
  assert.equal(a.codename, 'HAWKEYE');
  assert.equal(a.settings.sensitivity, 9);
  const cmd = sent.find((m) => m.t === 'cmd' && m.cmd.action === 'configure')?.cmd;
  assert.ok(cmd && verifyCommand(token, cmd), 'Agent receives a signed configure order');
  assert.equal(cmd.payload.mission, 'motion');
  assert.ok(hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected', data: { area: 4.2, img: 'x'.repeat(500) } }));
  assert.equal(db.events({ kind: 'motion' })[0].data.img, undefined, 'long strings (e.g. images) are dropped');
  assert.equal(hq.agentEvent(agentId, { kind: 'door', message: 'nope' }), null, 'not this mission’s event');
  hq.agentSetGrid(agentId, 'ignore', [0, 1, 2]);
  assert.deepEqual(db.agent(agentId).settings.ignore, [0, 1, 2]);
  assert.ok(hq.removeAgent(agentId));
  assert.equal(hq.agentByToken(token), null, 'old token no longer works');
});

test('threat level', () => {
  const now = Date.now();
  const ev = (kind, minsAgo) => ({ kind, ts: now - minsAgo * MIN, message: `${kind}!` });
  const home = [{ enabled: true, home: true }], away = [{ enabled: true, home: false }];
  assert.equal(computeThreat({ events: [], people: home, now }).level, 'GREEN');
  assert.equal(computeThreat({ events: [ev('motion', 2)], people: home, now }).level, 'AMBER');
  assert.equal(computeThreat({ events: [ev('motion', 8)], people: home, now }).level, 'GREEN');
  assert.equal(computeThreat({ events: [ev('motion', 8)], people: away, now }).level, 'RED');
  assert.equal(computeThreat({ events: [ev('agent', 1)], people: away, now }).level, 'GREEN', 'Agent coming online is not activity');
  assert.equal(computeThreat({ events: [ev('door', 1)], people: [], now }).level, 'AMBER', 'nobody tracked: unknown, not RED');
  assert.equal(computeThreat({ events: [ev('door', 1)], people: [], mode: 'away', now }).level, 'RED');
  assert.equal(computeThreat({ events: [ev('door', 1)], people: away, mode: 'home', now }).level, 'AMBER');
});

test('Mission Log: auto-delete after N days, CSV export', () => {
  const { hq, db, now } = mkHQ();
  db.addEvent({ ts: now.t - 40 * 86400000, kind: 'motion', message: 'old' });
  db.addEvent({ ts: now.t - 2 * 86400000, kind: 'motion', message: '=HYPERLINK("evil")' });
  assert.equal(hq.prune(), 1);
  hq.updateSettings({ retentionDays: 1 });
  assert.ok(!db.events({}).some((e) => e.message.startsWith('=')), 'retention lowered: deleted');
  db.addEvent({ ts: now.t, kind: 'motion', message: '=SUM(1)', data: { area: 3 } });
  const csv = toCsv(db.events({}));
  assert.ok(csv.includes("'=SUM(1)"), 'formula neutralised');
  assert.ok(csv.startsWith('﻿Time (UTC)'));
});

test('only HQ’s own pages (or HQ behind Tailscale) count as same-origin; proxied requests are not "local"', async () => {
  const { sameOrigin, isLocalRequest } = await import('../../server/security.js');
  const req = (headers, ip = '192.168.1.5') => ({ headers, socket: { remoteAddress: ip } });
  assert.ok(sameOrigin(req({ host: '192.168.1.10:8443' })));
  assert.ok(sameOrigin(req({ host: '192.168.1.10:8443', origin: 'https://192.168.1.10:8443' })));
  assert.ok(!sameOrigin(req({ host: '192.168.1.10:8443', origin: 'https://evil.example' })));
  assert.ok(!sameOrigin(req({ host: '192.168.1.10:8443', origin: 'not a url' })));
  assert.ok(sameOrigin(req({ host: 'localhost:8443', origin: 'https://hq.tail1234.ts.net', 'x-forwarded-host': 'hq.tail1234.ts.net' })));
  assert.ok(isLocalRequest(req({}, '127.0.0.1')));
  assert.ok(!isLocalRequest(req({}, '192.168.1.5')));
  assert.ok(!isLocalRequest(req({ 'x-forwarded-for': '100.64.0.7' }, '127.0.0.1')));
});
