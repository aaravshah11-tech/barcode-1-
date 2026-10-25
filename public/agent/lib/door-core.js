// Door swing detector from the gyroscope (pure, unit tested).
// The phone sits flat on the door; a swing rotates it. We add up rotation while it moves,
// call it "open" past the set angle, and "closed" when it comes back and settles.
export function makeDoor({ angle = 12 } = {}) {
  let turned = 0; // degrees around the axis that moved most
  let axis = null;
  let still = 0; // ms the phone has been at rest
  let open = false;
  let moving = 0; // ms of movement since the last rest
  return {
    get open() { return open; },
    get turned() { return turned; },
    calibrate() { turned = 0; axis = null; open = false; still = 0; moving = 0; },
    setAngle(a) { angle = a; },
    /** rate: { alpha, beta, gamma } in °/s, dt in ms. Returns 'opened' | 'closed' | null. */
    step(rate, dt) {
      const r = { alpha: rate.alpha || 0, beta: rate.beta || 0, gamma: rate.gamma || 0 };
      const mag = Math.hypot(r.alpha, r.beta, r.gamma);
      // Cheap gyroscopes jitter by a few °/s even when still; a real door swing is much faster.
      if (mag < 6) { // resting: no drift build-up
        still += dt;
        if (still > 1200 && !open && Math.abs(turned) < angle / 2) { turned = 0; axis = null; moving = 0; }
        if (still > 800 && open && Math.abs(turned) < angle * 0.5) { open = false; turned = 0; axis = null; return 'closed'; }
        return null;
      }
      still = 0;
      moving += dt;
      // A partial turn that never became an opening (a bump, someone leaning on the door) is forgotten.
      if (!open && moving > 4000 && Math.abs(turned) < angle) { turned = 0; axis = null; moving = 0; }
      if (!axis) axis = Object.keys(r).reduce((a, b) => (Math.abs(r[b]) > Math.abs(r[a]) ? b : a));
      turned += (r[axis] * dt) / 1000;
      if (!open && Math.abs(turned) >= angle) { open = true; return 'opened'; }
      return null;
    },
  };
}
