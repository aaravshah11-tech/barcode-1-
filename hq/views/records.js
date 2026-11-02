// RECORDS › SEARCH: find anything in the event log — by words, kind, level, area and dates, or in plain
// English ("people at the front yesterday") — save searches you use often, and export the results.
import { esc, $, toast, dayClock } from '../../shared/ui.js';
import { saveFile } from './data.js';
import { laneOf } from '../floor.js';

const KINDS = [['', 'Any kind'], ['motion', 'Motion'], ['door', 'Door'], ['perimeter', 'Perimeter (outside)'], ['sound', 'Sound'], ['light', 'Light'], ['knock', 'Door panel'], ['tamper', 'Tamper'], ['agent', 'Agent'], ['triage', 'Triage'], ['network', 'Network'], ['device', 'Device'], ['system', 'System'], ['analyst', 'Analyst'], ['digest', 'Digest']];
const LEVELS = [['', 'Any level'], ['alert', 'Alert'], ['warn', 'Warning'], ['info', 'Info']];
const ZONES = [['', 'Anywhere'], ['inside', 'Inside'], ['front', 'Front'], ['garden', 'Garden'], ['garage', 'Garage'], ['network', 'Network']];
const day = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const opts = (list, v) => list.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('');

/** ctx = { S, api } */
export function createRecords(ctx) {
  const { S } = ctx;
  let root = null, results = [], saved = [];
  const st = { text: '', kind: '', level: '', zone: '', from: day(Date.now() - 7 * 86400000), to: day(Date.now()) };

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad records">
      <section class="panel rec-find"><form data-rform class="rec-form">
        <label class="field grow"><span>Words</span><input name="text" value="${esc(st.text)}" placeholder="e.g. kitchen, OWL, ALT-000412"></label>
        <label class="field"><span>Kind</span><select name="kind">${opts(KINDS, st.kind)}</select></label>
        <label class="field"><span>Level</span><select name="level">${opts(LEVELS, st.level)}</select></label>
        <label class="field"><span>Where</span><select name="zone">${opts(ZONES, st.zone)}</select></label>
        <label class="field"><span>From</span><input type="date" name="from" value="${st.from}"></label>
        <label class="field"><span>To</span><input type="date" name="to" value="${st.to}"></label>
        <button class="btn-primary">Search</button></form>
        <form class="row" data-rplain><input name="q" placeholder="…or in plain English: people at the front yesterday" aria-label="Plain-English search"><button>Understand</button></form>
        <div class="row rec-saved"><span class="lbl">Saved</span><span data-rsaved class="row"></span><span class="grow"></span><button class="small" data-rsave>Save this search</button></div></section>
      <section class="panel rec-results"><div class="row"><span class="lbl grow" data-rcount></span><button class="small" data-rexport="csv">⇩ CSV</button><button class="small" data-rexport="json">⇩ JSON</button></div>
        <div class="table-wrap"><table class="grid-table"><thead><tr><th>Time</th><th>Reference</th><th>Kind</th><th>Level</th><th>What happened</th></tr></thead><tbody data-rrows></tbody></table></div></section></div>`;
    $('[data-rform]', root).addEventListener('submit', (e) => { e.preventDefault(); read(); run(); });
    $('[data-rplain]', root).addEventListener('submit', plain);
    root.addEventListener('click', onClick);
    loadSaved(); run();
  }
  function read() { const f = $('[data-rform]', root).elements; Object.assign(st, { text: f.text.value.trim(), kind: f.kind.value, level: f.level.value, zone: f.zone.value, from: f.from.value, to: f.to.value }); }
  function fill() { const f = $('[data-rform]', root).elements; for (const k of ['text', 'kind', 'level', 'zone', 'from', 'to']) f[k].value = st[k]; }
  async function run() {
    const from = new Date(`${st.from}T00:00`).getTime(), to = new Date(`${st.to}T23:59:59`).getTime();
    let events = [];
    try { events = await ctx.api(`/log?since=${from}&limit=20000`); } catch (x) { return toast(x.message, { kind: 'err' }); }
    const words = st.text.toLowerCase().split(/\s+/).filter(Boolean);
    results = events.filter((e) => e.ts <= to && (!st.kind || e.kind === st.kind) && (!st.level || e.level === st.level)
      && (!st.zone || laneOf(e, S.agents, S.house) === st.zone)
      && words.every((w) => `${e.message} EVT-${e.id} ${JSON.stringify(e.data || {})}`.toLowerCase().includes(w)));
    draw();
  }
  function draw() {
    if (!$('[data-rrows]', root)) return;
    $('[data-rcount]', root).textContent = `${results.length} event${results.length === 1 ? '' : 's'}${results.length > 500 ? ' (first 500 shown; export has all)' : ''}`;
    $('[data-rrows]', root).innerHTML = results.slice(0, 500).map((e) => `<tr><td class="mono small">${esc(dayClock(e.ts))}</td><td class="mono small muted">EVT-${e.id}</td><td class="small">${esc(e.kind)}</td><td class="small ${e.level === 'alert' ? 'c-red' : e.level === 'warn' ? 'c-amber' : 'muted'}">${esc(e.level)}</td><td>${esc(e.message)}</td></tr>`).join('') || '<tr class="empty"><td colspan="5">Nothing matches.</td></tr>';
  }
  async function plain(e) {
    e.preventDefault();
    const q = e.target.elements.q.value.trim();
    if (!q) return;
    try {
      const r = await ctx.api('/analyst/search', { method: 'POST', body: { q } });
      const f = r.filter, now = Date.now();
      Object.assign(st, { text: f.text || '', kind: f.kind || '', zone: f.zone || '', level: '', from: day(f.from ?? now - f.hours * 3600000), to: day(f.to ?? now) });
      fill();
      toast(`Understood as: ${r.understood}`);
      await run();
      if (f.class) { results = results.filter((x) => x.data?.class === f.class); draw(); }
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  async function loadSaved() {
    try { saved = await ctx.api('/savedsearches'); } catch { saved = []; }
    const box = $('[data-rsaved]', root);
    if (box) box.innerHTML = saved.map((s) => `<span class="chip"><button class="linkish" data-rload="${s.id}">${esc(s.name)}</button><button class="icon-btn small" data-rdel="${s.id}" aria-label="Delete saved search ${esc(s.name)}">×</button></span>`).join('') || '<span class="small muted">None yet.</span>';
  }
  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if ('rsave' in b.dataset) {
      read();
      const name = prompt('Name this search (e.g. “Night-time doors”)', st.text || st.kind || 'My search');
      if (!name) return;
      try { await ctx.api('/savedsearches', { method: 'POST', body: { name, query: { ...st, days: Math.max(1, Math.round((new Date(st.to) - new Date(st.from)) / 86400000)) } } }); toast('Search saved'); loadSaved(); } catch (x) { toast(x.message, { kind: 'err' }); }
    } else if (b.dataset.rload) {
      const s = saved.find((x) => x.id === b.dataset.rload);
      if (!s) return;
      Object.assign(st, s.query, { from: day(Date.now() - (s.query.days || 7) * 86400000), to: day(Date.now()) }); // dates move with today
      fill(); run();
    } else if (b.dataset.rdel) {
      try { await ctx.api(`/savedsearches/${b.dataset.rdel}`, { method: 'DELETE' }); loadSaved(); } catch (x) { toast(x.message, { kind: 'err' }); }
    } else if (b.dataset.rexport) {
      const name = `sentinel-records-${st.from}-to-${st.to}`;
      if (b.dataset.rexport === 'json') saveFile(`${name}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), search: st, events: results }, null, 2));
      else saveFile(`${name}.csv`, ['time,reference,kind,level,message', ...results.map((x) => [new Date(x.ts).toISOString(), `EVT-${x.id}`, x.kind, x.level, `"${String(x.message).replace(/"/g, '""')}"`].join(','))].join('\n'), 'text/csv');
      toast(`${results.length} events exported`);
    }
  }
  return { render };
}
