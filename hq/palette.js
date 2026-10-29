// COMMAND PALETTE (Ctrl+K / ⌘K): jump anywhere or run any action from the keyboard.
// Type to filter, ↑ ↓ to choose, Enter to run, Esc to close. Anything that isn't in the list can be
// run as a terminal command (e.g. "send all Dinner is ready").
import { esc } from '../shared/ui.js';

/** Pure: how well does `q` match `text`? (letters in order; earlier/contiguous/word-start matches score higher). 0 = no match. */
export function score(q, text) {
  q = q.toLowerCase().trim(); text = text.toLowerCase();
  if (!q) return 1;
  if (text.includes(q)) return 100 - text.indexOf(q) + (text.startsWith(q) ? 50 : 0);
  let ti = 0, s = 0, run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = text.indexOf(ch, ti);
    if (i < 0) return 0;
    run = i === ti ? run + 1 : 0;
    s += 1 + run * 2 + (i === 0 || /[\s:/·-]/.test(text[i - 1]) ? 3 : 0);
    ti = i + 1;
  }
  return s;
}
export function filterActions(actions, q) {
  return actions.map((a) => ({ a, s: Math.max(score(q, a.label), score(q, `${a.group} ${a.label}`) - 2, ...(a.keywords || []).map((k) => score(q, k) - 1)) }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.a);
}

let open = null;
/**
 * actions: [{ id, group, label, hint?, keys?, run() }]. fallback(q): run free text as a command.
 */
export function openPalette(getActions, { fallback } = {}) {
  if (open) { open.input.focus(); return open; }
  const actions = getActions();
  const back = document.createElement('div');
  back.className = 'palette-backdrop';
  back.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input data-pq placeholder="Search or run a command…" autocomplete="off" spellcheck="false" aria-label="Command" role="combobox" aria-expanded="true" aria-controls="pal-list">
      <ul id="pal-list" class="palette-list" role="listbox" data-plist></ul>
      <div class="palette-foot small muted"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span></div></div>`;
  document.body.appendChild(back);
  const input = back.querySelector('[data-pq]'), list = back.querySelector('[data-plist]');
  let shown = [], sel = 0;
  const draw = () => {
    const q = input.value;
    shown = filterActions(actions, q).slice(0, 40);
    if (q.trim() && fallback) shown.push({ id: 'run', group: 'Command', label: `Run “${q.trim()}”`, run: () => fallback(q.trim()) });
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let lastGroup = null;
    list.innerHTML = shown.length ? shown.map((a, i) => {
      const head = a.group !== lastGroup ? `<li class="pal-group" role="presentation">${esc(a.group)}</li>` : '';
      lastGroup = a.group;
      return `${head}<li role="option" id="pal-${i}" data-pi="${i}" aria-selected="${i === sel}" class="${i === sel ? 'sel' : ''}"><span class="grow">${esc(a.label)}${a.hint ? `<small class="muted"> · ${esc(a.hint)}</small>` : ''}</span>${a.keys ? `<span class="keys">${a.keys.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span>` : ''}</li>`;
    }).join('') : '<li class="pal-empty muted">No matches</li>';
    input.setAttribute('aria-activedescendant', `pal-${sel}`);
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (i) => { const a = shown[i]; if (!a) return; close(); setTimeout(() => a.run(), 0); };
  const close = () => { back.remove(); open = null; };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  list.addEventListener('pointermove', (e) => { const li = e.target.closest('[data-pi]'); if (li && Number(li.dataset.pi) !== sel) { sel = Number(li.dataset.pi); draw(); } });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-pi]'); if (li) run(Number(li.dataset.pi)); });
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  draw();
  input.focus();
  open = { input, close };
  return open;
}
export const paletteOpen = () => !!open;
