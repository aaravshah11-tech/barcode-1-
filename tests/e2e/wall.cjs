// v3 phase 8: the WALL DISPLAY — QR setup in Settings, read-only link with no sign-in, rotating screens,
// stays on Situation while an Alert is waiting, and HQ refuses anything that would change something.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, hqApi, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  await openHQ(page, world);
  const api = hqApi(page);

  // Settings › Phones › Wall Display → a QR code to the wall page
  await page.click('[data-settings]');
  await page.click('[data-tab="phones"]');
  await page.click('[data-linkwall]');
  await page.waitForSelector('[data-wallbox] [data-qr] svg');
  const link = await page.getAttribute('[data-wallbox] [data-qr]', 'data-link');
  check(/\/hq\/wall\.html#hq=sntl-[a-z0-9]{8}&pair=[A-Z0-9]{6}/.test(link), 'QR code links to the Wall Display page with a one-time code');
  check(/Guided Access/.test(await page.textContent('[data-wallbox]')) && /Auto-Lock/.test(await page.textContent('[data-wallbox]')), 'step-by-step: Home Screen, Auto-Lock Never, Guided Access');
  await page.keyboard.press('Escape');

  const ipad = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true })).newPage();
  ipad.on('pageerror', (e) => errors.push(`[wall] ${e.message}`));
  await ipad.goto(link.replace('wall.html#', 'wall.html?rotate=8#'));
  await ipad.fill('[data-wpair] input', 'Kitchen iPad');
  await ipad.click('[data-wpair] button');
  await ipad.waitForSelector('[data-wbody][data-screen]', { timeout: 20000 });
  check(true, 'linked: no codename or PIN needed');
  check((await ipad.textContent('.cbanner.top')).includes('WALL DISPLAY – READ ONLY'), 'classification bar: … // WALL DISPLAY – READ ONLY');
  check(new URL(ipad.url()).hash === '', 'the one-time code is removed from the address bar');
  check(/Wall Display “Kitchen iPad” linked \(read-only\)/.test(JSON.stringify(await api('GET', '/log?kind=system&limit=20'))), 'HQ logs the new Wall Display');
  const viewers = (await api('GET', '/state')).viewers || [];
  const st = await ipad.evaluate(() => window.__wall.W.state);
  check(!st.info && !st.messages, 'the display never receives HQ’s codes or messages');
  const first = await ipad.evaluate(() => window.__wall.screen);
  await ipad.waitForFunction((f) => window.__wall.screen !== f, first, { timeout: 15000 });
  check(true, `rotates: ${first} → ${await ipad.evaluate(() => window.__wall.screen)}`);
  if (SHOTS) { await ipad.evaluate(() => { document.querySelector('.wall').click(); }); }

  // read-only
  const r1 = await ipad.evaluate(() => window.__wall.raw({ t: 'api', method: 'PATCH', path: '/settings', body: { mode: 'away' } }));
  const r2 = await ipad.evaluate(() => window.__wall.raw({ t: 'api', method: 'GET', path: '/export?format=json' }));
  const r3 = await ipad.evaluate(() => window.__wall.raw({ t: 'api', method: 'POST', path: '/alerts/ALT-000001/acknowledge', body: {} }));
  check(!r1.ok && !r2.ok && !r3.ok && /read-only/.test(r1.error), 'HQ refuses changes and exports from the Wall Display');
  check((await api('GET', '/state')).settings.mode === 'home', 'nothing changed');
  const per = await ipad.evaluate(() => window.__wall.api('/perimeter'));
  check(Array.isArray(per.zones), 'it can read the perimeter view');

  // an Alert pins the Situation screen
  await page.evaluate(() => window.__hq.hq.ops.raise({ severity: 'ALERT', title: 'Back door opened', kind: 'door' }));
  await ipad.waitForFunction(() => window.__wall.screen === 'situation' && /Back door opened/.test(document.querySelector('.wall-urgent')?.textContent || ''), null, { timeout: 15000 });
  await ipad.waitForTimeout(9000);
  check(await ipad.evaluate(() => window.__wall.screen) === 'situation', 'an unhandled Alert keeps it on Situation with a banner');
  if (SHOTS) await ipad.screenshot({ path: path.join(SHOTS, 'wall-situation.png') });
  const id = (await api('GET', '/alerts'))[0].id;
  await api('POST', `/alerts/${id}/acknowledge`, {});
  await ipad.waitForFunction(() => !document.querySelector('.wall-urgent'), null, { timeout: 15000 });
  check(true, 'acknowledged on HQ → the banner goes and rotation resumes');
  await ipad.waitForFunction(() => window.__wall.screen === 'perimeter' || window.__wall.screen === 'agents' || window.__wall.screen === 'timeline', null, { timeout: 30000 });
  if (SHOTS) await ipad.screenshot({ path: path.join(SHOTS, `wall-${await ipad.evaluate(() => window.__wall.screen)}.png`) });

  // removing it at HQ cuts it off
  const wall = (await page.evaluate(() => window.__hq.hq.viewers())).find((v) => v.wall);
  await api('DELETE', `/viewers/${wall.id}`);
  await ipad.reload();
  await ipad.waitForSelector('.wall-pair', { timeout: 30000 });
  check(/isn’t linked/.test(await ipad.textContent('.wall-pair')), 'unlinked at HQ → the display shows it isn’t linked');

  await finish(browser, world, errors, 'wall');
})().catch((e) => { console.error(e); process.exit(1); });
