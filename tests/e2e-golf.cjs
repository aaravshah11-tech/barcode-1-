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
    window.__still = (ms) => new Promise((resolve) => {
      let t = 0;
      const tick = () => {
        if (t >= ms) return resolve();
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: (Math.random() - 0.5) * 4, beta: 0.5, gamma: -0.3 }, accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 }, interval: 16 }));
        t += 16; setTimeout(tick, 16);
      };
      tick();
    });
    window.__swing = (backMs, downMs, peak, strike = false) => new Promise((resolve) => {
      const frames = [];
      const hz = 60, dt = 1000 / hz;
      for (let t = 0; t < 900; t += dt) frames.push(0);                                         // hold still
      for (let t = 0; t < backMs; t += dt) frames.push(-250 * Math.sin(Math.PI * t / backMs));    // backswing
      for (let t = 0; t < downMs; t += dt) frames.push(peak * Math.sin((Math.PI / 2) * t / downMs)); // downswing
      const strikeAt = frames.length + 1; // the ball is hit ~1 frame after the hands peak
      for (let t = 0; t < 450; t += dt) frames.push(peak * Math.cos((Math.PI / 2) * t / 450));      // follow-through
      for (let t = 0; t < 900; t += dt) frames.push(0);                                          // settle
      let i = 0;
      const start = performance.now();
      const tick = () => {
        if (i >= frames.length) return resolve(frames.length);
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: frames[i], beta: 0.5, gamma: -0.3 }, accelerationIncludingGravity: { x: 0, y: 9.8 + (strike && i === strikeAt ? 40 : 0), z: 0 }, interval: dt }));
        i++;
        setTimeout(tick, Math.max(0, start + i * dt - performance.now())); // fixed clock: no drift
      };
      tick();
    });
  });

  await page.goto(BASE + '?nosw#/golf');
  await page.waitForSelector('[data-ready]');
  await page.click('[data-club="Driver"]');
  await page.click('[data-ready]');
  check(await page.evaluate(() => window.__perm) === 1, 'asked for motion permission (iPhone prompt) on Ready');
  await page.evaluate(() => window.__swing(900, 300, 1500, true));
  await page.waitForSelector('.gm-tempo', { timeout: 10000 });
  const tempo = parseFloat(await page.textContent('.gm-tempo b'));
  check(tempo >= 2.6 && tempo <= 3.4, `swing detected automatically; tempo ${tempo}:1 (expected ≈3)`);
  check((await page.textContent('#view')).includes('estimates'), 'estimates are clearly labelled');
  await shot('golf-result');
  await page.click('[data-result="slice"]');
  await page.waitForSelector('.toast >> text=Saved Driver swing (Slice)');
  const first = await page.evaluate(async () => (await import('./js/core/store.js')).all('swings')[0]);
  check(first.metrics.impactFrom === 'accel' && first.metrics.impact > first.metrics.peak, 'impact timed from the accelerometer jolt (just after peak rotation)');
  check(first.sessionId && first.golferId === '', 'swing saved into a practice session');
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

  // ---- Golfer profile + calibration on the phone ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '?nosw#/golf/golfers');
  await page.click('[data-add]');
  await page.fill('.sheet [name=name]', 'Jo');
  await page.fill('.sheet [name=height]', '170');
  await page.click('.sheet button.btn-primary');
  await page.waitForSelector('text=not calibrated');
  await page.click('a:has-text("Calibrate")');
  await page.click('[data-start]');
  await page.evaluate(() => window.__still(3800));
  await page.waitForSelector('text=Practice swing 1 of 3', { timeout: 5000 });
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__swing(800, 280, 900));
  await page.waitForSelector('text=Done — tuned for Jo', { timeout: 10000 });
  const jo = await page.evaluate(async () => (await import('./js/core/store.js')).all('golfers')[0]);
  check(jo.calibration && jo.calibration.swings === 3 && jo.calibration.minPeak >= 380 && jo.calibration.minPeak <= 500, `calibrated from 3 practice swings (swings over ${jo.calibration?.minPeak}°/s count)`);
  await shot('golf-calibrated');
  await page.click('[data-go]');
  await page.waitForSelector('[data-golfer][aria-pressed="true"]:has-text("Jo")');
  check(true, 'recorder switches to Jo');
  await page.click('[data-ready]');
  await page.evaluate(() => window.__swing(850, 290, 1000, true));
  await page.waitForSelector('.gm-tempo', { timeout: 10000 });
  await page.click('[data-result="good"]');
  await page.waitForSelector('.toast >> text=Good');
  await page.waitForSelector('text=Practice session: 1 swing so far');
  check(true, 'session counter on the recorder');
  const joSwing = await page.evaluate(async () => (await import('./js/core/store.js')).all('swings').find((s) => s.golferId));
  check(joSwing.golferId === jo.id && joSwing.sessionId !== first.sessionId, 'Jo’s swing saved under Jo in a separate session');

  // An old swing saved before sessions/golfers existed still shows up, in its own session
  await page.evaluate(async () => {
    const s = await import('./js/core/store.js');
    const { syntheticSwing, analyzeSwing } = await import('./js/tools/golf/analysis.js');
    const { pack } = await import('./js/tools/golf/sensors.js');
    const smp = syntheticSwing();
    const m = analyzeSwing(smp); delete m.impactFrom; delete m.peak;
    await s.put('swings', { id: 'old1', club: '5 iron', placement: 'glove', result: 'good', t: Date.now() - 2 * 86400000, samples: pack(smp), metrics: m });
  });
  await page.setViewportSize({ width: 1300, height: 860 });
  await page.goto(BASE + '?nosw#/golf/swings');
  await page.waitForSelector('.session-card');
  check((await page.$$('.session-card')).length === 3, 'swings grouped into 3 sessions (today Anyone, today Jo, old one)');
  await page.click('[data-filter=""]');
  await page.waitForFunction(() => document.querySelectorAll('.session-card').length === 2);
  check((await page.$$('.rows .row')).length === 3, 'golfer filter: “Anyone” shows 2 sessions, 3 swings');
  await page.click('.session-card .session-head a >> nth=0');
  await page.waitForSelector('text=Tempo consistency');
  await page.click('[data-rename]');
  await page.fill('.sheet input', 'Range — tempo work');
  await page.press('.sheet input', 'Enter');
  await page.waitForSelector('h1:has-text("Range — tempo work")');
  check((await page.textContent('#view')).includes('By club'), 'session page: stats, by-club table, renamed');
  await shot('golf-session');
  await page.click('[data-filter="all"]').catch(() => {});
  await page.goto(BASE + '?nosw#/golf/trends');
  await page.click('[data-filter="all"]');
  await page.waitForSelector('text=Practice sessions');
  check((await page.textContent('#view')).includes('Range — tempo work'), 'trends lists practice sessions');
  await page.goto(BASE + '?nosw#/golf/swing/old1');
  await page.waitForSelector('.chart svg');
  check((await page.textContent('#view')).includes('Practice session (1 swings)'), 'old swing opens fine and links to its session');

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
