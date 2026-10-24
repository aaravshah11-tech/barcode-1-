// Scan screen: Add, Find ("Where is it?") and Batch modes.
import * as store from '../store.js';
import * as link from '../sync/relay-link.js';
import { Scanner, cameraErrorMessage, listCameras } from '../scanner.js';
import { lookupIsbn } from '../lookup.js';
import { toIsbn13, isbn13to10, prettyIsbn } from '../isbn.js';
import { feedback, unlockAudio } from '../feedback.js';
import { esc, icon, coverHtml, openSheet, toast, formatDate, debounce } from '../ui.js';
import { locationPicker } from '../components/location-picker.js';
import { openBookForm, ownerPicker, statusPicker } from '../components/book-form.js';
import { rowHtml, matches, setFlash } from './library.js';

const MODES = { add: 'Add', where: 'Find', batch: 'Batch' };

/** Big "Room → Bookcase → Shelf" display for a book. */
export function whereHtml(b) {
  const p = store.locationParts(b.location);
  const steps = [['Room', p.room], ['Bookcase / area', p.bookcase], ['Shelf', p.shelf]].filter(([, v]) => v);
  return `<div class="found"><div class="thumb">${coverHtml(b)}</div><div style="min-width:0">
      <h2>${esc(b.title)}</h2><div class="muted">${esc((b.authors || []).join(', '))}</div>
      ${b.owner ? `<div class="small muted">Owner: ${esc(b.owner)}</div>` : ''}</div></div>
    ${steps.length ? `<div class="where-path">${steps.map(([k, v], i) => `<div class="where-step"><span class="num">${i + 1}</span><div><small>${k}</small><b>${esc(v)}</b></div></div>`).join('')}</div>`
      : `<div class="banner banner-warn">${icon('info')}<div class="grow">No location saved for this book yet.</div></div>`}
    ${b.lentTo ? `<div class="banner banner-warn">${icon('hand')}<div class="grow">Lent to <b>${esc(b.lentTo)}</b>${b.lentDate ? ` on ${esc(formatDate(b.lentDate))}` : ''}, so it may not be on the shelf.</div></div>` : ''}`;
}

export function render(root, params) {
  let mode = MODES[params[0]] ? params[0] : 'add';
  let busy = false;
  let last = { code: '', at: 0 };
  let session = []; // batch results: {id, isbn, kind, text}
  let torchOn = false;

  root.innerHTML = `<div class="scan-wrap">
    <div class="segmented" role="group" aria-label="Scan mode">${Object.entries(MODES).map(([k, v]) => `<button data-mode="${k}">${v === 'Find' ? 'Where is it?' : v}</button>`).join('')}</div>
    <div data-linked style="margin-top:12px"></div>
    <div data-batch-panel style="margin-top:12px"></div>
    <div class="scanner-box">
      <div id="reader"></div>
      <div class="scanner-tools"><button data-switch-cam aria-label="Switch camera" hidden>${icon('refresh')}</button><button data-torch aria-label="Torch" aria-pressed="false" hidden>${icon('torch')}</button></div>
      <div class="scanner-msg" data-cam-msg><div>Starting camera…</div></div>
    </div>
    <div class="scan-status" data-status aria-live="polite"></div>
    <div data-cam-tip></div>
    <form class="manual" data-manual>
      <input name="isbn" inputmode="numeric" placeholder="Or type the ISBN" autocomplete="off" enterkeyhint="go" aria-label="ISBN">
      <button class="btn btn-primary">Go</button>
    </form>
    <div data-mode-extra style="margin-top:14px"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);

  const status = (text, cls = '') => { const el = $('[data-status]'); el.textContent = text; el.className = `scan-status ${cls}`; };
  const idleText = () => ({
    add: 'Point the camera at the barcode on the back of the book.',
    where: 'Scan a book to see where it lives.',
    batch: 'Scan book after book. Each one saves automatically.',
  })[mode];

  // ---------- camera ----------
  const scanner = new Scanner('reader', (text) => handleCode(text, 'camera'));
  async function startCamera() {
    const msg = $('[data-cam-msg]');
    msg.hidden = false;
    msg.innerHTML = '<div>Starting camera…</div>';
    try {
      await scanner.start();
      if (!root.isConnected) return;
      msg.hidden = true;
      $('[data-torch]').hidden = !scanner.canTorch();
      renderCamTools();
    } catch (err) {
      if (!root.isConnected) return;
      const m = cameraErrorMessage(err);
      const desktop = !/Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
      msg.hidden = false;
      msg.innerHTML = `${icon('camera')}<b>${esc(m.title)}</b><div class="small" style="opacity:.85;max-width:380px">${esc(m.text)}</div>
        <div class="btn-row" style="justify-content:center"><button class="btn btn-sm" data-retry>Try again</button>
        ${desktop ? '<a class="btn btn-sm" href="#/link">Use my phone as scanner</a>' : ''}</div>`;
      msg.querySelector('[data-retry]').onclick = () => startCamera();
    }
  }
  // Camera switching (e.g. a Mac's own camera vs. an iPhone used as its webcam).
  async function renderCamTools() {
    const cams = await listCameras();
    if (!root.isConnected) return;
    $('[data-switch-cam]').hidden = cams.length < 2;
    const desktop = !/Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
    const current = cams.find((c) => c.id === scanner.currentCameraId());
    const usingIphone = current && /iphone|continuity/i.test(current.label);
    $('[data-cam-tip]').innerHTML = desktop && !usingIphone
      ? `<div class="banner" style="margin-top:10px">${icon('phone')}<div class="grow small"><b>Tip for Mac:</b> use your iPhone as the camera. Plug it in with a cable (or keep it close by), then tap ${cams.length > 1 ? 'the switch-camera button' : '“Try again”'} and choose your iPhone. Laptop cameras are blurry up close.</div></div>`
      : '';
  }
  $('[data-switch-cam]').onclick = async () => {
    const cams = await listCameras();
    const current = scanner.currentCameraId();
    scanner.pause();
    const s = openSheet(`<div class="list">${cams.map((c) => `<button class="list-item" data-cam="${esc(c.id)}">${icon(/iphone|continuity/i.test(c.label) ? 'phone' : 'camera')}<div class="grow">${esc(c.label)}</div>${c.id === current ? icon('check') : ''}</button>`).join('')}</div>`,
      { title: 'Choose camera', onClose: () => scanner.resume() });
    s.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cam]');
      if (!b) return;
      s.close();
      $('[data-cam-msg]').hidden = false;
      $('[data-cam-msg]').innerHTML = '<div>Switching camera…</div>';
      try { await scanner.switchTo(b.dataset.cam); $('[data-cam-msg]').hidden = true; renderCamTools(); } catch { startCamera(); }
    });
  };
  $('[data-torch]').onclick = async () => {
    torchOn = !torchOn;
    if (await scanner.setTorch(torchOn)) $('[data-torch]').setAttribute('aria-pressed', torchOn);
  };

  // ---------- mode UI ----------
  function renderLinked() {
    const st = link.getState();
    $('[data-linked]').innerHTML = st.role === 'guest'
      ? st.state === 'connected'
        ? `<div class="banner banner-ok" style="margin:0">${icon('laptop')}<div class="grow">Linked to your computer. Scans show up there instantly.</div></div>`
        : `<div class="banner banner-warn" style="margin:0">${icon('link')}<div class="grow">Your computer isn’t connected right now (is Shelf open on it?). Scans are saved here and sent when it reconnects.</div></div>`
      : '';
  }

  function batchLoc() { return store.getSetting('batchLocation') || store.getSetting('lastLocation'); }

  function renderBatchPanel() {
    const panel = $('[data-batch-panel]');
    if (mode !== 'batch') { panel.innerHTML = ''; return; }
    const loc = batchLoc();
    const owner = store.getSetting('batchOwner', store.getSetting('lastOwner', ''));
    const added = session.filter((s) => s.kind === 'ok').length;
    panel.innerHTML = `<div class="loc-bar">
      <div class="grow"><span class="small muted">Saving to</span><b>${esc(loc ? store.locationLabel(loc) : 'Choose a location')}</b>
      ${owner ? `<span class="small muted">Owner: ${esc(owner)}</span>` : ''}</div>
      <div class="center"><div class="counter" data-counter>${added}</div><div class="small muted">added</div></div>
      <button class="btn btn-sm" data-change-loc>Change</button></div>`;
  }

  function renderExtra() {
    const extra = $('[data-mode-extra]');
    if (mode === 'add') {
      extra.innerHTML = `<button class="btn btn-ghost btn-block" data-hand>${icon('edit')} No barcode? Add a book by hand</button>`;
    } else if (mode === 'where') {
      extra.innerHTML = `<label class="search">${icon('search')}<span class="sr-only">Search</span>
          <input type="search" placeholder="Or search by title or author" data-where-q autocomplete="off"></label>
        <div class="rows" data-where-results style="margin-top:8px"></div>`;
      const q = extra.querySelector('[data-where-q]');
      q.addEventListener('input', debounce(() => {
        const v = q.value.trim();
        const res = v ? store.allBooks().filter((b) => matches(b, v)).slice(0, 30) : [];
        extra.querySelector('[data-where-results]').innerHTML = v && !res.length
          ? '<p class="muted center">Nothing found in your library.</p>'
          : res.map((b) => rowHtml(b)).join('');
      }, 100));
    } else {
      extra.innerHTML = `<div class="section-title">This session</div><div class="rows recent" data-recent></div>`;
      renderRecent();
    }
  }

  function renderRecent() {
    const el = root.querySelector('[data-recent]');
    if (!el) return;
    if (!session.length) { el.innerHTML = '<p class="muted small" style="margin-left:4px">Scanned books will appear here.</p>'; return; }
    el.innerHTML = session.slice(0, 30).map((s) => {
      const b = store.getBook(s.id);
      const tag = { ok: '<span class="tag tag-ok">Added</span>', dup: '<span class="tag tag-dup">Already have</span>', err: '<span class="tag tag-err">Error</span>' }[s.kind];
      if (!b) return `<div class="row"><div class="grow"><div class="row-title">${esc(s.text || prettyIsbn(s.isbn))}</div><div class="row-sub">${s.kind === 'ok' ? 'Removed' : ''}</div></div>${tag}</div>`;
      const sub = b.needsLookup ? (navigator.onLine ? 'Looking up…' : 'Offline — details later') : b.incomplete ? 'Not found online — tap to add details' : (b.authors || []).join(', ');
      return `<div class="row"><a class="thumb" href="#/book/${esc(b.id)}">${coverHtml(b)}</a>
        <a class="grow" href="#/book/${esc(b.id)}" style="color:inherit;text-decoration:none"><div class="row-title">${esc(b.title)}</div><div class="row-sub">${esc(s.kind === 'dup' ? store.locationLabel(b.location) : sub)}</div></a>
        ${tag}${s.kind === 'ok' ? `<button class="icon-btn" data-undo="${esc(b.id)}" aria-label="Undo">${icon('trash')}</button>` : ''}</div>`;
    }).join('');
  }

  function setMode(m, { push = true } = {}) {
    mode = m;
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m));
    if (push) history.replaceState(null, '', m === 'add' ? '#/scan' : `#/scan/${m}`);
    document.dispatchEvent(new CustomEvent('shelf:route'));
    renderBatchPanel();
    renderExtra();
    status(idleText());
    if (m === 'batch' && !batchLoc()) chooseBatchLocation();
  }

  function chooseBatchLocation() {
    unlockAudio();
    scanner.pause();
    let ownerVal = store.getSetting('batchOwner', store.getSetting('lastOwner', ''));
    const s = openSheet(`<p class="muted">Every book you scan will be saved here. You can change it any time.</p>
      <div data-loc></div><div class="picker-row"><span class="field-label">Owner (optional)</span><div data-owner></div></div>
      <button class="btn btn-primary btn-lg btn-block" data-done>Start scanning</button>`,
    { title: 'Where are these books going?', onClose: () => { scanner.resume(); renderBatchPanel(); } });
    const picker = locationPicker(s.body.querySelector('[data-loc]'), batchLoc());
    ownerPicker(s.body.querySelector('[data-owner]'), ownerVal, (v) => { ownerVal = v; });
    s.body.querySelector('[data-done]').onclick = async () => {
      unlockAudio();
      await store.setSetting('batchLocation', picker.value);
      if (picker.value) await store.setSetting('lastLocation', picker.value);
      await store.setSetting('batchOwner', ownerVal);
      s.close();
    };
  }

  // ---------- scan handling ----------
  async function handleCode(raw, source) {
    const now = Date.now();
    const sameAsLast = raw === last.code && now - last.at < (mode === 'batch' ? 4000 : 2500);
    last = { code: raw, at: now };
    if (busy || sameAsLast) return;

    const isbn = toIsbn13(raw);
    if (!isbn) {
      if (source === 'camera' && link.codeFromText(raw)) { location.hash = `#/link/${link.codeFromText(raw)}`; return; }
      status(source === 'camera' ? 'That barcode isn’t a book ISBN. Look for the one starting 978 or 979.' : 'That ISBN doesn’t look right — check the digits.', 'err');
      if (source === 'camera') feedback('err');
      return;
    }

    if (mode === 'where') return showWhere(isbn);
    const existing = store.findByIsbn(isbn);
    if (mode === 'batch') return batchAdd(isbn, existing);
    if (existing.length) return showDuplicate(isbn, existing);
    return addFlow(isbn);
  }

  function showWhere(isbn) {
    const found = store.findByIsbn(isbn);
    feedback(found.length ? 'ok' : 'err');
    scanner.pause();
    status(found.length ? 'Found it!' : 'Not in your library.', found.length ? 'ok' : 'err');
    const s = openSheet(found.length
      ? found.map(whereHtml).join('<hr style="border:0;border-top:1px solid var(--border);margin:18px 0">') +
        `<div class="btn-row" style="margin-top:12px"><a class="btn" href="#/book/${esc(found[0].id)}">Open book</a><button class="btn btn-primary" data-close>Scan another</button></div>`
      : `<div class="empty" style="padding:16px"><div class="art">🤷</div><h2>Not in your library</h2><p class="muted">ISBN ${esc(prettyIsbn(isbn))}</p></div>
         <div class="btn-row"><button class="btn" data-close>Scan another</button><button class="btn btn-primary" data-add>Add it</button></div>`,
    { title: found.length ? 'Where is it?' : '', onClose: () => { scanner.resume(); status(idleText()); } });
    s.body.querySelector('[data-add]')?.addEventListener('click', () => { s.close(); setMode('add'); addFlow(isbn); });
    s.body.querySelector('a')?.addEventListener('click', () => s.close());
  }

  function showDuplicate(isbn, existing) {
    feedback('dup');
    scanner.pause();
    status('You already have this one.', 'err');
    const b = existing[0];
    const s = openSheet(`${whereHtml(b)}
      ${existing.length > 1 ? `<p class="muted small">You have ${existing.length} copies.</p>` : ''}
      <div class="btn-row" style="margin-top:12px"><a class="btn" href="#/book/${esc(b.id)}">Open book</a><button class="btn" data-copy>Add another copy</button></div>
      <button class="btn btn-primary btn-lg btn-block" data-close style="margin-top:10px">Scan next book</button>`,
    { title: 'Already in your library', onClose: () => { scanner.resume(); status(idleText()); } });
    s.body.querySelector('a').addEventListener('click', () => s.close());
    s.body.querySelector('[data-copy]').onclick = () => {
      s.close();
      addFlow(isbn, { allowDuplicate: true });
    };
  }

  async function addFlow(isbn, { allowDuplicate = false } = {}) {
    busy = true;
    scanner.pause();
    status('Looking up the book…', 'busy');
    let info = null, offline = false;
    try {
      info = await lookupIsbn(isbn);
    } catch (e) {
      offline = !!e.offline;
    }
    busy = false;
    if (!root.isConnected) return;
    if (!info && !offline) {
      feedback('err');
      status('Not found online — add the details yourself.', 'err');
      openBookForm({ isbn13: isbn, isbn10: isbn13to10(isbn), allowDuplicate }, {
        notice: `We couldn’t find ISBN ${prettyIsbn(isbn)} online. Fill in what you know — a photo of the cover helps.`,
        onSaved: saved,
      });
      watchClose();
      return;
    }
    feedback('ok');
    status(offline ? 'You’re offline — you can still save it.' : 'Found it!', offline ? 'err' : 'ok');
    confirmSheet(isbn, info, offline, allowDuplicate);
  }

  // Resume the scanner once every sheet is closed.
  function watchClose() {
    const t = setInterval(() => {
      if (!root.isConnected) return clearInterval(t);
      if (!document.querySelector('.sheet-backdrop')) { clearInterval(t); scanner.resume(); if (!busy) status(idleText()); }
    }, 300);
  }

  function saved(book) {
    feedback('ok');
    setFlash(book.id);
    const st = link.getState();
    const sent = st.role === 'guest' && st.state === 'connected';
    if (store.isScannerMode()) toast(`Saved “${book.title}”${sent ? ' — sent to your computer' : ''}`, { kind: 'ok' });
    else toast(`Saved “${book.title}”`, { kind: 'ok', actionLabel: 'View', onAction: () => { location.hash = `#/book/${book.id}`; } });
  }

  function confirmSheet(isbn, info, offline, allowDuplicate) {
    const book = info ? { ...info } : { title: `ISBN ${prettyIsbn(isbn)}`, isbn13: isbn, isbn10: isbn13to10(isbn), authors: [] };
    const s = openSheet(`
      ${offline ? `<div class="banner banner-warn">${icon('wifiOff')}<div class="grow">You’re offline. Save it now and Shelf fills in the title and cover when you’re back online.</div></div>` : ''}
      <div class="found"><div class="thumb">${coverHtml(book)}</div><div style="min-width:0">
        <h2>${esc(book.title)}</h2>
        ${book.subtitle ? `<div class="muted small">${esc(book.subtitle)}</div>` : ''}
        <div class="muted">${esc((book.authors || []).join(', '))}${book.year ? ` · ${esc(book.year)}` : ''}</div>
        <div class="small muted">${[book.pages ? `${book.pages} pages` : '', book.publisher].filter(Boolean).map(esc).join(' · ')}</div>
      </div></div>
      <div class="section-title">Where does it go?</div>
      <div data-loc></div>
      <div class="picker-row"><span class="field-label">Owner</span><div data-owner></div></div>
      <div class="picker-row"><span class="field-label">Status</span><div data-status></div></div>
      <button class="btn btn-primary btn-lg btn-block" data-save>Save to library</button>
      <button class="btn btn-ghost btn-block" data-edit style="margin-top:6px">${icon('edit')} Edit details first</button>`,
    { title: 'Add this book?', onClose: () => { if (!document.querySelector('.sheet-backdrop')) { scanner.resume(); status(idleText()); } } });
    const loc = locationPicker(s.body.querySelector('[data-loc]'), store.getSetting('lastLocation'));
    const owner = ownerPicker(s.body.querySelector('[data-owner]'), store.getSetting('lastOwner', ''));
    const st = statusPicker(s.body.querySelector('[data-status]'), 'unread');
    const collect = () => ({ ...book, isbn13: isbn, isbn10: isbn13to10(isbn), location: loc.value, owner: owner.value, status: st.value, needsLookup: offline });
    s.body.querySelector('[data-save]').onclick = async () => {
      const b = await store.saveBook(collect());
      if (loc.value) await store.setSetting('lastLocation', loc.value);
      await store.setSetting('lastOwner', owner.value);
      s.close();
      saved(b);
    };
    s.body.querySelector('[data-edit]').onclick = () => {
      const data = { ...collect(), allowDuplicate };
      s.close();
      scanner.pause();
      openBookForm(data, { onSaved: saved });
      watchClose();
    };
  }

  // Batch: save instantly, look details up in the background.
  async function batchAdd(isbn, existing) {
    if (existing.length) {
      feedback('dup');
      const b = existing[0];
      status(`Already have “${b.title}” — ${store.locationLabel(b.location)}`, 'err');
      session.unshift({ id: b.id, isbn, kind: 'dup' });
      renderRecent();
      return;
    }
    const loc = batchLoc();
    const book = await store.saveBook({
      isbn13: isbn, isbn10: isbn13to10(isbn), title: `ISBN ${prettyIsbn(isbn)}`, location: loc,
      owner: store.getSetting('batchOwner', store.getSetting('lastOwner', '')), needsLookup: true,
    });
    feedback('ok');
    status('Saved! Scan the next one.', 'ok');
    session.unshift({ id: book.id, isbn, kind: 'ok' });
    renderBatchPanel();
    renderRecent();
    try {
      const info = await lookupIsbn(isbn);
      const cur = store.getBook(book.id);
      if (!cur) return;
      if (info) await store.updateBook(book.id, { ...info, needsLookup: false, incomplete: false });
      else await store.updateBook(book.id, { title: `Unknown book (${prettyIsbn(isbn)})`, needsLookup: false, incomplete: true });
    } catch { /* offline: stays needsLookup, filled in later */ }
  }

  // ---------- events ----------
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode && b.dataset.mode !== mode) setMode(b.dataset.mode);
    else if ('changeLoc' in b.dataset) chooseBatchLocation();
    else if ('hand' in b.dataset) { scanner.pause(); openBookForm({}, { onSaved: saved }); watchClose(); }
    else if (b.dataset.undo) {
      const prev = await store.deleteBook(b.dataset.undo);
      session = session.filter((s) => s.id !== b.dataset.undo || s.kind !== 'ok');
      renderBatchPanel();
      renderRecent();
      toast(`Removed “${prev.title}”`, { actionLabel: 'Undo', onAction: async () => { await store.restoreBook(prev); session.unshift({ id: prev.id, isbn: prev.isbn13, kind: 'ok' }); renderBatchPanel(); renderRecent(); } });
    }
  });
  $('[data-manual]').addEventListener('submit', (e) => {
    e.preventDefault();
    unlockAudio();
    const input = e.target.isbn;
    const v = input.value.trim();
    if (!v) return;
    last = { code: '', at: 0 };
    handleCode(v, 'manual');
    input.value = '';
    input.blur();
  });

  const offStore = store.onChange(debounce(() => { renderRecent(); }, 100));
  const offLink = link.onState(renderLinked);
  renderLinked();
  setMode(mode, { push: false });
  startCamera();

  return () => {
    offStore();
    offLink();
    scanner.stop();
  };
}
