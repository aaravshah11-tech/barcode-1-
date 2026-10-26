// The radar: rings, a rotating sweep, and a blip for every Agent. Used by the Command Centre and INTEL SCREEN.
const TAU = Math.PI * 2;
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const COLORS = { on: '#39ff88', off: '#4d6b5a', warn: '#ffb627', alert: '#ff4d4d' };
let ACC = '57,255,136';
/** Follow the current theme's colours (CLASSIC / MI6 / RED OPS). */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  ACC = (cs.getPropertyValue('--accent-rgb') || '57,255,136').trim().replace(/\s+/g, '');
  COLORS.on = cs.getPropertyValue('--green').trim() || COLORS.on;
  COLORS.alert = cs.getPropertyValue('--red').trim() || COLORS.alert;
}

export class Radar {
  constructor(canvas, { onPick = null, fx = true } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.onPick = onPick;
    this.fx = fx;
    themeColors();
    this.agents = [];
    this.pulses = []; // { id, color, t0 }
    this.lit = new Map(); // id -> brightness 0..1
    this.angle = -Math.PI / 2;
    this.last = performance.now();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    canvas.addEventListener('click', (e) => this.pick(e));
    canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = this.hit(e) ? 'pointer' : 'default'; });
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.vis = () => { if (!document.hidden) { this.last = performance.now(); cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.loop); } };
    document.addEventListener('visibilitychange', this.vis);
  }
  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); document.removeEventListener('visibilitychange', this.vis); }
  setFx(on) { this.fx = on; }
  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** Fixed spot for each Agent, spread around the screen. */
  place(a) {
    const h = hash(a.id);
    return { ang: ((h % 360) / 360) * TAU, rad: 0.32 + ((Math.floor(h / 360) % 1000) / 1000) * 0.56 };
  }
  setAgents(list) { this.agents = list; this.c.setAttribute('aria-label', `Radar: ${list.filter((a) => a.online).length} of ${list.length} Agents online`); }
  pulse(id, level = 'on') { this.pulses.push({ id, color: COLORS[level === 'alert' ? 'alert' : level === 'warn' ? 'warn' : 'on'], t0: performance.now() }); }

  geometry() { const R = Math.min(this.w, this.h) / 2 - 18; return { cx: this.w / 2, cy: this.h / 2, R }; }
  pos(a) { const { cx, cy, R } = this.geometry(); const p = this.place(a); return { x: cx + Math.cos(p.ang) * p.rad * R, y: cy + Math.sin(p.ang) * p.rad * R, ang: p.ang }; }
  hit(e) {
    const r = this.c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 22;
    for (const a of this.agents) { const p = this.pos(a); const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  pick(e) { const a = this.hit(e); if (a) this.onPick?.(a.id); }

  loop(now) {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    const moving = this.fx && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prev = this.angle;
    if (moving) this.angle = (this.angle + (dt / 4000) * TAU) % TAU;
    this.draw(now, prev, moving);
    if (!document.hidden) this.raf = requestAnimationFrame(this.loop);
  }

  draw(now, prevAngle, moving) {
    const g = this.g;
    const { cx, cy, R } = this.geometry();
    g.clearRect(0, 0, this.w, this.h);
    if (R <= 10) return;
    // background disc
    const bg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, `rgba(${ACC},0.07)`); bg.addColorStop(1, `rgba(${ACC},0.015)`);
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    // rings + crosshair
    g.strokeStyle = `rgba(${ACC},0.22)`; g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { g.beginPath(); g.arc(cx, cy, (R * i) / 4, 0, TAU); g.stroke(); }
    g.strokeStyle = `rgba(${ACC},0.5)`; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    g.strokeStyle = `rgba(${ACC},0.14)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    for (let d = 0; d < 360; d += 10) { const a = (d / 360) * TAU; const l = d % 30 ? 4 : 9; g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l)); g.stroke(); }
    // sweep (a fading wedge behind the beam)
    const sweepLen = 0.9;
    if (g.createConicGradient) {
      const cg = g.createConicGradient(this.angle - sweepLen, cx, cy);
      cg.addColorStop(0, `rgba(${ACC},0)`); cg.addColorStop(sweepLen / TAU, `rgba(${ACC},0.32)`); cg.addColorStop(sweepLen / TAU + 0.0001, `rgba(${ACC},0)`); cg.addColorStop(1, `rgba(${ACC},0)`);
      g.fillStyle = cg; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, this.angle - sweepLen, this.angle); g.closePath(); g.fill();
    }
    g.strokeStyle = `rgba(${ACC},0.85)`; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(this.angle) * R, cy + Math.sin(this.angle) * R); g.stroke();
    // HQ in the middle
    g.fillStyle = COLORS.on; g.beginPath(); g.arc(cx, cy, 4, 0, TAU); g.fill();
    g.font = '700 10px ui-monospace, Menlo, monospace'; g.fillStyle = `rgba(${ACC},0.7)`; g.fillText('HQ', cx + 7, cy - 6);

    // blips
    const passed = (ang) => { const norm = (x) => ((x % TAU) + TAU) % TAU; const a = norm(ang), p = norm(prevAngle), n = norm(this.angle); return p <= n ? a > p && a <= n : a > p || a <= n; };
    for (const a of this.agents) {
      const p = this.pos(a);
      const level = !a.online ? 'off' : a.alert ? 'alert' : a.warn ? 'warn' : 'on';
      const color = COLORS[level];
      let lit = this.lit.get(a.id) ?? 0.5;
      if (moving && passed(p.ang)) lit = 1;
      lit = moving ? Math.max(a.online ? 0.35 : 0.25, lit - 0.0045 * 16) : 0.9;
      this.lit.set(a.id, lit);
      g.save();
      g.globalAlpha = a.online ? 0.35 + lit * 0.65 : 0.6;
      if (a.online) { g.shadowColor = color; g.shadowBlur = 14 * lit; }
      g.fillStyle = a.online ? color : 'transparent';
      g.strokeStyle = color; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, 6, 0, TAU); a.online ? g.fill() : g.stroke();
      g.restore();
      g.font = '700 11px ui-monospace, Menlo, monospace';
      g.fillStyle = a.online ? 'rgba(201,247,218,0.95)' : 'rgba(126,168,145,0.8)';
      const label = a.codename || '';
      const tx = p.x + (p.x > cx + R * 0.55 ? -10 - g.measureText(label).width : 10);
      g.fillText(label, tx, p.y + 4);
    }
    // event pulses
    this.pulses = this.pulses.filter((pl) => now - pl.t0 < 2200);
    for (const pl of this.pulses) {
      const a = this.agents.find((x) => x.id === pl.id);
      if (!a) continue;
      const p = this.pos(a);
      const k = (now - pl.t0) / 2200;
      g.save(); g.globalAlpha = 1 - k; g.strokeStyle = pl.color; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, 6 + k * 36, 0, TAU); g.stroke(); g.restore();
    }
  }
}
