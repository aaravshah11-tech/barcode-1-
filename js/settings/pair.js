// Settings › Pair phone & computer.
import * as sync from '../sync/manager.js';
import { Scanner, cameraErrorMessage } from '../core/scanner.js';
import { esc, icon, loadScript, confirmDialog, toast, isPhone } from '../core/ui.js';

const { sb, relay } = sync;

async function qrSvg(text) {
  await loadScript('vendor/qrcode.js');
  const qr = window.qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export function renderPair(root, params) {
  let scanner = null;
  let showScan = false;
  let showCloudForm = false;
  let busy = false;
  let errorMsg = '';

  const stopScan = async () => { if (scanner) { const s = scanner; scanner = null; await s.stop(); } };

  async function draw() {
    const st = sync.getState();
    const cloud = sb.isConfigured();
    const cfg = sb.config();
    let html = `<div class="page-head"><h1>Pair phone & computer</h1></div>`;
    if (errorMsg) html += `<div class="banner banner-danger">${icon('alert')}<div class="grow">${esc(errorMsg)}</div></div>`;

    if (cloud) {
      html += statusBanner(st);
      html += `<div class="two-col">
        <div class="card center"><h2>Pair another device</h2>
          <p class="muted small">On your phone, open the Camera app and point it at this code. HomeBase opens and pairs.</p>
          <div class="qr" data-qr></div>
          <p class="small muted" style="margin-top:10px">This QR code is like a password for your data — don’t share it.</p>
          <button class="btn btn-sm" data-rotate>${icon('refresh')} New code (old ones stop working)</button></div>
        <div class="card"><h2>Cloud sync is on</h2>
          <dl class="details"><dt>Mode</dt><dd>Supabase (works anywhere)</dd><dt>This device</dt><dd>${esc(cfg.role === 'host' ? 'Set it up' : 'Joined by QR')}</dd>
          <dt>Other devices online</dt><dd>${esc(st.devices?.join(', ') || 'none right now')}</dd><dt>Waiting to upload</dt><dd>${st.pending || 0}</dd>
          <dt>Project</dt><dd class="small">${esc(cfg.url)}</dd></dl>
          <button class="btn btn-danger btn-block" data-cloud-off style="margin-top:14px">Stop syncing on this device</button></div>
      </div>`;
    } else if (showScan) {
      html += `<div class="card"><h2>Scan the QR code on your computer</h2>
          <div class="scanner-box"><div id="pair-reader"></div><div class="scanner-msg" data-cam-msg>Starting camera…</div></div>
          <form data-code-form style="display:flex;gap:8px"><input name="code" placeholder="Or type the quick-link code" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.1em"><button class="btn btn-primary">Connect</button></form>
        </div><button class="btn btn-ghost btn-block" data-back style="margin-top:8px">Back</button>`;
    } else if (showCloudForm) {
      html += `<div class="card"><h2>Connect to Supabase</h2>
        <ol class="steps small">
          <li>Create a free project at <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com</a>.</li>
          <li>In the project: <b>SQL Editor › New query</b>, paste the file <span class="kbd">supabase/schema.sql</span> from this app, then <b>Run</b>.</li>
          <li><b>Authentication › Sign In / Providers</b>: turn on <b>Allow anonymous sign-ins</b>.</li>
          <li><b>Project Settings › API</b>: copy the <b>Project URL</b> and the <b>anon public</b> key below.</li>
        </ol>
        <form data-cloud-form>
          <label class="field"><span>Project URL</span><input name="url" placeholder="https://abcdefgh.supabase.co" autocomplete="off" inputmode="url" required></label>
          <label class="field"><span>anon public key</span><textarea name="key" placeholder="eyJhbGciOi…" required style="min-height:80px;font-family:var(--mono);font-size:.8rem"></textarea></label>
          <button class="btn btn-primary btn-lg btn-block" ${busy ? 'disabled' : ''}>${busy ? 'Connecting…' : 'Connect & create my household'}</button>
        </form>
        <p class="small muted" style="margin-top:10px">Only use the <b>anon public</b> key, never the “service_role” key.</p></div>
        <button class="btn btn-ghost btn-block" data-back style="margin-top:8px">Back</button>`;
    } else if (st.mode === 'relay') {
      html += statusBanner(st);
      html += st.role === 'host'
        ? `<div class="card center"><p style="font-weight:600">On your phone, open the camera and scan this code</p><div class="qr" data-qr></div>
            <div class="code">${esc(relay.formatCode(st.code))}</div>
            <p class="small muted">Quick link works while both devices have HomeBase open. For sync that works any time, set up cloud sync below.</p>
            <div class="btn-row"><button class="btn" data-relay-new>New code</button><button class="btn btn-danger" data-relay-off>Stop linking</button></div></div>`
        : `<div class="card"><p>Linked to your computer by quick link. Things you add here appear there live.</p>
            <button class="btn btn-danger btn-block" data-relay-off>Unlink</button></div>`;
      html += `<button class="btn btn-outline btn-block" data-cloud-setup style="margin-top:12px">${icon('cloud')} Switch to cloud sync (Supabase)</button>`;
    } else {
      html += `<p class="muted">Use your phone for scanning and logging, and your computer for dashboards and editing. Everything you do on one appears live on the other.</p>
        <div class="choice">
          <button data-cloud-setup><span class="big">☁️</span><b>Cloud sync (recommended)</b><span class="muted small">Supabase free tier. Works anywhere, any time — even when the other device is off. About 5 minutes to set up on your computer.</span></button>
          <button data-scan><span class="big">📱</span><b>This is my phone: scan the code</b><span class="muted small">Scan the QR code shown on your computer.</span></button>
          <button data-relay-host><span class="big">⚡</span><b>Quick link (no setup)</b><span class="muted small">Pair right now through free relays. Works while both devices are open.</span></button>
        </div>`;
    }
    root.innerHTML = html;

    const qrEl = root.querySelector('[data-qr]');
    if (qrEl) { const url = sync.pairingUrl(); if (url) qrEl.innerHTML = await qrSvg(url).catch(() => ''); }
    if (showScan) startScan();
  }

  function statusBanner(st) {
    const map = {
      connected: ['banner-ok', 'check', st.mode === 'cloud' ? `Connected to the cloud.${st.devices?.length ? ` ${esc(st.devices.join(', '))} online now.` : ''}` : `Linked with <b>${esc(st.devices.join(', '))}</b>.`],
      waiting: ['', 'phone', esc(st.message || 'Waiting for the other device…')],
      connecting: ['banner-warn', 'refresh', esc(st.message || 'Connecting…')],
      offline: ['banner-warn', 'wifiOff', esc(st.message || 'Offline')],
      error: ['banner-danger', 'alert', esc(st.message || 'Problem connecting')],
    };
    const [cls, ic, text] = map[st.state] || map.connecting;
    return `<div class="banner ${cls}" data-status>${icon(ic)}<div class="grow">${text}</div></div>`;
  }

  async function startScan() {
    await stopScan();
    const msg = () => root.querySelector('[data-cam-msg]');
    scanner = new Scanner('pair-reader', (text) => {
      const p = sync.parsePairing(text);
      if (p) pair(p);
    }, { qr: true, barcodes: false });
    try { await scanner.start(); if (msg()) msg().hidden = true; } catch (err) {
      const m = cameraErrorMessage(err);
      if (msg()) msg().innerHTML = `<b>${esc(m.title)}</b><div class="small">${esc(m.text)}</div>`;
    }
  }

  async function pair(p) {
    if (busy) return;
    busy = true;
    errorMsg = '';
    showScan = false;
    await stopScan();
    root.innerHTML = `<div class="empty"><div class="art">🔗</div><h2>Pairing…</h2><p class="muted">${p.type === 'cloud' ? 'Joining your household in the cloud.' : 'Connecting through the quick link.'}</p></div>`;
    try {
      await sync.pairWith(p);
      toast('Paired! Everything you do now syncs.', { kind: 'ok' });
    } catch (e) {
      errorMsg = sb.friendlyError(e);
    }
    busy = false;
    if (location.hash.match(/#\/(pair|link)\//)) history.replaceState(null, '', '#/settings/pair');
    draw();
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    errorMsg = '';
    if ('cloudSetup' in d) { showCloudForm = true; draw(); }
    else if ('scan' in d) { showScan = true; draw(); }
    else if ('back' in d) { showScan = false; showCloudForm = false; await stopScan(); draw(); }
    else if ('relayHost' in d) { await relay.startHosting(); }
    else if ('relayNew' in d) { await relay.startHosting({ newCode: true }); }
    else if ('relayOff' in d) { if (await confirmDialog({ title: 'Stop the quick link?', message: 'Both devices keep their data.', confirmLabel: 'Stop' })) await relay.unlink(); }
    else if ('rotate' in d) {
      try { await sb.newJoinCode(); toast('New pairing code made. Old QR codes no longer work.', { kind: 'ok' }); draw(); } catch (err) { toast(sb.friendlyError(err), { kind: 'err' }); }
    } else if ('cloudOff' in d) {
      if (await confirmDialog({ title: 'Stop syncing on this device?', message: 'Your data stays on this device and in Supabase. You can pair again later.', confirmLabel: 'Stop syncing', danger: true })) { await sb.disconnect(); draw(); }
    }
  });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('[data-cloud-form]')) {
      busy = true; draw();
      try {
        await relay.unlink();
        await sb.setupHousehold(f.url.value, f.key.value);
        showCloudForm = false;
        toast('Cloud sync is on. Now scan the QR code with your phone.', { kind: 'ok', timeout: 6000 });
      } catch (err) { errorMsg = sb.friendlyError(err); }
      busy = false;
      draw();
      if (errorMsg) { showCloudForm = true; draw(); }
    } else if (f.matches('[data-code-form]')) {
      const p = sync.parsePairing(f.code.value);
      if (p) pair(p); else toast('That code doesn’t look right.', { kind: 'err' });
    }
  });

  let lastKey = '';
  const off = sync.onState((st) => {
    const key = `${st.mode}|${st.role}|${st.code}`;
    if (key !== lastKey) { lastKey = key; if (!showScan && !showCloudForm && !busy) draw(); return; }
    const el = root.querySelector('[data-status]');
    if (el) el.outerHTML = statusBanner(st);
  });

  // Opened from a pairing QR: #/pair/<data> or #/link/<code>
  const [kind, payload] = params;
  if (kind && payload) {
    const p = sync.parsePairing(kind === 'pair' ? `#/pair/${payload}` : `#/link/${payload}`);
    if (p) { pair(p); } else { errorMsg = 'That pairing link isn’t valid. Show the QR code on the computer again.'; draw(); }
  } else {
    if (isPhone() && sync.mode() === 'off') showScan = false;
    draw();
  }
  return () => { off(); stopScan(); };
}
