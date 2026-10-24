// Inventory tool browser test (product databases mocked).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const SHOTS = process.argv[2] || '';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const png = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-192.png'));
  await ctx.route(/openfoodfacts\.org/, (r) => r.fulfill({ contentType: 'application/json', body: r.request().url().includes('3017620422003')
    ? JSON.stringify({ status: 1, product: { product_name: 'Nutella', brands: 'Ferrero,Nutella', quantity: '400 g', image_front_small_url: 'https://images.openfoodfacts.org/n.jpg' } })
    : JSON.stringify({ status: 0 }) }));
  await ctx.route(/upcitemdb\.com/, (r) => r.fulfill({ contentType: 'application/json', body: r.request().url().includes('0885909950805')
    ? JSON.stringify({ code: 'OK', items: [{ title: 'Apple USB-C Charger 20W', brand: 'Apple', category: 'Electronics > Chargers', images: ['https://img.example/c.jpg'], lowest_recorded_price: 19 }] })
    : JSON.stringify({ code: 'OK', items: [] }) }));
  await ctx.route(/images\.openfoodfacts|img\.example/, (r) => r.fulfill({ contentType: 'image/png', body: png }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/camera|Failed to load/i.test(m.text())) errors.push(m.text()); });
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, n + '.png') });

  await page.goto(BASE + '?nosw#/inventory');
  await page.waitForSelector('text=Nothing here yet');
  check(true, 'empty inventory message');

  // Food barcode (Open Food Facts)
  await page.goto(BASE + '?nosw#/inventory/add');
  await page.fill('[data-manual] input', '3017620422003');
  await page.click('[data-manual] button');
  await page.waitForSelector('.item-form');
  check((await page.inputValue('.item-form input[name=name]')) === 'Nutella 400 g', 'Open Food Facts lookup filled the name');
  check(await page.isVisible('.item-form [data-cat] [aria-pressed=true] >> text=Food & drink'), 'category guessed: Food & drink');
  // New cupboard with boxes
  await page.click('.item-form [data-room]');
  await page.click('.item-form [data-add-area]');
  await page.click('.choice-grid button:has-text("Boxes / storage")');
  await page.fill('.sheet.dialog input', 'Hall cupboard');
  await page.click('.sheet.dialog button.btn-primary');
  await page.waitForSelector('.item-form [data-add-spot]');
  await page.click('.item-form [data-add-spot]');
  await page.click('.sheet.dialog button.btn-primary'); // accepts "Box 1"
  await page.waitForSelector('.item-form [data-spot] >> text=Box 1');
  await page.fill('.item-form input[name=value]', '3.5');
  if (SHOTS) await page.waitForTimeout(200), await shot('inv-01-form');
  await page.click('.item-form button.btn-primary');
  await page.waitForSelector('.toast >> text=Added Nutella');
  check(true, 'saved to Living room › Hall cupboard › Box 1');

  // Electronics barcode (UPCitemdb) -> remembers last location
  await page.fill('[data-manual] input', '0885909950805');
  await page.click('[data-manual] button');
  await page.waitForSelector('.item-form');
  check((await page.inputValue('.item-form input[name=name]')) === 'Apple USB-C Charger 20W', 'UPCitemdb lookup filled the name');
  check(await page.isVisible('.item-form [data-spot][aria-pressed=true] >> text=Box 1'), 'last location remembered');
  await page.click('.item-form button.btn-primary');
  await page.waitForSelector('.toast >> text=Added Apple');

  // Unknown barcode -> manual
  await page.fill('[data-manual] input', '5012345678900');
  await page.click('[data-manual] button');
  await page.waitForSelector('text=isn’t in the free product databases');
  check(true, 'unknown barcode -> add by hand message');
  await page.click('.sheet [data-close].btn');

  // Photo + name
  await page.click('[data-photo]');
  await page.setInputFiles('.item-form input[data-photo][capture]', { name: 'drill.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.item-form [data-photo-preview] img');
  await page.fill('.item-form input[name=name]', 'Cordless drill');
  await page.click('.item-form [data-cat] >> text=Tools');
  await page.fill('.item-form input[name=lentTo]', 'Uncle Raj');
  await page.click('.item-form button.btn-primary');
  await page.waitForSelector('.toast >> text=Added Cordless drill');
  check(true, 'photo + name item saved (lent to Uncle Raj)');

  // Duplicate barcode -> +1
  await page.fill('[data-manual] input', '3017620422003');
  await page.click('[data-manual] button');
  await page.waitForSelector('text=Already in your inventory');
  await page.click('.sheet [data-more]');
  await page.waitForSelector('.toast >> text=now 2');
  check(true, 'duplicate scan offers +1 quantity');

  // Label QR -> contents
  const place = await page.evaluate(async () => {
    const s = await import('./js/core/store.js'); const L = await import('./js/core/locations.js');
    const n = s.all('items').find((i) => i.name.startsWith('Nutella'));
    return L.labelUrl(n.location);
  });
  await page.fill('[data-manual] input', place);
  await page.click('[data-manual] button');
  await page.waitForSelector('h1 >> text=Box 1');
  const inside = await page.textContent('#view');
  check(inside.includes('Nutella') && inside.includes('Apple USB-C') && inside.includes('3 items inside'), 'scanning a box label shows what’s inside');
  await shot('inv-02-place');

  // List, search, filters
  await page.goto(BASE + '?nosw#/inventory');
  await page.waitForSelector('.rows .row');
  check((await page.$$('.rows .row')).length === 3, 'list shows 3 items');
  check(/worth about/.test(await page.textContent('[data-count]')), 'total value shown');
  await page.fill('[data-q]', 'drill');
  await page.waitForTimeout(250);
  check((await page.$$('.rows .row')).length === 1, 'search');
  await page.fill('[data-q]', '');
  await page.click('[data-filters]');
  await page.selectOption('.sheet select[name=lent]', 'yes');
  await page.click('.sheet button.btn-primary');
  await page.waitForTimeout(200);
  check((await page.$$('.rows .row')).length === 1, 'lent-out filter');
  await shot('inv-03-list');
  await page.click('[data-clear=lent]');

  // Labels page
  await page.goto(BASE + '?nosw#/inventory/labels');
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  const boxPick = await page.$$('[data-pick]');
  await boxPick[boxPick.length - 1].check();
  await page.click('[data-print]');
  await page.waitForFunction(() => window.__printed);
  check((await page.$$('.qr-label svg')).length === 1 && (await page.textContent('.qr-label')).includes('Nutella'), 'printable QR label with contents list');

  // Places
  await page.goto(BASE + '?nosw#/inventory/places');
  await page.waitForSelector('.room-card');
  check((await page.textContent('#view')).includes('Hall cupboard'), 'places page');

  // CSV
  await page.goto(BASE + '?nosw#/settings/backup');
  await page.waitForSelector('[data-csv="inventory|0"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-csv="inventory|0"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check(csv.includes('Nutella 400 g,Ferrero,Food & drink,2,3.5,Living room,Hall cupboard,Box 1'), 'inventory CSV');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll inventory checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
