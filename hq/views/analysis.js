// ANALYSIS view: correlation rules (editable) and the household's pattern of life.
import { esc, $, toast, sheet, dayClock, confirmBox } from '../../shared/ui.js';
import { SIGNALS, RESULT_LEVELS, ALL_MODES, cleanRule } from '../../shared/correlate.js';

const SIGNAL_LABEL = Object.fromEntries(SIGNALS);
const MODE_LABEL = { home: 'Home', away: 'Away', night: 'Night', lockdown: 'Lockdown' };
const pad = (h) => String(h).padStart(2, '0');

/** ctx = { S, api(path, opts) } */
export function createAnalysis(ctx) {
  const { S } = ctx;
  const st = { tab: 'rules', rules: [], matches: [], pat: null };
  let root = null;

  const rooms = () => (S.house?.floors || []).flatMap((f) => f.rooms.map((r) => ({ id: r.id, name: S.house.floors.length > 1 ? `${r.name} (${f.name})` : r.name })));
  const whereText = (s) => (s.roomId ? rooms().find((r) => r.id === s.roomId)?.name || 'a room' : s.agentId ? (S.agents.find((a) => a.id === s.agentId)?.codename || 'an Agent') : 'anywhere');
  const stepText = (s) => `${SIGNAL_LABEL[s.signal]}${s.text ? ` “${esc(s.text)}”` : ''}${s.roomId || s.agentId ? ` · ${esc(whereText(s))}` : ''}`;

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad analysis">
      <header class="view-head"><div class="filters" role="tablist" aria-label="Analysis">
        <button role="tab" data-atab="rules" aria-pressed="${st.tab === 'rules'}">Correlation rules</button>
        <button role="tab" data-atab="pattern" aria-pressed="${st.tab === 'pattern'}">Pattern of life</button></div>
        <span class="grow"></span><span data-atools></span></header>
      <div data-abody></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    load();
  }
  async function load() {
    try {
      if (st.tab === 'rules') Object.assign(st, await ctx.api('/rules'));
      else st.pat = await ctx.api('/patterns');
    } catch (x) { toast(x.message, { kind: 'err' }); }
    draw();
  }
  function draw() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-atab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.atab === st.tab)));
    const body = $('[data-abody]', root), tools = $('[data-atools]', root);
    if (st.tab === 'rules') {
      tools.innerHTML = '<button class="small btn-primary" data-anew>New rule</button>';
      body.innerHTML = `<p class="small muted lead">A rule turns a short sequence of signals into one conclusion. Example: front door opens, then hall motion, then a known phone connects within 60 s — that is an <b>ARRIVAL</b>. Rules marked INFO are only logged; anything higher goes to the Triage queue.</p>
        <div class="table-wrap"><table class="grid-table rules-table"><thead><tr><th>On</th><th>Rule</th><th>Sequence</th><th>Within</th><th>Alert states</th><th>Result</th><th class="c-actions"></th></tr></thead><tbody>
        ${st.rules.map((r) => `<tr data-rid="${r.id}"><td><input type="checkbox" data-ron ${r.enabled ? 'checked' : ''} aria-label="Rule on"></td><td><b>${esc(r.name)}</b></td>
          <td class="small seq">${r.steps.map(stepText).join(` <span class="muted">${r.ordered ? '→' : '+'}</span> `)}</td><td class="mono small">${r.windowSec} s</td>
          <td class="small">${r.modes.length === 4 ? 'All' : r.modes.map((m) => MODE_LABEL[m]).join(', ') || 'None'}</td>
          <td><span class="mono small">${esc(r.label)}</span>${r.likely ? `<small class="muted"> · likely ${esc(r.likely)}</small>` : ''} <span class="sev sev-${r.level === 'INFO' ? 'LOW' : r.level}">${r.level}</span></td>
          <td class="c-actions"><button class="small" data-redit>Edit</button><button class="small btn-ghost" data-rdel>Delete</button></td></tr>`).join('') || '<tr class="empty"><td colspan="7">No rules. Press New rule.</td></tr>'}
        </tbody></table></div>
        <h3 class="sub">Recent matches</h3>
        <ol class="match-list">${st.matches.map((m) => `<li><span class="mono small muted">${dayClock(m.ts)}</span> <span>${esc(m.text)}</span></li>`).join('') || '<li class="small muted">No matches yet.</li>'}</ol>`;
    } else {
      const p = st.pat;
      tools.innerHTML = '<button class="small" data-arebuild title="Re-learn from the Mission Log now">Rebuild</button>';
      if (!p) { body.innerHTML = ''; return; }
      const learnPct = Math.round((Math.min(p.daysObserved, p.learnDays) / p.learnDays) * 100);
      body.innerHTML = `<div class="pol-status panel"><div class="row"><b>${p.learning ? 'Learning' : 'Baseline active'}</b><span class="small muted">${p.daysObserved} of ${p.learnDays} days of history (${p.observed.wd} weekdays, ${p.observed.we} weekend days)</span></div>
          <div class="meter-line" role="progressbar" aria-valuenow="${learnPct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${learnPct}%"></i></div>
          <p class="small muted">${p.learning ? `Anomaly alerts start after ${p.minDays} days. Until then SENTINEL only watches.` : 'Activity that doesn’t fit this pattern is flagged with a confidence percentage and sent to Triage.'}</p></div>
        ${p.places.length ? `<div class="pol-grid panel"><div class="pol-legend small muted"><span>Share of days with activity in each hour</span><span class="pol-ramp"><i style="opacity:.15"></i><i style="opacity:.4"></i><i style="opacity:.7"></i><i style="opacity:1"></i></span><span>0% → 100%</span></div>
          <table class="pol-table"><thead><tr><th></th><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 ? '' : pad(h)}</th>`).join('')}</tr></thead><tbody>
          ${p.places.map((pl) => ['wd', 'we'].map((t, i) => `<tr>${i ? '' : `<th rowspan="2" class="pol-place">${esc(pl.name)}</th>`}<td class="small muted">${t === 'wd' ? 'Weekdays' : 'Weekends'}</td>${pl[t].map((v, h) => `<td class="pol-cell" title="${esc(pl.name)} · ${t === 'wd' ? 'weekdays' : 'weekends'} ${pad(h)}:00–${pad((h + 1) % 24)}:00 · active on ${Math.round(v * 100)}% of days"><i style="opacity:${v ? (0.12 + v * 0.88).toFixed(2) : 0}"></i></td>`).join('')}</tr>`).join('')).join('')}
          </tbody></table></div>` : '<p class="small muted">No room activity in the last two weeks yet. Place Agents on the floor plan so activity is counted per room.</p>'}
        <h3 class="sub">Recent anomalies</h3>
        <div class="table-wrap"><table class="grid-table compact"><thead><tr><th>Time</th><th>Anomaly</th><th>Confidence</th><th>Why</th></tr></thead><tbody>
        ${p.anomalies.map((a) => `<tr><td class="mono small">${dayClock(a.ts)}</td><td>${esc(a.title)}</td><td class="mono">${a.confidence}%</td><td class="small">${esc(a.reason)}</td></tr>`).join('') || '<tr class="empty"><td colspan="4">None so far.</td></tr>'}
        </tbody></table></div>`;
    }
  }

  function editor(rule = null) {
    const r = cleanRule(rule || { name: '', steps: [{ signal: 'door', text: 'open' }, { signal: 'motion' }], windowSec: 60, label: '', level: 'INFO' });
    const where = (s) => `<select data-sfwhere aria-label="Where"><option value="">Anywhere</option>
      ${rooms().length ? `<optgroup label="Room">${rooms().map((x) => `<option value="room:${x.id}" ${s.roomId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : ''}
      ${S.agents.length ? `<optgroup label="Agent">${S.agents.map((a) => `<option value="agent:${a.id}" ${s.agentId === a.id ? 'selected' : ''}>${esc(a.codename)}</option>`).join('')}</optgroup>` : ''}</select>`;
    const stepRow = (s, i) => `<li class="step-row" data-step><span class="mono small muted">${i + 1}</span>
      <select data-sfsignal aria-label="Signal">${SIGNALS.map(([k, l]) => `<option value="${k}" ${s.signal === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${where(s)}<input data-sftext value="${esc(s.text)}" maxlength="40" placeholder="text contains (optional)" aria-label="Text contains">
      <button type="button" class="icon-btn btn-ghost" data-sfdel aria-label="Remove step">✕</button></li>`;
    const sh = sheet(`<form data-ruleform class="rule-form">
        <label class="field"><span>Name</span><input name="rname" value="${esc(r.name)}" maxlength="60" required placeholder="e.g. Arrival"></label>
        <div class="field"><span class="flabel">Sequence</span><ol class="steps" data-steps>${r.steps.map(stepRow).join('')}</ol>
          <button type="button" class="small" data-sfadd>Add signal</button></div>
        <div class="row"><label class="field grow"><span>Within (seconds)</span><input name="window" type="number" min="5" max="3600" value="${r.windowSec}"></label>
          <label class="row small" style="gap:6px;margin-top:10px"><input type="checkbox" name="ordered" ${r.ordered ? 'checked' : ''}> In this order</label></div>
        <div class="row"><label class="field grow"><span>Conclusion</span><input name="label" value="${esc(r.label === 'MATCH' && !rule ? '' : r.label)}" maxlength="30" placeholder="e.g. ARRIVAL" required></label>
          <label class="field grow"><span>Likely (optional)</span><input name="likely" value="${esc(r.likely)}" maxlength="40" placeholder="e.g. Mum — or leave empty to use the phone’s owner"></label></div>
        <div class="row"><label class="field grow"><span>Result</span><select name="level">${RESULT_LEVELS.map((l) => `<option value="${l}" ${r.level === l ? 'selected' : ''}>${l === 'INFO' ? 'INFO — just log it' : `${l} alert in Triage`}</option>`).join('')}</select></label></div>
        <fieldset class="field modes-pick"><span class="flabel">Active in alert states</span>${ALL_MODES.map((m) => `<label><input type="checkbox" name="mode" value="${m}" ${r.modes.includes(m) ? 'checked' : ''}> ${MODE_LABEL[m]}</label>`).join('')}</fieldset>
        <p class="small muted" data-testout></p>
        <div class="row" style="justify-content:flex-end"><button type="button" data-rtest>Test on last 7 days</button><button type="button" data-close>Cancel</button><button class="btn-primary">Save rule</button></div></form>`, { title: rule ? 'Edit rule' : 'New correlation rule', wide: true });
    const f = sh.el.querySelector('[data-ruleform]');
    const read = () => ({
      id: r.id, name: f.elements.rname.value, windowSec: Number(f.elements.window.value), ordered: f.elements.ordered.checked,
      label: f.elements.label.value, likely: f.elements.likely.value, level: f.elements.level.value, enabled: rule ? rule.enabled : true,
      modes: [...f.querySelectorAll('[name=mode]:checked')].map((x) => x.value),
      steps: [...f.querySelectorAll('[data-step]')].map((li) => { const w = li.querySelector('[data-sfwhere]').value; return { signal: li.querySelector('[data-sfsignal]').value, roomId: w.startsWith('room:') ? w.slice(5) : null, agentId: w.startsWith('agent:') ? w.slice(6) : null, text: li.querySelector('[data-sftext]').value }; }),
    });
    const renumber = () => f.querySelectorAll('[data-step] .mono').forEach((x, i) => { x.textContent = i + 1; });
    f.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if ('sfadd' in b.dataset) { const list = f.querySelector('[data-steps]'); if (list.children.length >= 6) return toast('Up to 6 signals per rule.'); list.insertAdjacentHTML('beforeend', stepRow({ signal: 'motion', text: '' }, list.children.length)); }
      else if ('sfdel' in b.dataset) { if (f.querySelectorAll('[data-step]').length > 1) { b.closest('[data-step]').remove(); renumber(); } }
      else if ('rtest' in b.dataset) {
        const out = f.querySelector('[data-testout]'); out.textContent = 'Testing…';
        try { const t = await ctx.api('/rules/test', { method: 'POST', body: read() }); out.innerHTML = `Would have matched <b>${t.count}</b> time${t.count === 1 ? '' : 's'} in the last ${t.days} days.${t.examples.length ? `<br>${t.examples.map((x) => `${dayClock(x.ts)} · ${esc(x.text)}`).join('<br>')}` : ''}`; } catch (x) { out.textContent = x.message; }
      }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = read();
      try { await ctx.api(`/rules/${body.id}`, { method: 'PUT', body }); sh.close(); toast(`Rule “${cleanRule(body).name}” saved`); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    });
  }

  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('[data-rid]'), rule = row && st.rules.find((r) => r.id === row.dataset.rid);
    if (b.dataset.atab) { st.tab = b.dataset.atab; load(); }
    else if ('anew' in b.dataset) editor();
    else if ('redit' in b.dataset && rule) editor(rule);
    else if ('rdel' in b.dataset && rule) { if (await confirmBox('Delete this rule?', `“${rule.name}” stops running. Past matches stay in the log.`, { ok: 'Delete', danger: true })) { try { await ctx.api(`/rules/${rule.id}`, { method: 'DELETE' }); load(); } catch (x) { toast(x.message, { kind: 'err' }); } } }
    else if ('arebuild' in b.dataset) { try { st.pat = await ctx.api('/patterns/rebuild', { method: 'POST' }); draw(); } catch (x) { toast(x.message, { kind: 'err' }); } }
  }
  async function onChange(e) {
    if (e.target.matches('[data-ron]')) {
      const rule = st.rules.find((r) => r.id === e.target.closest('[data-rid]').dataset.rid);
      try { await ctx.api(`/rules/${rule.id}`, { method: 'PUT', body: { ...rule, enabled: e.target.checked } }); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    }
  }
  return { render, refresh() { if (root?.isConnected) load(); } };
}
