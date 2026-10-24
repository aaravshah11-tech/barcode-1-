// Golf browser test: simulated phone motion events -> recorder -> analysis -> save -> computer views.
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const SHOTS = process.argv[2] || '';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, n + '.png') });

  // Pretend to be a phone: DeviceMotionEvent with an iPhone-style permission prompt.
  await page.addInitScript(() => {
    window.__perm = 0;
    window.DeviceMotionEvent.requestPermission = async () => { window.__perm++; return 'granted'; };
    window.__swing = (backMs, downMs, peak) => new Promise((resolve) => {
      const frames = [];
      const hz = 60, dt = 1000 / hz;
      for (let t = 0; t < 900; t += dt) frames.push(0);                                         // hold still
      for (let t = 0; t < backMs; t += dt) frames.push(-250 * Math.sin(Math.PI * t / backMs));    // backswing
      for (let t = 0; t < downMs; t += dt) frames.push(peak * Math.sin((Math.PI / 2) * t / downMs)); // downswing
      for (let t = 0; t < 450; t += dt) frames.push(peak * Math.cos((Math.PI / 2) * t / 450));      // follow-through
      for (let t = 0; t < 900; t += dt) frames.push(0);                                          // settle
      let i = 0;
      const tick = () => {
        if (i >= frames.length) return resolve(frames.length);
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: frames[i], beta: 0.5, gamma: -0.3 }, accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 }, interval: dt }));
        i++;
        setTimeout(tick, dt);
      };
      tick();
    });
  });

  await page.goto(BASE + '?nosw#/golf');
  await page.waitForSelector('[data-ready]');
  await page.click('[data-club="Driver"]');
  await page.click('[data-ready]');
  check(await page.evaluate(() => window.__perm) === 1, 'asked for motion permission (iPhone prompt) on Ready');
  await page.evaluate(() => window.__swing(900, 300, 1500));
  await page.waitForSelector('.gm-tempo', { timeout: 10000 });
  const tempo = parseFloat(await page.textContent('.gm-tempo b'));
  check(tempo >= 2.6 && tempo <= 3.4, `swing detected automatically; tempo ${tempo}:1 (expected ≈3)`);
  check((await page.textContent('#view')).includes('estimates'), 'estimates are clearly labelled');
  await shot('golf-result');
  await page.click('[data-result="slice"]');
  await page.waitForSelector('.toast >> text=Saved Driver swing (Slice)');
  check(await page.isVisible('.golf-status'), 'saved and re-armed for the next ball');

  // Second swing: quicker tempo, 7 iron, good
  await page.click('[data-cancel]').catch(() => {});
  await page.click('[data-club="7 iron"]');
  await page.click('[data-ready]');
  await page.evaluate(() => window.__swing(600, 300, 1200));
  await page.waitForSelector('.gm-tempo', { timeout: 10000 });
  await page.click('[data-result="good"]');
  await page.waitForSelector('.toast >> text=Good');

  // Computer views
  await page.setViewportSize({ width: 1300, height: 860 });
  await page.goto(BASE + '?nosw#/golf/swings');
  await page.waitForSelector('.rows .row');
  check((await page.$$('.rows .row')).length === 2, 'both swings listed');
  await page.click('.rows .row >> nth=1');
  await page.waitForSelector('.chart svg');
  check((await page.textContent('#view')).includes('Impact'), 'swing graph with phase markers');
  await shot('golf-detail');
  await page.goto(BASE + '?nosw#/golf/compare');
  await page.waitForSelector('.chart svg');
  check((await page.textContent('#view')).includes('Downswing'), 'compare two swings');
  await page.goto(BASE + '?nosw#/golf/trends');
  await page.waitForSelector('.stat-grid');
  const tr = await page.textContent('#view');
  check(tr.includes('Driver') && tr.includes('7 iron') && tr.includes('Slice'), 'trends by club and by result');
  await shot('golf-trends');

  // Laptop without sensors: friendly message + demo
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { window.DeviceMotionEvent.requestPermission = undefined; });
  await p2.goto(BASE + '?nosw#/golf');
  await p2.click('[data-ready]');
  await p2.waitForSelector('text=No motion sensors found', { timeout: 5000 });
  check(true, 'no sensors -> friendly message');
  await p2.click('[data-demo]');
  await p2.waitForSelector('.gm-tempo');
  check(true, 'demo swing works without sensors');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll golf checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
