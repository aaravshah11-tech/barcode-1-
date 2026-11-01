// v3 phase 4: the Agent screen (OLED standby, Identify, last reports, HQ-offline standby), PERIMETER WATCH
// with mandatory privacy masks, and the fleet registry (health, bulk actions).
const { chromium } = require('playwright');
const path = require('path');
const helpers = require('./helpers.cjs');
const { startWorld, openHQ, hqApi, check, finish, login, go } = helpers;
const video = require('./video.cjs');
const SHOTS = process.argv[2] || '';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

(async () => {
  const world = await startWorld();
  const errors = [];
  const browser = await helpers.launch(chromium, [`--use-file-for-fake-video-capture=${video.moving()}`]);
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  const dashCtx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const dash = await dashCtx.newPage();
  dash.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  await openHQ(dash, world);
  const call = hqApi(dash);

  // the Agent gets a stand-in recogniser that "sees" a person (the real one is the bundled COCO-SSD model)
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(() => {
    window.__sentinelDetector = { detect: async () => [{ class: 'person', score: 0.91, bbox: [150, 90, 40, 90] }] };
  });
  const ag = await helpers.recruit(dash, ctx, world);
  ag.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  const banner = () => ag.p.textContent('[data-banner]');

  // ---------- the Agent screen ----------
  await ag.p.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('SENTINEL AGENT ACTIVE – STANDBY'));
  check(await ag.p.isVisible('[data-recent]') && await ag.p.isVisible('[data-identify]'), 'wake view: last reports list and an Identify button');
  await ag.p.click('[data-identify]');
  await ag.p.waitForSelector('[data-find]:not([hidden])');
  check(/AGENT-\d+ · /.test(await ag.p.textContent('[data-find]')), 'Identify shows the Agent’s reference and codename big on screen');
  await ag.p.click('[data-find]');
  await ag.p.evaluate(() => window.__agent.sleep());
  await ag.p.waitForSelector('[data-dim]:not([hidden])');
  const oled = await ag.p.evaluate(() => ({ bg: getComputedStyle(document.querySelector('[data-dim]')).backgroundColor, code: document.querySelector('[data-ocode]').textContent, mission: document.querySelector('[data-omission]').textContent, clock: document.querySelector('[data-oclock]').textContent }));
  check(oled.bg === 'rgb(0, 0, 0)' && oled.code && oled.mission === 'STANDBY' && /\d\d:\d\d/.test(oled.clock), 'OLED standby: black screen with codename, mission and clock');
  check(await ag.p.isVisible('[data-banner]') && (await banner()).includes('SENTINEL AGENT ACTIVE'), 'the SENTINEL AGENT ACTIVE banner stays on top in standby');
  await shot(ag.p, 'agent-oled-standby');
  await ag.p.click('[data-dim]');
  check(await ag.p.isHidden('[data-dim]'), 'tap to wake');

  // ---------- PERIMETER WATCH: can't be armed without confirmed privacy masks ----------
  await call('PATCH', `/agents/${ag.id}`, { mission: 'perimeter', settings: { masksConfirmed: true } });
  await ag.p.waitForSelector('.wiz');
  check((await banner()).includes('PERIMETER WATCH'), 'banner: SENTINEL AGENT ACTIVE – PERIMETER WATCH');
  let a = (await call('GET', '/state')).agents.find((x) => x.id === ag.id);
  check(a.settings.masksConfirmed === false, 'HQ can’t mark the privacy masks as confirmed — only the Agent’s wizard can');
  check(await ag.p.isVisible('text=STEP 1 OF 6'), 'setup wizard starts: window tips');
  await ag.p.click('[data-next]'); // mount
  await ag.p.click('[data-next]'); // area
  await ag.p.click('[data-watch="garden"]');
  await ag.p.click('[data-next]'); // masks
  check(await ag.p.isDisabled('[data-next]'), 'masks step: can’t continue until you confirm the rest is your own property');
  await ag.p.click('[data-cell="0"]');
  await ag.p.click('[data-cell="1"]');
  check(await ag.p.evaluate(() => document.querySelectorAll('.mask-grid .masked').length) === 2, 'tapped squares become black privacy masks');
  await shot(ag.p, 'agent-perimeter-masks');
  await ag.p.check('[data-agree]');
  await ag.p.click('[data-next]'); // walk test
  await ag.p.waitForFunction(() => /person · 91%/.test(document.querySelector('[data-walk]')?.textContent || ''), null, { timeout: 15000 });
  check(true, 'walk test lists what the Agent recognises (on its own screen)');
  const before = (await call('GET', '/log?kind=perimeter&limit=50')).length;
  check(before === 0, 'nothing is sent to HQ during the walk test');
  await ag.p.click('[data-next]');
  await ag.p.click('[data-next]'); // arm
  await ag.p.waitForSelector('[data-rerun]', { timeout: 15000 });
  a = (await call('GET', '/state')).agents.find((x) => x.id === ag.id);
  check(a.settings.masksConfirmed === true && JSON.stringify(a.settings.mask) === '[0,1]' && a.settings.watch === 'garden', 'armed: HQ stores only the masked square numbers, the area and the confirmation');
  await call('PATCH', '/settings', { mode: 'away' });
  const ev = await (async () => { for (let i = 0; i < 40; i++) { const l = await call('GET', '/log?kind=perimeter&limit=10'); if (l.length) return l[0]; await new Promise((r) => setTimeout(r, 500)); } return null; })();
  if (!ev) console.log('debug', await ag.p.evaluate(() => [document.querySelector('[data-state]')?.textContent, document.querySelector('[data-rec]')?.textContent, document.querySelector('[data-meter]')?.style.width, window.__agent.sent.filter((x) => x.includes('event')).slice(-3)]));
  check(ev && /Person detected \(garden\)/.test(ev.message) && ev.data.class === 'person' && ev.data.zone === 'garden', `HQ receives “Person detected (garden)” with class and zone${ev ? ` — ${ev.message}` : ''}`);
  await shot(ag.p, 'agent-perimeter-watching');
  const sent = await ag.p.evaluate(() => window.__agent.sent.join('\n'));
  check(!/data:image|base64|blob:/.test(sent), 'privacy: no picture ever left the Agent (every sent message checked)');
  await call('PATCH', '/settings', { mode: 'home' });

  // ---------- fleet registry ----------
  await go(dash, 'register');
  await dash.waitForSelector('[data-reg]');
  const row = await dash.textContent('[data-reg]');
  check(/\d+ (GOOD|FAIR|POOR)/.test(row) && /\d+\.\d+\.\d+/.test(row), 'registry row: health score and the Agent’s version');
  check(/average health \d+\/100/.test(await dash.textContent('[data-fsum]')), 'fleet health summary at the top');
  await dash.check(`[data-pick="${ag.id}"]`);
  await dash.click('[data-bulkdo="identify"]');
  await ag.p.waitForSelector('[data-find]:not([hidden])', { timeout: 10000 });
  check(true, 'bulk Identify: the selected Agent flashes');
  await ag.p.click('[data-find]');
  await shot(dash, 'hq-fleet-registry');

  // ---------- HQ offline: the Agent stands by and resumes ----------
  await ag.p.evaluate(() => window.__agent.testTimes(3000, 4000));
  await dash.close();
  await ag.p.waitForFunction(() => window.__agent.standingBy, null, { timeout: 90000 });
  check((await banner()).includes('HQ OFFLINE – STANDING BY'), 'HQ gone: banner says SENTINEL AGENT ACTIVE – HQ OFFLINE – STANDING BY');
  check(await ag.p.evaluate(() => !window.__agent.mission.id), 'the mission is paused (camera released)');
  await shot(ag.p, 'agent-hq-offline');
  const dash2 = await dashCtx.newPage(); // the same browser profile = the same HQ
  dash2.on('pageerror', (e) => errors.push(`[hq2] ${e.message}`));
  await dash2.goto(world.hqUrl);
  await login(dash2);
  await ag.p.waitForFunction(() => !window.__agent.standingBy && window.__agent.mission.id === 'perimeter', null, { timeout: 90000 });
  check(true, 'HQ back: the Agent resumes PERIMETER WATCH by itself');

  await finish(browser, world, errors, 'agents');
})();
