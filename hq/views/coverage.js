// COVERAGE view: each Agent's field of view on the floor plan, rooms nobody watches (blind spots)
// and outside doors/windows with no sensor on them. Turn a camera to see the difference straight away.
import { esc, $, toast } from '../../shared/ui.js';
import { bbox } from '../../shared/house.js';
import { facingVector } from '../../shared/coverage.js';

const DIRS = [[0, 'Up'], [45, 'Up-right'], [90, 'Right'], [135, 'Down-right'], [180, 'Down'], [225, 'Down-left'], [270, 'Left'], [315, 'Up-left']];

/** ctx = { S, api(path, opts) } */
export function createCoverage(ctx) {
  const { S } = ctx;
  let root = null, data = null, floorId = null;

  function render(el) {
    root = el;
    root.innerHTML = `<div class="view-pad coverage">
      <div class="cov-layout">
        <section class="panel cov-map"><div class="panel-head"><h2>Coverage map</h2><div class="filters" data-cfloors role="group" aria-label="Floor"></div></div>
          <div class="cov-svg" data-csvg></div>
          <div class="cov-legend small muted"><span><i class="lg-cov"></i>Watched area</span><span><i class="lg-fov"></i>Camera field of view</span><span><i class="lg-blind"></i>Blind spot (under 15% watched)</span><span><i class="lg-ok"></i>Entry watched</span><span><i class="lg-gap"></i>Entry not watched</span></div></section>
        <aside class="cov-side" data-cside></aside></div></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    load();
  }
  async function load() {
    try { data = await ctx.api('/coverage'); } catch (x) { toast(x.message, { kind: 'err' }); return; }
    if (!data.floors.some((f) => f.id === floorId)) floorId = data.floors[0]?.id || null;
    draw();
  }
  function draw() {
    if (!root?.isConnected || !data) return;
    const floor = data.floors.find((f) => f.id === floorId);
    $('[data-cfloors]', root).innerHTML = data.floors.length > 1 ? data.floors.map((f) => `<button data-cfloor="${f.id}" aria-pressed="${f.id === floorId}">${esc(f.name)}</button>`).join('') : '';
    const svgBox = $('[data-csvg]', root), side = $('[data-cside]', root);
    if (!floor || !floor.rooms.length) {
      svgBox.innerHTML = '<p class="muted small" style="padding:30px;text-align:center">Draw your floor plan first (Operations › Site map › Floor plan), then place Agents on it.</p>';
      side.innerHTML = '';
      return;
    }
    const house = S.house?.floors.find((f) => f.id === floor.id);
    const pts = house.rooms.flatMap((r) => r.points), b = bbox(pts), pad = 1.2;
    const vb = `${b.minX - pad} ${b.minY - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
    const blind = new Set(floor.rooms.filter((r) => r.blind).map((r) => r.id));
    const poly = (p) => p.map((q) => q.join(',')).join(' ');
    const wedge = (s) => {
      const r = s.range, a0 = s.dir - s.fov / 2, a1 = s.dir + s.fov / 2;
      const [x0, y0] = facingVector(a0), [x1, y1] = facingVector(a1);
      return `M${s.x},${s.y} L${s.x + x0 * r},${s.y + y0 * r} A${r},${r} 0 0 1 ${s.x + x1 * r},${s.y + y1 * r} Z`;
    };
    svgBox.innerHTML = `<svg viewBox="${vb}" role="img" aria-label="Coverage of ${esc(floor.name)}" preserveAspectRatio="xMidYMid meet">
      <defs>${house.rooms.map((r) => `<clipPath id="cl-${r.id}"><polygon points="${poly(r.points)}"/></clipPath>`).join('')}<pattern id="hatch" width="0.4" height="0.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="0.4" class="hatch-line"/></pattern></defs>
      ${house.rooms.map((r) => `<polygon points="${poly(r.points)}" class="cv-room ${blind.has(r.id) ? 'blind' : ''}"/>${blind.has(r.id) ? `<polygon points="${poly(r.points)}" fill="url(#hatch)" class="cv-hatch"/>` : ''}`).join('')}
      <g class="cv-cells">${floor.cells.map(([x, y]) => `<rect x="${x - floor.cell / 2}" y="${y - floor.cell / 2}" width="${floor.cell}" height="${floor.cell}"/>`).join('')}</g>
      ${house.rooms.map((r) => { const rr = floor.rooms.find((x) => x.id === r.id); const c = bbox(r.points); return `<text x="${c.minX + c.w / 2}" y="${c.minY + c.h / 2}" class="cv-label">${esc(r.name)}</text><text x="${c.minX + c.w / 2}" y="${c.minY + c.h / 2 + 0.45}" class="cv-pct">${rr.pct}%</text>`; }).join('')}
      ${floor.entries.map((e) => `<line x1="${e.a[0]}" y1="${e.a[1]}" x2="${e.b[0]}" y2="${e.b[1]}" class="cv-entry ${e.unmonitored ? 'gap' : 'ok'}"><title>${esc(e.label)} — ${esc(e.room)}: ${e.unmonitored ? 'not watched' : 'watched'}</title></line>`).join('')}
      ${floor.sensors.map((s) => `${s.type === 'camera' ? `<path d="${wedge(s)}" class="cv-fov" ${s.roomId ? `clip-path="url(#cl-${s.roomId})"` : ''}/>` : `<circle cx="${s.x}" cy="${s.y}" r="${s.range}" class="cv-fov" ${s.roomId && s.type === 'area' ? `clip-path="url(#cl-${s.roomId})"` : ''}/>`}
        <circle cx="${s.x}" cy="${s.y}" r="0.22" class="cv-agent ${s.online ? '' : 'off'}"/><text x="${s.x}" y="${s.y - 0.38}" class="cv-code">${esc(s.codename)}</text>`).join('')}
    </svg>`;
    const unplaced = S.agents.filter((a) => !a.place);
    side.innerHTML = `
      <section class="panel"><div class="panel-head"><h2>Summary</h2></div>
        <div class="cov-big"><b class="mono">${data.pct}%</b><span class="small muted">of the floor area is watched</span></div>
        <dl class="kv"><dt>Blind spots</dt><dd>${data.blind.length} room${data.blind.length === 1 ? '' : 's'}</dd><dt>Unwatched entries</dt><dd>${data.unmonitored.length}</dd><dt>Agents placed</dt><dd>${S.agents.length - unplaced.length} of ${S.agents.length}</dd></dl></section>
      <section class="panel"><div class="panel-head"><h2>Entry points not watched</h2></div>
        <ul class="cov-list">${data.unmonitored.map((e) => `<li><span class="dot warn"></span><span class="grow">${esc(e.label)} — ${esc(e.room)}</span><span class="small muted">${esc(e.floor)}</span></li>`).join('') || '<li class="small muted">Every outside door and window has a sensor on it.</li>'}</ul>
        ${data.unmonitored.length ? '<p class="small muted">Point a MOTION WATCH camera at it, or put a DOOR TRIPWIRE Agent on the door.</p>' : ''}</section>
      <section class="panel"><div class="panel-head"><h2>Blind spots</h2></div>
        <ul class="cov-list">${data.blind.map((r) => `<li><span class="grow">${esc(r.name)}</span><span class="mono small">${r.pct}%</span><span class="small muted">${esc(r.floor)}</span></li>`).join('') || '<li class="small muted">None.</li>'}</ul></section>
      <section class="panel"><div class="panel-head"><h2>Cameras on this floor</h2></div>
        <ul class="cov-list">${floor.sensors.map((s) => `<li data-cagent="${s.id}"><span class="grow"><b>${esc(s.codename)}</b><small class="muted"> · ${esc(s.label)}</small></span>
          ${s.type === 'camera' ? `<button class="icon-btn" data-crot="-15" aria-label="Turn left" title="Turn left 15°">⟲</button><select data-cdir aria-label="Facing">${DIRS.map(([d, l]) => `<option value="${d}" ${Math.round(s.dir / 45) * 45 % 360 === d ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="icon-btn" data-crot="15" aria-label="Turn right" title="Turn right 15°">⟳</button>` : ''}</li>`).join('') || '<li class="small muted">No Agents placed on this floor.</li>'}</ul>
        ${unplaced.length ? `<p class="small muted">Not on the plan: ${unplaced.map((a) => esc(a.codename)).join(', ')}. Drag them onto the Site map.</p>` : ''}</section>`;
  }
  async function face(id, dir) {
    try { await ctx.api(`/agents/${id}/facing`, { method: 'PUT', body: { dir } }); await load(); } catch (x) { toast(x.message, { kind: 'err' }); }
  }
  function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cfloor) { floorId = b.dataset.cfloor; draw(); }
    else if (b.dataset.crot) {
      const id = b.closest('[data-cagent]').dataset.cagent, s = data.floors.flatMap((f) => f.sensors).find((x) => x.id === id);
      face(id, (s.dir + Number(b.dataset.crot) + 360) % 360);
    }
  }
  function onChange(e) { if (e.target.matches('[data-cdir]')) face(e.target.closest('[data-cagent]').dataset.cagent, Number(e.target.value)); }
  return { render, refresh() { if (root?.isConnected) load(); } };
}
