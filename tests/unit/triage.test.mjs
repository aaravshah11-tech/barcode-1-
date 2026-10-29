// Triage queue + incidents: the rules and HQ's handling, tested in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../hq/brain/store.js';
import { HQ } from '../../hq/brain/hq.js';
import { makeApi } from '../../hq/brain/api.js';
import { makeAuth } from '../../hq/brain/auth.js';
import { severityFor, escalated, canMove, incidentRef, ageText, alertTitle } from '../../shared/triage.js';

const MIN = 60000;
async function setup() {
  const now = { t: Date.UTC(2026, 9, 29, 12, 0) };
  const db = await openStore({ memory: true });
  const hq = new HQ({ db, now: () => now.t });
  const { agentId, token } = hq.claimPairCode(hq.newPairCode().code);
  hq.agentOnline(db.agent(agentId), { token, sendRaw() {}, close() {} });
  hq.updateAgent(agentId, { mission: 'motion', codename: 'wolf' });
  const api = makeApi({ hq, db, auth: makeAuth({ db }) });
  const call = (m, p, b) => api(m, p, b, { remote: false });
  return { now, db, hq, agentId, call };
}

test('severity rules: only events that need a decision become alerts', () => {
  assert.equal(severityFor({ kind: 'motion', level: 'info' }), null, 'activity while home is just logged');
  assert.equal(severityFor({ kind: 'motion', level: 'alert', data: { armed: 'away' } }), 'HIGH');
  assert.equal(severityFor({ kind: 'door', level: 'alert', data: { armed: 'lockdown' } }), 'CRITICAL');
  assert.equal(severityFor({ kind: 'system', level: 'alert', message: 'PANIC raised by HQ' }), 'CRITICAL');
  assert.equal(severityFor({ kind: 'system', level: 'warn', message: 'Failed login attempt' }), 'MEDIUM');
  assert.equal(severityFor({ kind: 'system', level: 'warn', message: 'Internet connection lost' }), 'LOW');
  assert.equal(severityFor({ kind: 'system', level: 'alert', message: 'Security mode: LOCKDOWN' }), null, 'a mode change is not an alert');
  assert.equal(severityFor({ kind: 'agent', level: 'warn', message: 'AGENT-01 “WOLF” offline' }), 'LOW');
  assert.equal(severityFor({ kind: 'agent', level: 'warn', message: 'AGENT-01 “WOLF” disconnected by HQ' }), null);
  assert.equal(severityFor({ kind: 'threat', level: 'alert' }), null);
  assert.equal(alertTitle({ kind: 'motion', message: 'x' }, 'Kitchen'), 'Motion detected — Kitchen');
});

test('escalation, incident references, status moves, age text', () => {
  assert.equal(escalated('LOW'), 'MEDIUM');
  assert.equal(escalated('CRITICAL'), 'CRITICAL');
  assert.equal(incidentRef(2026, 42), 'INC-2026-0042');
  assert.ok(canMove('open', 'investigating') && canMove('investigating', 'resolved') && canMove('resolved', 'closed'));
  assert.ok(canMove('open', 'closed'), 'close a false start straight away');
  assert.ok(canMove('resolved', 'investigating'), 'reopen');
  assert.ok(!canMove('closed', 'open') && !canMove('open', 'resolved'), 'no skipping, closed is final');
  assert.equal(ageText(30000), '<1 min');
  assert.equal(ageText(125 * MIN), '2 h 05 min');
});

test('an armed sensor event becomes an alert; repeats within a minute merge', async () => {
  const { hq, agentId, now, call } = await setup();
  await call('PATCH', '/settings', { mode: 'away' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  now.t += 20000;
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  let open = await call('GET', '/alerts?status=open');
  assert.equal(open.length, 1);
  assert.equal(open[0].count, 2, 'merged into one row (×2)');
  assert.equal(open[0].severity, 'HIGH');
  assert.equal(open[0].status, 'new');
  assert.match(open[0].id, /^ALT-\d{6}$/);
  assert.match(open[0].agent, /WOLF/);
  now.t += 2 * MIN;
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  open = await call('GET', '/alerts?status=open');
  assert.equal(open.length, 2, 'after a minute it is a new alert');
  // activity while home: nothing
  await call('PATCH', '/settings', { mode: 'home' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  assert.equal((await call('GET', '/alerts?status=open')).length, 2);
});

test('acknowledge, escalate, dismiss (needs a reason), reopen — all logged with who did it', async () => {
  const { hq, agentId, call, db } = await setup();
  hq.localOperator = 'NIGHTOWL';
  await call('PATCH', '/settings', { mode: 'away' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  const [a] = await call('GET', '/alerts');
  const ack = await call('POST', `/alerts/${a.id}/acknowledge`);
  assert.equal(ack.status, 'acknowledged');
  assert.equal(ack.handledBy, 'NIGHTOWL');
  const esc = await call('POST', `/alerts/${a.id}/escalate`);
  assert.equal(esc.severity, 'CRITICAL');
  await assert.rejects(call('POST', `/alerts/${a.id}/dismiss`, {}), /reason/);
  const dis = await call('POST', `/alerts/${a.id}/dismiss`, { reason: 'False alarm', note: 'the cat' });
  assert.equal(dis.status, 'dismissed');
  assert.equal(dis.dismissReason, 'False alarm');
  await assert.rejects(call('POST', `/alerts/${a.id}/acknowledge`), /already closed/);
  assert.equal((await call('POST', `/alerts/${a.id}/reopen`)).status, 'new');
  assert.deepEqual(dis.history.map((h) => h.action), ['raised', 'acknowledge', 'escalate', 'dismiss']);
  assert.ok(db.events({ kind: 'triage' }).some((e) => /dismissed \(False alarm\) by NIGHTOWL/.test(e.message)));
});

test('incidents: INC-YYYY-NNNN, linked alerts, status flow, notes, timeline, playback window', async () => {
  const { hq, agentId, call, now } = await setup();
  await call('PATCH', '/settings', { mode: 'away' });
  hq.agentEvent(agentId, { kind: 'motion', message: 'Motion detected' });
  const [a] = await call('GET', '/alerts');
  const inc = await call('POST', '/incidents', { alertIds: [a.id], assignee: 'Director' });
  assert.equal(inc.ref, 'INC-2026-0001');
  assert.equal(inc.status, 'open');
  assert.equal(inc.severity, 'HIGH', 'takes the worst alert severity');
  assert.deepEqual(inc.alertIds, [a.id]);
  assert.equal((await call('GET', '/alerts'))[0].status, 'incident');
  assert.equal((await call('POST', '/incidents', { title: 'Second' })).ref, 'INC-2026-0002');
  await assert.rejects(call('PATCH', `/incidents/${inc.id}`, { status: 'resolved' }), /can’t go from Open to Resolved/);
  now.t += MIN;
  await call('PATCH', `/incidents/${inc.id}`, { status: 'investigating', assignee: 'Mum' });
  await call('POST', `/incidents/${inc.id}/notes`, { text: 'Checked the camera position — fine.' });
  const r = await call('PATCH', `/incidents/${inc.ref}`, { status: 'resolved' });
  assert.equal(r.status, 'resolved');
  assert.equal(r.assignee, 'Mum');
  const d = await call('GET', `/incidents/${inc.id}`);
  assert.equal(d.alerts.length, 1);
  assert.ok(d.timeline.some((x) => x.type === 'alert' && /Motion detected/.test(x.text)), 'alert events in the timeline');
  assert.ok(d.timeline.some((x) => /Investigating → Resolved/.test(x.text)));
  assert.ok(d.window.from < a.ts && d.window.to > a.ts, 'playback window covers the alert');
  assert.equal(d.incident.notes[0].text, 'Checked the camera position — fine.');
});

test('PANIC is CRITICAL; a failed sign-in is MEDIUM', async () => {
  const { call, hq } = await setup();
  await call('POST', '/panic');
  hq.logEvent({ kind: 'system', level: 'warn', message: 'Failed login attempt' });
  const list = await call('GET', '/alerts');
  assert.ok(list.some((a) => a.severity === 'CRITICAL' && a.title === 'Panic raised'));
  assert.ok(list.some((a) => a.severity === 'MEDIUM' && a.title === 'Failed sign-in attempt'));
});
