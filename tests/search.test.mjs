import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, tokens, scoreFields, searchList, sameCode } from '../js/core/search.js';
import { dayMs, daysFrom, whenText, lentReminders, matchReminders, expiryReminders, sortReminders, activeReminders, DAY } from '../js/core/reminders.js';

test('search: accents, every word must match, better matches rank higher', () => {
  assert.equal(norm('Café Crème'), 'cafe creme');
  assert.deepEqual(tokens('  hobbit, tolkien '), ['hobbit', 'tolkien']);
  assert.equal(scoreFields([['The Hobbit', 3], [['J. R. R. Tolkien'], 2]], tokens('hobbit tolkien')) > 0, true);
  assert.equal(scoreFields([['The Hobbit', 3]], tokens('hobbit tolkien')), 0, 'all words needed');
  const books = [{ id: 1, t: 'Garden Birds' }, { id: 2, t: 'Birdsong' }, { id: 3, t: 'The Secret Garden' }, { id: 4, t: 'Cooking' }];
  const r = searchList(books, 'bird', (b) => ({ fields: [[b.t, 1]], id: b.id }));
  assert.deepEqual(r.map((x) => x.id), [2, 1], 'start of title beats start of a later word');
  assert.equal(searchList(books, 'cafe', (b) => ({ fields: [[b.t, 1]] })).length, 0);
  assert.equal(searchList([{ t: 'Café de Paris' }], 'cafe', (b) => ({ fields: [[b.t, 1]] })).length, 1);
  assert.ok(sameCode('978-0-261-10334-4', '9780261103344'));
  assert.ok(!sameCode('', ''));
});

test('search: 5,000 records, well under 40 ms per keystroke', () => {
  const list = Array.from({ length: 5000 }, (_, i) => ({ title: `Book number ${i} about rivers and stones${i % 7 ? '' : ' café'}`, author: `Author ${i % 50}` }));
  const map = (b) => ({ fields: [[b.title, 3], [b.author, 2]] });
  // Time searches the way you'd type them (the first one includes warming up).
  const t = performance.now();
  let r;
  for (const q of ['r', 'ri', 'riv', 'river', 'river author 7']) r = searchList(list, q, map);
  const ms = (performance.now() - t) / 5;
  assert.ok(r.length > 0);
  assert.ok(ms < 40, `${ms.toFixed(1)} ms per keystroke`);
});

test('reminders: lent out over 30 days, old records without a date', () => {
  const now = new Date(2026, 9, 24, 12).getTime();
  const books = [
    { id: 'a', title: 'A', lentTo: 'Sam', lentDate: '2026-09-01' },          // 53 days
    { id: 'b', title: 'B', lentTo: 'Jo', lentDate: '2026-10-10' },           // 14 days: not yet
    { id: 'c', title: 'C', lentTo: 'Ann', updatedAt: now - 100 * DAY },      // older record without a lending date
    { id: 'd', title: 'D', lentTo: '' },
  ];
  const r = lentReminders(books, now, { what: 'book', label: (b) => b.title, href: (b) => `#/b/${b.id}`, dateOf: (b) => b.lentDate });
  assert.deepEqual(r.map((x) => x.id), ['lent:book:a', 'lent:book:c']);
  assert.equal(r[0].sub, '53 days ago');
  assert.equal(r[1].sub, 'at least 100 days ago');
  assert.equal(r[1].level, 'danger');
});

test('reminders: upcoming matches, expiry windows, snooze, order', () => {
  const now = new Date(2026, 9, 24, 9).getTime();
  const ms = [
    { id: 'm1', status: 'upcoming', date: '2026-10-25', title: 'Us v Them', sport: 'rugby', venue: 'Home' },
    { id: 'm2', status: 'upcoming', date: '2026-11-20', title: 'Later' },
    { id: 'm3', status: 'done', date: '2026-10-24', title: 'Played' },
    { id: 'm4', status: 'upcoming', date: '2026-10-20', title: 'Past, never started' },
  ];
  const m = matchReminders(ms, now);
  assert.deepEqual(m.map((x) => x.title), ['Us v Them']);
  assert.equal(m[0].sub, 'tomorrow · Home');
  const w = expiryReminders([{ id: 1, d: '2026-11-10' }, { id: 2, d: '2026-10-01' }, { id: 3, d: '2027-06-01' }, { id: 4, d: '2026-08-01' }], now,
    { get: (x) => ({ date: x.d, title: `W${x.id}`, href: '#', kind: 'warranty', icon: '🧾' }) });
  assert.deepEqual(w.map((x) => [x.title, x.level, x.sub]), [['W1', 'info', 'Expires in 17 days'.replace('in 17 days', whenText(dayMs('2026-11-10'), now))], ['W2', 'danger', 'Expired 23 days ago']]);
  assert.deepEqual(sortReminders([...m, ...w]).map((x) => x.title), ['W2', 'Us v Them', 'W1']);
  assert.deepEqual(activeReminders(w, [{ id: w[0].id, until: now + DAY }], now).map((x) => x.title), ['W2']);
  assert.equal(daysFrom('2026-10-24', '2026-10-31'), 7);
  assert.equal(whenText(dayMs('2026-10-24'), now), 'today');
  assert.equal(whenText(dayMs('2026-10-23'), now), 'yesterday');
});
