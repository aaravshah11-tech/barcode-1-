// LIVE VIEW: HQ sees what an Agent's camera sees, only while the window is open; the Agent shows a red banner.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, hqApi, check, finish } = require('./helpers.cjs');
const video = require('./video.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium, [`--use-file-for-fake-video-capture=${video.moving()}`]);
  const errors = [];
  const dash = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  dash.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  await openHQ(dash, world);
  const cam = await recruit(dash, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);
  cam.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  await hqApi(dash)('PATCH', `/agents/${cam.id}`, { mission: 'motion' });
  await cam.p.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('MOTION WATCH'));

  await dash.click('.agent');
  await dash.click('[data-liveview]');
  await dash.waitForFunction(() => document.querySelector('[data-liveimg]')?.src.startsWith('data:image/jpeg'), null, { timeout: 20000 })
    .catch(async (e) => { console.log('errors:', errors); console.log('debug:', await dash.evaluate(() => [document.querySelector('[data-livewait]')?.textContent, document.querySelectorAll('.sheet').length, document.querySelector('[data-liveimg]')?.src.slice(0, 40)]), await cam.p.evaluate(() => document.querySelector('[data-banner]').textContent)); throw e; });
  check(true, 'Live view shows the Agent’s camera picture at HQ');
  await cam.p.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('LIVE VIEW – HQ IS WATCHING'));
  check(true, 'the Agent shows a red “LIVE VIEW – HQ IS WATCHING THIS CAMERA” banner');
  const a = await dash.evaluate(() => document.querySelector('[data-liveimg]').src);
  await dash.waitForTimeout(1500);
  const b = await dash.evaluate(() => document.querySelector('[data-liveimg]').src);
  check(a !== b, 'the picture keeps updating');
  check((await dash.textContent('[data-log]')).includes('Live view opened'), 'opening Live view is written in the Mission Log');
  check(!JSON.stringify(await dash.evaluate(() => window.__hq.db.allEvents())).includes('data:image'), 'no pictures are saved at HQ');
  if (SHOTS) { await dash.screenshot({ path: path.join(SHOTS, 'hq-live.png') }); await cam.p.screenshot({ path: path.join(SHOTS, 'agent-live.png') }); }
  await dash.keyboard.press('Escape');
  await cam.p.waitForFunction(() => !document.querySelector('[data-banner]').textContent.includes('LIVE VIEW'), null, { timeout: 10000 });
  check(true, 'closing Live view stops it: the banner goes back to normal');
  await dash.keyboard.press('Escape');

  // Live view also works on an Agent whose mission doesn't use the camera (STANDBY)
  await hqApi(dash)('PATCH', `/agents/${cam.id}`, { mission: 'standby' });
  await dash.click('.agent');
  await dash.click('[data-liveview]');
  await dash.waitForFunction(() => document.querySelector('[data-liveimg]')?.src.startsWith('data:image/jpeg'), null, { timeout: 20000 });
  check(true, 'Live view on a STANDBY Agent opens the camera just for the view');
  await dash.keyboard.press('Escape');

  await finish(browser, world, errors, 'live view');
})().catch((e) => { console.error(e); process.exit(1); });
