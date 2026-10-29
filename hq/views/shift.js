// SHIFT LOG: running notes, and handover notes for whoever takes over (with an automatic summary of
// the alert state, unhandled alerts, open incidents and offline Agents). The next person acknowledges it.
import { esc, $, toast, sheet } from '../../shared/ui.js';

const fmt = (t) => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const summary = (s) => (s ? `<div class="handover-sum small"><span>State <b>${esc(s.state)}</b></span><span>Unhandled alerts <b>${s.unhandled}</b></span><span>Open incidents <b>${s.incidents.length ? esc(s.incidents.join(', ')) : 'none'}</b></span><span>Agents offline <b>${s.offline.length ? esc(s.offline.join(', ')) : 'none'}</b></span></div>` : '');

/** ctx = { S, api(path, opts) } */
export function createShift(ctx) {
  let root = null, list = [];
  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad shift">
      <form class="panel shift-form" data-shiftform>
        <label class="field"><span>New entry</span><textarea name="text" rows="3" maxlength="2000" placeholder="What happened, what you checked, what the next person should know"></textarea></label>
        <div class="row"><label class="row small" style="gap:8px"><input type="checkbox" name="handover"> This is a handover note (adds a summary; the next person acknowledges it)</label><span class="grow"></span><button class="btn-primary">Add to log</button></div></form>
      <ol class="shift-list" data-shiftlist></ol></div>`;
    root.querySelector('[data-shiftform]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await ctx.api('/shift', { method: 'POST', body: { text: f.elements.text.value, handover: f.elements.handover.checked } }); f.reset(); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    });
    root.addEventListener('click', async (e) => { const b = e.target.closest('[data-shiftack]'); if (b) { try { await ctx.api(`/shift/${b.dataset.shiftack}/ack`, { method: 'POST' }); load(); } catch (x) { toast(x.message, { kind: 'err' }); } } });
    load();
  }
  async function load() { try { list = await ctx.api('/shift'); } catch (x) { toast(x.message, { kind: 'err' }); } draw(); }
  function draw() {
    const box = root && $('[data-shiftlist]', root);
    if (!box) return;
    box.innerHTML = list.map((e) => `<li class="panel ${e.handover ? 'handover' : ''}"><div class="row small"><b>${esc(e.by)}</b><span class="mono muted">${e.role || ''}</span><span class="muted mono">${fmt(e.ts)}</span>${e.handover ? '<span class="tag">Handover</span>' : ''}</div>
      <p>${esc(e.text)}</p>${summary(e.summary)}
      ${e.handover ? `<div class="row small muted">${e.acks.length ? `Acknowledged by ${e.acks.map((a) => `${esc(a.by)} (${fmt(a.ts)})`).join(', ')}` : 'Not yet acknowledged'}<span class="grow"></span>${e.acks.some((a) => a.by === ctx.S.operator) || e.by === ctx.S.operator ? '' : `<button class="small" data-shiftack="${e.id}">Acknowledge</button>`}</div>` : ''}</li>`).join('') || '<li class="small muted">No entries yet.</li>';
  }
  return { render, refresh() { if (root?.isConnected) load(); } };
}

/** After signing in: show the latest handover note addressed to the next person, if it hasn't been acknowledged. */
export async function showHandover(ctx) {
  let list;
  try { list = await ctx.api('/shift'); } catch { return; }
  const h = list.find((e) => e.handover && Date.now() - e.ts < 24 * 3600000);
  if (!h || h.by === ctx.S.operator || h.acks.some((a) => a.by === ctx.S.operator)) return;
  const s = sheet(`<p class="small muted">From <b>${esc(h.by)}</b> · ${fmt(h.ts)}</p><p>${esc(h.text)}</p>${summary(h.summary)}
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button type="button" data-close>Later</button><button class="btn-primary" data-hack>Acknowledge</button></div>`, { title: 'Handover note' });
  s.el.querySelector('[data-hack]').addEventListener('click', async () => { try { await ctx.api(`/shift/${h.id}/ack`, { method: 'POST' }); s.close(); } catch (x) { toast(x.message, { kind: 'err' }); } });
}
