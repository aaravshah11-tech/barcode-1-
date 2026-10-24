// Camera barcode scanner (wraps html5-qrcode, which uses ZXing and the
// browser's native BarcodeDetector when available).
import { loadScript } from './ui.js';

const LIB = 'vendor/html5-qrcode.min.js';

/** Turn a camera error into a friendly message. */
export function cameraErrorMessage(err) {
  const msg = String(err?.message || err || '');
  const name = err?.name || '';
  if (!window.isSecureContext) {
    return { title: 'Camera needs a secure (https) link', text: 'Open Shelf from its https:// address (for example your GitHub Pages link). Cameras are blocked on plain http pages.' };
  }
  if (name === 'NotAllowedError' || /permission|denied|notallowed/i.test(msg)) {
    return {
      title: 'Camera permission is off',
      text: 'Allow camera access for this site. iPhone: Settings › Safari › Camera › Allow (or tap “aA” in the address bar › Website Settings). Android: tap the lock icon by the address › Permissions › Camera.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /not ?found|no camera|requested device/i.test(msg)) {
    return { title: 'No camera found', text: 'Type the ISBN below instead, or link your phone and use it as the scanner.' };
  }
  if (name === 'NotReadableError' || /in use|could not start|notreadable/i.test(msg)) {
    return { title: 'Camera is busy', text: 'Another app or tab is using the camera. Close it and try again.' };
  }
  return { title: 'Camera didn’t start', text: msg || 'Something went wrong starting the camera.' };
}

export class Scanner {
  /**
   * @param {string} elementId  id of an empty div to render the video into
   * @param {(text:string, format:string)=>void} onCode
   * @param {{qr?: boolean}} opts  qr: also read QR codes (used for device pairing)
   */
  constructor(elementId, onCode, { qr = false, barcodes = true } = {}) {
    this.elementId = elementId;
    this.onCode = onCode;
    this.qr = qr;
    this.barcodes = barcodes;
    this.instance = null;
    this.chain = Promise.resolve();
    this.running = false;
    this.paused = false;
  }

  _queue(fn) {
    this.chain = this.chain.then(fn, fn);
    return this.chain;
  }

  start() {
    return this._queue(async () => {
      if (this.running) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        const e = new Error(window.isSecureContext ? 'No camera found' : 'insecure');
        e.name = window.isSecureContext ? 'NotFoundError' : 'SecurityError';
        throw e;
      }
      await loadScript(LIB);
      const lib = window.__Html5QrcodeLibrary__;
      const F = lib.Html5QrcodeSupportedFormats;
      const formats = [];
      if (this.barcodes) formats.push(F.EAN_13, F.UPC_A, F.EAN_8);
      if (this.qr) formats.push(F.QR_CODE);
      if (!document.getElementById(this.elementId)) return;
      this.instance = new lib.Html5Qrcode(this.elementId, {
        formatsToSupport: formats,
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      const qrbox = (w, h) => {
        if (this.qr && !this.barcodes) { const s = Math.max(120, Math.floor(Math.min(w, h) * 0.7)); return { width: s, height: s }; }
        return { width: Math.max(120, Math.floor(w * 0.82)), height: Math.max(80, Math.floor(h * (this.qr ? 0.6 : 0.42))) };
      };
      await this.instance.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox,
          disableFlip: true,
          videoConstraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] },
        },
        (text, result) => {
          if (!this.paused) this.onCode(text, result?.result?.format?.formatName || '');
        },
        () => {},
      );
      this.running = true;
      this.paused = false;
    });
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  canTorch() {
    try {
      return !!this.instance?.getRunningTrackCapabilities?.().torch;
    } catch { return false; }
  }

  async setTorch(on) {
    try {
      await this.instance.applyVideoConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch { return false; }
  }

  stop() {
    return this._queue(async () => {
      if (!this.instance) return;
      try { if (this.running) await this.instance.stop(); } catch { /* already stopped */ }
      try { this.instance.clear(); } catch { /* ignore */ }
      this.instance = null;
      this.running = false;
    });
  }
}
