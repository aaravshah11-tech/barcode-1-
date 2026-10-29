// Secure terminal (typed commands) and push-to-talk voice commands (off by default, privacy warning first).
// The browser's speech service is replaced by a stand-in here, so no audio goes anywhere during tests.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, recruit, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.__speech = { next: '', starts: 0 };
    class FakeRecognition {
      start() { window.__speech.starts++; }
      stop() {
        const text = window.__speech.next;
        setTimeout(() => {
          if (text) { const r = [{ transcript: text }]; r.isFinal = true; this.onresult?.({ resultIndex: 0, results: [r] }); }
          this.onend?.();
        }, 60);
      }
    }
    window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
    window.__spoken = [];
    if (window.speechSynthesis) { speechSynthesis.speak = (u) => window.__spoken.push(u.text); speechSynthesis.cancel = () => {}; }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[hq] ${e.message}`));
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  await openHQ(page, world);
  const agent = await recruit(page, await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), world);
  agent.p.on('pageerror', (e) => errors.push(`[agent] ${e.message}`));
  agent.codename = await page.evaluate((id) => window.__hq.hq.db.agent(id).codename, agent.id);

  const out = () => page.textContent('[data-termout]');
  const type = async (cmd, waitFor) => {
    await page.fill('[data-termin]', cmd);
    await page.press('[data-termin]', 'Enter');
    if (waitFor) await page.waitForFunction((w) => document.querySelector('[data-termout]').textContent.includes(w), waitFor, { timeout: 15000 });
  };

  // ---- Terminal ----
  await page.click('.wp-log .panel-head h2'); // focus the page, not a text box
  await page.keyboard.press('Backquote');
  await page.waitForSelector('.term [data-termin]');
  check(true, 'press ` to open the secure terminal');
  await type('help', 'mode <home|away|night|lockdown>');
  check(true, 'help lists the commands');
  await type('status', 'Threat level GREEN');
  check((await out()).includes('1 of 1 Agent online'), 'status: threat level, mode and Agents online');
  await type('mode night', 'Night mode.');
  await page.waitForSelector('[data-log] >> text=Alert state: NIGHT');
  check(true, 'mode night switches HQ to NIGHT (and it’s logged)');
  await type('agents', 'ONLINE');
  check((await out()).includes(agent.codename), 'agents lists the Agent with its codename');
  await type('find 1', 'is flashing its codename');
  await agent.p.waitForSelector('[data-find]:not([hidden])', { timeout: 10000 });
  check(true, 'find 1 makes AGENT-01 flash its codename');
  await agent.p.click('[data-find]');
  await type('send all Dinner is ready!', 'Transmitted to 1 Agent');
  await agent.p.waitForSelector('.comms-screen >> text=Dinner is ready!', { timeout: 10000 });
  check(true, 'send all <message> appears on the Agent (wording kept)');
  await agent.p.click('.comms-screen [data-ack]');
  await type('mode lockdown');
  await page.waitForSelector('.sheet >> text=Enter LOCKDOWN?');
  await page.click('.sheet [data-close]:not(.icon-btn)');
  await page.waitForFunction(() => document.querySelector('[data-termout]').textContent.includes('Lockdown cancelled'));
  check(true, 'lockdown asks first (cancel keeps NIGHT)');
  await page.click('[data-termin]');
  await type('xyzzy', 'Unknown command');
  check(await page.$$eval('.term-out li.err', (l) => l.length) >= 1, 'unknown commands are explained');
  await page.press('[data-termin]', 'ArrowUp');
  check(await page.inputValue('[data-termin]') === 'xyzzy', '↑ brings back the last command');
  await page.fill('[data-termin]', 'spe');
  await page.press('[data-termin]', 'Tab');
  check(await page.inputValue('[data-termin]') === 'speedtest ', 'Tab completes a command');
  await shot('terminal');
  await type('clear');
  await page.waitForFunction(() => document.querySelectorAll('.term-out li').length === 0);
  check(true, 'clear empties the terminal');
  await page.press('[data-termin]', 'Escape');
  await page.waitForSelector('.term', { state: 'detached' });
  check(true, 'Esc closes the terminal');

  // ---- Voice: off by default ----
  check(await page.isHidden('[data-ptt]'), 'voice commands are OFF by default (no microphone button)');
  await page.keyboard.down('v'); await page.keyboard.up('v');
  check(await page.evaluate(() => window.__speech.starts) === 0, 'holding V does nothing while voice is off');
  await page.click('[data-settings]');
  await page.click('[data-voiceon]');
  await page.waitForSelector('.sheet >> text=Switch on voice commands?');
  check((await page.textContent('.sheet:last-of-type, .sheet-backdrop:last-child')).includes('Google'), 'switching on first explains the audio goes to Google (Chrome) — only while holding');
  await page.locator('[data-ok]').last().click();
  await page.waitForFunction(() => document.querySelector('[data-voiceon]')?.checked);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-ptt]:not([hidden])');
  check(true, 'after agreeing, a microphone button appears');

  // Hold the button, speak, release
  await page.evaluate(() => { window.__speech.next = 'Switch to away mode'; });
  const mic = await page.locator('[data-ptt]').boundingBox();
  await page.mouse.move(mic.x + mic.width / 2, mic.y + mic.height / 2);
  await page.mouse.down();
  await page.waitForSelector('.ptt-status:not([hidden]) >> text=Listening');
  check(true, 'holding the button shows a red LISTENING bar');
  await shot('voice-listening');
  await page.mouse.up();
  await page.waitForSelector('[data-log] >> text=Alert state: AWAY', { timeout: 10000 });
  check(await page.isHidden('.ptt-status'), 'release: listening stops, and “switch to away mode” switches to AWAY');
  await page.waitForFunction(() => window.__spoken.some((t) => t.startsWith('Away mode')));
  check(true, 'SENTINEL answers out loud');

  // Hold V instead
  await page.evaluate(() => { window.__speech.next = "what's the status"; });
  await page.click('.wp-log .panel-head h2');
  await page.keyboard.down('v');
  await page.waitForSelector('.ptt-status:not([hidden])');
  await page.keyboard.up('v');
  await page.waitForFunction(() => window.__spoken.some((t) => t.startsWith('Threat level')));
  check(true, 'hold V to talk: “what’s the status” gets a spoken sitrep');

  // Dangerous voice commands still ask on screen
  await page.evaluate(() => { window.__speech.next = 'panic'; });
  await page.keyboard.down('v'); await page.keyboard.up('v');
  await page.waitForSelector('.sheet >> text=Raise PANIC?');
  await page.click('.sheet [data-close]:not(.icon-btn)');
  check((await page.evaluate(() => window.__hq.hq.settings().mode)) === 'away', 'a spoken “panic” must be confirmed on screen');

  // Turning it off again
  await page.click('[data-settings]');
  await page.uncheck('[data-voiceon]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-ptt][hidden]', { state: 'attached' });
  check(true, 'switching voice off removes the microphone button');

  // The terminal can lock HQ
  await page.keyboard.press('Backquote');
  await type('lock');
  await page.waitForSelector('[data-login]', { timeout: 10000 });
  check(true, 'lock in the terminal locks HQ');

  await finish(browser, world, errors, 'terminal & voice');
})().catch((e) => { console.error(e); process.exit(1); });
