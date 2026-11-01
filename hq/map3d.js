// THE 3D SITE MAP: a clean architectural model of the house — flat-shaded rooms with subtle edges,
// lit by the real sun for your location. Colour is used ONLY for status: a room turns amber/red when
// something happens there (and for the heatmap). Perspective or isometric view; switch floors,
// "explode" the floors apart, Agents as plain markers. Built with Three.js (vendor/three).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { centroid, openingEnds, pointInPolygon, bbox, stepCount, OPENING_KINDS, ZONE_TYPES, allPoints } from '../shared/house.js';
import { sensorsOn } from '../shared/coverage.js';
import { heatLevel, heatOpacity } from '../shared/replay.js';
import { planDir, shadowVector, shadowPolygon } from '../shared/world.js';

const QUALITY = {
  low: { pixelRatio: 1, antialias: false, fps: 24, labels: false, faces: false },
  medium: { pixelRatio: Math.min(1.5, window.devicePixelRatio || 1), antialias: true, fps: 40, labels: true, faces: true },
  high: { pixelRatio: Math.min(2, window.devicePixelRatio || 1), antialias: true, fps: 60, labels: true, faces: true },
};
export const QUALITIES = [['low', 'Low (older laptops)'], ['medium', 'Medium'], ['high', 'High']];
export const getQuality = () => { try { return QUALITY[localStorage.getItem('sentinel.q3d')] ? localStorage.getItem('sentinel.q3d') : 'medium'; } catch { return 'medium'; } };
export const setQuality = (q) => { try { localStorage.setItem('sentinel.q3d', q); } catch { /* ignore */ } };
export function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

const css = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return new THREE.Color(v || fb); };
const P = ([x, y]) => new THREE.Vector2(x, y); // plan (x, y) → shape coords; the shape is laid flat so plan y becomes 3D z

export class Map3D {
  /** box: the element to draw into. opts.onPick(agentId) when a marker is clicked; opts.onPlace(id, floorId, x, y) in place mode. */
  constructor(box, { onPick, onPlace, onHover, quality = getQuality(), iso = false } = {}) {
    this.box = box; this.onPick = onPick; this.onPlace = onPlace; this.onHover = onHover;
    this.q = QUALITY[quality] || QUALITY.medium; this.qName = quality;
    this.house = null; this.agents = []; this.floorSel = -1; this.explode = 0; this.explodeTarget = 0;
    this.effects = []; this.markers = new Map(); this.roomMeshes = new Map(); this.floorGroups = []; this.openingLines = [];
    this.placing = null; this.model = null; this.heat = null; this.iso = iso;

    this.renderer = new THREE.WebGLRenderer({ antialias: this.q.antialias, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.renderer.domElement.className = 'map3d-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D map of the house. Drag to turn, scroll to zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    box.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 500);
    this.camera = iso ? this.ortho : this.persp;
    this.camera.position.set(14, 14, 18);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.1, maxPolarAngle: Math.PI * 0.49, minDistance: 3, maxDistance: 120, minZoom: 0.4, maxZoom: 6 });
    this.controls.addEventListener('start', () => { this.flight = null; this.lastTouch = performance.now(); this.wake(4000); });
    this.controls.addEventListener('change', () => this.wake(800));
    this.renderer.domElement.addEventListener('pointermove', (e) => { this.wake(1500); this.hover(e); });
    this.renderer.domElement.addEventListener('pointerleave', () => this.onHover?.(null));
    this.renderer.domElement.addEventListener('wheel', () => this.wake(1500), { passive: true });
    // lighting: soft sky light + one directional "sun" (moved to the real sun when the location is known)
    this.hemi = new THREE.HemisphereLight(0xe9eef4, 0x1a1f26, 1.15);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
    this.sunLight.position.set(12, 20, 8);
    this.scene.add(this.hemi, this.sunLight, this.sunLight.target);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.ground = new THREE.Group();
    this.scene.add(this.ground);
    this.ray = new THREE.Raycaster();
    this.colors();
    this.buildGround();

    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) this.click(e); down = null; });
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

  wake(ms = 1500) { this.activeUntil = Math.max(this.activeUntil || 0, performance.now() + ms); }

  colors() {
    this.c = {
      accent: css('--green', '#6f9fc8'), amber: css('--amber', '#c9952e'), red: css('--red', '#d64545'), muted: css('--muted', '#8995a2'),
      text: css('--text', '#d6dde5'), dim: css('--dim', '#5b6672'),
      floor: new THREE.Color('#3b4551'), wall: new THREE.Color('#9aa6b3'), edge: new THREE.Color('#aab5c1'), fixture: new THREE.Color('#6c7783'),
      window: new THREE.Color('#9fb6ca'), door: new THREE.Color('#c9d1da'),
    };
  }
  setTheme() { this.colors(); this.buildGround(); if (this.house) this.setHouse(this.house, true); this.setAgents(this.agents); }
  setQuality(name) {
    this.qName = name; this.q = QUALITY[name] || QUALITY.medium;
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.resize();
    if (this.house) this.setHouse(this.house, true);
    this.setAgents(this.agents);
  }
  /** Perspective ↔ isometric (orthographic, viewed at 35° from the corner). */
  setIso(on) {
    this.iso = !!on;
    const target = this.controls.target.clone();
    this.camera = this.iso ? this.ortho : this.persp;
    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.resize();
    this.frame(this.floorSel);
    this.wake(800);
  }

  buildGround() {
    this.ground.clear();
    const grid = new THREE.GridHelper(80, 80, this.c.dim, this.c.dim);
    grid.material.transparent = true; grid.material.opacity = 0.12; grid.material.depthWrite = false;
    grid.position.y = -0.01;
    this.ground.add(grid);
  }

  // ---------- the house ----------
  floorBase(i) { let y = 0; for (let k = 0; k < i; k++) y += this.house.floors[k].height + 0.25; return y; }
  setHouse(house, keepView = false) {
    this.house = house;
    this.root.clear();
    this.roomMeshes.clear(); this.floorGroups = []; this.openingLines = [];
    const pts = allPoints(house);
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
    this.siteGroup = house.site ? this.siteObject(house.site) : null;
    if (this.siteGroup) this.root.add(this.siteGroup);
    this.buildRoof();
    this.layout(true);
    this.applyHeat();
    this.setXray(this.xray);
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
    // walls: the room outline pulled up, as light translucent planes with crisp edges
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, h, 0);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: this.c.edge, transparent: true, opacity: 0.55 }));
    edges.userData.wall = true;
    grp.add(edges);
    if (this.q.faces) { const w = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: this.c.wall, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })); w.userData.wall = true; grp.add(w); }
    // the floor: solid, flat-shaded. It changes colour only to show status (activity / alerts / heatmap).
    const fgeo = new THREE.ShapeGeometry(shape);
    fgeo.rotateX(Math.PI / 2);
    const floor = new THREE.Mesh(fgeo, new THREE.MeshLambertMaterial({ color: this.c.floor, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    floor.position.y = 0.02;
    floor.userData.pick = { floorId: f.id };
    grp.add(floor);
    grp.userData.floorMesh = floor;
    if (this.q.labels) {
      const c = centroid(r.points);
      const label = textSprite(r.name, this.c.text, 0.3);
      label.position.set(c[0], 0.3, c[1]);
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
    const color = o.kind === 'window' ? this.c.window : o.kind === 'arch' ? this.c.dim : this.c.door;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    line.userData = { openingId: o.id, roomId: o.roomId, kind: o.kind, floorId: f.id, base: color.clone() };
    this.openingLines.push(line);
    return line;
  }
  /** Structure: stairs climbing to the next floor, inner walls, pillars. */
  fixtureObject(f, x) {
    const g = new THREE.Group();
    g.userData = { fixtureId: x.id, kind: x.kind };
    const solid = new THREE.MeshLambertMaterial({ color: this.c.fixture });
    const add = (geo) => { g.add(new THREE.Mesh(geo, solid)); g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: this.c.edge, transparent: true, opacity: 0.35 }))); };
    const rise = f.height + 0.25, n = stepCount(rise);
    if (x.kind === 'stairs') {
      const t = x.d / n, sh = new THREE.Shape();
      sh.moveTo(0, 0);
      for (let k = 0; k < n; k++) { sh.lineTo(k * t, ((k + 1) * rise) / n); sh.lineTo((k + 1) * t, ((k + 1) * rise) / n); }
      sh.lineTo(x.d, 0); sh.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: x.w, bevelEnabled: false });
      geo.translate(0, 0, -x.w / 2);
      geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, x.d / 2, 0, 0, 0, 1));
      add(geo);
    } else if (x.kind === 'spiral') {
      const r = x.w / 2, turn = 1.5 * Math.PI;
      const pole = new THREE.CylinderGeometry(0.06, 0.06, rise, 8); pole.translate(0, rise / 2, 0); add(pole);
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * turn, step = new THREE.BoxGeometry(r, 0.05, Math.max(0.15, (r * turn) / n));
        step.translate(r / 2, ((k + 1) * rise) / n - 0.025, 0);
        step.rotateY(Math.PI / 2 - a);
        add(step);
      }
    } else {
      const geo = new THREE.BoxGeometry(x.w, f.height, x.d); geo.translate(0, f.height / 2, 0);
      add(geo);
    }
    g.rotation.y = -(x.rot * Math.PI) / 180;
    g.position.set(x.x, 0, x.y);
    return g;
  }

  // ---------- the grounds: zones, garage/shed, fences, gates, trees ----------
  siteObject(site) {
    const g = new THREE.Group();
    g.userData = { site: true };
    const ZC = { driveway: '#2B3542', path: '#2E3846', front: '#1B2A22', garden: '#1A2B21', lawn: '#1D2F23', patio: '#2A303A', garage: '#262E3A', shed: '#262E3A', plot: '#0E151F', other: '#222A35' };
    for (const z of [...site.rooms].sort((a, b) => (a.type === 'plot' ? -1 : 0) - (b.type === 'plot' ? -1 : 0))) {
      const shape = new THREE.Shape(z.points.map(P));
      const geo = new THREE.ShapeGeometry(shape); geo.rotateX(Math.PI / 2);
      const slab = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(ZC[z.type] || ZC.other), transparent: true, opacity: z.type === 'plot' ? 0.5 : 0.85, side: THREE.DoubleSide, depthWrite: false }));
      slab.position.y = z.type === 'plot' ? 0.003 : 0.008;
      slab.userData = { zoneId: z.id, base: slab.material.color.clone() };
      g.add(slab);
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(z.points.map(([x, y]) => new THREE.Vector3(x, 0.012, y))), new THREE.LineBasicMaterial({ color: this.c.edge, transparent: true, opacity: z.type === 'plot' ? 0.35 : 0.22 }));
      g.add(outline);
      const height = ZONE_TYPES[z.type]?.building;
      if (height) { // a small building: translucent walls and a flat roof line
        const eg = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }); eg.rotateX(Math.PI / 2); eg.translate(0, height, 0);
        g.add(new THREE.LineSegments(new THREE.EdgesGeometry(eg, 30), new THREE.LineBasicMaterial({ color: this.c.edge, transparent: true, opacity: 0.45 })));
        if (this.q.faces) g.add(new THREE.Mesh(eg, new THREE.MeshLambertMaterial({ color: this.c.wall, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })));
      }
      if (this.q.labels && z.type !== 'plot') { const c = centroid(z.points); const l = textSprite(z.name.toUpperCase(), this.c.dim, 0.26); l.position.set(c[0], (height || 0) + 0.25, c[1]); g.add(l); }
      this.zoneMeshes ||= new Map(); this.zoneMeshes.set(z.id, slab);
    }
    for (const o of site.openings || []) { const m = this.openingObject(site, o); if (m) g.add(m); }
    const treeMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#2C4034'), transparent: true, opacity: 0.85 }), trunkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#3A3A3A') });
    for (const x of site.fixtures || []) {
      if (x.kind === 'tree') {
        const r = Math.max(0.3, Math.min(x.w, x.d) / 2), crown = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.2, 7), treeMat);
        crown.position.set(x.x, 0.6 + r * 1.1, x.y);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.6, 6), trunkMat); trunk.position.set(x.x, 0.3, x.y);
        g.add(crown, trunk);
      } else if (x.kind === 'fence') {
        const geo = new THREE.BoxGeometry(x.w, 1.2, Math.max(0.03, x.d)); geo.translate(0, 0.6, 0);
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: this.c.fixture, transparent: true, opacity: 0.35, depthWrite: false }));
        m.rotation.y = -(x.rot * Math.PI) / 180; m.position.set(x.x, 0, x.y);
        g.add(m);
      }
    }
    return g;
  }
  /** A flat roof over the top of each floor's rooms (toggle). */
  buildRoof() {
    this.roofGroup = new THREE.Group();
    if (!this.house) return;
    const top = this.house.floors.length - 1, f = this.house.floors[top];
    for (const r of f.rooms) {
      const geo = new THREE.ShapeGeometry(new THREE.Shape(r.points.map(P))); geo.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: this.c.wall, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      m.position.y = (r.height ?? f.height) + 0.01;
      this.roofGroup.add(m);
    }
    this.floorGroups[top]?.add(this.roofGroup);
    this.roofGroup.visible = !!this.roof;
  }
  setRoof(on) { this.roof = !!on; if (this.roofGroup) this.roofGroup.visible = this.roof; this.wake(600); }
  /** X-ray: walls almost disappear so you can see inside every room. */
  setXray(on) {
    this.xray = !!on;
    for (const g of this.floorGroups) g.traverse((o) => { if (o.userData.wall && o.material) { o.userData.xrayBase ??= o.material.opacity; o.material.opacity = o.userData.xrayBase * (this.xray ? 0.25 : 1); } });
    this.wake(600);
  }
  /** Each Agent's view: a soft translucent cone (camera) or circle (microphone/door) on the floor. */
  buildCones() {
    for (const c of this.cones3d || []) { c.parent?.remove(c); c.geometry.dispose(); }
    this.cones3d = [];
    if (!this.house || this.cones === false) return;
    this.house.floors.forEach((f, i) => {
      for (const s of sensorsOn(f, this.agents)) {
        const outside = !s.roomId;
        const mat = new THREE.MeshBasicMaterial({ color: this.c.accent, transparent: true, opacity: s.online ? (outside ? 0.1 : 0.13) : 0.05, side: THREE.DoubleSide, depthWrite: false });
        const range = s.range * (outside ? 1.6 : 1);
        const geo = s.type === 'camera' ? new THREE.CircleGeometry(range, 28, ((90 - s.dir - s.fov / 2) * Math.PI) / 180, (s.fov * Math.PI) / 180) : new THREE.CircleGeometry(s.type === 'tripwire' ? 1 : range, 32);
        geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(s.x, 0.04, s.y);
        m.userData = { agentId: s.id };
        this.floorGroups[i].add(m);
        this.cones3d.push(m);
      }
    });
  }
  /** Coverage overlay: watched floor area shaded, outside doors/windows/gates with no sensor in amber, and a suggested spot. */
  setCoverage(cov) {
    this.clearCoverage();
    if (!cov || !this.house) return;
    const cell = new THREE.PlaneGeometry(1, 1); cell.rotateX(-Math.PI / 2);
    for (const f of cov.floors) {
      const fg = f.id === 'site' ? this.floorGroups[0] : this.floorGroups.find((g) => g.userData.floorId === f.id);
      if (!fg) continue;
      if (f.cells.length) {
        const inst = new THREE.InstancedMesh(cell, new THREE.MeshBasicMaterial({ color: this.c.accent, transparent: true, opacity: 0.28, depthWrite: false }), f.cells.length);
        const m = new THREE.Matrix4();
        f.cells.forEach(([x, y], k) => { m.makeScale(f.cell * 0.94, 1, f.cell * 0.94); m.setPosition(x, 0.05, y); inst.setMatrixAt(k, m); });
        const holder = new THREE.Group(); holder.add(inst); fg.add(holder); this.covParts = [...(this.covParts || []), holder];
      }
      for (const e of f.entries.filter((x) => x.unmonitored)) {
        const pts = [[e.a, 0.05], [e.b, 0.05], [e.b, 2.1], [e.a, 2.1], [e.a, 0.05]].map(([[x, z], y]) => new THREE.Vector3(x, y, z));
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: this.c.amber }));
        const holder = new THREE.Group(); holder.add(l); fg.add(holder); this.covParts = [...(this.covParts || []), holder];
      }
    }
    if (cov.suggestion) {
      const fg = this.floorGroups.find((g) => g.userData.floorId === cov.suggestion.floorId) || this.floorGroups[0];
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 32), new THREE.MeshBasicMaterial({ color: this.c.accent, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(cov.suggestion.x, 0.06, cov.suggestion.y);
      const l = textSprite('SUGGESTED AGENT', this.c.accent, 0.24); l.position.set(cov.suggestion.x, 0.5, cov.suggestion.y);
      const holder = new THREE.Group(); holder.add(ring, l); fg.add(holder); this.covParts = [...(this.covParts || []), holder];
    }
    this.covOn = true;
    this.wake(600);
  }
  clearCoverage() { for (const h of this.covParts || []) h.parent?.remove(h); this.covParts = []; this.covOn = false; this.wake(400); }
  /** Camera presets: overview, top-down plan, front, garden, garage/shed (from the outside zones). */
  preset(name) {
    if (!this.center) return false;
    const zonePt = (types) => { const z = (this.house?.site?.rooms || []).filter((r) => types.includes(r.type)); if (!z.length) return null; const c = centroid(z.flatMap((r) => r.points).length >= 3 ? z.sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type))[0].points : z[0].points); return new THREE.Vector3(c[0], 0, c[1]); };
    let target = this.center.clone(), from;
    if (name === 'overview') { this.showFloor(-1); return true; }
    if (name === 'top') { target.y = 0; from = target.clone().add(new THREE.Vector3(0.01, this.size * 1.9 + 6, 0.01)); }
    else {
      const p = zonePt({ front: ['driveway', 'front', 'path'], garden: ['garden', 'lawn', 'patio'], garage: ['garage', 'shed'] }[name] || []);
      if (!p) return false;
      const out = p.clone().sub(this.center); out.y = 0; if (out.length() < 0.1) out.set(0, 0, 1); out.normalize();
      target = p; from = p.clone().add(out.multiplyScalar(this.size * 0.9 + 4)).add(new THREE.Vector3(0, this.size * 0.55 + 3, 0));
    }
    this.flight = { from: this.camera.position.clone(), fromT: this.controls.target.clone(), to: from, toT: target, t0: performance.now(), dur: 1100 };
    this.wake(1300);
    return true;
  }
  /** Idle: turn slowly; when something happens, fly to it. */
  setSpin(on) { this.spin = !!on; this.lastTouch = performance.now(); }
  /** Weather on the model: a light mist when foggy/raining, fine rain streaks when it's raining. */
  setWeather(kind) {
    const wet = ['rain', 'drizzle', 'showers', 'storm', 'snow'].includes(kind), fog = kind === 'fog' || wet;
    this.scene.fog = fog ? new THREE.Fog(new THREE.Color('#0B111A'), (this.size || 10) * 1.2, (this.size || 10) * 4 + 30) : null;
    this.rain?.parent?.remove(this.rain); this.rain = null;
    if (wet && this.q.faces && this.center) {
      const n = 260, R = (this.size || 10) * 0.9, pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) { const x = this.center.x + (Math.random() - 0.5) * R * 2, z = this.center.z + (Math.random() - 0.5) * R * 2, y = Math.random() * 12; pos.set([x, y, z, x - 0.04, y - 0.45, z], i * 6); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: this.c.muted, transparent: true, opacity: kind === 'snow' ? 0.35 : 0.22 }));
      this.scene.add(this.rain);
    }
    this.weatherKind = kind;
    this.wake(600);
  }

  // ---------- heatmap: tint each room's floor by how busy it was ----------
  setHeat(counts) { this.heat = counts ? { counts, max: Math.max(0, ...Object.values(counts)) } : null; this.applyHeat(); this.wake(600); }
  applyHeat() { for (const g of this.roomMeshes.values()) { const m = g.userData.floorMesh; if (m) this.restoreFloor(m); } }
  /** A floor back to its resting colour: neutral, or its heatmap tint. */
  restoreFloor(mesh) {
    const id = mesh.parent?.userData.roomId, lvl = this.heat ? heatLevel(this.heat.counts[id] || 0, this.heat.max) : 0;
    mesh.material.color.copy(this.c.floor);
    if (lvl) mesh.material.color.lerp(this.c.amber, Math.min(1, heatOpacity(lvl) * 1.5));
    mesh.material.opacity = 0.95;
  }
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

  // ---------- the real sun: light direction, the house's shadow, a compass ----------
  /** w = { sun: { azimuth, altitude } | null, northDeg, phase, cloud } */
  setWorld(w) { this.world = w; this.buildWorld(); this.wake(800); }
  buildWorld() {
    const w = this.world;
    if (!w || !this.house) return;
    this.worldGroup?.parent?.remove(this.worldGroup);
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    const cx = this.center.x, cz = this.center.z, R = this.size * 0.85 + 4;
    const [nx, nz] = planDir(0, w.northDeg || 0);
    const n = textSprite('N', this.c.muted, 0.5);
    n.position.set(cx + nx * R, 0.3, cz + nz * R);
    const tick = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx + nx * (R - 1.2), 0.01, cz + nz * (R - 1.2)), new THREE.Vector3(cx + nx * (R - 0.4), 0.01, cz + nz * (R - 0.4))]), new THREE.LineBasicMaterial({ color: this.c.muted }));
    this.worldGroup.add(n, tick);
    this.compass = n;
    this.shadowMesh = null; this.sunObj = null;
    const up = w.sun && w.sun.altitude > -0.833;
    if (up) {
      const [sx, sz] = planDir(w.sun.azimuth, w.northDeg || 0), alt = (Math.max(2, w.sun.altitude) * Math.PI) / 180;
      this.sunLight.position.set(cx + sx * 30 * Math.cos(alt), 30 * Math.sin(alt), cz + sz * 30 * Math.cos(alt));
      this.sunLight.target.position.set(cx, 0, cz);
      this.sunLight.intensity = 0.5 + 0.8 * Math.min(1, w.sun.altitude / 30) * (1 - Math.min(90, w.cloud || 0) / 160);
      this.hemi.intensity = 1.15; this.hemi.color.set(0xe9eef4);
      this.sunObj = this.sunLight;
      this.buildShadow(shadowVector(w.sun, w.northDeg || 0), w.cloud || 0);
    } else if (w.sun) {
      // after sunset: dimmer, cooler light (no gimmicks — just night)
      this.sunLight.intensity = 0.2; this.hemi.intensity = 0.7; this.hemi.color.set(0xb8c8e0);
    }
    this.layout();
  }
  buildShadow(sv, cloud) {
    if (!sv) return;
    const polys = [];
    this.house.floors.forEach((f, i) => { const base = this.floorBase(i); for (const r of f.rooms) { const p = shadowPolygon(r.points, base + (r.height ?? f.height), sv); if (p) polys.push(p); } });
    if (!polys.length) return;
    const all = polys.flat(), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const x0 = Math.min(...xs) - 1, y0 = Math.min(...ys) - 1, w = Math.max(...xs) + 1 - x0, h = Math.max(...ys) + 1 - y0;
    const px = this.q.faces ? 1024 : 512, sc = px / Math.max(w, h);
    const c = document.createElement('canvas'); c.width = Math.ceil(w * sc); c.height = Math.ceil(h * sc);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    for (const p of polys) { g.beginPath(); p.forEach(([x, y], k) => g[k ? 'lineTo' : 'moveTo']((x - x0) * sc, (y - y0) * sc)); g.closePath(); g.fill(); }
    const strength = Math.max(0.12, 0.35 * (1 - Math.min(90, cloud) / 110));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: strength, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x0 + w / 2, 0.012, y0 + h / 2);
    this.shadowMesh = m;
    this.worldGroup.add(m);
  }

  showFloor(i) { this.floorSel = i; this.layout(); this.frame(i); }
  setExplode(on) { this.explodeTarget = on ? 1 : 0; this.wake(2000); }
  layout(instant = false) {
    if (instant) this.explode = this.explodeTarget;
    this.floorGroups.forEach((g, i) => {
      g.visible = this.floorSel < 0 || i <= this.floorSel;
      const dim = this.floorSel >= 0 && i < this.floorSel;
      g.traverse((o) => { if (o.material && o.userData.baseOpacity == null) o.userData.baseOpacity = o.material.opacity; if (o.material) o.material.opacity = o.userData.baseOpacity * (dim ? 0.3 : 1); });
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
      const col = a.online ? this.c.text : this.c.dim;
      const m = new THREE.Group();
      m.userData = { agentId: a.id, floorId: p.floorId, x: p.x, y: p.y };
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 20), new THREE.MeshLambertMaterial({ color: col }));
      pin.position.y = 1.35; pin.userData.agentId = a.id;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
      pole.position.y = 0.65;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.22, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.y = 1.1; hit.userData.agentId = a.id;
      m.add(pin, pole, ring, hit);
      const label = textSprite(a.codename, col, 0.26);
      label.position.y = 1.7;
      m.add(label);
      m.position.set(p.x, 0, p.y);
      fg.add(m);
      this.markers.set(a.id, m);
    }
    this.buildCones();
  }
  placeMode(agentId) { this.placing = agentId; this.box.classList.toggle('placing', !!agentId); }

  // ---------- live status ----------
  /** Something happened at an Agent: its room turns amber (activity) or red (alert) for a few seconds. */
  event(ev) {
    const m = this.markers.get(ev.agentId);
    if (!m) return;
    const floor = this.house.floors.find((f) => f.id === m.userData.floorId);
    const room = floor?.rooms.find((r) => pointInPolygon([m.userData.x, m.userData.y], r.points));
    const color = ev.level === 'alert' ? this.c.red : this.c.amber;
    if (room && ['motion', 'door', 'light', 'knock', 'sound'].includes(ev.kind)) this.effects.push({ kind: 'room', mesh: this.roomMeshes.get(room.id)?.userData.floorMesh, color, t0: performance.now(), dur: ev.kind === 'motion' ? 4000 : 2500 });
    if (ev.kind === 'door' && room) for (const l of this.openingLines) if (l.userData.roomId === room.id && OPENING_KINDS[l.userData.kind]?.opens) this.effects.push({ kind: 'flash', obj: l, color, t0: performance.now(), dur: 2500 });
    if (ev.kind === 'sound' || ev.kind === 'knock') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.95, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(m.userData.x, 0.06, m.userData.y); ring.scale.setScalar(0.1);
      m.parent.add(ring);
      this.effects.push({ kind: 'ripple', obj: ring, t0: performance.now(), dur: 1600 });
    }
    this.effects.push({ kind: 'marker', obj: m, color, t0: performance.now(), dur: 2500 });
    const cls = ev.data?.class;
    if (cls) { // an outside detection: a small labelled marker where it was seen
      const a = this.agents.find((x) => x.id === ev.agentId), dir = Number.isFinite(a?.place?.dir) ? a.place.dir : 0, d = 3;
      const px = m.userData.x + Math.sin((dir * Math.PI) / 180) * d, pz = m.userData.y - Math.cos((dir * Math.PI) / 180) * d;
      const lbl = textSprite(`${String(cls).toUpperCase()} · ${new Date(ev.ts || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, color, 0.26);
      lbl.position.set(px, 0.9, pz);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); dot.rotation.x = -Math.PI / 2; dot.position.set(px, 0.06, pz);
      const grp = new THREE.Group(); grp.add(lbl, dot); m.parent.add(grp);
      this.effects.push({ kind: 'detect', obj: grp, t0: performance.now(), dur: 30000 });
    }
    if (this.spin && performance.now() - (this.lastTouch || 0) > 20000) this.flyTo(ev.agentId);
  }
  flyTo(agentId) {
    const m = this.markers.get(agentId);
    if (!m) return false;
    const i = this.floorGroups.findIndex((g) => g.userData.floorId === m.userData.floorId);
    if (this.floorSel >= 0 && this.floorSel < i) this.showFloor(i);
    const target = new THREE.Vector3(m.userData.x, this.floorGroups[i].position.y + 0.5, m.userData.y);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flight = { from: this.camera.position.clone(), fromT: this.controls.target.clone(), to: target.clone().add(dir.multiplyScalar(this.iso ? 30 : 7)), toT: target, t0: performance.now(), dur: 900 };
    return true;
  }
  frame(i = -1) {
    if (!this.center) return;
    const y = i >= 0 && this.floorGroups[i] ? this.floorGroups[i].position.y : 0;
    const d = this.size * 1.25 + 4;
    this.controls.target.set(this.center.x, y + 1, this.center.z);
    if (this.iso) { this.camera.position.set(this.center.x + 40, y + 40 * 0.8165, this.center.z + 40); this.camera.zoom = 1; this.camera.updateProjectionMatrix(); }
    else this.camera.position.set(this.center.x + d * 0.6, y + d * 0.75, this.center.z + d * 0.9);
    this.controls.update();
  }

  // ---------- imported 3D scan (shown as a light wireframe for reference) ----------
  async setModel(file, info) {
    if (this.model) { this.root.remove(this.model); this.model = null; }
    if (!file || !info) return;
    const url = URL.createObjectURL(file);
    try {
      let obj;
      if (info.kind === 'glb' || info.kind === 'gltf') { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); obj = (await new GLTFLoader().loadAsync(url)).scene; }
      else if (info.kind === 'obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); obj = await new OBJLoader().loadAsync(url); }
      else { const { USDZLoader } = await import('three/addons/loaders/USDZLoader.js'); obj = await new USDZLoader().loadAsync(url); }
      const mat = new THREE.MeshBasicMaterial({ color: this.c.muted, wireframe: true, transparent: true, opacity: 0.15, depthWrite: false });
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
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const half = (this.size || 10) * 0.85 + 2;
    Object.assign(this.ortho, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half });
    this.ortho.updateProjectionMatrix();
  }
  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.box.isConnected || !this.box.offsetParent) return;
    const spinning = this.spin && !this.flight && now - (this.lastTouch || 0) > 45000;
    this.controls.autoRotate = spinning; this.controls.autoRotateSpeed = 0.35;
    const busy = spinning || this.rain || now < (this.activeUntil || 0) || this.effects.length || this.flight || Math.abs(this.explode - this.explodeTarget) > 0.001;
    if (now - this.last < 1000 / (busy ? this.q.fps : 4)) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (Math.abs(this.explode - this.explodeTarget) > 0.001) {
      const before = this.explode;
      this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 5);
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
    this.effects = this.effects.filter((fx) => {
      const k = (now - fx.t0) / fx.dur;
      if (k < 0) return true;
      if (k >= 1) {
        if (fx.kind === 'room' && fx.mesh) this.restoreFloor(fx.mesh);
        if (fx.kind === 'flash') fx.obj.material.color.copy(fx.obj.userData.base);
        if (fx.kind === 'ripple') { fx.obj.parent?.remove(fx.obj); fx.obj.geometry.dispose(); }
        if (fx.kind === 'detect') fx.obj.parent?.remove(fx.obj);
        if (fx.kind === 'marker') fx.obj.children[0].material.color.copy(this.agents.find((a) => a.id === fx.obj.userData.agentId)?.online === false ? this.c.dim : this.c.text);
        return false;
      }
      const fade = 1 - k * k; // hold, then ease back
      if (fx.kind === 'room' && fx.mesh) { this.restoreFloor(fx.mesh); fx.mesh.material.color.lerp(fx.color, 0.85 * fade); }
      if (fx.kind === 'flash') fx.obj.material.color.copy(fx.color);
      if (fx.kind === 'ripple') { fx.obj.scale.setScalar(0.2 + k * 3); fx.obj.material.opacity = 0.7 * (1 - k); }
      if (fx.kind === 'marker') fx.obj.children[0].material.color.copy(fx.color);
      if (fx.kind === 'detect' && k > 0.8) fx.obj.children.forEach((c) => { c.material.transparent = true; c.material.opacity = (1 - k) * 5; });
      return true;
    });
    if (this.rain) { const a = this.rain.geometry.attributes.position; for (let i = 0; i < a.count; i += 2) { let y = a.getY(i) - dt * 9; if (y < 0) y += 12; a.setY(i, y); a.setY(i + 1, y - 0.45); } a.needsUpdate = true; }
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

/** A text label that always faces the camera. */
function textSprite(text, color, height) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = '500 40px "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 20;
  c.width = w; c.height = 56;
  g.font = font;
  g.fillStyle = `#${color.getHexString()}`;
  g.textBaseline = 'middle';
  g.fillText(text, 10, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  s.scale.set((height * w) / 56, height, 1);
  s.renderOrder = 10;
  return s;
}
