// Every page script must at least parse (a typo would leave HQ or an Agent as a blank page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const files = ['hq', 'agent', 'shared'].flatMap((d) => walk(path.join(root, d))).filter((f) => !f.endsWith('sw.js'));

test(`all ${files.length} scripts parse`, () => {
  const bad = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: readFileSync(f, 'utf8'), encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${path.relative(root, f)}: ${(r.stderr.split('\n').find((l) => /Error/.test(l)) || r.stderr).trim()}`);
  }
  assert.deepEqual(bad, []);
});
