// Correlation rules + pattern-of-life anomalies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Correlator, cleanRule, completes, DEFAULT_RULES, describeMatch } from '../../shared/correlate.js';
import { buildBaseline, unusualTime, unusuallyBusy, missingActivity, profile } from '../../shared/baseline.js';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';

const S = 1000, MIN = 60000, H = 3600000, D = 86400000;
let nid = 1;
const ev = (kind, ts, extra = {}) => ({ id: nid++, kind, ts, message: kind, level: 'info', ...extra });

test('rules: door → motion → phone within 60 s = ARRIVAL (likely: the phone’s owner)', () => {
  const c = new Correlator([DEFAULT_RULES[0]]);
  const ctx = { mode: 'home', roomOf: (a) => (a === 'hall-agent' ? 'hall' : null), ownerOf: (e) => e?.data?.owner || '' };
  const t = Date.UTC(2026, 9, 29, 18);
  assert.deepEqual(c.feed(ev('door', t, { message: 'Front door opened', agentId: 'door-agent' }), ctx), []);
  assert.deepEqual(c.feed(ev('motion', t + 8 * S, { agentId: 'hall-agent' }), ctx), []);
  const out = c.feed(ev('device', t + 40 * S, { message: 'Phone “Mum’s iPhone” connected', data: { owner: 'Mum' } }), ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].likely, 'Mum');
  assert.equal(out[0].seconds, 40);
  assert.match(describeMatch(out[0]), /^ARRIVAL \(likely: Mum\) — Front door opened → motion → Phone “Mum’s iPhone” connected in 40 s$/);
  // it doesn't fire again for the same visit
  assert.deepEqual(c.feed(ev('device', t + 45 * S, { data: { owner: 'Mum' } }), ctx), []);
});

test('rules: too slow, wrong order, wrong room or wrong mode → no match', () => {
  const t = 1e12, ctx = { mode: 'home', roomOf: (a) => a };
  const arrival = DEFAULT_RULES[0];
  const recent = [ev('door', t, { message: 'opened' }), ev('motion', t + 10 * S)];
  assert.equal(completes(arrival, recent, ev('device', t + 70 * S), ctx), null, 'outside 60 s');
  assert.equal(completes(arrival, [ev('motion', t), ev('door', t + 5 * S, { message: 'opened' })], ev('device', t + 9 * S), ctx), null, 'motion before the door');
  const unordered = cleanRule({ ...arrival, ordered: false });
  assert.ok(completes(unordered, [ev('motion', t), ev('door', t + 5 * S, { message: 'opened' })], ev('device', t + 9 * S), ctx), 'unordered rule accepts any order');
  const roomRule = cleanRule({ steps: [{ signal: 'motion', roomId: 'hall' }, { signal: 'motion', roomId: 'kitchen' }], windowSec: 30 });
  assert.ok(completes(roomRule, [ev('motion', t, { agentId: 'hall' })], ev('motion', t + 5 * S, { agentId: 'kitchen' }), ctx));
  assert.equal(completes(roomRule, [ev('motion', t, { agentId: 'study' })], ev('motion', t + 5 * S, { agentId: 'kitchen' }), ctx), null);
  const c = new Correlator([DEFAULT_RULES[1]]); // only in AWAY / LOCKDOWN
  c.feed(ev('door', t, { message: 'opened' }), { mode: 'home' });
  assert.deepEqual(c.feed(ev('motion', t + 5 * S), { mode: 'home' }), []);
});

test('cleanRule clamps whatever the editor sends', () => {
  const r = cleanRule({ name: '<b>x</b>', windowSec: 99999, steps: [{ signal: 'hack' }], level: 'NOPE', modes: ['away', 'moon'] });
  assert.equal(r.name, 'bx/b');
  assert.equal(r.windowSec, 3600);
  assert.equal(r.steps[0].signal, 'motion');
  assert.equal(r.level, 'INFO');
  assert.deepEqual(r.modes, ['away']);
});

// Two weeks where the kitchen is busy 07:00–08:00 and 18:00–19:00 every day and silent at night.
function history(now) {
  const out = [], mid = new Date(now); mid.setHours(0, 0, 0, 0);
  for (let d = 14; d >= 1; d--) {
    const day = mid.getTime() - d * D;
    for (const h of [7, 18]) for (let k = 0; k < 3; k++) out.push(ev('motion', day + h * H + k * 5 * MIN, { agentId: 'k' }));
  }
  return out;
}

test('pattern of life: learns normal hours; flags 03:00 activity with a confidence %', () => {
  const now = new Date(2026, 9, 29, 3, 12).getTime();
  const b = buildBaseline(history(now), { now, keyOf: (e) => (e.agentId === 'k' ? 'kitchen' : null) });
  assert.equal(b.daysObserved, 14);
  assert.equal(b.learning, false);
  const prof = profile(b, 'kitchen', 'wd');
  assert.equal(prof[7], 1, 'every weekday at 07:00');
  assert.equal(prof[3], 0);
  const a = unusualTime(b, 'kitchen', ev('motion', now), 'Kitchen');
  assert.ok(a, 'night-time activity is unusual');
  assert.ok(a.confidence >= 90, `confidence ${a.confidence}%`);
  assert.match(a.reason, /Kitchen is normally quiet between 03:00 and 04:00: activity on 0 of the last \d+ weekdays/);
  assert.equal(unusualTime(b, 'kitchen', ev('motion', new Date(2026, 9, 29, 7, 30).getTime()), 'Kitchen'), null, 'breakfast is normal');
  assert.ok(unusuallyBusy(b, 'kitchen', new Date(2026, 9, 29, 18, 30).getTime(), 30, 'Kitchen'), '30 events in an hour that usually has 3');
  assert.equal(unusuallyBusy(b, 'kitchen', new Date(2026, 9, 29, 18, 30).getTime(), 4, 'Kitchen'), null);
  assert.ok(missingActivity(b, 'kitchen', new Date(2026, 9, 29, 7).getTime(), 0, 'Kitchen'), 'no breakfast activity is noticed');
});

test('pattern of life: nothing is flagged while still learning (under 7 days)', () => {
  const now = new Date(2026, 9, 29, 3, 12).getTime();
  const recent = history(now).filter((e) => e.ts > now - 4 * D);
  const b = buildBaseline(recent, { now, keyOf: () => 'kitchen' });
  assert.ok(b.learning);
  assert.equal(unusualTime(b, 'kitchen', ev('motion', now), 'Kitchen'), null);
});

test('HQ: a correlation rule raises a triage alert; anomalies reach triage with an explanation', async () => {
  const clock = { t: new Date(2026, 9, 29, 3, 0).getTime() };
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => clock.t });
  const api = makeApi({ hq, db, auth: makeAuth({ db }) });
  const call = (m, p, b) => api(m, p, b, { remote: false });
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  hq.agentOnline(db.agent(agentId), { token, sendRaw() {}, close() {} });
  hq.updateAgent(agentId, { mission: 'motion', name: 'Kitchen' });
  // two weeks of normal kitchen life in the log
  for (const e of history(clock.t)) db.addEvent({ ...e, agentId, message: 'AGENT-01: Motion detected' });
  hq.analytics.rebuild();
  // 03:05 movement in the kitchen while HOME → an anomaly in triage
  clock.t += 5 * MIN;
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  const alerts = await call('GET', '/alerts');
  const an = alerts.find((a) => a.source === 'anomaly');
  assert.ok(an, 'anomaly alert');
  assert.match(an.title, /Unusual activity — Kitchen/);
  assert.match(an.explanation, /Confidence \d+%/);
  assert.equal(an.severity, 'MEDIUM');
  const pat = await call('GET', '/patterns');
  assert.equal(pat.daysObserved, 14);
  assert.equal(pat.places[0].name, 'Kitchen');
  assert.equal(pat.anomalies.length, 1);
  // a custom rule: two motions within 10 s → HIGH "RUNNING" alert
  const rules = (await call('GET', '/rules')).rules;
  assert.equal(rules.length, 2, 'starts with the example rules');
  await call('PUT', '/rules/rule-run', { name: 'Fast movement', windowSec: 10, steps: [{ signal: 'motion' }, { signal: 'motion' }], label: 'running', level: 'HIGH' });
  clock.t += MIN;
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  clock.t += 4 * S;
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  const run = (await call('GET', '/alerts')).find((a) => a.source === 'correlation');
  assert.ok(run && run.severity === 'HIGH' && /^RUNNING/.test(run.title), 'rule → HIGH alert');
  assert.ok(db.events({ kind: 'correlation' })[0].message.startsWith('RUNNING'));
  const tested = await call('POST', '/rules/test', { windowSec: 10, steps: [{ signal: 'motion' }, { signal: 'motion' }] });
  assert.ok(tested.count >= 1, 'dry run counts past matches');
  await call('DELETE', '/rules/rule-run');
  assert.equal((await call('GET', '/rules')).rules.length, 2);
});
