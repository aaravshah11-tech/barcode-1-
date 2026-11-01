// On-device object recognition for PERIMETER WATCH (TensorFlow.js + COCO-SSD, both bundled with SENTINEL).
// The model runs in this browser only. Pictures are never sent anywhere.
let loading = null;

function script(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load the recogniser'));
    document.head.appendChild(s);
  });
}

/** Resolves to { detect(canvas) → [{ class, score, bbox }] }, or rejects (the mission then runs motion-only). */
export function loadDetector() {
  if (window.__sentinelDetector) return Promise.resolve(window.__sentinelDetector); // automated tests
  loading ||= (async () => {
    const base = new URL('../../vendor/', import.meta.url).href;
    await script(`${base}tfjs/tf.min.js`);
    await script(`${base}coco-ssd/coco-ssd.min.js`);
    const model = await Promise.race([
      window.cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: `${base}coco-ssd/model/model.json` }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('the recogniser took too long to start')), 90000)),
    ]);
    return { detect: (canvas) => model.detect(canvas, 10, 0.3) };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
