// HOUSE BUILDER: draw your home room by room (seen from above), trace over a floor-plan picture,
// or import a 3D scan. Everything is in metres. Changes save automatically.
import { esc, $, $$, toast, confirmBox } from '../shared/ui.js';
import { sfx } from '../shared/sfx.js';
import { icon } from '../shared/icons.js';
import { sanitizeHouse, emptyHouse, newId, snap, area, bbox, centroid, pointInPolygon, nearestWall, openingEnds, fixtureLines, fixtureAt, OPENING_KINDS, FIXTURE_KINDS, TEMPLATES, SCAN_APPS } from '../shared/house.js';

const TOOLS = [
  ['select', 'select', 'Select / move', 'Click a room, stairs or wall to select it. Drag to move it, or drag a room’s corner dots to reshape it. Drag empty space to pan.'],
  ['rect', 'rect', 'Draw room', 'Drag to draw a rectangular room.'],
  ['poly', 'poly', 'Draw shape', 'Click each corner. Click the first corner again (or press Enter) to finish. Esc cancels.'],
  ['door', 'door', 'Add door', 'Click on a wall to put a door there. Select it afterwards to make it an archway, sliding door or garage door.'],
  ['window', 'window', 'Add window', 'Click on a wall to put a window there.'],
  ['stairs', 'stairs', 'Add stairs', 'Click where the stairs start. The arrow shows the way UP; turn and resize them on the right.'],
  ['wall', 'wall', 'Inner wall', 'Drag from one end of the wall to the other.'],
  ['column', 'column', 'Pillar', 'Click to place a pillar or structural column.'],
  ['trace', 'image', 'Floor-plan picture', 'Upload a picture of your floor plan, set its scale, then draw rooms over it.'],
  ['model', 'cube', 'Import 3D scan', 'Load a 3D scan of your home from a phone app.'],
];
const rise = (f) => f.height + 0.25; // stairs climb to the next floor
const SNAPS = [[0, 'Off'], [0.05, '5 cm'], [0.1, '10 cm'], [0.25, '25 cm'], [0.5, '50 cm']];

/** Opens the builder full-screen. `S` is the dashboard state; `files` gives access to big files (HQ only). */
export function openBuilder(S, { files, onClose } = {}) {
  let house = sanitizeHouse(structuredClone(S.house || emptyHouse()));
  let fi = 0; // current floor
  let tool = 'select', sel = null, snapStep = 0.1;
  let view = { x: 80, y: 80, z: 50 }; // pixels per metre
  const undo = [], redo = [];
  let draft = null; // shape being drawn
  let drag = null;
  let traceUrl = null, scaleClicks = null;
  const floor = () => house.floors[fi];

  const el = document.createElement('div');
  el.className = 'builder';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'House builder');
  el.innerHTML = `
    <header class="b-top">
      <b class="mono">HOUSE BUILDER</b>
      <div class="b-floors" data-floors role="tablist" aria-label="Floors"></div>
      <span class="spacer"></span>
      <span class="small muted mono" data-saved>SAVED</span>
      <button class="icon-btn" data-undo title="Undo (Ctrl+Z)" aria-label="Undo">↶</button><button class="icon-btn" data-redo title="Redo" aria-label="Redo">↷</button>
      <button class="btn-primary" data-done>Done</button>
    </header>
    <div class="b-main">
      <nav class="b-tools" aria-label="Tools">${TOOLS.map(([k, g, l]) => `<button data-tool="${k}" title="${esc(l)}" aria-label="${esc(l)}">${icon(g)}<small>${esc(l)}</small></button>`).join('')}</nav>
      <div class="b-canvas" data-canvasbox>
        <svg data-svg tabindex="0" aria-label="Floor plan"></svg>
        <div class="b-hint mono" data-hint></div>
        <div class="b-zoom"><button data-zoom="1.25" aria-label="Zoom in">＋</button><button data-zoom="0.8" aria-label="Zoom out">－</button><button data-fit aria-label="Fit to screen">⤢</button>
          <label class="small mono">SNAP <select data-snap>${SNAPS.map(([v, l]) => `<option value="${v}" ${v === snapStep ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      </div>
      <aside class="b-side" data-side></aside>
    </div>`;
  document.body.appendChild(el);
  const svg = $('[data-svg]', el);
  const side = $('[data-side]', el);

  // ---------- saving (automatic) ----------
  let saveTimer = null;
  const save = () => {
    $('[data-saved]', el).textContent = 'SAVING…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      // Keep our own copy: a newer edit may have happened while this save was on its way.
      try { const sent = JSON.stringify(house); S.house = await S.api('/house', { method: 'PUT', body: JSON.parse(sent) }); if (JSON.stringify(house) === sent) $('[data-saved]', el).textContent = 'SAVED'; } catch (x) { $('[data-saved]', el).textContent = 'NOT SAVED'; toast(x.message, { kind: 'err' }); }
    }, 500);
  };
  const change = (fn) => { undo.push(JSON.stringify(house)); if (undo.length > 80) undo.shift(); redo.length = 0; fn(); save(); draw(); setTimeout(panel, 0); }; // panel after focus has moved (Tab)
  const restore = (from, to) => { if (!from.length) return; to.push(JSON.stringify(house)); house = JSON.parse(from.pop()); fi = Math.min(fi, house.floors.length - 1); sel = null; save(); draw(); panel(); };

  // ---------- coordinates ----------
  const toWorld = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z]; };
  const snapPt = ([x, y]) => [snap(x, snapStep), snap(y, snapStep)];
  const fmt = (m) => `${(Math.round(m * 100) / 100).toFixed(2)} m`;

  // ---------- drawing ----------
  function draw() {
    const f = floor(), z = view.z;
    const r = svg.getBoundingClientRect();
    // grid every metre (and 10 cm when zoomed in)
    const grid = [];
    const x0 = Math.floor(-view.x / z) - 1, x1 = Math.ceil((r.width - view.x) / z) + 1, y0 = Math.floor(-view.y / z) - 1, y1 = Math.ceil((r.height - view.y) / z) + 1;
    if (x1 - x0 < 400 && y1 - y0 < 400) {
      for (let x = x0; x <= x1; x++) grid.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" class="g ${x % 5 ? '' : 'g5'}"/>`);
      for (let y = y0; y <= y1; y++) grid.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="g ${y % 5 ? '' : 'g5'}"/>`);
    }
    const t = house.trace[f.id];
    const below = fi > 0 ? house.floors[fi - 1] : null;
    const lower = below ? below.rooms.map((rm) => `<polygon points="${rm.points.join(' ')}" class="ghost"/>`).join('')
      + (below.fixtures || []).filter((x) => x.kind === 'stairs' || x.kind === 'spiral').map((x) => `<polygon points="${fixtureLines(x).outline.join(' ')}" class="ghost stairs-below"><title>Stairs coming up from ${esc(below.name)}</title></polygon>`).join('') : '';
    const fixtures = (f.fixtures || []).map((x) => {
      const L = fixtureLines(x, rise(f)), on = sel?.type === 'fixture' && sel.id === x.id;
      const ar = L.arrow ? `<line x1="${L.arrow[0][0]}" y1="${L.arrow[0][1]}" x2="${L.arrow[1][0]}" y2="${L.arrow[1][1]}" class="fx-arrow" marker-end="url(#b-up)"/>` : '';
      return `<g data-fixture="${x.id}" class="fx ${x.kind} ${on ? 'sel' : ''}"><polygon points="${L.outline.join(' ')}"/>${L.lines.map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`).join('')}${ar}</g>`;
    }).join('');
    const rooms = f.rooms.map((rm) => {
      const c = centroid(rm.points), b = bbox(rm.points), on = sel?.type === 'room' && sel.id === rm.id;
      return `<g data-room="${rm.id}" class="room ${on ? 'sel' : ''}"><polygon points="${rm.points.join(' ')}"/>
        <text x="${c[0]}" y="${c[1]}" style="font-size:${13 / z}px">${esc(rm.name)}</text>
        <text x="${c[0]}" y="${c[1] + 16 / z}" class="dim" style="font-size:${10 / z}px">${b.w.toFixed(1)} × ${b.h.toFixed(1)} m · ${area(rm.points).toFixed(1)} m²</text>
        ${on ? rm.points.map((p, i) => `<circle data-vertex="${i}" cx="${p[0]}" cy="${p[1]}" r="${7 / z}" class="vx"/>`).join('') : ''}</g>`;
    }).join('');
    const openings = f.openings.map((o) => {
      const e = openingEnds(f, o);
      if (!e) return '';
      return `<line data-opening="${o.id}" x1="${e.a[0]}" y1="${e.a[1]}" x2="${e.b[0]}" y2="${e.b[1]}" class="op ${o.kind} ${sel?.id === o.id ? 'sel' : ''}"/>`;
    }).join('');
    const d = draft?.kind === 'wall' ? `<line x1="${draft.a[0]}" y1="${draft.a[1]}" x2="${draft.b[0]}" y2="${draft.b[1]}" class="draft wall-draft"/>` : draft ? (draft.kind === 'rect' ? `<polygon points="${rectPts(draft.a, draft.b).join(' ')}" class="draft"/>`
      : `<polyline points="${[...draft.pts, draft.hover || draft.pts.at(-1)].join(' ')}" class="draft"/>${draft.pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${5 / z}" class="vx"/>`).join('')}`) : '';
    const sc = scaleClicks?.length ? `<polyline points="${[...scaleClicks, scaleClicks.hover || scaleClicks[0]].join(' ')}" class="measure"/>` : '';
    svg.innerHTML = `<defs><marker id="b-up" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="fx-head"/></marker></defs><g transform="translate(${view.x} ${view.y}) scale(${z})">
      ${t && traceUrl ? `<image href="${traceUrl}" x="${t.x}" y="${t.y}" width="${t.w * t.scale}" height="${t.h * t.scale}" opacity="${t.opacity}" preserveAspectRatio="none" data-trace/>` : ''}
      <g class="grid">${grid.join('')}</g>${lower}${rooms}${fixtures}${openings}${d}${sc}
      <g class="origin"><line x1="-0.3" y1="0" x2="1" y2="0"/><line x1="0" y1="-0.3" x2="0" y2="1"/><text x="1.05" y="0.1" style="font-size:${10 / z}px">1 m</text></g></g>`;
    $$('[data-tool]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    $('[data-hint]', el).textContent = scaleClicks ? (scaleClicks.length ? 'Now click the other end of something you know the length of.' : 'SET SCALE: click one end of a wall you know the length of.') : TOOLS.find(([k]) => k === tool)[3];
    $('[data-floors]', el).innerHTML = house.floors.map((x, i) => `<button role="tab" data-floor="${i}" aria-pressed="${i === fi}">${esc(x.name)}</button>`).join('') + '<button data-addfloor title="Add a floor" aria-label="Add a floor">＋</button>';
  }
  const rectPts = (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];

  // ---------- side panel ----------
  function panel() {
    const f = floor();
    const room = sel?.type === 'room' && f.rooms.find((r) => r.id === sel.id);
    const op = sel?.type === 'opening' && f.openings.find((o) => o.id === sel.id);
    const fx = sel?.type === 'fixture' && (f.fixtures || []).find((x) => x.id === sel.id);
    let html = '';
    if (tool === 'trace') html = tracePanel(f);
    else if (tool === 'model') html = modelPanel();
    else if (room) {
      const b = bbox(room.points);
      html = `<h2>Room</h2>
        <label class="field"><span>Name</span><input data-rname value="${esc(room.name)}" maxlength="30"></label>
        <p class="mono small">${b.w.toFixed(2)} × ${b.h.toFixed(2)} m · ${area(room.points).toFixed(1)} m²</p>
        ${room.points.length === 4 ? `<div class="row"><label class="field grow"><span>Width (m)</span><input type="number" step="0.05" min="0.5" data-rw value="${b.w.toFixed(2)}"></label><label class="field grow"><span>Depth (m)</span><input type="number" step="0.05" min="0.5" data-rh value="${b.h.toFixed(2)}"></label></div>` : ''}
        <label class="field"><span>Ceiling height (m)</span><input type="number" step="0.05" min="1" max="10" data-rheight value="${room.height ?? f.height}"></label>
        <button class="btn-danger" data-delsel>Delete room</button>`;
    } else if (op) {
      html = `<h2>${esc(OPENING_KINDS[op.kind].label)}</h2>
        ${op.kind === 'window' ? '' : `<label class="field"><span>Type</span><select data-okind>${Object.entries(OPENING_KINDS).filter(([k]) => k !== 'window').map(([k, v]) => `<option value="${k}" ${k === op.kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>`}
        <label class="field"><span>Width (m)</span><input type="number" step="0.05" min="0.3" max="6" data-owidth value="${op.width}"></label>
        <p class="small muted">Drag it along the wall to move it.</p>
        <button class="btn-danger" data-delsel>Delete</button>`;
    } else if (fx) {
      const isStairs = fx.kind === 'stairs' || fx.kind === 'spiral';
      const up = house.floors[fi + 1];
      html = `<h2>${esc(FIXTURE_KINDS[fx.kind].label)}</h2>
        ${isStairs ? `<label class="field"><span>Type</span><select data-fxkind><option value="stairs" ${fx.kind === 'stairs' ? 'selected' : ''}>Straight flight</option><option value="spiral" ${fx.kind === 'spiral' ? 'selected' : ''}>Spiral</option></select></label>` : ''}
        <div class="row">${fx.kind === 'spiral' ? `<label class="field grow"><span>Diameter (m)</span><input type="number" step="0.05" min="1" max="4" data-fxw value="${fx.w}"></label>`
          : `<label class="field grow"><span>${fx.kind === 'wall' ? 'Length' : 'Width'} (m)</span><input type="number" step="0.05" min="0.05" max="30" data-fxw value="${fx.w}"></label>
             <label class="field grow"><span>${fx.kind === 'stairs' ? 'Length of flight' : fx.kind === 'wall' ? 'Thickness' : 'Depth'} (m)</span><input type="number" step="0.05" min="0.05" max="30" data-fxd value="${fx.d}"></label>`}</div>
        <div class="row"><label class="field grow"><span>Turn (°)</span><input type="number" step="15" data-fxrot value="${fx.rot}"></label><button class="small" data-fxturn title="Turn 90°">${icon('rotate')}Turn 90°</button></div>
        ${isStairs ? `<p class="small muted">${fx.kind === 'stairs' ? 'The arrow points the way UP. ' : ''}${up ? `They lead up to <b>${esc(up.name)}</b>, where they show faintly so you can line up the landing.` : 'This is the top floor: add a floor (＋ at the top) for the stairs to lead to.'}</p>` : ''}
        <button class="btn-danger" data-delsel>Delete</button>`;
    } else {
      const total = f.rooms.reduce((n, r) => n + area(r.points), 0);
      html = `<h2>${esc(f.name)}</h2>
        <label class="field"><span>Floor name</span><input data-fname value="${esc(f.name)}" maxlength="30"></label>
        <label class="field"><span>Wall height (m)</span><input type="number" step="0.05" min="1.8" max="10" data-fheight value="${f.height}"></label>
        <p class="mono small">${f.rooms.length} room${f.rooms.length === 1 ? '' : 's'} · ${total.toFixed(1)} m² · ${f.openings.filter((o) => o.kind !== 'window').length} doors · ${f.openings.filter((o) => o.kind === 'window').length} windows${(f.fixtures || []).some((x) => x.kind === 'stairs' || x.kind === 'spiral') ? ' · stairs' : ''}</p>
        ${house.floors.length > 1 ? '<button class="btn-danger small" data-delfloor>Delete this floor</button>' : ''}
        <hr>
        <h2>How to build your house</h2>
        <ol class="small b-steps"><li>Pick <b>Draw room</b> and drag out each room. Rooms snap to a 10 cm grid.</li><li>Click a room (with <b>Select</b>) to name it and type its exact size.</li><li>Add <b>doors</b> and <b>windows</b> by clicking on walls. A selected door can become an archway, sliding door or garage door.</li><li>Add <b>stairs</b>, <b>inner walls</b> and <b>pillars</b>. Stairs show on the 3D map climbing to the next floor.</li><li>Upstairs? Press <b>＋</b> next to the floor tabs.</li><li>Have an estate-agent floor plan? Use <b>Floor-plan picture</b> to trace it.</li></ol>
        ${f.rooms.length ? '' : `<h2>…or start from a template</h2><div class="row">${Object.entries(TEMPLATES).map(([k, t]) => `<button class="small" data-template="${k}">${esc(t.name)}</button>`).join('')}</div>`}`;
    }
    // Redrawing the panel mustn't lose your place: keep focus on the same box (e.g. after Tab).
    const f0 = side.contains(document.activeElement) ? [...document.activeElement.attributes].find((a) => a.name.startsWith('data-'))?.name : null;
    side.innerHTML = html;
    if (f0) side.querySelector(`[${f0}]`)?.focus();
  }

  function tracePanel(f) {
    const t = house.trace[f.id];
    return `<h2>Floor-plan picture · ${esc(f.name)}</h2>
      <p class="small">Got a floor plan from an estate-agent listing or a sketch? Upload a picture of it, tell SENTINEL how big it is, then draw rooms on top.</p>
      <label class="btn" style="cursor:pointer">⇧ ${t ? 'Replace' : 'Upload'} picture<input type="file" accept="image/*" data-traceupload hidden></label>
      ${t ? `<hr>
      <h2>1. Set the scale</h2>
      <p class="small">Click <b>Set scale</b>, then click both ends of a wall whose length you know (it’s often written on the plan), and type that length.</p>
      <button data-setscale ${scaleClicks ? 'aria-pressed="true"' : ''}>${icon('ruler')}Set scale</button>
      <p class="mono small muted">Picture: ${(t.w * t.scale).toFixed(1)} × ${(t.h * t.scale).toFixed(1)} m</p>
      <h2>2. Line it up</h2>
      <div class="row"><label class="field grow"><span>Move right (m)</span><input type="number" step="0.1" data-tx value="${t.x}"></label><label class="field grow"><span>Move down (m)</span><input type="number" step="0.1" data-ty value="${t.y}"></label></div>
      <label class="field"><span>See-through</span><input type="range" min="0.05" max="1" step="0.05" data-topacity value="${t.opacity}"></label>
      <h2>3. Trace the rooms</h2>
      <p class="small">Switch to <b>Draw room</b> or <b>Draw shape</b> and draw over each room on the picture.</p>
      <button class="btn-danger small" data-traceremove>Remove picture</button>` : ''}`;
  }

  function modelPanel() {
    const m = house.model;
    return `<h2>Import a 3D scan</h2>
      <p class="small">Scan your rooms with a free phone app, export the file, and load it here. It appears on the 3D map behind your rooms. (Drawing your rooms too is still best: that’s what lights up when an Agent sees something.)</p>
      <label class="btn" style="cursor:pointer">⇧ ${m ? 'Replace' : 'Load'} 3D file (.glb, .gltf, .obj, .usdz)<input type="file" accept=".glb,.gltf,.obj,.usdz,model/gltf-binary,model/gltf+json" data-modelupload hidden></label>
      ${m ? `<p class="mono small">LOADED: ${esc(m.name)} (${(m.size / 1048576).toFixed(1)} MB)</p>
        <div class="row"><label class="field grow"><span>Scale</span><input type="number" step="0.01" min="0.001" data-mscale value="${m.scale}"></label><label class="field grow"><span>Turn (°)</span><input type="number" step="5" data-mrot value="${m.rot}"></label></div>
        <div class="row"><label class="field grow"><span>Move right (m)</span><input type="number" step="0.1" data-mx value="${m.x}"></label><label class="field grow"><span>Move down (m)</span><input type="number" step="0.1" data-my value="${m.y}"></label></div>
        <label class="field"><span>Floor</span><select data-mfloor>${house.floors.map((f) => `<option value="${f.id}" ${f.id === m.floorId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
        <button class="btn-danger small" data-modelremove>Remove 3D scan</button>` : ''}
      <hr><h2>Free scanning apps</h2>
      <ul class="small b-apps">${SCAN_APPS.map((a) => `<li><b>${esc(a.name)}</b> — ${esc(a.where)}<br><span class="muted">${esc(a.how)}</span></li>`).join('')}</ul>
      <p class="small muted">Tip: walk slowly, keep lights on, scan one room at a time. A phone with LiDAR (iPhone Pro / iPad Pro) gives the best result. Files over 50 MB may be slow on an older laptop.</p>`;
  }

  // ---------- trace picture ----------
  async function loadTrace() {
    if (traceUrl) URL.revokeObjectURL(traceUrl);
    traceUrl = null;
    const blob = await files?.get(`trace:${floor().id}`);
    if (blob) traceUrl = URL.createObjectURL(blob);
    draw();
  }

  // ---------- pointer input ----------
  svg.addEventListener('pointerdown', (e) => {
    svg.focus();
    const w = toWorld(e), p = snapPt(w);
    if (scaleClicks) {
      scaleClicks.push(w);
      if (scaleClicks.length === 2) finishScale();
      draw();
      return;
    }
    if (tool === 'rect') { draft = { kind: 'rect', a: p, b: p }; svg.setPointerCapture(e.pointerId); return draw(); }
    if (tool === 'poly') {
      if (!draft) draft = { kind: 'poly', pts: [] };
      const first = draft.pts[0];
      if (first && draft.pts.length >= 3 && Math.hypot(first[0] - w[0], first[1] - w[1]) < 12 / view.z) return finishPoly();
      draft.pts.push(p);
      return draw();
    }
    if (tool === 'wall') { draft = { kind: 'wall', a: p, b: p }; svg.setPointerCapture(e.pointerId); return draw(); }
    if (tool === 'stairs' || tool === 'column') {
      const k = FIXTURE_KINDS[tool];
      // Stairs: the click is the bottom step, so the flight runs up (north) from there.
      const x = { id: newId(), kind: tool, x: p[0], y: tool === 'stairs' ? round(p[1] - k.d / 2) : p[1], w: k.w, d: k.d, rot: 0 };
      change(() => { (floor().fixtures ||= []).push(x); sel = { type: 'fixture', id: x.id }; tool = 'select'; });
      sfx('blip');
      return;
    }
    if (tool === 'door' || tool === 'window') {
      const wall = nearestWall(floor(), w);
      if (!wall || wall.dist > 0.6) { toast('Click on (or very near) a wall.'); return; }
      const o = { id: newId(), kind: tool, roomId: wall.roomId, edge: wall.edge, t: wall.t, width: OPENING_KINDS[tool].width };
      change(() => { floor().openings.push(o); sel = { type: 'opening', id: o.id }; });
      sfx('blip');
      return;
    }
    // select tool
    const vx = e.target.closest('[data-vertex]'), roomEl = e.target.closest('[data-room]'), opEl = e.target.closest('[data-opening]');
    const fxHit = !vx && !opEl && fixtureAt(floor(), w, 4 / view.z);
    if (vx && sel?.type === 'room') { drag = { kind: 'vertex', i: Number(vx.dataset.vertex), before: JSON.stringify(house) }; }
    else if (opEl) { sel = { type: 'opening', id: opEl.dataset.opening }; drag = { kind: 'opening', before: JSON.stringify(house) }; }
    else if (fxHit) { sel = { type: 'fixture', id: fxHit.id }; drag = { kind: 'fixture', from: p, before: JSON.stringify(house), moved: false }; }
    else if (roomEl) { sel = { type: 'room', id: roomEl.dataset.room }; drag = { kind: 'room', from: p, before: JSON.stringify(house), moved: false }; }
    else { sel = null; drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; }
    svg.setPointerCapture(e.pointerId);
    draw(); panel();
  });
  svg.addEventListener('pointermove', (e) => {
    const w = toWorld(e), p = snapPt(w);
    if (scaleClicks) { scaleClicks.hover = w; return draw(); }
    if (draft?.kind === 'rect' || draft?.kind === 'wall') { draft.b = p; return draw(); }
    if (draft?.kind === 'poly') { draft.hover = p; return draw(); }
    if (!drag) return;
    const f = floor();
    if (drag.kind === 'pan') { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; return draw(); }
    if (drag.kind === 'fixture') {
      const x = (f.fixtures || []).find((q) => q.id === sel?.id), dx = p[0] - drag.from[0], dy = p[1] - drag.from[1];
      if (x && (dx || dy)) { x.x = round(x.x + dx); x.y = round(x.y + dy); drag.from = p; drag.moved = true; draw(); }
      return;
    }
    const room = f.rooms.find((r) => r.id === sel?.id);
    if (drag.kind === 'vertex' && room) { room.points[drag.i] = p; drag.moved = true; return draw(); }
    if (drag.kind === 'room' && room) {
      const dx = p[0] - drag.from[0], dy = p[1] - drag.from[1];
      if (dx || dy) { room.points = room.points.map(([x, y]) => [round(x + dx), round(y + dy)]); drag.from = p; drag.moved = true; draw(); }
      return;
    }
    if (drag.kind === 'opening') {
      const o = f.openings.find((x) => x.id === sel?.id);
      const wall = o && nearestWall(f, w);
      if (wall && wall.dist < 1) { Object.assign(o, { roomId: wall.roomId, edge: wall.edge, t: wall.t }); drag.moved = true; draw(); }
    }
  });
  svg.addEventListener('pointerup', () => {
    if (draft?.kind === 'wall') {
      const { a, b } = draft, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      draft = null;
      if (len < 0.3) { draw(); return; }
      // A wall is stored like the other parts: centre, length (w), thickness (d) and a turn.
      const x = { id: newId(), kind: 'wall', x: round((a[0] + b[0]) / 2), y: round((a[1] + b[1]) / 2), w: round(len), d: 0.1, rot: round((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) + 360) % 360) };
      change(() => { (floor().fixtures ||= []).push(x); sel = { type: 'fixture', id: x.id }; });
      sfx('blip');
      return;
    }
    if (draft?.kind === 'rect') {
      const pts = rectPts(draft.a, draft.b), b = bbox(pts);
      draft = null;
      if (b.w >= 0.4 && b.h >= 0.4) addRoom(pts);
      else draw();
      return;
    }
    if (drag && drag.kind !== 'pan' && drag.moved) { undo.push(drag.before); redo.length = 0; save(); panel(); }
    drag = null;
  });
  svg.addEventListener('dblclick', () => { if (draft?.kind === 'poly' && draft.pts.length >= 3) finishPoly(); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(k, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  function zoomAt(k, cx, cy) {
    const z = Math.min(400, Math.max(6, view.z * k));
    view.x = cx - ((cx - view.x) * z) / view.z;
    view.y = cy - ((cy - view.y) * z) / view.z;
    view.z = z;
    draw();
  }
  function fit() {
    const pts = floor().rooms.flatMap((r) => r.points);
    const t = house.trace[floor().id];
    if (t) pts.push([t.x, t.y], [t.x + t.w * t.scale, t.y + t.h * t.scale]);
    const r = svg.getBoundingClientRect();
    if (!pts.length || !r.width) { view = { x: 80, y: 80, z: 50 }; return draw(); }
    const b = bbox(pts), pad = 60;
    view.z = Math.min(400, Math.max(6, Math.min((r.width - pad * 2) / (b.w || 1), (r.height - pad * 2) / (b.h || 1))));
    view.x = (r.width - b.w * view.z) / 2 - b.minX * view.z;
    view.y = (r.height - b.h * view.z) / 2 - b.minY * view.z;
    draw();
  }

  function addRoom(points) {
    const r = { id: newId(), name: `Room ${floor().rooms.length + 1}`, points };
    change(() => { floor().rooms.push(r); sel = { type: 'room', id: r.id }; tool = 'select'; });
    sfx('blip');
    setTimeout(() => $('[data-rname]', side)?.select(), 30);
  }
  function finishPoly() {
    const pts = draft.pts;
    draft = null;
    if (pts.length >= 3 && area(pts) > 0.2) addRoom(pts); else draw();
  }
  function finishScale() {
    const [a, b] = scaleClicks;
    scaleClicks = null;
    const lenNow = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const real = Number(String(prompt('How long is that in real life, in metres? (e.g. 4.2)') || '').replace(',', '.'));
    if (!(real > 0) || !(lenNow > 0)) { draw(); return; }
    const t = house.trace[floor().id];
    const k = real / lenNow;
    change(() => { t.scale *= k; t.x = a[0] + (t.x - a[0]) * k; t.y = a[1] + (t.y - a[1]) * k; });
    fit();
    toast(`Scale set: the picture is now ${(t.w * t.scale).toFixed(1)} m wide`);
  }

  // ---------- keyboard ----------
  const onKey = (e) => {
    if (!el.isConnected || e.target.matches?.('input, select, textarea') || document.querySelector('.sheet-backdrop')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) restore(redo, undo); else restore(undo, redo); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); restore(redo, undo); }
    else if (e.key === 'Escape') { if (draft || scaleClicks) { draft = null; scaleClicks = null; draw(); } else close(); }
    else if (e.key === 'Enter' && draft?.kind === 'poly' && draft.pts.length >= 3) finishPoly();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) deleteSel();
  };
  document.addEventListener('keydown', onKey);
  function selFixture() { return sel?.type === 'fixture' ? (floor().fixtures || []).find((x) => x.id === sel.id) : null; }
  function deleteSel() {
    const f = floor();
    change(() => {
      if (sel.type === 'room') { f.rooms = f.rooms.filter((r) => r.id !== sel.id); f.openings = f.openings.filter((o) => o.roomId !== sel.id); }
      else if (sel.type === 'fixture') f.fixtures = (f.fixtures || []).filter((x) => x.id !== sel.id);
      else f.openings = f.openings.filter((o) => o.id !== sel.id);
      sel = null;
    });
  }

  // ---------- buttons & fields ----------
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) { tool = b.dataset.tool; draft = null; scaleClicks = null; if (tool !== 'select') sel = null; sfx('click'); draw(); panel(); if (tool === 'trace') loadTrace(); }
    else if (b.dataset.floor) { fi = Number(b.dataset.floor); sel = null; draft = null; loadTrace(); panel(); fit(); }
    else if ('addfloor' in b.dataset) {
      if (house.floors.length >= 8) return toast('That’s the maximum of 8 floors.');
      change(() => { const below = floor(); house.floors.push({ id: newId(), name: `Floor ${house.floors.length}`, height: below.height, rooms: [], openings: [], fixtures: [] }); fi = house.floors.length - 1; sel = null; });
      toast('New floor added. The floor below shows faintly so you can line rooms up.');
    }
    else if ('delfloor' in b.dataset) {
      if (!(await confirmBox(`Delete ${floor().name}?`, 'Its rooms, doors and windows are deleted too (Undo brings them back).', { ok: 'Delete', danger: true }))) return;
      change(() => { delete house.trace[floor().id]; house.floors.splice(fi, 1); fi = Math.max(0, fi - 1); sel = null; });
    }
    else if (b.dataset.template) {
      const t = TEMPLATES[b.dataset.template];
      change(() => { house = sanitizeHouse({ ...t.make(), trace: {}, model: house.model }); fi = 0; sel = null; });
      fit();
      toast(`${t.name} loaded — now rename and resize the rooms to match your home.`);
    }
    else if ('delsel' in b.dataset) deleteSel();
    else if ('fxturn' in b.dataset) { const x = selFixture(); if (x) change(() => { x.rot = (x.rot + 90) % 360; }); }
    else if (b.dataset.zoom) { const r = svg.getBoundingClientRect(); zoomAt(Number(b.dataset.zoom), r.width / 2, r.height / 2); }
    else if ('fit' in b.dataset) fit();
    else if ('undo' in b.dataset) restore(undo, redo);
    else if ('redo' in b.dataset) restore(redo, undo);
    else if ('done' in b.dataset) close();
    else if ('setscale' in b.dataset) { scaleClicks = []; draw(); }
    else if ('traceremove' in b.dataset) { await files.del(`trace:${floor().id}`); change(() => { delete house.trace[floor().id]; }); loadTrace(); }
    else if ('modelremove' in b.dataset) { await files.del('model'); change(() => { house.model = null; }); }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target, f = floor();
    const room = sel?.type === 'room' && f.rooms.find((r) => r.id === sel.id);
    const op = sel?.type === 'opening' && f.openings.find((o) => o.id === sel.id);
    const n = Number(t.value);
    if (t.matches('[data-snap]')) { snapStep = n; return; }
    if (t.matches('[data-rname]') && room) change(() => { room.name = t.value.trim() || room.name; });
    else if (t.matches('[data-rw], [data-rh]') && room && n >= 0.3) change(() => { const b = bbox(room.points), w = t.matches('[data-rw]') ? n : b.w, h = t.matches('[data-rh]') ? n : b.h; room.points = rectPts([b.minX, b.minY], [b.minX + w, b.minY + h]); });
    else if (t.matches('[data-rheight]') && room) change(() => { room.height = n; });
    else if (t.matches('[data-owidth]') && op) change(() => { op.width = n; });
    else if (t.matches('[data-okind]') && op && OPENING_KINDS[t.value]) change(() => { op.kind = t.value; op.width = OPENING_KINDS[t.value].width; });
    else if (t.matches('[data-fxkind]') && selFixture() && FIXTURE_KINDS[t.value]) change(() => { const x = selFixture(), k = FIXTURE_KINDS[t.value]; x.kind = t.value; x.w = k.w; x.d = k.d; });
    else if (t.matches('[data-fxw]') && selFixture() && n > 0) change(() => { const x = selFixture(); x.w = Math.max(FIXTURE_KINDS[x.kind].min, n); if (x.kind === 'spiral') x.d = x.w; });
    else if (t.matches('[data-fxd]') && selFixture() && n > 0) change(() => { const x = selFixture(); x.d = Math.max(x.kind === 'wall' ? 0.05 : FIXTURE_KINDS[x.kind].min, n); });
    else if (t.matches('[data-fxrot]') && selFixture() && Number.isFinite(n)) change(() => { selFixture().rot = ((n % 360) + 360) % 360; });
    else if (t.matches('[data-fname]')) change(() => { f.name = t.value.trim() || f.name; });
    else if (t.matches('[data-fheight]')) change(() => { f.height = n; });
    else if (t.matches('[data-tx], [data-ty], [data-topacity]')) change(() => { const tr = house.trace[f.id]; if (t.matches('[data-tx]')) tr.x = n; else if (t.matches('[data-ty]')) tr.y = n; else tr.opacity = n; });
    else if (t.matches('[data-mscale], [data-mrot], [data-mx], [data-my], [data-mfloor]')) change(() => { const m = house.model; if (t.matches('[data-mfloor]')) m.floorId = t.value; else m[{ mscale: 'scale', mrot: 'rot', mx: 'x', my: 'y' }[Object.keys(t.dataset)[0]]] = n; });
    else if (t.matches('[data-traceupload]') && t.files[0]) uploadTrace(t.files[0]);
    else if (t.matches('[data-modelupload]') && t.files[0]) uploadModel(t.files[0]);
  });
  el.addEventListener('input', (e) => { if (e.target.matches('[data-topacity]')) { const img = $('[data-trace]', svg); if (img) img.setAttribute('opacity', e.target.value); } });

  async function uploadTrace(file) {
    if (!/^image\//.test(file.type)) return toast('That isn’t a picture. Use a PNG, JPG or screenshot of the floor plan.', { kind: 'err' });
    if (file.size > 25 * 1048576) return toast('That picture is over 25 MB — try a smaller one.', { kind: 'err' });
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Couldn’t read that picture.')); i.src = url; }).catch((x) => { toast(x.message, { kind: 'err' }); return null; });
    URL.revokeObjectURL(url);
    if (!img) return;
    try { await files.put(`trace:${floor().id}`, file); } catch (x) { return toast(x.message, { kind: 'err' }); }
    // Start at 15 m wide until the real scale is set.
    change(() => { house.trace[floor().id] = { scale: 15 / img.naturalWidth, x: 0, y: 0, opacity: 0.5, w: img.naturalWidth, h: img.naturalHeight }; });
    await loadTrace();
    fit();
    toast('Picture loaded. Next: press “Set scale”.');
  }
  async function uploadModel(file) {
    const kind = (file.name.split('.').pop() || '').toLowerCase();
    if (!['glb', 'gltf', 'obj', 'usdz'].includes(kind)) return toast('Use a .glb, .gltf, .obj or .usdz file.', { kind: 'err' });
    if (file.size > 150 * 1048576) return toast('That file is over 150 MB — export a smaller/lower-detail version from the app.', { kind: 'err' });
    if (kind === 'glb') { const head = new Uint8Array(await file.slice(0, 4).arrayBuffer()); if (String.fromCharCode(...head) !== 'glTF') return toast('That .glb file looks damaged.', { kind: 'err' }); }
    try { await files.put('model', file); } catch (x) { return toast(x.message, { kind: 'err' }); }
    change(() => { house.model = { name: file.name, kind, size: file.size, scale: 1, x: 0, y: 0, rot: 0, floorId: floor().id }; });
    toast('3D scan saved. You’ll see it on the 3D map.');
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    clearTimeout(saveTimer);
    if (traceUrl) URL.revokeObjectURL(traceUrl);
    S.api('/house?final=1', { method: 'PUT', body: house }).then((h) => { S.house = h; onClose?.(h); }).catch((x) => toast(x.message, { kind: 'err' }));
    el.remove();
  }

  const round = (n) => Math.round(n * 1000) / 1000;
  new ResizeObserver(() => draw()).observe($('[data-canvasbox]', el));
  draw(); panel();
  requestAnimationFrame(fit);
  loadTrace();
  svg.focus();
  return { close, get house() { return house; } };
}
