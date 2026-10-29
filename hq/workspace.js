// WORKSPACE: a configurable multi-panel layout. Panels sit on a 12-column grid; in "Edit layout" mode
// you drag a panel by its title bar and resize it from its corner. Layouts are saved per device
// (several named layouts, plus presets). On a phone the panels simply stack in one column.
import { esc } from '../shared/ui.js';

const KEY = 'sentinel.layouts';
export const COLS = 12;

/** Pure: do two layout items overlap? */
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Pure: settle a layout after `movedId` moved/resized — anything it now overlaps is pushed down,
 * then everything floats up as far as it can (no gaps), keeping the moved panel where it was put.
 */
export function settle(items, movedId = null) {
  const fixed = items.find((i) => i.id === movedId);
  const rest = items.filter((i) => i !== fixed && !i.hidden).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = fixed && !fixed.hidden ? [fixed] : [];
  for (const it of rest) {
    const cand = { ...it, x: Math.min(it.x, COLS - it.w) };
    cand.y = 0; // float up
    while (placed.some((p) => overlaps(cand, p))) cand.y++;
    Object.assign(it, cand);
    placed.push(it);
  }
  if (fixed) { fixed.x = Math.max(0, Math.min(COLS - fixed.w, fixed.x)); fixed.y = Math.max(0, fixed.y); }
  return items;
}

/** Pure: put panels that a layout doesn't mention at the bottom; drop unknown ones. */
export function reconcile(items, panelIds, defaults = {}) {
  const out = items.filter((i) => panelIds.includes(i.id)).map((i) => ({ ...i }));
  let bottom = Math.max(0, ...out.filter((i) => !i.hidden).map((i) => i.y + i.h));
  for (const id of panelIds) if (!out.some((i) => i.id === id)) { const d = defaults[id] || { w: 4, h: 8 }; out.push({ id, x: 0, y: bottom, w: d.w, h: d.h }); bottom += d.h; }
  return out;
}

/**
 * root: element to draw into. panels: [{ id, title, html, minW, minH, defaultW, defaultH }].
 * presets: { name: [{ id, x, y, w, h, hidden? }] } (the first is the default).
 */
export function createWorkspace(root, { panels, presets, onRender, onLayoutChange }) {
  let store = load();
  let edit = false;
  const ids = () => panels.map((p) => p.id);
  const defaults = Object.fromEntries(panels.map((p) => [p.id, { w: p.defaultW || 4, h: p.defaultH || 8 }]));
  const presetNames = Object.keys(presets);

  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.layouts && s.current) return s; } catch { /* none */ }
    return { current: Object.keys(presets)[0], layouts: {} };
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private window */ } };
  /** The layout in use (a saved copy, or the preset it's based on). */
  function items() {
    const base = store.layouts[store.current] || presets[store.current] || presets[presetNames[0]];
    return reconcile(base, ids(), defaults);
  }
  function setItems(list) { store.layouts[store.current] = list.map(({ id, x, y, w, h, hidden }) => ({ id, x, y, w, h, ...(hidden ? { hidden: true } : {}) })); save(); onLayoutChange?.(); }

  function render() {
    const list = items();
    const byId = new Map(panels.map((p) => [p.id, p]));
    const names = [...new Set([...presetNames, ...Object.keys(store.layouts)])];
    root.innerHTML = `
      <div class="ws-bar" role="toolbar" aria-label="Workspace layout">
        <label class="ws-layout"><span>Layout</span><select data-wslayout aria-label="Layout">${names.map((n) => `<option ${n === store.current ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <button class="small" data-wsedit aria-pressed="${edit}" title="Move and resize panels (Shift+E)">${edit ? 'Done' : 'Edit layout'}</button>
        ${edit ? `<button class="small" data-wssave title="Save this arrangement under a new name">Save as…</button><button class="small" data-wsreset title="Back to how this layout started">Reset</button>
          <details class="ws-panels"><summary class="btn small">Panels</summary><div class="ws-menu">${panels.map((p) => `<label><input type="checkbox" data-wstoggle="${p.id}" ${list.find((i) => i.id === p.id)?.hidden ? '' : 'checked'}> ${esc(p.title)}</label>`).join('')}</div></details>
          <span class="small muted">Drag a panel by its title bar · resize from its bottom-right corner</span>` : ''}
      </div>
      <div class="ws-grid ${edit ? 'editing' : ''}" data-wsgrid>
        ${list.filter((i) => !i.hidden).sort((a, b) => a.y - b.y || a.x - b.x).map((i) => { const p = byId.get(i.id); return `<section class="panel wp wp-${p.id}" data-panel="${p.id}" aria-label="${esc(p.title)}" style="grid-column:${i.x + 1} / span ${i.w};grid-row:${i.y + 1} / span ${i.h}">${p.html}${edit ? '<span class="wp-resize" data-wsresize title="Resize" aria-hidden="true"></span>' : ''}</section>`; }).join('')}
      </div>`;
    onRender?.();
  }

  // ---------- drag to move / resize (edit mode only) ----------
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    if (!edit) return;
    const panel = e.target.closest('[data-panel]');
    if (!panel) return;
    const resize = e.target.closest('[data-wsresize]');
    const head = e.target.closest('.panel-head');
    if (!resize && (!head || e.target.closest('button, select, input, a, label'))) return;
    const grid = root.querySelector('[data-wsgrid]'), r = grid.getBoundingClientRect(), cs = getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap) || 8, rowH = parseFloat(cs.gridAutoRows) || 40;
    const list = items(), it = list.find((i) => i.id === panel.dataset.panel);
    drag = { id: it.id, list, it, start: { ...it }, sx: e.clientX, sy: e.clientY, colW: (r.width + gap) / COLS, rowH: rowH + gap, resize: !!resize, min: panels.find((p) => p.id === it.id) };
    panel.classList.add('dragging');
    panel.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.sx) / drag.colW), dy = Math.round((e.clientY - drag.sy) / drag.rowH);
    const it = drag.it, s = drag.start;
    if (drag.resize) { it.w = Math.max(drag.min.minW || 2, Math.min(COLS - s.x, s.w + dx)); it.h = Math.max(drag.min.minH || 3, s.h + dy); }
    else { it.x = Math.max(0, Math.min(COLS - s.w, s.x + dx)); it.y = Math.max(0, s.y + dy); }
    settle(drag.list, it.id);
    // move the boxes without re-rendering (keeps the 3D map alive)
    for (const i of drag.list) { const el = root.querySelector(`[data-panel="${i.id}"]`); if (el) el.style.cssText = `grid-column:${i.x + 1} / span ${i.w};grid-row:${i.y + 1} / span ${i.h}`; }
  });
  const end = () => {
    if (!drag) return;
    root.querySelector(`[data-panel="${drag.id}"]`)?.classList.remove('dragging');
    setItems(settle(drag.list));
    drag = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('wsedit' in b.dataset) api.setEdit(!edit);
    else if ('wsreset' in b.dataset) { delete store.layouts[store.current]; save(); render(); }
    else if ('wssave' in b.dataset) {
      const name = (prompt('Name for this layout (e.g. Night watch):') || '').trim().slice(0, 30);
      if (!name) return;
      store.layouts[name] = items(); store.current = name; save(); render();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-wslayout]')) { store.current = e.target.value; save(); render(); }
    else if (e.target.matches('[data-wstoggle]')) {
      const list = items(), it = list.find((i) => i.id === e.target.dataset.wstoggle);
      it.hidden = !e.target.checked;
      if (!it.hidden) { it.y = Math.max(0, ...list.filter((i) => !i.hidden && i !== it).map((i) => i.y + i.h)); }
      setItems(settle(list)); render();
      root.querySelector('.ws-panels')?.setAttribute('open', '');
    }
  });

  const api = {
    render,
    get edit() { return edit; },
    setEdit(on) { edit = !!on; render(); },
    get current() { return store.current; },
    names: () => [...new Set([...presetNames, ...Object.keys(store.layouts)])],
    use(name) { store.current = name; save(); render(); },
    show(id) { const list = items(), it = list.find((i) => i.id === id); if (it?.hidden) { it.hidden = false; it.y = 999; setItems(settle(list)); render(); } },
    items,
  };
  return api;
}
