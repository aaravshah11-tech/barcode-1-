// Redesign part 8: DATA + RESILIENCE — encryption at rest, backups with test restore, retention,
// evidence export + verification, downtime record, phone "HQ unreachable" warning, What's new.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { startWorld, launch, openHQ, login, hqApi, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const api = hqApi(page);
  const downloads = [];
  page.on('download', async (d) => downloads.push({ name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), 'utf8') }));

  // What's new
  await page.click('[data-settings]');
  await page.click('[data-tab="changes"]');
  await page.waitForSelector('.changelog');
  const cl = await page.textContent('.changelog');
  check(cl.includes('3.8.0') && cl.includes('Data and resilience') && cl.includes('Access control') && cl.includes('Professional redesign'), 'Settings › What’s new lists every update, newest first');
  await shot('whats-new');
  await page.keyboard.press('Escape');

  // Encryption
  await page.evaluate(() => window.__hq.hq.logEvent({ kind: 'system', message: 'PRIVATE-MARKER-42' }));
  await page.evaluate(() => window.__hq.db.flush());
  const raw = await page.evaluate(async () => { const rows = await new Promise((r) => { const q = indexedDB.open('sentinel-hq'); q.onsuccess = () => { const t = q.result.transaction('events').objectStore('events').getAll(); t.onsuccess = () => r(t.result); }; }); return JSON.stringify(rows) + localStorage.getItem('sentinel.hq.v1'); });
  check(!raw.includes('PRIVATE-MARKER-42') && !raw.includes('TESTER'), 'what HQ stores in the browser is encrypted (no readable text on disk)');
  await page.click('.rail [data-view="data"]');
  await page.waitForSelector('.data-grid');
  check((await page.textContent('.data-grid')).includes('Encrypted at rest'), 'Data screen: “Encrypted at rest — AES-256-GCM”');

  // Backups
  await page.click('[data-dbackup]');
  await page.waitForSelector('[data-bk] >> text=Passed');
  check(true, 'Back up now → the backup is test-restored straight away (Passed)');
  await page.click('[data-ddownload]');
  await page.fill('[data-pw] [name=pw]', 'a long backup password');
  await page.click('[data-pw] .btn-primary');
  await page.waitForFunction(() => document.body.textContent.includes('Encrypted backup downloaded'));
  await page.waitForTimeout(400);
  const bk = downloads.find((d) => d.name.endsWith('.sentinel-backup'));
  check(bk && bk.text.includes('hq-backup-encrypted') && !bk.text.includes('PRIVATE-MARKER-42'), 'download an encrypted backup file (sealed with your password)');
  await shot('data');

  // Restore a local backup: something added after the backup disappears again
  await page.evaluate(() => window.__hq.hq.logEvent({ kind: 'system', message: 'AFTER-BACKUP' }));
  await page.click('[data-bk] [data-drestore]');
  await page.click('.sheet [data-ok]');
  await page.waitForEvent('load', { timeout: 15000 });
  await login(page);
  await page.waitForSelector('[data-threat]');
  const evs = await page.evaluate(() => window.__hq.db.allEvents().map((e) => e.message));
  check(evs.includes('PRIVATE-MARKER-42') && !evs.includes('AFTER-BACKUP'), 'Restore puts HQ back exactly as it was at the backup');
  check(await page.evaluate(() => window.__hq.db.allAudit().some((a) => a.action === 'Backup restored')), 'the restore is written in the audit log');

  // Retention
  await page.click('.rail [data-view="data"]');
  await page.waitForSelector('[data-dret]');
  await page.fill('[data-dret] [name=alerts]', '60');
  await page.click('[data-dret] .btn-primary');
  await page.waitForSelector('text=Retention saved');
  check((await api('GET', '/data/status')).retention.alerts === 60, 'retention rules saved');

  // Evidence
  const inc = await api('POST', '/incidents', { title: 'Side gate open at night' });
  await page.click('.rail [data-view="incidents"]');
  await page.waitForSelector('[data-ievidence]');
  await page.click('[data-ievidence]');
  await page.waitForFunction(() => document.body.textContent.includes('Evidence exported'));
  await page.waitForTimeout(400);
  const evd = downloads.find((d) => d.name === `${inc.ref}-evidence.json`);
  check(evd && downloads.some((d) => d.name === `${inc.ref}-evidence.json.sha256`), `Export evidence → ${inc.ref}-evidence.json + .sha256`);
  await page.click('.rail [data-view="data"]');
  await page.waitForSelector('[data-dverifyfile]', { state: 'attached' });
  const tmp = path.join(require('os').tmpdir(), `ev-${Date.now()}.json`);
  fs.writeFileSync(tmp, evd.text);
  await page.setInputFiles('[data-dverifyfile]', tmp);
  await page.waitForSelector('[data-dverifyout] .verify.ok');
  check((await page.textContent('[data-dverifyout]')).includes('audit log recorded this exact fingerprint'), 'evidence check: unchanged, and matches the audit log');
  const bad = JSON.parse(evd.text); bad.content.incident.title = 'Nothing happened';
  fs.writeFileSync(tmp, JSON.stringify(bad));
  await page.setInputFiles('[data-dverifyfile]', tmp);
  await page.waitForSelector('[data-dverifyout] .verify.bad');
  check(true, 'an edited evidence file is caught');

  // Downtime record
  await page.evaluate(() => window.__hq.hq.resilience.watchdog({ kind: 'sleep', ms: 40 * 60000 }));
  await page.click('.rail [data-view="ops"]'); await page.click('.rail [data-view="data"]');
  await page.waitForSelector('.data-grid >> text=asleep');
  check(true, 'gaps when HQ wasn’t running are recorded (computer asleep)');

  // Phone: HQ unreachable warning
  const { code } = await api('POST', '/pair', { role: 'viewer' });
  const hqId = (await api('GET', '/state')).info.hqId;
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  phone.on('pageerror', (e) => errors.push(`[phone] ${e.message}`));
  await phone.goto(`${world.remoteUrl}#hq=${hqId}&link=${code}`);
  await phone.fill('[data-link] [name=label]', 'My phone');
  await phone.click('[data-link] button');
  await phone.waitForSelector('[data-login]', { timeout: 20000 });
  await phone.fill('[name=codename]', 'tester'); await phone.fill('[name=pin]', '2468');
  await phone.click('[data-login] button');
  await phone.waitForSelector('[data-threat]', { timeout: 20000 });
  await page.close();
  await phone.waitForSelector('.hq-down', { timeout: 150000 });
  check((await phone.textContent('.hq-down')).includes('HQ UNREACHABLE since'), 'phone: “HQ UNREACHABLE since …” when the HQ computer goes away');
  if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'phone-hq-down.png') });

  await finish(browser, world, errors, 'data');
})().catch((e) => { console.error(e); process.exit(1); });
