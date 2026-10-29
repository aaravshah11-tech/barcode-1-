// The GLOBAL INTEL globe: dark Earth with glowing borders, day/night line, home, the ISS and its
// orbit, and earthquake pulses. Drag to turn, scroll to zoom. Draws at a modest frame rate.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { decodeArcs, latLonToVec, subsolar } from '../../shared/geo.js';

const V = (lat, lon, r = 1) => new THREE.Vector3(...latLonToVec(lat, lon, r));
const css = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return new THREE.Color(v || fb); };
const ISS_LIFT = 0.07; // the ISS drawn a little higher than real (400 km would hug the surface)

export class Globe {
  constructor(box, { onPick, world, home, lowPower = false } = {}) {
    this.box = box; this.onPick = onPick; this.home = home; this.low = lowPower;
    this.c = { accent: css('--green', '#7fb2d9'), amber: css('--amber', '#e0a84f'), red: css('--red', '#e05252'), muted: css('--muted', '#7d8b99'), text: css('--text', '#dfe6ee') };
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowPower, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(lowPower ? 1 : Math.min(2, devicePixelRatio || 1));
    this.renderer.domElement.className = 'globe-canvas';
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'Globe. Drag to turn, scroll to zoom, click a marker for details.');
    box.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    const start = home ? V(home.lat, home.lon, 3.4) : new THREE.Vector3(0, 1, 3.3);
    this.camera.position.copy(start);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.07, minDistance: 1.35, maxDistance: 6, rotateSpeed: 0.5, zoomSpeed: 0.6, autoRotate: true, autoRotateSpeed: 0.35 });
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; this.follow = null; this.fly = null; clearTimeout(this.resume); });
    this.controls.addEventListener('end', () => { clearTimeout(this.resume); this.resume = setTimeout(() => { if (!this.follow) this.controls.autoRotate = true; }, 20000); });

    this.earth();
    if (world) this.borders(world);
    if (home) this.homeMarker(home);
    this.quakeGroup = new THREE.Group(); this.scene.add(this.quakeGroup);
    this.issGroup = new THREE.Group(); this.scene.add(this.issGroup);
    this.pickables = [];
    this.setSun(Date.now());

    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) this.pick(e); down = null; });
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(box); this.resize();
    this.last = 0; this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
    window.__globe = this; // for the automated tests
  }

  earth() {
    // ocean sphere: lit side a little brighter than the night side, with a warm line at dusk
    this.sunDir = new THREE.Vector3(1, 0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: this.sunDir }, day: { value: new THREE.Color('#1a3a55') }, night: { value: new THREE.Color('#03060a') }, dusk: { value: this.c.amber }, showNight: { value: 1 } },
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 sunDir, day, night, dusk; uniform float showNight; varying vec3 vN;
        void main(){ float d = dot(vN, normalize(sunDir)); float k = mix(1.0, smoothstep(-0.1, 0.1, d), showNight);
          vec3 c = mix(night, day, k) + dusk * 0.16 * showNight * (1.0 - smoothstep(0.0, 0.035, abs(d)));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.earthMat = mat;
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, this.low ? 48 : 96, this.low ? 32 : 64), mat);
    this.scene.add(this.sphere);
    // thin atmosphere rim
    const rim = new THREE.Mesh(new THREE.SphereGeometry(1.025, 64, 48), new THREE.ShaderMaterial({
      uniforms: { col: { value: this.c.accent } }, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 col; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(col, f * 0.55); }',
    }));
    this.scene.add(rim);
    // graticule every 30°
    const pts = [];
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 4) pts.push(V(lat, lon, 1.001), V(lat, lon + 4, 1.001));
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) pts.push(V(lat, lon, 1.001), V(lat + 4, lon, 1.001));
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: this.c.accent, transparent: true, opacity: 0.08 })));
  }
  borders(topo) {
    const pts = [];
    for (const arc of decodeArcs(topo)) for (let i = 1; i < arc.length; i++) { if (Math.abs(arc[i][0] - arc[i - 1][0]) > 90) continue; pts.push(V(arc[i - 1][1], arc[i - 1][0], 1.0015), V(arc[i][1], arc[i][0], 1.0015)); }
    this.scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: this.c.accent, transparent: true, opacity: 0.6 })));
  }
  homeMarker(h) {
    const g = new THREE.Group(), p = V(h.lat, h.lon, 1.002);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 20), new THREE.MeshBasicMaterial({ color: this.c.text }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.019, 40), new THREE.MeshBasicMaterial({ color: this.c.accent, transparent: true, side: THREE.DoubleSide }));
    for (const m of [dot, ring]) { m.position.copy(p); m.lookAt(p.clone().multiplyScalar(2)); g.add(m); }
    const label = sprite('HQ', this.c.text, 0.035); label.position.copy(V(h.lat, h.lon, 1.04)); g.add(label);
    this.homeRing = ring;
    this.scene.add(g);
  }
  setSun(ms) { const s = subsolar(ms); this.sunDir.copy(V(s.lat, s.lon, 1)); }
  setNight(on) { this.earthMat.uniforms.showNight.value = on ? 1 : 0; }

  /** ISS: position { lat, lon }, track [[lat, lon, minutes]] (negative = past). */
  setIss(pos, track) {
    this.issGroup.clear();
    this.pickables = this.pickables.filter((p) => p.userData.pick?.type !== 'iss');
    if (!pos) return;
    const r = 1 + ISS_LIFT;
    if (track?.length) {
      const segs = (past) => { const out = []; let prev = null; for (const [la, lo, m] of track) { if ((m <= 0) !== past) { prev = null; continue; } const v = V(la, lo, r); if (prev) out.push(prev, v); prev = v; } return out; };
      this.issGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs(true)), new THREE.LineBasicMaterial({ color: this.c.amber, transparent: true, opacity: 0.25 })));
      const fut = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs(false)), new THREE.LineDashedMaterial({ color: this.c.amber, dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.8 }));
      fut.computeLineDistances();
      this.issGroup.add(fut);
    }
    const p = V(pos.lat, pos.lon, r);
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.018), new THREE.MeshBasicMaterial({ color: this.c.amber }));
    body.position.copy(p);
    const stalk = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(pos.lat, pos.lon, 1.001), p]), new THREE.LineBasicMaterial({ color: this.c.amber, transparent: true, opacity: 0.4 }));
    const label = sprite('ISS', this.c.amber, 0.04); label.position.copy(V(pos.lat, pos.lon, r + 0.045));
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(p); hit.userData.pick = { type: 'iss' };
    this.issGroup.add(body, stalk, label, hit);
    this.pickables.push(hit);
    this.issPos = pos;
    if (this.follow === 'iss') this.lookAt(pos.lat, pos.lon, false);
  }
  /** Earthquakes: [{ id, lat, lon, mag }] → pulsing rings (bigger and redder for stronger ones). */
  setQuakes(list) {
    this.quakeGroup.clear();
    this.pickables = this.pickables.filter((p) => p.userData.pick?.type !== 'quake');
    this.pulses = [];
    for (const q of list) {
      const p = V(q.lat, q.lon, 1.003), size = 0.006 + Math.max(0, q.mag - 2.5) * 0.007;
      const col = q.mag >= 6 ? this.c.red : q.mag >= 4.5 ? this.c.amber : this.c.muted;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(size * 0.45, 16), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(size * 0.9, size, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      for (const m of [dot, ring]) { m.position.copy(p); m.lookAt(p.clone().multiplyScalar(2)); this.quakeGroup.add(m); }
      const hit = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.02, size), 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(p); hit.userData.pick = { type: 'quake', id: q.id };
      this.quakeGroup.add(hit); this.pickables.push(hit);
      this.pulses.push({ ring, phase: Math.random(), speed: q.mag >= 4.5 ? 1 : 0.5 });
    }
  }
  showLayer(name, on) { const g = { iss: this.issGroup, quakes: this.quakeGroup }[name]; if (g) g.visible = on; if (name === 'night') this.setNight(on); }
  /** Highlight a selection (a ring around it). */
  select(sel) {
    this.selRing?.parent?.remove(this.selRing); this.selRing = null;
    const at = sel?.lat != null ? { lat: sel.lat, lon: sel.lon, r: sel.type === 'iss' ? 1 + ISS_LIFT : 1.004 } : null;
    if (!at) return;
    const p = V(at.lat, at.lon, at.r);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.04, 40), new THREE.MeshBasicMaterial({ color: this.c.text, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.selRing.position.copy(p); this.selRing.lookAt(p.clone().multiplyScalar(2));
    this.scene.add(this.selRing);
  }
  /** Turn the globe so this place faces you. */
  lookAt(lat, lon, smooth = true) {
    const dist = this.camera.position.length(), to = V(lat, lon, dist);
    this.controls.autoRotate = false;
    if (!smooth) { this.camera.position.copy(to); return; }
    this.fly = { from: this.camera.position.clone(), to, t0: performance.now(), dur: 1100 };
  }
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = ray.intersectObjects([this.sphere, ...this.pickables.filter((p) => p.parent?.visible !== false)], false);
    const front = hits.find((h) => h.object.userData.pick);
    // only markers on the near side of the Earth count
    if (front && (!hits.length || hits[0].object !== this.sphere || front.distance <= hits[0].distance + 0.02)) this.onPick?.(front.object.userData.pick);
  }
  resize() { const w = this.box.clientWidth, h = this.box.clientHeight; if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.box.isConnected) return;
    const fps = this.low ? 20 : 40;
    if (now - this.last < 1000 / fps) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.fly) {
      const k = Math.min(1, (now - this.fly.t0) / this.fly.dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const len = this.fly.from.length() + (this.fly.to.length() - this.fly.from.length()) * e;
      this.camera.position.copy(this.fly.from.clone().normalize().lerp(this.fly.to.clone().normalize(), e).normalize().multiplyScalar(len));
      if (k >= 1) this.fly = null;
    }
    for (const p of this.pulses || []) { p.phase = (p.phase + dt * 0.6 * p.speed) % 1; p.ring.scale.setScalar(1 + p.phase * 2.2); p.ring.material.opacity = 0.75 * (1 - p.phase); }
    if (this.homeRing) this.homeRing.scale.setScalar(1 + 0.25 * Math.sin(now / 500));
    if (this.selRing) this.selRing.rotation.z += dt;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames = (this.frames || 0) + 1;
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); if (window.__globe === this) window.__globe = null; }
}

function sprite(text, color, h) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), font = '600 40px Inter, system-ui, sans-serif';
  g.font = font; const w = Math.ceil(g.measureText(text).width) + 16; c.width = w; c.height = 56; g.font = font;
  g.fillStyle = `#${color.getHexString()}`; g.textBaseline = 'middle'; g.fillText(text, 8, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set((h * w) / 56, h, 1);
  return s;
}
