// Inventory screens: list, item detail, places, place contents.
import * as store from '../../core/store.js';
import * as D from './data.js';
import * as L from '../../core/locations.js';
import { family, nameOfDevice } from '../../core/people.js';
import { bars, tally } from '../../core/charts.js';
import { esc, icon, openSheet, debounce, plural, toast, confirmDialog, formatDate, todayIso } from '../../core/ui.js';
import { openItemForm, thumbHtml } from './form.js';

const PREFS = 'inventory.prefs';
let query = '';

export const itemRow = (i) => `<a class="row" href="#/inventory/item/${esc(i.id)}">${thumbHtml(i)}
  <div class="grow"><div class="row-title">${esc(i.name)}${(i.quantity ?? 1) !== 1 ? ` <span class="muted">×${esc(i.quantity)}</span>` : ''}</div>
    <div class="row-sub">${esc([i.category, i.brand, D.money(i.value)].filter(Boolean).join(' · ') || ' ')}</div>
    <div class="row-loc">${icon('pin')}${esc(L.locationLabel(i.location))}</div>
    ${i.lentTo ? `<span class="status-dot status-reading">Lent to ${esc(i.lentTo)}</span>` : ''}${i.condition === 'broken' ? ' <span class="status-dot">Broken</span>' : ''}</div></a>`;

export function renderList(root) {
  const prefs = { sort: 'name', filters: {}, ...store.getLocal(PREFS, {}) };
  root.innerHTML = `<div class="lib-head">
      <label class="search">${icon('search')}<span class="sr-only">Search</span><input type="search" placeholder="Search items, brands, notes…" value="${esc(query)}" data-q autocomplete="off"></label>
      <div class="toolbar">
        <button class="chip" data-filters>${icon('filter')} Filter <span data-fcount></span></button>
        <select data-sort aria-label="Sort">${[['name', 'Name A–Z'], ['added', 'Recently added'], ['value', 'Most valuable'], ['place', 'Location']].map(([v, l]) => `<option value="${v}" ${prefs.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="chips" data-active></div>
    </div>
    <div class="count-line" data-count></div><div data-results></div>`;
  const $ = (s) => root.querySelector(s);
  const save = () => store.setLocal(PREFS, prefs);
  const draw = () => {
    const all = D.items();
    const f = prefs.filters;
    let list = all.filter((i) => (!f.category || i.category === f.category) && (!f.room || i.location?.roomId === f.room) && (!f.owner || i.owner === f.owner)
      && (!f.condition || i.condition === f.condition) && (!f.lent || (f.lent === 'yes' ? !!i.lentTo : !i.lentTo)));
    if (query) {
      const ws = query.toLowerCase().split(/\s+/);
      list = list.filter((i) => { const h = [i.name, i.brand, i.category, i.notes, i.barcode, i.owner, i.lentTo, L.locationLabel(i.location)].join(' ').toLowerCase(); return ws.every((w) => h.includes(w)); });
    }
    const sorters = { name: (a, b) => a.name.localeCompare(b.name), added: (a, b) => (b.createdAt || 0) - (a.createdAt || 0), value: (a, b) => (Number(b.value) || 0) * (b.quantity || 1) - (Number(a.value) || 0) * (a.quantity || 1), place: (a, b) => L.locationLabel(a.location).localeCompare(L.locationLabel(b.location)) || a.name.localeCompare(b.name) };
    list.sort(sorters[prefs.sort] || sorters.name);
    const active = Object.entries(f).filter(([, v]) => v);
    $('[data-fcount]').innerHTML = active.length ? `<span class="badge">${active.length}</span>` : '';
    const lbl = (k, v) => ({ room: L.getRoom(v)?.name, lent: v === 'yes' ? 'Lent out' : 'At home', condition: D.CONDITIONS.find((c) => c.id === v)?.label }[k] || v);
    $('[data-active]').innerHTML = active.map(([k, v]) => `<button class="chip chip-sm" aria-pressed="true" data-clear="${k}">${esc(lbl(k, v))} ${icon('close')}</button>`).join('');
    if (!all.length) {
      $('[data-count]').textContent = '';
      $('[data-results]').innerHTML = `<div class="empty"><div class="art">📦</div><h2>Nothing here yet</h2><p class="muted">Scan a barcode, or take a photo and give it a name.</p>
        <a class="btn btn-primary btn-lg" href="#/inventory/add">Add your first item</a></div>`;
      return;
    }
    const value = D.totalValue(list);
    $('[data-count]').textContent = `${list.length === all.length ? plural(all.length, 'item') : `${list.length} of ${plural(all.length, 'item')}`}${value ? ` · worth about ${D.money(value)}` : ''}`;
    $('[data-results]').innerHTML = list.length ? `<div class="rows">${list.map(itemRow).join('')}</div>` : '<div class="empty"><p class="muted">No items match.</p></div>';
  };
  $('[data-q]').addEventListener('input', debounce((e) => { query = e.target.value.trim(); draw(); }, 120));
  $('[data-sort]').addEventListener('change', (e) => { prefs.sort = e.target.value; save(); draw(); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.clear) { delete prefs.filters[b.dataset.clear]; save(); draw(); }
    else if ('filters' in b.dataset) {
      const f = prefs.filters;
      const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === (cur || '') ? 'selected' : ''}>${esc(l)}</option>`;
      const s = openSheet(`<form>
        <label class="field"><span>Category</span><select name="category">${opt('', 'Any', f.category)}${D.categories().map((c) => opt(c, c, f.category)).join('')}</select></label>
        <label class="field"><span>Room</span><select name="room">${opt('', 'Any', f.room)}${L.allRooms().map((r) => opt(r.id, r.name, f.room)).join('')}</select></label>
        <div class="field-row"><label class="field"><span>Owner</span><select name="owner">${opt('', 'Anyone', f.owner)}${family().map((o) => opt(o, o, f.owner)).join('')}</select></label>
        <label class="field"><span>Condition</span><select name="condition">${opt('', 'Any', f.condition)}${D.CONDITIONS.map((c) => opt(c.id, c.label, f.condition)).join('')}</select></label></div>
        <label class="field"><span>Lent out</span><select name="lent">${opt('', 'Any', f.lent)}${opt('yes', 'Lent out', f.lent)}${opt('no', 'At home', f.lent)}</select></label>
        <div class="btn-row"><button type="button" class="btn" data-clear-all>Clear all</button><button class="btn btn-primary">Show items</button></div></form>`, { title: 'Filter' });
      const form = s.body.querySelector('form');
      form.querySelector('[data-clear-all]').onclick = () => { prefs.filters = {}; save(); s.close(); draw(); };
      form.onsubmit = (ev) => { ev.preventDefault(); prefs.filters = {}; for (const k of ['category', 'room', 'owner', 'condition', 'lent']) if (form[k].value) prefs.filters[k] = form[k].value; save(); s.close(); draw(); };
    }
  });
  draw();
  return store.onChange(debounce(draw, 80));
}

/** Warranties, receipts and manuals linked to this item (from the Warranties tool). */
function docsHtml(i) {
  const docs = store.all('docs').filter((d) => d.itemId === i.id);
  const now = Date.now();
  const line = (d) => {
    const left = d.expiry ? Math.round((new Date(d.expiry + 'T00:00').getTime() - now) / 86400000) : null;
    return `<a class="list-item" href="#/warranties/doc/${esc(d.id)}"><div class="grow"><b>${esc(d.title)}</b><div class="small muted">${d.expiry ? (left < 0 ? `Ended ${esc(formatDate(d.expiry))}` : `Until ${esc(formatDate(d.expiry))}`) : 'No end date'}</div></div>${icon('chev', 'chev')}</a>`;
  };
  return `<div class="section"><div class="section-title">Warranty & documents</div>
    ${docs.length ? `<div class="list">${docs.map(line).join('')}</div>` : ''}
    <a class="btn btn-sm" href="#/warranties/add/${esc(i.id)}" style="margin-top:8px">${icon('plus')} Add warranty or receipt</a></div>`;
}

export function renderItem(root, [id]) {
  const draw = () => {
    const i = D.item(id);
    if (!i) { root.innerHTML = `<div class="empty"><div class="art">📦</div><h2>Item not found</h2><a class="btn" href="#/inventory">Back</a></div>`; return; }
    root.innerHTML = `<div style="display:flex;gap:4px;margin:-6px 0 8px -10px"><a class="icon-btn" href="#/inventory" aria-label="Back">${icon('back')}</a><span class="spacer"></span>
        <button class="icon-btn" data-edit aria-label="Edit">${icon('edit')}</button></div>
      <div class="book-hero"><div>${i.photo ? `<img class="item-photo" src="${esc(i.photo)}" alt="" referrerpolicy="no-referrer">` : '<div class="item-photo ph">📦</div>'}</div>
        <div style="min-width:0"><h1>${esc(i.name)}</h1><div class="muted">${esc([i.brand, i.category].filter(Boolean).join(' · '))}</div>
          <div class="stat-grid" style="margin-top:12px;grid-template-columns:repeat(2,1fr)">
            <div class="stat"><b>${esc(i.quantity ?? 1)}</b><span>Quantity</span></div>
            <div class="stat"><b>${esc(D.money(i.value) || '–')}</b><span>Value each</span></div></div></div></div>
      <div class="section"><div class="section-title">Where it lives</div>
        <button class="card loc-card" data-move style="width:100%;text-align:left"><span class="ico">${icon('pin')}</span><span class="grow"><b>${esc(L.locationLabel(i.location))}</b></span><span class="btn btn-sm">Move</span></button></div>
      <div class="section"><div class="section-title">Lent out</div><div class="card">${i.lentTo
        ? `<div style="display:flex;align-items:center;gap:12px"><div style="flex:1"><b>${esc(i.lentTo)}</b><div class="muted small">since ${esc(formatDate(i.lentDate))}</div></div><button class="btn btn-sm btn-primary" data-returned>Got it back</button></div>`
        : `<form data-lend style="display:flex;gap:8px"><input name="who" placeholder="Lent to (name)" autocomplete="off"><button class="btn">Lend</button></form>`}</div></div>
      ${docsHtml(i)}
      <div class="section"><div class="section-title">Details</div><dl class="card details">
        <dt>Condition</dt><dd>${esc(D.CONDITIONS.find((c) => c.id === i.condition)?.label || '')}</dd>
        ${i.owner ? `<dt>Owner</dt><dd>${esc(i.owner)}</dd>` : ''}${i.barcode ? `<dt>Barcode</dt><dd>${esc(i.barcode)}</dd>` : ''}
        <dt>Added</dt><dd>${esc(formatDate(i.createdAt))}${nameOfDevice(i.createdBy) ? ` by ${esc(nameOfDevice(i.createdBy))}` : ''}</dd>${i.notes ? `<dt>Notes</dt><dd style="white-space:pre-line">${esc(i.notes)}</dd>` : ''}</dl></div>
      <div class="section btn-row"><button class="btn" data-dup>${icon('plus')} Add another like this</button><button class="btn btn-danger" data-del>${icon('trash')} Delete</button></div>`;
    root.querySelector('[data-lend]')?.addEventListener('submit', (e) => { e.preventDefault(); const w = e.target.who.value.trim(); if (w) store.patch('items', id, { lentTo: w, lentDate: todayIso() }); });
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = D.item(id);
    if (!i) return;
    if ('edit' in b.dataset) openItemForm(i);
    else if ('returned' in b.dataset) store.patch('items', id, { lentTo: '', lentDate: '' });
    else if ('move' in b.dataset) {
      const s = openSheet('<div data-loc></div><button class="btn btn-primary btn-lg btn-block" data-ok>Save location</button>', { title: 'Move item' });
      const p = L.locationPicker(s.body.querySelector('[data-loc]'), i.location);
      s.body.querySelector('[data-ok]').onclick = async () => { await store.patch('items', id, { location: p.value }); s.close(); toast(`Moved to ${L.locationLabel(p.value)}`, { kind: 'ok' }); };
    } else if ('dup' in b.dataset) {
      const { id: _, createdAt, updatedAt, updatedBy, ...copy } = i;
      openItemForm(copy, { onSaved: (n) => { location.hash = `#/inventory/item/${n.id}`; } });
    } else if ('del' in b.dataset) {
      if (!(await confirmDialog({ title: `Delete ${i.name}?`, confirmLabel: 'Delete', danger: true }))) return;
      const prev = await store.remove('items', id);
      location.hash = '#/inventory';
      toast(`Deleted ${prev.name}`, { actionLabel: 'Undo', onAction: () => store.restore('items', prev) });
    }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => (c.c === 'items' && c.record.id === id) || (c.c === 'docs' && (c.record.itemId === id || c.prev?.itemId === id))) && !root.contains(document.activeElement)) draw(); });
}

/** "What's inside?" for a room / area / box — opened from a QR label. */
export function renderPlace(root, [roomId, areaId = '', spotId = '']) {
  const draw = () => {
    const loc = { roomId, areaId, spotId };
    const parts = L.locationParts(loc);
    if (!parts.room) { root.innerHTML = `<div class="empty"><div class="art">❓</div><h2>Unknown place</h2><p class="muted">This label’s place was deleted, or this device hasn’t synced yet.</p><a class="btn" href="#/inventory/places">All places</a></div>`; return; }
    const its = D.itemsAt(loc);
    const books = store.all('books').filter((b) => b.location?.roomId === roomId && (!areaId || b.location.areaId === areaId) && (!spotId || b.location.spotId === spotId));
    root.innerHTML = `<div class="page-head"><h1>${esc(parts.spot || parts.area || parts.room)}</h1><button class="btn btn-primary" data-add>${icon('plus')} Add item here</button></div>
      <p class="muted">${esc(L.locationLabel(loc))}</p>
      <div class="section-title">${plural(its.length, 'item')} inside${D.totalValue(its) ? ` · ${D.money(D.totalValue(its))}` : ''}</div>
      ${its.length ? `<div class="rows">${its.sort((a, b) => a.name.localeCompare(b.name)).map(itemRow).join('')}</div>` : '<div class="card muted">Empty — or nothing recorded here yet.</div>'}
      ${books.length ? `<div class="section"><div class="section-title">📚 ${plural(books.length, 'book')} here too</div><div class="list">${books.slice(0, 50).map((b) => `<a class="list-item" href="#/library/book/${esc(b.id)}"><div class="grow">${esc(b.title)}</div>${icon('chev', 'chev')}</a>`).join('')}</div></div>` : ''}`;
  };
  root.addEventListener('click', (e) => { if (e.target.closest('[data-add]')) openItemForm({ location: { roomId, areaId, spotId } }); });
  draw();
  return store.onChange(debounce(draw, 80));
}

export function renderPlaces(root) {
  const draw = () => {
    const all = D.items();
    const byRoom = tally(all.map((i) => L.locationParts(i.location).room || 'No location'));
    const byCat = tally(all.map((i) => i.category || 'Uncategorised'));
    root.innerHTML = `<div class="page-head"><h1>Places</h1><a class="btn btn-sm" href="#/inventory/labels">${icon('print')} Print labels</a></div>
      ${L.allRooms().map((r) => `<div class="card room-card"><div class="room-head"><h3><a href="#/inventory/place/${esc(r.id)}" style="color:inherit">${esc(r.name)}</a></h3><span class="small muted">${plural(D.itemsAt({ roomId: r.id }).length, 'item')}</span></div>
        ${r.areas.map((a) => `<div class="case-row"><a class="grow" href="#/inventory/place/${esc(r.id)}/${esc(a.id)}" style="color:inherit"><b>${esc(a.name)}</b> <span class="small muted">· ${plural(D.itemsAt({ roomId: r.id, areaId: a.id }).length, 'item')}</span></a>
          <div class="chips" style="width:100%">${a.spots.map((s) => `<a class="chip chip-sm" href="#/inventory/place/${esc(r.id)}/${esc(a.id)}/${esc(s.id)}">${esc(s.name)} <span class="muted">${D.itemsAt({ roomId: r.id, areaId: a.id, spotId: s.id }).length}</span></a>`).join('')}</div></div>`).join('')}</div>`).join('')}
      <div class="two-col section"><div class="card"><h2>Items per room</h2>${bars(byRoom)}</div><div class="card"><h2>By category</h2>${bars(byCat)}</div></div>
      <p class="small muted">Add or rename rooms, cupboards and boxes in <a href="#/settings/locations">Settings › House locations</a>.</p>`;
  };
  draw();
  return store.onChange(debounce(draw, 80));
}
