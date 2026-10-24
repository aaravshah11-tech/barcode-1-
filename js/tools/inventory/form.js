// Add / edit an inventory item.
import * as D from './data.js';
import * as L from '../../core/locations.js';
import { ownerPicker } from '../../core/people.js';
import { esc, icon, openSheet, promptDialog, resizeImage, toast, todayIso } from '../../core/ui.js';

export const thumbHtml = (i, cls = 'thumb-sq') => (i.photo ? `<img class="${cls}" src="${esc(i.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="${cls}" aria-hidden="true">📦</span>`);

function categoryChips(container, value, onChange) {
  let current = value || '';
  const render = () => {
    container.innerHTML = `<div class="chips">${D.categories().map((c) => `<button type="button" class="chip chip-sm" data-cat="${esc(c)}" aria-pressed="${c === current}">${esc(c)}</button>`).join('')}
      <button type="button" class="chip chip-sm chip-add" data-add-cat>${icon('plus')} Category</button></div>`;
  };
  container.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cat) current = current === b.dataset.cat ? '' : b.dataset.cat;
    else if ('addCat' in b.dataset) {
      const n = await promptDialog({ title: 'New category', placeholder: 'e.g. Camping', confirmLabel: 'Add' });
      if (!n) return;
      await D.addCategory(n);
      current = n.trim();
    } else return;
    render();
    onChange?.(current);
  });
  render();
  return { get value() { return current; } };
}

/** Open the item form. `item` may be partial (e.g. from a barcode lookup). */
export function openItemForm(item = {}, { onSaved, notice = '', title } = {}) {
  const isNew = !item.id;
  let photo = item.photo || '';
  const s = openSheet(`<form class="item-form" novalidate>
      ${notice ? `<div class="banner banner-warn">${icon('info')}<div class="grow">${esc(notice)}</div></div>` : ''}
      <div class="cover-edit">
        <div data-photo-preview style="width:96px;flex:none">${thumbHtml({ photo }, 'thumb-big')}</div>
        <div style="display:flex;flex-direction:column;gap:8px;flex:1">
          <label class="btn btn-outline btn-sm">${icon('camera')} Take photo<input type="file" accept="image/*" capture="environment" data-photo hidden></label>
          <label class="btn btn-ghost btn-sm">Choose image<input type="file" accept="image/*" data-photo hidden></label>
          <button type="button" class="btn btn-ghost btn-sm" data-remove-photo ${photo ? '' : 'hidden'}>Remove photo</button>
        </div>
      </div>
      <label class="field"><span>Name *</span><input name="name" value="${esc(item.name)}" placeholder="e.g. Cordless drill" autocomplete="off" required></label>
      <div class="picker-row"><span class="field-label">Category</span><div data-cat></div></div>
      <div class="section-title" style="margin-top:18px">Where it lives</div>
      <div data-loc></div>
      <div class="field-row">
        <label class="field"><span>Quantity</span><input name="quantity" type="number" min="0" step="1" inputmode="numeric" value="${esc(item.quantity ?? 1)}"></label>
        <label class="field"><span>Value each (${esc(D.currency())})</span><input name="value" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(item.value ?? '')}" placeholder="optional"></label>
      </div>
      <div class="picker-row"><span class="field-label">Condition</span><div class="segmented" data-condition>${D.CONDITIONS.map((c) => `<button type="button" data-cond="${c.id}" aria-pressed="${(item.condition || 'good') === c.id}">${c.label}</button>`).join('')}</div></div>
      <div class="picker-row"><span class="field-label">Owner</span><div data-owner></div></div>
      <div class="field-row">
        <label class="field"><span>Lent to</span><input name="lentTo" value="${esc(item.lentTo)}" placeholder="Name" autocomplete="off"></label>
        <label class="field"><span>Lent on</span><input type="date" name="lentDate" value="${esc(item.lentDate)}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Brand</span><input name="brand" value="${esc(item.brand)}" autocomplete="off"></label>
        <label class="field"><span>Barcode</span><input name="barcode" value="${esc(item.barcode)}" inputmode="numeric" autocomplete="off"></label>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes" placeholder="Serial number, warranty, where you bought it…">${esc(item.notes)}</textarea></label>
      <p class="form-error" style="color:var(--danger);font-weight:600" hidden></p>
      <div class="btn-row" style="position:sticky;bottom:0;background:var(--bg);padding:10px 0 4px">
        <button type="button" class="btn" data-close>Cancel</button>
        <button class="btn btn-primary btn-lg">${isNew ? 'Add item' : 'Save changes'}</button>
      </div></form>`, { title: title || (isNew ? 'Add an item' : 'Edit item') });
  const f = s.body.querySelector('form');
  const cat = categoryChips(f.querySelector('[data-cat]'), item.category);
  const loc = L.locationPicker(f.querySelector('[data-loc]'), item.location || (isNew ? L.lastLocation('inventory') : null));
  const owner = ownerPicker(f.querySelector('[data-owner]'), item.owner ?? '');
  let condition = item.condition || 'good';
  f.querySelector('[data-condition]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cond]');
    if (!b) return;
    condition = b.dataset.cond;
    f.querySelectorAll('[data-cond]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  });
  const preview = () => { f.querySelector('[data-photo-preview]').innerHTML = thumbHtml({ photo }, 'thumb-big'); f.querySelector('[data-remove-photo]').hidden = !photo; };
  f.querySelectorAll('[data-photo]').forEach((inp) => inp.addEventListener('change', async () => {
    const file = inp.files?.[0];
    if (!file) return;
    try { photo = await resizeImage(file, 480, 0.72); preview(); } catch (e) { toast(e.message, { kind: 'err' }); }
    inp.value = '';
  }));
  f.querySelector('[data-remove-photo]').onclick = () => { photo = ''; preview(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) { const er = f.querySelector('.form-error'); er.textContent = 'Please give it a name.'; er.hidden = false; f.name.focus(); return; }
    const lentTo = f.lentTo.value.trim();
    const saved = await D.saveItem({
      ...item, name, category: cat.value, location: loc.value, quantity: Math.max(0, parseInt(f.quantity.value, 10) || 0),
      value: f.value.value === '' ? '' : Number(f.value.value), condition, owner: owner.value, lentTo, lentDate: lentTo ? f.lentDate.value || todayIso() : '',
      brand: f.brand.value.trim(), barcode: f.barcode.value.trim(), notes: f.notes.value.trim(), photo,
    });
    if (isNew && loc.value) await L.setLastLocation('inventory', loc.value);
    s.close();
    onSaved?.(saved);
  };
  return s;
}
