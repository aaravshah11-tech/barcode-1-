// Operations Floor: the automatic Current Picture, timeline lanes and fleet ordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.document ??= { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {}, classList: { toggle() {} } } };
const { pictureSummary, laneOf, fleetOrder, zoneOf } = await import('../../hq/floor.js');

const H = 3600000, now = Date.UTC(2026, 10, 1, 23);
const house = { floors: [{ id: 'f0', rooms: [{ id: 'k', name: 'Kitchen' }, { id: 'g', name: 'Garage' }] }] };
const agents = [
  { id: 'a1', codename: 'FALCON', online: true, number: 1, place: { roomId: 'k' } },
  { id: 'a2', codename: 'HERON', online: true, number: 2, place: { roomId: 'g' } },
  { id: 'a3', codename: 'KESTREL', online: true, number: 3, place: { zone: 'garden' } },
  { id: 'a4', codename: 'WREN', online: false, number: 4 },
];

test('current picture: quiet, or the most serious open alert with its reference', () => {
  const quiet = pictureSummary({ alerts: [], events: [], agents: agents.slice(0, 3), mode: 'night', now });
  assert.equal(quiet.state, 'NIGHT');
  assert.match(quiet.text, /^Quiet\. No alerts in the last 4 hours\. No sensor activity in the last hour\.$/);
  const busy = pictureSummary({ alerts: [{ id: 'ALT-000412', ts: now - H, severity: 'HIGH', title: 'Person — Back garden', status: 'new' }, { id: 'ALT-000411', ts: now - 2 * H, severity: 'MEDIUM', title: 'x', status: 'new' }], events: [], agents, mode: 'away', now });
  assert.match(busy.text, /2 open alerts; most serious: Person — Back garden \(ALT-000412\)\./);
  assert.match(busy.text, /1 Agent offline: WREN\./);
  assert.equal(busy.significant.id, 'ALT-000412');
  assert.equal(busy.since, H);
});

test('timeline lanes: inside, garage (by room name), outside zones, network', () => {
  assert.equal(zoneOf(agents[1], house), 'garage');
  assert.equal(laneOf({ kind: 'motion', agentId: 'a1' }, agents, house), 'inside');
  assert.equal(laneOf({ kind: 'door', agentId: 'a2' }, agents, house), 'garage');
  assert.equal(laneOf({ kind: 'motion', agentId: 'a3' }, agents, house), 'garden');
  assert.equal(laneOf({ kind: 'device', message: 'Phone connected' }, agents, house), 'network');
  assert.equal(laneOf({ kind: 'system', message: 'Internet connection lost' }, agents, house), 'network');
  assert.equal(laneOf({ kind: 'system', message: 'Alert state: AWAY' }, agents, house), null);
});

test('fleet: problems float to the top', () => {
  const list = [...agents, { id: 'a5', codename: 'MERLIN', online: true, number: 5, status: { battery: 0.1, charging: false } }];
  assert.deepEqual(fleetOrder(list).map((a) => a.codename).slice(0, 2), ['WREN', 'MERLIN']);
});
