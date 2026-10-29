// HQ's brain, tested directly in Node (it's the same code the HQ page runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';
import { computeThreat, isArmed, suggestMode } from '../../shared/threat.js';
import { sha256, hmac, signCommand, pickCodename, CODENAMES } from '../../shared/crypto.js';
import { canonical } from '../../shared/canonical.js';
import { cleanSettings, MISSIONS } from '../../shared/missions.js';
import { toCsv } from '../../shared/export.js';
import { inQuietHours, ruleFor } from '../../shared/alert-rules.js';

const MIN = 60000;
const mkHQ = async (now = { t: Date.now() }) => { const db = await openStore({ memory: true }); return { db, hq: new HQ({ db, now: () => now.t }), now }; };

/** Checks a signed order exactly the way an Agent's browser does (WebCrypto). */
async function agentVerifies(secret, cmd, now = Date.now()) {
  const { sig, ...body } = cmd;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(canonical(body)));
  return ok && Math.abs(now - body.ts) <= 120000;
}

test('SHA-256 and HMAC match the standard ones', () => {
  for (const s of ['', 'abc', 'x'.repeat(1000), 'héllo 🛰', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64)]) {
    assert.equal(sha256(s), nodeCrypto.createHash('sha256').update(s).digest('hex'), `sha256 ${s.length}`);
    for (const key of ['k', 'agent-secret-token', 'z'.repeat(100)]) assert.equal(hmac(key, s), nodeCrypto.createHmac('sha256', key).update(s).digest('base64url'));
  }
});

test('signed orders: an Agent accepts its own HQ only, untampered and recent', async () => {
  const cmd = signCommand('agent-secret', { action: 'configure', payload: { mission: 'motion', settings: { b: 1, a: 2 } } });
  assert.ok(await agentVerifies('agent-secret', cmd));
  assert.ok(!(await agentVerifies('other-secret', cmd)), 'another HQ / wrong key');
  assert.ok(!(await agentVerifies('agent-secret', { ...cmd, payload: { mission: 'standby' } })), 'tampered');
  assert.ok(!(await agentVerifies('agent-secret', cmd, cmd.ts + 5 * MIN)), 'too old');
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

test('recruiting: one-time codes, single use, expiry', async () => {
  const { hq, db, now } = await mkHQ();
  const { code } = hq.newPairCode();
  const creds = hq.claimPairCode(code.toLowerCase().split('').join(' '), { ua: 'Test phone' });
  assert.ok(creds && creds.token && creds.codename);
  assert.equal(creds.role, 'agent');
  assert.equal(creds.label, 'AGENT-01');
  assert.equal(hq.claimPairCode(code), null, 'second use refused');
  const second = hq.newPairCode();
  now.t += 11 * MIN;
  assert.equal(hq.claimPairCode(second.code), null, 'expired');
  assert.equal(hq.agentByToken(creds.token).id, creds.agentId);
  assert.equal(hq.agentByToken('nope'), null);
  assert.ok(db.events({}).some((e) => /AGENT-01 “.+” recruited/.test(e.message)));
  assert.ok(!JSON.stringify(hq.snapshot()).includes(sha256(creds.token)), 'secret keys never sent to dashboards');
});

test('linked phones: own codes, can be unlinked', async () => {
  const { hq } = await mkHQ();
  const v = hq.claimPairCode(hq.newPairCode('viewer').code, { label: 'Aarav’s iPhone' });
  assert.equal(v.role, 'viewer');
  assert.equal(hq.viewerByToken(v.token).label, 'Aarav’s iPhone');
  assert.equal(hq.agentByToken(v.token), null, 'a phone key is not an Agent key');
  let cut = null;
  hq.on('viewerRemoved', (id) => { cut = id; });
  assert.ok(hq.removeViewer(v.viewerId));
  assert.equal(cut, v.viewerId);
  assert.equal(hq.viewerByToken(v.token), null);
});

test('Agents: missions, settings, only expected events, removal', async () => {
  const { hq, db } = await mkHQ();
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  const sent = [];
  hq.agentOnline(db.agent(agentId), { token, sendRaw: (t) => sent.push(JSON.parse(t)), close() {} });
  const a = hq.updateAgent(agentId, { mission: 'motion', settings: { sensitivity: 9 }, codename: ' hawkeye ' });
  assert.equal(a.codename, 'HAWKEYE');
  assert.equal(a.settings.sensitivity, 9);
  assert.equal(a.tokenHash, undefined);
  const cmd = sent.find((m) => m.t === 'cmd' && m.cmd.action === 'configure')?.cmd;
  assert.ok(cmd && (await agentVerifies(token, cmd)), 'Agent receives a signed configure order');
  assert.equal(cmd.payload.mission, 'motion');
  assert.ok(hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected', data: { area: 4.2, img: 'x'.repeat(500) } }));
  assert.equal(db.events({ kind: 'motion' })[0].data.img, undefined, 'long strings (e.g. images) are dropped');
  assert.equal(hq.agentEvent(agentId, { kind: 'door', message: 'nope' }), null, 'not this mission’s event');
  hq.agentSetGrid(agentId, 'ignore', [0, 1, 2]);
  assert.deepEqual(db.agent(agentId).settings.ignore, [0, 1, 2]);
  assert.ok(hq.removeAgent(agentId));
  assert.equal(hq.agentByToken(token), null, 'old key no longer works');
});

test('security modes: who is armed, and the threat level', () => {
  const now = Date.now();
  const ev = (kind, minsAgo, level = 'info') => ({ kind, ts: now - minsAgo * MIN, message: `${kind}!`, level });
  assert.equal(isArmed('home', {}, 'motion'), false);
  assert.equal(isArmed('away', {}, 'door'), true);
  assert.equal(isArmed('lockdown', { nightArmed: false }, 'sound'), true);
  assert.equal(isArmed('night', {}, 'motion'), true, 'Agents are armed at night unless untticked');
  assert.equal(isArmed('night', { nightArmed: false }, 'motion'), false, 'bedroom Agent not armed at night');
  assert.equal(isArmed('away', {}, 'agent'), false, 'an Agent coming online is not an intrusion');
  assert.equal(computeThreat({ events: [], mode: 'home', now }).level, 'GREEN');
  assert.equal(computeThreat({ events: [ev('motion', 2)], mode: 'home', now }).level, 'AMBER');
  assert.equal(computeThreat({ events: [ev('motion', 8)], mode: 'home', now }).level, 'GREEN');
  assert.equal(computeThreat({ events: [ev('motion', 8, 'alert')], mode: 'away', now }).level, 'RED');
  assert.match(computeThreat({ events: [ev('door', 1, 'alert')], mode: 'night', now }).reason, /NIGHT mode/);
  assert.equal(computeThreat({ events: [ev('motion', 20, 'alert')], mode: 'away', now }).level, 'GREEN', 'RED fades after 15 minutes');
  assert.equal(computeThreat({ events: [], mode: 'lockdown', now }).away, true);
});

test('mode suggestions: NIGHT late, HOME in the morning, AWAY after a quiet spell', () => {
  const at = (h, m = 0) => new Date(2026, 0, 1, h, m);
  assert.equal(suggestMode({ mode: 'home', now: at(23, 15) }).mode, 'night');
  assert.equal(suggestMode({ mode: 'home', now: at(2) }).mode, 'night');
  assert.equal(suggestMode({ mode: 'night', now: at(8) }).mode, 'home');
  assert.equal(suggestMode({ mode: 'night', now: at(3) }), null);
  assert.equal(suggestMode({ mode: 'home', now: at(14), lastActivity: at(10).getTime() }).mode, 'away');
  assert.equal(suggestMode({ mode: 'home', now: at(14), lastActivity: at(13).getTime() }), null);
  assert.equal(suggestMode({ mode: 'away', now: at(23, 30) }), null, 'AWAY is never nagged');
});

test('HQ: armed sensors raise alerts per mode; LOCKDOWN and PANIC trigger the alarm on Agents', async () => {
  const { hq, db } = await mkHQ();
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  const sent = [];
  hq.agentOnline(db.agent(agentId), { token, sendRaw: (t) => sent.push(JSON.parse(t)), close() {} });
  hq.updateAgent(agentId, { mission: 'motion' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  assert.equal(db.events({ kind: 'motion' })[0].level, 'info', 'HOME: logged, not an alarm');
  hq.updateSettings({ mode: 'night' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  assert.equal(db.events({ kind: 'motion' })[0].level, 'alert', 'NIGHT: armed Agent → alert');
  assert.equal(hq.threat.level, 'RED');
  hq.updateAgent(agentId, { nightArmed: false });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  assert.equal(db.events({ kind: 'motion' })[0].level, 'info', 'NIGHT: unarmed (bedroom) Agent → just logged');
  sent.length = 0;
  hq.updateSettings({ mode: 'lockdown' });
  assert.ok(sent.some((m) => m.cmd?.action === 'alarm' && m.cmd.payload.on), 'entering LOCKDOWN flashes the Agents');
  sent.length = 0;
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  const alarm = sent.find((m) => m.cmd?.action === 'alarm');
  assert.ok(alarm && alarm.cmd.payload.reason.startsWith('INTRUSION'), 'activity in LOCKDOWN sounds the alarm');
  hq.updateSettings({ alarm: { volume: 250, seconds: 1 } });
  assert.equal(hq.settings().alarm.volume, 100); assert.equal(hq.settings().alarm.seconds, 5);
  hq.updateSettings({ mode: 'home' });
  assert.ok(sent.some((m) => m.cmd?.action === 'alarm' && !m.cmd.payload.on), 'leaving LOCKDOWN stands the alarm down');
  hq.panic('Director phone');
  assert.equal(hq.settings().mode, 'lockdown');
  assert.ok(db.events({}).some((e) => e.message === 'PANIC raised by Director phone'));
  hq.updateSettings({ mode: 'hack' });
  assert.equal(hq.settings().mode, 'lockdown', 'unknown modes are ignored');
});

test('Mission Log: auto-delete after N days, CSV export, backup and restore', async () => {
  const { hq, db, now } = await mkHQ();
  db.addEvent({ ts: now.t - 40 * 86400000, kind: 'motion', message: 'old' });
  db.addEvent({ ts: now.t - 2 * 86400000, kind: 'motion', message: '=HYPERLINK("evil")' });
  assert.equal(hq.prune(), 1);
  hq.updateSettings({ retentionDays: 1 });
  assert.ok(!db.events({}).some((e) => e.message.startsWith('=')), 'retention lowered: deleted');
  db.addEvent({ ts: now.t, kind: 'motion', message: '=SUM(1)', data: { area: 3 } });
  const csv = toCsv(db.events({}));
  assert.ok(csv.includes("'=SUM(1)"), 'formula neutralised');
  assert.ok(csv.startsWith('﻿Time (UTC)'));

  const { token } = hq.claimPairCode(hq.newPairCode().code);
  const backup = JSON.parse(JSON.stringify(db.backup()));
  const other = await openStore({ memory: true });
  other.restore(backup);
  const hq2 = new HQ({ db: other });
  assert.ok(hq2.agentByToken(token), 'Agents keep working after moving HQ');
  assert.equal(other.allEvents().length, db.allEvents().length);
  assert.throws(() => other.restore({ hello: 1 }), /isn’t a SENTINEL HQ backup/);
});

test('API: what the Command Centre can do (and what linked phones can’t)', async () => {
  const { hq, db } = await mkHQ();
  const api = makeApi({ hq, db, auth: makeAuth({ db }) });
  assert.equal((await api('PATCH', '/settings', { mode: 'away' })).mode, 'away');
  assert.equal((await api('PATCH', '/settings', { mode: 'hack' })).mode, 'away');
  assert.equal((await api('PATCH', '/settings', { mode: 'night' })).mode, 'night');
  const p = await api('POST', '/pair', { role: 'agent' });
  const { agentId } = hq.claimPairCode(p.code);
  assert.equal((await api('PATCH', `/agents/${agentId}`, { mission: 'door' })).mission, 'door');
  await assert.rejects(api('PATCH', `/agents/${agentId}`, { mission: 'laser' }), /Unknown mission/);
  await assert.rejects(api('POST', `/agents/${agentId}/command`, { action: 'find' }), /offline/);
  await assert.rejects(api('POST', `/agents/${agentId}/command`, { action: 'selfdestruct' }), /Unknown command/);
  assert.match((await api('GET', '/export?format=csv')).text, /recruited/);
  assert.ok(!(await api('GET', '/export?format=json')).text.includes('tokenHash'), 'export never includes keys');
  await assert.rejects(api('GET', '/backup', {}, { remote: true }), /Locked/, 'linked phones must log in first');
  assert.ok((await api('GET', '/backup')).text.includes('hq-backup'));
  await assert.rejects(api('GET', '/nope'), /Not found/);
});

test('alerts: which events alert, quiet hours', () => {
  const at = (h, m = 0) => new Date(2026, 0, 1, h, m);
  assert.equal(inQuietHours('', '', at(3)), false);
  assert.equal(inQuietHours('22:00', '07:00', at(23)), true);
  assert.equal(inQuietHours('22:00', '07:00', at(3)), true);
  assert.equal(inQuietHours('22:00', '07:00', at(7)), false);
  assert.equal(inQuietHours('13:00', '14:30', at(14, 15)), true);
  assert.equal(ruleFor({ kind: 'motion', message: 'Motion', level: 'alert' }).rule, 'awayMotion');
  assert.equal(ruleFor({ kind: 'motion', message: 'Motion', level: 'info' }), null);
  assert.equal(ruleFor({ kind: 'system', message: 'PANIC raised by HQ', level: 'alert' }).red, true);
  assert.equal(ruleFor({ kind: 'door', message: 'X: Door opened' }).rule, 'door');
  assert.equal(ruleFor({ kind: 'door', message: 'X: Door closed' }), null);
  assert.equal(ruleFor({ kind: 'knock', message: 'Knock' }).rule, 'knock');
  assert.equal(ruleFor({ kind: 'agent', level: 'warn', message: 'AGENT-01 “HAWK” offline' }).rule, 'offline');
});

test('Director login: hashed PIN, lockout, linked phones need a session', async () => {
  const now = { t: Date.now() };
  const { hq, db } = await mkHQ(now);
  const auth = makeAuth({ db, now: () => now.t, idleMin: () => 15 });
  const api = makeApi({ hq, db, auth });
  assert.equal((await api('GET', '/auth/status')).setup, false);
  await assert.rejects(api('POST', '/auth/setup', { codename: 'falcon', pin: '12' }), /4–8 digits/);
  await assert.rejects(api('POST', '/auth/setup', { codename: 'falcon', pin: '1234' }, { remote: true }), /HQ computer/);
  assert.equal((await api('POST', '/auth/setup', { codename: 'falcon', pin: '4321' })).codename, 'FALCON');
  await assert.rejects(api('POST', '/auth/setup', { codename: 'x', pin: '9999' }), /already/);
  assert.ok(!JSON.stringify(db.getSetting('director')).includes('4321'), 'the PIN itself is never stored');

  // a linked phone sees nothing until it logs in
  await assert.rejects(api('GET', '/state', {}, { remote: true }), /Locked/);
  const ok = await api('POST', '/auth/unlock', { codename: 'Falcon', pin: '4321' }, { remote: true });
  assert.ok(ok.session);
  assert.equal((await api('GET', '/state', {}, { remote: true, session: ok.session })).t, 'state');
  now.t += 16 * 60000;
  await assert.rejects(api('GET', '/state', {}, { remote: true, session: ok.session }), /Locked/, 'session ends after 15 min idle');

  // wrong PINs: 5 tries then locked, even with the right PIN
  for (let i = 0; i < 4; i++) await assert.rejects(api('POST', '/auth/unlock', { codename: 'FALCON', pin: '0000' }), /tries left/);
  await assert.rejects(api('POST', '/auth/unlock', { codename: 'FALCON', pin: '0000' }), /Locked for 1 min/);
  await assert.rejects(api('POST', '/auth/unlock', { codename: 'FALCON', pin: '4321' }), /Too many wrong tries/);
  now.t += 61000;
  assert.ok((await api('POST', '/auth/unlock', { codename: 'FALCON', pin: '4321' })).session, 'works again after the lockout');
  await assert.rejects(api('POST', '/auth/unlock', { codename: 'RAVEN', pin: '4321' }), /DENIED/, 'wrong codename');
  assert.ok(db.events({}).some((e) => /Failed login attempt/.test(e.message)), 'failed logins are logged');

  // change PIN
  await api('POST', '/auth/change', { codename: 'falcon', pin: '4321', newPin: '777777' });
  await assert.rejects(api('POST', '/auth/unlock', { codename: 'FALCON', pin: '4321' }));
  assert.ok((await api('POST', '/auth/unlock', { codename: 'FALCON', pin: '777777' })).session);
});

test('the store keeps the low-battery “already warned” flag (so the warning is given once)', async () => {
  const { openStore } = await import('../../hq/brain/store.js');
  const db = await openStore({ memory: true });
  db.addAgent({ id: 'x', number: 1, codename: 'TEST', tokenHash: 'h' });
  db.updateAgent('x', { battAlert: 'low' });
  assert.equal(db.agent('x').battAlert, 'low');
  db.updateAgent('x', { battAlert: null });
  assert.equal(db.agent('x').battAlert, null);
});
