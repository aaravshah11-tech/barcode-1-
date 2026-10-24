// Start menu search, Reminders, Pantry and Warranties browser test.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const SHOTS = process.argv[2] || '';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n, p = page) => SHOTS && p.screenshot({ path: path.join(SHOTS, n + '.png') });
  await page.route(/openfoodfacts|upcitemdb|googleapis|openlibrary/, (r) => r.fulfill({ status: 404, body: '{}' }));

  await page.goto(BASE + '?nosw#/');
  await page.waitForSelector('[data-gq]');
  const DAY = 86400000;
  const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await page.evaluate(async ({ DAY, lent, soon }) => {
    const s = await import('./js/core/store.js');
    await s.put('rooms', { id: 'garage', name: 'Garage', order: 9, areas: [{ id: 'shelf', name: 'Metal shelving', kind: 'shelf', spots: [{ id: 'bx', name: 'Box 4' }] }] });
    await s.put('books', { id: 'b1', title: 'The Hobbit', authors: ['J. R. R. Tolkien'], isbn13: '9780261103344', lentTo: 'Sam', lentDate: lent, addedAt: Date.now() });
    await s.put('books', { id: 'b2', title: 'Birdsong', authors: ['Sebastian Faulks'], addedAt: Date.now() });
    await s.put('items', { id: 'i1', name: 'Cordless drill', brand: 'Bosch', barcode: '4053423201234', location: { roomId: 'garage', areaId: 'shelf', spotId: 'bx' } });
    await s.put('teams', { id: 't1', name: 'Frontage RFC', sport: 'rugby', mine: true });
    await s.put('players', { id: 'p1', name: 'Hobbs Taylor', teamIds: ['t1'] });
    await s.put('matches', { id: 'm1', sport: 'rugby', teamId: 't1', oppName: 'Riverside', title: 'Frontage RFC v Riverside', date: soon, venue: 'Home ground', status: 'upcoming' });
  }, { DAY, lent: iso(Date.now() - 45 * DAY), soon: iso(Date.now() + 2 * DAY) });

  // ---- Global search ----
  await page.goto(BASE + '?nosw#/');
  await page.keyboard.press('/');
  check(await page.evaluate(() => document.activeElement?.matches('[data-gq]')), '“/” jumps to the search box');
  await page.keyboard.type('hobbit');
  await page.waitForSelector('.gs-hit');
  const groups = await page.$$eval('.gs-group h2', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check(groups[0].startsWith('📚 Library'), `best match first: Library (${groups.join(' | ')})`);
  check(await page.isHidden('[data-menu-body]'), 'tool tiles hidden while searching');
  check((await page.innerHTML('.gs-hit >> nth=0')).includes('<mark>Hobbit</mark>'), 'matching text highlighted');
  await shot('hub-search');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('h1:has-text("The Hobbit")');
  check(true, 'keyboard: ↓ then Enter opens the book');
  await page.goBack();
  await page.waitForSelector('.gs-hit');
  check((await page.inputValue('[data-gq]')) === 'hobbit', 'Back returns to the same results');
  await page.fill('[data-gq]', 'hobb');
  await page.waitForFunction(() => document.querySelectorAll('.gs-group').length === 2);
  check(true, 'part of a word finds both the book and the player Hobbs Taylor');
  await page.fill('[data-gq]', '4053423201234');
  await page.waitForSelector('.gs-hit:has-text("Cordless drill")');
  check((await page.textContent('.gs-hit:has-text("Cordless drill")')).includes('Garage › Metal shelving › Box 4'), 'barcode finds the item and shows where it is');
  await page.fill('[data-gq]', 'box 4');
  await page.waitForSelector('.gs-hit:has-text("Box 4")');
  check(true, 'places (rooms, shelves, boxes) are searchable');
  await page.fill('[data-gq]', 'riverside');
  await page.waitForSelector('.gs-hit:has-text("Frontage RFC v Riverside")');
  check(true, 'matches are searchable');
  await page.fill('[data-gq]', 'zzqx');
  await page.waitForSelector('text=Nothing found');
  check(true, 'friendly “nothing found”');
  await page.press('[data-gq]', 'Escape');
  await page.waitForSelector('[data-menu-body]:not([hidden]) .menu-grid');
  check(true, 'Esc clears the search and brings back the tools');
  // Live: a book added while results are showing appears without retyping
  await page.fill('[data-gq]', 'silmarillion');
  await page.waitForSelector('text=Nothing found');
  await page.evaluate(async () => (await import('./js/core/store.js')).put('books', { id: 'b3', title: 'The Silmarillion', authors: ['J. R. R. Tolkien'] }));
  await page.waitForSelector('.gs-hit:has-text("The Silmarillion")');
  check(true, 'results update live when something new arrives');
  await page.fill('[data-gq]', '');

  // ---- Reminders ----
  await page.goto(BASE + '?nosw#/');
  await page.waitForSelector('.rem-card');
  const card = (await page.textContent('.rem-card')).replace(/\s+/g, ' ');
  check(/2 reminders · 1 needs attention/.test(card) && card.includes('The Hobbit — lent to Sam'), `start menu reminder card: ${card.trim()}`);
  await page.click('.rem-card');
  await page.waitForSelector('.rem');
  const rems = await page.$$eval('.rem .row-title', (els) => els.map((e) => e.textContent));
  check(rems.length === 2 && rems[0].includes('The Hobbit') && rems[1].includes('Frontage RFC v Riverside'), `reminders screen: ${rems.join(' | ')}`);
  check((await page.textContent('.rem >> nth=0')).includes('45 days ago'), 'lent 45 days ago');
  check((await page.textContent('.rem >> nth=1')).includes('in 2 days · Home ground'), 'match in 2 days at Home ground');
  await shot('hub-reminders');
  await page.click('[data-snooze^="lent:book:b1"]');
  await page.waitForFunction(() => document.querySelectorAll('.rem').length === 1);
  check(true, 'hide for 7 days');
  await page.click('.toast button:has-text("Undo")');
  await page.waitForFunction(() => document.querySelectorAll('.rem').length === 2);
  check(true, 'undo brings it back');
  // Giving the book back clears the reminder everywhere
  await page.evaluate(async () => (await import('./js/core/store.js')).patch('books', 'b1', { lentTo: '', lentDate: '' }));
  await page.waitForFunction(() => document.querySelectorAll('.rem').length === 1);
  check(true, 'returning the book removes its reminder live');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll hub checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
