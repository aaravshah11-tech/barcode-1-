// Starts a real HQ (separate process, throwaway data folder, test ports) for browser tests.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

// Every HQ a test starts is stopped when the test ends, even if it crashed.
const children = new Set();
process.on('exit', () => { for (const c of children) try { c.kill(); } catch {} });

let portBase = 9400 + Math.floor(Math.random() * 400);
exports.startHQ = async function startHQ(opts = {}, tries = 0) {
  try { return await launchHQ(opts); } catch (e) {
    // A leftover process may hold the port: try fresh ports (not when restarting on the same ones).
    if (!opts.reuse && tries < 4 && /already in use/.test(e.message)) { portBase += 37; return startHQ(opts, tries + 1); }
    throw e;
  }
};
async function launchHQ({ env = {}, reuse = null } = {}) {
  const data = reuse?.data || fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
  const httpsPort = reuse?.httpsPort || portBase++, httpPort = reuse?.httpPort || portBase++;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '../../server/index.js')], {
    env: { ...process.env, SENTINEL_DATA: data, SENTINEL_HTTPS_PORT: String(httpsPort), SENTINEL_HTTP_PORT: String(httpPort), SENTINEL_PUBLIC_IP: '127.0.0.1', SENTINEL_HOST: '127.0.0.1', SENTINEL_NO_MKCERT: '1', SENTINEL_NO_RECON: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (process.env.DEBUG) process.stdout.write(`[hq] ${d}`); });
  child.stderr.on('data', (d) => { out += d; if (process.env.DEBUG) process.stderr.write(`[hq] ${d}`); });
  const url = `https://127.0.0.1:${httpsPort}`;
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise((r) => https.get(`${url}/api/ping`, { rejectUnauthorized: false }, (res) => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)));
    if (ok) break;
    if (child.exitCode != null) throw new Error(`HQ exited:\n${out}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  return {
    url, httpUrl: `http://127.0.0.1:${httpPort}`, data, httpsPort, httpPort, log: () => out,
    stop: () => new Promise((r) => { child.once('exit', r); child.kill(); setTimeout(r, 2000); }),
  };
}

let failures = 0;
exports.check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };
exports.failures = () => failures;
exports.finish = async (browser, hq, errors, name) => {
  exports.check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser?.close();
  await hq?.stop();
  console.log(failures ? `\n${failures} FAILED` : `\nAll ${name} checks passed`);
  process.exit(failures ? 1 : 0);
};
