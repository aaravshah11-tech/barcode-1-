// 🧾 Warranties & documents: receipts, warranties and manuals, with end dates,
// a link to the Inventory item, and where the box is kept.
import * as store from '../../core/store.js';
import * as L from '../../core/locations.js';
import { esc, icon, openSheet, toast, confirmDialog, debounce, formatDate, todayIso } from '../../core/ui.js';
import { downloadCsv } from '../../core/csv.js';
import * as D from './data.js';
import { KINDS, kindOf, docStatus, groupDocs, timeLeft, addMonths } from './logic.js';

const itemName = (id) => (id ? store.get('items', id)?.name || '' : '');
const firstImage = (docId) => D.imagesOf(docId)[0]?.data || '';
const thumb = (d) => { const src = firstImage(d.id); return src ? `<img class="doc-thumb" src="${esc(src)}" alt="" loading="lazy">` : `<span class="doc-thumb emoji" aria-hidden="true">${kindOf(d.kind).icon}</span>`; };
const endText = (d, now) => (d.expiry ? `${docStatus(d, now).key === 'expired' ? 'Ended' : 'Until'} ${formatDate(d.expiry)} · ${timeLeft(d.expiry, now)}` : 'No end date');

/** Make a photo small enough to sync but still readable (receipts have tiny print). */
function receiptImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.62));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

const viewImage = (src) => openSheet(`<img src="${esc(src)}" alt="Document photo" class="doc-full">`, { title: 'Photo' });

// ---------- list ----------
let query = '';
function renderList(root) {
  const st = { kind: store.getLocal('docs.kind', 'all') };
  root.innerHTML = `<div class="page-head"><h1>Warranties & documents</h1><a class="btn btn-primary" href="#/warranties/add">${icon('plus')} Add</a></div>
    <div class="toolbar" style="flex-wrap:wrap">
      <label class="search" style="flex:1;min-width:220px">${icon('search')}<span class="sr-only">Search documents</span><input type="search" data-q placeholder="Search by item, shop, notes…" value="${esc(query)}" autocomplete="off"></label>
      <div class="chips" role="group" aria-label="Kind">${[{ id: 'all', label: 'All' }, ...KINDS].map((k) => `<button class="chip chip-sm" data-kind="${k.id}" aria-pressed="${st.kind === k.id}">${k.label}</button>`).join('')}</div>
    </div>
    <div data-list></div>`;
  const draw = () => {
    const now = Date.now();
    const q = query.toLowerCase();
    const all = D.docs();
    const list = all.filter((d) => (st.kind === 'all' || d.kind === st.kind) && (!q || `${d.title} ${d.seller || ''} ${d.notes || ''} ${itemName(d.itemId)}`.toLowerCase().includes(q)));
    root.querySelector('[data-list]').innerHTML = !all.length
      ? `<div class="empty"><div class="art">🧾</div><h2>Keep receipts and warranties here</h2><p class="muted">Snap the receipt, set when the warranty ends, link it to the item and note where the box is. HomeBase reminds you before it runs out.</p><a class="btn btn-primary btn-lg" href="#/warranties/add">Add the first one</a></div>`
      : !list.length ? '<div class="empty"><p class="muted">Nothing matches.</p></div>'
      : groupDocs(list, now).map((g) => `<section class="section doc-group g-${g.key}"><div class="section-title">${esc(g.label)} <span class="muted">${g.docs.length}</span></div>
          <div class="rows">${g.docs.map((d) => `<a class="row" href="#/warranties/doc/${esc(d.id)}">${thumb(d)}<div class="grow">
            <div class="row-title">${esc(d.title)}</div>
            <div class="row-sub">${esc(kindOf(d.kind).label)}${d.itemId && itemName(d.itemId) ? ` · 📦 ${esc(itemName(d.itemId))}` : ''}${d.seller ? ` · ${esc(d.seller)}` : ''}</div>
            <div class="row-sub"><span class="ex ex-${g.key === 'soon' ? 'soon' : g.key}">${esc(endText(d, now))}</span>${d.box?.roomId ? ` · Box: ${esc(L.locationLabel(d.box))}` : ''}</div></div></a>`).join('')}</div></section>`).join('');
  };
  const search = debounce(draw, 100);
  root.querySelector('[data-q]').addEventListener('input', (e) => { query = e.target.value.trim(); search(); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    st.kind = b.dataset.kind;
    store.setLocal('docs.kind', st.kind);
    root.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'docs' || c.c === 'docImages' || c.c === 'items')) draw(); });
}

// ---------- one document ----------
function renderDoc(root, [id]) {
  const draw = () => {
    const d = D.getDoc(id);
    if (!d) { root.innerHTML = '<div class="empty"><h2>Not found</h2><a class="btn" href="#/warranties">Back</a></div>'; return; }
    const now = Date.now();
    const s = docStatus(d, now);
    const imgs = D.imagesOf(id);
    const item = d.itemId ? store.get('items', d.itemId) : null;
    root.innerHTML = `<div class="page-head"><a class="icon-btn" href="#/warranties" aria-label="Back">${icon('back')}</a><h1>${esc(d.title)}</h1>
        <a class="btn" href="#/warranties/edit/${esc(id)}">${icon('edit')} Edit</a></div>
      <div class="doc-status st-${s.key} card"><span class="doc-big" aria-hidden="true">${kindOf(d.kind).icon}</span><div class="grow">
        <b>${esc(kindOf(d.kind).label)}${d.expiry ? ` · ${esc(timeLeft(d.expiry, now))}` : ''}</b>
        <div class="small muted">${d.purchaseDate ? `Bought ${esc(formatDate(d.purchaseDate))}` : ''}${d.expiry ? ` · ${s.key === 'expired' ? 'ended' : 'until'} ${esc(formatDate(d.expiry))}` : ''}</div></div></div>
      ${imgs.length ? `<div class="doc-images">${imgs.map((im, i) => `<button class="doc-img" data-img="${esc(im.id)}" aria-label="Open photo ${i + 1}"><img src="${esc(im.data)}" alt=""></button>`).join('')}</div>` : ''}
      <div class="two-col section">
        <div><div class="section-title">The item</div>${item ? `<a class="card loc-card" href="#/inventory/item/${esc(item.id)}"><span class="ico">📦</span><span class="grow"><b>${esc(item.name)}</b><div class="small muted">${esc(L.locationLabel(item.location))}</div></span>${icon('chev', 'chev')}</a>`
          : `<div class="card muted">${d.itemId ? 'The linked item was deleted.' : 'Not linked to an Inventory item.'}</div>`}</div>
        <div><div class="section-title">Where the box is</div>${d.noBox ? '<div class="card muted">No box kept.</div>' : d.box?.roomId ? L.wherePathHtml(d.box) : '<div class="card muted">Not saved.</div>'}</div>
      </div>
      <dl class="card details section">${d.seller ? `<dt>Bought from</dt><dd>${esc(d.seller)}</dd>` : ''}${d.price ? `<dt>Price</dt><dd>${esc(d.price)}</dd>` : ''}${d.reference ? `<dt>Order / serial no.</dt><dd>${esc(d.reference)}</dd>` : ''}
        ${d.notes ? `<dt>Notes</dt><dd style="white-space:pre-line">${esc(d.notes)}</dd>` : ''}<dt>Added</dt><dd>${esc(formatDate(d.createdAt))}</dd></dl>
      <div class="section btn-row"><button class="btn btn-danger" data-del>${icon('trash')} Delete</button></div>`;
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.img) viewImage(store.get('docImages', b.dataset.img)?.data || '');
    if ('del' in b.dataset) {
      const d = D.getDoc(id);
      if (!(await confirmDialog({ title: `Delete “${d.title}”?`, message: 'Its photos are deleted too.', confirmLabel: 'Delete', danger: true }))) return;
      const saved = await D.removeDoc(id);
      location.hash = '#/warranties';
      toast('Deleted', { actionLabel: 'Undo', onAction: () => D.restoreDoc(saved) });
    }
  });
  draw();
  return store.onChange(({ changes }) => { if (changes.some((c) => (c.c === 'docs' && c.record.id === id) || (c.c === 'docImages' && c.record.docId === id) || c.c === 'items')) draw(); });
}

// ---------- add / edit ----------
function renderEdit(root, params, ctx) {
  const [mode, ...rest] = params; // add/<itemId?> or edit/<docId>
  const editing = mode === 'edit' ? D.getDoc(rest[0]) : null;
  const preItem = mode === 'add' ? rest[0] || '' : '';
  const pre = preItem ? store.get('items', preItem) : null;
  const d = editing ? { ...editing } : { kind: 'warranty', title: pre?.name || '', itemId: preItem, purchaseDate: todayIso(), expiry: '', box: pre?.location || null };
  let images = editing ? D.imagesOf(editing.id).map((i) => ({ id: i.id, data: i.data })) : [];
  let box = d.box || null;
  const items = store.all('items').sort((a, b) => a.name.localeCompare(b.name));
  root.innerHTML = `<div class="page-head"><a class="icon-btn" href="${editing ? `#/warranties/doc/${esc(editing.id)}` : '#/warranties'}" aria-label="Back">${icon('back')}</a><h1>${editing ? 'Edit' : 'Add a document'}</h1></div>
    <form class="doc-form card">
      <div class="field"><span class="field-label">What is it?</span><div class="chips" role="group" aria-label="Kind">${KINDS.map((k) => `<button type="button" class="chip chip-sm" data-k="${k.id}" aria-pressed="${d.kind === k.id}">${k.icon} ${k.label}</button>`).join('')}</div></div>
      <label class="field"><span>Title</span><input name="title" value="${esc(d.title || '')}" required placeholder="e.g. Washing machine warranty" autocomplete="off"></label>
      <label class="field"><span>Inventory item (optional)</span><select name="itemId"><option value="">— Not linked —</option>${items.map((i) => `<option value="${esc(i.id)}" ${i.id === d.itemId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
      <div class="field-row">
        <label class="field"><span>Bought on</span><input type="date" name="purchaseDate" value="${esc(d.purchaseDate || '')}"></label>
        <label class="field"><span>Ends on</span><input type="date" name="expiry" value="${esc(d.expiry || '')}"></label>
      </div>
      <div class="chips quick-dates" role="group" aria-label="Warranty length">${[[12, '1 year'], [24, '2 years'], [36, '3 years'], [60, '5 years'], [120, '10 years']].map(([m, l]) => `<button type="button" class="chip chip-sm" data-months="${m}">${l} from purchase</button>`).join('')}</div>
      <div class="field-row">
        <label class="field"><span>Bought from</span><input name="seller" value="${esc(d.seller || '')}" autocomplete="off" placeholder="Shop or website"></label>
        <label class="field"><span>Price</span><input name="price" value="${esc(d.price || '')}" autocomplete="off" inputmode="decimal"></label>
      </div>
      <label class="field"><span>Order / serial number</span><input name="reference" value="${esc(d.reference || '')}" autocomplete="off"></label>
      <div class="field"><span class="field-label">Photos of the receipt or document</span>
        <div class="doc-images edit" data-imgs></div>
        <div class="btn-row"><label class="btn btn-outline btn-sm">${icon('camera')} Take photo<input type="file" accept="image/*" capture="environment" data-photo hidden></label>
          <label class="btn btn-ghost btn-sm">Choose images<input type="file" accept="image/*" multiple data-photo hidden></label></div></div>
      <div class="field"><span class="field-label">Where’s the box?</span>
        <label class="check-row"><input type="checkbox" name="noBox" ${d.noBox ? 'checked' : ''}> No box kept</label>
        <div data-box ${d.noBox ? 'hidden' : ''}></div></div>
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="How to claim, phone number, what’s covered…">${esc(d.notes || '')}</textarea></label>
      <div class="btn-row"><a class="btn" href="${editing ? `#/warranties/doc/${esc(editing.id)}` : '#/warranties'}">Cancel</a><button class="btn btn-primary btn-lg">${editing ? 'Save' : 'Save document'}</button></div>
    </form>`;
  const f = root.querySelector('form');
  let kind = d.kind;
  const drawImages = () => {
    f.querySelector('[data-imgs]').innerHTML = images.map((im, i) => `<div class="doc-img"><img src="${esc(im.data)}" alt="Photo ${i + 1}"><button type="button" class="icon-btn doc-x" data-rm="${i}" aria-label="Remove photo ${i + 1}">${icon('close')}</button></div>`).join('') || '<p class="small muted">No photos yet.</p>';
  };
  drawImages();
  L.locationPicker(f.querySelector('[data-box]'), box, (v) => { box = v; });
  f.querySelectorAll('[data-photo]').forEach((inp) => inp.addEventListener('change', async () => {
    for (const file of inp.files) {
      if (images.length >= 6) { toast('Up to 6 photos per document'); break; }
      try { images.push({ data: await receiptImage(file) }); } catch (x) { toast(x.message, { kind: 'err' }); }
    }
    inp.value = '';
    drawImages();
  }));
  f.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.k) { kind = b.dataset.k; f.querySelectorAll('[data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
    if (b.dataset.months) {
      if (!f.purchaseDate.value) f.purchaseDate.value = todayIso();
      f.expiry.value = addMonths(f.purchaseDate.value, +b.dataset.months);
    }
    if (b.dataset.rm != null) { images.splice(+b.dataset.rm, 1); drawImages(); }
  });
  f.noBox.addEventListener('change', () => { f.querySelector('[data-box]').hidden = f.noBox.checked; });
  f.itemId.addEventListener('change', () => {
    const it = store.get('items', f.itemId.value);
    if (it && !f.title.value.trim()) f.title.value = it.name;
    if (it?.location?.roomId && !box?.roomId) {
      // Start the box picker at the item's place (fresh element so click handlers aren't doubled).
      box = it.location;
      const old = f.querySelector('[data-box]');
      const fresh = old.cloneNode(false);
      old.replaceWith(fresh);
      L.locationPicker(fresh, box, (v) => { box = v; });
    }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = f.title.value.trim();
    if (!title) return;
    const rec = await D.saveDoc({
      ...(editing || {}), kind, title, itemId: f.itemId.value, purchaseDate: f.purchaseDate.value, expiry: f.expiry.value,
      seller: f.seller.value.trim(), price: f.price.value.trim(), reference: f.reference.value.trim(), notes: f.notes.value.trim(),
      noBox: f.noBox.checked, box: f.noBox.checked || !box?.roomId ? null : box,
    }, images);
    toast(editing ? 'Saved' : `Saved ${title}`, { kind: 'ok' });
    location.hash = `#/warranties/doc/${rec.id}`;
  });
  ctx?.hideNav?.(false);
}

export default {
  routes: { '': renderList, doc: renderDoc, add: (root, p, ctx) => renderEdit(root, ['add', ...p], ctx), edit: (root, p, ctx) => renderEdit(root, ['edit', ...p], ctx) },
  nav: [
    { route: '', label: 'Documents', icon: 'list', match: ['', 'doc', 'edit'] },
    { route: 'add', label: 'Add', icon: 'plus', primary: true },
  ],
  exports: [{
    label: 'Warranties & documents (CSV)',
    run: () => downloadCsv('documents', [['Title', (d) => d.title], ['Kind', (d) => kindOf(d.kind).label], ['Item', (d) => itemName(d.itemId)], ['Bought', (d) => d.purchaseDate], ['Ends', (d) => d.expiry],
      ['Bought from', (d) => d.seller], ['Price', (d) => d.price], ['Reference', (d) => d.reference], ['Box', (d) => (d.box?.roomId ? L.locationLabel(d.box) : '')], ['Notes', (d) => d.notes], ['Photos', (d) => D.imagesOf(d.id).length]], D.docs()),
  }],
};
