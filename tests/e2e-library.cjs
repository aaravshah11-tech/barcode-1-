// Library tool end-to-end test in a real browser (Chromium via Playwright).
// Book APIs are mocked with recorded responses so it runs offline.
// Usage: serve the folder (python3 -m http.server 8080) then: node tests/e2e.cjs [screenshotDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const SHOTS = process.argv[2] || '';
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8');
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };

async function mockApis(ctx) {
  await ctx.route(/openlibrary\.org\/api\/books/, (r) => {
    const u = r.request().url();
    r.fulfill({ contentType: 'application/json', body: u.includes('9780747532699') ? fx('ol-9780747532699') : '{}' });
  });
  await ctx.route(/openlibrary\.org\/isbn\//, (r) => {
    const u = r.request().url();
    if (u.includes('9780747532699')) r.fulfill({ contentType: 'application/json', body: fx('ol-edition-9780747532699') });
    else r.fulfill({ status: 404, body: '' });
  });
  await ctx.route(/openlibrary\.org\/works\//, (r) => r.fulfill({ contentType: 'application/json', body: fx('ol-work-OL82563W') }));
  await ctx.route(/googleapis\.com\/books/, (r) => {
    const u = r.request().url();
    r.fulfill({ contentType: 'application/json', body: u.includes('9780141439518') ? fx('google-9780141439518') : '{"totalItems":0}' });
  });
  // Covers: a plain coloured image.
  const png = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-192.png'));
  await ctx.route(/covers\.openlibrary\.org|books\.google\.com\/books\/content/, (r) => r.fulfill({ contentType: 'image/png', body: png }));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  await mockApis(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/camera|getUserMedia|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  await page.goto(BASE + '?nosw#/library');
  await page.waitForSelector('.empty');
  check(await page.isVisible('text=Your shelf is empty'), 'empty library message shown');
  await shot('01-empty');

  // --- Add by typing an ISBN (Open Library) ---
  await page.goto(BASE + '?nosw#/library/scan');
  await page.waitForSelector('[data-manual] input');
  await page.fill('[data-manual] input', '978-0-7475-3269-9');
  await page.click('[data-manual] button');
  await page.waitForSelector('text=Add this book?');
  check(await page.isVisible(".sheet >> text=Harry Potter and the Philosopher's Stone"), 'lookup found Harry Potter');
  // Add a room, a bookcase, choose shelf 3
  await page.click('.sheet [data-add-room]');
  await page.fill('.sheet.dialog input', 'Study');
  await page.click('.sheet.dialog button.btn-primary');
  await page.waitForSelector('.sheet [data-add-area]');
  await page.click('.sheet [data-add-area]');
  await page.click('.choice-grid button:has-text("Bookcase")');
  await page.fill('.sheet.dialog input', 'Tall bookcase');
  await page.click('.sheet.dialog button.btn-primary');
  await page.waitForSelector('.sheet [data-spot] >> text=Shelf 3');
  await page.click('.sheet [data-spot] >> text=Shelf 3');
  await page.click('.sheet [data-add-owner]');
  await page.fill('.sheet.dialog input', 'Aarav');
  await page.click('.sheet.dialog button.btn-primary');
  await page.waitForTimeout(150);
  await shot('02-confirm');
  await page.click('.sheet [data-save]');
  await page.waitForSelector('.toast >> text=Saved');
  check(true, 'saved with location Study › Tall bookcase › Shelf 3');

  // --- Duplicate check ---
  await page.fill('[data-manual] input', '0747532699');
  await page.click('[data-manual] button');
  await page.waitForSelector('text=Already in your library');
  check(await page.isVisible('.sheet >> text=Tall bookcase'), 'duplicate shows existing location');
  await shot('03-duplicate');
  await page.click('.sheet [data-close]:not(.icon-btn)');

  // --- Not found online -> manual form ---
  await page.fill('[data-manual] input', '9780000000002');
  await page.click('[data-manual] button');
  await page.waitForSelector('text=couldn’t find ISBN');
  check(true, 'unknown ISBN opens manual form');
  await page.fill('.book-form input[name=title]', 'Family Recipes');
  await page.fill('.book-form input[name=authors]', 'Grandma');
  await page.click('.book-form button.btn-primary');
  await page.waitForSelector('.toast >> text=Family Recipes');
  check(await page.evaluate(() => !document.querySelector('.sheet-backdrop')), 'manual book saved, sheet closed');

  // --- Batch mode with Google fallback ---
  await page.click('[data-mode=batch]');
  await page.waitForSelector('.loc-bar');
  check(/Study › Tall bookcase › Shelf 3/.test(await page.textContent('.loc-bar')), 'batch mode remembers the last location');
  await page.click('[data-change-loc]');
  await page.waitForSelector('text=Where are these books going?');
  await page.click('.sheet [data-done]');
  await page.fill('[data-manual] input', '9780141439518');
  await page.click('[data-manual] button');
  await page.waitForSelector('[data-recent] >> text=Pride and Prejudice', { timeout: 5000 });
  check(true, 'batch saved Pride and Prejudice (Google Books fallback)');
  await page.fill('[data-manual] input', '9780141439518');
  await page.click('[data-manual] button');
  await page.waitForSelector('[data-recent] >> text=Already have');
  check((await page.textContent('[data-counter]')).trim() === '1', 'batch duplicate not added twice');
  await shot('04-batch');

  // --- Where is it? ---
  await page.click('[data-mode=where]');
  await page.fill('[data-manual] input', '9780747532699');
  await page.click('[data-manual] button');
  await page.waitForSelector('.where-path');
  const where = await page.textContent('.where-path');
  check(/Study/.test(where) && /Tall bookcase/.test(where) && /Shelf 3/.test(where), 'where-is-it shows Study › Tall bookcase › Shelf 3');
  await shot('05-where');
  await page.click('.sheet [data-close].btn');
  await page.fill('[data-where-q]', 'pride');
  await page.waitForSelector('[data-where-results] >> text=Pride and Prejudice');
  check(true, 'where-is-it search by title works');

  // --- Library ---
  await page.goto(BASE + '?nosw#/library');
  await page.waitForSelector('.grid .tile');
  check((await page.$$('.grid .tile')).length === 3, 'library grid has 3 books');
  await page.waitForTimeout(300);
  await shot('06-library-grid');
  await page.fill('[data-q]', 'austen');
  await page.waitForTimeout(250);
  check((await page.$$('.grid .tile')).length === 1, 'search by author');
  await page.fill('[data-q]', '');
  await page.click('[data-view]');
  await page.waitForSelector('.rows .row');
  await shot('07-library-list');
  await page.click('[data-filters]');
  await page.selectOption('.sheet select[name=room]', { label: 'Living room' });
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(200);
  check((await page.$$('.rows .row')).length === 0, 'filter by room (Living room is empty)');
  await page.click('[data-clear=room]');
  await page.click('[data-filters]');
  await page.selectOption('.sheet select[name=author]', 'Jane Austen');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(200);
  check((await page.$$('.rows .row')).length === 1, 'filter by author');
  await page.click('[data-clear=author]');

  // --- Book detail edits ---
  await page.click(".rows .row >> text=Harry Potter");
  await page.waitForSelector('.book-hero');
  await page.click('[data-status] [data-status=read]');
  await page.click('[data-stars] [data-star="5"]');
  await page.click('[data-fav]');
  await page.fill('[data-lend] input', 'Sam');
  await page.click('[data-lend] button');
  await page.waitForSelector('text=Got it back');
  check(await page.isVisible('[data-desc]'), 'description shown');
  await shot('08-book');

  // --- Stats ---
  await page.goto(BASE + '?nosw#/library/stats');
  await page.waitForSelector('.stat-grid');
  const statsText = await page.textContent('#view');
  check(/3\s*Books/.test(statsText) && /703\s*Total pages/.test(statsText), 'stats: 3 books, 703 pages');
  await shot('09-stats');

  // --- Export / import ---
  await page.goto(BASE + '?nosw#/settings/backup');
  await page.waitForSelector('[data-export]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export]')]);
  const jsonPath = await dl.path();
  const backup = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  check(backup.app === 'homebase' && backup.data.books.length === 3 && backup.data.rooms.length >= 2, 'JSON backup has 3 books');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-csv="library|0"]')]);
  const csv = fs.readFileSync(await dl2.path(), 'utf8');
  check(csv.split('\n').length === 4 && csv.includes('Study,Tall bookcase,Shelf 3'), 'Library CSV has header + 3 rows with location');
  await shot('10-settings');

  // Dark mode screenshot
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(BASE + '?nosw#/library');
  await page.waitForSelector('.grid .tile, .rows .row');
  await page.waitForTimeout(300);
  await shot('11-library-dark');

  // Import into a fresh browser
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await mockApis(ctx2);
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '?nosw#/settings/backup');
  await p2.waitForSelector('[data-import]', { state: 'attached' });
  await p2.setInputFiles('[data-import]', jsonPath);
  await p2.waitForSelector('.toast >> text=Imported');
  await p2.goto(BASE + '?nosw#/library');
  await p2.waitForSelector('.rows .row, .grid .tile');
  check((await p2.$$('.grid .tile, .rows .row')).length === 3, 'import into fresh browser restores 3 books');
  await p2.waitForTimeout(300);
  if (SHOTS) await p2.screenshot({ path: path.join(SHOTS, '12-desktop.png') });

  // Offline add: lookup is skipped and fills in later
  await ctx.setOffline(true);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE + '?nosw#/library/scan').catch(() => {});
  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
