// Local HTTPS certificate for HQ.
//
// Phones only allow the camera, microphone and motion sensors on https:// pages. HQ therefore makes
// its own small certificate authority ("SENTINEL Local CA"), installed once on each phone, and uses it
// to sign HQ's certificate for its network addresses. With mkcert installed it uses mkcert (which also
// trusts the CA on this computer); otherwise it uses OpenSSL, which comes with macOS and Linux.
//
// Files (in data/certs/, never committed): rootCA.pem (safe to share — this is what phones install),
// rootCA-key.pem (secret!), hq.pem + hq-key.pem (HQ's certificate), meta.json (what it covers).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { CERT_DIR, lanAddresses, hostName } from './config.js';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();
const has = (cmd) => { try { run(cmd, ['-version']); return true; } catch { try { run(cmd, ['version']); return true; } catch { return false; } } };

/** Names and addresses the certificate must cover. */
export function wantedNames(extra = []) {
  const host = hostName();
  const dns = [...new Set(['localhost', host, `${host}.local`, 'sentinel.local', ...extra.filter((x) => !/^\d+\.\d+\.\d+\.\d+$/.test(x))])];
  const ips = [...new Set(['127.0.0.1', ...lanAddresses().map((a) => a.address), ...extra.filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x))])];
  return { dns, ips };
}

const files = (dir) => ({ dir, ca: path.join(dir, 'rootCA.pem'), caKey: path.join(dir, 'rootCA-key.pem'), cert: path.join(dir, 'hq.pem'), key: path.join(dir, 'hq-key.pem'), meta: path.join(dir, 'meta.json') });

/** Make (or reuse) the certificate. Regenerates HQ's certificate when the network addresses change. */
export function ensureCerts({ dir = CERT_DIR, extra = [], force = false, log = console.log } = {}) {
  const f = files(dir);
  fs.mkdirSync(dir, { recursive: true });
  const want = wantedNames(extra);
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')); } catch { /* first run */ }
  const covered = meta && want.ips.every((ip) => meta.ips.includes(ip)) && want.dns.every((d) => meta.dns.includes(d));
  const fresh = meta && Date.now() < meta.expires - 30 * 86400000;
  if (!force && covered && fresh && fs.existsSync(f.cert) && fs.existsSync(f.key) && fs.existsSync(f.ca)) return load(f, meta);

  const names = { dns: [...new Set([...(meta?.dns || []), ...want.dns])], ips: [...new Set([...(meta?.ips || []), ...want.ips])] };
  let method;
  if (!process.env.SENTINEL_NO_MKCERT && has('mkcert')) {
    method = 'mkcert';
    try { run('mkcert', ['-install']); } catch { /* may need a password; the CA still works for phones */ }
    run('mkcert', ['-cert-file', f.cert, '-key-file', f.key, ...names.dns, ...names.ips]);
    fs.copyFileSync(path.join(run('mkcert', ['-CAROOT']), 'rootCA.pem'), f.ca);
  } else if (has('openssl')) {
    method = 'openssl';
    makeWithOpenssl(f, names);
  } else {
    throw new Error('Neither mkcert nor openssl was found. Install mkcert (see README) and run "npm run cert".');
  }
  meta = { ...names, method, created: Date.now(), expires: Date.now() + 820 * 86400000 };
  fs.writeFileSync(f.meta, JSON.stringify(meta, null, 2));
  log(`[certs] HTTPS certificate made with ${method} for: ${[...names.ips, ...names.dns].join(', ')}`);
  return load(f, meta);
}

function load(f, meta) {
  return { key: fs.readFileSync(f.key), cert: fs.readFileSync(f.cert), ca: fs.readFileSync(f.ca), caPath: f.ca, meta };
}

function makeWithOpenssl(f, names) {
  const cnf = path.join(os.tmpdir(), `sentinel-openssl-${process.pid}.cnf`);
  // Extensions phones insist on: a real CA for the root; serverAuth, SANs and < 825 days for HQ's certificate (iOS rule).
  fs.writeFileSync(cnf, `[req]
distinguished_name = dn
[dn]
[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[v3_leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${[...names.dns.map((d) => `DNS:${d}`), ...names.ips.map((i) => `IP:${i}`)].join(', ')}
`);
  try {
    if (!fs.existsSync(f.ca) || !fs.existsSync(f.caKey)) {
      run('openssl', ['req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
        '-keyout', f.caKey, '-out', f.ca, '-subj', `/O=SENTINEL/CN=SENTINEL Local CA (${hostName()})`, '-config', cnf, '-extensions', 'v3_ca']);
      try { fs.chmodSync(f.caKey, 0o600); } catch { /* windows */ }
    }
    const csr = path.join(f.dir, 'hq.csr');
    run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', f.key, '-out', csr, '-subj', '/O=SENTINEL/CN=SENTINEL HQ', '-config', cnf]);
    run('openssl', ['x509', '-req', '-in', csr, '-CA', f.ca, '-CAkey', f.caKey, '-CAcreateserial', '-out', f.cert, '-days', '820', '-sha256', '-extfile', cnf, '-extensions', 'v3_leaf']);
    fs.rmSync(csr, { force: true });
    try { fs.chmodSync(f.key, 0o600); } catch { /* windows */ }
  } finally { fs.rmSync(cnf, { force: true }); }
}
