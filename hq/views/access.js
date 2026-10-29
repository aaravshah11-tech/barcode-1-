// ACCESS view (Director only): users and roles, active sessions, two-step sign-in, and the audit trail.
import { esc, $, toast, sheet, confirmBox, qrSvg } from '../../shared/ui.js';
import { ROLE_INFO } from '../../shared/roles.js';

const fmt = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const save = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };

/** Set up (or turn off) two-step sign-in for whoever is signed in. Used here and from the command palette. */
export function twoStepSheet(ctx, { enabled = false, onDone } = {}) {
  const s = sheet(enabled ? `<form data-2fa-off><p>Two-step sign-in is <b>on</b> for ${esc(ctx.S.operator)}. To turn it off, enter your PIN or password.</p>
      <label class="field"><span>PIN or password</span><input name="pin" type="password" class="mono" required></label>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-danger">Turn off</button></div></form>`
    : `<form data-2fa-begin><p>Two-step sign-in asks for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) after your PIN. Someone who learns your PIN still can’t get in.</p>
      <label class="field"><span>Your PIN or password</span><input name="pin" type="password" class="mono" required></label>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Next</button></div></form>
      <form data-2fa-enable hidden><p>1. In the authenticator app choose <b>Add account → Scan QR code</b> and scan this:</p><div class="qr-box" data-2fa-qr></div>
      <p class="small muted">Can’t scan? Type this key instead: <span class="mono" data-2fa-key></span></p>
      <label class="field"><span>2. Enter the 6-digit code the app shows</span><input name="code" inputmode="numeric" maxlength="6" class="mono otp" required></label>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Turn on</button></div></form>`, { title: 'Two-step sign-in' });
  const begin = s.el.querySelector('[data-2fa-begin]'), en = s.el.querySelector('[data-2fa-enable]'), off = s.el.querySelector('[data-2fa-off]');
  begin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await ctx.api('/auth/totp/begin', { method: 'POST', body: { pin: begin.elements.pin.value } });
      s.el.querySelector('[data-2fa-qr]').innerHTML = await qrSvg(r.uri, { cell: 4 });
      s.el.querySelector('[data-2fa-key]').textContent = r.secret.match(/.{1,4}/g).join(' ');
      begin.hidden = true; en.hidden = false; en.elements.code.focus();
    } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  en?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await ctx.api('/auth/totp/enable', { method: 'POST', body: { code: en.elements.code.value } }); toast('Two-step sign-in is on'); s.close(); onDone?.(); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  off?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await ctx.api('/auth/totp/disable', { method: 'POST', body: { pin: off.elements.pin.value } }); toast('Two-step sign-in is off'); s.close(); onDone?.(); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
}

/** ctx = { S, api(path, opts) } */
export function createAccess(ctx) {
  const st = { tab: 'users', users: [], sessions: [], audit: null, q: '' };
  let root = null;

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad access">
      <header class="view-head"><div class="filters" role="tablist" aria-label="Access">
        <button role="tab" data-atab2="users">Users and roles</button><button role="tab" data-atab2="sessions">Sessions</button><button role="tab" data-atab2="audit">Audit log</button></div>
        <span class="grow"></span><span data-atools2></span></header><div data-abody2></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', (e) => { if (e.target.matches('[data-aq]')) { st.q = e.target.value; drawAudit(); } });
    load();
  }
  async function load() {
    try {
      if (st.tab === 'users') st.users = await ctx.api('/users');
      else if (st.tab === 'sessions') st.sessions = await ctx.api('/auth/sessions');
      else st.audit = await ctx.api('/audit?limit=1000');
    } catch (x) { toast(x.message, { kind: 'err' }); }
    draw();
  }
  function draw() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-atab2]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.atab2 === st.tab)));
    const body = $('[data-abody2]', root), tools = $('[data-atools2]', root);
    if (st.tab === 'users') {
      const me = st.users.find((u) => u.username === ctx.S.operator);
      tools.innerHTML = `<button class="small" data-a2fa>${me?.twoFactor ? 'Two-step sign-in: on' : 'Turn on two-step sign-in'}</button><button class="small btn-primary" data-auser>Add user</button>`;
      body.innerHTML = `<div class="role-cards">${Object.entries(ROLE_INFO).map(([r, t]) => `<div class="panel"><b>${r}</b><p class="small muted">${esc(t)}</p></div>`).join('')}</div>
        <div class="table-wrap"><table class="grid-table"><thead><tr><th>User</th><th>Role</th><th>Two-step</th><th>PIN</th><th>Last sign-in</th><th>Added</th><th class="c-actions"></th></tr></thead><tbody>
        ${st.users.map((u) => `<tr data-user="${esc(u.username)}"><td><b>${esc(u.username)}</b>${u.disabled ? ' <span class="tag">disabled</span>' : ''}</td>
          <td>${u.role === 'DIRECTOR' ? '<span class="mono">DIRECTOR</span>' : `<select data-arole aria-label="Role"><option ${u.role === 'OPERATOR' ? 'selected' : ''}>OPERATOR</option><option ${u.role === 'OBSERVER' ? 'selected' : ''}>OBSERVER</option></select>`}</td>
          <td>${u.twoFactor ? '<span class="c-green">On</span>' : '<span class="muted">Off</span>'}</td><td class="small">${u.strength === 'weak' ? '<span class="c-amber">Short</span>' : u.strength ? 'OK' : '—'}</td>
          <td class="mono small">${fmt(u.lastLogin)}</td><td class="mono small">${fmt(u.createdAt)}</td>
          <td class="c-actions">${u.role === 'DIRECTOR' ? '' : `<button class="small" data-adisable>${u.disabled ? 'Enable' : 'Disable'}</button><button class="small btn-ghost" data-aremove>Remove</button>`}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="small muted">SENTINEL is for your household only. Each person signs in with their own username, so the audit log shows exactly who did what.</p>`;
    } else if (st.tab === 'sessions') {
      tools.innerHTML = '<button class="small btn-danger" data-aendall>End all other sessions</button>';
      body.innerHTML = `<div class="table-wrap"><table class="grid-table"><thead><tr><th>User</th><th>Role</th><th>Where</th><th>Signed in</th><th>Last active</th><th class="c-actions"></th></tr></thead><tbody>
        ${st.sessions.map((x) => `<tr data-sess="${x.id}"><td><b>${esc(x.username)}</b>${x.current ? ' <span class="tag">this screen</span>' : ''}</td><td class="mono small">${x.role}</td><td class="small">${esc(x.via)}</td><td class="mono small">${fmt(x.started)}</td><td class="mono small">${fmt(x.lastActive)}</td>
          <td class="c-actions">${x.current ? '' : '<button class="small" data-aend>End session</button>'}</td></tr>`).join('') || '<tr class="empty"><td colspan="6">No sessions.</td></tr>'}</tbody></table></div>
        <p class="small muted">Sessions end by themselves after the auto-lock time without use (Settings › Security).</p>`;
    } else {
      tools.innerHTML = '<input type="search" class="vh-search" data-aq placeholder="Filter (user, action…)" aria-label="Filter audit log"><button class="small" data-aexport>Export with checksum</button>';
      $('[data-aq]', root).value = st.q;
      body.innerHTML = '<div data-averify></div><div class="table-wrap"><table class="grid-table compact audit-table"><thead><tr><th>#</th><th>Time</th><th>User</th><th>Role</th><th>From</th><th>Action</th><th>Target</th><th>Detail</th><th>Result</th></tr></thead><tbody data-arows></tbody></table></div>';
      drawAudit();
    }
  }
  function drawAudit() {
    const a = st.audit, rows = root?.querySelector('[data-arows]');
    if (!a || !rows) return;
    const v = a.verify;
    root.querySelector('[data-averify]').innerHTML = v.ok
      ? `<div class="verify ok"><b>Chain verified.</b> ${v.count} entr${v.count === 1 ? 'y' : 'ies'}, each linked to the one before by its fingerprint — nothing has been changed or removed.</div>`
      : `<div class="verify bad"><b>Audit log altered.</b> ${esc(v.why)} Entries from #${v.at} on can’t be trusted.</div>`;
    const q = st.q.toLowerCase();
    const list = a.entries.filter((e) => !q || `${e.who} ${e.action} ${e.target} ${e.detail} ${e.via}`.toLowerCase().includes(q));
    rows.innerHTML = list.map((e) => `<tr class="${e.ok ? '' : 'refused'} ${!v.ok && e.seq >= v.at ? 'tainted' : ''}"><td class="mono small">${e.seq}</td><td class="mono small">${fmt(e.ts)}</td><td>${esc(e.who)}</td><td class="mono small">${esc(e.role)}</td><td class="small">${esc(e.via)}</td><td>${esc(e.action)}</td><td class="small mono">${esc(e.target)}</td><td class="small">${esc(e.detail)}</td><td class="small">${e.ok ? 'Done' : '<span class="c-amber">Refused</span>'}</td></tr>`).join('') || '<tr class="empty"><td colspan="9">Nothing matches.</td></tr>';
  }
  function addUser() {
    const s = sheet(`<form data-userform>
      <label class="field"><span>Username</span><input name="username" maxlength="24" required autocapitalize="none"></label>
      <label class="field"><span>Starting PIN or password (they can change it)</span><input name="pin" type="password" minlength="4" class="mono" required></label>
      <label class="field"><span>Role</span><select name="role"><option value="OPERATOR">OPERATOR — ${esc(ROLE_INFO.OPERATOR)}</option><option value="OBSERVER">OBSERVER — ${esc(ROLE_INFO.OBSERVER)}</option></select></label>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="btn-primary">Add user</button></div></form>`, { title: 'Add a user' });
    const f = s.el.querySelector('[data-userform]');
    f.addEventListener('submit', async (e) => { e.preventDefault(); try { await ctx.api('/users', { method: 'POST', body: { username: f.elements.username.value, pin: f.elements.pin.value, role: f.elements.role.value } }); s.close(); load(); } catch (x) { toast(x.message, { kind: 'err' }); } });
  }
  async function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const u = b.closest('[data-user]')?.dataset.user, sid = b.closest('[data-sess]')?.dataset.sess;
    try {
      if (b.dataset.atab2) { st.tab = b.dataset.atab2; load(); }
      else if ('auser' in b.dataset) addUser();
      else if ('a2fa' in b.dataset) twoStepSheet(ctx, { enabled: !!st.users.find((x) => x.username === ctx.S.operator)?.twoFactor, onDone: load });
      else if ('adisable' in b.dataset && u) { const x = st.users.find((y) => y.username === u); await ctx.api(`/users/${encodeURIComponent(u)}`, { method: 'PATCH', body: { disabled: !x.disabled } }); load(); }
      else if ('aremove' in b.dataset && u) { if (await confirmBox(`Remove ${u}?`, 'They can no longer sign in. Their past actions stay in the audit log.', { ok: 'Remove', danger: true })) { await ctx.api(`/users/${encodeURIComponent(u)}`, { method: 'DELETE' }); load(); } }
      else if ('aend' in b.dataset && sid) { await ctx.api(`/auth/sessions/${sid}`, { method: 'DELETE' }); load(); }
      else if ('aendall' in b.dataset) { const r = await ctx.api('/auth/sessions', { method: 'DELETE' }); toast(`${r.ended} session${r.ended === 1 ? '' : 's'} ended`); load(); }
      else if ('aexport' in b.dataset) {
        const r = await ctx.api('/audit/export');
        save(r.filename, r.text, r.type);
        save(`${r.filename}.sha256`, `${r.sha256}  ${r.filename}\n`, 'text/plain');
        toast(`Exported. SHA-256 ${r.sha256.slice(0, 16)}… (saved next to it)`);
      }
    } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  async function onChange(e) {
    if (e.target.matches('[data-arole]')) {
      const u = e.target.closest('[data-user]').dataset.user;
      try { await ctx.api(`/users/${encodeURIComponent(u)}`, { method: 'PATCH', body: { role: e.target.value } }); toast(`${u} is now ${e.target.value}`); load(); } catch (x) { toast(x.message, { kind: 'err' }); load(); }
    }
  }
  return { render };
}
