// Settings › You & sign-in: your name, optional email sign-in (cloud sync), and who's in the household.
import * as store from '../core/store.js';
import * as sync from '../sync/manager.js';
import { esc, icon, toast } from '../core/ui.js';
import { myName, setMyName, profiles } from '../core/people.js';

const { sb } = sync;

export function renderAccount(root) {
  let step = 'idle'; // idle | code
  let email = '', codeType = '', busy = false, error = '';
  let acc = null, people = null;

  const load = async () => {
    if (!sb.isConfigured()) { acc = null; people = null; return; }
    try { acc = await sb.account(); } catch { acc = null; }
    try { people = await sb.householdPeople(); } catch (e) { people = null; error ||= sb.friendlyError(e); }
  };

  const draw = () => {
    const cloud = sb.isConfigured();
    const others = profiles().filter((p) => p.id !== store.getDeviceId());
    root.innerHTML = `<div class="page-head"><h1>You & sign-in</h1></div>
      ${error ? `<div class="banner banner-danger">${icon('alert')}<div class="grow">${esc(error)}</div></div>` : ''}
      <div class="card"><h2>Your name</h2>
        <p class="small muted" style="margin-top:0">Shown to the rest of the household (“added by …”) and offered as an owner in Library and Inventory.</p>
        <form data-name style="display:flex;gap:8px"><input name="name" value="${esc(myName())}" placeholder="e.g. Aarav" autocomplete="given-name" aria-label="Your name" maxlength="60"><button class="btn btn-primary">Save</button></form></div>

      <div class="card section"><h2>Email sign-in <span class="muted small">(optional)</span></h2>
      ${!cloud ? `<p class="muted">Email sign-in works with cloud sync. <a href="#/settings/pair">Set up cloud sync</a> first — until then, everything works without an account.</p>`
        : acc && !acc.anonymous ? `<p>${icon('check')} Signed in as <b>${esc(acc.email)}</b>.</p><p class="small muted">On a new device: Settings › Pairing › Cloud sync › “Sign in with email”, and use this address.</p>`
        : step === 'code' ? `<p>We emailed a 6-digit code to <b>${esc(email)}</b>.</p>
            <form data-code style="display:flex;gap:8px"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" aria-label="Code from the email" maxlength="10" style="letter-spacing:.2em;font-family:var(--mono)"><button class="btn btn-primary" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Confirm'}</button></form>
            <button class="link-btn small" data-restart style="margin-top:10px">Use a different email / send again</button>`
        : `<p class="small muted" style="margin-top:0">This device uses a private account without an email. Adding one lets you sign in on a new phone or computer with a code instead of a QR code, and shows the household who you are. It doesn’t change your data.</p>
            <form data-email style="display:flex;gap:8px"><input name="email" type="email" value="${esc(email)}" autocomplete="email" placeholder="you@example.com" aria-label="Email address" required><button class="btn btn-primary" ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Send code'}</button></form>`}
      </div>

      <div class="section"><div class="section-title">People in this household</div>
        ${cloud && people ? `<div class="list">${people.map((p) => `<div class="list-item"><span class="thumb-sq" aria-hidden="true">${p.is_me ? '🙋' : '👤'}</span><div class="grow">
            <b>${esc(p.display_name || 'No name yet')}${p.is_me ? ' (you)' : ''}</b><div class="small muted">${esc([p.email, p.device_name].filter(Boolean).join(' · '))}</div></div></div>`).join('')}</div>`
        : `<div class="list">${[{ name: myName() || 'You (no name yet)', device: 'This device', me: true }, ...others.map((p) => ({ name: p.name, device: p.device }))].map((p) => `<div class="list-item"><span class="thumb-sq" aria-hidden="true">${p.me ? '🙋' : '👤'}</span><div class="grow"><b>${esc(p.name)}</b><div class="small muted">${esc(p.device || '')}</div></div></div>`).join('')}</div>`}
      </div>`;
  };

  const refresh = async () => { await load(); draw(); };
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    error = '';
    if (f.matches('[data-name]')) {
      const n = await setMyName(f.name.value);
      if (sb.isConfigured()) { try { await sb.setMemberName(n); } catch (x) { error = sb.friendlyError(x); } }
      toast(n ? `Hello, ${n}!` : 'Name cleared', { kind: 'ok' });
      return refresh();
    }
    if (f.matches('[data-email]')) {
      email = f.email.value.trim();
      busy = true; draw();
      try { codeType = await sb.sendEmailCode(email); step = 'code'; } catch (x) { error = sb.friendlyError(x); }
      busy = false; draw();
      root.querySelector('[data-code] input')?.focus();
      return;
    }
    if (f.matches('[data-code]')) {
      busy = true; draw();
      try {
        await sb.verifyEmail(email, f.code.value, codeType);
        step = 'idle';
        toast(`Signed in as ${email}`, { kind: 'ok' });
      } catch (x) { error = sb.friendlyError(x); }
      busy = false;
      return refresh();
    }
  });
  root.addEventListener('click', (e) => { if (e.target.closest('[data-restart]')) { step = 'idle'; error = ''; draw(); } });
  draw();
  refresh();
  const off1 = store.onChange(({ changes }) => { if (changes.some((c) => c.c === 'profiles') && step !== 'code' && !root.contains(document.activeElement)) draw(); });
  const off2 = sync.onState(() => {});
  return () => { off1(); off2(); };
}
