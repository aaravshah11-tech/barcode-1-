// npm run test:e2e [-- name ...]  — runs the browser tests in tests/e2e (each starts its own HQ).
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e');
const only = process.argv.slice(2);
const ORDER = ['dashboard', 'pairing', 'missions', 'recon', 'alerts', 'a11y'];
const rank = (n) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length);
const files = readdirSync(dir).filter((f) => f.endsWith('.cjs') && !['helpers.cjs', 'video.cjs'].includes(f)).map((f) => f.replace('.cjs', ''))
  .filter((n) => !only.length || only.includes(n)).sort((a, b) => rank(a) - rank(b));
if (process.env.SHOTS) mkdirSync(process.env.SHOTS, { recursive: true });
const results = [];
for (const n of files) {
  console.log(`\n━━ ${n}`);
  const t = Date.now();
  const code = await new Promise((r) => spawn(process.execPath, [path.join(dir, `${n}.cjs`), process.env.SHOTS || ''], { stdio: 'inherit' }).on('exit', (c) => r(c ?? 1)));
  results.push([n, code, Date.now() - t]);
}
console.log('\n━━ Summary');
for (const [n, c, ms] of results) console.log(`${c === 0 ? '✓' : '✗'} ${n} (${(ms / 1000).toFixed(1)} s)`);
const bad = results.filter(([, c]) => c).length;
console.log(bad ? `\n${bad} browser test file(s) failed` : '\nAll browser tests passed');
process.exit(bad ? 1 : 0);
