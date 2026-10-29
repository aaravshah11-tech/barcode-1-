// REPORTS view: today's SITREP, the archive of reports (download as PDF), and a report builder.
import { esc, $, toast, confirmBox } from '../../shared/ui.js';
import { SECTIONS, ALL_SECTIONS, reportPdf } from '../../shared/report.js';

const fmt = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const PRESETS = [['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['custom', 'Choose dates']];

/** Save the PDF for a report to the Downloads folder. */
export function downloadPdf(rep) {
  const blob = new Blob([reportPdf(rep)], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${rep.ref}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** ctx = { S, api(path, opts) } */
export function createReports(ctx) {
  const { S } = ctx;
  const st = { tab: 'sitrep', sitrep: null, list: [], preset: '7d' };
  let root = null;

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad reports">
      <header class="view-head"><div class="filters" role="tablist" aria-label="Reports">
        <button role="tab" data-rtab="sitrep">SITREP</button><button role="tab" data-rtab="list">Reports</button><button role="tab" data-rtab="build">Report builder</button></div>
        <span class="grow"></span><span data-rtools></span></header><div data-rbody></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
    load();
  }
  async function load() {
    try {
      if (st.tab === 'sitrep') st.sitrep = await ctx.api('/sitrep');
      else if (st.tab === 'list') st.list = await ctx.api('/reports');
    } catch (x) { toast(x.message, { kind: 'err' }); }
    draw();
  }
  function draw() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-rtab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rtab === st.tab)));
    const body = $('[data-rbody]', root), tools = $('[data-rtools]', root);
    if (st.tab === 'sitrep') {
      const r = st.sitrep;
      tools.innerHTML = '<button class="small" data-rrefresh>Refresh</button><button class="small" data-rsitpdf>Download PDF</button><button class="small btn-primary" data-rsitsave>Save to reports</button>';
      body.innerHTML = r ? `<article class="panel sitrep">
        <div class="sitrep-head"><div><span class="mono small muted">${esc(r.ref)}</span><h3>Situation report — last 24 hours</h3><span class="small muted">${fmt(r.from)} to ${fmt(r.to)} · prepared by SENTINEL for ${esc(S.operator || 'the Director')}</span></div></div>
        ${r.sitrep.map((sec) => `<section><h4>${esc(sec.h)}</h4>${sec.lines.filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('')}</section>`).join('')}
        <p class="small muted">A SITREP is also written automatically every morning at 07:00 and a weekly report every Monday at 07:00 while HQ is open. Find them under Reports.</p></article>` : '';
    } else if (st.tab === 'list') {
      tools.innerHTML = '<button class="small" data-rweekly title="Last Monday to Sunday">Weekly report now</button>';
      body.innerHTML = `<div class="table-wrap"><table class="grid-table"><thead><tr><th>Reference</th><th>Title</th><th>Period</th><th>Prepared</th><th class="c-actions"></th></tr></thead><tbody>
        ${st.list.map((r) => `<tr data-rid="${r.id}"><td class="mono small">${esc(r.ref)}</td><td>${esc(r.title)}</td><td class="small">${fmt(r.from)} – ${fmt(r.to)}</td><td class="small">${fmt(r.generatedAt)} · ${esc(r.generatedBy)}</td>
          <td class="c-actions"><button class="small btn-primary" data-rpdf>Download PDF</button><button class="small btn-ghost" data-rdel>Delete</button></td></tr>`).join('') || '<tr class="empty"><td colspan="5">No reports yet. Save today’s SITREP, press “Weekly report now”, or build one.</td></tr>'}
        </tbody></table></div>`;
    } else {
      tools.innerHTML = '';
      const rooms = (S.house?.floors || []).flatMap((f) => f.rooms.map((r) => ({ id: r.id, name: r.name })));
      body.innerHTML = `<form class="panel builder-form" data-rbuild>
        <label class="field"><span>Title</span><input name="rtitle" maxlength="80" placeholder="e.g. Half-term holiday — house empty"></label>
        <fieldset class="field"><span class="flabel">Period</span><div class="filters" role="group">${PRESETS.map(([k, l]) => `<button type="button" data-rpreset="${k}" aria-pressed="${st.preset === k}">${l}</button>`).join('')}</div>
          <div class="row" data-rdates ${st.preset === 'custom' ? '' : 'hidden'}><label class="field grow"><span>From</span><input type="date" name="from" value="${dateInput(Date.now() - 7 * 86400000)}"></label><label class="field grow"><span>To (inclusive)</span><input type="date" name="to" value="${dateInput(Date.now())}"></label></div></fieldset>
        <fieldset class="field"><span class="flabel">Sections</span><div class="check-grid">${SECTIONS.map(([k, l]) => `<label><input type="checkbox" name="sec" value="${k}" ${ALL_SECTIONS.includes(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></fieldset>
        <div class="row"><label class="field grow"><span>Alerts to include</span><select name="minsev"><option value="">All severities</option><option value="MEDIUM">Medium and above</option><option value="HIGH">High and critical only</option></select></label></div>
        ${rooms.length ? `<fieldset class="field"><span class="flabel">Only these rooms (leave all unticked for the whole house)</span><div class="check-grid">${rooms.map((r) => `<label><input type="checkbox" name="room" value="${r.id}"> ${esc(r.name)}</label>`).join('')}</div></fieldset>` : ''}
        ${S.agents.length ? `<fieldset class="field"><span class="flabel">Only these Agents (leave all unticked for every Agent)</span><div class="check-grid">${S.agents.map((a) => `<label><input type="checkbox" name="agent" value="${a.id}"> ${esc(a.codename)}</label>`).join('')}</div></fieldset>` : ''}
        <div class="row" style="justify-content:flex-end"><button class="btn-primary">Create report and download PDF</button></div></form>`;
    }
  }
  function period(f) {
    const now = Date.now();
    if (st.preset === '24h') return [now - 86400000, now];
    if (st.preset === '7d') return [now - 7 * 86400000, now];
    if (st.preset === '30d') return [now - 30 * 86400000, now];
    if (st.preset === 'month') { const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); return [d.getTime(), now]; }
    const from = new Date(`${f.elements.from.value}T00:00:00`).getTime(), to = new Date(`${f.elements.to.value}T00:00:00`).getTime() + 86400000;
    return [from, Math.min(to, now)];
  }
  async function onSubmit(e) {
    if (!e.target.matches('[data-rbuild]')) return;
    e.preventDefault();
    const f = e.target, [from, to] = period(f);
    const pick = (n) => [...f.querySelectorAll(`[name=${n}]:checked`)].map((x) => x.value);
    try {
      const rep = await ctx.api('/reports', { method: 'POST', body: { kind: 'custom', from, to, title: f.elements.rtitle.value, sections: pick('sec'), filter: { minSeverity: f.elements.minsev.value || null, rooms: pick('room'), agents: pick('agent') } } });
      downloadPdf(rep);
      toast(`${rep.ref} created`);
      st.tab = 'list'; load();
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('[data-rid]');
    try {
      if (b.dataset.rtab) { st.tab = b.dataset.rtab; load(); }
      else if ('rrefresh' in b.dataset) load();
      else if ('rsitpdf' in b.dataset && st.sitrep) downloadPdf({ ...st.sitrep, title: 'Situation report — last 24 hours', generatedBy: S.operator || 'HQ', sections: [] });
      else if ('rsitsave' in b.dataset) { const r = await ctx.api('/reports', { method: 'POST', body: { kind: 'sitrep' } }); toast(`${r.ref} saved`); }
      else if ('rweekly' in b.dataset) { const r = await ctx.api('/reports', { method: 'POST', body: { kind: 'weekly' } }); downloadPdf(r); toast(`${r.ref} created`); load(); }
      else if ('rpdf' in b.dataset && row) downloadPdf(await ctx.api(`/reports/${row.dataset.rid}`));
      else if ('rdel' in b.dataset && row) { if (await confirmBox('Delete this report?', 'The events it describes stay in the log; only this copy of the report is removed.', { ok: 'Delete', danger: true })) { await ctx.api(`/reports/${row.dataset.rid}`, { method: 'DELETE' }); load(); } }
      else if (b.dataset.rpreset) { st.preset = b.dataset.rpreset; root.querySelectorAll('[data-rpreset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); root.querySelector('[data-rdates]').hidden = st.preset !== 'custom'; }
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  function onChange() {}
  return { render, refresh() { if (root?.isConnected && st.tab === 'list') load(); } };
}
