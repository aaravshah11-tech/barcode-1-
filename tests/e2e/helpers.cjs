// Test helpers: serves this folder like GitHub Pages does (under /barcode-1-/), runs a private
// PeerJS matchmaking server, and launches Chromium set up for WebRTC between local pages.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PeerServer } = require('peer');

const ROOT = path.join(__dirname, '../..');
const BASE = '/barcode-1-/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function startSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(BASE)) { res.statusCode = 404; return res.end('not found'); }
    let file = path.join(ROOT, decodeURIComponent(url.pathname.slice(BASE.length)));
    if (!file.startsWith(ROOT) || /node_modules|\.git|tests/.test(path.relative(ROOT, file))) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end('not found'); }
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** Starts the site + matchmaking server. Returns URLs for HQ, Agents and phones. */
exports.startWorld = async function startWorld() {
  const site = await startSite();
  const sigPort = 9300 + Math.floor(Math.random() * 600);
  const signal = PeerServer({ port: sigPort, host: '127.0.0.1', path: '/' });
  await new Promise((r) => setTimeout(r, 300));
  const root = `http://127.0.0.1:${site.address().port}${BASE}`;
  const sig = `signal=127.0.0.1:${sigPort}`;
  return {
    root, sig,
    hqUrl: `${root}hq/?${sig}`,
    agentUrl: `${root}agent/?${sig}`,
    remoteUrl: `${root}hq/remote.html?${sig}`,
    stopSignal: () => new Promise((r) => { try { signal.close(() => r()); } catch { r(); } setTimeout(r, 1000); }),
    stop: async () => { site.close(); try { signal.close(); } catch { /* ignore */ } },
  };
};

const WEBRTC = ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
exports.launch = (chromium, extra = []) => chromium.launch({ args: [...WEBRTC, ...extra] });

/** Calls HQ's API from the HQ page (the same thing its buttons do). */
exports.hqApi = (page) => (method, p, body) => page.evaluate(([m, pa, b]) => window.__hq.api(m, pa, b), [method, p, body]);

/** Gets past the boot sequence and the codename + PIN screen (enrolling the Director the first time). */
exports.login = async (page, { codename = 'TESTER', pin = '2468' } = {}) => {
  await page.waitForSelector('.boot, [data-login], [data-threat]', { timeout: 20000 }).catch(async (e) => { console.log('page shows:', (await page.textContent('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)); throw e; });
  if (await page.$('.boot')) { await page.click('.boot').catch(() => {}); await page.waitForSelector('.boot', { state: 'detached' }); }
  await page.waitForSelector('[data-login], [data-threat]', { timeout: 20000 });
  if (!(await page.$('[data-login]'))) return;
  await page.fill('[data-login] [name=codename]', codename);
  await page.fill('[data-login] [name=pin]', pin);
  if (await page.$('[data-login] [name=pin2]')) await page.fill('[data-login] [name=pin2]', pin);
  await page.click('[data-login] button');
  await page.waitForSelector('[data-threat]', { timeout: 20000 });
};

/** Opens HQ, logs in and waits for it to be online. */
exports.openHQ = async (page, world) => {
  await page.goto(world.hqUrl);
  await exports.login(page);
  await page.waitForSelector('[data-threat]', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-net]')?.textContent.includes('UPLINK ONLINE'), null, { timeout: 15000 });
};

/** Recruits a new Agent in `ctx` with a fresh code from HQ. */
exports.recruit = async (dash, ctx, world, { manual = false } = {}) => {
  const api = exports.hqApi(dash);
  const { code } = await api('POST', '/pair', { role: 'agent' });
  const hqId = (await api('GET', '/state')).info.hqId;
  const p = await ctx.newPage();
  await p.goto(`${world.agentUrl}#hq=${hqId}&pair=${code}`);
  await p.waitForFunction(() => window.__agent?.connected, null, { timeout: 20000 }).catch(async (e) => { console.log('agent page:', (await p.textContent('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)); throw e; });
  const id = (await api('GET', '/state')).agents.at(-1).id;
  return { p, id };
};

let failures = 0;
exports.check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };
exports.failures = () => failures;
exports.finish = async (browsers, world, errors, name) => {
  exports.check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  for (const b of [].concat(browsers)) await b?.close();
  await world?.stop();
  console.log(failures ? `\n${failures} FAILED` : `\nAll ${name} checks passed`);
  process.exit(failures ? 1 : 0);
};
