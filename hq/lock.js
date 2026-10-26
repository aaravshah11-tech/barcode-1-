// The Director login screen: codename + PIN, with a (cosmetic) fingerprint / retina scan.
import { esc, $, LOGO } from '../shared/ui.js';
import { sfx } from '../shared/sfx.js';

const FINGERPRINT = `<svg viewBox="0 0 64 64" class="fp" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M20 50c-3-5-4-11-4-17a16 16 0 0 1 32 0"/><path d="M26 54c-3-6-4-13-4-20a10 10 0 0 1 20 0c0 4 0 9-1 13"/><path d="M32 56c-2-7-3-14-3-22a3 3 0 0 1 6 0c0 8 1 14 3 19"/>
  <path d="M14 22a22 22 0 0 1 36 0"/><path d="M19 13a26 26 0 0 1 26 0"/><path d="M48 40c0 4-1 8-2 11"/></g></svg>`;
const EYE = `<svg viewBox="0 0 64 64" class="eye" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M4 32c8-12 18-18 28-18s20 6 28 18c-8 12-18 18-28 18S12 44 4 32z"/><circle cx="32" cy="32" r="11"/><circle cx="32" cy="32" r="4" fill="currentColor"/></g></svg>`;

/**
 * Shows the login (or first-time setup) screen in `root` until the right codename + PIN are entered.
 * `api` is the transport's api(). Resolves with { codename, session }.
 */
export function lockScreen(root, api, { remote = false, reason = '' } = {}) {
  return new Promise(async (resolve) => {
    let st = { setup: true };
    try { st = await api('/auth/status'); } catch (e) { root.innerHTML = frame(`<p class="c-red">${esc(e.message)}</p>`); return; }
    const setup = !st.setup;
    if (setup && remote) { root.innerHTML = frame('<p>The Director hasn’t been set up yet. Do that on the HQ computer first.</p>'); return; }
    root.innerHTML = frame(`
      <p class="small muted" style="margin:0 0 16px">${setup ? 'No operator enrolled. Choose a Director codename and PIN — you’ll need both every time HQ is opened.' : reason ? esc(reason) : 'Restricted system. Enter your operator codename and PIN.'}</p>
      <form data-login autocomplete="off">
        <label class="field"><span>Operator codename</span><input name="codename" maxlength="24" autocapitalize="characters" spellcheck="false" required autofocus style="text-transform:uppercase;letter-spacing:.12em"></label>
        <label class="field"><span>PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required class="mono pin" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
        ${setup ? '<label class="field"><span>PIN again</span><input name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required class="mono pin" autocomplete="new-password"></label>' : ''}
        <div class="scanner" data-scanner hidden><div class="scan-icons">${FINGERPRINT}${EYE}</div><div class="scan-line"></div><div class="scan-text mono" data-scantext>VERIFYING IDENTITY…</div></div>
        <p class="c-red small mono" data-err role="alert"></p>
        <button class="btn-primary" style="width:100%">${setup ? 'Enrol director' : 'Authenticate'}</button>
      </form>
      ${setup ? '<p class="small muted" style="margin-top:12px">PIN = 4 to 8 digits. It’s stored only as a scrambled hash on this computer. After 5 wrong tries, login locks for a minute (longer each time).</p>' : ''}`);
    const form = $('[data-login]', root), err = $('[data-err]', root), scanner = $('[data-scanner]', root), text = $('[data-scantext]', root);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const codename = form.codename.value, pin = form.pin.value;
      if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'PIN must be 4–8 digits.'; return; }
      if (setup && pin !== form.pin2.value) { err.textContent = 'The two PINs don’t match.'; return; }
      const btn = form.querySelector('button');
      btn.disabled = true;
      scanner.hidden = false; scanner.className = 'scanner'; text.textContent = setup ? 'ENROLLING OPERATOR…' : 'VERIFYING CREDENTIALS…';
      sfx('scan');
      const minWait = new Promise((r) => setTimeout(r, 1300));
      try {
        if (setup) await api('/auth/setup', { method: 'POST', body: { codename, pin } });
        const r = await api('/auth/unlock', { method: 'POST', body: { codename, pin } });
        await minWait;
        scanner.classList.add('ok'); text.textContent = `ACCESS GRANTED — WELCOME, ${r.codename}`;
        sfx('granted');
        setTimeout(() => resolve(r), 900);
      } catch (x) {
        await minWait;
        scanner.classList.add('bad'); text.textContent = 'ACCESS DENIED';
        sfx('denied');
        err.textContent = x.message;
        form.pin.value = '';
        setTimeout(() => { scanner.hidden = true; btn.disabled = false; form.pin.focus(); }, 1200);
      }
    });
  });
}

const frame = (inner) => `<div class="gate"><div class="hud-bg"></div><div class="panel hud-in login-panel">${LOGO}<h1 class="login-title">Sentinel · Secure access</h1>${inner}<p class="small" style="margin:16px 0 0;color:var(--dim)">All access attempts are logged.</p></div></div>`;
