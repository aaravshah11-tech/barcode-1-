// SENTINEL HQ — start with:  npm start
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { DATA_DIR, HTTPS_PORT, HTTP_PORT, HOST, mainAddress, lanAddresses } from './config.js';
import { openDb } from './db.js';
import { ensureCerts } from './certs.js';
import { HQ } from './hq.js';
import { makeHandlers } from './http.js';
import { attachHub } from './hub.js';
import { startRecon } from './recon.js';
import { startAlerts } from './alerts.js';

export async function startHQ({ quiet = false, recon = true } = {}) {
  const log = quiet ? () => {} : console.log;
  const db = openDb(path.join(DATA_DIR, 'sentinel.db'));
  const certs = ensureCerts({ log });
  const hq = new HQ({ db, log }).start();
  const alerts = startAlerts({ hq, db, log });
  const reconApi = recon ? startRecon({ hq, db, log }) : null;
  const handlers = makeHandlers({ hq, db, certs, extra: { api: chainApi(alerts.api, reconApi?.api), publicApi: alerts.publicApi } });

  const secure = https.createServer({ key: certs.key, cert: certs.cert }, handlers.https);
  attachHub(secure, { hq, sessionOf: handlers.sessionOf });
  const plain = http.createServer(handlers.http);
  await Promise.all([listen(secure, HTTPS_PORT), listen(plain, HTTP_PORT)]);

  hq.logEvent({ kind: 'system', message: 'SENTINEL // HQ ONLINE' });
  if (!quiet) banner();
  const stop = async () => {
    hq.stop(); reconApi?.stop(); alerts.stop();
    await Promise.all([new Promise((r) => secure.close(r)), new Promise((r) => plain.close(r))]);
    db.close();
  };
  return { hq, db, stop };
}

const chainApi = (...fns) => async (...args) => {
  for (const f of fns.filter(Boolean)) { const r = await f(...args); if (r !== false) return r; }
  return false;
};

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use. Is HQ already running? (Close the other window, or set SENTINEL_HTTPS_PORT / SENTINEL_HTTP_PORT.)`) : e));
    server.listen(port, HOST, resolve);
  });
}

function banner() {
  const ip = mainAddress();
  const g = (s) => `\x1b[32m${s}\x1b[0m`;
  console.log(`
${g('  ███ SENTINEL // HQ ONLINE ███')}

  Command Centre (on this computer):  ${g(`https://localhost:${HTTPS_PORT}`)}
  Command Centre (other devices):     https://${ip}:${HTTPS_PORT}
  Recruit an Agent:                   open the Command Centre → RECRUIT → scan the QR code
  Phone setup page (certificate):     http://${ip}:${HTTP_PORT}
${lanAddresses().length > 1 ? `  Other addresses: ${lanAddresses().map((a) => a.address).join(', ')}\n` : ''}
  Keep this window open. Press Ctrl+C to stop HQ.
`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith(path.join('server', 'index.js'))) {
  startHQ({ recon: !process.env.SENTINEL_NO_RECON }).catch((e) => { console.error(`\n  HQ could not start: ${e.message}\n`); process.exit(1); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('\n  SENTINEL HQ standing down.'); process.exit(0); });
}
