// v3 phase 9: Records search (filters, plain English, saved searches, export), Settings inside
// Administration, Casework links and document attachments (no pictures), PDF and accessibility.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startWorld, launch, openHQ, hqApi, check, finish, go } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  await openHQ(page, world);
  const api = hqApi(page);
  await page.evaluate(() => {
    const hq = window.__hq.hq, now = Date.now(), H = 3600000;
    hq.logEvent({ ts: now - 30 * H, kind: 'door', message: 'AGENT-01 WREN: Kitchen door opened' });
    hq.logEvent({ ts: now - 2 * H, kind: 'perimeter', level: 'warn', message: 'Person detected (front / driveway)', data: { class: 'person', zone: 'front' } });
    hq.logEvent({ ts: now - H, kind: 'motion', message: 'AGENT-02 OWL: Motion detected (12% of view)' });
  });

  // ---------- Records › Search ----------
  await go(page, 'logsearch');
  await page.waitForSelector('[data-rrows] tr');
  await page.fill('[data-rform] [name=text]', 'kitchen');
  await page.click('[data-rform] .btn-primary');
  await page.waitForFunction(() => /^1 event/.test(document.querySelector('[data-rcount]').textContent));
  check((await page.textContent('[data-rrows]')).includes('Kitchen door opened'), 'search by words finds the kitchen door');
  await page.fill('[data-rplain] input', 'people at the front today');
  await page.click('[data-rplain] button');
  await page.waitForFunction(() => /Person detected/.test(document.querySelector('[data-rrows]').textContent) && /^1 event/.test(document.querySelector('[data-rcount]').textContent));
  check(await page.inputValue('[data-rform] [name=zone]') === 'front', 'plain English fills in the filters (Where: Front)');
  page.once('dialog', (d) => d.accept('Front-door people'));
  await page.click('[data-rsave]');
  await page.waitForSelector('[data-rload]');
  check((await page.textContent('[data-rsaved]')).includes('Front-door people'), 'search saved by name');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-rexport="csv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check(/^time,reference,kind,level,message\n/.test(csv) && csv.includes('Person detected'), 'results export as CSV');
  await page.fill('[data-rform] [name=text]', '');
  await page.selectOption('[data-rform] [name=zone]', '');
  await page.click('[data-rform] .btn-primary');
  await page.click('[data-rload]');
  await page.waitForFunction(() => document.querySelector('[data-rform] [name=zone]').value === 'front');
  check(true, 'a saved search loads back with one click');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hq-records-search.png') });

  // ---------- Administration › Settings ----------
  await go(page, 'settings');
  await page.waitForSelector('[data-adminsettings] [data-tab="general"]');
  check(await page.isVisible('[data-adminsettings] [data-tab="alerts"]') && await page.isVisible('[data-adminsettings] [data-goto-data]'), 'Settings live inside Administration (with the encrypted-backup pointer)');
  await page.click('[data-adminsettings] [data-tab="phones"]');
  await page.waitForSelector('[data-adminsettings] [data-linkwall]');
  check(true, 'Settings tabs work inline (Phones and Wall Display)');

  // ---------- Casework: links and attachments ----------
  const a = await api('POST', '/incidents', { title: 'Shed break-in' });
  const b = await api('POST', '/incidents', { title: 'Van seen twice' });
  await page.evaluate((id) => { window.__go('incidents'); }, a.id);
  await page.click(`[data-iopen="${a.id}"]`);
  await page.waitForSelector('[data-ilink]');
  await page.fill('[data-ilink] [name=ref]', 'Police CAD 4512');
  await page.fill('[data-ilink] [name=label]', 'Reported to police');
  await page.click('[data-ilink] button');
  await page.waitForFunction(() => /Police CAD 4512/.test(document.querySelector('.case-links').textContent));
  await page.selectOption('[data-ilink] [name=kind]', 'incident');
  await page.fill('[data-ilink] [name=ref]', b.ref);
  await page.click('[data-ilink] button');
  await page.waitForSelector(`.case-links [data-iopen="${b.id}"]`);
  check(true, `links: an outside reference and another incident (${b.ref})`);
  const pdf = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF';
  await page.setInputFiles('[data-iattach]', { name: 'police-report.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
  await page.waitForSelector('[data-iatt]');
  check((await page.textContent('.case')).includes('police-report.pdf'), 'a PDF document can be attached');
  await page.setInputFiles('[data-iattach]', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
  await page.waitForTimeout(500);
  check(!(await page.textContent('.case')).includes('photo.jpg'), 'a photo is refused (SENTINEL never stores pictures)');
  const sheetTitle = await page.evaluate(() => document.querySelector('.sheet-backdrop h2')?.textContent || '');
  if (sheetTitle) { console.log('(closing a sheet that opened by itself:', sheetTitle, ')'); await page.keyboard.press('Escape'); }
  const [att] = await Promise.all([page.waitForEvent('download'), page.click('[data-iatt]')]);
  check(fs.readFileSync(await att.path(), 'utf8') === pdf, 'the attachment downloads exactly as uploaded');
  const tl = await page.textContent('.timeline');
  check(/Linked outside reference Police CAD 4512/.test(tl) && /Attached “police-report.pdf”/.test(tl), 'links and attachments are written in the case timeline');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hq-casework.png') });

  await finish(browser, world, errors, 'records');
})().catch((e) => { console.error(e); process.exit(1); });
