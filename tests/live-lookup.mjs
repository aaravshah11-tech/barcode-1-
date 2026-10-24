// Live check against the real Open Library / Google Books APIs.
// Run:  node tests/live-lookup.mjs  [isbn ...]
import { lookupIsbn } from '../js/tools/library/lookup.js';
import { toIsbn13 } from '../js/tools/library/isbn.js';

const isbns = process.argv.slice(2).length ? process.argv.slice(2) : ['9780747532699', '9780141439518'];
for (const raw of isbns) {
  const isbn = toIsbn13(raw);
  if (!isbn) { console.log(`${raw}: not a valid ISBN`); continue; }
  const t = Date.now();
  try {
    const b = await lookupIsbn(isbn);
    if (!b) { console.log(`${isbn}: not found (${Date.now() - t} ms)`); continue; }
    console.log(`\n${isbn}  (${Date.now() - t} ms, source: ${b.source})`);
    for (const k of ['title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'language', 'subjects', 'cover']) console.log(`  ${k.padEnd(10)} ${JSON.stringify(b[k])}`);
    console.log(`  description ${JSON.stringify((b.description || '').slice(0, 100))}…`);
  } catch (e) {
    console.log(`${isbn}: ${e.message}`);
  }
}
