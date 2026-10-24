// Fill in details for books saved while offline (or saved fast in batch mode).
import * as store from './data.js';
import { lookupIsbn } from './lookup.js';
import { prettyIsbn } from './isbn.js';

let running = null;

export function fillPendingLookups() {
  if (running) return running;
  running = (async () => {
    let updated = 0;
    for (const b of store.allBooks().filter((x) => x.needsLookup && x.isbn13)) {
      if (navigator.onLine === false) break;
      try {
        const info = await lookupIsbn(b.isbn13);
        const cur = store.getBook(b.id);
        if (!cur) continue;
        if (info) {
          // Keep anything the user typed in the meantime.
          const patch = { needsLookup: false, incomplete: false };
          for (const [k, v] of Object.entries(info)) {
            const c = cur[k];
            const placeholder = k === 'title' && /^ISBN /.test(c || '');
            if (placeholder || !c || (Array.isArray(c) && !c.length)) patch[k] = v;
          }
          await store.updateBook(b.id, patch);
        } else {
          await store.updateBook(b.id, { needsLookup: false, incomplete: true, title: /^ISBN /.test(cur.title) ? `Unknown book (${prettyIsbn(b.isbn13)})` : cur.title });
        }
        updated++;
      } catch (e) {
        if (e.offline) break;
      }
    }
    return updated;
  })().finally(() => { running = null; });
  return running;
}
