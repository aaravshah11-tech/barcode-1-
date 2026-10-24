import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, docStatus, groupDocs, timeLeft } from '../js/tools/warranties/logic.js';

const now = new Date(2026, 9, 24, 12).getTime();

test('warranties: end date from purchase date + months', () => {
  assert.equal(addMonths('2025-03-15', 24), '2027-03-15');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2027-12-31', 2), '2028-02-29');
  assert.equal(addMonths('', 12), '');
});

test('warranties: status, groups, time left', () => {
  assert.equal(docStatus({ expiry: '2026-11-30' }, now).key, 'soon');
  assert.equal(docStatus({ expiry: '2027-11-30' }, now).key, 'active');
  assert.equal(docStatus({ expiry: '2026-10-01' }, now).key, 'expired');
  assert.equal(docStatus({}, now).key, 'none');
  const g = groupDocs([{ title: 'TV', expiry: '2028-01-01' }, { title: 'Kettle', expiry: '2026-11-02' }, { title: 'Manual' }, { title: 'Old phone', expiry: '2025-01-01' }, { title: 'Fridge', expiry: '2026-12-01' }], now);
  assert.deepEqual(g.map((x) => [x.key, x.docs.map((d) => d.title).join(',')]), [['soon', 'Kettle,Fridge'], ['active', 'TV'], ['none', 'Manual'], ['expired', 'Old phone']]);
  assert.equal(timeLeft('2026-10-29', now), '5 days left');
  assert.equal(timeLeft('2026-10-24', now), 'ends today');
  assert.equal(timeLeft('2029-01-24', now), '2 years 3 months left');
  assert.equal(timeLeft('2026-07-24', now), 'ended 3 months ago');
});
