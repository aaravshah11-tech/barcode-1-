// Alerts: turn on push for "this phone", then check which events reach it (decrypting each real
// web-push message with a fake push service), quiet hours, Agent offline, expired subscriptions.
const { chromium } = require('playwright');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ece = require('http_ece');
const WebSocket = require('ws');
const { startHQ, check, finish } = require('./helpers.cjs');
const SHOTS = process.argv[2] || '';

// ---- a pretend Apple/Google push service ----
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const auth = crypto.randomBytes(16);
const received = [];
// Its HTTPS certificate is made here, and only this test's HQ is told to trust it.
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-push-'));
require('child_process').execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem')], { stdio: 'ignore' });
const pushServer = https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.url === '/gone') { res.statusCode = 410; return res.end(); }
    try {
      const plain = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth.toString('base64url') });
      received.push({ ...JSON.parse(plain.toString()), vapid: /^vapid t=/.test(req.headers.authorization || ''), urgency: req.headers.urgency });
    } catch (e) { received.push({ error: e.message }); }
    res.statusCode = 201;
    res.end();
  });
});

const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
const newPush = (title, ms) => waitFor(() => received.find((m) => m.title?.includes(title)), ms);
const hhmm = (d) => d.toTimeString().slice(0, 5);

(async () => {
  await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
  const endpoint = `https://127.0.0.1:${pushServer.address().port}/push/abc`;
  const arp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-arp-')), 'arp.json');
  fs.writeFileSync(arp, JSON.stringify([{ ip: '192.168.1.23', mac: 'da:12:34:56:78:9a' }]));
  const hq = await startHQ({ env: { NODE_EXTRA_CA_CERTS: path.join(certDir, 'cert.pem'), SENTINEL_NO_RECON: '', SENTINEL_FAKE_ARP: arp } });

  const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const errors = [];
  let expectBad = false;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, permissions: ['notifications'] });
  // Headless Chromium has no real push service, so hand the page our pretend one.
  await ctx.addInitScript(({ endpoint, p256dh, auth }) => {
    if (!self.PushManager) return;
    let sub = null;
    const make = () => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth } }), unsubscribe: async () => { sub = null; return true; } });
    PushManager.prototype.subscribe = async function () { sub = make(); return sub; };
    PushManager.prototype.getSubscription = async function () { return sub; };
  }, { endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|favicon/.test(m.text()) && !(expectBad && /Failed to load resource/.test(m.text()))) errors.push(m.text()); });
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  const api = (url, method = 'GET', body) => page.evaluate(async ([url, method, body]) => { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; }, [url, method, body]);

  await page.goto(hq.url + '/');
  await page.fill('[name=pw]', 'secret1');
  await page.fill('[name=pw2]', 'secret1');
  await page.click('[data-gate] button');
  await page.waitForSelector('.boot', { state: 'detached', timeout: 8000 });

  // ---- turn alerts on for this device ----
  await page.click('[data-settings]');
  await page.click('[data-tab="alerts"]');
  await page.waitForSelector('[data-enable]');
  await page.fill('[data-enable] [name=label]', 'Aarav’s phone');
  await page.click('[data-enable] button');
  await page.waitForSelector('text=Alerts are on');
  check(true, 'pressing “Turn on alerts here” registers this device');
  check(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))), 'alert service worker installed');
  const welcome = await newPush('ALERTS ONLINE');
  check(!!welcome && welcome.vapid, 'welcome alert delivered, encrypted and signed (VAPID)');
  check(!received.some((m) => m.error), 'every push decrypts correctly');
  await page.click('[data-sub] [data-test]');
  check(!!(await newPush('test alert')), 'Test button delivers a test alert');
  await shot('alerts-tab');
  check((await page.textContent('[data-subs]')).includes('THIS DEVICE'), 'list marks this device');

  // ---- a pretend Agent (DOOR PANEL) talking to HQ like a phone would ----
  const { json: pair } = await api('/api/pair', 'POST');
  const claim = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ code: pair.code, ua: 'test' });
    const req = https.request(`${hq.url}/api/pair/claim`, { method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject); req.end(body);
  });
  const agentId = claim.agentId || claim.id || claim.agent?.id;
  await api(`/api/agents/${agentId}`, 'PATCH', { mission: 'panel', name: 'Front door' });
  const ws = new WebSocket(`wss://127.0.0.1:${hq.httpsPort}/ws`, { rejectUnauthorized: false });
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ t: 'hello', token: claim.token }));
  await new Promise((r) => ws.once('message', r));
  const agentEvent = (kind, message) => ws.send(JSON.stringify({ t: 'event', kind, message, data: {} }));

  agentEvent('knock', 'Knock knock at Front door!');
  const knock = await newPush('at the door');
  check(!!knock && /Knock knock/.test(knock.body), `DOOR PANEL press → “${knock?.title}” alert`);

  // ---- arrival ----
  const { json: r1 } = await api('/api/people', 'POST', { name: 'Alex' });
  await api('/api/devices/' + encodeURIComponent('da:12:34:56:78:9a'), 'PATCH', { personId: r1.people[0].id });
  const arrive = await newPush('Home');
  check(!!arrive && /Alex arrived home/.test(arrive.body), 'arrival alert: “Alex arrived home”');

  // ---- quiet hours: ordinary alerts are held back ----
  const now = new Date();
  await api('/api/settings', 'PATCH', { quietStart: hhmm(new Date(now - 3600e3)), quietEnd: hhmm(new Date(+now + 3600e3)) });
  const { json: subs } = await api('/api/push');
  await api(`/api/push/${subs.subs[0].id}`, 'PATCH', { rules: { door: true } });
  await api(`/api/agents/${agentId}`, 'PATCH', { mission: 'door' });
  await new Promise((r) => setTimeout(r, 300));
  const before = received.length;
  agentEvent('door', 'Door opened');
  await new Promise((r) => setTimeout(r, 1500));
  check(received.length === before, 'quiet hours: “door opened” (someone home) is not sent');

  // ---- nobody home: RED alert gets through even in quiet hours ----
  await api('/api/settings', 'PATCH', { mode: 'away' });
  await new Promise((r) => setTimeout(r, 300));
  agentEvent('door', 'Door opened');
  const red = await newPush('THREAT RED');
  check(!!red && red.urgency === 'high' && /nobody/.test(red.body), 'nobody home: “THREAT RED — Door opened” sent (high priority), even in quiet hours');
  await api('/api/settings', 'PATCH', { quietStart: '', quietEnd: '', mode: 'auto' });

  // ---- Agent goes offline (after HQ's 20 s grace for Wi-Fi blips) ----
  ws.terminate(); // like a phone whose battery died or that left the Wi-Fi
  console.log('  (waiting ~20 s for the offline grace period…)');
  const off = await newPush('Agent offline', 30000);
  check(!!off && /lost contact/.test(off.body), 'Agent offline alert');

  // ---- switches in the Alerts tab ----
  await page.click('[data-tab="general"]');
  await page.click('[data-tab="alerts"]');
  await page.waitForSelector('[data-rule="offline"]');
  await page.uncheck('[data-rule="offline"]');
  await page.waitForSelector('text=Saved');
  check((await api('/api/push')).json.subs[0].rules.offline === false, 'unticking a switch saves it');
  await page.fill('[data-quiet] [name=quietStart]', '22:00');
  await page.fill('[data-quiet] [name=quietEnd]', '07:00');
  await page.click('[data-quiet] button');
  await page.waitForSelector('text=Quiet 22:00–07:00');
  check((await api('/api/state')).json.settings.quietStart === '22:00', 'quiet hours saved');

  // ---- dead subscriptions are cleaned up; bad ones refused ----
  expectBad = true;
  await api('/api/push/subscribe', 'POST', { subscription: { endpoint: endpoint.replace('/push/abc', '/gone'), keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }, label: 'Old phone' });
  let cleaned = false;
  for (let i = 0; i < 30 && !cleaned; i++) { await new Promise((r) => setTimeout(r, 100)); const subs = (await api('/api/push')).json.subs; cleaned = subs.length === 1 && subs[0].label !== 'Old phone'; }
  check(cleaned, 'a phone that unsubscribed (push service says 410) is removed automatically');
  check((await api('/api/push/subscribe', 'POST', { subscription: { endpoint: 'javascript:alert(1)', keys: {} } })).status === 400, 'junk subscriptions refused');
  expectBad = false;

  // ---- turn off ----
  await page.click('[data-off]');
  await page.waitForSelector('[data-enable]');
  check((await api('/api/push')).json.subs.length === 0, '“Turn off on this device” removes it');
  check(!received.some((m) => m.error), 'all pushes were valid encrypted web-push messages');
  console.log(`  (${received.length} alerts delivered in total)`);

  pushServer.close();
  await finish(browser, hq, errors, 'alerts');
})().catch((e) => { console.error(e); process.exit(1); });
