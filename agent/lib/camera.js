// Camera helper for missions. Missions only read tiny greyscale grids here, on the Agent.
// The one exception is LIVE VIEW: while HQ has it open, small JPEG snapshots go to HQ to be
// shown on screen (never saved), and the Agent shows a red "LIVE VIEW" banner the whole time.
let active = null;
/** The camera a mission currently has open (Live view reuses it instead of opening a second one). */
export const activeCamera = () => (active?.alive() ? active : null);

export async function openCamera(facing = 'environment') {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera (it needs the secure https:// address).');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10, max: 15 } }, audio: false });
  } catch (e) {
    throw new Error(e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow the camera for this site in the browser settings, then restart the Agent page.' : `Camera unavailable: ${e.message}`);
  }
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.autoplay = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  const W = 64, H = 48;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const snap = document.createElement('canvas');
  const cam = {
    video, stream, W, H,
    /** A small JPEG of what the camera sees right now (for LIVE VIEW only). */
    snapshot(maxW = 320, quality = 0.55) {
      if (video.readyState < 2 || !video.videoWidth) return null;
      const scale = Math.min(1, maxW / video.videoWidth);
      snap.width = Math.round(video.videoWidth * scale); snap.height = Math.round(video.videoHeight * scale);
      snap.getContext('2d').drawImage(video, 0, 0, snap.width, snap.height);
      return snap.toDataURL('image/jpeg', quality);
    },
    /** Current frame as W×H brightness values (0–255). */
    grey() {
      if (video.readyState < 2) return null;
      g.drawImage(video, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      const out = new Uint8ClampedArray(W * H);
      for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      return out;
    },
    alive: () => stream.getVideoTracks().some((t) => t.readyState === 'live'),
    stop() { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; if (active === cam) active = null; },
  };
  active = cam;
  return cam;
}
