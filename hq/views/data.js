// DATA view (Director only): encryption status, nightly encrypted backups (each test-restored),
// retention rules, tamper-evident evidence export, and a record of when HQ wasn't running.
import { esc, $, toast, sheet, confirmBox } from '../../shared/ui.js';

const fmt = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const size = (n) => (n == null ? '—' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
export function saveFile(name, text, type = 'application/json') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
const readFile = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Couldn’t read that file.')); r.readAsText(file); });
const RET = [['events', 'Event log'], ['alerts', 'Handled alerts'], ['incidents', 'Closed incidents'], ['reports', 'Reports'], ['shift', 'Shift log'], ['analysis', 'Anomalies and rule matches'], ['audit', 'Audit log (at least 365)']];

/** Download an incident's evidence package (and its checksum). Used here and on the Incidents screen. */
export async function exportEvidence(ctx, id) {
  const r = await ctx.api(`/data/evidence/${id}`);
  saveFile(r.filename, r.text);
  saveFile(`${r.filename}.sha256`, `${r.sha256}  ${r.filename}\n`, 'text/plain');
  toast(`Evidence exported. SHA-256 ${r.sha256.slice(0, 16)}… (also recorded in the audit log)`);
}

/** ctx = { S, api(path, opts) } */
export function createData(ctx) {
  let root = null, st = null;
  function render(el) {
    root = el;
    root.innerHTML = '<div class="view-pad data-view" data-dbody></div>';
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('change', onChange);
    load();
  }
  async function load() { try { st = await ctx.api('/data/status'); } catch (x) { toast(x.message, { kind: 'err' }); return; } draw(); }
  function draw() {
    const body = root && $('[data-dbody]', root);
    if (!body || !st) return;
    const e = st.encryption, inc = (ctx.S.incidents || []);
    body.innerHTML = `<div class="data-grid">
      <section class="panel"><div class="panel-head"><h2>Encryption</h2></div>
        <div class="verify ${e.atRest ? 'ok' : 'bad'}"><b>${e.atRest ? 'Encrypted at rest' : 'Not encrypted'}</b> — ${e.atRest ? `everything HQ saves (settings, event log, audit log, floor plans, backups) is sealed with ${esc(e.cipher)} using a key this browser keeps and won’t let anyone copy out.` : 'this browser can’t provide encryption (private window?).'}</div>
        <dl class="kv"><dt>In transit</dt><dd>${st.https ? 'HTTPS page; Agents and phones use encrypted peer-to-peer links (DTLS)' : '<span class="c-amber">Not HTTPS</span>'}</dd>
          <dt>Storage used</dt><dd>${st.storage ? `${size(st.storage.usage)} of ${size(st.storage.quota)}` : '—'}</dd>
          ${e.migrated ? `<dt>Converted</dt><dd>${e.migrated} older record${e.migrated === 1 ? '' : 's'} sealed</dd>` : ''}</dl>
        <p class="small muted">For full protection also use your computer’s disk encryption (FileVault / BitLocker) and a computer password.</p></section>
      <section class="panel"><div class="panel-head"><h2>Backups</h2><button class="small btn-primary" data-dbackup>Back up now</button></div>
        <p class="small muted">A backup is made automatically every night after 03:00 while HQ is open (the last 7 are kept), and each one is <b>test-restored</b> straight away to prove it works.</p>
        <div class="table-wrap"><table class="grid-table compact"><thead><tr><th>Made</th><th>Type</th><th>Size</th><th>Test restore</th><th class="c-actions"></th></tr></thead><tbody>
        ${st.backups.map((b) => `<tr data-bk="${b.id}"><td class="mono small">${fmt(b.at)}</td><td class="small">${b.kind === 'nightly' ? 'Nightly' : `Manual · ${esc(b.by)}`}</td><td class="mono small">${size(b.size)}</td>
          <td class="small">${b.verified?.ok ? `<span class="c-green">Passed</span> <span class="muted">${esc(b.verified.detail)}</span>` : `<span class="c-red">Failed</span> ${esc(b.verified?.detail || '')}`}</td>
          <td class="c-actions"><button class="small" data-dverify>Test again</button><button class="small" data-drestore>Restore</button><button class="small btn-ghost" data-dbkdel>Delete</button></td></tr>`).join('') || '<tr class="empty"><td colspan="5">No backups yet.</td></tr>'}</tbody></table></div>
        <div class="row" style="margin-top:8px"><button class="small" data-ddownload>Download encrypted backup file…</button><label class="btn small">Restore from a file…<input type="file" accept=".sentinel-backup,.json" data-drestorefile hidden></label></div></section>
      <section class="panel"><div class="panel-head"><h2>Retention</h2></div>
        <form data-dret class="ret-form">${RET.map(([k, l]) => `<label class="field"><span>${l}</span><div class="row"><input type="number" name="${k}" value="${st.retention[k]}" min="1" max="3650" class="mono"><span class="small muted">days · ${st.counts[k] ?? 0} now</span></div></label>`).join('')}
        <p class="small muted">Open alerts, and anything linked to an incident that isn’t closed, are always kept. Old audit entries are removed in order and the chain still verifies.</p>
        <div class="row"><button class="btn-primary small">Save</button><button type="button" class="small" data-dprune>Apply now</button></div></form></section>
      <section class="panel"><div class="panel-head"><h2>Evidence</h2></div>
        <p class="small muted">Export everything about an incident (its alerts, timeline, sensor events and audit entries) as one file with a SHA-256 fingerprint. The fingerprint is written into the audit log, so you can later prove the file hasn’t been changed.</p>
        <div class="row"><select data-dinc aria-label="Incident">${inc.length ? inc.map((i) => `<option value="${i.id}">${esc(i.ref)} — ${esc(i.title)}</option>`).join('') : '<option value="">No incidents yet</option>'}</select><button class="small btn-primary" data-devidence ${inc.length ? '' : 'disabled'}>Export evidence</button></div>
        <label class="btn small" style="margin-top:8px">Check an evidence file…<input type="file" accept=".json" data-dverifyfile hidden></label><div data-dverifyout></div></section>
      <section class="panel"><div class="panel-head"><h2>When HQ wasn’t running</h2></div>
        <p class="small muted">HQ notes every gap: closed, the computer asleep, a crash or power cut, or a freeze its watchdog recovered from. Linked phones warn you while HQ is unreachable.</p>
        <div class="table-wrap"><table class="grid-table compact"><thead><tr><th>From</th><th>To</th><th>Length</th><th>Why</th></tr></thead><tbody>
        ${st.downtime.map((d) => `<tr><td class="mono small">${fmt(d.from)}</td><td class="mono small">${fmt(d.to)}</td><td class="mono small">${dur(d.to - d.from)}</td><td class="small">${esc(d.why)}</td></tr>`).join('') || '<tr class="empty"><td colspan="4">No gaps recorded.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function askPassword(title, intro, cb) {
    const s = sheet(`<form data-pw><p class="small">${intro}</p><label class="field"><span>Backup password</span><input name="pw" type="password" minlength="8" required class="mono"></label>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Continue</button></div></form>`, { title });
    s.el.querySelector('[data-pw]').addEventListener('submit', async (e) => { e.preventDefault(); try { await cb(e.target.elements.pw.value); s.close(); } catch (x) { toast(x.message, { kind: 'err' }); } });
  }
  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.closest('[data-bk]')?.dataset.bk;
    try {
      if ('dbackup' in b.dataset) { b.disabled = true; const r = await ctx.api('/data/backup', { method: 'POST' }); toast(r.verified.ok ? 'Backup made and test-restored' : 'Backup made, but the test restore FAILED', { kind: r.verified.ok ? '' : 'err' }); load(); }
      else if ('dverify' in b.dataset && id) { const r = await ctx.api(`/data/backups/${id}/verify`, { method: 'POST' }); toast(r.ok ? 'Test restore passed' : `Test restore failed: ${r.detail}`, { kind: r.ok ? '' : 'err' }); load(); }
      else if ('drestore' in b.dataset && id) { if (await confirmBox('Restore this backup?', 'HQ goes back to how it was when the backup was made. Anything since then is replaced. The restore is recorded in the audit log.', { ok: 'Restore', danger: true })) { await ctx.api(`/data/backups/${id}/restore`, { method: 'POST' }); toast('Restored — reloading'); setTimeout(() => location.reload(), 800); } }
      else if ('dbkdel' in b.dataset && id) { if (await confirmBox('Delete this backup?', 'This copy is removed from this computer.', { ok: 'Delete', danger: true })) { await ctx.api(`/data/backups/${id}`, { method: 'DELETE' }); load(); } }
      else if ('ddownload' in b.dataset) askPassword('Download an encrypted backup', 'The file is sealed with this password (at least 8 characters). Without it the file can’t be opened — not even by you. Keep it somewhere safe, away from this computer.', async (pw) => { const r = await ctx.api('/data/backup/download', { method: 'POST', body: { password: pw } }); saveFile(r.filename, r.text); toast('Encrypted backup downloaded'); });
      else if ('dprune' in b.dataset) { const r = await ctx.api('/data/prune', { method: 'POST' }); const n = Object.values(r).reduce((a, c) => a + c, 0); toast(n ? `Removed ${n} old record${n === 1 ? '' : 's'}` : 'Nothing old enough to remove'); load(); }
      else if ('devidence' in b.dataset) await exportEvidence(ctx, $('[data-dinc]', root).value);
    } catch (x) { toast(x.message, { kind: 'err' }); b.disabled = false; }
  }
  async function onSubmit(e) {
    if (!e.target.matches('[data-dret]')) return;
    e.preventDefault();
    const body = {};
    for (const [k] of RET) body[k] = Number(e.target.elements[k].value);
    try { await ctx.api('/data/retention', { method: 'PUT', body }); toast('Retention saved'); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  async function onChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFile(file);
      if (e.target.matches('[data-drestorefile]')) askPassword('Restore from a backup file', `Restore <b>${esc(file.name)}</b>? HQ will be replaced by the backup (it is test-restored first).`, async (pw) => { await ctx.api('/data/restore-file', { method: 'POST', body: { text, password: pw } }); toast('Restored — reloading'); setTimeout(() => location.reload(), 800); });
      else if (e.target.matches('[data-dverifyfile]')) {
        const r = await ctx.api('/data/evidence/verify', { method: 'POST', body: { text } });
        $('[data-dverifyout]', root).innerHTML = `<div class="verify ${r.intact ? 'ok' : 'bad'}" style="margin-top:8px"><b>${r.intact ? 'Unchanged.' : 'This file has been changed.'}</b> ${esc(r.ref)}, exported ${fmt(r.exportedAt)} by ${esc(r.exportedBy)}. ${r.recorded ? `The audit log recorded this exact fingerprint (entry #${r.recorded.seq}, ${fmt(r.recorded.ts)}, ${esc(r.recorded.who)}).` : 'This fingerprint is not in this HQ’s audit log.'}</div>`;
      }
    } catch (x) { toast(x.message, { kind: 'err' }); }
    e.target.value = '';
  }
  return { render };
}
