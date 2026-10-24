// Book detail page with instant-save controls.
import * as store from '../store.js';
import { lookupIsbn } from '../lookup.js';
import { prettyIsbn } from '../isbn.js';
import { esc, icon, coverHtml, toast, openSheet, confirmDialog, formatDate, todayIso } from '../ui.js';
import { locationPicker } from '../components/location-picker.js';
import { openBookForm, ownerPicker, statusPicker, starsPicker } from '../components/book-form.js';

export function render(root, params) {
  const id = params[0];

  function draw() {
    const b = store.getBook(id);
    if (!b) {
      root.innerHTML = `<div class="empty"><div class="art">📕</div><h2>Book not found</h2><p class="muted">It may have been deleted.</p><a class="btn" href="#/">Back to library</a></div>`;
      return;
    }
    const p = store.locationParts(b.location);
    const details = [
      ['Publisher', b.publisher], ['Published', b.year], ['Pages', b.pages || ''], ['Language', b.language],
      ['ISBN-13', prettyIsbn(b.isbn13)], ['ISBN-10', b.isbn10], ['Added', formatDate(b.addedAt)],
      ['Info from', { openlibrary: 'Open Library', google: 'Google Books', manual: 'Entered by hand' }[b.source] || ''],
    ].filter(([, v]) => v);
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:4px;margin:-6px 0 8px -10px">
        <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button><span class="spacer" style="flex:1"></span>
        <button class="icon-btn fav-btn ${b.favourite ? 'on' : ''}" data-fav aria-pressed="${b.favourite}" aria-label="Favourite">${icon('heart')}</button>
        <button class="icon-btn" data-edit aria-label="Edit">${icon('edit')}</button>
      </div>
      ${b.needsLookup ? `<div class="banner banner-warn">${icon('wifiOff')}<div class="grow">Details will be filled in when you’re online.</div><button class="btn btn-sm" data-refresh>Try now</button></div>` : ''}
      ${b.incomplete ? `<div class="banner banner-warn">${icon('info')}<div class="grow">This book wasn’t found online. Add the title and a cover photo.</div><button class="btn btn-sm" data-edit>Edit</button></div>` : ''}
      <div class="book-hero">
        <div>${coverHtml(b)}</div>
        <div style="min-width:0">
          <h1>${esc(b.title)}</h1>
          ${b.subtitle ? `<div class="subtitle">${esc(b.subtitle)}</div>` : ''}
          <div class="authors">${esc((b.authors || []).join(', ') || 'Unknown author')}</div>
          <div data-stars></div>
          ${(b.subjects || []).length ? `<div class="chips" style="margin-top:8px">${b.subjects.slice(0, 6).map((s) => `<span class="chip chip-sm">${esc(s)}</span>`).join('')}</div>` : ''}
        </div>
      </div>

      <div class="section"><div class="section-title">Where it lives</div>
        <button class="card loc-card" data-move style="width:100%;text-align:left">
          <span class="ico">${icon('pin')}</span>
          <span class="grow">${p.room ? `<b>${esc(p.room)}</b><br><span class="muted">${esc([p.bookcase, p.shelf].filter(Boolean).join(' › ') || 'Anywhere in the room')}</span>` : '<b>No location yet</b><br><span class="muted">Tap to choose</span>'}</span>
          <span class="btn btn-sm">Move</span>
        </button>
      </div>

      <div class="section"><div class="section-title">Reading</div>
        <div data-status></div>
      </div>

      <div class="section"><div class="section-title">Owner</div><div data-owner></div></div>

      <div class="section"><div class="section-title">Lent out</div>
        <div class="card">${b.lentTo
          ? `<div style="display:flex;align-items:center;gap:12px"><div class="grow" style="flex:1"><b>${esc(b.lentTo)}</b><div class="muted small">since ${esc(formatDate(b.lentDate) || 'unknown date')}</div></div><button class="btn btn-sm btn-primary" data-returned>Got it back</button></div>`
          : `<form data-lend style="display:flex;gap:8px"><input name="who" placeholder="Lent to (name)" autocomplete="off"><button class="btn">Lend</button></form>`}</div>
      </div>

      <div class="section"><div class="section-title">Notes</div>
        <textarea data-notes placeholder="Anything to remember about this copy…">${esc(b.notes)}</textarea>
      </div>

      ${b.description ? `<div class="section"><div class="section-title">About this book</div>
        <p class="desc clamp" data-desc>${esc(b.description)}</p>
        ${b.description.length > 300 ? '<button class="btn btn-ghost btn-sm" data-more>Show more</button>' : ''}</div>` : ''}

      <div class="section"><div class="section-title">Details</div>
        <dl class="card details">${details.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </div>

      <div class="section btn-row">
        ${b.isbn13 ? `<button class="btn" data-refresh>${icon('refresh')} Refresh info</button>` : ''}
        <button class="btn btn-danger" data-delete>${icon('trash')} Delete</button>
      </div>`;

    starsPicker(root.querySelector('[data-stars]'), b.rating, (rating) => store.updateBook(id, { rating }));
    statusPicker(root.querySelector('[data-status]'), b.status, (status) => store.updateBook(id, { status }));
    ownerPicker(root.querySelector('[data-owner]'), b.owner, (owner) => store.updateBook(id, { owner }));
    root.querySelector('[data-notes]').addEventListener('change', (e) => store.updateBook(id, { notes: e.target.value.trim() }));
    root.querySelector('[data-lend]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const who = e.target.who.value.trim();
      if (who) store.updateBook(id, { lentTo: who, lentDate: todayIso() });
    });
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const b = store.getBook(id);
    if (!b && !('back' in t.dataset)) return;
    if ('back' in t.dataset) { history.length > 1 ? history.back() : (location.hash = '#/'); }
    else if ('fav' in t.dataset) store.updateBook(id, { favourite: !b.favourite });
    else if ('edit' in t.dataset) openBookForm(b);
    else if ('returned' in t.dataset) { await store.updateBook(id, { lentTo: '', lentDate: '' }); toast('Marked as returned', { kind: 'ok' }); }
    else if ('more' in t.dataset) { root.querySelector('[data-desc]').classList.toggle('clamp'); t.textContent = t.textContent === 'Show more' ? 'Show less' : 'Show more'; }
    else if ('move' in t.dataset) {
      let value = b.location;
      const s = openSheet(`<div data-loc></div><button class="btn btn-primary btn-lg btn-block" data-ok>Save location</button>`, { title: 'Move book' });
      const picker = locationPicker(s.body.querySelector('[data-loc]'), value);
      s.body.querySelector('[data-ok]').onclick = async () => {
        value = picker.value;
        await store.updateBook(id, { location: value });
        s.close();
        toast(`Moved to ${store.locationLabel(value)}`, { kind: 'ok' });
      };
    } else if ('refresh' in t.dataset) {
      t.disabled = true;
      try {
        const info = await lookupIsbn(b.isbn13);
        if (!info) { toast('Still not found online.', { kind: 'warn' }); t.disabled = false; return; }
        // Keep anything the user typed; fill empty fields and refresh cover/description.
        const patch = { needsLookup: false, incomplete: false, source: info.source };
        for (const [k, v] of Object.entries(info)) {
          const cur = b[k];
          const empty = !cur || (Array.isArray(cur) && !cur.length) || (k === 'title' && (b.incomplete || b.needsLookup));
          if (empty && v && (!Array.isArray(v) || v.length)) patch[k] = v;
        }
        await store.updateBook(id, patch);
        toast('Book info updated', { kind: 'ok' });
      } catch (err) {
        toast(err.offline ? 'You’re offline — try again later.' : 'Couldn’t update right now.', { kind: 'err' });
        t.disabled = false;
      }
    } else if ('delete' in t.dataset) {
      if (!(await confirmDialog({ title: 'Delete this book?', message: `“${b.title}” will be removed from your library.`, confirmLabel: 'Delete', danger: true }))) return;
      const prev = await store.deleteBook(id);
      location.hash = '#/';
      toast(`Deleted “${prev.title}”`, { actionLabel: 'Undo', onAction: () => store.restoreBook(prev) });
    }
  });

  draw();
  return store.onChange(({ changes }) => {
    if (changes.some((c) => c.store !== 'books' || c.record.id === id)) {
      if (document.activeElement?.matches('[data-notes], [data-lend] input')) return; // don't wipe what's being typed
      draw();
    }
  });
}
