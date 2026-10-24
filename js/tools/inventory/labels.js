// Printable QR labels for rooms, cupboards, shelves and boxes.
import * as L from '../../core/locations.js';
import * as D from './data.js';
import { esc, icon, loadScript } from '../../core/ui.js';

async function qrSvg(text) {
  await loadScript('vendor/qrcode.js');
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
}

export function renderLabels(root) {
  const picked = new Set();
  let withList = true;
  const draw = () => {
    root.innerHTML = `<div class="no-print">
      <div class="page-head"><h1>QR labels</h1><button class="btn btn-primary" data-print ${picked.size ? '' : 'disabled'}>${icon('print')} Print ${picked.size || ''} label${picked.size === 1 ? '' : 's'}</button></div>
      <p class="muted">Stick a label on a box or cupboard. Scan it with your phone camera (or in Inventory › Add) to see what’s inside.</p>
      <label class="check-row"><input type="checkbox" data-with-list ${withList ? 'checked' : ''}> Also print a short contents list on each label</label>
      ${L.allRooms().map((r) => `<div class="card room-card"><h3>${esc(r.name)}</h3>
        ${r.areas.map((a) => `<div class="case-row" style="flex-direction:column;align-items:stretch">
          <label class="check-row"><input type="checkbox" data-pick="${esc(r.id)}|${esc(a.id)}|" ${picked.has(`${r.id}|${a.id}|`) ? 'checked' : ''}> <b>${esc(a.name)}</b> <span class="muted small">(whole ${esc(a.kind === 'storage' ? 'storage' : 'area')})</span></label>
          <div class="chips">${a.spots.map((s) => `<label class="chip chip-sm"><input type="checkbox" data-pick="${esc(r.id)}|${esc(a.id)}|${esc(s.id)}" ${picked.has(`${r.id}|${a.id}|${s.id}`) ? 'checked' : ''} style="width:18px;height:18px"> ${esc(s.name)}</label>`).join('')}</div></div>`).join('') || '<p class="muted small">No areas yet.</p>'}</div>`).join('')}
      <p class="small muted">Need more boxes? Add them in <a href="#/settings/locations">Settings › House locations</a>.</p></div>
      <div class="label-sheet" data-sheet></div>`;
  };
  async function buildSheet() {
    const sheet = root.querySelector('[data-sheet]');
    const labels = [];
    for (const key of picked) {
      const [roomId, areaId, spotId] = key.split('|');
      const loc = { roomId, areaId, spotId };
      const p = L.locationParts(loc);
      const inside = D.itemsAt(loc).map((i) => i.name);
      labels.push(`<div class="qr-label"><div class="qr-label-code">${await qrSvg(L.labelUrl(loc))}</div>
        <div class="qr-label-text"><b>${esc(p.spot || p.area)}</b><span>${esc([p.room, p.spot ? p.area : ''].filter(Boolean).join(' › '))}</span>
        ${withList && inside.length ? `<small>${esc(inside.slice(0, 6).join(', '))}${inside.length > 6 ? ` +${inside.length - 6} more` : ''}</small>` : ''}</div></div>`);
    }
    sheet.innerHTML = labels.join('');
  }
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.pick !== undefined) { t.checked ? picked.add(t.dataset.pick) : picked.delete(t.dataset.pick); const b = root.querySelector('[data-print]'); b.disabled = !picked.size; b.innerHTML = `${icon('print')} Print ${picked.size || ''} label${picked.size === 1 ? '' : 's'}`; }
    if ('withList' in t.dataset) withList = t.checked;
  });
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-print]')) return;
    await buildSheet();
    window.print();
  });
  draw();
}
