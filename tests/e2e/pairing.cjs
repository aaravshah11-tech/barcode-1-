// Recruiting Agents: QR/setup page → certificate check → pairing → live link, signed orders, Wi-Fi drop, disconnect.
const { chromium } = require('playwright');
const path = require('path');
const { startHQ, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' };

(async () => {
  const hq = await startHQ();
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, who) => { p.on('pageerror', (e) => errors.push(`[${who}] ${e.message}`)); };
  const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  // HQ computer
  const dash = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1360, height: 860 } })).newPage();
  watch(dash, 'hq');
  await dash.goto(hq.url + '/');
  await dash.fill('[name=pw]', 'secret1'); await dash.fill('[name=pw2]', 'secret1'); await dash.click('[data-gate] button');
  await dash.waitForSelector('[data-threat]', { timeout: 10000 });
  await dash.click('[data-recruit]');
  await dash.waitForSelector('.recruit [data-qr] svg');
  const code = (await dash.textContent('[data-code]')).trim();
  const joinUrl = `${hq.httpUrl}/join?c=${code}`;

  // A phone that doesn't trust HQ yet: shown how to install the certificate
  const fresh = await (await browser.newContext({ ...PHONE, ignoreHTTPSErrors: false })).newPage();
  watch(fresh, 'fresh');
  await fresh.goto(joinUrl);
  await fresh.waitForSelector('[data-step="trust"]:not([hidden])');
  check(await fresh.isVisible('details[data-os="android"][open]'), 'untrusted phone: step-by-step certificate instructions for its kind of phone');
  const cert = await fresh.request.get(`${hq.httpUrl}/sentinel-ca.crt`);
  check(cert.ok() && cert.headers()['content-type'].includes('x509') && (await cert.text()).includes('BEGIN CERTIFICATE'), 'certificate downloads from the setup page (public part only)');
  const key = await fresh.request.get(`${hq.httpUrl}/../data/certs/rootCA-key.pem`).catch(() => null);
  check(!key || !(await key.text()).includes('PRIVATE KEY'), 'the private key can’t be downloaded');
  await shot(fresh, 'agent-trust');

  // A phone that trusts HQ: QR → straight into the Agent page
  const t0 = Date.now();
  const phoneCtx = await browser.newContext(PHONE);
  const phone = await phoneCtx.newPage();
  watch(phone, 'phone');
  await phone.goto(joinUrl);
  await phone.waitForSelector('[data-banner]:not([hidden])', { timeout: 15000 });
  await phone.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('SENTINEL AGENT ACTIVE – STANDBY'), null, { timeout: 15000 });
  const secs = (Date.now() - t0) / 1000;
  check(secs < 20, `scan → paired and connected in ${secs.toFixed(1)} s`);
  check(new URL(phone.url()).hash === '', 'the one-time code is removed from the address bar');
  const codename = (await phone.textContent('[data-codename]')).trim();
  check(/^[A-Z-0-9]+$/.test(codename), `Agent got a codename: ${codename}`);
  await shot(phone, 'agent-standby');

  // HQ sees it
  await dash.waitForSelector('.toast >> text=recruited');
  await dash.waitForSelector(`.sheet-head >> text=AGENT-01 // ${codename}`);
  check(true, 'HQ: recruit window closes and opens the new Agent');
  check((await dash.textContent('[data-agents]')).includes('ONLINE'), 'HQ: Agent listed ONLINE');
  check((await dash.textContent('[data-log]')).includes(`AGENT-01 “${codename}” recruited`), 'Mission Log: recruited');
  check(await dash.request.post(hq.url + '/api/pair/claim', { data: { code } }).then((r) => r.status()) === 400, 'the QR code only works once');

  // Rename → the phone updates (signed order)
  await dash.fill('[data-rename] [name=codename]', 'nightjar');
  await dash.fill('[data-rename] [name=name]', 'Hallway');
  await dash.click('[data-rename] button');
  await phone.waitForFunction(() => document.querySelector('[data-codename]').textContent === 'NIGHTJAR');
  check(true, 'rename on HQ shows on the Agent');
  // Only signed, fresh, never-seen orders are obeyed
  const sec = await phone.evaluate(async () => {
    const a = window.__agent;
    const good = a.lastCmd;
    return { replay: await a.verify(good), tamper: await a.verify({ ...good, nonce: 'x' + good.nonce, payload: { mission: 'intel' } }), forged: await a.verify({ ...good, nonce: 'y', sig: 'AAAA' }) };
  });
  check(!sec.replay && !sec.tamper && !sec.forged, 'Agent rejects replayed, tampered and forged orders');
  // Find me
  await dash.click('[data-cmd="find"]');
  await phone.waitForSelector('[data-find]:not([hidden])');
  check((await phone.textContent('[data-find]')).includes('NIGHTJAR'), 'Find: the Agent flashes its codename');
  await shot(phone, 'agent-find');
  await phone.click('[data-find]');
  await dash.keyboard.press('Escape');

  // Wi-Fi drops briefly: Agent reconnects on its own; no "offline" spam
  await phoneCtx.setOffline(true);
  await phone.evaluate(() => window.dispatchEvent(new Event('offline')));
  await phone.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('RECONNECTING'), null, { timeout: 30000 }).catch(() => {});
  await phoneCtx.setOffline(false);
  await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  await phone.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('SENTINEL AGENT ACTIVE'), null, { timeout: 30000 });
  check(true, 'Wi-Fi drop: Agent reconnects by itself');
  check(!(await dash.textContent('[data-log]')).includes('offline'), 'a short blip doesn’t log the Agent as offline');

  // HQ restarts (e.g. the computer rebooted): the Agent reconnects by itself
  await hq.stop();
  await phone.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('RECONNECTING'), null, { timeout: 15000 });
  check(true, 'HQ goes down: the Agent shows RECONNECTING TO HQ');
  await shot(phone, 'agent-reconnecting');
  Object.assign(hq, await startHQ({ reuse: hq }));
  await phone.waitForFunction(() => document.querySelector('[data-banner]').textContent.includes('SENTINEL AGENT ACTIVE'), null, { timeout: 30000 });
  check(true, 'HQ back up: the Agent reconnects on its own (same pairing)');
  await dash.waitForSelector('[data-agents] >> text=ONLINE', { timeout: 30000 });
  check(true, 'dashboard reconnects too and shows the Agent ONLINE');

  // A device with a made-up key can't connect
  const denied = await phone.evaluate(() => new Promise((r) => { const w = new WebSocket(`wss://${location.host}/ws`); w.onopen = () => w.send(JSON.stringify({ t: 'hello', token: 'made-up' })); w.onmessage = (m) => r(JSON.parse(m.data).t); w.onclose = () => r('closed'); }));
  check(denied === 'denied', 'unknown devices are refused');

  // Disconnect from HQ
  await dash.click('.agent');
  await dash.click('[data-remove]');
  await dash.click('.sheet [data-ok]');
  await phone.waitForSelector('text=DISCONNECTED BY HQ', { timeout: 10000 });
  await dash.waitForSelector('text=NO AGENTS YET');
  check(true, 'Disconnect: the Agent stops and leaves the list');
  await phone.reload();
  await phone.waitForSelector('text=NOT RECRUITED');
  check(true, 'a disconnected Agent has to be recruited again');
  // Manual code entry
  await dash.click('[data-recruit]');
  await dash.waitForSelector('[data-code]');
  const code2 = (await dash.textContent('[data-code]')).trim();
  await phone.fill('[data-code] input', code2.toLowerCase());
  await phone.click('[data-code] button');
  await phone.waitForFunction(() => document.querySelector('[data-banner]')?.textContent.includes('SENTINEL AGENT ACTIVE'), null, { timeout: 15000 });
  await dash.waitForSelector('.toast >> text=AGENT-02');
  check(true, 'typing the code by hand also recruits (AGENT-02)');
  await shot(dash, 'hq-with-agent');

  await finish(browser, hq, errors, 'pairing');
})().catch((e) => { console.error(e); process.exit(1); });
