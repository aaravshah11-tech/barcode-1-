// Recruiting Agents with nothing installed: QR → Agent page → encrypted link to HQ; signed orders,
// Wi-Fi drop, HQ page reloaded, unknown devices refused, disconnect, typing the codes by hand.
const { chromium } = require('playwright');
const path = require('path');
const { startWorld, launch, openHQ, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' };
const banner = (p) => p.evaluate(() => document.querySelector('[data-banner]')?.textContent || '');

(async () => {
  const world = await startWorld();
  const browser = await launch(chromium);
  const errors = [];
  const watch = (p, who) => { p.on('pageerror', (e) => errors.push(`[${who}] ${e.message}`)); };
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  // HQ computer
  const dash = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  watch(dash, 'hq');
  await openHQ(dash, world);
  await dash.click('[data-recruit]');
  await dash.waitForSelector('.recruit [data-qr] svg');
  const joinUrl = await dash.getAttribute('[data-qr]', 'data-link');

  // The old phone scans the QR code
  const t0 = Date.now();
  const phoneCtx = await browser.newContext(PHONE);
  const phone = await phoneCtx.newPage();
  watch(phone, 'phone');
  await phone.goto(joinUrl);
  await phone.waitForFunction(() => document.querySelector('[data-banner]')?.textContent.includes('SENTINEL AGENT ACTIVE – STANDBY'), null, { timeout: 20000 });
  const secs = (Date.now() - t0) / 1000;
  check(secs < 15, `scan → recruited and connected in ${secs.toFixed(1)} s (no certificate steps)`);
  check(new URL(phone.url()).hash === '', 'the one-time code is removed from the address bar');
  const codename = (await phone.textContent('[data-codename]')).trim();
  check(/^[A-Z-0-9]+$/.test(codename), `Agent got a codename: ${codename}`);
  check((await phone.textContent('[data-link]')).includes('encrypted'), 'Agent shows it is linked to HQ (encrypted)');
  await shot(phone, 'agent-standby');

  // HQ sees it
  await dash.waitForSelector('.toast >> text=recruited');
  await dash.waitForSelector(`.sheet-head >> text=AGENT-01 // ${codename}`);
  check(true, 'HQ: recruit window closes and opens the new Agent');
  check((await dash.textContent('[data-agents]')).includes('ONLINE'), 'HQ: Agent listed ONLINE');
  check((await dash.textContent('[data-log]')).includes(`AGENT-01 “${codename}” recruited`), 'Mission Log: recruited');

  // The same QR code can't recruit a second device
  const thief = await (await browser.newContext(PHONE)).newPage();
  watch(thief, 'thief');
  await thief.goto(joinUrl);
  await thief.waitForSelector('text=wrong, used or expired', { timeout: 20000 });
  check(true, 'the QR code only works once');

  // Rename → the phone updates (signed order)
  await dash.fill('[data-rename] [name=codename]', 'nightjar');
  await dash.fill('[data-rename] [name=name]', 'Hallway');
  await dash.click('[data-rename] button');
  await phone.waitForFunction(() => document.querySelector('[data-codename]').textContent === 'NIGHTJAR');
  check(true, 'rename on HQ shows on the Agent');
  const sec = await phone.evaluate(async () => {
    const a = window.__agent;
    const good = a.lastCmd;
    return { replay: await a.verify(good), tamper: await a.verify({ ...good, nonce: 'x' + good.nonce, payload: { mission: 'intel' } }), forged: await a.verify({ ...good, nonce: 'y', sig: 'AAAA' }) };
  });
  check(!sec.replay && !sec.tamper && !sec.forged, 'Agent rejects replayed, tampered and forged orders');
  await dash.click('[data-cmd="find"]');
  await phone.waitForSelector('[data-find]:not([hidden])');
  check((await phone.textContent('[data-find]')).includes('NIGHTJAR'), 'Find: the Agent flashes its codename');
  await shot(phone, 'agent-find');
  await phone.click('[data-find]');
  await dash.keyboard.press('Escape');

  // HQ page reloaded (or the computer restarted): the Agent reconnects on its own
  await dash.reload();
  await phone.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('RECONNECTING'), null, { timeout: 30000 }).catch(() => {});
  await dash.waitForSelector('[data-threat]', { timeout: 15000 });
  await phone.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('SENTINEL AGENT ACTIVE'), null, { timeout: 60000 });
  await dash.waitForSelector('[data-agents] >> text=ONLINE', { timeout: 30000 });
  check(true, 'HQ page reloaded: the Agent reconnects by itself (same recruitment)');

  // A device with a made-up key is refused
  const denied = await phone.evaluate(async () => {
    const { dial } = await import(new URL('../shared/link.js', location.href).href);
    const hqId = JSON.parse(localStorage.getItem('sentinel.agent')).hqId;
    return new Promise((r) => { let l; dial(hqId, { onOpen: () => l.send({ t: 'hello', token: 'made-up' }), onMessage: (m) => r(m.t), onClose: () => r('closed') }).then((x) => { l = x; }); });
  });
  check(denied === 'denied', 'unknown devices are refused');

  // Disconnect from HQ
  await dash.click('.agent');
  await dash.click('[data-remove]');
  await dash.click('.sheet [data-ok]');
  await phone.waitForSelector('text=DISCONNECTED BY HQ', { timeout: 15000 });
  await dash.waitForSelector('text=NO AGENTS YET');
  check(true, 'Disconnect: the Agent stops and leaves the list');
  await phone.reload();
  await phone.waitForSelector('text=NOT RECRUITED');
  check(true, 'a disconnected Agent has to be recruited again');
  await shot(phone, 'agent-not-recruited');

  // Typing both codes by hand
  await dash.click('[data-recruit]');
  await dash.waitForSelector('[data-code]');
  const code2 = (await dash.textContent('[data-code]')).trim();
  const hqCode = (await dash.textContent('[data-hqcode]')).trim();
  await phone.fill('[data-code] [name=hq]', hqCode.toLowerCase());
  await phone.fill('[data-code] [name=code]', code2.toLowerCase());
  await phone.click('[data-code] button');
  await phone.waitForFunction(() => document.querySelector('[data-banner]')?.textContent.includes('SENTINEL AGENT ACTIVE'), null, { timeout: 20000 });
  await dash.waitForSelector('.toast >> text=AGENT-02');
  check(true, 'typing the HQ code and recruit code by hand also recruits (AGENT-02)');
  await shot(dash, 'hq-with-agent');

  // Leaving for good: HQ logs the Agent offline after its grace period
  await phone.close();
  await dash.waitForSelector('[data-log] >> text=offline', { timeout: 60000 });
  check(true, 'an Agent that disappears is logged offline (after the 20 s grace period)');

  await finish(browser, world, errors, 'pairing');
})().catch((e) => { console.error(e); process.exit(1); });
