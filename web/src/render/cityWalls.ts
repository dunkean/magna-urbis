/** City walls — fortification structures of Rust `urban::fortification` in plan.
 *
 * One renderer-independent geometry per enclosure (cached): the curtain body as offset
 * centrelines (inner face at -h, body to c - h, broken at land gate passages, water
 * spans as arcades), and filled structures in draw order: ditch, glacis, outworks and
 * bastions, towers, gatehouses, lean-tos. Three back ends read it:
 *  - Canvas 2D (drawCity, the parchment plan and the 3D plan texture),
 *  - WebGL2 (cityGl: curtain as wall stroke instances, structures as one small mesh),
 *  - SVG (terrainUrban).
 * Enclosures without the new fields (older engines) are left to the legacy wall drawing:
 * cityWallDetails() returns undefined for them. */
import type { Enclosure, Point, Shape } from '../../../rust/bridge/urban';
import type { Box, CityLod, CityPalette, CityScene } from './cityCanvas';
import { META, STROKE_STRIDE, type CityGlStrokes } from './cityGlBuild';
import { earcut } from './cityGlEarcut';

// ---------------------------------------------------------------- geometry
type Family = 'stone' | 'earth' | 'brick' | 'rampart' | 'timber' | 'hedge';
type Cat = 'ditchWet' | 'ditchDry' | 'glacis' | 'work' | 'bastion' | 'citadel' | 'tower' | 'gatehouse' | 'attached' | 'gateRoof';
/** Draw order; ground categories go under the streets. */
const CATS: Cat[] = ['ditchWet', 'ditchDry', 'glacis', 'citadel', 'bastion', 'work', 'tower', 'gatehouse', 'attached', 'gateRoof'];
const GROUND = new Set<Cat>(['ditchWet', 'ditchDry', 'glacis']);
const CASTS = new Set<Cat>(['citadel', 'bastion', 'work', 'tower', 'gatehouse', 'attached']);
// Bastions and the citadel are the trace itself: they show from the town view.
const CAT_LOD: Record<Cat, CityLod> = { ditchWet: 'mid', ditchDry: 'mid', glacis: 'mid', citadel: 'far', bastion: 'far', work: 'mid', tower: 'mid', gatehouse: 'mid', attached: 'near', gateRoof: 'close' };
const LOD_ORDER: CityLod[] = ['close', 'near', 'mid', 'far'];
const shown = (cat: Cat, lod: CityLod): boolean => LOD_ORDER.indexOf(lod) <= LOD_ORDER.indexOf(CAT_LOD[cat]);

/** `attached`: index in `Enclosure.attached` (lean-tos only). */
export interface WallPoly { cat: Cat; family: Family; shape: Shape; attached?: number }
export interface WallPiece { points: Point[]; closed: boolean; water: boolean }
export interface WallDetail {
  kind: string; style: string; family: Family;
  /** Curtain width (m, from the inner face outward), the body centre offset (outward) and the dark edge. */
  width: number; offset: number; edge: number;
  /** Earth bank under a timber palisade (gord), stake line only (palisade, hedge). */
  bank: boolean; stakes: boolean;
  pieces: WallPiece[]; polys: WallPoly[]; box: Box;
}

const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
function signedArea(r: readonly Point[]): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
interface Ring { pts: Point[]; cum: number[]; length: number; out: number }
function ringOf(path: readonly Point[]): Ring | undefined {
  const pts: Point[] = [];
  for (const p of path) if (Number.isFinite(p.x) && Number.isFinite(p.y) && (!pts.length || dist(pts[pts.length - 1], p) > 1e-6)) pts.push(p);
  while (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
  if (pts.length < 3) return undefined;
  const cum = [0];
  for (let i = 0; i < pts.length; i++) cum.push(cum[i] + dist(pts[i], pts[(i + 1) % pts.length]));
  // Counter-clockwise rings (positive area) have their outside on the right of each edge.
  return { pts, cum, length: cum[pts.length], out: signedArea(pts) > 0 ? 1 : -1 };
}
/** Arc length of the point of the ring nearest to p. */
function project(r: Ring, p: Point): { s: number; d: number; tangent: Point } {
  let best = { s: 0, d: Infinity, tangent: { x: 1, y: 0 } };
  for (let i = 0, n = r.pts.length; i < n; i++) {
    const a = r.pts[i], b = r.pts[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)), d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d < best.d) { const l = Math.sqrt(l2); best = { s: r.cum[i] + t * l, d, tangent: { x: dx / l, y: dy / l } }; }
  }
  return best;
}
const wrap = (r: Ring, s: number): number => ((s % r.length) + r.length) % r.length;
function pointAt(r: Ring, s: number): Point {
  s = wrap(r, s);
  let lo = 0, hi = r.pts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (r.cum[m] <= s) lo = m; else hi = m - 1; }
  const a = r.pts[lo], b = r.pts[(lo + 1) % r.pts.length], l = r.cum[lo + 1] - r.cum[lo], t = l > 0 ? (s - r.cum[lo]) / l : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
/** The ring between arc lengths s0 < s1 (s1 may pass the start once). */
function subPath(r: Ring, s0: number, s1: number): Point[] {
  const n = r.pts.length, out = [pointAt(r, s0)], base = Math.floor(s0 / r.length) * r.length;
  for (let j = 0; j < 3 * n; j++) {
    const v = base + Math.floor(j / n) * r.length + r.cum[j % n];
    if (v > s0 + 1e-6 && v < s1 - 1e-6) out.push(r.pts[j % n]);
    if (v >= s1) break;
  }
  out.push(pointAt(r, s1));
  return out;
}
/** Offset a polyline along the outward normal (mitred joins, bounded). */
function offsetLine(points: readonly Point[], d: number, out: number, closed: boolean): Point[] {
  const n = points.length, normals: Point[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i], b = points[(i + 1) % n], l = dist(a, b) || 1;
    normals.push({ x: out * (b.y - a.y) / l, y: -out * (b.x - a.x) / l });
  }
  if (!normals.length) return points.slice();
  return points.map((p, i) => {
    const prev = closed ? normals[(i - 1 + segs) % segs] : normals[Math.max(0, i - 1)], next = closed ? normals[i % segs] : normals[Math.min(segs - 1, i)];
    let mx = prev.x + next.x, my = prev.y + next.y; const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = next.x; my = next.y; } else { mx /= ml; my /= ml; }
    const k = d / Math.max(0.4, mx * next.x + my * next.y);
    return { x: p.x + mx * k, y: p.y + my * k };
  });
}

function familyOf(e: Enclosure): Family {
  switch (e.material) {
    case 'stone': return 'stone';
    case 'earth-stone': return 'rampart';
    case 'rammed-earth': return 'earth';
    case 'brick': return 'brick';
    case 'timber': case 'timber-earth': return 'timber';
    case 'thorn': return 'hedge';
  }
  return e.kind === 'palisade' ? 'timber' : e.kind === 'hedge' ? 'hedge' : 'stone';
}
const hasDetail = (e: Enclosure): boolean => !!e.style || (e.curtain_width_m ?? 0) > 0 || !!e.towers_detail?.length;

const details = new WeakMap<Enclosure, WallDetail | null>();
/** Drawable geometry of a detailed enclosure; undefined for a legacy one. */
export function wallDetail(e: Enclosure): WallDetail | undefined {
  let d = details.get(e);
  if (d === undefined) { try { d = hasDetail(e) ? buildDetail(e) ?? null : null; } catch (error) { console.warn('Enceinte détaillée illisible, tracé simple conservé', error); d = null; } details.set(e, d); }
  return d ?? undefined;
}
function buildDetail(e: Enclosure): WallDetail | undefined {
  const r = ringOf(e.path); if (!r) return undefined;
  const family = familyOf(e), style = e.style ?? '', wall = e.kind === 'wall';
  const width = (e.curtain_width_m ?? 0) > 0 ? e.curtain_width_m! : wall ? 3 : 1.5, h = wall ? 1.5 : 0.75;
  const bank = style === 'gord' || family === 'timber' && width > 3, stakes = family === 'timber' || family === 'hedge';
  // Water spans: the curtain between the two banks of a water gate stands on arches.
  const cuts: Array<{ a: number; b: number; water: boolean }> = [], waterEnds: number[] = [];
  for (const g of e.gatehouses ?? []) if (g.kind === 'water' && g.passage?.length === 2) {
    const sa = project(r, g.passage[0]).s, sb = project(r, g.passage[1]).s, ab = wrap(r, sb - sa);
    if (ab < 1e-3 || r.length - ab < 1e-3) continue;
    if (ab <= r.length / 2) cuts.push({ a: sa, b: sa + ab, water: true }); else cuts.push({ a: sb, b: sb + r.length - ab, water: true });
    waterEnds.push(sa, sb);
  }
  // Land gates: the passage of the gatehouse (street width + 1), measured along the curtain.
  e.gates.forEach((gate, i) => {
    const at = project(r, gate);
    if (waterEnds.some(s => Math.min(wrap(r, s - at.s), wrap(r, at.s - s)) < 2)) return;
    let half = 3, best = Infinity;
    for (const g of e.gatehouses ?? []) if (g.gate === i && g.kind !== 'water' && g.passage?.length === 2) {
      const near = dist(g.passage[0], gate); if (near >= best) continue;
      const sx = g.passage[1].x - g.passage[0].x, sy = g.passage[1].y - g.passage[0].y, sl = Math.hypot(sx, sy) || 1;
      const sin = Math.abs(sx * at.tangent.y - sy * at.tangent.x) / sl;
      half = (g.passage_width_m > 0 ? g.passage_width_m : 6) / 2 / Math.max(0.5, sin); best = near;
    }
    cuts.push({ a: at.s - half - 0.25, b: at.s + half + 0.25, water: false });
  });
  const pieces: WallPiece[] = [], offset = width / 2 - h;
  const piece = (points: Point[], closed: boolean, water: boolean): void => { if (points.length >= 2) pieces.push({ points: offsetLine(points, offset, r.out, closed), closed, water }); };
  if (!cuts.length) piece(r.pts, true, false);
  else {
    const kind = (s: number): 0 | 1 | 2 => { // 0 gap, 1 water, 2 solid
      let water = false;
      for (const c of cuts) { const t = wrap(r, s - c.a); if (t < c.b - c.a) { if (!c.water) return 0; water = true; } }
      return water ? 1 : 2;
    };
    const marks = [...new Set(cuts.flatMap(c => [wrap(r, c.a), wrap(r, c.b)]).map(s => Math.round(s * 1000) / 1000))].sort((a, b) => a - b);
    const runs: Array<{ a: number; b: number; k: 0 | 1 | 2 }> = [];
    for (let i = 0; i < marks.length; i++) {
      const a = marks[i], b = i + 1 < marks.length ? marks[i + 1] : marks[0] + r.length;
      if (b - a < 1e-3) continue;
      const k = kind((a + b) / 2), last = runs[runs.length - 1];
      if (last && last.k === k && Math.abs(last.b - a) < 1e-6) last.b = b; else runs.push({ a, b, k });
    }
    if (runs.length > 1) { const first = runs[0], last = runs[runs.length - 1]; if (first.k === last.k && Math.abs(last.b - (first.a + r.length)) < 1e-6) { first.a = last.a - r.length; runs.pop(); } }
    for (const run of runs) if (run.k) piece(subPath(r, run.a, run.b), false, run.k === 1);
  }
  const polys: WallPoly[] = [], add = (cat: Cat, shape: Shape | undefined, fam: Family = family): void => { if ((shape?.outer?.length ?? 0) >= 3) polys.push({ cat, family: fam, shape: shape! }); };
  for (const d of e.ditch ?? []) add(d.kind === 'wet' ? 'ditchWet' : 'ditchDry', d.shape);
  for (const w of e.outworks ?? []) add(w.kind === 'glacis' ? 'glacis' : w.kind === 'citadel' ? 'citadel' : 'work', w.shape);
  for (const b of e.bastions ?? []) add('bastion', b.shape);
  const towerFamily: Family = family === 'hedge' ? 'timber' : family;
  for (const t of e.towers_detail ?? []) add('tower', t.footprint, towerFamily);
  for (const g of e.gatehouses ?? []) {
    const fam: Family = g.kind === 'timber' ? 'timber' : towerFamily;
    // Only the masses are built: the passage between them stays open (no mass, no gatehouse drawn).
    for (const m of g.masses ?? []) add(g.kind === 'ravelin' ? 'work' : 'gatehouse', m, fam);
    if (g.kind !== 'ravelin' && g.kind !== 'water' && g.masses?.length) add('gateRoof', g.shape, fam);
  }
  (e.attached ?? []).forEach((a, i) => { if ((a.shape?.outer?.length ?? 0) >= 3) polys.push({ cat: 'attached', family, shape: a.shape, attached: i }); });
  polys.sort((a, b) => CATS.indexOf(a.cat) - CATS.indexOf(b.cat));
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (p: Point): void => { if (p.x < box.minX) box.minX = p.x; if (p.y < box.minY) box.minY = p.y; if (p.x > box.maxX) box.maxX = p.x; if (p.y > box.maxY) box.maxY = p.y; };
  r.pts.forEach(grow); for (const p of polys) p.shape.outer.forEach(grow);
  box.minX -= width; box.minY -= width; box.maxX += width; box.maxY += width;
  return { kind: e.kind, style, family, width, offset, edge: Math.min(2, Math.max(0.5, width * 0.2)), bank, stakes, pieces, polys, box };
}

const sceneDetails = new WeakMap<CityScene, Array<WallDetail | undefined>>();
/** Detail of each scene wall (same order as scene.walls); undefined = legacy drawing. */
export function cityWallDetails(scene: CityScene): Array<WallDetail | undefined> {
  let list = sceneDetails.get(scene);
  if (!list) {
    // A lean-to that became a built faubourg lot (provenance `lean-to:<e>:<i>`, a use
    // other than open land) is drawn as that lot's building, not a second time as a
    // wall structure; a lean-to lot left open keeps its lean-to.
    const taken = new Set<string>();
    for (const p of scene.parcels) {
      if (!p.allocation || (p.allocation.role ?? '').startsWith('open.')) continue;
      for (const tag of p.source.provenance ?? []) if (tag.startsWith('lean-to:')) taken.add(`${p.layout}:${tag.slice(8)}`);
    }
    list = scene.layouts.flatMap((l, li) => (l.enclosures ?? []).map((e, ei) => {
      const d = wallDetail(e);
      if (!d || !taken.size || !d.polys.some(p => p.attached !== undefined && taken.has(`${li}:${ei}:${p.attached}`))) return d;
      return { ...d, polys: d.polys.filter(p => p.attached === undefined || !taken.has(`${li}:${ei}:${p.attached}`)) };
    }));
    if (list.length !== scene.walls.length) list = scene.walls.map(() => undefined);
    sceneDetails.set(scene, list);
  }
  return list;
}
const legacyScenes = new WeakMap<CityScene, CityScene>();
/** The scene with its legacy walls only (old stroke and disc-tower drawing). */
export function cityLegacyWalls(scene: CityScene): CityScene {
  let s = legacyScenes.get(scene);
  if (!s) { const d = cityWallDetails(scene); s = d.some(Boolean) ? { ...scene, walls: scene.walls.filter((_, i) => !d[i]) } : scene; legacyScenes.set(scene, s); }
  return s;
}

// ---------------------------------------------------------------- paint
interface Tone { edge: string; fill: string; tower: string; gate: string; dark: string }
const TONES: Record<Family, Tone> = {
  stone: { edge: '#4b443b', fill: '#b6a793', tower: '#81776a', gate: '#6c6256', dark: '#2f2a24' },
  earth: { edge: '#6a5236', fill: '#cdb084', tower: '#a9895f', gate: '#957650', dark: '#3f2f1d' },
  brick: { edge: '#4f4640', fill: '#aaa094', tower: '#857a6e', gate: '#73695f', dark: '#2c2622' },
  rampart: { edge: '#34332a', fill: '#9d9774', tower: '#7d7a60', gate: '#6d6b55', dark: '#24231a' },
  timber: { edge: '#72533a', fill: '#a08a64', tower: '#6b4a2e', gate: '#93704b', dark: '#3e2a19' },
  hedge: { edge: '#4f6b3a', fill: '#7d9461', tower: '#4f6b3a', gate: '#6b5a3a', dark: '#33452a' },
};
const INK: Tone = { edge: '#3c3024', fill: '#e3d1b5', tower: '#6b5640', gate: '#5c4a37', dark: '#3c3024' };
/** Parchment: engraved double-line ramparts, solid ink towers and gates. */
const PARCH: Tone = { edge: '#3b2c1c', fill: '#ece0bf', tower: '#4e3b28', gate: '#4a3826', dark: '#3b2c1c' };
const tone = (family: Family, palette: CityPalette): Tone => palette === 'parchment' ? (family === 'hedge' ? { ...PARCH, edge: '#4f5a33' } : PARCH)
  : palette === 'ink' ? INK : TONES[family];
interface Ink { fill?: string; fillAlpha: number; edge?: string; edgeAlpha: number }
const ink = (fill: string | undefined, fillAlpha: number, edge: string | undefined, edgeAlpha = 1): Ink => ({ fill, fillAlpha, edge, edgeAlpha });
function polyInk(cat: Cat, family: Family, palette: CityPalette, painted: boolean): Ink {
  const t = tone(family, palette), parch = palette === 'parchment', inkP = palette === 'ink';
  switch (cat) {
    case 'ditchWet': return parch ? ink('#bccbc8', 1, PARCH.edge, 0.7) : inkP ? ink('#c9d3cc', 1, INK.edge, 0.7) : ink(painted ? '#86abb9' : '#93b8c6', 0.95, '#5f8797', 0.9);
    case 'ditchDry': return parch ? ink('#d8c79a', 0.85, PARCH.edge, 0.45) : inkP ? ink('#c9b48f', 0.55, INK.edge, 0.4) : ink('#8a7a5e', 0.45, '#6f624a', 0.5);
    case 'glacis': return parch ? ink('#efe4c4', 0.6, PARCH.edge, 0.3) : inkP ? ink('#e3d1b5', 0.4, INK.edge, 0.3) : ink('#d8ccb0', 0.35, '#8f8268', 0.35);
    case 'citadel': return ink(parch ? '#e6d6a8' : inkP ? INK.fill : '#d4c8a8', 1, t.edge);
    case 'work': case 'bastion': return ink(parch ? '#e6d6a8' : t.fill, 1, t.edge);
    case 'tower': return ink(t.tower, 1, t.dark);
    case 'gatehouse': return ink(t.gate, 1, t.dark);
    case 'attached': return parch ? ink('#4a3826', 1, PARCH.edge) : inkP ? ink('#6b5640', 1, INK.edge) : ink(painted ? '#8a5c45' : '#7a6a58', 1, '#2e261d', 0.8);
    case 'gateRoof': return ink(undefined, 0, t.dark, 0.55);
  }
}
/** Curtain strokes: body (dark edge band, or the earth bank), light core, stakes, arcade. */
function curtainInk(d: WallDetail, palette: CityPalette): { body?: string; core?: string; stakes?: string; arcade: string } {
  const t = tone(d.family, palette);
  if (d.stakes) return { body: d.bank ? (palette === 'parchment' ? '#d8c79a' : palette === 'ink' ? '#c9b48f' : t.fill) : undefined, stakes: t.edge, arcade: t.edge };
  return { body: t.edge, core: t.fill, arcade: t.edge };
}
const SHADOW = '#16120a', SHADOW_ALPHA = 0.28;
const paintedBackground = (): boolean => globalThis.document?.documentElement.dataset.cityBackground === 'render';
const shadowShift = (mpp: number): Point => { const dx = Math.max(2.2, 1.1 * mpp); return { x: dx, y: 0.8 * dx }; };

// ---------------------------------------------------------------- Canvas 2D
export interface CityWallDraw { viewport: Box; mpp: number; lod: CityLod; palette: CityPalette }
interface CanvasCache { polys: Map<string, { cat: Cat; family: Family; path: Path2D }>; solid: Path2D; closedSolid: Path2D; water: Path2D }
const canvasCache = new WeakMap<WallDetail, CanvasCache>();
function shapePath(path: Path2D, s: Shape): void {
  for (const ring of [s.outer, ...(s.holes ?? [])]) {
    if (!ring || ring.length < 3) continue;
    path.moveTo(ring[0].x, ring[0].y); for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y); path.closePath();
  }
}
function linePath(path: Path2D, points: readonly Point[], closed: boolean): void {
  path.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y); if (closed) path.closePath();
}
function canvasOf(d: WallDetail): CanvasCache {
  let c = canvasCache.get(d);
  if (!c) {
    c = { polys: new Map(), solid: new Path2D(), closedSolid: new Path2D(), water: new Path2D() };
    for (const p of d.polys) { const key = `${p.cat}|${p.family}`; let g = c.polys.get(key); if (!g) { g = { cat: p.cat, family: p.family, path: new Path2D() }; c.polys.set(key, g); } shapePath(g.path, p.shape); }
    for (const p of d.pieces) linePath(p.water ? c.water : p.closed ? c.closedSolid : c.solid, p.points, p.closed);
    canvasCache.set(d, c);
  }
  return c;
}
const overlaps = (a: Box, b: Box): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
function fillPolys(ctx: CanvasRenderingContext2D, d: WallDetail, o: CityWallDraw, ground: boolean, painted: boolean): void {
  const px = o.mpp;
  for (const g of canvasOf(d).polys.values()) {
    if (GROUND.has(g.cat) !== ground || !shown(g.cat, o.lod)) continue;
    const k = polyInk(g.cat, g.family, o.palette, painted);
    if (k.fill && k.fillAlpha > 0) { ctx.globalAlpha = k.fillAlpha; ctx.fillStyle = k.fill; ctx.fill(g.path, 'nonzero'); }
    if (k.edge && k.edgeAlpha > 0) { ctx.globalAlpha = k.edgeAlpha; ctx.strokeStyle = k.edge; ctx.lineWidth = px * (o.palette === 'parchment' ? 0.8 : 0.6); ctx.stroke(g.path); }
  }
  ctx.globalAlpha = 1;
}
/** Ditches and glacis, drawn under the streets (causeways stay visible). */
export function drawCityWallGround(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityWallDraw): void {
  if (o.lod === 'far') return;
  const painted = paintedBackground() && o.palette !== 'parchment' && o.palette !== 'ink';
  for (const d of cityWallDetails(scene)) if (d && overlaps(d.box, o.viewport)) fillPolys(ctx, d, o, true, painted);
}
/** Curtains, outworks, towers, gatehouses and lean-tos of detailed walls. */
export function drawCityWalls(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityWallDraw): void {
  const visible = cityWallDetails(scene).filter((d): d is WallDetail => !!d && overlaps(d.box, o.viewport));
  if (!visible.length) return;
  const px = o.mpp, far = o.lod === 'far', minPx = px * (far ? 1.6 : 2.4), painted = paintedBackground() && o.palette !== 'parchment' && o.palette !== 'ink';
  ctx.save(); ctx.lineJoin = 'round';
  // Painted (Render background): one ground shadow, south-east, under curtain and structures.
  if (painted && !far) {
    const s = shadowShift(px); ctx.save(); ctx.translate(s.x, s.y); ctx.globalAlpha = SHADOW_ALPHA; ctx.strokeStyle = ctx.fillStyle = SHADOW; ctx.lineCap = 'butt';
    for (const d of visible) {
      const c = canvasOf(d); ctx.lineWidth = Math.max(d.width, minPx); ctx.stroke(c.solid); ctx.stroke(c.closedSolid);
      for (const g of c.polys.values()) if (CASTS.has(g.cat) && shown(g.cat, o.lod)) ctx.fill(g.path, 'nonzero');
    }
    ctx.restore();
  }
  for (const d of visible) {
    const c = canvasOf(d), k = curtainInk(d, o.palette), body = Math.max(d.width, minPx);
    ctx.lineCap = 'butt';
    if (k.body) { ctx.strokeStyle = k.body; ctx.lineWidth = body; ctx.stroke(c.solid); ctx.stroke(c.closedSolid); }
    if (k.core && !far && d.width - 2 * d.edge > px * 0.5) { ctx.strokeStyle = k.core; ctx.lineWidth = d.width - 2 * d.edge; ctx.stroke(c.solid); ctx.stroke(c.closedSolid); }
    if (k.stakes) {
      ctx.strokeStyle = k.stakes; ctx.lineWidth = Math.max(d.family === 'hedge' ? 2 : 1.5, minPx);
      ctx.setLineDash(d.family === 'hedge' ? [Math.max(1, px * 1.5), Math.max(0.6, px)] : [Math.max(1.3, px * 2), Math.max(0.5, px)]);
      ctx.stroke(c.solid); ctx.stroke(c.closedSolid); ctx.stroke(c.water); ctx.setLineDash([]);
    } else {
      // Arcade over a water gate: piers and arches.
      ctx.strokeStyle = k.arcade; ctx.lineWidth = body; ctx.setLineDash([Math.max(2, px * 2), Math.max(1.6, px)]); ctx.stroke(c.water); ctx.setLineDash([]);
    }
    fillPolys(ctx, d, o, false, painted);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- WebGL2
/** Wall stroke instances for cityGl: legacy walls exactly as before (feature = wall
 * index), detailed walls as body / core / stakes / arcade instances (features
 * walls + 4i + k), so their colours stay in the per-feature tables. */
export function cityWallStrokes(scene: CityScene, origin: Point): CityGlStrokes {
  const details = cityWallDetails(scene), n = scene.walls.length;
  let segs = 0;
  scene.walls.forEach((w, i) => {
    const d = details[i];
    if (!d) segs += w.pieces.reduce((t, p) => t + Math.max(0, p.length - 1), 0);
    else for (const p of d.pieces) segs += (p.points.length - (p.closed ? 0 : 1)) * 3;
  });
  const buffer = new ArrayBuffer(Math.max(1, segs) * STROKE_STRIDE * 4), f = new Float32Array(buffer), u = new Uint32Array(buffer);
  let k = 0;
  const line = (points: readonly Point[], closed: boolean, width: number, minPx: number, feature: number, meta: number, butt: boolean): void => {
    let along = 0, first = -1, last = -1;
    const m = closed ? points.length : points.length - 1;
    for (let s = 0; s < m; s++) {
      const a = points[s], b = points[(s + 1) % points.length], len = dist(a, b);
      if (!(len > 1e-4)) continue;
      if (first < 0) first = k; last = k;
      const j = k++ * STROKE_STRIDE;
      f[j] = a.x - origin.x; f[j + 1] = a.y - origin.y; f[j + 2] = b.x - origin.x; f[j + 3] = b.y - origin.y; f[j + 4] = width; f[j + 5] = minPx; f[j + 6] = along; u[j + 7] = feature; u[j + 8] = meta;
      along += len;
    }
    if (butt && first >= 0) { u[first * STROKE_STRIDE + 8] |= META.buttStart; u[last * STROKE_STRIDE + 8] |= META.buttEnd; }
  };
  scene.walls.forEach((wall, i) => {
    const d = details[i];
    if (!d) { const palisade = wall.kind === 'palisade'; for (const p of wall.pieces) line(p, false, palisade ? 2 : 3.5, 2.4, i, palisade ? META.dash : 0, true); return; }
    const f0 = n + 4 * i;
    for (const p of d.pieces) {
      if (p.water) { line(p.points, false, d.stakes ? 1.5 : d.width, 2.4, f0 + 3, META.dash, true); continue; }
      if (!d.stakes || d.bank) line(p.points, p.closed, d.width, 2.4, f0, 0, !p.closed);
      // Light core without a pixel floor: a solid band when small, a double line when large.
      if (!d.stakes) line(p.points, p.closed, (d.width - 2 * d.edge) / 0.45, 0, f0 + 1, 0, !p.closed);
      else line(p.points, p.closed, d.family === 'hedge' ? 2 : 1.5, d.bank ? 2 : 2.4, f0 + 2, META.dash, !p.closed);
    }
  });
  return { data: buffer.slice(0, k * STROKE_STRIDE * 4), count: k, firstWithRank: new Array(16).fill(0) };
}
const rgbOf = (hex: string): [number, number, number] => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
/** Outer / inner colour tables of cityWallStrokes, and the legacy tower colours. */
export function cityWallColors(scene: CityScene, palette: CityPalette): { outer: Uint8Array; inner: Uint8Array; tower: [string, string] } {
  const details = cityWallDetails(scene), n = scene.walls.length, size = Math.max(1, n * 5);
  const outer = new Uint8Array(size * 4), inner = new Uint8Array(size * 4), parchment = palette === 'parchment';
  const put = (t: Uint8Array, i: number, c: string | undefined): void => { if (!c) return; const [r, g, b] = rgbOf(c); t.set([r, g, b, 255], i * 4); };
  scene.walls.forEach((w, i) => {
    const d = details[i];
    if (!d) {
      const palisade = w.kind === 'palisade';
      put(outer, i, palisade ? '#72533a' : parchment ? '#3b2c1c' : '#4b443b'); put(inner, i, palisade ? undefined : parchment ? '#6b5540' : '#b6a793');
      return;
    }
    const k = curtainInk(d, palette), f0 = n + 4 * i;
    put(outer, f0, k.body); put(inner, f0 + 1, k.core); put(outer, f0 + 2, k.stakes); put(outer, f0 + 3, k.arcade);
  });
  return { outer, inner, tower: [parchment ? '#4e3b28' : '#5a5248', parchment ? '#3b2c1c' : '#2f2a24'] };
}

const WALL_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in uint aClass;
uniform vec4 uView; uniform vec2 uShift; uniform vec4 uTint; uniform int uLines;
uniform vec4 uFill[48]; uniform vec4 uEdge[48];
out vec4 vColor;
void main() {
  int c = int(aClass);
  vec4 color = uLines == 1 ? uEdge[c] : uFill[c];
  bool visible = color.a > 0.0;
  if (uTint.a > 0.0) color = uTint;
  vColor = color;
  gl_Position = visible ? vec4((aPos + uShift) * uView.xy + uView.zw, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const WALL_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;
const MAX_CLASSES = 48;

interface WallMesh {
  positions: Float32Array; classes: Uint8Array; triangles: Uint32Array; lines: Uint32Array;
  classes_: Array<{ cat: Cat; family: Family }>;
  /** Index ranges (elements): ground, shadow-only curtain strips, cast structures, the rest; lines of the structures. */
  ground: [number, number]; strips: [number, number]; cast: [number, number]; rest: [number, number]; edges: [number, number];
}
/** Structures of the detailed walls as one triangle mesh (with curtain strips for shadows). */
export function cityWallMesh(scene: CityScene, origin: Point): WallMesh | undefined {
  const details = cityWallDetails(scene).filter((d): d is WallDetail => !!d);
  if (!details.length) return undefined;
  const pos: number[] = [], cls: number[] = [], tri: number[] = [], lin: number[] = [], classes: WallMesh['classes_'] = [], classIndex = new Map<string, number>();
  const classOf = (cat: Cat, family: Family): number => {
    const key = `${cat}|${family}`; let c = classIndex.get(key);
    if (c === undefined) { c = Math.min(MAX_CLASSES - 1, classes.length); if (classes.length < MAX_CLASSES) classes.push({ cat, family }); classIndex.set(key, c); }
    return c;
  };
  const polygon = (s: Shape, cls_: number, lines: boolean): void => {
    const rings = [s.outer, ...(s.holes ?? [])].filter(r => r && r.length >= 3), v0 = pos.length / 2, flat: number[] = [], holes: number[] = [];
    for (const ring of rings) {
      if (flat.length) holes.push(flat.length / 2);
      const closed = ring.length > 3 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y, m = closed ? ring.length - 1 : ring.length, r0 = flat.length / 2;
      for (let i = 0; i < m; i++) flat.push(ring[i].x - origin.x, ring[i].y - origin.y);
      if (lines) for (let i = 0; i < m; i++) lin.push(v0 + r0 + i, v0 + r0 + (i + 1) % m);
    }
    if (!flat.length) return;
    pos.push(...flat); for (let i = 0; i < flat.length / 2; i++) cls.push(cls_);
    for (const t of earcut(flat, holes)) tri.push(v0 + t);
  };
  const strip = (p: WallPiece, d: WallDetail, cls_: number): void => {
    const a = offsetLine(p.points, -d.width / 2, 1, p.closed), b = offsetLine(p.points, d.width / 2, 1, p.closed);
    // A closed curtain is a ring: the larger offset is the outer boundary, the other the hole.
    const [outer, inner] = Math.abs(signedArea(a)) > Math.abs(signedArea(b)) ? [a, b] : [b, a];
    polygon(p.closed ? { outer, holes: [inner] } : { outer: [...a, ...b.reverse()], holes: [] }, cls_, false);
  };
  const ranges: Record<'ground' | 'strips' | 'cast' | 'rest', [number, number]> = { ground: [0, 0], strips: [0, 0], cast: [0, 0], rest: [0, 0] };
  const section = (name: keyof typeof ranges, fill: () => void): void => { const a = tri.length; fill(); ranges[name] = [a, tri.length]; };
  const lines0 = { a: 0 };
  section('ground', () => { for (const d of details) for (const p of d.polys) if (GROUND.has(p.cat)) polygon(p.shape, classOf(p.cat, p.family), false); });
  section('strips', () => { const c = classOf('work', 'stone'); for (const d of details) for (const p of d.pieces) if (!p.water && (!d.stakes || d.bank)) strip(p, d, c); });
  lines0.a = lin.length;
  section('cast', () => { for (const d of details) for (const p of d.polys) if (CASTS.has(p.cat)) polygon(p.shape, classOf(p.cat, p.family), true); });
  section('rest', () => { for (const d of details) for (const p of d.polys) if (!GROUND.has(p.cat) && !CASTS.has(p.cat)) polygon(p.shape, classOf(p.cat, p.family), true); });
  return { positions: new Float32Array(pos), classes: new Uint8Array(cls), triangles: new Uint32Array(tri), lines: new Uint32Array(lin), classes_: classes, ...ranges, edges: [lines0.a, lin.length] };
}

export interface CityGlWallDraw { view: number[]; mpp: number; lod: CityLod; palette: CityPalette; painted: boolean; enabled: boolean }
export interface CityGlWalls {
  upload(scene: CityScene | undefined, origin: Point): void;
  /** One pass: 'ground' (ditch, glacis: before the streets), 'shadow' (painted ground shadow:
   * before the wall strokes), 'works' (after the wall strokes). Returns the draw calls issued. */
  draw(pass: 'ground' | 'shadow' | 'works', o: CityGlWallDraw): number;
  readonly bytes: number;
  dispose(): void;
}
/** GPU side of the detailed walls: one VAO, one small program, ≤ 4 draw calls a frame. */
export function createCityGlWalls(gl: WebGL2RenderingContext): CityGlWalls {
  const compile = (type: number, src: string): WebGLShader => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`cityWalls shader: ${gl.getShaderInfoLog(s)}`); return s; };
  const program = gl.createProgram()!;
  for (const [t, s] of [[gl.VERTEX_SHADER, WALL_VS], [gl.FRAGMENT_SHADER, WALL_FS]] as const) { const sh = compile(t, s); gl.attachShader(program, sh); gl.deleteShader(sh); }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`cityWalls link: ${gl.getProgramInfoLog(program)}`);
  const u = Object.fromEntries(['uView', 'uShift', 'uTint', 'uLines', 'uFill', 'uEdge'].map(n => [n, gl.getUniformLocation(program, n === 'uFill' || n === 'uEdge' ? `${n}[0]` : n)]));
  let mesh: WallMesh | undefined, vao: WebGLVertexArrayObject | undefined, buffers: WebGLBuffer[] = [], bytes = 0, colorKey = '';
  const fills = new Float32Array(MAX_CLASSES * 4), edges = new Float32Array(MAX_CLASSES * 4);
  const release = (): void => { buffers.forEach(b => gl.deleteBuffer(b)); buffers = []; if (vao) gl.deleteVertexArray(vao); vao = undefined; mesh = undefined; bytes = 0; };
  const colors = (o: CityGlWallDraw): void => {
    const key = `${o.palette}|${o.lod}|${o.painted}`; if (key === colorKey || !mesh) return; colorKey = key;
    fills.fill(0); edges.fill(0);
    mesh.classes_.forEach((c, i) => {
      if (!shown(c.cat, o.lod)) return;
      const k = polyInk(c.cat, c.family, o.palette, o.painted);
      if (k.fill && k.fillAlpha > 0) { const [r, g, b] = rgbOf(k.fill); fills.set([r / 255, g / 255, b / 255, k.fillAlpha], i * 4); }
      if (k.edge && k.edgeAlpha > 0) { const [r, g, b] = rgbOf(k.edge); edges.set([r / 255, g / 255, b / 255, k.edgeAlpha], i * 4); }
    });
  };
  return {
    upload(scene, origin) {
      release(); colorKey = '';
      mesh = scene && cityWallMesh(scene, origin);
      if (!mesh) return;
      const buffer = (target: number, data: ArrayBufferView): void => { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); buffers.push(b); bytes += data.byteLength; };
      vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
      buffer(gl.ARRAY_BUFFER, mesh.positions); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      buffer(gl.ARRAY_BUFFER, mesh.classes); gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, 0, 0);
      // One element buffer: triangles, then line pairs.
      const all = new Uint32Array(mesh.triangles.length + mesh.lines.length); all.set(mesh.triangles); all.set(mesh.lines, mesh.triangles.length);
      buffer(gl.ELEMENT_ARRAY_BUFFER, all);
      gl.bindVertexArray(null);
    },
    draw(pass, o) {
      if (!mesh || !vao || !o.enabled || o.lod === 'far' && pass !== 'works' || pass === 'shadow' && !o.painted) return 0;
      colors(o);
      gl.useProgram(program); gl.bindVertexArray(vao);
      gl.uniform4fv(u.uView, o.view); gl.uniform4fv(u.uFill, fills); gl.uniform4fv(u.uEdge, edges);
      gl.uniform2f(u.uShift, 0, 0); gl.uniform4f(u.uTint, 0, 0, 0, 0); gl.uniform1i(u.uLines, 0);
      let calls = 0;
      const tris = (r: [number, number]): void => { if (r[1] > r[0]) { gl.drawElements(gl.TRIANGLES, r[1] - r[0], gl.UNSIGNED_INT, r[0] * 4); calls++; } };
      if (pass === 'ground') tris(mesh.ground);
      else if (pass === 'shadow') {
        const s = shadowShift(o.mpp); gl.uniform2f(u.uShift, s.x, s.y); gl.uniform4f(u.uTint, 0x16 / 255, 0x12 / 255, 0x0a / 255, SHADOW_ALPHA);
        // Curtain strips and cast structures: one contiguous range. Strips are drawn under the tint only.
        tris([mesh.strips[0], mesh.cast[1]]);
      } else {
        tris([mesh.cast[0], mesh.rest[1]]);
        const [a, b] = mesh.edges;
        if (b > a) { gl.uniform1i(u.uLines, 1); gl.drawElements(gl.LINES, b - a, gl.UNSIGNED_INT, (mesh.triangles.length + a) * 4); calls++; }
      }
      gl.bindVertexArray(null);
      return calls;
    },
    get bytes() { return bytes; },
    dispose() { release(); gl.deleteProgram(program); },
  };
}

// ---------------------------------------------------------------- SVG
export interface CityWallSvgPart { d: string; fill: string; stroke: string; width: number; opacity?: number; dash?: string }
const svgCache = new WeakMap<Enclosure, Map<string, CityWallSvgPart[]>>();
const f2 = (v: number): string => (Math.round(v * 100) / 100).toString();
const svgShape = (s: Shape): string => [s.outer, ...(s.holes ?? [])].filter(r => r && r.length >= 3).map(r => `M${r.map(p => `${f2(p.x)} ${f2(p.y)}`).join('L')}Z`).join('');
/** SVG paths (world units) of a detailed enclosure, in draw order; undefined = legacy. */
export function cityWallSvg(e: Enclosure, palette: CityPalette): CityWallSvgPart[] | undefined {
  const d = wallDetail(e); if (!d) return undefined;
  let byPalette = svgCache.get(e); if (!byPalette) { byPalette = new Map(); svgCache.set(e, byPalette); }
  let parts = byPalette.get(palette);
  if (parts) return parts;
  parts = [];
  const polys = (ground: boolean): void => {
    for (const cat of CATS) {
      if (GROUND.has(cat) !== ground) continue;
      const of = d.polys.filter(p => p.cat === cat), families = [...new Set(of.map(p => p.family))];
      for (const family of families) {
        const k = polyInk(cat, family, palette, false), path = of.filter(p => p.family === family).map(p => svgShape(p.shape)).join('');
        if (path) parts!.push({ d: path, fill: k.fill ?? 'none', stroke: k.edge ?? 'none', width: 0.3, opacity: k.fill ? k.fillAlpha : k.edgeAlpha });
      }
    }
  };
  const lines = (water: boolean): string => d.pieces.filter(p => p.water === water).map(p => `M${p.points.map(q => `${f2(q.x)} ${f2(q.y)}`).join('L')}${p.closed ? 'Z' : ''}`).join('');
  polys(true);
  const k = curtainInk(d, palette), solid = lines(false), water = lines(true);
  if (k.body && solid) parts.push({ d: solid, fill: 'none', stroke: k.body, width: d.width });
  if (k.core && solid) parts.push({ d: solid, fill: 'none', stroke: k.core, width: Math.max(0.4, d.width - 2 * d.edge) });
  if (k.stakes) { const all = solid + water; if (all) parts.push({ d: all, fill: 'none', stroke: k.stakes, width: d.family === 'hedge' ? 2 : 1.5, dash: d.family === 'hedge' ? '1.5 1' : '1.3 0.5' }); }
  else if (water) parts.push({ d: water, fill: 'none', stroke: k.arcade, width: d.width, dash: '2 1.6' });
  polys(false);
  byPalette.set(palette, parts);
  return parts;
}
