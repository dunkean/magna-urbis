/** Building volumes from the city's massing (Rust `urban/massing.rs`): every
 * preview piece of a lot carries its floors, eave height and roof (kind, rise,
 * ridges), and this module turns them into roof faces for the 2D map (shaded
 * roof pans, height shadows) and the 3D view. The building shown is the planned
 * silhouette raised in volume; no other house generator is involved. */
import type { Point, Surface, Vertex3 } from '../../../rust/bridge/housesContract';
import { treeDwelling, treeCrownFaces, type TreeDwelling } from './cityTrees';
import { roofPlaneLight } from './roofPlaneLight';
import { intersectionS, unionS } from '../gen/geo/bool';
type Shape = Surface[number];

/** Roof-top feature of a flat roof (massing.rs `flat_details`): plan centre, footprint w × d turned by `angle`, height h.
 * `sails` (wind mill, cone roof): hub at (x, y) h above the eave, blades of length w and width d in the vertical plane facing `angle`, cross turned by `turn`. */
export interface MassingFeature { kind: 'stair' | 'dome' | 'windcatcher' | 'sails'; x: number; y: number; w: number; d: number; h: number; angle: number; turn?: number }
/** Detail of a volume decided in Rust: parapet above a flat eave, roof-top features, hut roof overhang, trim colour. */
export interface VolumeDetail { openings?: 'none' | 'door'; parapet_m?: number; features?: MassingFeature[]; overhang_m?: number; trim?: string; form?: 'yurt' | 'tipi' | 'tree' | 'mushroom' | 'longhouse' | 'tower' | 'battered'; stilts_m?: number; tree_seed?: string; /** Inhabitants' size against a human (doors, windows). */ body_scale?: number; /** Facade openness 0..1 (massive warm-climate walls open less: fewer, smaller windows). */ openness?: number }
export type MassingRoof = 'gable' | 'hip' | 'shed' | 'pyramid' | 'cone' | 'dome' | 'barrel' | 'ring' | 'tent' | 'flat';
/** One sub-volume partitioning a preview piece: own ring, heights, roof and (optionally) materials. */
export interface MassingVolume extends VolumeDetail {
  ring: [number, number][]; floors?: number; eave_m: number; rise_m: number; roof: MassingRoof;
  ridges: [number, number, number, number][]; cover?: string; wall?: string; tone?: number;
  /** Bottom of the walls above the building ground (default 0). `eave_m` stays a height above the ground. */
  base_m?: number;
  /** Explicit roof faces, each `[x0,y0,z0, x1,y1,z1, ...]` (plan metres, z above the building ground): convex, already clipped
   * against the other volumes of the lot. When present (even empty: a hidden roof) they are the whole roof; `roof`, `ridges`
   * and `rise_m` derive none. With pans, `eave_m` is the lowest roof height along the walls and `rise_m` the highest pan point above it. */
  pans?: number[][];
  /** Vertical wall faces above the wall top (gable ends, the high wall under a shed roof), encoded like `pans`. */
  gables?: number[][];
  /** Small decorative volume (chimney, dormer, porch): no openings, no ground shadow, dropped by the 3D overview. */
  minor?: boolean;
  /** True roof kind (halfhip, gablet, gambrel, mansard, saltbox...), informative: `roof` stays a kind the renderers know. */
  roof_form?: string;
}
export interface MassingPiece {
  openings?: 'none' | 'door';
  floors: number; eave_m: number; rise_m: number; roof: MassingRoof;
  ridges: [number, number, number, number][]; cover: string; wall: string; tone?: number;
  volumes?: MassingVolume[];
}
/** One roof face: 3D polygon (z above the building ground) and its upward unit normal.
 * `vol` is the volume index inside the piece (0 when the piece has none), `cover`/`wall`/`tone`
 * the materials and 0..1 shade of that volume. */
export interface RoofFace { points: Vertex3[]; holes?: Point[][]; normal: [number, number, number]; piece: number; vol: number; cover: string; wall: string; tone: number }

/** A piece resolved to the volumes to draw (the piece itself when it has no `volumes`). */
export interface ResolvedVolume { shape: Shape; floors: number; eave_m: number; rise_m: number; roof: MassingRoof; ridges: [number, number, number, number][]; cover: string; wall: string; tone: number; detail?: VolumeDetail; tree?: TreeDwelling
  /** Wall bottom above the building ground, when the volume stands on another one (0 < base_m < eave_m). */ base_m?: number;
  /** Explicit roof faces (see `MassingVolume.pans`): the whole roof of the volume. */ pans?: Vertex3[][];
  /** Vertical wall faces above the wall top, drawn in the wall material; nothing in plan. */ gables?: Vertex3[][];
  minor?: boolean; roof_form?: string }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v: unknown, d = 0.5): number => finite(v) ? Math.max(0, Math.min(1, v)) : d;
/** Faces sent as flat `[x, y, z, ...]` arrays; undefined when the list or any face of it is malformed. */
function readFaces(value: unknown): Vertex3[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Vertex3[][] = [];
  for (const face of value) {
    if (!Array.isArray(face) || face.length < 9 || face.length % 3 !== 0 || !face.every(finite)) return undefined;
    const points: Vertex3[] = [];
    for (let i = 0; i < face.length; i += 3) points.push({ x: face[i], y: face[i + 1], z: face[i + 2] });
    out.push(points);
  }
  return out;
}
export function pieceVolumes(shape: Shape, m: MassingPiece): ResolvedVolume[] {
  const out: ResolvedVolume[] = [];
  if (Array.isArray(m.volumes)) for (const v of m.volumes) {
    if (!v || !Array.isArray(v.ring) || v.ring.length < 3 || !v.ring.every(q => Array.isArray(q) && finite(q[0]) && finite(q[1])) || !finite(v.eave_m) || typeof v.roof !== 'string') continue;
    out.push({ shape: { outer: v.ring.map(([x, y]) => ({ x, y })), holes: [] }, floors: finite(v.floors) ? v.floors : m.floors, eave_m: v.eave_m, rise_m: finite(v.rise_m) ? v.rise_m : 0, roof: v.roof,
      ridges: Array.isArray(v.ridges) ? v.ridges.filter(r => Array.isArray(r) && r.length === 4 && r.every(finite)) : [],
      cover: v.cover ?? m.cover, wall: v.wall ?? m.wall, tone: clamp01(v.tone, clamp01(m.tone)),
      detail: { openings: v.openings, tree_seed: typeof v.tree_seed === 'string' ? v.tree_seed : undefined, parapet_m: finite(v.parapet_m) ? v.parapet_m : undefined, overhang_m: finite(v.overhang_m) ? v.overhang_m : undefined, trim: v.trim,
        form: v.form && ['yurt', 'tipi', 'tree', 'mushroom', 'longhouse', 'tower', 'battered'].includes(v.form) ? v.form : undefined, stilts_m: finite(v.stilts_m) && v.stilts_m > 0 ? Math.min(v.stilts_m, 4) : undefined, body_scale: finite(v.body_scale) && v.body_scale > 0 ? v.body_scale : undefined, openness: finite(v.openness) && v.openness > 0 && v.openness < 1 ? v.openness : undefined,
        features: Array.isArray(v.features) ? v.features.filter(f => f && ['x', 'y', 'w', 'd', 'h', 'angle'].every(k => finite((f as unknown as Record<string, unknown>)[k]))) : undefined } });
    const resolved = out[out.length - 1], pans = readFaces(v.pans), gables = readFaces(v.gables);
    if (finite(v.base_m) && v.base_m > 0) resolved.base_m = Math.min(v.base_m, v.eave_m);
    if (pans) resolved.pans = pans;
    if (gables?.length) resolved.gables = gables;
    if (v.minor === true) resolved.minor = true;
    if (typeof v.roof_form === 'string') resolved.roof_form = v.roof_form;
  }
  if (out.length) return out.map(v => {
    if (v.detail?.form !== 'tree') return v;
    const tree = treeDwelling(v.shape.outer, v.eave_m, v.rise_m, v.detail.tree_seed ?? JSON.stringify(v.shape.outer));
    return { ...v, tree, shape: { outer: tree.outline, holes: [] }, eave_m: tree.height, rise_m: Math.max(...tree.crowns.map(c => c.z + c.height)) - tree.height };
  });
  return [{ shape, floors: m.floors, eave_m: m.eave_m, rise_m: m.rise_m, roof: m.roof, ridges: m.ridges ?? [], cover: m.cover, wall: m.wall, tone: clamp01(m.tone), ...(m.openings ? { detail: { openings: m.openings } } : {}) }];
}

/** Massing of a building's preview pieces, when the city sent one aligned with its footprint. */
export function readMassing(programme: unknown, footprint: Surface, buildingId?: string): MassingPiece[] | undefined {
  const massing = (programme as { massing?: unknown } | null | undefined)?.massing;
  if (!Array.isArray(massing) || massing.length !== footprint.length) return undefined;
  if (!massing.every(m => m && typeof m.eave_m === 'number' && typeof m.roof === 'string' && (m.ridges === undefined || Array.isArray(m.ridges)))) return undefined;
  return (massing as MassingPiece[]).map((m, i) => buildingId && m.volumes?.some(v => v.form === 'tree' && !v.tree_seed)
    ? { ...m, volumes: m.volumes.map((v, j) => v.form === 'tree' && !v.tree_seed ? { ...v, tree_seed: `${buildingId}:${i}:${j}` } : v) } : m);
}

/** Flat map outline follows the occupied massing, never its enclosing preview lot. */
export function massingFootprint(footprint: Surface, massing?: readonly MassingPiece[]): Surface {
  if (!massing) return footprint;
  // Volumes standing on another one and small decorative ones leave the ground outline (and its union) to the others.
  const shapes = footprint.flatMap((shape, i) => {
    if (!massing[i]) return [shape];
    const volumes = pieceVolumes(shape, massing[i]), grounded = volumes.filter(v => !v.minor && !v.base_m);
    return (grounded.length ? grounded : volumes).map(v => v.shape);
  });
  return shapes.length > 1 ? unionS(shapes[0], ...shapes.slice(1)) : shapes;
}

const signedArea = (ring: readonly Point[]): number => ring.reduce((s, p, i) => { const n = ring[(i + 1) % ring.length]; return s + p.x * n.y - n.x * p.y; }, 0) / 2;
function centroid(ring: readonly Point[]): Point {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], c = p.x * q.y - q.x * p.y;
    a += c; x += (p.x + q.x) * c; y += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-9) return { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
  return { x: x / (3 * a), y: y / (3 * a) };
}
/** Inward miter offset (outer rings CCW, holes CW), miter-limited. */
function insetRing(ring: readonly Point[], distance: number, outer: boolean): Point[] {
  const ccw = signedArea(ring) > 0, points = ccw === outer ? ring : [...ring].reverse(), n = points.length, out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n], p = points[i], next = points[(i + 1) % n];
    const l0 = Math.hypot(p.x - prev.x, p.y - prev.y) || 1, l1 = Math.hypot(next.x - p.x, next.y - p.y) || 1;
    const n0 = { x: -(p.y - prev.y) / l0, y: (p.x - prev.x) / l0 }, n1 = { x: -(next.y - p.y) / l1, y: (next.x - p.x) / l1 };
    const bx = n0.x + n1.x, by = n0.y + n1.y, bl = Math.hypot(bx, by);
    if (bl < 1e-6) { out.push({ x: p.x + n1.x * distance, y: p.y + n1.y * distance }); continue; }
    const k = distance / Math.max(1 / 3, (bx * n1.x + by * n1.y) / bl);
    out.push({ x: p.x + bx / bl * k, y: p.y + by / bl * k });
  }
  return ccw === outer ? out : out.reverse();
}

class Faces {
  readonly list: RoofFace[] = [];
  constructor(private piece: number, private vol = 0, private cover = '', private wall = '', private tone = 0.5) {}
  add(points: Vertex3[]): void {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y);
    }
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    const s = nz < 0 ? -1 : 1;
    this.list.push({ points, normal: [s * nx / l, s * ny / l, s * nz / l], piece: this.piece, vol: this.vol, cover: this.cover, wall: this.wall, tone: this.tone });
  }
}
const at = (p: Point, z: number): Vertex3 => ({ x: p.x, y: p.y, z });

/** Concentric outlines keep the roof, body and raised deck in the same frame. */
export function scaledRing(ring: readonly Point[], scale: number): Point[] {
  const c = centroid(ring); return ring.map(p => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale }));
}
export function stiltDeck(ring: readonly Point[]): Point[] {
  const c = centroid(ring); return ring.map(p => { const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * 0.65, y: p.y + dy / l * 0.65 }; });
}
export const stiltSupports = (ring: readonly Point[]): Point[] => stiltDeck(ring).filter((_, i) => i % Math.max(1, Math.ceil(ring.length / 4)) === 0);

// ---------------------------------------------------------------- pitched roofs
const cross2 = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function pointInRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function isConvex(ring: readonly Point[]): boolean {
  const area = signedArea(ring), s = Math.sign(area); if (!s) return false;
  for (let i = 0; i < ring.length; i++) if (cross2(ring[i], ring[(i + 1) % ring.length], ring[(i + 2) % ring.length]) * s < -1e-7 * (1 + Math.abs(area))) return false;
  return true;
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross2(a, b, c), d2 = cross2(a, b, d), d3 = cross2(c, d, a), d4 = cross2(c, d, b), e = 1e-9;
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}
/** Plan check of a roof: every face simple and wound like the ring, faces tile the ring
 * (areas add up), and for convex rings no vertex leaves it: no fold, no crossing. */
function validRoof(ring: readonly Point[], faces: readonly Vertex3[][]): boolean {
  const total = signedArea(ring), s = Math.sign(total); if (!s) return false;
  const A = Math.abs(total), convex = isConvex(ring);
  let sum = 0;
  for (const f of faces) {
    const a = signedArea(f) * s; if (a < -0.002 * A - 1e-6) return false;
    sum += a;
    if (f.length > 3) for (let i = 0; i < f.length; i++) for (let j = i + 2; j < f.length; j++) {
      if (i === 0 && j === f.length - 1) continue;
      if (segmentsCross(f[i], f[(i + 1) % f.length], f[j], f[(j + 1) % f.length])) return false;
    }
    if (convex) for (const p of f) for (let i = 0; i < ring.length; i++) {
      const a0 = ring[i], b0 = ring[(i + 1) % ring.length], l = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      if (cross2(a0, b0, p) * s / l < -0.03) return false;
    }
  }
  return Math.abs(sum - A) <= 0.015 * A + 1e-6;
}
const same3 = (a: Vertex3, b: Vertex3): boolean => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;
/** A polygon of a roof, deduplicated; a non-planar quad becomes two triangles. */
function pushFace(out: Vertex3[][], pts: Vertex3[]): void {
  const p = pts.filter((q, i) => !same3(q, pts[(i + pts.length - 1) % pts.length]));
  if (p.length < 3) return;
  if (p.length === 4) {
    const ux = p[1].x - p[0].x, uy = p[1].y - p[0].y, uz = p[1].z - p[0].z, vx = p[2].x - p[0].x, vy = p[2].y - p[0].y, vz = p[2].z - p[0].z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    if (l > 1e-9) { nx /= l; ny /= l; nz /= l; if (Math.abs((p[3].x - p[0].x) * nx + (p[3].y - p[0].y) * ny + (p[3].z - p[0].z) * nz) > 0.03) { out.push([p[0], p[1], p[2]], [p[0], p[2], p[3]]); return; } }
  }
  out.push(p);
}
type Seg = [Point, Point];
/** Point of the ridge closest to `p`: with a straight ridge, the point at the same axis coordinate clamped to the ridge's extent. */
function onRidge(p: Point, [a, b]: Seg): { q: Point; d: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { q, d: Math.hypot(q.x - p.x, q.y - p.y) };
}
const sideOf = ([a, b]: Seg, p: Point): number => { const l = Math.hypot(b.x - a.x, b.y - a.y); return l < 1e-9 ? 0 : cross2(a, b, p) / l; };

/** Roof faces (z = eave on the ring, z = top on the ridges) of a ring under ridges, or
 * undefined when no construction gives a valid, non-folding roof. Rule: each ring vertex
 * goes to the ridge point at the same coordinate along the ridge axis, clamped to the
 * ridge's extent (so projections keep the ring's order along the ridge and faces never
 * cross); an eave edge crossing the ridge axis is split there; a point ridge is a pyramid.
 * With several ridges a vertex takes its nearest one. Second try: plain nearest points
 * (fits some concave L/T outlines). Both are checked in plan before being accepted. */
export function loftRidges(ring: readonly Point[], ridges: readonly [Point, Point][], eave: number, top: number): Vertex3[][] | undefined {
  if (ring.length < 3 || !ridges.length) return undefined;
  const n = ring.length;
  const proj = (p: Point): { id: number; q: Point } => {
    let id = 0, best = Infinity, q = ridges[0][0];
    ridges.forEach((r, i) => { const s = onRidge(p, r); if (s.d < best - 1e-9) { best = s.d; id = i; q = s.q; } });
    return { id, q };
  };
  const build = (split: boolean): Vertex3[][] => {
    const out: Vertex3[][] = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      const pa = proj(a), pb = proj(b), A = at(a, eave), B = at(b, eave);
      if (split && pa.id === pb.id && Math.hypot(pa.q.x - pb.q.x, pa.q.y - pb.q.y) > 1e-3) {
        const r = ridges[pa.id], sa = sideOf(r, a), sb = sideOf(r, b);
        if (sa * sb < -1e-6) {
          const t = sa / (sa - sb), c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, pc = onRidge(c, r).q, C = at(c, eave);
          pushFace(out, [A, C, at(pc, top), at(pa.q, top)]); pushFace(out, [C, B, at(pb.q, top), at(pc, top)]);
          continue;
        }
      }
      pushFace(out, [A, B, at(pb.q, top), at(pa.q, top)]);
    }
    return out;
  };
  for (const split of [true, false]) { const faces = build(split); if (faces.length && validRoof(ring, faces)) return faces; }
  return undefined;
}
/** Pyramid to the centroid (the defensive fallback), or undefined when the centroid is outside. */
function pyramidFaces(ring: readonly Point[], eave: number, top: number): Vertex3[][] | undefined {
  const c = centroid(ring), out: Vertex3[][] = [];
  if (!pointInRing(c, ring)) return undefined;
  for (let i = 0; i < ring.length; i++) pushFace(out, [at(ring[i], eave), at(ring[(i + 1) % ring.length], eave), at(c, top)]);
  return out.length && validRoof(ring, out) ? out : undefined;
}
/** Every eave edge lofted to the ridges (gable, hip, pyramid, cone); pyramid then flat if the ridges are unusable. */
function lofted(f: Faces, ring: readonly Point[], ridges: readonly [Point, Point][], eave: number, top: number): void {
  const faces = loftRidges(ring, ridges, eave, top) ?? pyramidFaces(ring, eave, top);
  if (faces) for (const p of faces) f.add(p); else flat(f, ring, eave);
}
/** Tent: low cone whose faces sag (concave profile) up to a small crown ring with a flat smoke cap. */
function tent(f: Faces, ring: readonly Point[], eave: number, rise: number): void {
  const c = centroid(ring);
  if (!pointInRing(c, ring)) { flat(f, ring, eave); return; }
  const crown = 0.1, courses = [0, 0.5, 0.8, 1];
  const course = (s: number) => ring.map(p => { const k = 1 - s * (1 - crown); return at({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }, eave + rise * Math.pow(s, 1.7)); });
  const out: Vertex3[][] = [];
  for (let s = 0; s + 1 < courses.length; s++) {
    const lo = course(courses[s]), hi = course(courses[s + 1]);
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; pushFace(out, [lo[i], lo[j], hi[j], hi[i]]); }
  }
  for (const p of out) f.add(p);
  f.add(course(1));
}
/** Shed roof: the plane rising from the low eave to the ridge line (the high wall). */
function shed(f: Faces, ring: readonly Point[], [r0, r1]: [Point, Point], eave: number, rise: number): void {
  const ux = r1.x - r0.x, uy = r1.y - r0.y, l = Math.hypot(ux, uy) || 1, nx = -uy / l, ny = ux / l;
  let far = 0;
  for (const p of ring) far = Math.max(far, Math.abs((p.x - r0.x) * nx + (p.y - r0.y) * ny));
  if (far < 1e-6) return;
  f.add(ring.map(p => at(p, eave + rise * (1 - Math.abs((p.x - r0.x) * nx + (p.y - r0.y) * ny) / far))));
}
/** Dome: three courses of the outline shrinking to the centre on a quarter circle. */
function dome(f: Faces, ring: readonly Point[], eave: number, rise: number): void {
  const c = centroid(ring), steps = [0, 0.38, 0.7, 0.9, 1];
  const course = (t: number) => ring.map(p => at({ x: c.x + (p.x - c.x) * Math.cos(t * Math.PI / 2), y: c.y + (p.y - c.y) * Math.cos(t * Math.PI / 2) }, eave + rise * Math.sin(t * Math.PI / 2)));
  for (let s = 0; s + 1 < steps.length; s++) {
    const lo = course(steps[s]), hi = course(steps[s + 1]);
    for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; f.add([lo[i], lo[j], hi[j], hi[i]]); }
  }
}
/** Barrel vault: the gable profile bent into four facets per side. */
function barrel(f: Faces, ring: readonly Point[], [r0, r1]: [Point, Point], eave: number, rise: number): void {
  const ux = r1.x - r0.x, uy = r1.y - r0.y, l = Math.hypot(ux, uy) || 1, nx = -uy / l, ny = ux / l;
  let half = 0; for (const p of ring) half = Math.max(half, Math.abs((p.x - r0.x) * nx + (p.y - r0.y) * ny));
  if (half < 1e-6) return;
  // Clip each course to the actual ring: no rectangle can escape the roof plan.
  const coord = (p: Point): number => (p.x - r0.x) * nx + (p.y - r0.y) * ny;
  const clip = (poly: readonly Point[], w: number, sign: number): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = sign * (coord(a) - w), db = sign * (coord(b) - w);
      if (da >= -1e-8) out.push(a);
      if ((da > 0) !== (db > 0)) { const t = da / (da - db); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
    return out;
  };
  const k = 4;
  for (let s = 0; s < k; s++) for (const side of [-1, 1]) {
    const w0 = side * half * s / k, w1 = side * half * (s + 1) / k;
    const z = (w: number) => eave + rise * Math.sqrt(Math.max(0, 1 - (w / half) ** 2));
    const lo = Math.min(w0, w1), hi = Math.max(w0, w1), course = clip(clip(ring, lo, 1), hi, -1);
    if (course.length >= 3) f.add(course.map(p => ({ ...p, z: z(lo) + (z(hi) - z(lo)) * (coord(p) - lo) / (hi - lo) })));
    // Close the barrel ends down to the wall eave (edge-on in plan).
    for (let i = 0; i < course.length; i++) {
      const a = course[i], b = course[(i + 1) % course.length];
      if (Math.abs(coord(a) - coord(b)) < 1e-6) continue;
      const onEdge = ring.some((p, j) => { const q = ring[(j + 1) % ring.length]; return Math.abs(cross2(p, q, a)) < 1e-5 && Math.abs(cross2(p, q, b)) < 1e-5; });
      if (onEdge) f.add([at(a, eave), at(b, eave), at(b, z(coord(b))), at(a, z(coord(a)))]);
    }
  }
}
/** Court range: outer and court eaves rise to a ridge half way across the range. */
function ring(f: Faces, shape: Shape, eave: number, rise: number): void {
  const perimeter = [shape.outer, ...shape.holes].reduce((s, r) => s + r.reduce((t, p, i) => { const n = r[(i + 1) % r.length]; return t + Math.hypot(n.x - p.x, n.y - p.y); }, 0), 0);
  const area = Math.abs(signedArea(shape.outer)) - shape.holes.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
  if (perimeter <= 0 || area <= 0) return;
  const d = Math.min(6, area / perimeter), top = eave + rise;
  for (const [r, outer] of [[shape.outer, true], ...shape.holes.map(h => [h, false] as const)] as [Point[], boolean][]) {
    const inner = insetRing(r, d, outer);
    for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; f.add([at(r[i], eave), at(r[j], eave), at(inner[j], top), at(inner[i], top)]); }
  }
}
function flat(f: Faces, ring: readonly Point[], z: number): void { f.add(ring.map(p => at(p, z))); }

/** Roof faces of one volume, z relative to the building ground. */
export function volumeRoof(v: ResolvedVolume, piece: number, vol: number): RoofFace[] {
  const f = new Faces(piece, vol, v.cover, v.wall, v.tone), eave = v.eave_m, rise = Math.max(0, v.rise_m), shape = v.shape, outer = v.detail?.form === 'battered' ? scaledRing(shape.outer, 0.92) : shape.outer;
  if (v.tree) { for (const points of treeCrownFaces(v.tree)) f.add(points); return f.list; }
  // Explicit pans are the whole roof: nothing is derived from the roof kind, the ridges or the rise.
  if (v.pans) { for (const points of v.pans) f.add(points); return f.list; }
  const ridges = v.ridges.map(([x0, y0, x1, y1]) => [{ x: x0, y: y0 }, { x: x1, y: y1 }] as [Point, Point]);
  if (outer.length < 3) return [];
  if (v.roof === 'ring') ring(f, shape, eave, rise);
  else if (v.roof === 'dome') dome(f, outer, eave, rise);
  else if (v.roof === 'tent' && rise > 0.05) tent(f, outer, eave, rise);
  else if (v.roof === 'shed' && ridges.length) shed(f, outer, ridges[0], eave, rise);
  else if (v.roof === 'barrel' && ridges.length) barrel(f, outer, ridges[0], eave, rise);
  else if (rise > 0.05 && ridges.length) lofted(f, outer, ridges, eave, eave + rise);
  else if (rise > 0.05 && (v.roof === 'pyramid' || v.roof === 'cone' || v.roof === 'hip')) { const c = centroid(outer); lofted(f, outer, [[c, c]], eave, eave + rise); }
  else {
    flat(f, outer, eave);
    // Flat terraces retain the opening occupied by the next tier (or court).
    if (shape.holes.length && f.list.length) f.list[0].holes = shape.holes;
  }
  return f.list;
}
/** Roof faces of one piece (one face set per volume), z relative to the building ground. */
export function pieceRoof(shape: Shape, m: MassingPiece, piece: number): RoofFace[] {
  return pieceVolumes(shape, m).flatMap((v, i) => volumeRoof(v, piece, i));
}
/** Roof faces of a building (all pieces). */
export function buildingRoof(footprint: Surface, massing: readonly MassingPiece[]): RoofFace[] {
  return footprint.flatMap((shape, i) => massing[i] ? pieceRoof(shape, massing[i], i) : []);
}
/** Plan-view roof face (2D maps): `light` overrides the shading of the normal, `holes` cut courts out of the face,
 * `flat` marks the faces of a flat roof (rim, field, roof-top features). */
export interface PlanRoofFace extends RoofFace { holes?: Point[][]; light?: number; flat?: boolean; terrace?: boolean; snow?: number; /** Face of a small decorative volume: one plain polygon. */ minor?: boolean; /** Bevel of the rim around a flat roof (its parapet or kerb). */ rim?: boolean }
/** Plan geometry is built once with the scene, shared by every 2D palette and backend.
 * Roof sets with entirely horizontal pans are slabs (including subdivided slabs); pitched roofs
 * and their horizontal caps keep their original faces. Terraces are painted low to high,
 * with upper slabs casting onto each receiver by their actual height difference.
 * Volumes with explicit pans and small decorative volumes keep their faces as they are (never a
 * slab: no rim, no clipping), and a volume standing on another one is painted after it. */
export function planRoof(footprint: Surface, massing: readonly MassingPiece[]): PlanRoofFace[] {
  const sets = footprint.flatMap((shape, i) => massing[i] ? pieceVolumes(shape, massing[i]).flatMap((v, j) => {
    const roof = volumeRoof(v, i, j), faces: PlanRoofFace[] = v.minor ? roof.map(face => ({ ...face, minor: true })) : roof;
    const pans = faces.filter(f => f.normal[2] >= 0.08);
    const horizontal = !v.tree && !v.pans && !v.minor && pans.length > 0 && pans.every(f => f.normal[2] > 0.999 && f.points.every(p => Math.abs(p.z - f.points[0].z) < 0.01));
    // Keep each slab separate so height ordering also works within a single volume.
    return horizontal ? faces.map(face => ({ v, faces: [face], horizontal: face.normal[2] > 0.999,
      holes: pans.length === 1 ? v.shape.holes : [], z: face.points[0].z }))
      : faces.length ? [{ v, faces, horizontal: false, holes: [], z: Math.min(...faces.flatMap(f => f.points.map(p => p.z))) }] : [];
  }) : []);
  if (sets.some(s => s.v.base_m)) sets.sort((a, b) => (a.v.base_m ?? 0) - (b.v.base_m ?? 0));
  const slabs = sets.flatMap(s => s.horizontal ? s.faces.map(face => ({ face,
    shape: { outer: face.points.map(p => ({ x: p.x, y: p.y })), holes: s.holes }, z: face.points[0].z })) : []);
  const bottom = Math.min(...slabs.map(s => s.z)), top = Math.max(...slabs.map(s => s.z));
  if (top - bottom <= 0.05) return sets.flatMap(s => s.horizontal
    ? s.faces.flatMap(face => flatPlanRoof(s.v, face, s.holes)) : s.faces);
  const levels = slabs.map(s => s.z).sort((a, b) => a - b).filter((z, i, a) => !i || z - a[i - 1] > 0.05);
  sets.sort((a, b) => a.z - b.z);
  return sets.flatMap(s => !s.horizontal ? s.faces : s.faces.flatMap(face => {
    const z = face.points[0].z, tier = levels.filter(h => h < z - 0.05).length;
    const receiver = slabs.find(t => t.face === face)!;
    const shadows = slabs.flatMap(t => {
      if (t.z <= z + 0.05) return [];
      const shadow = pieceShadow(t.shape, t.z - z);
      return shadow ? intersectionS(receiver.shape, shadow) : [];
    });
    // Merge overlapping casters: one shade per terrace, clipped around its courts.
    const merged = shadows.length ? unionS(shadows[0], ...shadows.slice(1)) : [];
    // Ten percent per storey, independent of its physical height and the map palette.
    return flatPlanRoof(s.v, face, receiver.shape.holes, merged, true).map(f => ({ ...f,
      light: (1 + (f.light ?? roofLight(f.normal))) * 1.1 ** tier - 1 }));
  }));
}
const RIM_TILT = Math.SQRT1_2;
function flatPlanRoof(v: ResolvedVolume, face: RoofFace, roofHoles: Point[][], shadows: Shape[] = [], terrace = false): PlanRoofFace[] {
  const ring = face.points.map(p => ({ x: p.x, y: p.y })), z = face.points[0].z, holes = roofHoles.filter(h => h.length >= 3);
  const rings: [Point[], boolean][] = [[ring, true], ...holes.map(h => [h, false] as [Point[], boolean])];
  const perimeter = rings.reduce((s, [r]) => s + r.reduce((t, p, k) => t + Math.hypot(r[(k + 1) % r.length].x - p.x, r[(k + 1) % r.length].y - p.y), 0), 0);
  const area = Math.abs(signedArea(ring)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  // Rim: a parapet reads a little wider; never more than a fraction of the inradius, so the field stays.
  // At the 1.4 px/m core view, a terrace bevel is ~1.5–1.7 px plus its dark seam.
  const w = terrace ? Math.min(1.45, perimeter > 0 ? 0.9 * area / perimeter : 0)
    : Math.min((v.detail?.parapet_m ?? 0) > 0.05 ? 0.8 : 0.6, Math.max(0.3, 0.07 * Math.sqrt(Math.max(0, area))), perimeter > 0 ? 0.3 * area / perimeter : 0);
  const base = { piece: face.piece, vol: face.vol, cover: face.cover, wall: face.wall, tone: face.tone, flat: true as const, snow: 0, ...(terrace ? { terrace: true } : {}) };
  const out: PlanRoofFace[] = [];
  const rims: PlanRoofFace[] = [];
  if (!(w > 0.12)) out.push({ ...face, ...base, holes, snow: 1 });
  else {
    const insets = rings.map(([r, outer]) => insetRing(r, w, outer));
    rings.forEach(([outline, outer], k) => {
      const r = terrace ? insetRing(outline, Math.min(0.22, w * 0.18), outer) : outline;
      const inner = insets[k];
      if (terrace) rims.push({ ...base, points: (outer ? outline : r).map(p => at(p, z)), holes: [outer ? r : outline], normal: [0, 0, 1], light: -0.56 });
      for (let i = 0; i < r.length; i++) {
        const j = (i + 1) % r.length, a = r[i], b = r[j], l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l < 1e-6) continue;
        // Outward = from the field towards the edge (into the court for a hole).
        let nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
        if (nx * ((a.x + b.x - inner[i].x - inner[j].x) / 2) + ny * ((a.y + b.y - inner[i].y - inner[j].y) / 2) < 0) { nx = -nx; ny = -ny; }
        const normal: [number, number, number] = [nx * RIM_TILT, ny * RIM_TILT, RIM_TILT];
        (terrace ? rims : out).push({ ...base, rim: true, points: [a, b, inner[j], inner[i]].map(p => at(p, z)), normal,
          ...(terrace ? { light: Math.max(-0.48, Math.min(0.32, -(nx + ny) * 0.48)) } : {}) });
      }
    });
    out.push({ ...base, points: insets[0].map(p => at(p, z)), holes: insets.slice(1), normal: [0, 0, 1], light: -0.05, snow: 1 });
  }
  for (const shadow of shadows) out.push({ ...base, points: shadow.outer.map(p => at(p, z)), holes: shadow.holes, normal: [0, 0, 1], light: terrace ? -0.55 : -0.38 });
  // Keep the raised lip readable even where the lower roof receives a cast shadow.
  out.push(...rims);
  // Keep roof-top structures visible above the receiving terrace's shadow wash.
  for (const f of v.detail?.features ?? []) {
    if (f.kind === 'sails' || !(f.w > 0.1) || !(f.d > 0.1)) continue;
    if (!pointInRing(f, ring) || holes.some(h => pointInRing(f, h))) continue;
    const ca = Math.cos(f.angle), sa = Math.sin(f.angle);
    const top = f.kind === 'dome'
      ? Array.from({ length: 8 }, (_, k) => ({ x: f.x + Math.cos(k * Math.PI / 4) * f.w / 2, y: f.y + Math.sin(k * Math.PI / 4) * f.w / 2 }))
      : [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => ({ x: f.x + s * f.w / 2 * ca - t * f.d / 2 * sa, y: f.y + s * f.w / 2 * sa + t * f.d / 2 * ca }));
    const shadow = pieceShadow({ outer: top, holes: [] }, f.h);
    if (shadow) for (const s of terrace ? intersectionS({ outer: ring, holes }, shadow) : [shadow])
      out.push({ ...base, points: s.outer.map(p => at(p, z)), holes: s.holes, normal: [0, 0, 1], light: terrace ? -0.55 : -0.34 });
    out.push({ ...base, points: top.map(p => at(p, z + f.h)), normal: [0, 0, 1], light: f.kind === 'dome' ? 0.08 : 0.14 });
  }
  // Concave terrace insets can cross at a re-entrant corner. Clip every
  // receiving face to its actual roof, so a pale bevel never reaches a street.
  return out.flatMap(f => intersectionS({ outer: ring, holes }, { outer: f.points.map(p => ({ x: p.x, y: p.y })), holes: f.holes ?? [] })
    .map(s => ({ ...f, points: s.outer.map(p => at(p, f.points[0].z)), holes: s.holes })));
}
/** Highest point of a piece above the ground. */
export const pieceTop = (m: MassingPiece): number => {
  const own = Array.isArray(m.volumes) ? m.volumes.filter(v => finite(v?.eave_m) && Array.isArray(v.ring) && v.ring.length >= 3) : [];
  return own.length ? Math.max(...own.map(v => {
    if (v.form === 'tree') { const tree = treeDwelling(v.ring.map(([x, y]) => ({ x, y })), v.eave_m, v.rise_m, v.tree_seed ?? JSON.stringify(v.ring.map(([x, y]) => ({ x, y })))); return Math.max(...tree.crowns.map(c => c.z + c.height)); }
    return v.eave_m + Math.max(0, finite(v.rise_m) ? v.rise_m : 0) + (finite(v.stilts_m) ? Math.max(0, Math.min(v.stilts_m, 4)) : 0);
  })) : m.eave_m + Math.max(0, m.rise_m);
};

/** Per-plane roof light shared with the retained 3D mesh. */
export function roofLight(normal: readonly [number, number, number]): number {
  return roofPlaneLight(normal) - 1;
}

/** Ground shadow of a piece (sun from the north-west): the sweep of the outline and
 * its copy shifted by the piece's height. Sweep edges to preserve concavities. */
export function pieceShadow(shape: Shape, height: number, k = 0.55): Shape | undefined {
  if (height <= 0.05 || shape.outer.length < 3) return undefined;
  const dx = height * k, dy = height * k * 0.8;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const sweeps = [shape.outer, ...shape.holes].flatMap(ring => ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) > 1e-8 ? [{ outer: [a, b, shift(b), shift(a)], holes: [] }] : [];
  }));
  return unionS(shape, { outer: shape.outer.map(shift), holes: shape.holes.map(h => h.map(shift)) }, ...sweeps)[0];
}

/** `pieceShadow` of a convex ring without a polygon boolean: the hull of the ring and its shifted copy. */
function convexShadow(ring: readonly Point[], height: number, k = 0.55): Shape | undefined {
  if (height <= 0.05 || ring.length < 3) return undefined;
  const dx = height * k, dy = height * k * 0.8, r = signedArea(ring) < 0 ? [...ring].reverse() : ring, n = r.length, outer: Point[] = [];
  // Counter-clockwise ring: an edge leads when the shift leaves the ring through it; the hull follows the shifted leading edges.
  const leads = r.map((a, i) => { const b = r[(i + 1) % n]; return (b.y - a.y) * dx - (b.x - a.x) * dy > 1e-9; });
  for (let i = 0; i < n; i++) {
    const before = leads[(i + n - 1) % n], after = leads[i], p = r[i], q = { x: p.x + dx, y: p.y + dy };
    if (before && after) outer.push(q); else if (!before && !after) outer.push(p); else if (after) outer.push(p, q); else outer.push(q, p);
  }
  return { outer, holes: [] };
}
/** Ground shadows of a piece, one per volume (each swept by its own height). Small decorative
 * volumes cast none; a convex volume with explicit pans is swept directly. */
export function pieceShadows(shape: Shape, m: MassingPiece): Shape[] {
  return pieceVolumes(shape, m).flatMap(v => {
    if (v.minor) return [];
    const height = v.eave_m + Math.max(0, v.rise_m) + (v.detail?.stilts_m ?? 0);
    const s = v.pans && !v.shape.holes.length && isConvex(v.shape.outer) ? convexShadow(v.shape.outer, height) : pieceShadow(v.shape, height);
    return s ? [s] : [];
  });
}
