// One-click "Pair phone" pop-up (top bar on computers): shows the QR code straight away.
import * as sync from '../sync/manager.js';
import { esc, icon, openSheet, toast } from '../core/ui.js';
import { qrSvg } from './pair.js';

const { sb, relay } = sync;
let open = null;

export async function openPairSheet() {
  if (open) return;
  const s = (open = openSheet(`<div class="pair-sheet center">
      <p class="pair-lead">On your phone, open the <b>Camera</b> app and point it at this code, then tap the link.</p>
      <div class="qr" data-qr aria-label="Pairing QR code"><div class="muted small" style="padding:40px 0">Making the code…</div></div>
      <div data-code-wrap hidden><div class="small muted" style="margin-top:8px">or type this code on the phone:</div><div data-code class="code"></div></div>
      <div data-status class="pair-status small muted" aria-live="polite"></div>
      <div class="btn-row" style="justify-content:center;margin-top:10px"><a class="btn btn-ghost btn-sm" href="#/settings/pair" data-close>More pairing options</a></div>
    </div>`, { title: 'Pair your phone', onClose: () => { off(); open = null; } }));
  const $ = (q) => s.body.querySelector(q);
  let linkedShown = false;
  const showStatus = (st) => {
    if (!s.body.isConnected) return;
    const linked = st.state === 'connected' && (st.mode === 'cloud' || st.devices?.length);
    $('[data-status]').innerHTML = st.mode === 'cloud'
      ? `${icon('cloud')} Cloud sync is on${st.devices?.length ? ` · ${esc(st.devices.join(', '))} online` : ''}.`
      : linked ? `<b class="ok-text">${icon('check')} Linked with ${esc(st.devices.join(', '))}</b>`
      : esc(st.message || 'Getting ready…') + (st.slow ? '<div style="margin-top:6px">Taking a while? Keep HomeBase open on the phone, or try switching it between Wi-Fi and mobile data.</div>' : '');
    if (linked && st.mode === 'relay' && !linkedShown) {
      linkedShown = true;
      toast(`Phone linked! (${st.devices.join(', ')})`, { kind: 'ok' });
      setTimeout(() => s.close(), 1500);
    }
  };
  const off = sync.onState(showStatus);
  // Nothing set up yet: start the quick link so there's a code to show right away.
  if (!sb.isConfigured() && relay.getState().role !== 'host') {
    if (relay.getState().role === 'guest') {
      $('[data-qr]').innerHTML = '<p class="muted">This device is linked to another computer as a phone. Open <b>More pairing options</b> to change that.</p>';
      showStatus(sync.getState());
      return;
    }
    await relay.startHosting();
  }
  const url = sync.pairingUrl();
  if (!s.body.isConnected) return;
  $('[data-qr]').innerHTML = url ? await qrSvg(url).catch(() => '<p class="muted">Couldn’t draw the code.</p>') : '<p class="muted">No code yet.</p>';
  const code = relay.getState().code;
  if (!sb.isConfigured() && code) { $('[data-code]').textContent = relay.formatCode(code); $('[data-code-wrap]').hidden = false; }
  showStatus(sync.getState());
}
