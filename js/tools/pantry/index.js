// 🥫 Pantry: food in the house with use-by dates, and a shared shopping list.
// Barcode lookups reuse Inventory's food lookup (Open Food Facts, then UPCitemdb).
import * as store from '../../core/store.js';
import { esc, icon, openSheet, toast, confirmDialog, debounce, plural } from '../../core/ui.js';
import { Scanner, cameraErrorMessage } from '../../core/scanner.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { lookupBarcode } from '../inventory/lookup.js';
import { downloadCsv } from '../../core/csv.js';
import * as D from './data.js';
import { STORAGE, storageOf, expiryStatus, groupPantry, suggestExpiry, addDays, QUICK, niceDay } from './logic.js';

const thumb = (f) => (f.photo ? `<img class="pantry-thumb" src="${esc(f.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pantry-thumb emoji" aria-hidden="true">${storageOf(f.storage).icon}</span>`);

/** Add/edit form in a sheet. Resolves when closed. */
export function openFoodForm(food = {}, { notice = '', onSaved } = {}) {
  const editing = !!food.id;
  const known = D.product(food.barcode);
  const f = { quantity: 1, storage: known?.storage || 'cupboard', expiry: editing ? food.expiry : suggestExpiry(known, Date.now()), ...food };
  const have = editing ? [] : D.byBarcode(food.barcode);
  const s = openSheet(`<form class="food-form">
      ${notice ? `<div class="banner banner-ok">${icon('info')}<div class="grow">${esc(notice)}</div></div>` : ''}
      ${have.length ? `<div class="banner banner-warn">${icon('info')}<div class="grow">You already have ${have.reduce((n, x) => n + (x.quantity || 1), 0)}${have[0].expiry ? ` (use by ${esc(niceDay(have[0].expiry, Date.now()))})` : ''}. Saving adds another batch with its own date.</div></div>` : ''}
      <div class="food-top">${f.photo ? `<img class="pantry-thumb big" src="${esc(f.photo)}" alt="" referrerpolicy="no-referrer">` : ''}
        <label class="field grow"><span>Name</span><input name="name" value="${esc(f.name || '')}" required autocomplete="off" placeholder="e.g. Semi-skimmed milk"></label></div>
      <div class="field-row">
        <label class="field"><span>How many</span><input name="quantity" type="number" inputmode="numeric" min="1" max="999" value="${esc(f.quantity || 1)}"></label>
        <label class="field"><span>Brand</span><input name="brand" value="${esc(f.brand || '')}" autocomplete="off"></label>
      </div>
      <div class="field"><span class="field-label">Kept in</span><div class="segmented" role="group" aria-label="Kept in">${STORAGE.map((x) => `<button type="button" data-st="${x.id}" aria-pressed="${f.storage === x.id}">${x.icon} ${x.label}</button>`).join('')}</div></div>
      <label class="field"><span>Use by / best before${known?.shelfDays && !editing ? ` <span class="muted">(usually lasts ${known.shelfDays} days)</span>` : ''}</span><input name="expiry" type="date" value="${esc(f.expiry || '')}"></label>
      <div class="chips quick-dates" role="group" aria-label="Quick dates">${QUICK.map(([l, n]) => `<button type="button" class="chip chip-sm" data-days="${n}">+${l}</button>`).join('')}<button type="button" class="chip chip-sm" data-days="">No date</button></div>
      <div class="btn-row" style="margin-top:14px">${editing ? `<button type="button" class="btn btn-danger" data-del>${icon('trash')} Remove</button>` : '<button type="button" class="btn" data-close>Cancel</button>'}<button class="btn btn-primary">${editing ? 'Save' : 'Add to pantry'}</button></div>
    </form>`, { title: editing ? 'Edit food' : 'Add food' });
  const form = s.body.querySelector('form');
  let storage = f.storage;
  if (!f.name) setTimeout(() => form.name.focus(), 60);
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.st) { storage = b.dataset.st; form.querySelectorAll('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
    if (b.dataset.days != null) form.expiry.value = b.dataset.days ? addDays(Date.now(), +b.dataset.days) : '';
    if ('del' in b.dataset) {
      const prev = await D.removeFood(food.id);
      s.close();
      toast(`Removed ${food.name}`, { actionLabel: 'Undo', onAction: () => D.restoreFood(prev) });
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    const rec = await D.saveFood({ ...f, name, brand: form.brand.value.trim(), quantity: Math.max(1, Math.round(+form.quantity.value || 1)), storage, expiry: form.expiry.value });
    s.close();
    onSaved?.(rec);
  });
  return s;
}

/** Use one up. At zero it's removed, with an offer to add it to the shopping list. */
async function useOne(f) {
  if ((f.quantity || 1) > 1) { await D.saveFood({ ...f, quantity: f.quantity - 1 }); return; }
  const prev = await D.removeFood(f.id);
  toast(`Finished ${f.name}`, { actionLabel: 'Add to shopping list', timeout: 6000, onAction: async () => { await D.addToShopping(f.name, { barcode: f.barcode || '' }); toast(`${f.name} added to the shopping list`, { kind: 'ok' }); } });
  return prev;
}

// ---------- list ----------
let query = '';
function renderPantry(root, params) {
  const st = { storage: store.getLocal('pantry.storage', 'all') };
  root.innerHTML = `<div class="page-head"><h1>Pantry</h1><a class="btn btn-primary" href="#/pantry/add">${icon('qr')} Scan / add</a><a class="btn" href="#/pantry/shopping" data-shop-link>${icon('list')} Shopping list</a></div>
    <div class="toolbar" style="flex-wrap:wrap">
      <label class="search" style="flex:1;min-width:220px">${icon('search')}<span class="sr-only">Search the pantry</span><input type="search" data-q placeholder="Search food…" value="${esc(query)}" autocomplete="off"></label>
      <div class="segmented" role="group" aria-label="Kept in">${[{ id: 'all', label: 'All' }, ...STORAGE].map((x) => `<button data-filter="${x.id}" aria-pressed="${st.storage === x.id}">${x.label}</button>`).join('')}</div>
    </div>
    <div data-list></div>`;
  const $ = (s) => root.querySelector(s);
  const draw = () => {
    const now = Date.now();
    const q = query.toLowerCase();
    const all = D.pantry();
    const list = all.filter((f) => (st.storage === 'all' || f.storage === st.storage) && (!q || `${f.name} ${f.brand || ''}`.toLowerCase().includes(q)));
    const open = D.shopping().filter((x) => !x.done).length;
    $('[data-shop-link]').innerHTML = `${icon('list')} Shopping list${open ? ` <span class="badge">${open}</span>` : ''}`;
    $('[data-list]').innerHTML = !all.length
      ? `<div class="empty"><div class="art">🥫</div><h2>Your pantry is empty</h2><p class="muted">Scan food as you put the shopping away. HomeBase reminds you before things go out of date.</p><a class="btn btn-primary btn-lg" href="#/pantry/add">Scan food</a></div>`
      : !list.length ? '<div class="empty"><p class="muted">Nothing matches.</p></div>'
      : `<p class="small muted">${plural(list.reduce((n, f) => n + (f.quantity || 1), 0), 'thing')}${list.length !== all.length ? ` shown of ${all.length} entries` : ''}</p>` + groupPantry(list, now).map((g) => `<section class="section pantry-group g-${g.key}"><div class="section-title">${esc(g.label)} <span class="muted">${g.items.length}</span></div>
        <div class="rows">${g.items.map((f) => { const ex = expiryStatus(f.expiry, now); return `<div class="row pantry-row" data-id="${esc(f.id)}">${thumb(f)}
          <button class="grow pantry-main" data-edit="${esc(f.id)}"><span class="row-title">${esc(f.name)}${(f.quantity || 1) > 1 ? ` <span class="qty">×${f.quantity}</span>` : ''}</span>
            <span class="row-sub">${storageOf(f.storage).label}${f.brand ? ` · ${esc(f.brand)}` : ''} · <span class="ex ex-${ex.key}">${esc(ex.text)}</span></span></button>
          <button class="icon-btn" data-cart="${esc(f.id)}" aria-label="Add ${esc(f.name)} to the shopping list" title="Add to shopping list">🛒</button>
          <button class="btn btn-sm" data-use="${esc(f.id)}" aria-label="Used one ${esc(f.name)}">−1</button></div>`; }).join('')}</div></section>`).join('');
  };
  const search = debounce(() => draw(), 100);
  $('[data-q]').addEventListener('input', (e) => { query = e.target.value.trim(); search(); });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.filter) { st.storage = b.dataset.filter; store.setLocal('pantry.storage', st.storage); root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }
    if (b.dataset.edit) openFoodForm(D.getFood(b.dataset.edit), { onSaved: (r) => toast(`Saved ${r.name}`, { kind: 'ok' }) });
    if (b.dataset.use) { const f = D.getFood(b.dataset.use); if (f) useOne(f); }
    if (b.dataset.cart) { const f = D.getFood(b.dataset.cart); await D.addToShopping(f.name, { barcode: f.barcode || '' }); toast(`${f.name} added to the shopping list`, { kind: 'ok' }); }
  });
  draw();
  if (params[0] && D.getFood(params[0])) openFoodForm(D.getFood(params[0]));
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'pantry' || c.c === 'shopping')) draw(); });
}

// ---------- scan / add ----------
function renderAdd(root, _p, ctx) {
  let busy = false;
  let last = { code: '', at: 0 };
  root.innerHTML = `<div class="scan-wrap">
    <h1>Add food</h1>
    <p class="muted">Scan the barcode, check the date, save. Products you’ve scanned before fill in instantly — even offline.</p>
    <div class="scanner-box"><div id="pantry-reader"></div><div class="scanner-msg" data-cam-msg>Starting camera…</div></div>
    <div class="scan-status" data-status aria-live="polite">Point the camera at a barcode.</div>
    <form class="manual" data-manual><input name="code" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off" aria-label="Barcode number"><button class="btn btn-primary">Go</button></form>
    <button class="btn btn-lg btn-block" data-nocode style="margin-top:14px">${icon('plus')} No barcode? Add by name</button>
  </div>`;
  const status = (t, cls = '') => { const el = root.querySelector('[data-status]'); el.textContent = t; el.className = `scan-status ${cls}`; };
  const scanner = new Scanner('pantry-reader', (text) => handle(text), {});
  const added = (r) => { feedback('ok'); toast(`Added ${r.name}${r.expiry ? ` · use by ${niceDay(r.expiry, Date.now())}` : ''}`, { kind: 'ok' }); };
  const afterSheet = () => {
    const t = setInterval(() => {
      if (!root.isConnected) return clearInterval(t);
      if (!document.querySelector('.sheet-backdrop')) { clearInterval(t); scanner.resume(); status('Point the camera at a barcode.'); }
    }, 300);
  };

  async function handle(raw) {
    const now = Date.now();
    const code = String(raw).replace(/\s/g, '');
    if (busy || (code === last.code && now - last.at < 3000)) return;
    last = { code, at: now };
    if (!/^\d{6,14}$/.test(code)) { status('That doesn’t look like a food barcode.', 'err'); return; }
    scanner.pause();
    const known = D.product(code);
    if (known) {
      feedback('ok');
      status(`Known: ${known.name}`, 'ok');
      openFoodForm({ barcode: code, name: known.name, brand: known.brand, photo: known.photo }, { onSaved: added });
      return afterSheet();
    }
    busy = true;
    status('Looking it up…', 'busy');
    let info = null, offline = false;
    try { info = await lookupBarcode(code); } catch (e) { offline = !!e.offline; }
    busy = false;
    if (!root.isConnected) return;
    feedback(info ? 'ok' : 'err');
    status(info ? `Found: ${info.name}` : offline ? 'You’re offline — type the name.' : 'Not found online — type the name.', info ? 'ok' : 'err');
    openFoodForm({ barcode: code, name: info?.name || '', brand: info?.brand || '', photo: info?.photo || '' }, {
      notice: info ? `Found on ${info.source}.` : '', onSaved: added,
    });
    afterSheet();
  }
  root.querySelector('[data-manual]').addEventListener('submit', (e) => { e.preventDefault(); unlockAudio(); last = { code: '', at: 0 }; handle(e.target.code.value.trim()); e.target.code.value = ''; });
  root.querySelector('[data-nocode]').addEventListener('click', () => { scanner.pause(); openFoodForm({}, { onSaved: added }); afterSheet(); });
  (async () => {
    const msg = root.querySelector('[data-cam-msg]');
    try { await scanner.start(); if (root.isConnected) msg.hidden = true; } catch (err) {
      const m = cameraErrorMessage(err);
      msg.innerHTML = `${icon('camera')}<b>${esc(m.title)}</b><div class="small" style="max-width:380px">${esc(m.text)}</div>`;
    }
  })();
  ctx?.hideNav?.(false);
  return () => scanner.stop();
}

// ---------- shopping list ----------
function renderShopping(root) {
  root.innerHTML = `<div class="page-head"><h1>Shopping list</h1></div>
    <form class="manual shop-add" data-add><input name="name" placeholder="Add something…" autocomplete="off" aria-label="Add to the shopping list" enterkeyhint="done"><button class="btn btn-primary">${icon('plus')} Add</button></form>
    <div data-list></div>
    <p class="small muted">Everyone in the household sees the same list, live. When you scan something into the pantry, it comes off the list by itself.</p>`;
  const draw = () => {
    const list = D.shopping();
    const done = list.filter((x) => x.done).length;
    root.querySelector('[data-list]').innerHTML = list.length ? `<div class="list shop-list">${list.map((x) => `<label class="list-item shop-item ${x.done ? 'done' : ''}">
        <input type="checkbox" data-tick="${esc(x.id)}" ${x.done ? 'checked' : ''}><span class="grow">${esc(x.name)}${(x.qty || 1) > 1 ? ` <span class="qty">×${x.qty}</span>` : ''}</span>
        <button type="button" class="icon-btn" data-del="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">${icon('close')}</button></label>`).join('')}</div>
      ${done ? `<div class="btn-row" style="margin-top:12px"><button class="btn" data-clear>Clear ${done} ticked</button><button class="btn btn-primary" data-putaway>${icon('box')} Put ticked in the pantry</button></div>` : ''}`
      : '<div class="empty"><div class="art">🛒</div><p class="muted">Nothing on the list.</p></div>';
  };
  root.querySelector('[data-add]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = e.target.name.value;
    e.target.name.value = '';
    await D.addToShopping(v);
    e.target.name.focus();
  });
  root.addEventListener('change', (e) => { if (e.target.dataset.tick) store.patch('shopping', e.target.dataset.tick, { done: e.target.checked }); });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.del) { e.preventDefault(); const prev = await store.remove('shopping', b.dataset.del); toast(`Removed ${prev.name}`, { actionLabel: 'Undo', onAction: () => store.restore('shopping', prev) }); }
    if ('clear' in b.dataset) {
      const done = D.shopping().filter((x) => x.done);
      for (const x of done) await store.remove('shopping', x.id);
      toast(`Cleared ${plural(done.length, 'thing')}`);
    }
    if ('putaway' in b.dataset) {
      const done = D.shopping().filter((x) => x.done);
      if (!(await confirmDialog({ title: `Put ${plural(done.length, 'thing')} in the pantry?`, message: 'They’re added with their usual dates where HomeBase knows them. You can change dates afterwards.', confirmLabel: 'Put away' }))) return;
      const now = Date.now();
      for (const x of done) {
        const p = D.product(x.barcode);
        await D.saveFood({ name: p?.name || x.name, brand: p?.brand || '', photo: p?.photo || '', barcode: x.barcode || '', quantity: x.qty || 1, storage: p?.storage || 'cupboard', expiry: suggestExpiry(p, now) });
        await store.remove('shopping', x.id);
      }
      toast(`${plural(done.length, 'thing')} put away`, { kind: 'ok', actionLabel: 'Open pantry', onAction: () => { location.hash = '#/pantry'; } });
    }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'shopping')) draw(); });
}

export default {
  routes: { '': renderPantry, item: renderPantry, add: renderAdd, shopping: renderShopping },
  nav: [
    { route: '', label: 'Pantry', icon: 'box', match: ['', 'item'] },
    { route: 'add', label: 'Scan / add', icon: 'qr', primary: true },
    { route: 'shopping', label: 'Shopping', icon: 'list' },
  ],
  exports: [{
    label: 'Pantry (CSV)',
    run: () => downloadCsv('pantry', [['Name', (f) => f.name], ['Brand', (f) => f.brand], ['Quantity', (f) => f.quantity], ['Kept in', (f) => storageOf(f.storage).label], ['Use by', (f) => f.expiry], ['Barcode', (f) => f.barcode]], D.pantry()),
  }],
};
