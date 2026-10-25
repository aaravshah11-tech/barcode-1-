import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inQuietHours } from '../../server/alerts.js';

const at = (h, m = 0) => new Date(2026, 0, 1, h, m);

test('quiet hours, including ones that cross midnight', () => {
  assert.equal(inQuietHours('', '', at(3)), false);
  assert.equal(inQuietHours('22:00', '07:00', at(23)), true);
  assert.equal(inQuietHours('22:00', '07:00', at(3)), true);
  assert.equal(inQuietHours('22:00', '07:00', at(7)), false);
  assert.equal(inQuietHours('22:00', '07:00', at(12)), false);
  assert.equal(inQuietHours('13:00', '14:30', at(14, 15)), true);
  assert.equal(inQuietHours('13:00', '14:30', at(14, 30)), false);
});
