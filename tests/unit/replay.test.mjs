import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayable, indexAfter, roomCounts, heatLevel, heatOpacity } from '../../shared/replay.js';

const ev = (id, ts, kind = 'motion', agentId = 'a') => ({ id, ts, kind, agentId });

test('replay: sensor events in the period, in time order; find the next one', () => {
  const list = replayable([ev(3, 300), ev(1, 100), ev(2, 200, 'system'), ev(4, 999), ev(5, 50)], 60, 500);
  assert.deepEqual(list.map((e) => e.id), [1, 3], 'system messages and events outside the period are left out');
  const s = [ev(1, 10), ev(2, 20), ev(3, 20), ev(4, 30)];
  assert.equal(indexAfter(s, 5), 0);
  assert.equal(indexAfter(s, 20), 3, 'events exactly at t count as already played');
  assert.equal(indexAfter(s, 99), 4);
});

test('heatmap: counts per room, busiest = strongest', () => {
  const house = { floors: [{ rooms: [{ id: 'k' }, { id: 'h' }] }] };
  const agents = [{ id: 'a', place: { roomId: 'k' } }, { id: 'b', place: { roomId: 'h' } }, { id: 'c' }, { id: 'd', place: { roomId: 'gone' } }];
  const r = roomCounts([ev(1, 1, 'motion', 'a'), ev(2, 2, 'door', 'a'), ev(3, 3, 'sound', 'b'), ev(4, 4, 'motion', 'c'), ev(5, 5, 'motion', 'd'), ev(6, 6, 'system', 'a')], agents, house);
  assert.deepEqual(r.counts, { k: 2, h: 1 });
  assert.equal(r.unplaced, 2, 'Agents not on the map (or in a deleted room) are counted apart');
  assert.equal(r.max, 2); assert.equal(r.total, 3);
  assert.equal(heatLevel(0, 10), 0);
  assert.equal(heatLevel(1, 10), 1);
  assert.equal(heatLevel(10, 10), 5);
  assert.equal(heatLevel(6, 10), 3);
  assert.ok(heatOpacity(5) > heatOpacity(1) && heatOpacity(0) === 0);
});
