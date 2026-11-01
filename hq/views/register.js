// AGENTS › REGISTRY: the whole fleet in one table — signal, battery, last report, version and a health
// score — with bulk actions (change mission, Identify, update), day/night profiles, battery history and
// the weekly fleet health summary.
import { esc, $, toast, sheet, dayClock, ago } from '../../shared/ui.js';
import { MISSIONS } from '../../shared/missions.js';
import { renderDiagnostics } from '../diagnostics.js';

const when = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const pctCell = (v) => (v == null ? '<span class="muted">—</span>' : `<span class="mono ${v < 90 ? 'c-amber' : ''}">${v}%</span>`);
const HEALTH = { good: 'GOOD', fair: 'FAIR', poor: 'POOR' };
const missionOptions = (sel) => MISSIONS.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

function battCell(a) {
  if (a.battery == null) return '<span class="muted">—</span>';
  const p = Math.round(a.battery * 100), low = p < 20 && !a.charging;
  return `<span class="batbar ${low ? 'low' : ''}" aria-hidden="true"><i style="width:${p}%"></i></span> <span class="mono small ${low ? 'c-red' : ''}">${p}%${a.charging ? ' ⚡' : ''}</span><span class="sr-only">${a.charging ? 'charging' : 'not charging'}</span>`;
}
const signalCell = (a) => (!a.online ? '<span class="muted">—</span>' : `<span class="mono small">${a.rtt != null ? `${a.rtt} ms` : '…'}${a.net ? ` · ${esc(String(a.net).toUpperCase())}` : ''}</span>`);

/** ctx = { S, api(path, opts) } */
export function createRegister(ctx) {
  const { S } = ctx;
  let root = null, list = [], summary = null;
  const picked = new Set();

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad register">
      <section class="panel fleet-sum" data-fsum><span class="lbl">Fleet health</span><p class="small muted">Loading…</p></section>
      <div class="bulk row" data-bulk>
        <span class="small mono" data-picked>0 selected</span>
        <label class="small">Mission <select data-bmission>${missionOptions('standby')}</select></label><button data-bulkdo="mission">Apply</button>
        <button data-bulkdo="identify" title="Flash and beep the selected Agents">Identify</button>
        <button data-bulkdo="update" title="Reload the selected Agents so they run the newest version">Update</button>
        <span class="grow"></span><button class="btn-ghost small" data-pickall>Select all</button>
      </div>
      <div class="table-wrap"><table class="grid-table reg-table"><thead><tr><th><span class="sr-only">Select</span></th><th>Agent</th><th>Status</th><th>Mission</th><th>Battery</th><th>Signal</th><th>Last report</th><th>Version</th><th>Health</th><th>Uptime 7 d</th><th>Location</th></tr></thead><tbody data-rrows></tbody></table></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', (e) => {
      const c = e.target.closest('[data-pick]');
      if (!c) return;
      if (c.checked) picked.add(c.dataset.pick); else picked.delete(c.dataset.pick);
      showPicked();
    });
    root.addEventListener('keydown', (e) => { const tr = e.target.closest('[data-reg]'); if (tr && e.key === 'Enter') open(tr.dataset.reg); });
    load();
  }
  async function onClick(e) {
    if (e.target.closest('[data-pick], label')) return;
    const b = e.target.closest('button');
    if (b?.dataset.bulkdo) return bulk(b.dataset.bulkdo);
    if (b && 'pickall' in b.dataset) { const all = picked.size === list.length; picked.clear(); if (!all) list.forEach((a) => picked.add(a.id)); draw(); return; }
    const tr = e.target.closest('[data-reg]');
    if (tr) open(tr.dataset.reg);
  }
  async function bulk(action) {
    if (!picked.size) return toast('Tick one or more Agents first.', { kind: 'err' });
    const mission = $('[data-bmission]', root).value;
    try {
      const r = await ctx.api('/agents/bulk', { method: 'POST', body: { ids: [...picked], action, mission } });
      toast(`${r.done} Agent${r.done === 1 ? '' : 's'} done${r.offline ? ` · ${r.offline} offline` : ''}`);
      load();
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  async function load() {
    try { [list, summary] = await Promise.all([ctx.api('/register'), ctx.api('/fleet/summary')]); } catch (x) { toast(x.message, { kind: 'err' }); return; }
    for (const id of [...picked]) if (!list.some((a) => a.id === id)) picked.delete(id);
    draw();
  }
  const roomName = (place) => { if (place?.zone) return `Outside · ${place.zone}`; for (const f of S.house?.floors || []) { const r = f.rooms.find((x) => x.id === place?.roomId); if (r) return r.name; } return place ? 'On the plan' : 'Not placed'; };
  function showPicked() { const el = $('[data-picked]', root); if (el) el.textContent = `${picked.size} selected`; }
  function draw() {
    if (!root?.isConnected) return;
    $('[data-fsum]', root).innerHTML = `<span class="lbl">Fleet health · this week</span>
      <div class="fsum-row"><span class="kfig">${summary?.avg ?? '—'}<small>/100</small></span><p>${esc(summary?.headline || '')}</p></div>
      ${summary?.lines?.length ? `<ul class="small fsum-lines">${summary.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      <p class="small muted">Current SENTINEL version ${esc(summary?.version || '')} · it is ${summary?.phase === 'night' ? 'night' : 'day'} for day/night profiles.</p>`;
    // problems first
    const rows = [...list].sort((a, b) => a.health.score - b.health.score || a.label.localeCompare(b.label));
    $('[data-rrows]', root).innerHTML = rows.length ? rows.map((a) => `<tr data-reg="${a.id}" tabindex="0" class="clickable">
      <td><input type="checkbox" data-pick="${a.id}" ${picked.has(a.id) ? 'checked' : ''} aria-label="Select ${esc(a.codename)}"></td>
      <td><span class="mono small muted">${esc(a.label)}</span> <b>${esc(a.codename)}</b>${a.name ? `<small class="muted"> · ${esc(a.name)}</small>` : ''}</td>
      <td><span class="dot ${a.online ? 'on' : ''}"></span> ${a.online ? 'Online' : `Offline <small class="muted">${a.lastSeen ? ago(a.lastSeen) : ''}</small>`}</td>
      <td class="small">${esc(a.missionName)}${a.armable ? '' : ' <span class="tag-warn">NOT ARMED</span>'}${a.profiles?.on ? ' <span class="muted" title="Day/night profile">◐</span>' : ''}</td>
      <td class="nowrap">${battCell(a)}</td><td>${signalCell(a)}</td>
      <td class="small">${a.lastEvent ? `<span class="mono muted">${dayClock(a.lastEvent.ts)}</span> ${esc(a.lastEvent.message.replace(/^AGENT-\d+ [^:]+: /, '').slice(0, 40))}` : '<span class="muted">none</span>'}</td>
      <td class="mono small ${a.version && summary?.version && a.version !== summary.version ? 'c-amber' : ''}">${esc(a.version || '—')}</td>
      <td><span class="health ${a.health.grade}" title="${esc(a.health.notes.join(', ') || 'No problems')}">${a.health.score} <small>${HEALTH[a.health.grade]}</small></span></td>
      <td>${pctCell(a.uptime7d)}</td><td class="small">${esc(roomName(a.place))}</td></tr>`).join('')
      : '<tr class="empty"><td colspan="11">No Agents yet. Recruit one from the top bar.</td></tr>';
    showPicked();
  }
  function open(id) {
    const a = list.find((x) => x.id === id);
    if (!a) return;
    const p = a.profiles || { on: false, day: a.mission, night: a.mission };
    const s = sheet(`<div class="reg-detail">
        <dl class="kv"><dt>Agent</dt><dd><span class="mono">${esc(a.label)}</span> ${esc(a.codename)}</dd><dt>Hardware</dt><dd>${esc(a.hardware.text)}</dd>
          <dt>Health</dt><dd><span class="health ${a.health.grade}">${a.health.score} ${HEALTH[a.health.grade]}</span> <span class="small muted">${esc(a.health.notes.join(', ') || 'no problems')}</span></dd>
          <dt>Version</dt><dd class="mono">${esc(a.version || '—')}</dd>
          <dt>Recruited</dt><dd class="mono">${when(a.recruitedAt)}</dd>
          <dt>Uptime</dt><dd>${pctCell(a.uptime7d)} last 7 days · ${pctCell(a.uptime30d)} last 30 days</dd>
          <dt>Last calibration</dt><dd class="mono">${when(a.calibratedAt)}</dd></dl>
        <h3 class="sub">Battery and link</h3><div class="diag" data-rdiag><p class="small muted">Loading…</p></div>
        <h3 class="sub">Day / night profile</h3>
        <form data-profile class="row profile-form">
          <label class="row small"><input type="checkbox" name="on" ${p.on ? 'checked' : ''}> Switch mission at sunrise and sunset</label>
          <label class="small">Day <select name="day">${missionOptions(p.day)}</select></label>
          <label class="small">Night <select name="night">${missionOptions(p.night)}</select></label>
          <button>Save profile</button></form>
        <p class="small muted">Uses sunrise/sunset for your location (Administration › Settings); without one, day is 07:00–20:00.</p>
        <h3 class="sub">Recent reports</h3>
        <ol class="timeline">${a.history.map((h) => `<li class="tl-${h.level === 'alert' ? 'alert' : 'case'}"><span class="mono small">${when(h.ts)}</span><span class="tl-by small">${esc(h.kind)}</span><span>${esc(h.message.replace(/^AGENT-\d+ [^:]+: /, ''))}</span></li>`).join('') || '<li class="small muted">None.</li>'}</ol>
        <h3 class="sub">Mission history</h3>
        <ol class="timeline">${a.missionLog.slice().reverse().map((m) => `<li class="tl-case"><span class="mono small">${when(m.at)}</span><span class="tl-by small"></span><span>${esc(m.name)}</span></li>`).join('')}</ol>
        <h3 class="sub">Tamper history</h3>
        <ol class="timeline">${a.tampers.map((t) => `<li class="tl-alert"><span class="mono small">${when(t.ts)}</span><span class="tl-by small">${esc(t.data?.type || '')}</span><span>${esc(t.message.replace(/^AGENT-\d+ [A-Z0-9 _-]+: /, ''))}</span></li>`).join('') || '<li class="small muted">None.</li>'}</ol>
        <h3 class="sub">Maintenance notes</h3>
        <form data-regnotes class="note-form"><textarea name="notes" rows="4" maxlength="2000" placeholder="e.g. Charger on the hall shelf. Camera re-aimed after cleaning.">${esc(a.notes)}</textarea>
          <div class="row"><button type="button" data-regcal title="Record that you checked its position, zones and sensitivity">Mark calibrated now</button><button class="btn-primary">Save notes</button></div></form></div>`, { title: `${a.label} ${a.codename}`, wide: true });
    renderDiagnostics(s.el.querySelector('[data-rdiag]'), a, ctx.api);
    const pf = s.el.querySelector('[data-profile]');
    pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await ctx.api(`/agents/${a.id}`, { method: 'PATCH', body: { profiles: { on: pf.elements.on.checked, day: pf.elements.day.value, night: pf.elements.night.value } } }); toast(pf.elements.on.checked ? 'Profile saved — it switches at sunrise and sunset' : 'Profile off'); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    });
    const f = s.el.querySelector('[data-regnotes]');
    f.addEventListener('submit', async (e) => { e.preventDefault(); try { await ctx.api(`/agents/${a.id}`, { method: 'PATCH', body: { notes: f.elements.notes.value } }); toast('Notes saved'); s.close(); load(); } catch (x) { toast(x.message, { kind: 'err' }); } });
    f.querySelector('[data-regcal]').addEventListener('click', async () => { try { await ctx.api(`/agents/${a.id}`, { method: 'PATCH', body: { calibrated: true, notes: f.elements.notes.value } }); toast('Calibration recorded'); s.close(); load(); } catch (x) { toast(x.message, { kind: 'err' }); } });
  }
  return { render, refresh() { if (root?.isConnected) load(); } };
}
