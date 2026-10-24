// Add items: scan a product barcode or a box label, or take a photo.
import * as D from './data.js';
import * as L from '../../core/locations.js';
import { lookupBarcode } from './lookup.js';
import { Scanner, cameraErrorMessage } from '../../core/scanner.js';
import { feedback, unlockAudio } from '../../core/feedback.js';
import { esc, icon, openSheet, toast } from '../../core/ui.js';
import { openItemForm, thumbHtml } from './form.js';

export function renderAdd(root) {
  let busy = false;
  let last = { code: '', at: 0 };
  root.innerHTML = `<div class="scan-wrap">
    <h1>Add or find stuff</h1>
    <p class="muted">Scan a product barcode to add it, or scan a box/cupboard QR label to see what’s inside.</p>
    <div class="scanner-box"><div id="inv-reader"></div><div class="scanner-msg" data-cam-msg>Starting camera…</div></div>
    <div class="scan-status" data-status aria-live="polite">Point the camera at a barcode or label.</div>
    <form class="manual" data-manual><input name="code" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off"><button class="btn btn-primary">Go</button></form>
    <button class="btn btn-lg btn-block" data-photo style="margin-top:14px">${icon('camera')} No barcode? Add with a photo + name</button>
  </div>`;
  const status = (t, cls = '') => { const el = root.querySelector('[data-status]'); el.textContent = t; el.className = `scan-status ${cls}`; };
  const scanner = new Scanner('inv-reader', (text) => handle(text, 'camera'), { qr: true });

  async function handle(raw, source) {
    const now = Date.now();
    if (busy || (raw === last.code && now - last.at < 3000)) return;
    last = { code: raw, at: now };
    const place = L.parseLabel(raw);
    if (place) { feedback('ok'); location.hash = `#/inventory/place/${[place.roomId, place.areaId, place.spotId].filter(Boolean).join('/')}`; return; }
    const code = String(raw).replace(/\s/g, '');
    if (!/^\d{6,14}$/.test(code)) { status('That doesn’t look like a product barcode.', 'err'); return; }
    const have = D.byBarcode(code);
    if (have.length) {
      feedback('dup');
      scanner.pause();
      const i = have[0];
      const s = openSheet(`<div class="found">${thumbHtml(i)}<div><h2>${esc(i.name)}</h2><div class="muted">You have ${esc(have.reduce((n, x) => n + (x.quantity || 1), 0))}</div></div></div>
        ${L.wherePathHtml(i.location)}
        <div class="btn-row"><a class="btn" href="#/inventory/item/${esc(i.id)}">Open</a><button class="btn" data-more>+1 quantity</button><button class="btn btn-primary" data-close>Scan next</button></div>`,
      { title: 'Already in your inventory', onClose: () => scanner.resume() });
      s.body.querySelector('[data-more]').onclick = async () => { await D.saveItem({ ...i, quantity: (i.quantity || 1) + 1 }); s.close(); toast(`${i.name}: now ${(i.quantity || 1) + 1}`, { kind: 'ok' }); };
      s.body.querySelector('a').onclick = () => s.close();
      return;
    }
    busy = true;
    scanner.pause();
    status('Looking it up…', 'busy');
    let info = null, offline = false;
    try { info = await lookupBarcode(code); } catch (e) { offline = !!e.offline; }
    busy = false;
    if (!root.isConnected) return;
    feedback(info ? 'ok' : 'err');
    status(info ? `Found: ${info.name}` : offline ? 'You’re offline — add the details yourself.' : 'Not found online — add the details yourself.', info ? 'ok' : 'err');
    openItemForm(info || { barcode: code }, {
      notice: info ? `Found on ${info.source}. Check the details, choose where it lives, then save.` : offline ? 'You’re offline, so we couldn’t look this barcode up. Add a photo and name.' : 'This barcode isn’t in the free product databases. Take a photo and give it a name.',
      onSaved: (i) => { feedback('ok'); toast(`Added ${i.name}`, { kind: 'ok', actionLabel: 'View', onAction: () => { location.hash = `#/inventory/item/${i.id}`; } }); },
    });
    watchClose();
  }

  function watchClose() {
    const t = setInterval(() => {
      if (!root.isConnected) return clearInterval(t);
      if (!document.querySelector('.sheet-backdrop')) { clearInterval(t); scanner.resume(); status('Point the camera at a barcode or label.'); }
    }, 300);
  }

  root.querySelector('[data-manual]').addEventListener('submit', (e) => { e.preventDefault(); unlockAudio(); last = { code: '', at: 0 }; handle(e.target.code.value.trim(), 'manual'); e.target.code.value = ''; });
  root.querySelector('[data-photo]').addEventListener('click', () => {
    scanner.pause();
    openItemForm({}, { onSaved: (i) => toast(`Added ${i.name}`, { kind: 'ok', actionLabel: 'View', onAction: () => { location.hash = `#/inventory/item/${i.id}`; } }) });
    watchClose();
  });
  (async () => {
    const msg = root.querySelector('[data-cam-msg]');
    try { await scanner.start(); if (root.isConnected) msg.hidden = true; } catch (err) {
      const m = cameraErrorMessage(err);
      msg.innerHTML = `${icon('camera')}<b>${esc(m.title)}</b><div class="small" style="max-width:380px">${esc(m.text)}</div>`;
    }
  })();
  return () => scanner.stop();
}
