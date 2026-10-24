// Match Photography browser test using sample JPEGs with EXIF (tests/fixtures/photos, see make-photo-fixtures.py).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const SHOTS = process.argv[2] || '';
const DIR = path.join(__dirname, 'fixtures', 'photos');
const T = { shownMs: 1792850400000, tryMs: 1792854600000, kickMs: 1792854750000 };
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: 'UTC', acceptDownloads: true });
  await ctx.route(/geocoding-api\.open-meteo/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Bristol', admin1: 'England', country_code: 'GB', latitude: 51.45, longitude: -2.58 }] }) }));
  await ctx.route(/\/\/api\.open-meteo\.com/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ timezone: 'Europe/London', daily: { sunrise: ['2026-10-24T07:46'], sunset: ['2026-10-24T17:58'] } }) }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, n + '.png') });

  await page.goto(BASE + '?nosw#/');
  await page.waitForSelector('.menu-grid');
  await page.evaluate(async (T) => {
    const s = await import('./js/core/store.js');
    await s.put('teams', { id: 'rug', name: 'Frontage 1st XV', sport: 'rugby', mine: true });
    await s.put('players', { id: 'p11', name: 'Jo Brown', teamIds: ['rug'], numbers: { rug: 11 } });
    await s.put('matches', { id: 'm1', sport: 'rugby', teamId: 'rug', oppName: 'Riverside RFC', title: 'Frontage 1st XV v Riverside RFC', date: '2026-10-24', status: 'done', format: { periods: 2, periodMins: 40 }, clock: { period: 2, elapsedMs: 0 } });
    await s.put('photoTags', { id: 'tg1', matchId: 'm1', t: T.tryMs, type: 'try', number: '11', matchMs: null });
    await s.put('photoTags', { id: 'tg2', matchId: 'm1', t: T.kickMs, type: 'kick', number: '10', matchMs: null });
    await s.put('events', { id: 'ev1', matchId: 'm1', sport: 'rugby', t: T.kickMs + 300000, period: 2, clockMs: 600000, type: 'lineout_won', side: 'us' });
  }, T);

  // ---- Import ----
  await page.goto(BASE + '?nosw#/photo/import/m1');
  await page.waitForSelector('input[data-input]:not([webkitdirectory])', { state: 'attached' });
  await page.setInputFiles('input[data-input]:not([webkitdirectory])', fs.readdirSync(DIR).map((f) => path.join(DIR, f)));
  await page.waitForSelector('text=Synced!', { timeout: 30000 });
  const clockText = await page.textContent('#view');
  check(/1m 2[34]s fast/.test(clockText) && clockText.includes('IMG_0001.JPG'), 'clock photo found automatically; camera 1m 23.5s fast');
  const groups = await page.$$eval('.list .list-item', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check(groups.some((g) => /Try – #11 – 15:10:00\s*3$/.test(g)), 'try burst + celebration (3 photos) sorted into “Try – #11 – 15:10:00”');
  check(groups.some((g) => /Kick – #10 – 15:12:30\s*1$/.test(g)), 'kick photo sorted');
  check(groups.some((g) => /Not near any moment\s*2$/.test(g)) && groups.some((g) => /No time info.*\s*1$/.test(g)), 'clock + random photo unsorted; no-EXIF photo flagged');
  await shot(page, 'photo-import');

  // Window change re-sorts
  await page.$eval('[data-window]', (el) => { el.value = '2'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => [...document.querySelectorAll('.list .list-item')].some((e) => /Try – #11 – 15:10:00\s*1$/.test(e.textContent.replace(/\s+/g, ' ').trim())));
  check(true, 'narrower ±2 s window leaves only the celebration photo (burst was 2.7–3 s early)');
  await page.$eval('[data-window]', (el) => { el.value = '15'; el.dispatchEvent(new Event('change', { bubbles: true })); });

  // ---- Cull ----
  await page.goto(BASE + '?nosw#/photo/cull/m1');
  await page.waitForSelector('.cull-groups');
  await page.click('.cull-groups button:has-text("Try")');
  await page.waitForSelector('.cull-tile img[src]');
  check((await page.$$('.cull-tile')).length === 3, 'try group shows 3 thumbnails');
  await page.click('.cull-tile >> nth=0');
  await page.waitForSelector('.viewer img[src]');
  await page.keyboard.press('4');
  await page.keyboard.press('p');   // pick + auto-advance
  await page.keyboard.press('x');   // reject 2nd
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('c');   // compare mode
  await page.waitForSelector('.v-stage.two');
  await shot(page, 'photo-viewer');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const st = await page.evaluate(async () => { const s = await import('./js/core/store.js'); return Object.fromEntries(s.all('photos').map((p) => [p.name, [p.rating, p.flag, p.momentType]])); });
  check(JSON.stringify(st['IMG_0101.JPG']) === '[4,"pick","try"]' && st['IMG_0102.JPG'][1] === 'reject', 'keyboard: 4★ + pick on first, reject on second');
  await shot(page, 'photo-cull');

  // ---- Export (into the browser's private folder instead of a real picker) ----
  await page.goto(BASE + '?nosw#/photo/export/m1');
  await page.evaluate(() => { window.showDirectoryPicker = async () => navigator.storage.getDirectory(); });
  await page.waitForSelector('[data-go]');
  await page.click('[data-go]');
  await page.waitForSelector('text=Done:', { timeout: 15000 });
  const tree = await page.evaluate(async () => {
    const out = [];
    const walk = async (d, p) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out.push(p + n); } };
    await walk(await navigator.storage.getDirectory(), '');
    const root = await navigator.storage.getDirectory();
    const top = (await root.entries().next()).value[1];
    const folder = await top.getDirectoryHandle('01 Try - #11 - 15-10-00');
    const xmp = await (await (await folder.getFileHandle('IMG_0101.xmp')).getFile()).text();
    const csv = await (await (await top.getFileHandle('captions.csv')).getFile()).text();
    return { out: out.sort(), xmp, csv };
  });
  check(tree.out.includes('2026-10-24 Frontage 1st XV v Riverside RFC/01 Try - #11 - 15-10-00/IMG_0101.JPG'), 'pick copied into “01 Try - #11 - 15-10-00” folder');
  check(/xmp:Rating="4"/.test(tree.xmp) && tree.xmp.includes('<rdf:li>#11</rdf:li>') && tree.xmp.includes('Jo Brown') === false, 'XMP sidecar with rating + keywords');
  check(tree.csv.includes('Frontage 1st XV v Riverside RFC – Try by #11'), 'captions.csv written');

  // ---- Phone: clock screen, then "photograph" it and read it back ----
  const phone = await ctx.newPage(); // same browser profile, so it sees the match
  await phone.setViewportSize({ width: 390, height: 844 });
  phone.on('pageerror', (e) => errors.push('[phone] ' + e.message));
  await phone.goto(BASE + '?nosw#/photo/clock');
  await phone.waitForSelector('.sc-qr svg');
  const before = Date.now();
  const png = await phone.screenshot();
  await shot(phone, 'photo-clock');
  const decoded = await page.evaluate(async (b64) => {
    const files = await import('./js/tools/photo/files.js');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return files.decodeQr(new File([bytes], 'screen.png', { type: 'image/png' }));
  }, png.toString('base64'));
  const ms = Number((decoded || '').replace('HBCLK:', ''));
  check(Math.abs(ms - before) < 1500, `QR on the clock screen decodes from a photo of it (${decoded})`);

  // Tagging pad
  await phone.goto(BASE + '?nosw#/photo/tag/m1');
  await phone.waitForSelector('.tag-pad');
  await phone.click('.num:text-is("7")');
  await phone.click('[data-tag="tackle"]');
  await phone.waitForSelector('.toast >> text=Big tackle – #7');
  check(true, 'tag pad: number + moment tagged');
  await shot(phone, 'photo-tag');
  // Positions
  await phone.goto(BASE + '?nosw#/photo/positions/m1');
  await phone.click('[data-spot="posts"]');
  await phone.click('[data-here]');
  await phone.waitForSelector('.list-item >> text=Behind the posts');
  check(true, 'position logged');
  // Settings card + sunset
  await phone.goto(BASE + '?nosw#/photo/settings/m1');
  await phone.fill('[data-place]', 'Bristol');
  await phone.fill('[data-kick]', '15:00');
  await phone.dispatchEvent('[data-kick]', 'change');
  await phone.click('[data-sun]');
  await phone.waitForSelector('.sunset b');
  check((await phone.textContent('.sunset b')) === '17:58', 'sunset time from Open-Meteo');
  await shot(phone, 'photo-settings');

  // Stats
  await page.goto(BASE + '?nosw#/photo/stats');
  await page.waitForSelector('.stat-grid');
  check((await page.textContent('#view')).includes('Moments you keep missing'), 'photo stats page');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll photography checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
