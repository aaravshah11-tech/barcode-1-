import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiryStatus, groupPantry, shelfDays, suggestExpiry, addDays, isoDay } from '../js/tools/pantry/logic.js';

const now = new Date(2026, 9, 24, 18).getTime();

test('pantry: expiry status and groups', () => {
  assert.equal(expiryStatus('2026-10-23', now).key, 'expired');
  assert.equal(expiryStatus('2026-10-23', now).text, 'Past its date (yesterday)');
  assert.equal(expiryStatus('2026-10-24', now).text, 'Use by today');
  assert.equal(expiryStatus('2026-10-25', now).text, 'Use by tomorrow');
  assert.equal(expiryStatus('2026-10-27', now).key, 'soon');
  assert.match(expiryStatus('2026-10-27', now).text, /^Use by \S+ 27 Oct \(3 days\)$|^Use by \S+ Oct 27 \(3 days\)$/);
  assert.equal(expiryStatus('2026-10-30', now).key, 'week');
  assert.equal(expiryStatus('2027-01-01', now).key, 'later');
  assert.equal(expiryStatus('', now).key, 'none');
  const g = groupPantry([
    { name: 'Rice' }, { name: 'Milk', expiry: '2026-10-26' }, { name: 'Yoghurt', expiry: '2026-10-25' }, { name: 'Ham', expiry: '2026-10-20' }, { name: 'Beans', expiry: '2028-01-01' },
  ], now);
  assert.deepEqual(g.map((x) => [x.key, x.items.map((i) => i.name).join(',')]), [['expired', 'Ham'], ['soon', 'Yoghurt,Milk'], ['later', 'Beans'], ['none', 'Rice']]);
});

test('pantry: remembers how long a product lasts', () => {
  const added = new Date(2026, 9, 1, 10).getTime();
  assert.equal(shelfDays({ addedAt: added, expiry: '2026-10-11' }), 10);
  assert.equal(shelfDays({ addedAt: added, expiry: '' }), null);
  assert.equal(suggestExpiry({ shelfDays: 10 }, now), '2026-11-03');
  assert.equal(suggestExpiry(null, now), '');
  assert.equal(addDays('2026-10-24', 7), '2026-10-31');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30', 'across the clock change');
  assert.equal(isoDay(now), '2026-10-24');
});
