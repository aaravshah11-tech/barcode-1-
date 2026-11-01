import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, cleanGradeRule, describeRule, inWindow, shouldNotify } from '../../shared/grading.js';
import { fatigueStats, digest } from '../../shared/fatigue.js';
import { validSeverity } from '../../shared/triage.js';

const at = (h, m = 0) => new Date(2026, 10, 2, h, m).getTime();
const base = { mode: 'home', now: at(14), windMph: 5, expected: false, rules: [], snoozes: [] };

test('old severities are read on the new scale', () => {
  assert.equal(validSeverity('LOW'), 'INFO');
  assert.equal(validSeverity('MEDIUM'), 'ADVISORY');
  assert.equal(validSeverity('HIGH'), 'ALERT');
  assert.equal(validSeverity('CRITICAL'), 'CRITICAL');
});

test('context: what was seen, where, when, the weather and the pattern of life', () => {
  assert.equal(grade({ severity: 'ALERT', kind: 'perimeter', cls: 'animal', zone: 'garden' }, base).severity, 'INFO');
  const visitor = grade({ severity: 'INFO', kind: 'perimeter', cls: 'person', zone: 'front' }, base);
  assert.equal(visitor.severity, 'ADVISORY');
  assert.match(visitor.reasons[0], /visitor/);
  assert.equal(grade({ severity: 'INFO', kind: 'perimeter', cls: 'person', zone: 'garden' }, { ...base, now: at(2) }).severity, 'ALERT', 'a person in the garden at 2 am');
  const windy = grade({ severity: 'ALERT', kind: 'perimeter', cls: 'motion', zone: 'garden' }, { ...base, mode: 'away', windMph: 32 });
  assert.equal(windy.severity, 'ADVISORY');
  assert.match(windy.reasons[0], /Windy \(32 mph\)/);
  assert.equal(grade({ severity: 'ADVISORY', kind: 'motion', zone: 'inside' }, { ...base, expected: true }).severity, 'INFO', 'normal for this hour');
  assert.equal(grade({ severity: 'ALERT', kind: 'motion', zone: 'inside' }, { ...base, mode: 'away', expected: true }).severity, 'ALERT', 'pattern of life never lowers while AWAY');
  assert.equal(grade({ severity: 'INFO', kind: 'agent', title: 'Agent battery low' }, base).severity, 'ADVISORY');
  assert.equal(grade({ severity: 'ADVISORY', kind: 'system', title: 'Failed sign-in attempt' }, { ...base, recentFailedLogins: 4 }).severity, 'ALERT');
});

test('your grading rules, then snoozes; CRITICAL is never lowered or held back', () => {
  const r = cleanGradeRule({ name: 'Foxes', when: { kind: 'perimeter', cls: 'animal', zone: 'garden', modes: ['night'], from: '22:00', to: '06:00' }, then: { action: 'suppress' } });
  assert.equal(describeRule(r), 'Perimeter (outside) · Animal · Garden · when NIGHT · 22:00–06:00 → log only');
  const fox = { severity: 'INFO', kind: 'perimeter', cls: 'animal', zone: 'garden' };
  assert.equal(grade(fox, { ...base, mode: 'night', now: at(1), rules: [r] }).suppressed, true);
  assert.equal(grade(fox, { ...base, mode: 'night', now: at(12), rules: [r] }).suppressed, false, 'outside the time window');
  const loud = cleanGradeRule({ name: 'Garage is serious', when: { zone: 'garage' }, then: { action: 'raise' } });
  assert.equal(grade({ severity: 'ADVISORY', kind: 'door', zone: 'garage' }, { ...base, rules: [loud] }).severity, 'ALERT');
  const bad = cleanGradeRule({ when: { kind: 'hack' }, then: { action: 'explode', severity: 'HUGE' } });
  assert.deepEqual([bad.when.kind, bad.then.action, bad.then.severity], ['', 'set', 'ADVISORY']);
  const sz = { id: 's', scope: 'agent', value: 'a1', until: at(15) };
  const g = grade({ severity: 'ALERT', kind: 'motion', agentId: 'a1' }, { ...base, snoozes: [sz] });
  assert.equal(g.suppressed, true);
  assert.equal(g.snoozedBy.id, 's');
  assert.equal(grade({ severity: 'ALERT', kind: 'motion', agentId: 'a1' }, { ...base, now: at(16), snoozes: [sz] }).suppressed, false, 'snooze over');
  const crit = grade({ severity: 'CRITICAL', kind: 'motion', agentId: 'a1' }, { ...base, snoozes: [sz], rules: [cleanGradeRule({ then: { action: 'suppress' } })] });
  assert.deepEqual([crit.severity, crit.suppressed], ['CRITICAL', false]);
});

test('quiet hours: only Critical makes a sound; On Watch adds Advisory', () => {
  const quiet = { on: true, from: '23:00', to: '07:00' };
  assert.equal(inWindow(at(23, 30), '23:00', '07:00'), true);
  assert.equal(inWindow(at(7, 0), '23:00', '07:00'), false);
  assert.equal(shouldNotify('ALERT', { now: at(2), quiet }), false);
  assert.equal(shouldNotify('CRITICAL', { now: at(2), quiet }), true);
  assert.equal(shouldNotify('ALERT', { now: at(12), quiet }), true);
  assert.equal(shouldNotify('ADVISORY', { now: at(12), quiet }), false);
  assert.equal(shouldNotify('ADVISORY', { now: at(12), quiet, onWatch: true }), true);
});

test('alert fatigue and the daily digest', () => {
  const now = at(12), H = 3600000;
  const alerts = [];
  for (let i = 0; i < 10; i++) alerts.push({ ts: now - i * H, severity: 'ADVISORY', agent: 'AGENT-02 HERON', agentId: 'a2', status: i < 7 ? 'dismissed' : 'new', dismissReason: 'False alarm', handledAt: now - i * H + 5 * 60000 });
  alerts.push({ ts: now - H, severity: 'ALERT', agent: 'AGENT-01 OWL', agentId: 'a1', status: 'acknowledged', handledAt: now - H + 120000 });
  const f = fatigueStats(alerts, now);
  assert.equal(f.total, 11);
  assert.equal(f.sources[0].source, 'AGENT-02 HERON');
  assert.equal(f.sources[0].noisy, true);
  assert.match(f.sources[0].advice, /70% of its 10 alerts were false alarms/);
  assert.equal(f.medianWaitMin, 5);
  const d = digest({ alerts, events: [{ ts: now - H, kind: 'motion' }], now, snoozed: 2 });
  assert.match(d.lines[0], /11 alerts in the last 24 hours: 0 critical, 1 alert, 10 advisory, 0 info/);
  assert.match(d.lines[1], /1 sensor event recorded\. 2 alerts were held back/);
  assert.match(d.lines[2], /3 alerts are still unhandled/);
});
