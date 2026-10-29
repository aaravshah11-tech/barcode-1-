// INCIDENTS view: a case list on the left, the selected case on the right — status, assignee,
// linked alerts, notes, a full timeline, and "Play back on map" (replays just that window).
import { esc, $, toast, dayClock } from '../../shared/ui.js';
import { INCIDENT_STATUS, INCIDENT_LABEL, SEVERITIES, canMove, ALERT_STATUS } from '../../shared/triage.js';

const NEXT = { open: [['investigating', 'Start investigating'], ['closed', 'Close (no action needed)']], investigating: [['resolved', 'Mark resolved']], resolved: [['closed', 'Close'], ['investigating', 'Reopen']], closed: [] };
const when = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** ctx = { S, api(path, opts), playback({ from, to, label }), openAlertQueue() } */
export function createIncidents(ctx) {
  const { S } = ctx;
  const st = { sel: null, filter: 'active', detail: null };
  let root = null;

  const list = () => (S.incidents || []).filter((i) => (st.filter === 'active' ? i.status !== 'closed' : st.filter === 'closed' ? i.status === 'closed' : true));

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad incidents">
      <div class="split">
        <section class="split-list panel">
          <div class="panel-head"><h2>Incidents</h2><div class="filters" role="group" aria-label="Show">${[['active', 'Active'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button data-ifilter="${k}" aria-pressed="${st.filter === k}">${l}</button>`).join('')}</div></div>
          <button class="small new-inc" data-inew>New incident</button>
          <ol class="case-list" data-ilist></ol>
        </section>
        <section class="split-detail panel" data-idetail aria-live="polite"></section>
      </div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('change', onChange);
    if (!st.sel) st.sel = list()[0]?.id || null;
    drawList(); load();
  }

  function drawList() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-ifilter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ifilter === st.filter)));
    const items = list();
    $('[data-ilist]', root).innerHTML = items.length ? items.map((i) => `<li><button data-iopen="${i.id}" class="${i.id === st.sel ? 'sel' : ''}" aria-current="${i.id === st.sel}">
        <span class="row"><b class="mono">${esc(i.ref)}</b><span class="grow"></span><span class="sev sev-${i.severity}">${i.severity}</span></span>
        <span class="case-title">${esc(i.title)}</span>
        <span class="row small muted"><span class="st st-${i.status}">${INCIDENT_LABEL[i.status]}</span><span>${esc(i.assignee || 'Unassigned')}</span><span class="grow"></span><span class="mono">${dayClock(i.updatedAt)}</span></span></button></li>`).join('')
      : `<li class="muted small empty">${st.filter === 'active' ? 'No active incidents.' : 'None.'} Open one from the Triage queue (Incident button), or press New incident.</li>`;
  }

  async function load() {
    const box = root && $('[data-idetail]', root);
    if (!box) return;
    if (!st.sel) { box.innerHTML = '<div class="empty-detail muted">Choose an incident on the left.</div>'; return; }
    try { st.detail = await ctx.api(`/incidents/${st.sel}`); } catch (x) { box.innerHTML = `<p class="c-red">${esc(x.message)}</p>`; return; }
    drawDetail();
  }

  function drawDetail() {
    const box = root && $('[data-idetail]', root);
    if (!box || !st.detail) return;
    const { incident: i, alerts, timeline } = st.detail;
    const stepIdx = INCIDENT_STATUS.indexOf(i.status);
    box.innerHTML = `
      <div class="panel-head"><h2><span class="mono">${esc(i.ref)}</span></h2><span class="sev sev-${i.severity}">${i.severity}</span></div>
      <div class="case">
        <form class="case-title-form" data-irename><input name="ititle" value="${esc(i.title)}" maxlength="100" aria-label="Incident title"></form>
        <ol class="stepper" aria-label="Status">${INCIDENT_STATUS.map((s, k) => `<li class="${k < stepIdx ? 'done' : k === stepIdx ? 'now' : ''}">${INCIDENT_LABEL[s]}</li>`).join('')}</ol>
        <div class="row case-actions">${NEXT[i.status].filter(([to]) => canMove(i.status, to)).map(([to, l]) => `<button class="small ${to === 'resolved' || to === 'investigating' ? 'btn-primary' : ''}" data-imove="${to}">${l}</button>`).join('')}
          <span class="grow"></span><button class="small" data-iplay title="Replay the events around this incident on the map">Play back on map</button></div>
        <dl class="kv case-kv">
          <dt>Assignee</dt><dd><input data-iassign value="${esc(i.assignee || '')}" maxlength="30" aria-label="Assignee"></dd>
          <dt>Severity</dt><dd><select data-isev aria-label="Severity">${SEVERITIES.map((s) => `<option ${s === i.severity ? 'selected' : ''}>${s}</option>`).join('')}</select></dd>
          <dt>Opened</dt><dd class="mono">${when(i.createdAt)} · ${esc(i.createdBy)}</dd>
          ${i.resolvedAt ? `<dt>Resolved</dt><dd class="mono">${when(i.resolvedAt)}</dd>` : ''}${i.closedAt ? `<dt>Closed</dt><dd class="mono">${when(i.closedAt)}</dd>` : ''}
        </dl>
        <h3 class="sub">Linked alerts (${alerts.length})</h3>
        ${alerts.length ? `<table class="grid-table compact"><thead><tr><th>Reference</th><th>Severity</th><th>Alert</th><th>Time</th><th>Status</th></tr></thead><tbody>${alerts.map((a) => `<tr><td class="mono small">${a.id}</td><td><span class="sev sev-${a.severity}">${a.severity}</span></td><td>${esc(a.title)}${a.count > 1 ? ` <span class="tag">×${a.count}</span>` : ''}</td><td class="mono small">${dayClock(a.ts)}</td><td class="small">${ALERT_STATUS[a.status]}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">No alerts linked. Use “Incident” on an alert in the Triage queue to add it here.</p>'}
        <h3 class="sub">Notes</h3>
        <ol class="notes">${i.notes.map((n) => `<li><div class="small muted"><b>${esc(n.by)}</b> · <span class="mono">${when(n.ts)}</span></div><p>${esc(n.text)}</p></li>`).join('') || '<li class="small muted">No notes yet.</li>'}</ol>
        ${i.status !== 'closed' ? `<form data-inote class="note-form"><textarea name="text" rows="2" maxlength="1000" placeholder="Add a note — what you checked, what you found" aria-label="New note"></textarea><button class="small">Add note</button></form>` : ''}
        <h3 class="sub">Timeline</h3>
        <ol class="timeline">${timeline.map((t) => `<li class="tl-${t.type} ${t.level === 'alert' ? 'lvl-alert' : ''}"><span class="mono small">${when(t.ts)}</span><span class="tl-by small">${esc(t.by)}</span><span>${esc(t.text)}</span></li>`).join('')}</ol>
      </div>`;
  }

  async function patch(body) {
    try { await ctx.api(`/incidents/${st.sel}`, { method: 'PATCH', body }); await load(); } catch (x) { toast(x.message, { kind: 'err' }); load(); }
  }
  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ifilter) { st.filter = b.dataset.ifilter; drawList(); }
    else if (b.dataset.iopen) { st.sel = b.dataset.iopen; drawList(); load(); }
    else if (b.dataset.imove) patch({ status: b.dataset.imove });
    else if ('iplay' in b.dataset && st.detail) ctx.playback({ ...st.detail.window, label: st.detail.incident.ref });
    else if ('inew' in b.dataset) {
      try { const inc = await ctx.api('/incidents', { method: 'POST', body: { title: 'New incident' } }); open(inc.id); root.querySelector('[name=ititle]')?.select(); } catch (x) { toast(x.message, { kind: 'err' }); }
    }
  }
  async function onSubmit(e) {
    e.preventDefault();
    if (e.target.matches('[data-irename]')) { patch({ title: e.target.elements.ititle.value }); return; }
    if (e.target.matches('[data-inote]')) {
      const text = e.target.elements.text.value.trim();
      if (!text) return;
      try { await ctx.api(`/incidents/${st.sel}/notes`, { method: 'POST', body: { text } }); await load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    }
  }
  function onChange(e) {
    if (e.target.matches('[data-iassign]')) patch({ assignee: e.target.value });
    else if (e.target.matches('[data-isev]')) patch({ severity: e.target.value });
    else if (e.target.matches('[name=ititle]')) patch({ title: e.target.value });
  }
  async function open(id) { st.sel = id; if (st.filter === 'closed') st.filter = 'active'; drawList(); await load(); }

  return {
    render, open,
    /** An incident changed on HQ (here or on another screen). */
    changed(inc) { drawList(); if (inc.id === st.sel) load(); },
    preselect(id) { st.sel = id; },
  };
}
