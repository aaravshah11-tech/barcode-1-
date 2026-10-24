// Rewrites the offline file list (SHELL) and sets VERSION in sw.js to a hash of those files,
// so phones pick up a new version whenever any app file changes (and CI can check it's current).
// Run after adding or renaming app files:  npm run sw
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) => readdirSync(join(root, dir)).sort().flatMap((n) => {
  const p = dir ? `${dir}/${n}` : n;
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const files = ['./', 'index.html', 'manifest.webmanifest',
  ...walk('css'), ...walk('js'), ...walk('vendor'), ...walk('icons'), 'supabase/schema.sql']
  // heic2any is big and only needed for HEIC photos: it's cached the first time it's used instead.
  .filter((f) => !/\.map$/.test(f) && !/heic2any/.test(f) && !/(^|\/)\.[^/]/.test(f));
let sw = readFileSync(join(root, 'sw.js'), 'utf8');
sw = sw.replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];`);
const hash = createHash('sha256');
for (const f of files) { hash.update(f); if (f !== './') hash.update(readFileSync(join(root, f))); }
sw = sw.replace(/const VERSION = 'homebase-[^']*';|const VERSION = 'shelf-[^']*';/, `const VERSION = 'homebase-${hash.digest('hex').slice(0, 12)}';`);
writeFileSync(join(root, 'sw.js'), sw);
console.log(`sw.js: ${files.length} files`);
