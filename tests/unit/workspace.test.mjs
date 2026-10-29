import { test } from 'node:test';
import assert from 'node:assert/strict';

// workspace.js imports ui.js (browser helpers) only for esc(); give it the tiny DOM bits it needs.
globalThis.document ??= { querySelector: () => null, querySelectorAll: () => [] };
const { settle, reconcile, overlaps } = await import('../../hq/workspace.js');

test('layout: moving a panel pushes others out of the way, then everything floats up', () => {
  const items = [{ id: 'a', x: 0, y: 0, w: 6, h: 4 }, { id: 'b', x: 6, y: 0, w: 6, h: 4 }, { id: 'c', x: 0, y: 4, w: 12, h: 3 }];
  // drag c to the top-left
  items[2].y = 0;
  settle(items, 'c');
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual([by.c.x, by.c.y], [0, 0], 'the moved panel stays where it was dropped');
  assert.equal(by.a.y, 3); assert.equal(by.b.y, 3);
  for (const p of items) for (const q of items) if (p !== q) assert.ok(!overlaps(p, q), `${p.id} and ${q.id} don't overlap`);
});

test('layout: gaps close, panels stay inside 12 columns', () => {
  const items = settle([{ id: 'a', x: 10, y: 9, w: 6, h: 2 }]);
  assert.deepEqual([items[0].x, items[0].y], [6, 0]);
});

test('layout: new panels are added at the bottom, removed ones dropped', () => {
  const out = reconcile([{ id: 'map', x: 0, y: 0, w: 8, h: 10 }, { id: 'gone', x: 8, y: 0, w: 4, h: 4 }], ['map', 'log'], { log: { w: 12, h: 6 } });
  assert.deepEqual(out.map((i) => i.id), ['map', 'log']);
  assert.deepEqual(out[1], { id: 'log', x: 0, y: 10, w: 12, h: 6 });
});

test('command palette: fuzzy matching', async () => {
  const { score, filterActions } = await import('../../hq/palette.js');
  assert.ok(score('lock', 'Lock HQ') > score('lock', 'Alert state: LOCKDOWN'), 'starts-with beats contains');
  assert.ok(score('ast', 'Alert state: AWAY') > 0, 'letters in order match');
  assert.equal(score('zzz', 'Lock HQ'), 0);
  const acts = [{ group: 'Go to', label: 'Operations' }, { group: 'Alert state', label: 'Set NIGHT' }, { group: 'Agent', label: 'NIGHTJAR', keywords: ['hallway'] }];
  assert.deepEqual(filterActions(acts, 'night').map((a) => a.label), ['NIGHTJAR', 'Set NIGHT']);
  assert.deepEqual(filterActions(acts, 'hallway').map((a) => a.label), ['NIGHTJAR'], 'keywords match too');
  assert.equal(filterActions(acts, '').length, 3);
});
