// Command Centre settings: effects, Mission Log retention + export, password; People and Alerts tabs.
import { esc, $, toast, sheet, api } from '/shared/ui.js';

const TABS = [['general', 'General'], ['people', 'People'], ['alerts', 'Alerts']];
const extraTabs = {}; // filled in by people.js / alerts.js
export const registerTab = (id, render) => { extraTabs[id] = render; };

export function openSettings(S, { tab = 'general', onChange } = {}) {
  const s = sheet(`<div class="filters" role="tablist" style="margin-bottom:14px">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div><div data-tabbody></div>`, { title: 'Settings', wide: true });
  const body = s.body.querySelector('[data-tabbody]');
  const show = async (t) => {
    s.body.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
    if (t === 'general') general(body, S, onChange);
    else if (extraTabs[t]) await extraTabs[t](body, S);
    else body.innerHTML = '<p class="muted">Coming soon.</p>';
  };
  s.body.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  if (tab !== 'general') import(tab === 'people' ? '/dashboard/people.js' : '/dashboard/alerts.js').catch(() => {}).then(() => show(tab)); else show(tab);
  import('/dashboard/people.js').catch(() => {});
  import('/dashboard/alerts.js').catch(() => {});
  return s;
}

function general(body, S, onChange) {
  const st = S.settings;
  body.innerHTML = `
    <form data-general>
      <label class="field row"><input type="checkbox" name="fx" ${st.fx ? 'checked' : ''}><span style="margin:0">Scanlines, glitch and typewriter effects (also used by Agents)</span></label>
      <label class="field"><span>Keep Mission Log entries for</span><div class="row"><input type="number" name="retentionDays" min="1" max="3650" value="${esc(st.retentionDays)}" style="max-width:120px"><span class="muted">days, then delete automatically</span></div></label>
      <button class="btn-primary">Save</button>
    </form>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">Export the Mission Log</h2>
    <div class="row"><a class="btn" href="/api/export?format=csv" download>⇩ CSV (spreadsheet)</a><a class="btn" href="/api/export?format=json" download>⇩ JSON</a></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">Away from home (Tailscale)</h2>
    ${S.network?.tailscaleUrls?.length ? `<p class="small"><span class="dot on"></span> Tailscale is running on HQ. From your phone (with Tailscale on) open: ${S.network.tailscaleUrls.map((u) => `<span class="mono">${esc(u)}</span>`).join(' or ')}</p>` : ''}
    <details><summary class="small"><b>How to see the Command Centre when you’re out</b></summary>
      <ol class="small" style="line-height:1.7;padding-left:20px">
        <li>Tailscale makes a private, encrypted link between <b>your own</b> devices. Nothing is opened to the internet, and it’s free for personal use.</li>
        <li>Install <b>Tailscale</b> on this HQ computer (tailscale.com/download) and sign in.</li>
        <li>Install the <b>Tailscale</b> app on your phone and sign in with the <b>same account</b>.</li>
        <li>On HQ, open Terminal and run once: <code class="mono">tailscale serve --bg https+insecure://localhost:${esc(S.network?.httpsPort || 8443)}</code></li>
        <li>It prints an address like <span class="mono">https://my-mac.tail1234.ts.net</span>. Open that on your phone (Tailscale on) — it has a proper padlock, no certificate setup needed. Add it to your Home Screen.</li>
      </ol>
      <p class="small muted">Alerts don’t need Tailscale: they reach your phone anywhere. Tailscale is only for opening the Command Centre.</p>
    </details>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">HQ password</h2>
    <form data-pw class="row">
      <input type="password" name="current" placeholder="Current password" autocomplete="current-password" required style="flex:1;min-width:160px">
      <input type="password" name="next" placeholder="New password (6+)" minlength="6" autocomplete="new-password" required style="flex:1;min-width:160px">
      <button>Change</button>
    </form>
    <div class="row" style="margin-top:18px"><span class="grow small muted">${S.network ? `HQ address: <span class="mono">${esc(S.network.dashboardUrl)}</span>` : ''}</span><button class="btn-danger" data-logout>Log out</button></div>`;
  $('[data-general]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const s = await api('/api/settings', { method: 'PATCH', body: { fx: e.target.fx.checked, retentionDays: Number(e.target.retentionDays.value) } }); onChange?.(s); toast('Settings saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  $('[data-pw]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/password', { method: 'POST', body: { current: e.target.current.value, next: e.target.next.value } }); e.target.reset(); toast('Password changed. Other devices need to log in again.'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  $('[data-logout]', body).addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });
}
