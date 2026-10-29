// THE 3D HOUSE MAP: your rooms rise up as a glowing hologram. Spin it (drag), zoom (scroll/pinch),
// switch floors, "explode" the floors apart, see Agents as glowing markers, and watch rooms light
// up when something happens. Built with Three.js (vendor/three).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { centroid, openingEnds, pointInPolygon, bbox, stepCount, OPENING_KINDS } from '../shared/house.js';
import { heatLevel, heatOpacity } from '../shared/replay.js';
import { planDir, shadowVector, shadowPolygon, particleCount } from '../shared/world.js';

const QUALITY = {
  low: { pixelRatio: 1, antialias: false, fps: 24, labels: false, faces: false },
  medium: { pixelRatio: Math.min(1.5, window.devicePixelRatio || 1), antialias: true, fps: 40, labels: true, faces: true },
  high: { pixelRatio: Math.min(2, window.devicePixelRatio || 1), antialias: true, fps: 60, labels: true, faces: true },
};
export const QUALITIES = [['low', 'Low (older laptops)'], ['medium', 'Medium'], ['high', 'High']];
export const getQuality = () => { try { return QUALITY[localStorage.getItem('sentinel.q3d')] ? localStorage.getItem('sentinel.q3d') : 'medium'; } catch { return 'medium'; } };
export const setQuality = (q) => { try { localStorage.setItem('sentinel.q3d', q); } catch { /* ignore */ } };
export function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

const cssColor = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return new THREE.Color(v || fb); };
const P = ([x, y]) => new THREE.Vector2(x, y); // plan (x, y) → shape coords; the shape is laid flat so plan y becomes 3D z

export class Map3D {
  /** box: the element to draw into. opts.onPick(agentId) when a marker is clicked; opts.onPlace(floorId, x, y) in place mode. */
  constructor(box, { onPick, onPlace, onHover, quality = getQuality(), fx = true } = {}) {
    this.box = box; this.onPick = onPick; this.onPlace = onPlace; this.onHover = onHover; this.fx = fx;
    this.q = QUALITY[quality] || QUALITY.medium; this.qName = quality;
    this.house = null; this.agents = []; this.floorSel = -1; this.explode = 0; this.explodeTarget = 0;
    this.effects = []; this.markers = new Map(); this.roomMeshes = new Map(); this.floorGroups = []; this.openingLines = [];
    this.placing = null; this.model = null; this.heat = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: this.q.antialias, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.renderer.domElement.className = 'map3d-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D map of the house. Drag to turn, scroll to zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    box.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.012);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.camera.position.set(14, 14, 18);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.49, minDistance: 3, maxDistance: 120 });
    this.controls.addEventListener('start', () => { this.flight = null; this.userMoved = Date.now(); this.wake(4000); });
    this.controls.addEventListener('change', () => this.wake(800));
    this.renderer.domElement.addEventListener('pointermove', (e) => { this.wake(1500); this.hover(e); });
    this.renderer.domElement.addEventListener('pointerleave', () => this.onHover?.(null));
    this.renderer.domElement.addEventListener('wheel', () => this.wake(1500), { passive: true });
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.ground = new THREE.Group();
    this.scene.add(this.ground);
    this.ray = new THREE.Raycaster();
    this.colors();
    this.buildGround();

    // clicks: pick a marker, or place an Agent
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) this.click(e); down = null; });
    // drag an Agent card from the list onto the map
    box.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/sentinel-agent')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => {
      box.classList.remove('drop');
      const id = e.dataTransfer?.getData('text/sentinel-agent');
      if (!id) return;
      e.preventDefault();
      const hit = this.floorPoint(e);
      if (hit) this.onPlace?.(id, hit.floorId, hit.x, hit.y);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(box);
    this.resize();
    this.last = 0;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    window.__map3d = this; // for the automated tests
  }

  /** Draw at full speed for a little while (moving, animating); otherwise tick over slowly to save power. */
  wake(ms = 1500) { this.activeUntil = Math.max(this.activeUntil || 0, performance.now() + ms); }

  colors() {
    this.c = { accent: cssColor('--green', '#45e0ff'), amber: cssColor('--amber', '#ffb627'), red: cssColor('--red', '#ff4d4d'), muted: cssColor('--muted', '#78a9c2'), window: new THREE.Color('#9fdcff') };
    // NIGHT VISION: everything in phosphor green (alerts stay red)
    if (this.nv) Object.assign(this.c, { accent: new THREE.Color('#52ff8f'), amber: new THREE.Color('#c9ff6b'), muted: new THREE.Color('#3a9c5c'), window: new THREE.Color('#8affb3') });
  }
  setTheme() { this.colors(); this.buildGround(); if (this.house) this.setHouse(this.house, true); this.setAgents(this.agents); }
  setQuality(name) {
    this.qName = name; this.q = QUALITY[name] || QUALITY.medium;
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.resize();
    if (this.house) this.setHouse(this.house, true);
    this.setAgents(this.agents);
  }

  buildGround() {
    this.ground.clear();
    const grid = new THREE.GridHelper(80, 80, this.c.muted, this.c.muted);
    grid.material.transparent = true; grid.material.opacity = 0.07; grid.material.depthWrite = false;
    grid.position.y = -0.01;
    this.ground.add(grid);
    this.sweep = null; // no radar sweep: a plain survey grid
  }

  // ---------- the house ----------
  floorBase(i) { let y = 0; for (let k = 0; k < i; k++) y += this.house.floors[k].height + 0.25; return y; }
  setHouse(house, keepView = false) {
    this.house = house;
    this.root.clear();
    this.roomMeshes.clear(); this.floorGroups = []; this.openingLines = [];
    const pts = house.floors.flatMap((f) => f.rooms.flatMap((r) => r.points));
    const b = pts.length ? bbox(pts) : { minX: 0, minY: 0, w: 10, h: 10 };
    this.center = new THREE.Vector3(b.minX + b.w / 2, 0, b.minY + b.h / 2);
    this.size = Math.max(b.w, b.h, 6);
    this.ground.position.set(this.center.x, 0, this.center.z);
    house.floors.forEach((f, i) => {
      const g = new THREE.Group();
      g.userData = { floorId: f.id, index: i, base: this.floorBase(i) };
      for (const r of f.rooms) g.add(this.roomObject(f, r));
      for (const o of f.openings) { const m = this.openingObject(f, o); if (m) g.add(m); }
      for (const x of f.fixtures || []) g.add(this.fixtureObject(f, x));
      this.root.add(g);
      this.floorGroups.push(g);
    });
    this.layout(true);
    this.applyHeat();
    if (this.world) this.buildWorld();
    if (!keepView) this.frame();
    this.wake(1000);
    if (this.model) this.root.add(this.model);
  }
  roomObject(f, r) {
    const h = r.height ?? f.height;
    const shape = new THREE.Shape(r.points.map(P));
    const grp = new THREE.Group();
    grp.userData = { roomId: r.id, floorId: f.id, points: r.points, name: r.name };
    // walls: the room shape pulled up into 3D, shown as glowing edges (+ faint glass sides)
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // lie flat: shape y → world z, extrude downwards…
    geo.translate(0, h, 0); // …then lift so it stands on the floor
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: this.c.accent, transparent: true, opacity: 0.6 }));
    grp.add(edges);
    if (this.q.faces) {
      const glass = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: this.c.accent, transparent: true, opacity: 0.02, side: THREE.DoubleSide, depthWrite: false }));
      grp.add(glass);
    }
    // the floor of the room: this is what glows when something happens there
    const fgeo = new THREE.ShapeGeometry(shape);
    fgeo.rotateX(Math.PI / 2);
    const floor = new THREE.Mesh(fgeo, new THREE.MeshBasicMaterial({ color: this.c.accent, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    floor.position.y = 0.02;
    floor.userData.pick = { floorId: f.id };
    grp.add(floor);
    grp.userData.floorMesh = floor;
    if (this.q.labels) {
      const c = centroid(r.points);
      const label = textSprite(r.name.toUpperCase(), this.c.muted, 0.36);
      label.position.set(c[0], 0.35, c[1]);
      grp.add(label);
    }
    this.roomMeshes.set(r.id, grp);
    return grp;
  }
  openingObject(f, o) {
    const e = openingEnds(f, o);
    if (!e) return null;
    const k = OPENING_KINDS[o.kind] || OPENING_KINDS.door;
    const [y0, y1] = [k.bottom || 0, k.top];
    const pts = [[e.a, y0], [e.b, y0], [e.b, y1], [e.a, y1], [e.a, y0]].map(([[x, z], y]) => new THREE.Vector3(x, y, z));
    const color = o.kind === 'window' ? this.c.window : o.kind === 'arch' ? this.c.muted : this.c.amber;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    line.userData = { openingId: o.id, roomId: o.roomId, kind: o.kind, floorId: f.id };
    this.openingLines.push(line);
    return line;
  }

  /** Structure: stairs climbing to the next floor, inner walls, pillars. Built in the part's own frame, then turned into place. */
  fixtureObject(f, x) {
    const g = new THREE.Group();
    g.userData = { fixtureId: x.id, kind: x.kind };
    const edgeMat = () => new THREE.LineBasicMaterial({ color: this.c.accent, transparent: true, opacity: 0.55 });
    const faceMat = (o) => new THREE.MeshBasicMaterial({ color: this.c.accent, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false });
    const add = (geo, faces = 0.06) => { g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat())); if (this.q.faces && faces) g.add(new THREE.Mesh(geo, faceMat(faces))); };
    const rise = f.height + 0.25, n = stepCount(rise);
    if (x.kind === 'stairs') {
      // side profile of the flight (along, up), pulled out sideways to the stairs' width
      const t = x.d / n, sh = new THREE.Shape();
      sh.moveTo(0, 0);
      for (let k = 0; k < n; k++) { sh.lineTo(k * t, ((k + 1) * rise) / n); sh.lineTo((k + 1) * t, ((k + 1) * rise) / n); }
      sh.lineTo(x.d, 0); sh.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: x.w, bevelEnabled: false });
      geo.translate(0, 0, -x.w / 2);
      // (along, up, across) → (across, up, back-to-front): the flight climbs towards the arrow
      geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, x.d / 2, 0, 0, 0, 1));
      add(geo, 0.1);
    } else if (x.kind === 'spiral') {
      const r = x.w / 2, turn = 1.5 * Math.PI;
      const pole = new THREE.CylinderGeometry(0.06, 0.06, rise, 8); pole.translate(0, rise / 2, 0); add(pole, 0);
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * turn, step = new THREE.BoxGeometry(r, 0.05, Math.max(0.15, (r * turn) / n));
        step.translate(r / 2, ((k + 1) * rise) / n - 0.025, 0);
        step.rotateY(Math.PI / 2 - a);
        add(step, 0.12);
      }
    } else {
      const h = f.height;
      const geo = new THREE.BoxGeometry(x.w, h, x.d); geo.translate(0, h / 2, 0);
      add(geo, x.kind === 'wall' ? 0.18 : 0.25);
    }
    g.rotation.y = -(x.rot * Math.PI) / 180;
    g.position.set(x.x, 0, x.y);
    return g;
  }

  // ---------- heatmap: tint each room's floor by how busy it was ----------
  /** counts: { roomId: n } or null to switch it off. */
  setHeat(counts) { this.heat = counts ? { counts, max: Math.max(0, ...Object.values(counts)) } : null; this.applyHeat(); this.wake(600); }
  applyHeat() { for (const g of this.roomMeshes.values()) { const m = g.userData.floorMesh; if (m) this.restoreFloor(m); } }
  restoreFloor(mesh) {
    const id = mesh.parent?.userData.roomId, lvl = this.heat ? heatLevel(this.heat.counts[id] || 0, this.heat.max) : 0;
    if (lvl) { mesh.material.color.copy(this.c.amber); mesh.material.opacity = heatOpacity(lvl); }
    else { mesh.material.color.copy(this.c.accent); mesh.material.opacity = 0.07; }
  }
  /** Pointing at a room → onHover({ roomId, name, x, y }) (used for the heatmap read-out). */
  hover(e) {
    if (!this.onHover || this.hoverAt > performance.now() - 60) return;
    this.hoverAt = performance.now();
    this.ray.setFromCamera(this.pointer(e), this.camera);
    const meshes = [...this.roomMeshes.values()].filter((g) => g.visible && g.parent?.visible).map((g) => g.userData.floorMesh).filter(Boolean);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    const g = hit?.object.parent;
    const r = this.box.getBoundingClientRect();
    this.onHover(g ? { roomId: g.userData.roomId, name: g.userData.name, x: e.clientX - r.left, y: e.clientY - r.top } : null);
  }

  // ---------- LIVE WORLD: real sun + shadow, sky tint, compass, night vision, weather, cinematic ----------
  /** w = { sun: { azimuth, altitude } | null, northDeg, phase, nv, weather: { kind, precip, cloud, wind } | null, effects } */
  setWorld(w) {
    const nvChanged = !!w.nv !== !!this.nv;
    this.world = w;
    this.nv = !!w.nv;
    this.box.classList.toggle('nv', this.nv);
    if (nvChanged) this.setTheme(); // recolours everything, and rebuilds the world
    else this.buildWorld();
    this.wake(800);
  }
  buildWorld() {
    const w = this.world;
    if (!w || !this.house) return;
    this.worldGroup?.parent?.remove(this.worldGroup);
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    const cx = this.center.x, cz = this.center.z, R = this.size * 0.85 + 4;
    // sky tint on the ground: warm at golden hour, dark blue at night
    const tint = { day: ['#9cc4e4', 0.035], golden: ['#ffb35c', 0.07], twilight: ['#6b74c8', 0.07], night: ['#071226', 0.3] }[w.phase] || null;
    if (tint && !this.nv) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 1.5, 64), new THREE.MeshBasicMaterial({ color: tint[0], transparent: true, opacity: tint[1], depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.set(cx, -0.02, cz);
      this.worldGroup.add(disc);
    }
    // compass: N on the ground
    const [nx, nz] = planDir(0, w.northDeg || 0);
    const n = textSprite('N', this.c.muted, 0.6);
    n.position.set(cx + nx * R, 0.3, cz + nz * R);
    const tick = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx + nx * (R - 1.2), 0.01, cz + nz * (R - 1.2)), new THREE.Vector3(cx + nx * (R - 0.4), 0.01, cz + nz * (R - 0.4))]), new THREE.LineBasicMaterial({ color: this.c.muted, transparent: true, opacity: 0.8 }));
    this.worldGroup.add(n, tick);
    this.compass = n;
    // the sun where it really is, and the shadow the house casts
    this.sunObj = null; this.shadowMesh = null;
    if (w.sun && w.sun.altitude > -0.833) {
      const [sx, sz] = planDir(w.sun.azimuth, w.northDeg || 0), alt = (Math.max(0, w.sun.altitude) * Math.PI) / 180;
      const dist = R * 1.25 + 4, p = new THREE.Vector3(cx + sx * dist * Math.cos(alt), dist * Math.sin(alt) + 0.5, cz + sz * dist * Math.cos(alt));
      const col = new THREE.Color(w.sun.altitude < 6 ? '#ffae5c' : '#ffe2a0');
      const sun = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), new THREE.MeshBasicMaterial({ color: col }));
      sun.position.copy(p);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      halo.position.copy(p); halo.lookAt(cx, 0, cz);
      const label = textSprite(`SUN ${Math.round(w.sun.altitude)}°`, col, 0.32);
      label.position.copy(p).add(new THREE.Vector3(0, 1, 0));
      this.worldGroup.add(sun, halo, label);
      this.sunObj = sun;
      this.buildShadow(shadowVector(w.sun, w.northDeg || 0), w.weather?.cloud ?? 0);
    }
    this.buildWeather();
    this.layout();
  }
  /** One shadow for the whole house, drawn into a picture so overlapping rooms don't double up. */
  buildShadow(sv, cloud) {
    if (!sv) return;
    const polys = [];
    this.house.floors.forEach((f, i) => { const base = this.floorBase(i); for (const r of f.rooms) { const p = shadowPolygon(r.points, base + (r.height ?? f.height), sv); if (p) polys.push(p); } });
    if (!polys.length) return;
    const all = polys.flat(), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const x0 = Math.min(...xs) - 1, y0 = Math.min(...ys) - 1, w = Math.max(...xs) + 1 - x0, h = Math.max(...ys) + 1 - y0;
    const px = Math.min(1024, this.q.faces ? 1024 : 512), sc = px / Math.max(w, h);
    const c = document.createElement('canvas'); c.width = Math.ceil(w * sc); c.height = Math.ceil(h * sc);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; // white = shadow (used as the transparency mask)
    for (const p of polys) { g.beginPath(); p.forEach(([x, y], k) => g[k ? 'lineTo' : 'moveTo']((x - x0) * sc, (y - y0) * sc)); g.closePath(); g.fill(); }
    const strength = Math.max(0.14, (this.nv ? 0.35 : 0.42) * (1 - Math.min(90, cloud) / 110)); // clouds soften shadows
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: strength, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x0 + w / 2, 0.012, y0 + h / 2);
    this.shadowMesh = m;
    this.worldGroup.add(m);
  }
  /** Rain or snow falling over the house, cloud shadows drifting across, lightning in a storm. */
  buildWeather() {
    const wx = this.world?.weather;
    this.rain = null; this.clouds = [];
    if (!wx || this.world.effects === false) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cx = this.center.x, cz = this.center.z, S = this.size * 0.7 + 3, top = this.floorBase(this.house.floors.length) + 5;
    const count = reduced ? 0 : particleCount(this.qName, wx.kind, wx.precip);
    if (count) {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) { pos[i * 3] = cx + (Math.random() * 2 - 1) * S; pos[i * 3 + 1] = Math.random() * top; pos[i * 3 + 2] = cz + (Math.random() * 2 - 1) * S; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const snow = wx.kind === 'snow';
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: snow ? '#f2f6ff' : this.nv ? '#9dffbf' : '#9fc8ff', size: snow ? 0.12 : 0.07, transparent: true, opacity: snow ? 0.85 : 0.55, depthWrite: false }));
      this.worldGroup.add(pts);
      this.rain = { pts, snow, top, cx, cz, S, speed: snow ? 1.2 : 11, drift: (wx.wind || 0) * 0.03 };
    }
    const cloud = wx.cloud ?? 0;
    if (cloud >= 40 && this.world.phase !== 'night' && !reduced) {
      const tex = blobTexture();
      const n = cloud >= 85 ? 5 : cloud >= 65 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const r = S * (0.35 + Math.random() * 0.35);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 1.4), new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.1 + (cloud / 100) * 0.12, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set(cx + (Math.random() * 2 - 1) * S, 0.015, cz + (Math.random() * 2 - 1) * S);
        this.worldGroup.add(m);
        this.clouds.push({ m, v: 0.4 + Math.random() * 0.5 + (wx.wind || 0) * 0.02 });
      }
    }
    this.storm = wx.kind === 'storm' && !reduced ? { next: performance.now() + 4000 } : null;
  }
  animateWorld(now, dt) {
    if (this.rain) {
      const r = this.rain, a = r.pts.geometry.attributes.position, arr = a.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= r.speed * dt * (0.8 + ((i * 7) % 10) / 25);
        if (r.snow) arr[i] += Math.sin(now / 900 + i) * dt * 0.3;
        arr[i] += r.drift * dt;
        if (arr[i + 1] < 0) { arr[i + 1] = r.top; arr[i] = r.cx + (Math.random() * 2 - 1) * r.S; arr[i + 2] = r.cz + (Math.random() * 2 - 1) * r.S; }
      }
      a.needsUpdate = true;
    }
    for (const c of this.clouds || []) { c.m.position.x += c.v * dt; if (c.m.position.x > this.center.x + this.size + 6) c.m.position.x = this.center.x - this.size - 6; }
    if (this.storm && now > this.storm.next) {
      this.storm.next = now + 6000 + Math.random() * 9000;
      this.box.classList.add('lightning');
      setTimeout(() => this.box.classList.remove('lightning'), 180);
    }
    if (this.cine) {
      this.cine.a += dt * 0.12;
      const r = this.size * 1.15 + 7, h = r * 0.5 + 2 + Math.sin(this.cine.a * 0.6) * 1.5;
      this.camera.position.set(this.center.x + Math.cos(this.cine.a) * r, h, this.center.z + Math.sin(this.cine.a) * r);
      this.controls.target.set(this.center.x, 1.2, this.center.z);
    }
  }
  /** CINEMATIC: the camera slowly circles the house (until you touch something). */
  cinematic(on) {
    if (on && !this.cine) {
      const d = this.camera.position.clone().sub(this.center);
      this.flight = null;
      this.cine = { a: Math.atan2(d.z, d.x) };
      if (this.explodeTarget) this.setExplode(false);
    } else if (!on && this.cine) { this.cine = null; this.frame(); }
    this.wake(1000);
  }

  /** Show all floors (-1) or just one; floors above the chosen one are hidden. */
  showFloor(i) { this.floorSel = i; this.layout(); this.frame(i); }
  setExplode(on) { this.explodeTarget = on ? 1 : 0; this.wake(2000); }
  layout(instant = false) {
    if (instant) this.explode = this.explodeTarget;
    this.floorGroups.forEach((g, i) => {
      g.visible = this.floorSel < 0 || i <= this.floorSel;
      const dim = this.floorSel >= 0 && i < this.floorSel;
      g.traverse((o) => { if (o.material && o.userData.baseOpacity == null) o.userData.baseOpacity = o.material.opacity; if (o.material) o.material.opacity = o.userData.baseOpacity * (dim ? 0.25 : 1); });
      g.position.y = g.userData.base + i * this.explode * 3.2;
    });
    if (this.shadowMesh) this.shadowMesh.visible = this.explode < 0.05 && (this.floorSel < 0 || this.floorSel === this.floorGroups.length - 1);
  }

  // ---------- Agents ----------
  setAgents(agents) {
    this.agents = agents;
    for (const m of this.markers.values()) m.parent?.remove(m);
    this.markers.clear();
    if (!this.house) return;
    for (const a of agents) {
      const p = a.place;
      const fg = p && this.floorGroups.find((g) => g.userData.floorId === p.floorId);
      if (!fg) continue;
      const col = !a.online ? this.c.muted : this.c.accent;
      const m = new THREE.Group();
      m.userData = { agentId: a.id, floorId: p.floorId, x: p.x, y: p.y };
      // a plain position marker: a small square head on a thin stalk, with a ring on the floor
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color: col }));
      pin.position.y = 1.4; pin.userData.agentId = a.id;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 }));
      beam.position.y = 0.65;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.26, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
      // an invisible, bigger target so the marker is easy to click/tap
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.y = 1.1; hit.userData.agentId = a.id;
      m.add(pin, beam, ring, hit);
      const label = textSprite(a.codename, col, 0.32);
      label.position.y = 1.85;
      m.add(label);
      m.position.set(p.x, 0, p.y);
      fg.add(m);
      this.markers.set(a.id, m);
    }
  }
  placeMode(agentId) { this.placing = agentId; this.box.classList.toggle('placing', !!agentId); }

  // ---------- live effects ----------
  /** Something happened at an Agent: light its room, flash doors, ripple for sound… */
  event(ev) {
    const m = this.markers.get(ev.agentId);
    if (!m) return;
    const floor = this.house.floors.find((f) => f.id === m.userData.floorId);
    const room = floor?.rooms.find((r) => pointInPolygon([m.userData.x, m.userData.y], r.points));
    const red = ev.level === 'alert' || /nobody/.test(ev.message || '');
    const color = red ? this.c.red : ev.kind === 'light' ? new THREE.Color('#fff3a0') : this.c.amber;
    if (room && ['motion', 'door', 'light', 'knock', 'sound'].includes(ev.kind)) this.effects.push({ kind: 'room', mesh: this.roomMeshes.get(room.id)?.userData.floorMesh, color, t0: performance.now(), dur: ev.kind === 'motion' ? 4000 : 2500 });
    if (ev.kind === 'door' && room) for (const l of this.openingLines) if (l.userData.roomId === room.id && OPENING_KINDS[l.userData.kind]?.opens) this.effects.push({ kind: 'flash', obj: l, t0: performance.now(), dur: 2500 });
    if (ev.kind === 'sound' || ev.kind === 'knock') {
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(m.userData.x, 0.08, m.userData.y); ring.scale.setScalar(0.1);
        m.parent.add(ring);
        this.effects.push({ kind: 'ripple', obj: ring, t0: performance.now() + i * 350, dur: 1800 });
      }
    }
    this.effects.push({ kind: 'marker', obj: m, t0: performance.now(), dur: 2000 });
  }
  /** Fly the camera to an Agent (or a room). */
  flyTo(agentId) {
    const m = this.markers.get(agentId);
    if (!m) return false;
    const i = this.floorGroups.findIndex((g) => g.userData.floorId === m.userData.floorId);
    if (this.floorSel >= 0 && this.floorSel < i) this.showFloor(i);
    const target = new THREE.Vector3(m.userData.x, this.floorGroups[i].position.y + 0.5, m.userData.y);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flight = { from: this.camera.position.clone(), fromT: this.controls.target.clone(), to: target.clone().add(dir.multiplyScalar(7)), toT: target, t0: performance.now(), dur: 1200 };
    return true;
  }
  frame(i = -1) {
    const y = i >= 0 && this.floorGroups[i] ? this.floorGroups[i].position.y : 0;
    const d = this.size * 1.25 + 4;
    this.controls.target.set(this.center.x, y + 1, this.center.z);
    this.camera.position.set(this.center.x + d * 0.6, y + d * 0.75, this.center.z + d * 0.9);
    this.controls.update();
  }

  // ---------- imported 3D scan ----------
  async setModel(file, info) {
    if (this.model) { this.root.remove(this.model); this.model = null; }
    if (!file || !info) return;
    const url = URL.createObjectURL(file);
    try {
      let obj;
      if (info.kind === 'glb' || info.kind === 'gltf') { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); obj = (await new GLTFLoader().loadAsync(url)).scene; }
      else if (info.kind === 'obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); obj = await new OBJLoader().loadAsync(url); }
      else { const { USDZLoader } = await import('three/addons/loaders/USDZLoader.js'); obj = await new USDZLoader().loadAsync(url); }
      // hologram look: every surface becomes a faint wireframe in the theme colour
      const mat = new THREE.MeshBasicMaterial({ color: this.c.accent, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false });
      obj.traverse((o) => { if (o.isMesh) o.material = mat; });
      const wrap = new THREE.Group();
      wrap.add(obj);
      wrap.scale.setScalar(info.scale || 1);
      wrap.rotation.y = -((info.rot || 0) * Math.PI) / 180;
      const fi = Math.max(0, this.house.floors.findIndex((f) => f.id === info.floorId));
      wrap.position.set(info.x || 0, this.floorBase(fi), info.y || 0);
      wrap.userData.model = true;
      this.model = wrap;
      this.root.add(wrap);
    } catch (e) { console.warn('[map3d] couldn’t load the 3D scan', e); } finally { URL.revokeObjectURL(url); }
  }

  // ---------- input ----------
  pointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  /** Where on a floor did the user point? Picks the visible floor under the pointer. */
  floorPoint(e) {
    this.ray.setFromCamera(this.pointer(e), this.camera);
    const order = this.floorGroups.map((g, i) => i).filter((i) => this.floorGroups[i].visible).reverse();
    for (const i of order) {
      const g = this.floorGroups[i];
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -g.position.y);
      const hit = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) continue;
      const f = this.house.floors[i];
      if (f.rooms.some((r) => pointInPolygon([hit.x, hit.z], r.points)) || i === 0 || this.floorSel === i) return { floorId: f.id, x: Math.round(hit.x * 100) / 100, y: Math.round(hit.z * 100) / 100 };
    }
    return null;
  }
  click(e) {
    if (this.placing) {
      const hit = this.floorPoint(e);
      const id = this.placing;
      this.placeMode(null);
      if (hit) this.onPlace?.(id, hit.floorId, hit.x, hit.y);
      return;
    }
    this.ray.setFromCamera(this.pointer(e), this.camera);
    const pins = [...this.markers.values()].flatMap((m) => [m.children[0], m.children[3]]);
    const hit = this.ray.intersectObjects(pins, false)[0];
    if (hit) this.onPick?.(hit.object.userData.agentId);
  }

  // ---------- drawing ----------
  resize() {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.wake(500);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.box.isConnected || !this.box.offsetParent) return;
    const busy = now < (this.activeUntil || 0) || this.effects.length || this.flight || this.cine || Math.abs(this.explode - this.explodeTarget) > 0.001;
    const ambient = !busy && (this.rain || this.clouds?.length); // rain, snow and clouds tick over more gently
    if (now - this.last < 1000 / (busy ? this.q.fps : ambient ? Math.min(20, this.q.fps) : 4)) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (Math.abs(this.explode - this.explodeTarget) > 0.001) {
      const before = this.explode;
      this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 5);
      // keep the middle of the (taller) house in view while the floors pull apart
      const lift = ((this.explode - before) * (this.floorGroups.length - 1) * 3.2) / 2;
      if (this.floorSel < 0) { this.controls.target.y += lift; this.camera.position.y += lift; }
      this.layout();
    }
    if (this.flight) {
      const k = Math.min(1, (now - this.flight.t0) / this.flight.dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, e);
      this.controls.target.lerpVectors(this.flight.fromT, this.flight.toT, e);
      if (k >= 1) this.flight = null;
    }
    if (this.fx && this.sweep) this.sweep.rotation.z -= dt * 1.2;
    const t = now / 1000;
    void t; // markers stay still
    this.effects = this.effects.filter((fx) => {
      const k = (now - fx.t0) / fx.dur;
      if (k < 0) return true;
      if (k >= 1) {
        if (fx.kind === 'room' && fx.mesh) this.restoreFloor(fx.mesh);
        if (fx.kind === 'flash') fx.obj.material.color.copy(this.c.amber);
        if (fx.kind === 'ripple') { fx.obj.parent?.remove(fx.obj); fx.obj.geometry.dispose(); }
        if (fx.kind === 'marker') fx.obj.scale.setScalar(1);
        return false;
      }
      const pulse = 0.5 + 0.5 * Math.sin(k * Math.PI * 6);
      if (fx.kind === 'room' && fx.mesh) { fx.mesh.material.color.copy(fx.color); fx.mesh.material.opacity = 0.12 + 0.4 * pulse * (1 - k); }
      if (fx.kind === 'flash') fx.obj.material.color.copy(pulse > 0.5 ? this.c.red : this.c.amber);
      if (fx.kind === 'ripple') { fx.obj.scale.setScalar(0.2 + k * 3.5); fx.obj.material.opacity = 0.8 * (1 - k); }
      if (fx.kind === 'marker') fx.obj.scale.setScalar(1 + 0.35 * Math.sin(k * Math.PI));
      return true;
    });
    this.animateWorld(now, dt);
    this.idle?.(now);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frames = (this.frames || 0) + 1;
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (window.__map3d === this) window.__map3d = null;
  }
}

/** A soft round blob (cloud shadows). */
let blob = null;
function blobTexture() {
  if (blob) return blob;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  blob = new THREE.CanvasTexture(c);
  return blob;
}

/** A text label that always faces the camera. */
function textSprite(text, color, height) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = '600 44px Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = 64;
  g.font = font;
  g.fillStyle = `#${color.getHexString()}`;
  g.shadowBlur = 0;
  g.textBaseline = 'middle';
  g.fillText(text, 12, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  s.scale.set((height * w) / 64, height, 1);
  s.renderOrder = 10;
  return s;
}
