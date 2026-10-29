// NETWORK view: the asset register (who/what is on your home network), the health check with
// plain-English recommendations, and the internet's uptime/speed history.
// SENTINEL never scans anything: devices come from SENTINEL itself, from you, or from your own router's list.
import { esc, $, toast, sheet, dayClock, confirmBox } from '../../shared/ui.js';
import { ASSET_TYPES } from '../../shared/assets.js';

const TYPE = Object.fromEntries(ASSET_TYPES);
const date = (ts) => (ts ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—');
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? '<1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

/** A simple bar chart (one measure, one axis) with a hover title on each bar. */
function bars(values, { max = null, unit = '', label = (v) => v, height = 90, warnBelow = null } = {}) {
  const vals = values.map((v) => v.v);
  const top = max ?? Math.max(1, ...vals.filter((v) => v != null));
  const w = 100 / Math.max(1, values.length);
  return `<svg class="mini-bars" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img">
    <line x1="0" y1="${height - 0.5}" x2="100" y2="${height - 0.5}" class="axis"/>
    ${values.map((d, i) => { if (d.v == null) return ''; const h = Math.max(1, (d.v / top) * (height - 4)); return `<rect x="${i * w + w * 0.15}" y="${height - h}" width="${w * 0.7}" height="${h}" class="${warnBelow != null && d.v < warnBelow ? 'warn' : ''}"><title>${esc(d.label)}: ${label(d.v)}${unit}</title></rect>`; }).join('')}
  </svg>`;
}

/** ctx = { S, api(path, opts) } */
export function createNetwork(ctx) {
  const st = { tab: 'assets', assets: [], health: null, hist: null, filter: 'all' };
  let root = null;

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad network">
      <header class="view-head"><div class="filters" role="tablist" aria-label="Network">
        <button role="tab" data-ntab="assets">Asset register</button><button role="tab" data-ntab="health">Health check</button><button role="tab" data-ntab="history">Internet history</button></div>
        <span class="grow"></span><span data-ntools></span></header>
      <p class="scope-note small"><b>Your home network only.</b> SENTINEL never scans anything. Devices are listed from SENTINEL itself (HQ, Agents, linked phones), from ones you add, and from a device list you copy out of your own router.</p>
      <div data-nbody></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    load();
  }
  async function load() {
    try {
      if (st.tab === 'assets') st.assets = await ctx.api('/network/assets');
      else if (st.tab === 'health') st.health = await ctx.api('/network/health');
      else st.hist = await ctx.api('/network/history');
    } catch (x) { toast(x.message, { kind: 'err' }); }
    draw();
  }
  function draw() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-ntab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ntab === st.tab)));
    const body = $('[data-nbody]', root), tools = $('[data-ntools]', root);
    if (st.tab === 'assets') {
      tools.innerHTML = '<button class="small" data-nimport>Import from router</button><button class="small btn-primary" data-nadd>Add device</button>';
      const list = st.assets.filter((a) => st.filter === 'all' || (st.filter === 'untrusted' ? !a.trusted : a.trusted));
      const untrusted = st.assets.filter((a) => !a.trusted).length;
      body.innerHTML = `<div class="view-tools"><div class="filters" role="group" aria-label="Show">${[['all', `All (${st.assets.length})`], ['untrusted', `Untrusted (${untrusted})`], ['trusted', 'Trusted']].map(([k, l]) => `<button data-nfilter="${k}" aria-pressed="${st.filter === k}">${l}</button>`).join('')}</div></div>
        <div class="table-wrap"><table class="grid-table asset-table"><thead><tr><th>Trust</th><th>Device</th><th>Owner</th><th>Type</th><th>Maker</th><th>MAC</th><th>IP</th><th>First seen</th><th>Last seen</th><th>Source</th><th class="c-actions"></th></tr></thead><tbody>
        ${list.map((a) => `<tr data-asset="${a.id}"><td><button class="trust ${a.trusted ? 'yes' : 'no'}" data-ntrust ${a.source === 'sentinel' ? 'disabled' : ''} title="${a.trusted ? 'Trusted — click to mark untrusted' : 'Untrusted — click to mark trusted'}">${a.trusted ? 'Trusted' : 'Untrusted'}</button></td>
          <td><b>${esc(a.name)}</b>${a.notes ? `<small class="muted"> · ${esc(a.notes)}</small>` : ''}</td><td>${esc(a.owner || '—')}</td><td class="small">${esc(TYPE[a.type] || a.type)}</td><td class="small">${esc(a.vendor || '—')}</td>
          <td class="mono small">${esc(a.mac || '—')}</td><td class="mono small">${esc(a.ip || '—')}</td><td class="mono small">${date(a.firstSeen)}</td><td class="mono small">${dayClock(a.lastSeen)}</td>
          <td class="small muted">${{ sentinel: 'SENTINEL', manual: 'Added', import: 'Router list' }[a.source]}</td>
          <td class="c-actions"><button class="small" data-nedit>Edit</button>${a.source === 'sentinel' ? '' : '<button class="small btn-ghost" data-ndel>Remove</button>'}</td></tr>`).join('') || '<tr class="empty"><td colspan="11">Nothing here.</td></tr>'}
        </tbody></table></div>`;
    } else if (st.tab === 'health') {
      tools.innerHTML = '<button class="small" data-nrecheck>Check again</button>';
      const h = st.health;
      if (!h) { body.innerHTML = ''; return; }
      const answer = (c) => `<div class="filters" role="group" aria-label="${esc(c.q)}">${[['yes', 'Yes'], ['no', 'No'], ['unknown', 'Not sure']].map(([k, l]) => `<button data-nans="${c.id}" data-val="${k}" aria-pressed="${(h.answers[c.id] || 'unknown') === k}">${l}</button>`).join('')}</div>`;
      body.innerHTML = `<div class="health-grid">
        <section class="panel"><div class="panel-head"><h2>Score</h2></div><div class="cov-big"><b class="mono">${h.score}</b><span class="small muted">out of 100</span></div>
          <p class="small muted">Based on what SENTINEL can check from this browser plus your answers about the router.</p></section>
        <section class="panel"><div class="panel-head"><h2>Recommendations</h2></div><ol class="findings">${h.findings.map((f) => `<li class="lv-${f.level}"><span class="lv-tag">${{ high: 'Fix now', medium: 'Fix soon', low: 'Worth doing', info: 'Check', ok: 'Good' }[f.level]}</span><div><b>${esc(f.title)}</b>${f.advice ? `<p class="small">${esc(f.advice)}</p>` : ''}</div></li>`).join('')}</ol></section>
        <section class="panel"><div class="panel-head"><h2>Your router (answer once)</h2></div>
          <p class="small muted">A web page can’t look inside your router, so these are questions. Log in to the router (often <span class="mono">192.168.1.1</span> or <span class="mono">192.168.0.1</span>; the address and password are usually on a sticker) to check.</p>
          <ol class="router-qs">${h.checks.map((c) => `<li><span>${esc(c.q)}</span>${answer(c)}</li>`).join('')}</ol></section></div>`;
    } else {
      tools.innerHTML = '';
      const h = st.hist;
      if (!h) { body.innerHTML = ''; return; }
      const speed = h.speed.slice(0, 30).reverse();
      body.innerHTML = `<div class="hist-grid">
        <section class="panel"><div class="panel-head"><h2>Uptime, last 30 days</h2><span class="mono">${h.uptime30d ?? '—'}%</span></div>
          ${h.days.length ? bars(h.days.map((d) => ({ v: d.uptime, label: d.day })), { max: 100, unit: '%', warnBelow: 99 }) + `<div class="axis-labels small muted mono"><span>${esc(h.days[0].day)}</span><span>${esc(h.days.at(-1).day)}</span></div>` : '<p class="small muted">Collecting — HQ checks the internet every minute.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Average response time per day</h2><span class="small muted">ms</span></div>
          ${h.days.length ? bars(h.days.map((d) => ({ v: d.latency, label: d.day })), { unit: ' ms' }) : '<p class="small muted">No data yet.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Download speed tests</h2><span class="small muted">Mbps</span></div>
          ${speed.length ? bars(speed.map((x) => ({ v: x.down, label: new Date(x.t).toLocaleString('en-GB') })), { unit: ' Mbps' }) : '<p class="small muted">No speed tests yet. Run one from the Network panel on Operations, or set automatic tests in Settings.</p>'}</section>
        <section class="panel"><div class="panel-head"><h2>Outages</h2></div>
          <div class="table-wrap"><table class="grid-table compact"><thead><tr><th>Started</th><th>Ended</th><th>Length</th></tr></thead><tbody>
          ${h.outages.map((o) => `<tr><td class="mono small">${new Date(o.from).toLocaleString('en-GB')}</td><td class="mono small">${o.to ? new Date(o.to).toLocaleString('en-GB') : '<span class="c-red">still down</span>'}</td><td class="mono small">${dur((o.to || h.now) - o.from)}</td></tr>`).join('') || '<tr class="empty"><td colspan="3">No outages recorded.</td></tr>'}</tbody></table></div></section>
        <section class="panel"><div class="panel-head"><h2>Speed test log</h2></div>
          <div class="table-wrap"><table class="grid-table compact"><thead><tr><th>When</th><th>Down</th><th>Up</th><th>Server</th></tr></thead><tbody>
          ${h.speed.slice(0, 50).map((x) => `<tr><td class="mono small">${new Date(x.t).toLocaleString('en-GB')}</td><td class="mono">${x.down ?? '—'} Mbps</td><td class="mono">${x.up ?? '—'}${x.up != null ? ' Mbps' : ''}</td><td class="small muted">${esc(x.server)}</td></tr>`).join('') || '<tr class="empty"><td colspan="4">None yet.</td></tr>'}</tbody></table></div></section></div>`;
    }
  }

  function edit(a = null) {
    const sentinel = a?.source === 'sentinel';
    const s = sheet(`<form data-assetform>
      ${sentinel ? '<p class="small muted">This is one of SENTINEL’s own devices: only the owner and notes can be changed.</p>' : ''}
      <div class="row"><label class="field grow"><span>Name</span><input name="aname" value="${esc(a?.name || '')}" maxlength="60" required ${sentinel ? 'disabled' : ''}></label>
        <label class="field grow"><span>Owner</span><input name="owner" value="${esc(a?.owner || '')}" maxlength="30" placeholder="e.g. Mum"></label></div>
      <div class="row"><label class="field grow"><span>Type</span><select name="atype" ${sentinel ? 'disabled' : ''}>${ASSET_TYPES.map(([k, l]) => `<option value="${k}" ${a?.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field grow"><span>Maker</span><input name="vendor" value="${esc(a?.vendor || '')}" maxlength="50" ${sentinel ? 'disabled' : ''}></label></div>
      <div class="row"><label class="field grow"><span>MAC address (optional)</span><input name="mac" value="${esc(a?.mac || '')}" class="mono" placeholder="3C:22:FB:12:34:56" ${sentinel ? 'disabled' : ''}></label>
        <label class="field grow"><span>IP address (optional)</span><input name="ip" value="${esc(a?.ip || '')}" class="mono" placeholder="192.168.1.23" ${sentinel ? 'disabled' : ''}></label></div>
      <label class="field"><span>Notes</span><input name="notes" value="${esc(a?.notes || '')}" maxlength="300"></label>
      ${sentinel ? '' : `<label class="row small" style="gap:8px;margin-bottom:12px"><input type="checkbox" name="trusted" ${a?.trusted ? 'checked' : ''}> I know this device — mark it trusted</label>`}
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Save</button></div></form>`, { title: a ? 'Edit device' : 'Add a device' });
    const f = s.el.querySelector('[data-assetform]'), el = f.elements;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { ...(a || {}), name: el.aname.value, owner: el.owner.value, type: el.atype.value, vendor: el.vendor.value, mac: el.mac.value, ip: el.ip.value, notes: el.notes.value, trusted: sentinel ? true : el.trusted.checked };
      try { await ctx.api(a ? `/network/assets/${a.id}` : '/network/assets', { method: a ? 'PUT' : 'POST', body }); s.close(); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    });
  }
  function importer() {
    const s = sheet(`<form data-importform>
      <ol class="small steps-help"><li>On a computer at home, open your router’s admin page (often <span class="mono">192.168.1.1</span> or <span class="mono">192.168.0.1</span>).</li>
        <li>Find the list of connected devices (“Attached devices”, “Device list”, “DHCP clients”…).</li>
        <li>Select the whole table, copy it, and paste it below. Only lines with a MAC address are used.</li></ol>
      <label class="field"><span>Device list</span><textarea name="text" rows="9" class="mono" placeholder="Mums-iPhone   192.168.1.23   3C:22:FB:12:34:56"></textarea></label>
      <p class="small muted">New devices are added as <b>untrusted</b> and appear in Triage so you can check them. Nothing is sent anywhere.</p>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Import</button></div></form>`, { title: 'Import from your router', wide: true });
    const f = s.el.querySelector('[data-importform]');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await ctx.api('/network/import', { method: 'POST', body: { text: f.elements.text.value } }); s.close(); toast(`${r.found} device${r.found === 1 ? '' : 's'} read · ${r.added} new`); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    });
  }
  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('[data-asset]'), a = row && st.assets.find((x) => x.id === row.dataset.asset);
    if (b.dataset.ntab) { st.tab = b.dataset.ntab; load(); }
    else if (b.dataset.nfilter) { st.filter = b.dataset.nfilter; draw(); }
    else if ('nadd' in b.dataset) edit();
    else if ('nimport' in b.dataset) importer();
    else if ('nedit' in b.dataset && a) edit(a);
    else if ('ntrust' in b.dataset && a) { try { await ctx.api(`/network/assets/${a.id}`, { method: 'PUT', body: { ...a, trusted: !a.trusted } }); load(); } catch (x) { toast(x.message, { kind: 'err' }); } }
    else if ('ndel' in b.dataset && a) { if (await confirmBox('Remove this device?', `${a.name} is taken off the register. If it shows up in a router list again it comes back as new.`, { ok: 'Remove', danger: true })) { try { await ctx.api(`/network/assets/${a.id}`, { method: 'DELETE' }); load(); } catch (x) { toast(x.message, { kind: 'err' }); } } }
    else if ('nrecheck' in b.dataset) load();
    else if (b.dataset.nans) {
      const answers = { ...st.health.answers, [b.dataset.nans]: b.dataset.val };
      try { await ctx.api('/network/checks', { method: 'PUT', body: { answers } }); load(); } catch (x) { toast(x.message, { kind: 'err' }); }
    }
  }
  function onChange() { /* (all actions are buttons) */ }
  return { render, refresh() { if (root?.isConnected && st.tab === 'assets') load(); } };
}
