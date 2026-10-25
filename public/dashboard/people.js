// Settings › People: who lives here, which phones are theirs, and how Wi-Fi recon behaves.
import { registerTab } from '/dashboard/settings.js';
import { esc, $, toast, api, ago, confirmBox } from '/shared/ui.js';

let showAll = false;

registerTab('people', async (body) => {
  body.innerHTML = '<p class="muted">Loading…</p>';
  let R;
  try { R = await api('/api/recon'); } catch (e) { body.innerHTML = `<p class="c-red">${esc(e.message)}</p>`; return; }
  draw(body, R);
});

function draw(body, R) {
  const { people, devices, status, settings } = R;
  const owner = (d) => people.find((p) => p.id === d.personId);
  const visible = devices.filter((d) => showAll || d.personId || d.name || (!d.ignored && Date.now() - d.lastSeen < 864e5));
  const statusLine = status.lastError ? `<span class="c-amber">⚠ ${esc(status.lastError)}</span>`
    : status.lastScan ? `Last scan ${ago(status.lastScan)} · ${status.count} device(s) answered · ${esc(status.method)}`
      : 'First scan running…';

  body.innerHTML = `
    <h2 style="margin-bottom:8px">People</h2>
    <p class="small muted" style="margin-top:0">A person is <b>HOME</b> when one of their phones is on the Wi-Fi. Switch someone off to stop tracking them.</p>
    <div data-peoplerows>${people.map((p) => `
      <div class="row recon-row" data-person="${esc(p.id)}">
        <span class="dot ${p.home && p.enabled ? 'on' : ''}" aria-hidden="true"></span>
        <input value="${esc(p.name)}" data-pname aria-label="Name" maxlength="40" style="flex:1;min-width:110px">
        <span class="mono small muted" style="min-width:110px">${!p.enabled ? 'NOT TRACKED' : p.home ? 'HOME' : 'AWAY'}${p.lastSeen ? ` · seen ${ago(p.lastSeen)}` : ''}</span>
        <label class="row small" style="gap:6px"><input type="checkbox" data-penabled ${p.enabled ? 'checked' : ''}> Track</label>
        <button class="btn-ghost small" data-pdel aria-label="Remove ${esc(p.name)}">✕</button>
      </div>`).join('') || '<p class="muted small">No one added yet.</p>'}</div>
    <form class="row" data-addperson style="margin-top:8px"><input name="name" placeholder="Name, e.g. Mum" maxlength="40" required style="flex:1"><button>Add person</button></form>

    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <div class="row"><h2 class="grow" style="margin:0">Devices on your Wi-Fi</h2><button class="small" data-scan ${status.scanning ? 'disabled' : ''}>Scan now</button></div>
    <p class="small muted mono" data-status>${statusLine}</p>
    <p class="small muted" style="margin-top:0">Find each person’s phone below, give it a name and pick its owner. Tip: turn a phone’s Wi-Fi off and on, press <b>Scan now</b>, and see which line jumps to the top.</p>
    <div data-devices>${visible.map((d) => `
      <div class="recon-row recon-device ${d.ignored ? 'muted' : ''}" data-mac="${esc(d.mac)}">
        <div class="row" style="gap:8px">
          <span class="dot ${Date.now() - d.lastSeen < settings.graceMin * 60000 ? 'on' : ''}" aria-hidden="true"></span>
          <span class="mono small grow">${esc(d.mac)} · ${esc(d.ip || '')}${d.hostname ? ` · ${esc(d.hostname)}` : ''}</span>
          ${d.private ? '<span class="tag tag-amber" title="This phone uses a private (random) Wi-Fi address. See below.">PRIVATE ADDRESS</span>' : ''}
          <span class="small muted">seen ${ago(d.lastSeen)}</span>
        </div>
        <div class="row" style="gap:8px;margin-top:6px">
          <input value="${esc(d.name)}" placeholder="Name, e.g. Mum’s iPhone" data-dname maxlength="40" aria-label="Device name" style="flex:1;min-width:140px">
          <select data-downer aria-label="Owner"><option value="">No owner</option>${people.map((p) => `<option value="${esc(p.id)}" ${owner(d)?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <label class="row small" style="gap:6px"><input type="checkbox" data-dignore ${d.ignored ? 'checked' : ''}> Ignore</label>
          <button class="btn-ghost small" data-ddel aria-label="Forget device">✕</button>
        </div>
      </div>`).join('') || `<p class="muted small">${status.lastScan ? 'No devices found yet.' : 'Scanning…'}</p>`}</div>
    <label class="row small" style="margin-top:8px;gap:6px"><input type="checkbox" data-showall ${showAll ? 'checked' : ''}> Show ignored and older devices (${devices.length} total)</label>

    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <h2 style="margin-bottom:8px">Timing</h2>
    <form class="row" data-timing style="align-items:flex-end">
      <label class="field" style="margin:0"><span>Mark AWAY after not seen for</span><div class="row"><input type="number" name="graceMin" min="1" max="240" value="${settings.graceMin}" style="max-width:90px"><span class="muted">min</span></div></label>
      <label class="field" style="margin:0"><span>Scan every</span><div class="row"><input type="number" name="scanEvery" min="20" max="600" value="${settings.scanEvery}" style="max-width:90px"><span class="muted">seconds</span></div></label>
      <button>Save</button>
    </form>
    <p class="small muted">Phones turn Wi-Fi off to save battery when the screen is off, so a gap of a few minutes is normal. 15 minutes is a good grace period.</p>

    <details style="margin-top:14px"><summary><b>Why does a phone show “PRIVATE ADDRESS”?</b></summary>
      <div class="small" style="line-height:1.6">
        <p>Every Wi-Fi device has an address (a “MAC address”). To stop shops and cafés tracking people, modern phones make up a <b>random one</b> for each Wi-Fi network. That’s fine for SENTINEL as long as it <b>stays the same on your home Wi-Fi</b>. Phones can change it now and then, and then they’d show up as a new device.</p>
        <p><b>iPhone / iPad:</b> Settings → Wi-Fi → tap ⓘ next to your home network → <b>Private Wi-Fi Address</b>. Set it to <b>Fixed</b> (iOS 18+) or turn it <b>Off</b> (older iOS). “Rotating” changes the address every couple of weeks, which breaks tracking.</p>
        <p><b>Android:</b> Settings → Wi-Fi → tap your home network (or ⚙) → <b>Privacy</b> (sometimes under Advanced) → choose <b>Use device MAC</b>, or leave it on <b>Use randomised MAC</b>, which usually stays the same for one network. Avoid “re-randomise each time” options.</p>
        <p>If someone suddenly shows as AWAY while at home, look for a new device here and give it to them.</p>
      </div>
    </details>`;

  const redraw = (next) => draw(body, next);
  const call = async (url, opts, msg) => { try { const r = await api(url, opts); redraw(r); if (msg) toast(msg); } catch (e) { toast(e.message, { kind: 'err' }); } };

  $('[data-addperson]', body).addEventListener('submit', (e) => { e.preventDefault(); call('/api/people', { method: 'POST', body: { name: e.target.name.value } }, 'Person added'); });
  $('[data-scan]', body).addEventListener('click', (e) => { e.target.disabled = true; e.target.textContent = 'Scanning…'; call('/api/recon/scan', { method: 'POST' }); });
  $('[data-showall]', body).addEventListener('change', (e) => { showAll = e.target.checked; redraw(R); });
  $('[data-timing]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/settings', { method: 'PATCH', body: { graceMin: Number(e.target.graceMin.value), scanEvery: Number(e.target.scanEvery.value) } }); toast('Timing saved'); call('/api/recon'); } catch (x) { toast(x.message, { kind: 'err' }); }
  });

  body.querySelectorAll('[data-person]').forEach((row) => {
    const url = `/api/people/${encodeURIComponent(row.dataset.person)}`;
    $('[data-pname]', row).addEventListener('change', (e) => call(url, { method: 'PATCH', body: { name: e.target.value } }, 'Renamed'));
    $('[data-penabled]', row).addEventListener('change', (e) => call(url, { method: 'PATCH', body: { enabled: e.target.checked } }));
    $('[data-pdel]', row).addEventListener('click', async () => { if (await confirmBox('Remove person?', 'Their devices stay in the list, with no owner.', { ok: 'Remove', danger: true })) call(url, { method: 'DELETE' }, 'Removed'); });
  });
  body.querySelectorAll('[data-mac]').forEach((row) => {
    const url = `/api/devices/${encodeURIComponent(row.dataset.mac)}`;
    $('[data-dname]', row).addEventListener('change', (e) => call(url, { method: 'PATCH', body: { name: e.target.value } }, 'Device named'));
    $('[data-downer]', row).addEventListener('change', (e) => call(url, { method: 'PATCH', body: { personId: e.target.value || null } }, 'Owner saved'));
    $('[data-dignore]', row).addEventListener('change', (e) => call(url, { method: 'PATCH', body: { ignored: e.target.checked } }));
    $('[data-ddel]', row).addEventListener('click', () => call(url, { method: 'DELETE' }, 'Device forgotten'));
  });
}
