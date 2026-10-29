// TRIAGE QUEUE view: every alert that needs a human decision, newest first.
// Keyboard: ↑/↓ (or J/K) choose · A acknowledge · E escalate · D dismiss · I make an incident.
import { esc, $, toast, sheet, dayClock } from '../../shared/ui.js';
import { SEVERITIES, SEV_RANK, ALERT_STATUS, OPEN_ALERT, DISMISS_REASONS, ageText } from '../../shared/triage.js';

const FILTERS = [['new', 'Unhandled'], ['open', 'Open'], ['all', 'All'], ['dismissed', 'Dismissed'], ['incident', 'In incidents']];

/** ctx = { S, api(path, opts), showView(id), openIncident(id) } */
export function createTriage(ctx) {
  const { S } = ctx;
  const st = { filter: 'new', sev: '', q: '', sel: null, picked: new Set() };
  let root = null;

  const visible = () => (S.alerts || []).filter((a) => (st.filter === 'all' ? true : st.filter === 'open' ? OPEN_ALERT.has(a.status) : a.status === st.filter)
    && (!st.sev || a.severity === st.sev) && (!st.q || `${a.id} ${a.title} ${a.agent} ${a.room}`.toLowerCase().includes(st.q.toLowerCase())))
    .sort((a, b) => (b.status === 'new') - (a.status === 'new') || SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.ts - a.ts);

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad triage">
      <header class="view-head">
        <div class="sev-summary" data-sevsum></div>
        <span class="grow"></span>
        <input type="search" class="vh-search" data-tq placeholder="Filter alerts" aria-label="Filter alerts" value="${esc(st.q)}">
        <select data-tsev aria-label="Severity"><option value="">All severities</option>${SEVERITIES.slice().reverse().map((s) => `<option ${st.sev === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </header>
      <div class="view-tools">
        <div class="filters" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button data-tfilter="${k}" aria-pressed="${st.filter === k}">${l}</button>`).join('')}</div>
        <span class="grow"></span>
        <span class="small muted" data-tpicked></span>
        <button class="small" data-tbulk="acknowledge" title="Acknowledge the ticked alerts">Acknowledge selected</button>
        <button class="small" data-tbulk="dismiss" title="Dismiss the ticked alerts">Dismiss selected</button>
      </div>
      <div class="table-wrap"><table class="grid-table triage-table" aria-label="Alert queue">
        <thead><tr><th class="c-check"><input type="checkbox" data-tall aria-label="Select all"></th><th>Severity</th><th>Reference</th><th>Alert</th><th>Source</th><th>Room</th><th>Time</th><th>Waiting</th><th>Status</th><th class="c-actions">Actions</th></tr></thead>
        <tbody data-trows></tbody></table></div>
      <p class="small muted kbd-hint"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>A</kbd> acknowledge · <kbd>E</kbd> escalate · <kbd>D</kbd> dismiss · <kbd>I</kbd> incident</p>
    </div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('input', (e) => { if (e.target.matches('[data-tq]')) { st.q = e.target.value; draw(); } });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-tsev]')) { st.sev = e.target.value; draw(); }
      else if (e.target.matches('[data-tpick]')) { if (e.target.checked) st.picked.add(e.target.dataset.tpick); else st.picked.delete(e.target.dataset.tpick); drawPicked(); }
      else if (e.target.matches('[data-tall]')) { st.picked = e.target.checked ? new Set(visible().filter((a) => OPEN_ALERT.has(a.status)).map((a) => a.id)) : new Set(); draw(); }
    });
    draw();
  }

  function draw() {
    if (!root?.isConnected) return;
    const list = visible(), now = Date.now();
    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, (S.alerts || []).filter((a) => a.status === 'new' && a.severity === s).length]));
    $('[data-sevsum]', root).innerHTML = SEVERITIES.slice().reverse().map((s) => `<span class="sev-count sc-${s}"><b class="mono" ${counts[s] ? "" : "data-zero"}>${counts[s]}</b> ${s}</span>`).join('') + '<span class="small muted">unhandled</span>';
    root.querySelectorAll('[data-tfilter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tfilter === st.filter)));
    if (st.sel && !list.some((a) => a.id === st.sel)) st.sel = null;
    $('[data-trows]', root).innerHTML = list.length ? list.slice(0, 300).map((a) => {
      const open = OPEN_ALERT.has(a.status);
      return `<tr data-aid="${a.id}" class="${a.id === st.sel ? 'sel' : ''} ${a.status === 'new' ? 'unhandled' : ''}" tabindex="-1">
        <td class="c-check">${open ? `<input type="checkbox" data-tpick="${a.id}" ${st.picked.has(a.id) ? 'checked' : ''} aria-label="Select ${a.id}">` : ''}</td>
        <td><span class="sev sev-${a.severity}">${a.severity}</span></td>
        <td class="mono small">${a.id}</td>
        <td class="c-title"><b>${esc(a.title)}</b>${a.count > 1 ? ` <span class="tag">×${a.count}</span>` : ''}${a.explanation ? `<small>${esc(a.explanation)}</small>` : ''}${a.dismissReason ? `<small>Dismissed: ${esc(a.dismissReason)}</small>` : ''}</td>
        <td class="small">${esc(a.agent || (a.source === 'system' ? 'HQ' : a.source))}</td>
        <td class="small">${esc(a.room || '—')}</td>
        <td class="mono small" title="${new Date(a.ts).toLocaleString('en-GB')}">${dayClock(a.ts)}</td>
        <td class="mono small ${a.status === 'new' ? age(now - a.ts) : 'muted'}" data-age="${a.status === 'new' ? a.ts : ''}">${a.status === 'new' ? ageText(now - a.ts) : '—'}</td>
        <td class="small">${a.status === 'incident' ? `<button class="linkish" data-topeninc="${a.incidentId}">${esc(a.incidentRef || 'Incident')}</button>` : `<span class="st st-${a.status}">${ALERT_STATUS[a.status]}</span>`}</td>
        <td class="c-actions">${open ? `<button class="small" data-tact="acknowledge" title="Acknowledge (A)" ${a.status === 'acknowledged' ? 'disabled' : ''}>Ack</button><button class="small" data-tact="escalate" title="Escalate (E)" ${a.severity === 'CRITICAL' && a.status === 'escalated' ? 'disabled' : ''}>Escalate</button><button class="small" data-tact="dismiss" title="Dismiss with a reason (D)">Dismiss</button><button class="small" data-tact="incident" title="Convert to incident (I)">Incident</button>`
          : a.status === 'dismissed' ? '<button class="small btn-ghost" data-tact="reopen">Reopen</button>' : ''}</td></tr>`;
    }).join('') : `<tr class="empty"><td colspan="10">${st.filter === 'new' ? 'No unhandled alerts. The queue is clear.' : 'Nothing to show for this filter.'}</td></tr>`;
    drawPicked();
  }
  const age = (ms) => (ms > 30 * 60000 ? 'c-red' : ms > 5 * 60000 ? 'c-amber' : '');
  function drawPicked() { const n = st.picked.size, el = $('[data-tpicked]', root); if (el) el.textContent = n ? `${n} selected` : ''; root.querySelectorAll('[data-tbulk]').forEach((b) => { b.disabled = !n; }); }
  /** Waiting times tick every second without redrawing the table. */
  function tick() {
    if (!root?.isConnected) return;
    const now = Date.now();
    root.querySelectorAll('[data-age]').forEach((td) => { const ts = Number(td.dataset.age); if (ts) { td.textContent = ageText(now - ts); td.className = `mono small ${age(now - ts)}`; } });
  }

  async function act(id, action) {
    const a = (S.alerts || []).find((x) => x.id === id);
    if (!a) return;
    if (action === 'dismiss') return dismiss([id]);
    if (action === 'incident') return convert([id]);
    try { await ctx.api(`/alerts/${id}/${action}`, { method: 'POST', body: {} }); } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  function dismiss(ids) {
    const s = sheet(`<form data-dismissform>
        <p>${ids.length === 1 ? `Dismiss <b class="mono">${ids[0]}</b>` : `Dismiss <b>${ids.length} alerts</b>`}. Choose a reason — it is kept in the record.</p>
        <fieldset class="radio-list">${DISMISS_REASONS.map((r, i) => `<label><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${esc(r)}</label>`).join('')}</fieldset>
        <label class="field"><span>Note (optional)</span><input name="note" maxlength="120" placeholder="e.g. the cat on the stairs"></label>
        <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Dismiss</button></div></form>`, { title: 'Dismiss alert' });
    s.el.querySelector('[data-dismissform]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = e.target.elements.reason.value, note = e.target.elements.note.value.trim();
      try {
        if (ids.length === 1) await ctx.api(`/alerts/${ids[0]}/dismiss`, { method: 'POST', body: { reason, note } });
        else await ctx.api('/alerts/bulk', { method: 'POST', body: { ids, action: 'dismiss', reason } });
        st.picked.clear(); s.close();
      } catch (x) { toast(x.message, { kind: 'err' }); }
    });
  }
  function convert(ids) {
    const first = (S.alerts || []).find((a) => a.id === ids[0]);
    const open = (S.incidents || []).filter((i) => i.status !== 'closed');
    const s = sheet(`<form data-incform>
        <p>Open an incident from <b class="mono">${ids.join(', ')}</b>, or add ${ids.length === 1 ? 'it' : 'them'} to one that is already open.</p>
        ${open.length ? `<label class="field"><span>Incident</span><select name="incTarget"><option value="">New incident</option>${open.map((i) => `<option value="${i.id}">${esc(i.ref)} — ${esc(i.title)}</option>`).join('')}</select></label>` : ''}
        <div data-newfields><label class="field"><span>Title</span><input name="incTitle" maxlength="100" value="${esc(first?.title || '')}"></label>
        <label class="field"><span>Assignee</span><input name="assignee" maxlength="30" value="${esc(S.operator || '')}"></label>
        <label class="field"><span>First note (optional)</span><textarea name="note" rows="2" maxlength="1000"></textarea></label></div>
        <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Open incident</button></div></form>`, { title: 'Convert to incident' });
    const f = s.el.querySelector('[data-incform]'), el = f.elements;
    const tgt = el.incTarget;
    tgt?.addEventListener('change', () => { f.querySelector('[data-newfields]').hidden = !!tgt.value; f.querySelector('.btn-primary').textContent = tgt.value ? 'Add to incident' : 'Open incident'; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const inc = tgt?.value
          ? await ctx.api(`/incidents/${tgt.value}/alerts`, { method: 'POST', body: { alertIds: ids } })
          : await ctx.api('/incidents', { method: 'POST', body: { alertIds: ids, title: el.incTitle.value, assignee: el.assignee.value, note: el.note.value } });
        st.picked.clear(); s.close();
        toast(`${inc.ref} ${tgt?.value ? 'updated' : 'opened'}`);
        ctx.openIncident(inc.id);
      } catch (x) { toast(x.message, { kind: 'err' }); }
    });
  }

  async function onClick(e) {
    const b = e.target.closest('button');
    const row = e.target.closest('[data-aid]');
    if (row && !e.target.closest('input')) { st.sel = row.dataset.aid; root.querySelectorAll('[data-aid]').forEach((r) => r.classList.toggle('sel', r === row)); }
    if (!b) return;
    if (b.dataset.tfilter) { st.filter = b.dataset.tfilter; st.picked.clear(); draw(); }
    else if (b.dataset.tact && row) act(row.dataset.aid, b.dataset.tact);
    else if (b.dataset.topeninc) ctx.openIncident(b.dataset.topeninc);
    else if (b.dataset.tbulk) {
      const ids = [...st.picked];
      if (!ids.length) return;
      if (b.dataset.tbulk === 'dismiss') dismiss(ids);
      else { try { await ctx.api('/alerts/bulk', { method: 'POST', body: { ids, action: 'acknowledge' } }); st.picked.clear(); } catch (x) { toast(x.message, { kind: 'err' }); } }
    }
  }

  /** Keyboard (only while this view is showing and no box is focused). */
  function key(e) {
    if (!root?.isConnected) return false;
    const list = visible();
    const i = list.findIndex((a) => a.id === st.sel);
    const k = e.key.toLowerCase();
    if (k === 'arrowdown' || k === 'j') { st.sel = list[Math.min(list.length - 1, i + 1)]?.id || null; draw(); root.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' }); return true; }
    if (k === 'arrowup' || k === 'k') { st.sel = list[Math.max(0, i - 1)]?.id || null; draw(); root.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' }); return true; }
    const map = { a: 'acknowledge', e: 'escalate', d: 'dismiss', i: 'incident' };
    if (map[k] && st.sel && !e.shiftKey) { const a = list.find((x) => x.id === st.sel); if (a && OPEN_ALERT.has(a.status)) act(st.sel, map[k]); return true; }
    return false;
  }

  return { render, draw, tick, key, convert, setFilter(f) { st.filter = f; draw(); }, select(id) { st.sel = id; st.filter = 'new'; } };
}
