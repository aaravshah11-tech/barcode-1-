// Data + resilience: encryption helpers, encrypted backups with a test restore, retention,
// tamper-evident evidence export, and the record of when HQ wasn't running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDeviceKey, sealJSON, openJSON, sealBackup, openBackup } from '../../shared/vault.js';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';

const DAY = 86400000;

test('vault: sealed data can only be opened with the right key / password', async () => {
  const k1 = await newDeviceKey(), k2 = await newDeviceKey();
  const rec = await sealJSON(k1, { secret: 'motion in kitchen' });
  assert.ok(!JSON.stringify(rec).includes('kitchen'));
  assert.deepEqual(await openJSON(k1, rec), { secret: 'motion in kitchen' });
  await assert.rejects(openJSON(k2, rec));
  const text = await sealBackup({ sentinel: 'hq-backup', at: 1, meta: {}, events: [{ id: 1, message: 'hello' }] }, 'correct horse');
  assert.ok(!text.includes('hello'));
  assert.equal((await openBackup(text, 'correct horse')).events[0].message, 'hello');
  await assert.rejects(openBackup(text, 'wrong password'), /Wrong backup password/);
  await assert.rejects(sealBackup({}, 'short'), /at least 8/);
});

async function setup() {
  const clock = { t: Date.UTC(2026, 9, 31, 12) };
  const db = await openStore({ memory: true });
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const hq = new HQ({ db, now: () => clock.t });
  hq.resilience.storage = storage;
  const api = makeApi({ hq, db, auth: makeAuth({ db, now: () => clock.t }) });
  await api('POST', '/auth/setup', { codename: 'nightowl', pin: '13579' });
  await api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579' });
  return { clock, db, hq, api, storage };
}

test('backups: encrypted, test-restored, restorable; download needs a password', async () => {
  const { api, hq, db } = await setup();
  hq.logEvent({ kind: 'system', message: 'before backup' });
  const b = await api('POST', '/data/backup');
  assert.ok(b.verified.ok, b.verified.detail);
  assert.match(b.verified.detail, /audit chain intact/);
  assert.match(b.sha256, /^[0-9a-f]{64}$/);
  hq.logEvent({ kind: 'system', message: 'after backup' });
  assert.ok((await api('POST', `/data/backups/${b.id}/verify`)).ok);
  await api('POST', `/data/backups/${b.id}/restore`);
  const msgs = db.allEvents().map((e) => e.message);
  assert.ok(msgs.includes('before backup') && !msgs.includes('after backup'), 'back to how it was');
  assert.ok((await api('GET', '/audit')).verify.ok, 'restored chain still verifies, restore recorded');
  assert.ok(db.allAudit().some((a) => a.action === 'Backup restored'));
  await assert.rejects(api('POST', '/data/backup/download', { password: 'x' }), /at least 8/);
  const f = await api('POST', '/data/backup/download', { password: 'long enough pw' });
  assert.match(f.filename, /\.sentinel-backup$/);
  await assert.rejects(api('POST', '/data/restore-file', { text: f.text, password: 'nope nope nope' }), /Wrong backup password/);
  assert.ok((await api('POST', '/data/restore-file', { text: f.text, password: 'long enough pw' })).verified.ok);
  await assert.rejects(api('POST', '/data/backup', {}, { remote: true, session: 'x' }), /Locked|HQ computer/);
});

test('nightly backup after 03:00, once a day', async () => {
  const { hq, clock, db } = await setup();
  clock.t = new Date(2026, 9, 31, 2, 0).getTime();
  assert.equal(await hq.resilience.nightly(), null, 'not before 03:00');
  clock.t = new Date(2026, 9, 31, 3, 20).getTime();
  assert.ok((await hq.resilience.nightly()).verified.ok);
  assert.equal(await hq.resilience.nightly(), null, 'only once');
  assert.equal((await db.localBackups()).length, 1);
});

test('retention: old data goes; open alerts and anything in an active incident stay; audit keeps verifying', async () => {
  const { api, hq, db, clock } = await setup();
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  hq.agentOnline(db.agent(agentId), { token, sendRaw() {}, close() {} });
  hq.updateAgent(agentId, { mission: 'motion' });
  await api('PATCH', '/settings', { mode: 'away' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'm' });
  clock.t += 2 * 60000;
  hq.agentEvent(agentId, { kind: 'motion', message: 'm' });
  const [a2, a1] = await api('GET', '/alerts');
  await api('POST', `/alerts/${a1.id}/dismiss`, { reason: 'Test' });
  await api('POST', '/incidents', { alertIds: [a2.id] });
  clock.t += 200 * DAY;
  await api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579' }); // the old session idled out
  await api('PUT', '/data/retention', { alerts: 30, audit: 10 });
  const r = (await api('GET', '/data/status')).retention;
  assert.equal(r.alerts, 30);
  assert.equal(r.audit, 365, 'the audit log is kept at least a year');
  const out = await api('POST', '/data/prune');
  assert.equal(out.alerts, 1, 'the dismissed alert went');
  assert.ok((await api('GET', '/alerts')).some((a) => a.id === a2.id), 'the alert in an open incident stayed');
  assert.ok(out.events > 0);
  clock.t += 400 * DAY;
  await api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579' });
  await api('POST', '/data/prune');
  const v = (await api('GET', '/audit')).verify;
  assert.ok(v.ok, 'after trimming old audit entries the rest still verifies');
});

test('evidence: package with SHA-256, recorded in the audit log; any change is detected', async () => {
  const { api, hq } = await setup();
  const inc = await api('POST', '/incidents', { title: 'Garden gate found open' });
  await api('POST', `/incidents/${inc.id}/notes`, { text: 'Checked at 21:00.' });
  const ev = await api('GET', `/data/evidence/${inc.id}`);
  assert.equal(ev.filename, `${inc.ref}-evidence.json`);
  const v = await api('POST', '/data/evidence/verify', { text: ev.text });
  assert.ok(v.intact && v.recorded && v.recorded.who === 'NIGHTOWL');
  const f = JSON.parse(ev.text);
  f.content.incident.title = 'Nothing happened';
  const bad = await api('POST', '/data/evidence/verify', { text: JSON.stringify(f) });
  assert.equal(bad.intact, false);
  void hq;
});

test('downtime: HQ notices it wasn’t running, and why', async () => {
  const { hq, storage, clock, db } = await setup();
  hq.resilience.beat();
  clock.t += 2 * 3600000;
  const rec = hq.resilience.checkDowntime();
  assert.equal(rec.why, 'stopped unexpectedly');
  assert.ok(hq.ops.alerts().some((a) => /^HQ was down for 2 h 0 min/.test(a.title)));
  hq.resilience.beat(true); // closed normally
  clock.t += 3600000;
  assert.equal(hq.resilience.checkDowntime().why, 'closed');
  hq.resilience.watchdog({ kind: 'sleep', ms: 30 * 60000 });
  assert.equal(db.docs('downtime').length, 3);
  void storage;
});
