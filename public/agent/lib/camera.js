// Camera helper for missions. Frames are only ever read here, on the Agent, as tiny greyscale
// grids — nothing visual is stored or sent anywhere.
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
  return {
    video, stream, W, H,
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
    stop() { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; },
  };
}
