// Missions on a real (headless) Agent with a fake camera and synthetic motion sensors.
const { chromium } = require('playwright');
const path = require('path');
const helpers = require('./helpers.cjs');
const { startWorld, openHQ, hqApi, check, finish } = helpers;
const video = require('./video.cjs');
const SHOTS = process.argv[2] || '';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['accelerometer', 'gyroscope'] };

(async () => {
  const world = await startWorld();
  const errors = [];
  const browsers = [];
  const launch = async (file) => { const b = await helpers.launch(chromium, [...(file ? [`--use-file-for-fake-video-capture=${file}`] : []), `--use-file-for-fake-audio-capture=${video.tone()}`]); browsers.push(b); return b; };
  const watch = (p, who) => p.on('pageerror', (e) => errors.push(`[${who}] ${e.message}`));
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  const main = await launch(video.moving());
  const dash = await (await main.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  watch(dash, 'hq');
  dash.on('console', (m) => { if (m.type() === 'error') errors.push(`[hq console] ${m.text()}`); });
  await openHQ(dash, world);
  const call = hqApi(dash);

  // Recruit an Agent; `sent()` lists every message it has sent to HQ.
  const recruit = async (browser, who) => {
    const r = await helpers.recruit(dash, await browser.newContext(PHONE), world);
    watch(r.p, who);
    return { ...r, sentNow: () => r.p.evaluate(() => window.__agent.sent.slice()) };
  };
  const assign = (id, mission, settings) => call('PATCH', `/agents/${id}`, { mission, settings });
  const events = (kind) => call('GET', `/log?kind=${kind}&limit=100`);
  const state = () => call('GET', '/state');

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
  const camSent = await cam.sentNow();
  const biggest = Math.max(...camSent.map((s) => s.length));
  check(biggest < 2000 && !camSent.some((s) => /data:image|data:audio|base64|blob:/i.test(s)), `Agent → HQ messages are tiny text events only (largest ${biggest} bytes)`);
  // Ignore zones: block the whole view on the Agent → no more motion
  await cam.p.click('[data-zones]');
  for (let i = 0; i < 48; i++) await cam.p.click(`[data-cell="${i}"]`);
  await shot(cam.p, 'agent-zones');
  await cam.p.click('[data-zones]');
  await dash.waitForFunction(async () => true);
  const zoned = (await state()).agents.find((a) => a.id === cam.id);
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
  check(!(await door.sentNow()).some((s) => /data:|base64/i.test(s)), 'door Agent sends events only');

  // ---------- INTEL SCREEN (wall display) ----------
  const wall = await recruit(main, 'intel');
  await assign(wall.id, 'intel', {});
  await wall.p.waitForSelector('.intel-threat');
  await wall.p.waitForFunction(() => document.querySelector('[data-log]').textContent.includes('Door closed'));
  check(true, 'INTEL SCREEN shows the threat level and Mission Log');
  check(await wall.p.isHidden('[data-dim]'), 'INTEL SCREEN never dims');

  // ---------- DOOR PANEL ----------
  const bell = await recruit(main, 'panel');
  await call('PATCH', `/agents/${bell.id}`, { name: 'Front door' });
  await assign(bell.id, 'panel', { label: 'RING HQ', cooldown: 3 });
  await bell.p.waitForSelector('[data-knock]');
  await bell.p.waitForFunction(() => document.querySelector('[data-knock]').textContent === 'RING HQ');
  await bell.p.click('[data-knock]');
  await bell.p.waitForSelector('text=HQ NOTIFIED');
  await dash.waitForSelector('[data-log] >> text=Knock knock at Front door!');
  check(true, 'DOOR PANEL: pressing the button alerts HQ (“Knock knock at Front door!”)');
  await wall.p.waitForFunction(() => document.querySelector('[data-log]').textContent.includes('Knock knock'));
  check(true, 'INTEL SCREEN updates live');
  await shot(bell.p, 'agent-panel');
  await shot(wall.p, 'agent-intel');

  // ---------- SOUND LEVEL (Chrome's fake microphone plays a tone) ----------
  const ear = await recruit(main, 'sound');
  await assign(ear.id, 'sound', { threshold: 40, minMs: 100, cooldown: 30, calibration: 110 });
  await ear.p.waitForSelector('[data-db]');
  // The page may ask for a tap before it can listen (browsers' autoplay rule). Keep tapping until readings flow.
  for (let i = 0; i < 40; i++) {
    const btn = await ear.p.$('.activate button');
    if (btn) await btn.click().catch(() => {});
    if (await ear.p.evaluate(() => /\d/.test(document.querySelector('[data-db]')?.textContent || ''))) break;
    await ear.p.waitForTimeout(250);
  }
  await dash.waitForSelector('[data-log] >> text=/Loud sound: \\d+ dB/', { timeout: 20000 }).catch(async (e) => {
    console.log('sound debug:', await ear.p.evaluate(() => [document.querySelector('[data-db]')?.textContent, document.querySelector('[data-info]')?.textContent, document.querySelector('.activate')?.outerHTML?.slice(0, 200)]));
    throw e;
  });
  check(true, 'SOUND LEVEL: a noise above the limit → “Loud sound: NN dB”');
  check(!(await ear.sentNow()).some((x) => x.length > 2000 || /data:|base64|blob:/i.test(x)), 'sound Agent sends numbers only — no audio');
  let reading;
  for (let i = 0; i < 30 && typeof reading !== 'number'; i++) { reading = (await state()).agents.find((a) => a.id === ear.id).status?.level; if (typeof reading !== 'number') await ear.p.waitForTimeout(200); }
  check(typeof reading === 'number', `dashboard shows the live dB reading (${reading} dB)`);
  await shot(ear.p, 'agent-sound');

  // ---------- LIGHT CHECK (fake video: dark, then the lights go on) ----------
  const lamp = await launch(video.lights());
  const eye = await recruit(lamp, 'light');
  await assign(eye.id, 'light', { threshold: 35 });
  await dash.waitForSelector('[data-log] >> text=/Lights switched (on|off)/', { timeout: 25000 });
  check(true, 'LIGHT CHECK: lights switched on/off is reported');
  await shot(eye.p, 'agent-light');

  // ---------- STANDBY ----------
  await assign(ear.id, 'standby', {});
  await ear.p.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('STANDBY'));
  check(await ear.p.evaluate(() => !document.querySelector('[data-banner]').classList.contains('watching')), 'back to STANDBY: microphone released, banner no longer red');

  check(!(await dash.$('.toast.err')), 'no error messages on the dashboard');
  await finish(browsers, world, errors, 'missions');
})().catch((e) => { console.error(e); process.exit(1); });
