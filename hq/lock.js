// Sign-in: plain and professional. Username + PIN or password, then a 6-digit code if two-step sign-in is on.
import { esc, $, LOGO } from '../shared/ui.js';

/**
 * Shows the sign-in (or first-time setup) screen in `root` until the right details are entered.
 * `api` is the transport's api(). Resolves with { codename, session, role? }.
 */
export function lockScreen(root, api, { remote = false, reason = '' } = {}) {
  return new Promise(async (resolve) => {
    let st = { setup: true };
    try { st = await api('/auth/status'); } catch (e) { root.innerHTML = frame(`<p class="c-red">${esc(e.message)}</p>`); return; }
    const setup = !st.setup;
    if (setup && remote) { root.innerHTML = frame('<p>No Director account exists yet. Create it on the HQ computer first.</p>'); return; }
    root.innerHTML = frame(`
      <h1 class="login-h">${setup ? 'Create the Director account' : 'Sign in'}</h1>
      <p class="small muted login-sub">${setup ? 'The Director has full control of SENTINEL. You’ll need these details every time HQ is opened.' : reason ? esc(reason) : 'Authorised users only.'}</p>
      <form data-login autocomplete="off" novalidate>
        <label class="field"><span>Username</span><input name="codename" maxlength="24" autocapitalize="none" spellcheck="false" required autofocus autocomplete="username"></label>
        <label class="field"><span>PIN or password</span><input name="pin" type="password" minlength="4" maxlength="64" required class="mono" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
        ${setup ? '<label class="field"><span>Confirm PIN or password</span><input name="pin2" type="password" minlength="4" maxlength="64" required class="mono" autocomplete="new-password"></label>' : ''}
        <label class="field" data-otpfield hidden><span>6-digit code from your authenticator app</span><input name="otp" inputmode="numeric" pattern="[0-9]*" maxlength="6" class="mono otp" autocomplete="one-time-code"></label>
        <p class="c-red small" data-err role="alert"></p>
        <button class="btn-primary login-btn">${setup ? 'Create account' : 'Sign in'}</button>
      </form>
      ${setup ? '<p class="small muted">At least 4 characters. Only a salted hash is stored. After 5 wrong attempts sign-in is locked for a minute (longer each time).</p>' : ''}`);
    const form = $('[data-login]', root), err = $('[data-err]', root);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const codename = form.codename.value, pin = form.pin.value;
      if (String(codename).trim().length < 2) { err.textContent = 'Enter your username.'; return; }
      if (pin.length < 4) { err.textContent = 'PIN or password must be at least 4 characters.'; return; }
      if (setup && pin !== form.pin2.value) { err.textContent = 'The two entries don’t match.'; return; }
      const btn = form.querySelector('button');
      btn.disabled = true; btn.textContent = setup ? 'Creating…' : 'Signing in…';
      try {
        if (setup) await api('/auth/setup', { method: 'POST', body: { codename, pin } });
        const otpField = form.querySelector('[data-otpfield]');
        const r = await api('/auth/unlock', { method: 'POST', body: { codename, pin, ...(otpField.hidden ? {} : { otp: form.elements.otp.value }) } });
        resolve(r);
      } catch (x) {
        err.textContent = x.message;
        btn.disabled = false; btn.textContent = setup ? 'Create account' : 'Sign in';
        if (x.needOtp || /6-digit code|code is wrong/.test(x.message)) { // the PIN was right: now the code
          const f = form.querySelector('[data-otpfield]'); f.hidden = false; form.elements.otp.value = ''; form.elements.otp.focus();
          return;
        }
        form.pin.value = '';
        form.pin.focus();
      }
    });
  });
}

const frame = (inner) => `<div class="gate"><div class="login-panel">
  <div class="login-brand">${LOGO}<div><b>SENTINEL</b><small>Household security operations</small></div></div>
  ${inner}
  <p class="login-notice">Use of this system is monitored and logged. Unauthorised access is prohibited.</p></div></div>`;
