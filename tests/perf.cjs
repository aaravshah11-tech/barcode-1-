// Speed test: 5,000 books and 3,000 photos. Fails if a screen takes too long or freezes the page.
// Run with the app on :8080 (npm run test:e2e -- perf, or node tests/perf.cjs).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };
// CI machines are slower than laptops: budgets are generous but catch real problems.
const SLOW = +(process.env.PERF_FACTOR || (process.env.CI ? 2 : 1));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '?nosw#/');
  await page.waitForSelector('.tool-card, .menu-grid, #view *');

  // Seed data
  const seedMs = await page.evaluate(async () => {
    const s = await import('./js/core/store.js');
    const t0 = performance.now();
    const words = 'river stone night garden silver house winter light ocean forest king glass shadow city red letter'.split(' ');
    const names = ['Ann Lee', 'Tom Hardy', 'Jo Brown', 'Sam Patel', 'Mia Chen', 'Leo Rossi', 'Ivy Okafor', 'Max Weber'];
    const pick = (i, a) => a[i % a.length];
    const books = Array.from({ length: 5000 }, (_, i) => ({ id: `b${i}`, title: `The ${pick(i * 7, words)} ${pick(i * 3, words)} ${i}`, authors: [pick(i, names)], isbn13: String(9780000000000 + i), subjects: [pick(i, ['Fiction', 'History', 'Science', 'Travel'])], addedAt: Date.now() - i * 60000, status: pick(i, ['read', 'unread', 'reading']), lentTo: i % 97 === 0 ? 'Grandma' : '' }));
    await s.putMany('books', books);
    await s.put('matches', { id: 'pm', sport: 'rugby', date: '2026-10-24', teamName: 'Frontage', opponent: 'Riverside', status: 'done' });
    const photos = Array.from({ length: 3000 }, (_, i) => ({ id: `pm:IMG_${String(i).padStart(4, '0')}.JPG`, matchId: 'pm', name: `IMG_${String(i).padStart(4, '0')}.JPG`, path: `IMG_${String(i).padStart(4, '0')}.JPG`, cameraMs: 1792854000000 + i * 1500, rating: i % 5, flag: i % 11 === 0 ? 'pick' : '' }));
    await s.putMany('photos', photos);
    return performance.now() - t0;
  });
  console.log(`  seeded 8,000 records in ${Math.round(seedMs)} ms`);

  // Watch for long freezes on the main thread
  const trackLongTasks = () => page.evaluate(() => {
    window.__long = [];
    if (!window.__lto) { window.__lto = new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))); window.__lto.observe({ type: 'longtask', buffered: false }); }
  });
  const worstFreeze = () => page.evaluate(() => Math.round(Math.max(0, ...window.__long)));

  // 1. Cold start with everything in the database
  const t0 = Date.now();
  await page.goto(BASE + '?nosw#/library');
  await page.waitForSelector('[data-count]:not(:empty)');
  const coldMs = Date.now() - t0;
  const count = await page.textContent('[data-count]');
  check(count.includes('5,000'), `library shows ${count}`);
  check(coldMs < 2500 * SLOW, `app opens on the library with 5,000 books in ${coldMs} ms`);

  // 2. Typing in search
  await trackLongTasks();
  const typeMs = await page.evaluate(async () => {
    const input = document.querySelector('[data-q]');
    const t = performance.now();
    for (const ch of 'silver') { input.value += ch; input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 30)); }
    await new Promise((r) => { const c = () => (/of 5,000/.test(document.querySelector('[data-count]').textContent) ? r() : setTimeout(c, 10)); c(); });
    return performance.now() - t;
  });
  check(typeMs < 900 * SLOW, `search results while typing in ${Math.round(typeMs)} ms`);
  let freeze = await worstFreeze();
  check(freeze < 250 * SLOW, `no long freeze while typing (worst ${freeze} ms)`);
  await page.fill('[data-q]', '');
  await page.waitForFunction(() => /^5,000/.test(document.querySelector('[data-count]').textContent));

  // 3. List/grid switch + scrolling to the end
  await trackLongTasks();
  let t = Date.now();
  await page.click('[data-view]');
  await page.waitForSelector('[data-results] .rows');
  check(Date.now() - t < 800 * SLOW, `switch to list view in ${Date.now() - t} ms`);
  await page.click('[data-view]');
  await page.waitForSelector('[data-results] .grid');
  t = Date.now();
  await page.evaluate(async () => { for (let i = 0; i < 30; i++) { window.scrollBy(0, 4000); await new Promise((r) => requestAnimationFrame(r)); } });
  await page.waitForTimeout(400);
  freeze = await worstFreeze();
  check(freeze < 250 * SLOW, `view switch + scrolling without long freezes (worst ${freeze} ms)`);
  const tiles = await page.$$eval('[data-results] .tile', (els) => els.length);
  check(tiles >= 5000 || (await page.$('[data-more], [data-sentinel]')) != null, `all books reachable by scrolling (${tiles} tiles in page)`);

  // 4. A change syncing in from another device while the list is open
  await trackLongTasks();
  t = await page.evaluate(async () => {
    const s = await import('./js/core/store.js');
    const t0 = performance.now();
    await s.put('books', { id: 'new1', title: 'Arrived From Phone', authors: ['Zed'], addedAt: Date.now() });
    await new Promise((r) => { const c = () => (/5,001/.test(document.querySelector('[data-count]').textContent) ? r() : setTimeout(c, 5)); c(); });
    return performance.now() - t0;
  });
  check(t < 500 * SLOW, `a new book appears in ${Math.round(t)} ms`);
  // Device-only settings changes shouldn't redraw the whole list
  const redraws = await page.evaluate(async () => {
    const s = await import('./js/core/store.js');
    const el = document.querySelector('[data-results] > *');
    await s.setLocal('perf.test', Date.now());
    await new Promise((r) => setTimeout(r, 200));
    return document.querySelector('[data-results] > *') === el ? 0 : 1;
  });
  check(redraws === 0, 'device-only setting change does not redraw the library');

  // 5. Book page and back
  t = Date.now();
  await page.goto(BASE + '?nosw#/library/book/b42');
  await page.waitForSelector('h1');
  check(Date.now() - t < 1500 * SLOW, `book page opens in ${Date.now() - t} ms`);

  // 6. Cull 3,000 photos
  t = Date.now();
  await page.goto(BASE + '?nosw#/photo/cull/pm');
  await page.waitForSelector('.cull-grid');
  const cullMs = Date.now() - t;
  check(cullMs < 2500 * SLOW, `cull screen with 3,000 photos opens in ${cullMs} ms`);
  await trackLongTasks();
  t = await page.evaluate(async () => {
    const t0 = performance.now();
    document.querySelector('[data-flag="pick"]').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  });
  check(t < 400 * SLOW, `filter to picks in ${Math.round(t)} ms`);
  await page.click('[data-flag="all"]');
  await page.click('.cull-tile >> nth=0');
  await page.waitForSelector('.viewer');
  await trackLongTasks();
  t = await page.evaluate(async () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: String((i % 5) + 1), bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return (performance.now() - t0) / 20;
  });
  check(t < 60 * SLOW, `rating + next photo takes ${Math.round(t)} ms per photo`);
  freeze = await worstFreeze();
  check(freeze < 200 * SLOW, `no long freeze while culling (worst ${freeze} ms)`);
  await page.keyboard.press('Escape');

  // 7. Photo stats + import page summary
  t = Date.now();
  await page.goto(BASE + '?nosw#/photo/stats/pm');
  await page.waitForSelector('#view h1');
  check(Date.now() - t < 2000 * SLOW, `photo stats with 3,000 photos in ${Date.now() - t} ms`);

  // 8. Start menu
  t = Date.now();
  await page.goto(BASE + '?nosw#/');
  await page.waitForSelector('#view a[href^="#/"]');
  check(Date.now() - t < 2000 * SLOW, `start menu in ${Date.now() - t} ms`);

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll speed checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
