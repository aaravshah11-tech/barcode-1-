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
const files = ['./', 'index.html', 'manifest.webmanifest', 'changelog.json',
  ...walk('css'), ...walk('js'), ...walk('vendor'), ...walk('icons'), 'supabase/schema.sql']
  // heic2any is big and only needed for HEIC photos: it's cached the first time it's used instead.
  .filter((f) => !/\.map$/.test(f) && !/heic2any/.test(f) && !/(^|\/)\.[^/]/.test(f));
let sw = readFileSync(join(root, 'sw.js'), 'utf8');
sw = sw.replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];`);
// js/version.js is written from this hash, so it's left out of it.
const hash = createHash('sha256');
for (const f of files) { if (f === 'js/version.js') continue; hash.update(f); if (f !== './') hash.update(readFileSync(join(root, f))); }
sw = sw.replace(/const VERSION = 'homebase-[^']*';|const VERSION = 'shelf-[^']*';/, `const VERSION = 'homebase-${hash.digest('hex').slice(0, 12)}';`);
writeFileSync(join(root, 'sw.js'), sw);
// The app's own idea of its version, and what the website says is newest (Settings › Updates compares them).
const version = sw.match(/const VERSION = '([^']+)'/)[1];
const latest = Math.max(0, ...JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8')).map((e) => e.id));
writeFileSync(join(root, 'js/version.js'), `// Written by npm run sw — don't edit.\nexport const VERSION = '${version}';\nexport const CHANGELOG_ID = ${latest};\n`);
writeFileSync(join(root, 'version.json'), JSON.stringify({ version, changelog: latest }) + '\n');
console.log(`sw.js: ${files.length} files`);
