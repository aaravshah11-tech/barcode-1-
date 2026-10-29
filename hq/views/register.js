// AGENT REGISTER view: every Agent's hardware, mission history, uptime, calibration, tamper history
// and maintenance notes — like an equipment register.
import { esc, $, toast, sheet, dayClock, ago } from '../../shared/ui.js';

const when = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const pctCell = (v) => (v == null ? '<span class="muted">—</span>' : `<span class="mono ${v < 90 ? 'c-amber' : ''}">${v}%</span>`);

/** ctx = { S, api(path, opts) } */
export function createRegister(ctx) {
  const { S } = ctx;
  let root = null, list = [];

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad register">
      <header class="view-head"><p class="small muted lead">Every Agent: what it runs on, what it has been used for, how reliable it is, and when it was last checked.</p></header>
      <div class="table-wrap"><table class="grid-table reg-table"><thead><tr><th>Agent</th><th>Status</th><th>Hardware</th><th>Mission</th><th>Location</th><th>Uptime 7 d</th><th>Uptime 30 d</th><th>Last calibration</th><th>Last tamper</th><th>Notes</th></tr></thead><tbody data-rrows></tbody></table></div></div>`;
    root.addEventListener('click', (e) => { const tr = e.target.closest('[data-reg]'); if (tr) open(tr.dataset.reg); });
    load();
  }
  async function load() {
    try { list = await ctx.api('/register'); } catch (x) { toast(x.message, { kind: 'err' }); return; }
    draw();
  }
  const roomName = (place) => { for (const f of S.house?.floors || []) { const r = f.rooms.find((x) => x.id === place?.roomId); if (r) return r.name; } return place ? 'On the plan' : 'Not placed'; };
  function draw() {
    if (!root?.isConnected) return;
    $('[data-rrows]', root).innerHTML = list.length ? list.map((a) => `<tr data-reg="${a.id}" tabindex="0" class="clickable">
      <td><span class="mono small muted">${esc(a.label)}</span> <b>${esc(a.codename)}</b>${a.name ? `<small class="muted"> · ${esc(a.name)}</small>` : ''}</td>
      <td><span class="dot ${a.online ? 'on' : ''}"></span> ${a.online ? 'Online' : `Offline <small class="muted">${a.lastSeen ? ago(a.lastSeen) : ''}</small>`}</td>
      <td class="small">${esc(a.hardware.text)}</td><td class="small">${esc(a.missionName)}</td><td class="small">${esc(roomName(a.place))}</td>
      <td>${pctCell(a.uptime7d)}</td><td>${pctCell(a.uptime30d)}</td>
      <td class="small mono">${a.calibratedAt ? dayClock(a.calibratedAt) : '<span class="muted">never</span>'}</td>
      <td class="small">${a.lastTamper ? `<span class="c-amber">${esc(a.lastTamper.type)}</span> <span class="mono muted">${dayClock(a.lastTamper.ts)}</span>` : '<span class="muted">none</span>'}</td>
      <td class="small muted">${esc((a.notes || '').slice(0, 40))}${(a.notes || '').length > 40 ? '…' : ''}</td></tr>`).join('')
      : '<tr class="empty"><td colspan="10">No Agents yet. Recruit one from the top bar.</td></tr>';
  }
  function open(id) {
    const a = list.find((x) => x.id === id);
    if (!a) return;
    const s = sheet(`<div class="reg-detail">
        <dl class="kv"><dt>Agent</dt><dd><span class="mono">${esc(a.label)}</span> ${esc(a.codename)}</dd><dt>Hardware</dt><dd>${esc(a.hardware.text)}</dd>
          <dt>Recruited</dt><dd class="mono">${when(a.recruitedAt)}</dd><dt>Battery</dt><dd>${a.battery != null ? `${Math.round(a.battery * 100)}%${a.charging ? ' (charging)' : ''}` : '—'}</dd>
          <dt>Uptime</dt><dd>${pctCell(a.uptime7d)} last 7 days · ${pctCell(a.uptime30d)} last 30 days</dd>
          <dt>Last calibration</dt><dd class="mono">${when(a.calibratedAt)}</dd></dl>
        <h3 class="sub">Mission history</h3>
        <ol class="timeline">${a.missionLog.slice().reverse().map((m) => `<li class="tl-case"><span class="mono small">${when(m.at)}</span><span class="tl-by small"></span><span>${esc(m.name)}</span></li>`).join('')}</ol>
        <h3 class="sub">Tamper history</h3>
        <ol class="timeline">${a.tampers.map((t) => `<li class="tl-alert"><span class="mono small">${when(t.ts)}</span><span class="tl-by small">${esc(t.data?.type || '')}</span><span>${esc(t.message.replace(/^AGENT-\d+ [A-Z0-9 _-]+: /, ''))}</span></li>`).join('') || '<li class="small muted">None.</li>'}</ol>
        <h3 class="sub">Maintenance notes</h3>
        <form data-regnotes class="note-form"><textarea name="notes" rows="4" maxlength="2000" placeholder="e.g. Charger on the hall shelf. Camera re-aimed after cleaning.">${esc(a.notes)}</textarea>
          <div class="row"><button type="button" data-regcal title="Record that you checked its position, zones and sensitivity">Mark calibrated now</button><button class="btn-primary">Save notes</button></div></form></div>`, { title: `${a.label} ${a.codename}`, wide: true });
    const f = s.el.querySelector('[data-regnotes]');
    f.addEventListener('submit', async (e) => { e.preventDefault(); try { await ctx.api(`/agents/${a.id}`, { method: 'PATCH', body: { notes: f.elements.notes.value } }); toast('Notes saved'); s.close(); load(); } catch (x) { toast(x.message, { kind: 'err' }); } });
    f.querySelector('[data-regcal]').addEventListener('click', async () => { try { await ctx.api(`/agents/${a.id}`, { method: 'PATCH', body: { calibrated: true, notes: f.elements.notes.value } }); toast('Calibration recorded'); s.close(); load(); } catch (x) { toast(x.message, { kind: 'err' }); } });
  }
  return { render, refresh() { if (root?.isConnected) load(); } };
}
