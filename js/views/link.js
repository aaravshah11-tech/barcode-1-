// Pair a phone with a computer.
import * as link from '../sync/peer-link.js';
import { Scanner, cameraErrorMessage } from '../scanner.js';
import { esc, icon, loadScript, confirmDialog } from '../ui.js';

const isPhone = () => /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);

export function render(root, params) {
  let scanner = null;
  let showPhoneSetup = false;
  const codeFromUrl = params[0] ? link.normalizeCode(params[0]) : '';

  async function stopScanner() {
    if (scanner) { const s = scanner; scanner = null; await s.stop(); }
  }

  async function draw() {
    const st = link.getState();
    let body = '';
    if (st.role === 'host') {
      body = `<div class="card center">
          <p style="font-weight:600">On your phone, open the camera and scan this code</p>
          <div class="qr" data-qr aria-label="Pairing QR code"></div>
          <div class="code">${esc(st.code.slice(0, 3))} ${esc(st.code.slice(3))}</div>
          <p class="small muted">Or in Shelf on your phone: Settings › Link phone &amp; computer › “This is my phone” and type the code.</p>
        </div>
        ${statusHtml(st)}
        <div class="btn-row" style="margin-top:12px"><button class="btn" data-new-code>New code</button><button class="btn btn-danger" data-unlink>Stop linking</button></div>`;
    } else if (st.role === 'guest') {
      body = `${statusHtml(st)}
        <div class="card" style="margin-top:12px"><p>Every book you scan on this phone is saved here <b>and</b> sent to your computer. If the connection drops, Shelf catches up automatically next time.</p>
          <div class="btn-row"><a class="btn btn-primary" href="#/scan">Start scanning</a><a class="btn" href="#/scan/batch">Batch scan</a></div></div>
        <button class="btn btn-danger btn-block" data-unlink style="margin-top:12px">Unlink</button>`;
    } else if (showPhoneSetup) {
      body = `<div class="card">
          <h2>Scan the code on your computer</h2>
          <div class="scanner-box" style="margin:10px 0"><div id="link-reader" style="width:100%"></div><div class="scanner-msg" data-cam-msg>Starting camera…</div></div>
          <form data-code-form style="display:flex;gap:8px"><input name="code" placeholder="Or type the 6-letter code" autocomplete="off" autocapitalize="characters" maxlength="7" style="text-transform:uppercase;letter-spacing:.12em"><button class="btn btn-primary">Connect</button></form>
        </div><button class="btn btn-ghost btn-block" data-back style="margin-top:8px">Back</button>`;
    } else {
      body = `<div class="choice">
          <button data-host><span class="big">💻</span><b>This is my computer</b><span class="muted small">Show a pairing code to scan with your phone.</span></button>
          <button data-guest><span class="big">📱</span><b>This is my phone</b><span class="muted small">Scan the code on your computer’s screen.</span></button>
        </div>
        <div class="card" style="margin-top:16px"><h3>How it works</h3>
          <ol class="small muted" style="padding-left:20px;margin:0">
            <li>Open Shelf on your computer and choose <b>This is my computer</b>.</li>
            <li>On your phone, scan the QR code it shows (or type the code).</li>
            <li>Scan books on your phone — they pop up on the computer straight away.</li>
          </ol>
          <p class="small muted" style="margin:10px 0 0">Both devices keep a full copy of the library, so each works offline. They catch up whenever they’re both open and online. The connection is direct between your devices; a free PeerJS service just introduces them.</p>
        </div>`;
    }
    root.innerHTML = `<h1>Link phone &amp; computer</h1><p class="muted">Use your phone as a barcode scanner for your computer.</p>${body}`;

    if (st.role === 'host') {
      try {
        await loadScript('vendor/qrcode.js');
        const qr = window.qrcode(0, 'M');
        qr.addData(link.pairingUrl(st.code));
        qr.make();
        const el = root.querySelector('[data-qr]');
        if (el) el.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      } catch { /* code text still shown */ }
    }
    if (showPhoneSetup && !st.role) startScanner();
  }

  function statusHtml(st) {
    const map = {
      connected: ['banner-ok', 'check', st.role === 'host' ? `Connected to <b>${esc(st.devices.join(', '))}</b>. Books scanned there appear here live.` : 'Connected to your computer.'],
      waiting: ['', 'phone', 'Waiting for your phone to connect…'],
      connecting: ['banner-warn', 'refresh', esc(st.message || 'Connecting…')],
      error: ['banner-warn', 'alert', esc(st.message || 'Connection problem. Retrying…')],
    };
    const [cls, ic, text] = map[st.state] || map.connecting;
    return `<div class="banner ${cls}" style="margin-top:12px" data-status>${icon(ic)}<div class="grow">${text}</div></div>`;
  }

  async function startScanner() {
    await stopScanner();
    const msg = () => root.querySelector('[data-cam-msg]');
    scanner = new Scanner('link-reader', (text) => {
      const code = link.codeFromText(text);
      if (code) connect(code);
    }, { qr: true, barcodes: false });
    try {
      await scanner.start();
      if (msg()) msg().hidden = true;
    } catch (err) {
      const m = cameraErrorMessage(err);
      if (msg()) msg().innerHTML = `<b>${esc(m.title)}</b><div class="small">${esc(m.text)}</div><div class="small">You can type the code below instead.</div>`;
    }
  }

  async function connect(code) {
    showPhoneSetup = false;
    await stopScanner();
    await link.connectTo(code);
    if (location.hash.startsWith('#/link/')) history.replaceState(null, '', '#/link');
    draw();
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('host' in t.dataset) await link.startHosting();
    else if ('guest' in t.dataset) { showPhoneSetup = true; draw(); }
    else if ('back' in t.dataset) { showPhoneSetup = false; await stopScanner(); draw(); }
    else if ('newCode' in t.dataset) await link.startHosting({ newCode: true });
    else if ('unlink' in t.dataset) {
      if (await confirmDialog({ title: 'Unlink devices?', message: 'Both devices keep their copy of the library. You can link again any time.', confirmLabel: 'Unlink' })) await link.unlink();
    }
  });
  root.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-code-form]')) return;
    e.preventDefault();
    const code = link.normalizeCode(e.target.code.value);
    if (code.length === 6) connect(code);
    else e.target.code.setCustomValidity('Enter the 6-character code'), e.target.code.reportValidity(), setTimeout(() => e.target.code.setCustomValidity(''), 1500);
  });

  // Status changes: redraw only when the role changes, otherwise just swap the status line.
  let lastRole = link.getState().role;
  const off = link.onState((st) => {
    if (st.role !== lastRole) { lastRole = st.role; draw(); return; }
    const el = root.querySelector('[data-status]');
    if (el) el.outerHTML = statusHtml(st);
  });

  (async () => {
    if (codeFromUrl) {
      const st = link.getState();
      if (st.role === 'host' && !isPhone()) {
        // Opened our own pairing link on the computer — ignore.
      } else if (!(st.role === 'guest' && st.code === codeFromUrl)) {
        await connect(codeFromUrl);
        return;
      }
      history.replaceState(null, '', '#/link');
    }
    draw();
  })();

  return () => { off(); stopScanner(); };
}
