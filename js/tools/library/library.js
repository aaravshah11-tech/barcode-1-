// Library: grid / list of books with search, filters and sorting.
import * as store from './data.js';
import { link } from './data.js';
import { esc, icon, coverHtml, openSheet, debounce, plural } from '../../core/ui.js';

const PREFS_KEY = 'shelf.libraryPrefs';
const DEFAULT_PREFS = { view: 'grid', sort: 'added', filters: {} };
const SORTS = [
  ['added', 'Recently added'],
  ['title', 'Title A–Z'],
  ['author', 'Author A–Z'],
  ['rating', 'Highest rated'],
  ['room', 'Location'],
];
const FILTER_LABELS = { room: 'Room', author: 'Author', genre: 'Genre', status: 'Status', owner: 'Owner', lent: 'Lent out', fav: 'Favourites', incomplete: 'Needs details' };

let query = ''; // kept while the app is open
export let flashId = null;
export const setFlash = (id) => { flashId = id; };

function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

const sortName = (a) => (a || '').replace(/^(the|a|an)\s+/i, '').toLowerCase();
const authorKey = (b) => {
  const a = (b.authors || [])[0] || '';
  const parts = a.trim().split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] + ' ' + parts.slice(0, -1).join(' ') : a).toLowerCase() || '￿';
};

export function matches(b, q) {
  if (!q) return true;
  const hay = [b.title, b.subtitle, ...(b.authors || []), b.isbn13, b.isbn10, b.publisher, b.notes, b.owner, b.lentTo, ...(b.subjects || [])]
    .join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function applyFilters(books, f) {
  return books.filter((b) =>
    (!f.room || (f.room === '_none' ? !b.location?.roomId : b.location?.roomId === f.room)) &&
    (!f.author || (b.authors || []).includes(f.author)) &&
    (!f.genre || (b.subjects || []).includes(f.genre)) &&
    (!f.status || b.status === f.status) &&
    (!f.owner || (f.owner === '_none' ? !b.owner : b.owner === f.owner)) &&
    (!f.lent || (f.lent === 'yes' ? !!b.lentTo : !b.lentTo)) &&
    (!f.fav || b.favourite) &&
    (!f.incomplete || b.incomplete || b.needsLookup));
}

function sortBooks(books, sort) {
  const by = {
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    title: (a, b) => sortName(a.title).localeCompare(sortName(b.title)),
    author: (a, b) => authorKey(a).localeCompare(authorKey(b)) || sortName(a.title).localeCompare(sortName(b.title)),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || sortName(a.title).localeCompare(sortName(b.title)),
    room: (a, b) => store.locationLabel(a.location).localeCompare(store.locationLabel(b.location), undefined, { numeric: true }) || sortName(a.title).localeCompare(sortName(b.title)),
  }[sort] || (() => 0);
  return books.sort(by);
}

const statusBadge = (s) => (s && s !== 'unread' ? `<span class="status-dot status-${s}">${s === 'read' ? 'Read' : 'Reading'}</span>` : '');

function tileHtml(b) {
  return `<a class="tile${b.id === flashId ? ' flash' : ''}" href="#/library/book/${esc(b.id)}">
    ${coverHtml(b)}
    <div class="tile-flags">${b.favourite ? `<span class="flag flag-fav" title="Favourite">${icon('heart')}</span>` : ''}${b.lentTo ? `<span class="flag" title="Lent to ${esc(b.lentTo)}">${icon('hand')}</span>` : ''}</div>
    <div class="tile-title">${esc(b.title)}</div>
    <div class="tile-sub">${esc((b.authors || []).join(', ') || ' ')}</div></a>`;
}

export function rowHtml(b, { showLoc = true } = {}) {
  return `<a class="row${b.id === flashId ? ' flash' : ''}" href="#/library/book/${esc(b.id)}">
    <div class="thumb">${coverHtml(b)}</div>
    <div class="grow">
      <div class="row-title">${esc(b.title)}</div>
      <div class="row-sub">${esc((b.authors || []).join(', ') || 'Unknown author')}${b.year ? ` · ${esc(b.year)}` : ''}</div>
      ${showLoc ? `<div class="row-loc">${icon('pin')}${esc(store.locationLabel(b.location))}</div>` : ''}
      <div style="margin-top:3px;display:flex;gap:6px;flex-wrap:wrap">${statusBadge(b.status)}${b.lentTo ? `<span class="status-dot">Lent to ${esc(b.lentTo)}</span>` : ''}${b.needsLookup ? '<span class="status-dot">Details pending</span>' : b.incomplete ? '<span class="status-dot">Needs details</span>' : ''}</div>
    </div></a>`;
}

function filterValueLabel(key, v) {
  if (key === 'room') return v === '_none' ? 'No location' : store.getRoom(v)?.name || '?';
  if (key === 'status') return store.STATUSES.find((s) => s.id === v)?.label || v;
  if (key === 'lent') return v === 'yes' ? 'Lent out' : 'At home';
  if (key === 'owner' && v === '_none') return 'No owner';
  if (key === 'fav' || key === 'incomplete') return FILTER_LABELS[key];
  return v;
}

export function render(root) {
  const prefs = loadPrefs();
  root.innerHTML = `
    <div class="lib-head">
      <label class="search">${icon('search')}<span class="sr-only">Search</span>
        <input type="search" placeholder="Search title, author, ISBN…" value="${esc(query)}" data-q enterkeyhint="search" autocomplete="off"></label>
      <div class="toolbar">
        <button class="chip" data-filters>${icon('filter')} Filter <span data-fcount></span></button>
        <select data-sort aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}" ${v === prefs.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="spacer"></span>
        <button class="icon-btn" data-view aria-label="Switch view"></button>
      </div>
      <div class="chips" data-active></div>
    </div>
    <div data-link-banner></div>
    <div class="count-line" data-count></div>
    <div data-results></div>`;

  const $ = (s) => root.querySelector(s);

  function renderLinkBanner() {
    const st = link.getState();
    $('[data-link-banner]').innerHTML = st.role === 'host' && st.state === 'connected'
      ? `<div class="banner banner-ok">${icon('phone')}<div class="grow"><b>${esc(st.devices.join(', ') || 'Phone')} linked.</b> Books you scan on it appear here instantly.</div></div>`
      : '';
  }

  function renderResults() {
    const all = store.allBooks();
    const f = prefs.filters;
    const books = sortBooks(applyFilters(all, f).filter((b) => matches(b, query)), prefs.sort);
    const active = Object.entries(f).filter(([, v]) => v);
    $('[data-fcount]').innerHTML = active.length ? `<span class="badge">${active.length}</span>` : '';
    $('[data-active]').innerHTML = active.map(([k, v]) => `<button class="chip chip-sm" aria-pressed="true" data-clear="${k}">${esc(k === 'fav' || k === 'incomplete' ? FILTER_LABELS[k] : `${FILTER_LABELS[k]}: ${filterValueLabel(k, v)}`)} ${icon('close')}</button>`).join('');
    $('[data-view]').innerHTML = icon(prefs.view === 'grid' ? 'list' : 'grid');
    $('[data-view]').setAttribute('aria-label', prefs.view === 'grid' ? 'Show as list' : 'Show as grid');

    if (!all.length) {
      $('[data-count]').textContent = '';
      $('[data-results]').innerHTML = `<div class="empty"><div class="art">📚</div><h2>Your shelf is empty</h2>
        <p class="muted">Scan the barcode on the back of a book to add it. Got a whole shelf? Use batch mode.</p>
        <div class="btn-row" style="max-width:420px;margin:0 auto"><a class="btn btn-primary btn-lg" href="#/library/scan">Scan a book</a><a class="btn btn-lg" href="#/library/scan/batch">Batch scan</a></div>
        <p class="small muted" style="margin-top:18px">On a computer? <a href="#/settings/pair">Link your phone</a> and use it as the scanner.</p></div>`;
      return;
    }
    $('[data-count]').textContent = books.length === all.length ? plural(all.length, 'book') : `${books.length.toLocaleString()} of ${plural(all.length, 'book')}`;
    if (!books.length) {
      $('[data-results]').innerHTML = `<div class="empty"><div class="art">🔎</div><p class="muted">No books match.</p><button class="btn" data-reset>Clear search & filters</button></div>`;
      return;
    }
    $('[data-results]').innerHTML = prefs.view === 'grid'
      ? `<div class="grid">${books.map(tileHtml).join('')}</div>`
      : `<div class="rows">${books.map((b) => rowHtml(b)).join('')}</div>`;
    if (flashId) {
      root.querySelector('.flash')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { flashId = null; }, 1700);
    }
  }

  const onSearch = debounce(() => renderResults(), 120);
  $('[data-q]').addEventListener('input', (e) => { query = e.target.value.trim(); onSearch(); });
  $('[data-sort]').addEventListener('change', (e) => { prefs.sort = e.target.value; savePrefs(prefs); renderResults(); });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('view' in t.dataset) { prefs.view = prefs.view === 'grid' ? 'list' : 'grid'; savePrefs(prefs); renderResults(); }
    else if (t.dataset.clear) { delete prefs.filters[t.dataset.clear]; savePrefs(prefs); renderResults(); }
    else if ('reset' in t.dataset) { prefs.filters = {}; query = ''; $('[data-q]').value = ''; savePrefs(prefs); renderResults(); }
    else if ('filters' in t.dataset) openFilters(prefs, () => { savePrefs(prefs); renderResults(); });
  });

  renderLinkBanner();
  renderResults();
  const off1 = store.onChange(debounce(renderResults, 80));
  const off2 = link.onState(renderLinkBanner);
  return () => { off1(); off2(); };
}

function openFilters(prefs, onApply) {
  const books = store.allBooks();
  const count = (arr) => {
    const m = new Map();
    arr.forEach((x) => x && m.set(x, (m.get(x) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const authors = count(books.flatMap((b) => b.authors || []));
  const genres = count(books.flatMap((b) => b.subjects || []));
  const owners = count(books.map((b) => b.owner));
  const f = prefs.filters;
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === (cur || '') ? 'selected' : ''}>${esc(label)}</option>`;
  const s = openSheet(`<form>
    <label class="field"><span>Room</span><select name="room">${opt('', 'Any room', f.room)}${store.allRooms().map((r) => opt(r.id, r.name, f.room)).join('')}${opt('_none', 'No location', f.room)}</select></label>
    <label class="field"><span>Author</span><select name="author">${opt('', 'Any author', f.author)}${authors.map(([a, n]) => opt(a, `${a} (${n})`, f.author)).join('')}</select></label>
    <label class="field"><span>Genre</span><select name="genre">${opt('', 'Any genre', f.genre)}${genres.map(([g, n]) => opt(g, `${g} (${n})`, f.genre)).join('')}</select></label>
    <div class="field-row">
      <label class="field"><span>Status</span><select name="status">${opt('', 'Any', f.status)}${store.STATUSES.map((x) => opt(x.id, x.label, f.status)).join('')}</select></label>
      <label class="field"><span>Owner</span><select name="owner">${opt('', 'Anyone', f.owner)}${[...new Set([...store.owners(), ...owners.map(([o]) => o)])].map((o) => opt(o, o, f.owner)).join('')}${opt('_none', 'No owner', f.owner)}</select></label>
    </div>
    <label class="field"><span>Lent out</span><select name="lent">${opt('', 'Any', f.lent)}${opt('yes', 'Lent out', f.lent)}${opt('no', 'At home', f.lent)}</select></label>
    <label class="check-row"><input type="checkbox" name="fav" ${f.fav ? 'checked' : ''}> Favourites only</label>
    <label class="check-row"><input type="checkbox" name="incomplete" ${f.incomplete ? 'checked' : ''}> Needs details (not found online)</label>
    <div class="btn-row" style="margin-top:16px"><button type="button" class="btn" data-clear-all>Clear all</button><button class="btn btn-primary">Show books</button></div>
  </form>`, { title: 'Filter' });
  const form = s.body.querySelector('form');
  form.querySelector('[data-clear-all]').onclick = () => { prefs.filters = {}; s.close(); onApply(); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const nf = {};
    for (const k of ['room', 'author', 'genre', 'status', 'owner', 'lent']) if (form[k].value) nf[k] = form[k].value;
    if (form.fav.checked) nf.fav = true;
    if (form.incomplete.checked) nf.incomplete = true;
    prefs.filters = nf;
    s.close();
    onApply();
  };
}
