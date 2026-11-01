// GRADING RULES (Administration › Rules and patterns › Grading): a visual "when … then …" builder that
// changes how serious an alert is before it reaches Triage, plus a "try it" box to see the result.
import { esc, $, toast, sheet, confirmBox } from '../../shared/ui.js';
import { RULE_FIELDS, RULE_ACTIONS, cleanGradeRule, describeRule } from '../../shared/grading.js';
import { SEVERITIES, SEV_LABEL } from '../../shared/triage.js';

const MODES = [['home', 'Home'], ['away', 'Away'], ['night', 'Night'], ['lockdown', 'Lockdown']];
const select = (name, options, v) => `<select name="${name}">${options.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const sevOptions = SEVERITIES.map((s) => [s, SEV_LABEL[s]]);

/** Draw the tab. ctx = { api }, rules = current list, reload() redraws after a change. */
export function drawGrading(body, tools, ctx, rules, reload) {
  tools.innerHTML = '<button class="small btn-primary" data-gnew>New grading rule</button>';
  body.innerHTML = `<p class="small muted lead">SENTINEL already grades every alert by what was seen, where, the Alert State, the weather and what is normal at that hour. Grading rules let you adjust that — for example “an animal in the garden at night → log only”. They run in order, top to bottom. Critical alerts (PANIC, LOCKDOWN) can’t be lowered.</p>
    <div class="table-wrap"><table class="grid-table rules-table"><thead><tr><th>On</th><th>Rule</th><th>When … then</th><th class="c-actions"></th></tr></thead><tbody>
    ${rules.length ? rules.map((r) => `<tr data-gid="${r.id}"><td><input type="checkbox" data-gon ${r.enabled ? 'checked' : ''} aria-label="Rule on"></td><td><b>${esc(r.name)}</b></td><td class="small">${esc(describeRule(r))}</td>
      <td class="c-actions"><button class="small" data-gedit>Edit</button><button class="small btn-ghost" data-gdel>Delete</button></td></tr>`).join('') : '<tr class="empty"><td colspan="4">No grading rules yet. The built-in grading still runs.</td></tr>'}
    </tbody></table></div>
    <section class="panel grade-try"><span class="lbl">Try it</span><form class="row" data-gtry>
      ${select('kind', RULE_FIELDS.kind.options.slice(1), 'perimeter')}${select('cls', RULE_FIELDS.cls.options, 'person')}${select('zone', RULE_FIELDS.zone.options.slice(1), 'front')}
      ${select('mode', MODES, 'home')}${select('severity', sevOptions, 'ALERT')}<button>Grade it now</button></form><p class="small" data-gtryout></p></section>`;
  body.onclick = async (e) => {
    const b = e.target.closest('button');
    const row = b?.closest('[data-gid]'), rule = row && rules.find((r) => r.id === row.dataset.gid);
    if (!b) return;
    if ('gedit' in b.dataset && rule) editor(ctx, rule, reload);
    else if ('gdel' in b.dataset && rule && await confirmBox('Delete this grading rule?', `“${rule.name}” stops applying.`, { ok: 'Delete', danger: true })) { try { await ctx.api(`/graderules/${rule.id}`, { method: 'DELETE' }); reload(); } catch (x) { toast(x.message, { kind: 'err' }); } }
  };
  body.onchange = async (e) => {
    if (!e.target.matches('[data-gon]')) return;
    const rule = rules.find((r) => r.id === e.target.closest('[data-gid]').dataset.gid);
    try { await ctx.api(`/graderules/${rule.id}`, { method: 'PUT', body: { ...rule, enabled: e.target.checked } }); reload(); } catch (x) { toast(x.message, { kind: 'err' }); }
  };
  $('[data-gtry]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, out = $('[data-gtryout]', body);
    try {
      const g = await ctx.api('/graderules/test', { method: 'POST', body: { kind: f.kind.value, cls: f.cls.value || null, zone: f.zone.value, mode: f.mode.value, severity: f.severity.value } });
      out.innerHTML = `${g.suppressed ? '<b>Log only</b> — no alert.' : `Result: <span class="sev sev-${g.severity}">${SEV_LABEL[g.severity]}</span>`} ${g.reasons.length ? `<span class="muted">${esc(g.reasons.join('; '))}</span>` : '<span class="muted">No change.</span>'}`;
    } catch (x) { out.textContent = x.message; }
  });
}
export function newGradeRule(ctx, reload) { editor(ctx, null, reload); }

function editor(ctx, rule, reload) {
  const r = cleanGradeRule(rule || { name: '', when: {}, then: { action: 'set', severity: 'INFO' } });
  const sh = sheet(`<form class="grade-form" data-gform>
      <label class="field"><span>Name</span><input name="name" maxlength="60" value="${esc(rule ? r.name : '')}" placeholder="e.g. Foxes at night" required></label>
      <fieldset class="gf-when"><legend>When</legend>
        <div class="gf-grid">${Object.entries(RULE_FIELDS).map(([k, f]) => `<label class="field"><span>${esc(f.label)}</span>${select(k, f.options, r.when[k])}</label>`).join('')}
          <label class="field"><span>Room (optional)</span><input name="room" maxlength="40" value="${esc(r.when.room)}" placeholder="e.g. Kitchen"></label></div>
        <div class="row small gf-modes"><span class="muted">Alert states:</span>${MODES.map(([k, l]) => `<label><input type="checkbox" name="modes" value="${k}" ${r.when.modes.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}<span class="muted">(none ticked = any)</span></div>
        <div class="row small" style="align-items:flex-end"><label class="field" style="margin:0"><span>Between</span><input type="time" name="from" value="${esc(r.when.from)}"></label><label class="field" style="margin:0"><span>and</span><input type="time" name="to" value="${esc(r.when.to)}"></label><span class="muted">(leave empty = any time)</span></div>
      </fieldset>
      <fieldset><legend>Then</legend><div class="row">${select('action', RULE_ACTIONS, r.then.action)}<span data-gsev>${select('severity', sevOptions, r.then.severity)}</span></div></fieldset>
      <p class="small muted" data-gdesc></p>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Save rule</button></div></form>`, { title: rule ? 'Edit grading rule' : 'New grading rule', wide: true });
  const f = sh.el.querySelector('[data-gform]');
  const read = () => {
    const el = f.elements;
    return { id: r.id, name: el.name.value, enabled: rule ? rule.enabled : true, order: rule?.order,
      when: { kind: el.kind.value, cls: el.cls.value, zone: el.zone.value, room: el.room.value, modes: [...f.querySelectorAll('[name=modes]:checked')].map((x) => x.value), from: el.from.value, to: el.to.value },
      then: { action: el.action.value, severity: el.severity.value } };
  };
  const preview = () => { f.querySelector('[data-gsev]').hidden = f.elements.action.value !== 'set'; f.querySelector('[data-gdesc]').textContent = describeRule(cleanGradeRule(read())); };
  f.addEventListener('input', preview); f.addEventListener('change', preview); preview();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = read();
    try { await ctx.api(`/graderules/${body.id}`, { method: 'PUT', body }); sh.close(); toast('Grading rule saved'); reload(); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
}
