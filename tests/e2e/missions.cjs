// Missions on a real (headless) Agent with a fake camera and synthetic motion sensors.
const { chromium } = require('playwright');
const path = require('path');
const { startHQ, check, finish } = require('./helpers.cjs');
const video = require('./video.cjs');
const SHOTS = process.argv[2] || '';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, permissions: ['accelerometer', 'gyroscope'] };

(async () => {
  const hq = await startHQ();
  const errors = [];
  const browsers = [];
  const launch = async (file) => { const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(file ? [`--use-file-for-fake-video-capture=${file}`] : [])] }); browsers.push(b); return b; };
  const watch = (p, who) => p.on('pageerror', (e) => errors.push(`[${who}] ${e.message}`));
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  const main = await launch(video.moving());
  const dashCtx = await main.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 860 } });
  const dash = await dashCtx.newPage();
  watch(dash, 'hq');
  dash.on('console', (m) => { if (m.type() === 'error') errors.push(`[hq console] ${m.text()}`); });
  await dash.goto(hq.url + '/');
  await dash.fill('[name=pw]', 'secret1'); await dash.fill('[name=pw2]', 'secret1'); await dash.click('[data-gate] button');
  await dash.waitForSelector('[data-threat]', { timeout: 10000 });
  const api = (p, opts) => dashCtx.request.fetch(hq.url + p, opts).then((r) => r.json());

  // Recruit an Agent and log every message it sends to HQ.
  const recruit = async (browser, who) => {
    const { code } = await api('/api/pair', { method: 'POST' });
    const ctx = await browser.newContext(PHONE);
    const p = await ctx.newPage();
    watch(p, who);
    const sent = [];
    p.on('websocket', (ws) => ws.on('framesent', (f) => sent.push(String(f.payload))));
    await p.goto(`${hq.url}/agent/#pair=${code}`);
    await p.waitForFunction(() => window.__agent?.connected, null, { timeout: 15000 });
    const id = (await api('/api/state')).agents.at(-1).id;
    return { p, id, sent };
  };
  const assign = (id, mission, settings) => api(`/api/agents/${id}`, { method: 'PATCH', data: { mission, settings } });
  const events = async (kind) => (await api(`/api/log?kind=${kind}&limit=100`));

  // ---------- MOTION WATCH ----------
  const cam = await recruit(main, 'motion');
  await dash.click('.agent');
  await dash.click('[data-mission="motion"]');
  await cam.p.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('MOTION WATCH'));
  check(await cam.p.evaluate(() => document.querySelector('[data-banner]').classList.contains('watching')), 'Agent shows a red “SENTINEL AGENT ACTIVE – MOTION WATCH” banner');
  await dash.keyboard.press('Escape');
  await dash.waitForSelector('[data-log] >> text=Motion detected', { timeout: 20000 });
  check(true, 'someone walking past the camera → “Motion detected” in the Mission Log');
  await dash.waitForSelector('[data-threat].AMBER');
  check(true, 'threat goes AMBER while someone’s home');
  await shot(cam.p, 'agent-motion');
  await shot(dash, 'hq-motion');
  // Nobody home → RED
  await assign(cam.id, 'motion', { cooldown: 5 });
  await dash.click('[data-mode="away"]');
  await dash.waitForSelector('[data-threat].RED', { timeout: 20000 });
  check((await dash.textContent('[data-reason]')).includes('while nobody’s home'), 'motion while nobody’s home → THREAT RED');
  await dash.click('[data-mode="home"]');
  // Privacy: nothing that looks like a picture or audio ever went to HQ
  const biggest = Math.max(...cam.sent.map((s) => s.length));
  check(biggest < 2000 && !cam.sent.some((s) => /data:image|data:audio|base64|blob:/i.test(s)), `Agent → HQ messages are tiny text events only (largest ${biggest} bytes)`);
  // Ignore zones: block the whole view on the Agent → no more motion
  await cam.p.click('[data-zones]');
  for (let i = 0; i < 48; i++) await cam.p.click(`[data-cell="${i}"]`);
  await shot(cam.p, 'agent-zones');
  await cam.p.click('[data-zones]');
  await dash.waitForFunction(async () => true);
  const zoned = (await api('/api/state')).agents.find((a) => a.id === cam.id);
  check(zoned.settings.ignore.length === 48, 'ignore zones picked on the Agent are saved at HQ (just the grid squares)');
  await new Promise((r) => setTimeout(r, 1500));
  const before = (await events('motion')).length;
  await new Promise((r) => setTimeout(r, 8000));
  check((await events('motion')).length === before, 'all zones ignored → no motion reported');

  // A still room: no false alarms
  const quiet = await launch(video.still());
  const calm = await recruit(quiet, 'still');
  await assign(calm.id, 'motion', { sensitivity: 8, cooldown: 5 });
  await calm.p.waitForFunction(() => window.__agent.mission.id === 'motion');
  await new Promise((r) => setTimeout(r, 8000));
  const calmEvents = (await events('motion')).filter((e) => e.agentId === calm.id);
  check(calmEvents.length === 0, 'still room (even at high sensitivity) → no motion reported');

  // ---------- DOOR TRIPWIRE ----------
  const door = await recruit(main, 'door');
  await assign(door.id, 'door', { angle: 12, cooldown: 2 });
  await door.p.waitForFunction(() => window.__agent.mission.id === 'door' && document.querySelector('[data-state]'));
  // Phones ask before sharing motion sensors; the Agent shows one big button for it.
  const ask = await door.p.waitForSelector('.activate button', { timeout: 3000 }).catch(() => null);
  if (ask) { check((await ask.textContent()).includes('Allow motion sensors'), 'Agent asks for motion-sensor permission with one tap'); await ask.click(); }
  await door.p.waitForFunction(() => document.querySelector('[data-state]').textContent === 'CLOSED');
  const swing = (rate) => door.p.evaluate((rate) => new Promise((resolve) => {
    let t = 0;
    const tick = () => {
      const r = t < 500 ? rate : 0;
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: r }, acceleration: { x: 0, y: 0, z: 0 }, interval: 20 }));
      t += 20;
      if (t < 2000) setTimeout(tick, 20); else resolve();
    };
    tick();
  }), rate);
  await swing(0);
  await swing(70); // ~35° open
  await dash.waitForSelector('[data-log] >> text=Door opened', { timeout: 10000 });
  check((await door.p.textContent('[data-state]')) === 'OPEN', 'door swings open → Agent shows OPEN, HQ logs “Door opened”');
  await shot(door.p, 'agent-door');
  await swing(-70);
  await dash.waitForSelector('[data-log] >> text=Door closed', { timeout: 10000 });
  check(true, 'door swings back → “Door closed”');
  check(!door.sent.some((s) => /data:|base64/i.test(s)), 'door Agent sends events only');

  check(!(await dash.$('.toast.err')), 'no error messages on the dashboard');
  await finish(null, hq, errors, 'missions');
  for (const b of browsers) await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
