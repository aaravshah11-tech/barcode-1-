// Runs every browser test: starts a static server on :8080 and two test relays on :8888/:8889
// (unless something is already listening there), then runs each tests/e2e-*.cjs in turn.
// Usage: npm run test:e2e [-- name ...]   e.g. npm run test:e2e -- golf photo
// Screenshots: set SHOTS=/some/folder.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['library', 'inventory', 'sports', 'photo', 'golf', 'hub', 'core', 'offline', 'supabase', 'a11y', 'perf'];
const only = process.argv.slice(2);
const tests = (only.length ? ALL.filter((t) => only.includes(t)) : ALL).map((t) => (t === 'supabase' ? 'supabase-e2e.cjs' : t === 'a11y' || t === 'perf' ? `${t}.cjs` : `e2e-${t}.cjs`));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

const listening = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});

async function staticServer(port) {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT) || !(await stat(file)).isFile()) throw new Error('404');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

const children = [];
const cleanup = () => { for (const c of children) c.kill(); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let server = null;
if (!(await listening(8080))) server = await staticServer(8080);
if (!(await listening(8888)) || !(await listening(8889))) {
  const b = spawn(process.execPath, [path.join(ROOT, 'scripts/test-brokers.cjs'), '8888', '8889'], { stdio: 'ignore' });
  children.push(b);
  for (let i = 0; i < 50 && !((await listening(8888)) && (await listening(8889))); i++) await new Promise((r) => setTimeout(r, 100));
}
if (process.env.SHOTS) await mkdir(process.env.SHOTS, { recursive: true });

const results = [];
for (const t of tests) {
  console.log(`\n━━ ${t}`);
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(ROOT, 'tests', t), process.env.SHOTS || ''], { stdio: 'inherit', cwd: ROOT });
    const timer = setTimeout(() => { console.log(`✗ ${t} timed out`); c.kill(); }, 5 * 60 * 1000);
    c.on('exit', (n) => { clearTimeout(timer); resolve(n ?? 1); });
  });
  results.push([t, code, Date.now() - started]);
}
server?.close();
cleanup();
console.log('\n━━ Summary');
for (const [t, code, ms] of results) console.log(`${code === 0 ? '✓' : '✗'} ${t} (${(ms / 1000).toFixed(1)} s)`);
const failed = results.filter(([, c]) => c !== 0).length;
console.log(failed ? `\n${failed} browser test file(s) failed` : '\nAll browser tests passed');
process.exit(failed ? 1 : 0);
