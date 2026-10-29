// Access control: roles enforced by HQ, two-step sign-in codes, sessions, the tamper-evident audit
// trail, the shift log and formal alert-state changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { denied } from '../../shared/roles.js';
import { base32Encode, base32Decode, hotp, verifyTotp } from '../../shared/totp.js';
import { verifyChain, nextEntry } from '../../shared/audit.js';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';

test('roles: Director everything; Operator runs the house; Observer only looks', () => {
  assert.equal(denied('DIRECTOR', 'DELETE', '/users/X'), null);
  assert.equal(denied('OPERATOR', 'POST', '/alerts/ALT-000001/acknowledge'), null);
  assert.equal(denied('OPERATOR', 'PATCH', '/settings', { mode: 'away', by: 'x' }), null);
  assert.match(denied('OPERATOR', 'PATCH', '/settings', { retentionDays: 1 }), /Director/);
  assert.match(denied('OPERATOR', 'GET', '/audit'), /Only the Director/);
  assert.match(denied('OPERATOR', 'GET', '/backup'), /Only the Director/);
  assert.match(denied('OPERATOR', 'DELETE', '/agents/abc'), /Director/);
  assert.match(denied('OPERATOR', 'POST', '/pair'), /Director/);
  assert.equal(denied('OBSERVER', 'GET', '/alerts'), null);
  assert.match(denied('OBSERVER', 'POST', '/alerts/ALT-000001/acknowledge'), /Observers can look/);
  assert.equal(denied('OBSERVER', 'POST', '/auth/lock'), null);
  assert.equal(denied('OBSERVER', 'POST', '/auth/totp/begin'), null, 'anyone can protect their own account');
  assert.match(denied(undefined, 'GET', '/state'), /Sign in/);
});

test('two-step codes match the RFC 6238 test values', async () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual([...base32Decode(secret)], [...new TextEncoder().encode('12345678901234567890')]);
  assert.equal(await hotp(secret, Math.floor(59 / 30)), '287082');
  assert.equal(await hotp(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(await verifyTotp(secret, '081804', 1111111109 * 1000 + 25000), Math.floor(1111111109 / 30), 'previous step still accepted');
  assert.equal(await verifyTotp(secret, '081804', 1111111109 * 1000, Math.floor(1111111109 / 30)), null, 'a code works only once');
  assert.equal(await verifyTotp(secret, '000000', 1111111109 * 1000), null);
});

test('audit chain: any edit, deletion or reordering is detected and pinpointed', () => {
  const list = [];
  for (let i = 0; i < 5; i++) list.push(nextEntry(list.at(-1), null, { ts: i, who: 'A', role: 'DIRECTOR', via: 'HQ', action: `act ${i}` }));
  assert.deepEqual(verifyChain(list), { ok: true, count: 5, last: 5 });
  const edited = list.map((e) => ({ ...e }));
  edited[2].who = 'MALLORY';
  assert.deepEqual(verifyChain(edited), { ok: false, at: 3, why: 'Entry 3 has been changed since it was written.' });
  assert.equal(verifyChain([list[0], list[1], list[3], list[4]]).at, 4, 'deleted entry spotted');
  // trimming old entries keeps an anchor so the rest still verifies
  assert.ok(verifyChain(list.slice(2), { seq: 2, hash: list[1].hash }).ok);
});

async function setup() {
  const clock = { t: Date.UTC(2026, 9, 29, 20) };
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => clock.t });
  const auth = makeAuth({ db, now: () => clock.t });
  const api = makeApi({ hq, db, auth });
  await api('POST', '/auth/setup', { codename: 'nightowl', pin: '13579' });
  await api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579' });
  return { clock, db, hq, auth, api };
}

test('users and roles are enforced by HQ for linked phones', async () => {
  const { api, hq } = await setup();
  assert.equal(hq.localRole, 'DIRECTOR');
  await api('POST', '/users', { username: 'mum', pin: '2468', role: 'OPERATOR' });
  await api('POST', '/users', { username: 'gran', pin: '1357', role: 'OBSERVER' });
  await assert.rejects(api('POST', '/users', { username: 'kid', pin: '1111', role: 'DIRECTOR' }), /one Director/);
  const phone = async (u, pin) => { const r = await api('POST', '/auth/unlock', { codename: u, pin }, { remote: true, label: `${u} phone` }); return (m, p, b) => api(m, p, b, { remote: true, session: r.session, label: `${u} phone` }); };
  const mum = await phone('mum', '2468'), gran = await phone('gran', '1357');
  assert.equal((await mum('PATCH', '/settings', { mode: 'away' })).mode, 'away', 'Operator changes the alert state');
  await assert.rejects(mum('PATCH', '/settings', { retentionDays: 1 }), /Director/);
  await assert.rejects(mum('GET', '/audit'), /Only the Director/);
  await assert.rejects(gran('PATCH', '/settings', { mode: 'home' }), /Observers can look/);
  assert.ok((await gran('GET', '/state')).agents, 'Observer can read');
  assert.equal((await mum('GET', '/me')).role, 'OPERATOR');
  // the change is logged with who did it
  assert.ok(hq.db.events({ kind: 'system' }).some((e) => /^Alert state: AWAY \(by MUM\)/.test(e.message)));
  // demote Mum → applies at once; disable Gran → her session ends
  await api('PATCH', '/users/MUM', { role: 'OBSERVER' });
  await assert.rejects(mum('PATCH', '/settings', { mode: 'home' }), /Observers/);
  await api('PATCH', '/users/GRAN', { disabled: true });
  await assert.rejects(gran('GET', '/state'), /Locked/);
  await assert.rejects(api('PATCH', '/users/NIGHTOWL', { role: 'OBSERVER' }), /can’t be demoted/);
});

test('sessions: listed, ended one at a time or all at once; idle sessions expire', async () => {
  const { api, clock } = await setup();
  await api('POST', '/users', { username: 'mum', pin: '2468', role: 'OPERATOR' });
  const r = await api('POST', '/auth/unlock', { codename: 'mum', pin: '2468' }, { remote: true, label: 'Mum’s iPhone' });
  let list = await api('GET', '/auth/sessions');
  assert.equal(list.length, 2);
  const m = list.find((s) => s.username === 'MUM');
  assert.equal(m.via, 'Phone “Mum’s iPhone”');
  await api('DELETE', `/auth/sessions/${m.id}`);
  await assert.rejects(api('GET', '/state', {}, { remote: true, session: r.session }), /Locked/);
  await api('POST', '/auth/unlock', { codename: 'mum', pin: '2468' }, { remote: true, label: 'x' });
  clock.t += 16 * 60000; // idle past the 15-minute auto-lock: every session ends, the Director's too
  await assert.rejects(api('GET', '/auth/sessions'), /Locked/);
  await api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579' });
  list = await api('GET', '/auth/sessions');
  assert.ok(!list.some((s) => s.username === 'MUM'), 'idle session gone');
});

test('two-step sign-in: set up with a code, then required to sign in', async () => {
  const { api, auth, clock } = await setup();
  const { secret, uri } = await api('POST', '/auth/totp/begin', { pin: '13579' });
  assert.match(uri, /^otpauth:\/\/totp\/SENTINEL%3ANIGHTOWL\?secret=/);
  await assert.rejects(api('POST', '/auth/totp/enable', { code: '000000' }), /doesn’t match/);
  await api('POST', '/auth/totp/enable', { code: await hotp(secret, Math.floor(clock.t / 30000)) });
  assert.equal((await api('GET', '/users'))[0].twoFactor, true);
  await assert.rejects(api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579' }), (e) => e.needOtp && /6-digit code/.test(e.message));
  clock.t += 30000;
  const r = await api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579', otp: await hotp(secret, Math.floor(clock.t / 30000)) });
  assert.ok(r.session);
  await assert.rejects(api('POST', '/auth/unlock', { codename: 'nightowl', pin: '13579', otp: await hotp(secret, Math.floor(clock.t / 30000)) }), /wrong or has expired/, 'same code can’t be used twice');
  assert.ok(auth.director().totp.enabled);
});

test('audit trail: sign-ins, changes and refusals are recorded and verify; viewing is Director-only', async () => {
  const { api, hq, db } = await setup();
  await api('PATCH', '/settings', { mode: 'night', reason: 'Bedtime' });
  await api('POST', '/users', { username: 'mum', pin: '2468', role: 'OBSERVER' });
  const r = await api('POST', '/auth/unlock', { codename: 'mum', pin: '2468' }, { remote: true, label: 'Mum’s iPhone' });
  await assert.rejects(api('PATCH', '/settings', { mode: 'home' }, { remote: true, session: r.session, label: 'Mum’s iPhone' }), /Observers/);
  await assert.rejects(api('POST', '/auth/unlock', { codename: 'mum', pin: '0000' }, { remote: true, label: 'x' }), /Incorrect/);
  const a = await api('GET', '/audit');
  assert.ok(a.verify.ok, 'chain intact');
  const acts = a.entries.map((e) => `${e.who}:${e.action}:${e.ok}`);
  assert.ok(acts.includes('NIGHTOWL:Sign in:true'));
  assert.ok(acts.includes('NIGHTOWL:Alert state changed:true'));
  assert.ok(acts.includes('MUM:Alert state changed:false'), 'refused attempt recorded');
  assert.ok(acts.includes('MUM:Sign in:false'), 'failed sign-in recorded');
  assert.ok(a.entries.find((e) => e.action === 'Alert state changed' && e.ok).detail === 'Bedtime');
  assert.ok(!JSON.stringify(a.entries).includes('2468'), 'PINs are never written to the audit trail');
  assert.ok(db.events({ kind: 'system' }).some((e) => /^Alert state: NIGHT \(by NIGHTOWL\) — Bedtime\./.test(e.message)));
  // someone edits the stored trail → the Audit screen says where
  db._auditRaw()[1].who = 'SOMEONE ELSE';
  const v = (await api('GET', '/audit')).verify;
  assert.equal(v.ok, false);
  assert.equal(v.at, 2);
  const ex = await api('GET', '/audit/export');
  assert.match(ex.sha256, /^[0-9a-f]{64}$/);
  assert.ok(ex.text.startsWith('seq,time,user'));
  void hq;
});

test('shift log: notes, handover with an automatic summary, acknowledgements', async () => {
  const { api, clock } = await setup();
  await api('POST', '/shift', { text: 'Checked the garage door — locked.' });
  clock.t += 60000;
  const h = await api('POST', '/shift', { text: 'Quiet evening. Kitchen camera needs re-aiming.', handover: true });
  assert.equal(h.summary.state, 'HOME');
  assert.equal(h.summary.unhandled, 0);
  const acked = await api('POST', `/shift/${h.id}/ack`);
  assert.equal(acked.acks[0].by, 'NIGHTOWL');
  const list = await api('GET', '/shift');
  assert.equal(list.length, 2);
  assert.equal(list[0].handover, true);
});
