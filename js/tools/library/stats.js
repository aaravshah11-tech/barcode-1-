// Stats page.
import * as store from './data.js';
import { esc, plural } from '../../core/ui.js';

function tally(items) {
  const m = new Map();
  for (const x of items) if (x) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function bars(rows, { limit = 10, link } = {}) {
  if (!rows.length) return '<p class="muted small">Nothing yet.</p>';
  const max = rows[0][1];
  return `<div class="bars">${rows.slice(0, limit).map(([label, n]) => `
    <div class="bar-row"><span class="lbl" title="${esc(label)}">${esc(label)}</span>
      <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="display:block;width:${Math.max(2, (n / max) * 100)}%"></span></span>
      <span class="val">${n}</span></div>`).join('')}</div>`;
}

export function render(root) {
  function draw() {
    const books = store.allBooks();
    if (!books.length) {
      root.innerHTML = `<h1>Stats</h1><div class="empty"><div class="art">📊</div><p class="muted">Add some books and your stats will show up here.</p><a class="btn btn-primary" href="#/library/scan">Scan a book</a></div>`;
      return;
    }
    const n = books.length;
    const pages = books.reduce((s, b) => s + (+b.pages || 0), 0);
    const by = (s) => books.filter((b) => b.status === s).length;
    const read = by('read'), reading = by('reading'), unread = n - read - reading;
    const rated = books.filter((b) => b.rating);
    const avg = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : '–';
    const authors = tally(books.flatMap((b) => b.authors || []));
    const rooms = tally(books.map((b) => store.locationParts(b.location).room || 'No location'));
    const cases = tally(books.filter((b) => b.location?.roomId).map((b) => { const p = store.locationParts(b.location); return p.bookcase ? `${p.room} › ${p.bookcase}` : p.room; }));
    const genres = tally(books.flatMap((b) => b.subjects || []));
    const owners = tally(books.map((b) => b.owner || 'No owner'));
    const pct = (x) => (x / n) * 100;
    root.innerHTML = `<h1>Stats</h1>
      <div class="stat-grid">
        <div class="stat"><b>${n.toLocaleString()}</b><span>Books</span></div>
        <div class="stat"><b>${pages.toLocaleString()}</b><span>Total pages</span></div>
        <div class="stat"><b>${authors.length.toLocaleString()}</b><span>Authors</span></div>
        <div class="stat"><b>${avg}</b><span>Average rating</span></div>
        <div class="stat"><b>${books.filter((b) => b.favourite).length}</b><span>Favourites</span></div>
        <div class="stat"><b>${books.filter((b) => b.lentTo).length}</b><span>Lent out</span></div>
        <div class="stat"><b>${rooms.filter(([r]) => r !== 'No location').length}</b><span>Rooms with books</span></div>
        <div class="stat"><b>${books.filter((b) => b.addedAt > Date.now() - 30 * 864e5).length}</b><span>Added in last 30 days</span></div>
      </div>

      <div class="section card"><h2>Read vs unread</h2>
        <div class="stack" role="img" aria-label="${read} read, ${reading} reading, ${unread} unread">
          <div style="width:${pct(read)}%;background:var(--ok)"></div>
          <div style="width:${pct(reading)}%;background:var(--warn)"></div>
          <div style="width:${pct(unread)}%;background:var(--border)"></div>
        </div>
        <div class="legend">
          <span><i style="background:var(--ok)"></i>Read <b>${read}</b> (${Math.round(pct(read))}%)</span>
          <span><i style="background:var(--warn)"></i>Reading <b>${reading}</b></span>
          <span><i style="background:var(--border)"></i>Unread <b>${unread}</b></span>
        </div>
      </div>

      <div class="section two-col">
        <div class="card"><h2>Books per room</h2>${bars(rooms, { limit: 20 })}</div>
        <div class="card"><h2>Books per bookcase</h2>${bars(cases, { limit: 12 })}</div>
        <div class="card"><h2>Most common authors</h2>${bars(authors)}</div>
        <div class="card"><h2>Most common genres</h2>${bars(genres)}</div>
        <div class="card"><h2>By owner</h2>${bars(owners)}</div>
        <div class="card"><h2>Longest books</h2>${books.filter((b) => b.pages).sort((a, b) => b.pages - a.pages).slice(0, 5)
          .map((b) => `<a class="row" href="#/library/book/${esc(b.id)}" style="padding:6px 0"><div class="grow"><div class="row-title">${esc(b.title)}</div></div><b>${b.pages.toLocaleString()}</b></a>`).join('') || '<p class="muted small">No page counts yet.</p>'}</div>
      </div>
      <p class="muted small center" style="margin-top:18px">${plural(n, 'book')} · ${(pages / 300).toFixed(0)} average-length novels’ worth of pages</p>`;
  }
  draw();
  return store.onChange(draw);
}
