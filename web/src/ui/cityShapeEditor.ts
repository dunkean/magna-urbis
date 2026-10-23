/** City Bench shape editor: vertex handles over the city plan, for one quarter or
 * one lot outline (spec `_agents_blackboard/OPUS_EDITS_SPEC.md` c.2).
 *
 * It is an SVG layer (`<g id="cityShapeEditor">`) appended to `#map`, in world
 * coordinates through the viewBox, above the city layer's foreignObject (WebGL or
 * Canvas 2D alike: no change to the renderers). Handles keep a constant screen
 * size. Interactions:
 * - drag a vertex (mouse, pen, touch); snap to the reference vertices within 4 px;
 * - press an edge (or its « + » marker) to insert a vertex there, and drag it;
 * - right-click, Alt-click or double-click a vertex, or « Retirer le sommet » on the
 *   selected one (touch / trackpad), removes it (3 minimum);
 * - Esc cancels, Enter validates, Ctrl+Z undoes; wheel zoom and pan on empty ground
 *   keep working; a capture listener on the viewport stops plan clicks from
 *   re-picking the inspector while editing.
 * The geometry helpers are pure and unit tested (`web/tests/cityShapeEditor.test.ts`). */

export interface Pt { x: number; y: number }

// ---------------------------------------------------------------- pure helpers
const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
export const signedArea = (ring: readonly Pt[]): number => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y; return s / 2; };

/** `ring` with `p` inserted after vertex `edge` (on the edge edge → edge+1). */
export function insertVertex(ring: readonly Pt[], edge: number, p: Pt): Pt[] {
  const i = ((edge % ring.length) + ring.length) % ring.length;
  return [...ring.slice(0, i + 1), { x: p.x, y: p.y }, ...ring.slice(i + 1)];
}
/** `ring` without vertex `index`; unchanged (same array) when it would drop under 3 vertices. */
export function removeVertex(ring: readonly Pt[], index: number): readonly Pt[] {
  if (ring.length <= 3 || index < 0 || index >= ring.length) return ring;
  return ring.filter((_, i) => i !== index);
}
/** Closest point of segment ab to p, its parameter and distance. */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): { t: number; point: Pt; dist: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, point, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}
/** Edge of the closed ring nearest to p (edge i joins vertex i to i+1). */
export function nearestEdge(ring: readonly Pt[], p: Pt): { edge: number; point: Pt; dist: number } {
  let best = { edge: 0, point: ring[0], dist: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const hit = projectOnSegment(p, ring[i], ring[(i + 1) % ring.length]);
    if (hit.dist < best.dist) best = { edge: i, point: hit.point, dist: hit.dist };
  }
  return best;
}
/** Proper or touching intersection of segments ab and cd. */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if ((d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0)) return true;
  const on = (p: Pt, q: Pt, r: Pt): boolean => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return d1 === 0 && on(c, d, a) || d2 === 0 && on(c, d, b) || d3 === 0 && on(a, b, c) || d4 === 0 && on(a, b, d);
}
/** True when two non-adjacent edges of the closed ring meet. O(n²), n ≤ 512. */
export function selfIntersects(ring: readonly Pt[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || i === 0 && j === n - 1) continue; // adjacent edges share a vertex
    if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
  }
  return false;
}
/** Why the ring cannot be sent, or undefined when it is a valid simple polygon. */
export function ringProblem(ring: readonly Pt[]): string | undefined {
  if (ring.length < 3) return 'Au moins 3 sommets';
  if (ring.length > 512) return 'Au plus 512 sommets';
  if (ring.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'Coordonnée invalide';
  if (selfIntersects(ring)) return 'Contour invalide (auto-intersection)';
  if (Math.abs(signedArea(ring)) < 1) return 'Contour sans surface';
  return undefined;
}
/** Rounded to 0.1 m; consecutive duplicates, the closing copy and collinear vertices dropped. */
export function cleanRing(ring: readonly Pt[]): Pt[] {
  let out: Pt[] = [];
  for (const p of ring) {
    const q = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      // Collinear within 1 cm of the chord: the vertex carries no shape.
      const l = Math.hypot(c.x - a.x, c.y - a.y);
      if (l > 0 && Math.abs(cross(a, b, c)) / l < 0.01 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) { out = out.filter((_, k) => k !== i); changed = true; i--; }
    }
  }
  return out;
}
/** Douglas–Peucker on a closed ring, split at its two farthest-apart vertices. */
function douglasPeucker(ring: readonly Pt[], eps: number): Pt[] {
  const n = ring.length;
  if (n <= 3) return ring.slice();
  const a = 0; let b = 0, far = -1;
  for (let i = 0; i < n; i++) { const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y); if (d > far) { far = d; b = i; } }
  const keep = new Uint8Array(n); keep[a] = keep[b] = 1;
  const run = (from: number, to: number): void => {
    // Indices from → to walking forward around the ring.
    const span = (to - from + n) % n; if (span < 2) return;
    let best = -1, idx = -1;
    for (let k = 1; k < span; k++) { const i = (from + k) % n, d = projectOnSegment(ring[i], ring[from], ring[to]).dist; if (d > best) { best = d; idx = i; } }
    if (best > eps) { keep[idx] = 1; run(from, idx); run(idx, to); }
  };
  run(a, b); run(b, a);
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : ring.slice(0, 3);
}
/** Quarter rings: Douglas–Peucker at ε = 0.4 m, ε doubling while over `max` vertices
 * up to 1.6 m (the engine ignores differences under 1.75 m, so an unmoved ring is no
 * edit), then further only to fit the contract's 512 vertices. */
export function simplifyRing(ring: readonly Pt[], max = 200, eps = 0.4, maxEps = 1.6): Pt[] {
  let out = douglasPeucker(ring, eps);
  for (let e = eps * 2; out.length > max && e <= maxEps; e *= 2) out = douglasPeucker(ring, e);
  for (let e = maxEps * 2; out.length > 512 && e < 1e5; e *= 2) out = douglasPeucker(ring, e);
  return out;
}
/** Lot rings: near-duplicate vertices (< 5 cm) and spikes (zero-width slits: the ring
 * turns back on itself) removed, then Douglas–Peucker at ε = 0.1 m (the engine ignores
 * differences under 0.35 m). Falls back to the raw ring when too little is left. */
export function simplifyLotRing(ring: readonly Pt[]): Pt[] {
  let out = ring.map(p => ({ x: p.x, y: p.y }));
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y);
      const spike = ab > 0 && bc > 0 && Math.abs(cross(a, b, c)) / (ab * bc) < 0.05 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0;
      if (ab < 0.05 || spike) { out.splice(i, 1); changed = true; i--; }
    }
  }
  out = douglasPeucker(out, 0.1);
  return out.length >= 3 && Math.abs(signedArea(out)) >= 1 ? out : ring.slice();
}

// ---------------------------------------------------------------- styles
const STYLE_ID = 'cityShapeEditorStyle';
/** Styles of the editor and of the inspector's structural action rows (no shared CSS file touched). */
export function ensureEditStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style'); style.id = STYLE_ID;
  style.textContent = `
#cityShapeEditor { touch-action: none; }
#cityShapeEditor .se-ghost { fill: none; stroke: #39424a; stroke-width: 1.5px; stroke-dasharray: 5 4; opacity: .75; pointer-events: none; }
#cityShapeEditor .se-draft { fill: rgba(232, 167, 40, .18); stroke: #d07c12; stroke-width: 2px; pointer-events: none; }
#cityShapeEditor.invalid .se-draft { stroke: #c0392b; fill: rgba(192, 57, 43, .14); }
#cityShapeEditor .se-edge { fill: none; stroke: transparent; stroke-width: 14px; cursor: copy; pointer-events: stroke; }
#cityShapeEditor .se-plus { fill: #fff; stroke: #d07c12; stroke-width: 1.5px; cursor: copy; opacity: .85; }
#cityShapeEditor .se-handle { fill: #fff; stroke: #d07c12; stroke-width: 2px; cursor: move; }
#cityShapeEditor .se-handle.selected { fill: #d07c12; stroke: #fff; }
#cityShapeEditor .se-handle.snapped { stroke: #1f7a55; }
.city-shape-toolbar { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 20; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: calc(100% - 32px);
  padding: 5px 8px; border-radius: 6px; background: rgba(255, 253, 246, .96); box-shadow: 0 1px 4px rgba(0, 0, 0, .25); font-size: 12px; }
.city-shape-toolbar button { width: auto; min-height: 30px; padding: 3px 10px; }
.city-shape-toolbar [data-se-problem] { color: #c0392b; }
.city-shape-toolbar [data-se-problem]:empty { display: none; }
.city-shape-toolbar small { color: #5c695f; }
.city-structural { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 5px; }
.city-structural button { width: auto; padding: 2px 7px; min-height: 26px; }
.city-structural button[data-confirming] { background: #c0392b; color: #fff; border-color: #a5281c; }
.city-structural select { width: auto; }
.city-structural .city-salt { font-size: 10px; padding: 0 5px; border-radius: 8px; background: #dfe9f3; color: #23405a; }
.city-structural-help { display: block; color: #5c695f; margin-top: 2px; }
.city-edit-warnings { margin: 4px 0 0; padding-left: 14px; color: #956228; }
.city-edits-list { display: flex; flex-direction: column; gap: 3px; width: 100%; }
.city-edits-list > div { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.city-edits { flex-wrap: wrap; }`;
  document.head.append(style);
}

// ---------------------------------------------------------------- editor
export interface ShapeEditSession {
  /** Starting ring (world metres). */
  ring: Pt[];
  /** Outline drawn as a dashed ghost (the current applied shape). */
  original: Pt[];
  /** Extra snap targets (neighbouring outlines), besides the original vertices. */
  snap?: Pt[];
  title: string;
  onCommit(ring: Pt[]): void;
  onCancel?(): void;
}
export interface ShapeEditor {
  start(session: ShapeEditSession): void;
  /** View change: rescale handles and keep the layer on top. */
  update(): void;
  /** Cancels the session (calls onCancel). */
  stop(): void;
  readonly active: boolean;
  /** Automated checks: current draft ring and problem. */
  readonly draft: { ring: Pt[]; problem?: string } | undefined;
}

const NS = 'http://www.w3.org/2000/svg';
const pathOf = (ring: readonly Pt[]): string => ring.length ? `M${ring.map(p => `${p.x} ${p.y}`).join('L')}Z` : '';

export function createShapeEditor(map: SVGSVGElement, viewport: HTMLElement): ShapeEditor {
  ensureEditStyles();
  let session: ShapeEditSession | undefined, ring: Pt[] = [], undo: Pt[][] = [], selected: number | undefined, snappedAt: number | undefined;
  let layer: SVGGElement | undefined, toolbar: HTMLDivElement | undefined, handles: SVGCircleElement[] = [], edges: SVGPathElement[] = [], pluses: SVGCircleElement[] = [];
  let ghost: SVGPathElement | undefined, draftPath: SVGPathElement | undefined;
  let drag: { index: number; pointer: number; moved: boolean; before: Pt[] } | undefined;
  /** World metres per screen pixel. */
  const pixel = (): number => map.viewBox.baseVal.width / Math.max(1, map.getBoundingClientRect().width) || 1;
  const world = (e: { clientX: number; clientY: number }): Pt => {
    const m = map.getScreenCTM()?.inverse(); const p = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m) : { x: 0, y: 0 };
    return { x: p.x, y: p.y };
  };
  const problem = (): string | undefined => ringProblem(cleanRing(ring));
  const push = (before: Pt[]): void => { undo.push(before); if (undo.length > 200) undo.shift(); };

  function el<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] { const e = document.createElementNS(NS, tag); e.setAttribute('class', cls); return e; }
  /** Rebuilds handles and edges when the vertex count changes; otherwise moves them in place. */
  function render(rebuild = false): void {
    if (!layer || !session) return;
    const px = pixel();
    if (rebuild || handles.length !== ring.length) {
      for (const e of [...handles, ...edges, ...pluses]) e.remove();
      edges = ring.map((_, i) => { const e = el('path', 'se-edge'); e.dataset.seEdge = String(i); e.setAttribute('vector-effect', 'non-scaling-stroke'); return e; });
      pluses = ring.map((_, i) => { const e = el('circle', 'se-plus'); e.dataset.seEdge = String(i); e.setAttribute('vector-effect', 'non-scaling-stroke'); return e; });
      handles = ring.map((_, i) => { const e = el('circle', 'se-handle'); e.dataset.seVertex = String(i); e.setAttribute('vector-effect', 'non-scaling-stroke'); return e; });
      layer.append(...edges, ...pluses, ...handles);
    }
    draftPath!.setAttribute('d', pathOf(ring));
    ghost!.setAttribute('d', pathOf(session.original));
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length], h = handles[i], plus = pluses[i];
      edges[i].setAttribute('d', `M${p.x} ${p.y}L${q.x} ${q.y}`);
      h.setAttribute('cx', String(p.x)); h.setAttribute('cy', String(p.y)); h.setAttribute('r', String(6 * px));
      h.classList.toggle('selected', i === selected); h.classList.toggle('snapped', i === snappedAt);
      // « + » markers only where the edge is long on screen (close zoom).
      const long = Math.hypot(q.x - p.x, q.y - p.y) / px > 48;
      plus.setAttribute('cx', String((p.x + q.x) / 2)); plus.setAttribute('cy', String((p.y + q.y) / 2)); plus.setAttribute('r', String(4 * px));
      plus.style.display = long ? '' : 'none';
    });
    const issue = problem();
    layer.classList.toggle('invalid', !!issue);
    if (toolbar) {
      toolbar.querySelector('[data-se-count]')!.textContent = `${ring.length} sommets`;
      toolbar.querySelector('[data-se-problem]')!.textContent = issue ?? '';
      toolbar.querySelector<HTMLButtonElement>('[data-se-commit]')!.disabled = !!issue;
      toolbar.querySelector<HTMLButtonElement>('[data-se-undo]')!.disabled = !undo.length;
      toolbar.querySelector<HTMLButtonElement>('[data-se-remove]')!.disabled = selected === undefined || ring.length <= 3;
    }
  }
  function remove(index: number): void {
    const next = removeVertex(ring, index);
    if (next === ring) return;
    push(ring); ring = next.slice(); selected = undefined; render(true);
  }
  function snap(p: Pt, index: number): Pt {
    const limit = 4 * pixel(); let best: Pt | undefined, dist = limit;
    for (const q of [...session!.original, ...session!.snap ?? []]) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= dist) { dist = d; best = q; } }
    snappedAt = best ? index : undefined;
    return best ? { x: best.x, y: best.y } : p;
  }
  function beginDrag(index: number, e: PointerEvent, before: Pt[]): void {
    drag = { index, pointer: e.pointerId, moved: false, before };
    selected = index;
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  }
  function onMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointer) return;
    e.preventDefault();
    drag.moved = true;
    ring = ring.slice(); ring[drag.index] = snap(world(e), drag.index); render();
  }
  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (drag.moved || drag.before.length !== ring.length) push(drag.before);
    drag = undefined; snappedAt = undefined;
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
    render();
  }
  function onPointerDown(e: PointerEvent): void {
    const target = e.target as Element, vertex = target.getAttribute('data-se-vertex'), edge = target.getAttribute('data-se-edge');
    if (vertex === null && edge === null) return; // empty ground: the viewport pans
    e.stopPropagation(); e.preventDefault();
    if (vertex !== null) {
      const i = Number(vertex);
      if (e.button === 2) return; // contextmenu removes
      if (e.altKey) { remove(i); return; }
      beginDrag(i, e, ring);
      render();
    } else if (e.button === 0) {
      const i = Number(edge), before = ring;
      ring = insertVertex(ring, i, projectOnSegment(world(e), ring[i], ring[(i + 1) % ring.length]).point);
      beginDrag(i + 1, e, before); render(true);
    }
  }
  function onContextMenu(e: MouseEvent): void {
    const vertex = (e.target as Element).getAttribute('data-se-vertex');
    e.preventDefault(); e.stopPropagation();
    if (vertex !== null) remove(Number(vertex));
  }
  function onDoubleClick(e: MouseEvent): void {
    const vertex = (e.target as Element).getAttribute('data-se-vertex');
    if (vertex === null) return;
    e.preventDefault(); e.stopPropagation(); remove(Number(vertex));
  }
  /** Capture on the viewport: plan clicks never re-pick the inspector or add pins while editing. */
  function swallowClick(e: MouseEvent): void { if (session && map.contains(e.target as Node)) { e.stopPropagation(); e.preventDefault(); } }
  function onKey(e: KeyboardEvent): void {
    if (!session) return;
    const typing = (e.target as Element | null)?.closest?.('input, textarea, select');
    if (e.key === 'Escape') { e.preventDefault(); api.stop(); }
    else if (e.key === 'Enter' && !typing) { e.preventDefault(); commit(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undoLast(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected !== undefined) { e.preventDefault(); remove(selected); }
  }
  function undoLast(): void { const prev = undo.pop(); if (!prev) return; ring = prev; selected = undefined; render(true); }
  function commit(): void {
    if (!session || problem()) return;
    const done = session, out = cleanRing(ring), start = cleanRing(done.ring);
    // Nothing moved: « Valider » is a cancel, never an edit.
    if (out.length === start.length && out.every((p, i) => p.x === start[i].x && p.y === start[i].y)) { api.stop(); return; }
    teardown(); done.onCommit(out);
  }
  function teardown(): void {
    if (drag) { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); drag = undefined; }
    layer?.remove(); toolbar?.remove(); layer = undefined; toolbar = undefined; handles = []; edges = []; pluses = []; session = undefined; undo = []; selected = undefined;
    viewport.removeEventListener('click', swallowClick, true); window.removeEventListener('keydown', onKey);
  }
  const api: ShapeEditor = {
    start(next: ShapeEditSession): void {
      if (session) api.stop();
      session = next; ring = next.ring.map(p => ({ x: p.x, y: p.y })); undo = []; selected = undefined;
      layer = document.createElementNS(NS, 'g'); layer.id = 'cityShapeEditor';
      ghost = el('path', 'se-ghost'); draftPath = el('path', 'se-draft');
      ghost.setAttribute('vector-effect', 'non-scaling-stroke'); draftPath.setAttribute('vector-effect', 'non-scaling-stroke');
      layer.append(ghost, draftPath);
      layer.addEventListener('pointerdown', onPointerDown); layer.addEventListener('contextmenu', onContextMenu); layer.addEventListener('dblclick', onDoubleClick);
      map.append(layer);
      toolbar = document.createElement('div'); toolbar.className = 'city-shape-toolbar'; toolbar.dataset.cityShapeEditor = '';
      toolbar.innerHTML = `<strong>${next.title.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</strong><span data-se-count></span><span data-se-problem role="status"></span>
        <button type="button" data-se-remove title="Retire le sommet sélectionné (aussi : clic droit, Alt-clic ou double-clic sur un sommet)">Retirer le sommet</button>
        <button type="button" data-se-undo title="Ctrl+Z">↶</button>
        <button type="button" data-se-commit title="Entrée">Valider</button><button type="button" data-se-cancel title="Échap">Annuler</button>
        <small>Glisser un sommet · appuyer sur un bord pour en ajouter un</small>`;
      toolbar.addEventListener('pointerdown', e => e.stopPropagation());
      toolbar.addEventListener('wheel', e => e.stopPropagation());
      toolbar.querySelector('[data-se-commit]')!.addEventListener('click', commit);
      toolbar.querySelector('[data-se-cancel]')!.addEventListener('click', () => api.stop());
      toolbar.querySelector('[data-se-undo]')!.addEventListener('click', undoLast);
      toolbar.querySelector('[data-se-remove]')!.addEventListener('click', () => { if (selected !== undefined) remove(selected); });
      viewport.append(toolbar);
      viewport.addEventListener('click', swallowClick, true); window.addEventListener('keydown', onKey);
      render(true);
    },
    update(): void {
      if (!session || !layer) return;
      if (map.lastChild !== layer) map.append(layer);
      render();
    },
    stop(): void {
      if (!session) return;
      const done = session; teardown(); done.onCancel?.();
    },
    get active(): boolean { return !!session; },
    get draft() { return session ? { ring: ring.slice(), problem: problem() } : undefined; },
  };
  return api;
}
