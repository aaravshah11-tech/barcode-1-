// Full add/edit form for a book, shown in a sheet. Also exports small reusable pickers.
import * as store from '../store.js';
import { esc, icon, openSheet, promptDialog, confirmDialog, resizeImage, coverHtml, toast, todayIso } from '../ui.js';
import { locationPicker } from './location-picker.js';
import { toIsbn13, isbn13to10 } from '../isbn.js';

/** Family-member chips. */
export function ownerPicker(container, value, onChange) {
  let current = value || '';
  const render = () => {
    container.innerHTML = `<div class="chips">
      ${store.owners().map((o) => `<button type="button" class="chip" data-owner="${esc(o)}" aria-pressed="${o === current}">${esc(o)}</button>`).join('')}
      <button type="button" class="chip chip-add" data-add-owner>${icon('plus')} Person</button></div>`;
  };
  container.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.owner != null) {
      current = current === b.dataset.owner ? '' : b.dataset.owner;
    } else if ('addOwner' in b.dataset) {
      const name = await promptDialog({ title: 'Add a family member', placeholder: 'Name', confirmLabel: 'Add' });
      if (!name) return;
      await store.addOwner(name);
      current = name.trim();
    } else return;
    render();
    onChange?.(current);
  });
  render();
  return { get value() { return current; } };
}

/** Read / Reading / Unread segmented control. */
export function statusPicker(container, value, onChange) {
  let current = value || 'unread';
  const render = () => {
    container.innerHTML = `<div class="segmented" role="group" aria-label="Read status">${store.STATUSES.map((s) => `<button type="button" data-status="${s.id}" aria-pressed="${s.id === current}">${s.label}</button>`).join('')}</div>`;
  };
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    current = b.dataset.status;
    render();
    onChange?.(current);
  });
  render();
  return { get value() { return current; } };
}

export function starsHtml(rating) {
  return `<div class="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= rating ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}" aria-pressed="${n <= rating}">${icon('star')}</button>`).join('')}</div>`;
}

export function starsPicker(container, value, onChange) {
  let current = value || 0;
  const render = () => { container.innerHTML = starsHtml(current); };
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    const n = +b.dataset.star;
    current = current === n ? 0 : n;
    render();
    onChange?.(current);
  });
  render();
  return { get value() { return current; } };
}

const list = (s) => String(s || '').split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);

/**
 * Open the book form.
 * @param {object} book   existing book, or partial info for a new one
 * @param {{title?:string, onSaved?:(book)=>void, notice?:string}} opts
 */
export function openBookForm(book = {}, { title, onSaved, notice = '' } = {}) {
  const isNew = !book.id;
  let cover = book.cover || '';
  const s = openSheet(`
    <form class="book-form" novalidate>
      ${notice ? `<div class="banner banner-warn">${icon('info')}<div class="grow">${esc(notice)}</div></div>` : ''}
      <div class="cover-edit">
        <div class="thumb" data-cover-preview>${coverHtml({ ...book, cover })}</div>
        <div style="display:flex;flex-direction:column;gap:8px;flex:1">
          <label class="btn btn-outline btn-sm">${icon('camera')} Photo of cover
            <input type="file" accept="image/*" capture="environment" data-photo hidden></label>
          <label class="btn btn-ghost btn-sm">Choose image<input type="file" accept="image/*" data-photo hidden></label>
          <button type="button" class="btn btn-ghost btn-sm" data-remove-cover ${cover ? '' : 'hidden'}>Remove cover</button>
        </div>
      </div>
      <label class="field"><span>Title *</span><input name="title" value="${esc(book.title)}" required autocomplete="off"></label>
      <label class="field"><span>Subtitle</span><input name="subtitle" value="${esc(book.subtitle)}" autocomplete="off"></label>
      <label class="field"><span>Author(s) — separate with commas</span><input name="authors" value="${esc((book.authors || []).join(', '))}" autocomplete="off"></label>
      <div class="section-title" style="margin-top:20px">Where it lives</div>
      <div data-loc></div>
      <div class="section-title" style="margin-top:20px">Your copy</div>
      <div class="picker-row"><span class="field-label">Owner</span><div data-owner></div></div>
      <div class="picker-row"><span class="field-label">Status</span><div data-status></div></div>
      <div class="picker-row"><span class="field-label">My rating</span><div data-stars></div></div>
      <label class="check-row"><input type="checkbox" name="favourite" ${book.favourite ? 'checked' : ''}> Favourite</label>
      <div class="field-row">
        <label class="field"><span>Lent to</span><input name="lentTo" value="${esc(book.lentTo)}" placeholder="Name" autocomplete="off"></label>
        <label class="field"><span>Lent on</span><input type="date" name="lentDate" value="${esc(book.lentDate)}"></label>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes">${esc(book.notes)}</textarea></label>
      <div class="section-title" style="margin-top:20px">Book details</div>
      <div class="field-row">
        <label class="field"><span>ISBN</span><input name="isbn" value="${esc(book.isbn13 || book.isbn10)}" inputmode="numeric" autocomplete="off"></label>
        <label class="field"><span>Year</span><input name="year" value="${esc(book.year)}" inputmode="numeric" autocomplete="off"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Publisher</span><input name="publisher" value="${esc(book.publisher)}" autocomplete="off"></label>
        <label class="field"><span>Pages</span><input name="pages" value="${esc(book.pages || '')}" inputmode="numeric" autocomplete="off"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Language</span><input name="language" value="${esc(book.language)}" autocomplete="off"></label>
        <label class="field"><span>Genres (commas)</span><input name="subjects" value="${esc((book.subjects || []).join(', '))}" autocomplete="off"></label>
      </div>
      <label class="field"><span>Description</span><textarea name="description">${esc(book.description)}</textarea></label>
      <p class="form-error" style="color:var(--danger);font-weight:600" hidden></p>
      <div class="btn-row" style="position:sticky;bottom:0;background:var(--bg);padding:10px 0 4px">
        <button type="button" class="btn" data-close>Cancel</button>
        <button class="btn btn-primary btn-lg">${isNew ? 'Add to library' : 'Save changes'}</button>
      </div>
    </form>`, { title: title || (isNew ? 'Add a book' : 'Edit book') });

  const form = s.body.querySelector('form');
  const loc = locationPicker(form.querySelector('[data-loc]'), book.location || (isNew ? store.getSetting('lastLocation') : null));
  const owner = ownerPicker(form.querySelector('[data-owner]'), book.owner ?? (isNew ? store.getSetting('lastOwner', '') : ''));
  const status = statusPicker(form.querySelector('[data-status]'), book.status);
  const stars = starsPicker(form.querySelector('[data-stars]'), book.rating);

  const preview = () => {
    form.querySelector('[data-cover-preview]').innerHTML = coverHtml({ title: form.title.value || book.title, authors: list(form.authors.value), cover });
    form.querySelector('[data-remove-cover]').hidden = !cover;
  };
  form.querySelectorAll('[data-photo]').forEach((input) => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try { cover = await resizeImage(file); preview(); } catch (e) { toast(e.message, { kind: 'err' }); }
    input.value = '';
  }));
  form.querySelector('[data-remove-cover]').onclick = () => { cover = ''; preview(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const t = form.title.value.trim();
    if (!t) { err.textContent = 'Please enter a title.'; err.hidden = false; form.title.focus(); return; }
    const rawIsbn = form.isbn.value.trim();
    const isbn13 = rawIsbn ? toIsbn13(rawIsbn) : '';
    if (rawIsbn && !isbn13) { err.textContent = 'That ISBN doesn’t look right. Check the digits or leave it empty.'; err.hidden = false; return; }
    const lentTo = form.lentTo.value.trim();
    const { allowDuplicate, ...rest } = book;
    const data = {
      ...rest,
      title: t,
      subtitle: form.subtitle.value.trim(),
      authors: list(form.authors.value),
      isbn13: isbn13 || '',
      isbn10: isbn13 ? isbn13to10(isbn13) : '',
      year: form.year.value.trim(),
      publisher: form.publisher.value.trim(),
      pages: parseInt(form.pages.value, 10) || 0,
      language: form.language.value.trim(),
      subjects: list(form.subjects.value),
      description: form.description.value.trim(),
      cover,
      location: loc.value,
      owner: owner.value,
      status: status.value,
      rating: stars.value,
      favourite: form.favourite.checked,
      lentTo,
      lentDate: lentTo ? form.lentDate.value || todayIso() : '',
      notes: form.notes.value.trim(),
      incomplete: false,
    };
    if (isNew && isbn13) {
      const dup = store.findByIsbn(isbn13)[0];
      if (dup && !book.allowDuplicate) {
        const ok = await confirmDialog({ title: 'Already in your library', message: `“${dup.title}” is at ${store.locationLabel(dup.location)}. Add another copy?`, confirmLabel: 'Add another copy' });
        if (!ok) return;
      }
    }
    const saved = await store.saveBook(data);
    if (isNew) {
      if (loc.value) await store.setSetting('lastLocation', loc.value);
      await store.setSetting('lastOwner', owner.value);
    }
    s.close();
    onSaved?.(saved);
  };
  return s;
}
