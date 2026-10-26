// Command Centre settings: General (effects, Mission Log, export, backup), Phones (see HQ from anywhere), Alerts.
import { esc, $, toast, sheet, confirmBox, qrSvg, ago } from '../shared/ui.js';
import { forgetViewer } from './transport.js';
import { THEMES } from '../shared/themes.js';
import { sfx, sfxPrefs, setSfx } from '../shared/sfx.js';
import { voicePrefs, setVoicePrefs, voiceSupported, PRIVACY } from './voice.js';

const TABS = [['general', 'General'], ['security', 'Security'], ['phones', 'Phones'], ['alerts', 'Alerts']];
const extraTabs = {}; // filled in by alerts.js
export const registerTab = (id, render) => { extraTabs[id] = render; };
const q3d = () => { try { return localStorage.getItem('sentinel.q3d') || 'medium'; } catch { return 'medium'; } };
const hr = '<hr style="border:0;border-top:1px solid var(--line);margin:18px 0">';

/** Save text as a file on this device (Mission Log export, backups). */
export function download({ filename, type, text }) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function openSettings(S, { tab = 'general', onChange } = {}) {
  const s = sheet(`<div class="filters" role="tablist" style="margin-bottom:14px">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div><div data-tabbody></div>`, { title: 'Settings', wide: true, onClose: () => { S.onViewers = null; } });
  const body = s.body.querySelector('[data-tabbody]');
  const show = async (t) => {
    S.onViewers = null;
    s.body.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
    if (t === 'general') general(body, S, onChange);
    else if (t === 'phones') phones(body, S);
    else if (t === 'security') security(body, S, onChange);
    else { await import('./alerts.js'); await extraTabs[t]?.(body, S); }
  };
  s.body.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  show(tab);
  return s;
}

function general(body, S, onChange) {
  const st = S.settings, local = S.mode === 'hq';
  const sp = sfxPrefs();
  body.innerHTML = `
    <h2 style="margin-bottom:8px">Look &amp; sound</h2>
    <div class="themes" role="group" aria-label="Theme">${THEMES.map(([k, l]) => `<button type="button" class="theme-chip t-${k}" data-theme="${k}" aria-pressed="${st.theme === k}"><i></i>${esc(l)}</button>`).join('')}</div>
    <label class="field" style="margin-top:12px"><span>3D map quality (this device)</span><select data-q3d style="max-width:260px">${[['low', 'Low — smooth on older laptops'], ['medium', 'Medium'], ['high', 'High — sharpest']].map(([k, l]) => `<option value="${k}" ${q3d() === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${local ? `<label class="field" style="margin-top:12px"><span>Automatic internet speed test</span><select data-speedevery style="max-width:260px">${[[0, 'Off (run it by hand)'], [24, 'Once a day'], [6, 'Every 6 hours'], [1, 'Every hour (uses ~250 MB a day)']].map(([v, l]) => `<option value="${v}" ${Number(st.speedEvery || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="help">Each test downloads about 8 MB and uploads 2 MB.</div></label>` : ''}
    <label class="field" style="margin-top:12px"><span>Sound volume (this device)</span><div class="row"><input type="range" min="0" max="100" step="5" value="${Math.round(sp.volume * 100)}" data-volume style="flex:1"><label class="row small" style="gap:6px"><input type="checkbox" data-muted ${sp.muted ? 'checked' : ''}> Mute</label></div></label>
    ${hr}<h2 style="margin-bottom:8px">Voice commands (this device)</h2>
    ${voiceSupported() ? `<label class="field row"><input type="checkbox" data-voiceon ${voicePrefs().on ? 'checked' : ''}><span style="margin:0">Push-to-talk voice commands: hold the microphone button at the top (or the V key) and speak, e.g. “switch to night mode”.</span></label>
      <label class="field row"><input type="checkbox" data-voicereply ${voicePrefs().reply ? 'checked' : ''}><span style="margin:0">Answer out loud</span></label>
      <p class="help">${esc(PRIVACY())}</p>` : '<p class="small muted">This browser can’t do voice commands. Chrome or Edge can. Typed commands work everywhere: press <b class="mono">`</b> or the terminal button.</p>'}
    ${hr}
    <form data-general>
      <label class="field row"><input type="checkbox" name="fx" ${st.fx ? 'checked' : ''}><span style="margin:0">Display effects: faint grid, scan lines and typing text (also used by Agents). Turn off on a slow computer.</span></label>
      <label class="field"><span>Auto-lock after</span><select name="autoLockMin" style="max-width:220px">${[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never (not recommended)']].map(([v, l]) => `<option value="${v}" ${Number(st.autoLockMin) === v ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="help">Without a tap, click or key for this long, HQ locks and asks for your codename + PIN. HQ keeps guarding the house while locked.</div></label>
      <label class="field"><span>Keep Mission Log entries for</span><div class="row"><input type="number" name="retentionDays" min="1" max="3650" value="${esc(st.retentionDays)}" style="max-width:120px"><span class="muted">days, then delete automatically</span></div></label>
      <button class="btn-primary">Save</button>
    </form>
    ${hr}<h2 style="margin-bottom:8px">Director codename &amp; PIN</h2>
    <form data-pin class="pin-form" autocomplete="off">
      <input name="codename" placeholder="Current codename" required class="mono" style="text-transform:uppercase">
      <input name="pin" type="password" inputmode="numeric" placeholder="Current PIN" required class="mono">
      <input name="newCodename" placeholder="New codename (optional)" class="mono" style="text-transform:uppercase">
      <input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" placeholder="New PIN (optional)" class="mono">
      <button>Change</button>
    </form>
    ${hr}<h2 style="margin-bottom:8px">Export the Mission Log</h2>
    <div class="row"><button data-export="csv">⇩ CSV (spreadsheet)</button><button data-export="json">⇩ JSON</button></div>
    ${local ? `${hr}<h2 style="margin-bottom:8px">This HQ</h2>
    <p class="small">HQ code: <b class="mono c-green" data-hqcodeshow>${esc(S.hqCode())}</b></p>
    <p class="small muted">Everything HQ knows is stored in <b>this browser on this computer</b>. Keep this page open (and the computer plugged in and awake) — Agents can only report while it’s open.
      Moving to another computer or browser? Make a backup here and restore it there.</p>
    <div class="row"><button data-backup>⇩ Back up HQ</button><label class="btn" style="cursor:pointer">⇧ Restore a backup<input type="file" accept=".json,application/json" data-restore hidden></label></div>` : ''}`;
  $('[data-general]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const s = await S.api('/settings', { method: 'PATCH', body: { fx: e.target.fx.checked, retentionDays: Number(e.target.retentionDays.value), autoLockMin: Number(e.target.autoLockMin.value) } }); onChange?.(s); toast('Settings saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  body.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', async () => {
    try { const s = await S.api('/settings', { method: 'PATCH', body: { theme: b.dataset.theme } }); onChange?.(s); body.querySelectorAll('[data-theme]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); sfx('granted'); } catch (x) { toast(x.message, { kind: 'err' }); }
  }));
  $('[data-speedevery]', body)?.addEventListener('change', async (e) => { try { onChange?.(await S.api('/settings', { method: 'PATCH', body: { speedEvery: Number(e.target.value) } })); toast('Speed test schedule saved'); } catch (x) { toast(x.message, { kind: 'err' }); } });
  $('[data-q3d]', body).addEventListener('change', (e) => { try { localStorage.setItem('sentinel.q3d', e.target.value); } catch { /* ignore */ } window.__map3d?.setQuality(e.target.value); toast('3D quality saved for this device'); });
  $('[data-volume]', body).addEventListener('change', (e) => { setSfx({ volume: Number(e.target.value) / 100, muted: false }); $('[data-muted]', body).checked = false; sfx('beep'); });
  $('[data-muted]', body).addEventListener('change', (e) => setSfx({ muted: e.target.checked }));
  $('[data-voiceon]', body)?.addEventListener('change', async (e) => {
    if (!e.target.checked) { setVoicePrefs({ on: false }); toast('Voice commands off'); return; }
    e.target.checked = false;
    if (!(await confirmBox('Switch on voice commands?', PRIVACY(), { ok: 'I understand, switch on' }))) return;
    e.target.checked = true;
    setVoicePrefs({ on: true });
    toast('Voice commands on. Hold the microphone button (or V) and speak.');
  });
  $('[data-voicereply]', body)?.addEventListener('change', (e) => setVoicePrefs({ reply: e.target.checked }));
  $('[data-pin]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { const r = await S.api('/auth/change', { method: 'POST', body: { codename: f.codename.value, pin: f.pin.value, newCodename: f.newCodename.value, newPin: f.newPin.value } }); f.reset(); toast(`Saved. Director codename: ${r.codename}`); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  body.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', async () => {
    try { download(await S.api(`/export?format=${b.dataset.export}`)); } catch (x) { toast(x.message, { kind: 'err' }); }
  }));
  $('[data-backup]', body)?.addEventListener('click', async () => { try { download(await S.api('/backup')); toast('Backup saved — keep the file somewhere safe (it holds your Agents’ keys).'); } catch (x) { toast(x.message, { kind: 'err' }); } });
  $('[data-restore]', body)?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!(await confirmBox('Restore this backup?', 'It replaces everything in this HQ (Agents, Mission Log, settings). The page reloads afterwards.', { ok: 'Restore', danger: true }))) return;
    try { await S.api('/restore', { method: 'POST', body: JSON.parse(await f.text()) }); location.reload(); } catch (x) { toast(x.message || 'That file couldn’t be read.', { kind: 'err' }); }
  });
}

/** Security modes: when NIGHT is suggested, and the LOCKDOWN alarm protocol. */
function security(body, S, onChange) {
  const st = S.settings, a = st.alarm || {};
  body.innerHTML = `
    <h2 style="margin-bottom:8px">Security modes</h2>
    <dl class="kv" style="margin-bottom:12px">
      <dt>Home</dt><dd>Occupied. Activity is logged; nothing raises an alarm.</dd>
      <dt>Away</dt><dd>Unoccupied. Any activity from any Agent is an intrusion (THREAT RED).</dd>
      <dt>Night</dt><dd>Occupants asleep. Only Agents marked “Armed in NIGHT mode” raise THREAT RED. Untick it on bedroom Agents (Agent details).</dd>
      <dt>Lockdown</dt><dd>Maximum alert. Everything is armed and Agents can sound the alarm.</dd>
    </dl>
    <form data-night class="row" style="align-items:flex-end">
      <label class="field" style="margin:0"><span>Night starts</span><input type="time" name="nightStart" value="${esc(st.nightStart || '22:30')}"></label>
      <label class="field" style="margin:0"><span>Night ends</span><input type="time" name="nightEnd" value="${esc(st.nightEnd || '07:00')}"></label>
      <button>Save</button>
    </form>
    <p class="help">HQ suggests switching to NIGHT after this time, and back to HOME in the morning. After 3 hours with no activity in the day it suggests AWAY.</p>
    ${hr}<h2 style="margin-bottom:8px">Alarm protocol (LOCKDOWN and PANIC)</h2>
    <form data-alarm>
      <label class="field row"><input type="checkbox" name="enabled" ${a.enabled ? 'checked' : ''}><span style="margin:0">Agents flash red when an armed sensor goes off in LOCKDOWN (PANIC always alerts them)</span></label>
      <label class="field row"><input type="checkbox" name="siren" ${a.siren ? 'checked' : ''}><span style="margin:0">Sound a siren on the Agents too</span></label>
      <label class="field"><span>Siren volume limit: <b data-vol>${a.volume}%</b></span><input type="range" name="volume" min="0" max="100" step="5" value="${a.volume}"></label>
      <label class="field"><span>Alarm lasts (seconds)</span><input type="number" name="seconds" min="5" max="300" value="${a.seconds}" style="max-width:120px"></label>
      <div class="row" style="align-items:flex-end"><label class="field" style="margin:0"><span>No siren from</span><input type="time" name="quietStart" value="${esc(a.quietStart || '')}"></label><label class="field" style="margin:0"><span>until</span><input type="time" name="quietEnd" value="${esc(a.quietEnd || '')}"></label></div>
      <p class="help">During these hours Agents still flash, but stay silent.</p>
      <div class="row"><button class="btn-primary">Save</button><button type="button" data-testalarm>Test on all Agents (4 s)</button></div>
    </form>`;
  $('[data-alarm] [name=volume]', body).addEventListener('input', (e) => { $('[data-vol]', body).textContent = `${e.target.value}%`; });
  $('[data-night]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { onChange?.(await S.api('/settings', { method: 'PATCH', body: { nightStart: e.target.nightStart.value, nightEnd: e.target.nightEnd.value } })); toast('Night hours saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  $('[data-alarm]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { onChange?.(await S.api('/settings', { method: 'PATCH', body: { alarm: { enabled: f.enabled.checked, siren: f.siren.checked, volume: Number(f.volume.value), seconds: Number(f.seconds.value), quietStart: f.quietStart.value, quietEnd: f.quietEnd.value } } })); toast('Alarm protocol saved'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
  $('[data-testalarm]', body).addEventListener('click', async () => {
    try { const r = await S.api('/alarm/test', { method: 'POST' }); toast(r.agents ? `Test alarm sent to ${r.agents} Agent${r.agents === 1 ? '' : 's'}` : 'No Agents online to test.'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });
}

/** Phones linked to HQ can open the Command Centre from anywhere (and get alerts while it's open). */
function phones(body, S) {
  if (S.mode !== 'hq') {
    body.innerHTML = `<p>This phone is linked to HQ. You can open the Command Centre from anywhere with internet.</p>
      <button class="btn-danger" data-unlink>Unlink this phone</button>`;
    $('[data-unlink]', body).addEventListener('click', async () => { if (await confirmBox('Unlink this phone?', 'You’ll need a new QR code from HQ to link it again.', { ok: 'Unlink', danger: true })) { forgetViewer(); location.reload(); } });
    return;
  }
  const draw = (viewers) => {
    body.innerHTML = `
      <p style="margin-top:0">Link your own phone to see the Command Centre (and get alerts) when you’re out. It’s a private, encrypted link straight to this computer.</p>
      <button class="btn-primary" data-linkphone>＋ Link a phone</button>
      <div data-linkbox></div>
      ${hr}<h2 style="margin-bottom:8px">Linked phones</h2>
      <div>${viewers.map((v) => `<div class="row recon-row" data-viewer="${esc(v.id)}"><b class="grow">${esc(v.label)}</b><span class="small muted">linked ${esc(ago(v.createdAt))} · last opened ${esc(ago(v.lastSeen))}</span><button class="btn-ghost small" data-unlinkv aria-label="Unlink ${esc(v.label)}">Unlink</button></div>`).join('') || '<p class="small muted">None yet.</p>'}</div>`;
    $('[data-linkphone]', body).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const p = await S.api('/pair', { method: 'POST', body: { role: 'viewer' } });
        const link = S.joinLink('./remote.html', { hq: S.info.hqId, link: p.code });
        const box = $('[data-linkbox]', body);
        box.innerHTML = `<div class="recruit" style="margin-top:14px"><div class="qr" data-qr></div><div><ol><li>On <b>your</b> phone, open the Camera and scan this code.</li><li>Tap the link, give the phone a name, press <b>Link this phone</b>.</li><li>Then add it to your Home Screen (Share → Add to Home Screen).</li></ol><p class="small muted">The code works once, for 10 minutes.</p></div></div>`;
        const qr = $('[data-qr]', box);
        qr.innerHTML = await qrSvg(link);
        qr.dataset.link = link;
      } catch (x) { toast(x.message, { kind: 'err' }); e.target.disabled = false; }
    });
    body.querySelectorAll('[data-unlinkv]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-viewer]').dataset.viewer;
      try { await S.api(`/viewers/${id}`, { method: 'DELETE' }); toast('Phone unlinked'); } catch (x) { toast(x.message, { kind: 'err' }); }
    }));
  };
  S.onViewers = (v) => { if (!$('[data-qr]', body)) draw(v); else { toast('Phone linked ✔'); draw(v); } };
  S.api('/viewers').then(draw, (x) => { body.innerHTML = `<p class="c-red">${esc(x.message)}</p>`; });
}
