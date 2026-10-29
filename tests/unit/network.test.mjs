// Network security: router-list import, maker lookup, asset register, alerts, health check, history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRouterList, vendorOf, isRandomMac, mergeImport, healthCheck, cleanAsset, guessType } from '../../shared/assets.js';
import { emptyStats, addSample, history } from '../../shared/netstats.js';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';

const ROUTER = `Device Name\tIP Address\tMAC Address\tConnection
Mums-iPhone\t192.168.1.23\t3C:22:FB:12:34:56\tWireless 5GHz
living-room-tv\t192.168.1.40\tA8-23-FE-AA-BB-CC\tWired
ESP_1A2B3C\t192.168.1.77\t24:0a:c4:1a:2b:3c\tWireless 2.4GHz
\t192.168.1.90\tDA:A1:19:00:11:22\tWireless
garbage line without a mac`;

test('router list: names, IPs and MACs are read; makers looked up; private addresses spotted', () => {
  const rows = parseRouterList(ROUTER);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { mac: '3C:22:FB:12:34:56', ip: '192.168.1.23', name: 'Mums-iPhone' });
  assert.equal(rows[1].mac, 'A8:23:FE:AA:BB:CC');
  assert.equal(vendorOf(rows[0].mac), 'Apple');
  assert.equal(vendorOf(rows[1].mac), 'LG');
  assert.match(vendorOf(rows[2].mac), /Espressif/);
  assert.ok(isRandomMac(rows[3].mac), 'DA:… is a private (randomised) address');
  assert.match(vendorOf(rows[3].mac), /Private address/);
  assert.equal(guessType('ESP_1A2B3C', vendorOf(rows[2].mac)), 'iot');
  assert.equal(guessType('living-room-tv'), 'tv');
});

test('import merge: new devices are added untrusted; known ones are refreshed', () => {
  const known = [cleanAsset({ id: 'x', name: 'Mum’s phone', mac: '3C:22:FB:12:34:56', trusted: true, owner: 'Mum', firstSeen: 1, lastSeen: 1 })];
  const r = mergeImport(known, parseRouterList(ROUTER), 1000);
  assert.equal(r.added.length, 3);
  assert.equal(r.seen.length, 1);
  assert.equal(r.seen[0].lastSeen, 1000);
  assert.equal(r.seen[0].name, 'Mum’s phone', 'your own name is kept');
  assert.ok(r.added.every((a) => !a.trusted && a.source === 'import'));
});

test('health check: plain-English findings, worst first, with a score', () => {
  const bad = healthCheck({ now: 0, https: false, pinStrength: 'weak', twoFactor: false, autoLockMin: 0, viewers: [{ label: 'Old phone', lastSeen: -40 * 86400000 }], assets: [{ trusted: false, type: 'iot' }], answers: { wpa: 'no', adminpw: 'yes' } });
  assert.equal(bad.findings[0].level, 'high');
  assert.ok(bad.findings.some((f) => /Old phone/.test(f.advice)));
  assert.ok(bad.findings.some((f) => /WPA3/.test(f.advice) && f.level === 'high'));
  assert.ok(bad.findings.some((f) => f.title === 'Router admin password has been changed' && f.level === 'ok'));
  const good = healthCheck({ now: 0, https: true, pinStrength: 'ok', twoFactor: true, autoLockMin: 15, viewers: [], assets: [], answers: Object.fromEntries(['wpa', 'adminpw', 'firmware', 'wps', 'remote', 'upnp', 'guest'].map((k) => [k, 'yes'])) });
  assert.equal(good.score, 100);
  assert.ok(bad.score < 40);
});

test('internet history: daily uptime and latency kept for 30+ days', () => {
  let s = emptyStats();
  const day0 = new Date(2026, 9, 1, 12).getTime();
  for (let d = 0; d < 3; d++) for (let i = 0; i < 10; i++) s = addSample(s, day0 + d * 86400000 + i * 60000, d === 1 && i < 5 ? null : 20).stats;
  const h = history(s, day0 + 3 * 86400000);
  assert.equal(h.days.length, 3);
  assert.equal(h.days[1].uptime, 50);
  assert.equal(h.days[0].latency, 20);
  assert.equal(h.uptime30d, Math.round((25 / 30) * 1000) / 10);
  assert.equal(h.outages.length, 1);
});

test('HQ: register lists SENTINEL’s own devices; import raises “new device” alerts; Wi-Fi → mobile data is flagged', async () => {
  const clock = { t: Date.UTC(2026, 9, 29, 12) };
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => clock.t });
  const api = makeApi({ hq, db, auth: makeAuth({ db }) });
  const call = (m, p, b) => api(m, p, b, { remote: false });
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  hq.agentOnline(db.agent(agentId), { token, sendRaw() {}, close() {} });
  let assets = await call('GET', '/network/assets');
  assert.ok(assets.some((a) => a.ref === 'hq' && a.trusted), 'HQ computer');
  assert.ok(assets.some((a) => a.ref === `agent:${agentId}` && a.trusted), 'the Agent');
  const r = await call('POST', '/network/import', { text: ROUTER });
  assert.deepEqual(r, { found: 4, added: 4, seen: 0 });
  let alerts = await call('GET', '/alerts');
  assert.equal(alerts.filter((a) => a.source === 'network' && /^New device on your network/.test(a.title)).length, 4);
  assets = await call('GET', '/network/assets');
  const phone = assets.find((a) => a.mac === '3C:22:FB:12:34:56');
  await call('PUT', `/network/assets/${phone.id}`, { ...phone, name: 'Mum’s iPhone', owner: 'Mum', trusted: true });
  await assert.rejects(call('DELETE', `/network/assets/${assets.find((a) => a.ref === 'hq').id}`), /listed automatically/);
  // second import: Mum's trusted phone → a "device appears" signal for the correlation rules; untrusted ones → LOW alerts
  clock.t += 3600000;
  await call('POST', '/network/import', { text: ROUTER });
  assert.ok(db.events({ kind: 'device' }).some((e) => e.data.owner === 'Mum'), 'trusted device seen → device event with owner');
  alerts = await call('GET', '/alerts');
  assert.ok(alerts.some((a) => /^Untrusted device on your network — living-room-tv/.test(a.title)));
  // Agent drops to mobile data
  hq.agentStatus(agentId, { net: 'wifi' });
  hq.agentStatus(agentId, { net: '4g' });
  alerts = await call('GET', '/alerts');
  assert.ok(alerts.some((a) => /^Agent left the Wi-Fi/.test(a.title) && a.severity === 'MEDIUM'));
  // health
  await call('PUT', '/network/checks', { answers: { wpa: 'yes', adminpw: 'no', bogus: 'yes' } });
  const h = await call('GET', '/network/health');
  assert.ok(h.findings.some((f) => /admin password/.test(f.advice) && f.level === 'high'));
  assert.ok(h.findings.some((f) => /not marked as trusted/.test(f.title)));
  assert.equal(typeof h.score, 'number');
});
