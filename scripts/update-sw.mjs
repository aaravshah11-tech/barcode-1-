// Rewrites the offline file list (SHELL) and bumps VERSION in sw.js.
// Run after adding or renaming app files:  npm run sw
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) => readdirSync(join(root, dir)).flatMap((n) => {
  const p = dir ? `${dir}/${n}` : n;
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const files = ['./', 'index.html', 'manifest.webmanifest',
  ...walk('css'), ...walk('js'), ...walk('vendor'), ...walk('icons'), 'supabase/schema.sql']
  // heic2any is big and only needed for HEIC photos: it's cached the first time it's used instead.
  .filter((f) => !/\.map$/.test(f) && !/heic2any/.test(f));
let sw = readFileSync(join(root, 'sw.js'), 'utf8');
sw = sw.replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];`);
sw = sw.replace(/const VERSION = 'homebase-[^']*';|const VERSION = 'shelf-[^']*';/, `const VERSION = 'homebase-${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}';`);
writeFileSync(join(root, 'sw.js'), sw);
console.log(`sw.js: ${files.length} files`);
