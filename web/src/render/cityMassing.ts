/** Building volumes from the city's massing (Rust `urban/massing.rs`): every
 * preview piece of a lot carries its floors, eave height and roof (kind, rise,
 * ridges), and this module turns them into roof faces for the 2D map (shaded
 * roof pans, height shadows) and the 3D view. The building shown is the planned
 * silhouette raised in volume; no other house generator is involved. */
import type { Point, Surface, Vertex3 } from '../../../rust/bridge/housesContract';
type Shape = Surface[number];

export type MassingRoof = 'gable' | 'hip' | 'shed' | 'pyramid' | 'cone' | 'dome' | 'barrel' | 'ring' | 'tent' | 'flat';
/** One sub-volume partitioning a preview piece: own ring, heights, roof and (optionally) materials. */
export interface MassingVolume {
  ring: [number, number][]; floors?: number; eave_m: number; rise_m: number; roof: MassingRoof;
  ridges: [number, number, number, number][]; cover?: string; wall?: string; tone?: number;
}
export interface MassingPiece {
  floors: number; eave_m: number; rise_m: number; roof: MassingRoof;
  ridges: [number, number, number, number][]; cover: string; wall: string; tone?: number;
  volumes?: MassingVolume[];
}
/** One roof face: 3D polygon (z above the building ground) and its upward unit normal.
 * `vol` is the volume index inside the piece (0 when the piece has none), `cover`/`wall`/`tone`
 * the materials and 0..1 shade of that volume. */
export interface RoofFace { points: Vertex3[]; normal: [number, number, number]; piece: number; vol: number; cover: string; wall: string; tone: number }

/** A piece resolved to the volumes to draw (the piece itself when it has no `volumes`). */
export interface ResolvedVolume { shape: Shape; floors: number; eave_m: number; rise_m: number; roof: MassingRoof; ridges: [number, number, number, number][]; cover: string; wall: string; tone: number }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v: unknown, d = 0.5): number => finite(v) ? Math.max(0, Math.min(1, v)) : d;
export function pieceVolumes(shape: Shape, m: MassingPiece): ResolvedVolume[] {
  const out: ResolvedVolume[] = [];
  if (Array.isArray(m.volumes)) for (const v of m.volumes) {
    if (!v || !Array.isArray(v.ring) || v.ring.length < 3 || !v.ring.every(q => Array.isArray(q) && finite(q[0]) && finite(q[1])) || !finite(v.eave_m) || typeof v.roof !== 'string') continue;
    out.push({ shape: { outer: v.ring.map(([x, y]) => ({ x, y })), holes: [] }, floors: finite(v.floors) ? v.floors : m.floors, eave_m: v.eave_m, rise_m: finite(v.rise_m) ? v.rise_m : 0, roof: v.roof,
      ridges: Array.isArray(v.ridges) ? v.ridges.filter(r => Array.isArray(r) && r.length === 4 && r.every(finite)) : [],
      cover: v.cover ?? m.cover, wall: v.wall ?? m.wall, tone: clamp01(v.tone, clamp01(m.tone)) });
  }
  if (out.length) return out;
  return [{ shape, floors: m.floors, eave_m: m.eave_m, rise_m: m.rise_m, roof: m.roof, ridges: m.ridges ?? [], cover: m.cover, wall: m.wall, tone: clamp01(m.tone) }];
}

/** Massing of a building's preview pieces, when the city sent one aligned with its footprint. */
export function readMassing(programme: unknown, footprint: Surface): MassingPiece[] | undefined {
  const massing = (programme as { massing?: unknown } | null | undefined)?.massing;
  if (!Array.isArray(massing) || massing.length !== footprint.length) return undefined;
  return massing.every(m => m && typeof m.eave_m === 'number' && typeof m.roof === 'string' && (m.ridges === undefined || Array.isArray(m.ridges))) ? massing as MassingPiece[] : undefined;
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
  // Barrel = gable whose height follows a circle across the span.
  const k = 4;
  for (let s = 0; s < k; s++) for (const side of [-1, 1]) {
    const w0 = side * half * s / k, w1 = side * half * (s + 1) / k;
    const z = (w: number) => eave + rise * Math.sqrt(Math.max(0, 1 - (w / half) ** 2));
    const p = (along: Point, w: number): Vertex3 => ({ x: along.x + nx * w, y: along.y + ny * w, z: z(w) });
    f.add([p(r0, w0), p(r1, w0), p(r1, w1), p(r0, w1)]);
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
  const f = new Faces(piece, vol, v.cover, v.wall, v.tone), eave = v.eave_m, rise = Math.max(0, v.rise_m), shape = v.shape, outer = shape.outer;
  const ridges = v.ridges.map(([x0, y0, x1, y1]) => [{ x: x0, y: y0 }, { x: x1, y: y1 }] as [Point, Point]);
  if (outer.length < 3) return [];
  if (v.roof === 'ring') ring(f, shape, eave, rise);
  else if (v.roof === 'dome') dome(f, outer, eave, rise);
  else if (v.roof === 'tent' && rise > 0.05) tent(f, outer, eave, rise);
  else if (v.roof === 'shed' && ridges.length) shed(f, outer, ridges[0], eave, rise);
  else if (v.roof === 'barrel' && ridges.length) { barrel(f, outer, ridges[0], eave, rise); flat(f, outer, eave); }
  else if (rise > 0.05 && ridges.length) lofted(f, outer, ridges, eave, eave + rise);
  else if (rise > 0.05 && (v.roof === 'pyramid' || v.roof === 'cone' || v.roof === 'hip')) { const c = centroid(outer); lofted(f, outer, [[c, c]], eave, eave + rise); }
  else flat(f, outer, eave);
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
/** Highest point of a piece above the ground. */
export const pieceTop = (m: MassingPiece): number => {
  const own = Array.isArray(m.volumes) ? m.volumes.filter(v => finite(v?.eave_m) && Array.isArray(v.ring) && v.ring.length >= 3) : [];
  return own.length ? Math.max(...own.map(v => v.eave_m + Math.max(0, finite(v.rise_m) ? v.rise_m : 0))) : m.eave_m + Math.max(0, m.rise_m);
};

/** Map light from the north-west, high: brightness factor of a roof face (−0.42…+0.26). */
export function roofLight([nx, ny, nz]: readonly [number, number, number]): number {
  const lx = -0.55, ly = -0.55, lz = 0.63; // y grows southward on the map
  const lambert = nx * lx + ny * ly + nz * lz, flatLambert = lz;
  return Math.max(-0.42, Math.min(0.26, (lambert - flatLambert) * 1.3));
}

/** Ground shadow of a piece (sun from the north-west): the hull of the outline and
 * its copy shifted by the piece's height. Convex hull: pieces are near-convex. */
export function pieceShadow(shape: Shape, height: number, k = 0.55): Shape | undefined {
  if (height <= 0.5 || shape.outer.length < 3) return undefined;
  const dx = height * k, dy = height * k * 0.8, points = [...shape.outer, ...shape.outer.map(p => ({ x: p.x + dx, y: p.y + dy }))];
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of points) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = points.length - 1; i >= 0; i--) { const p = points[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  return hull.length >= 3 ? { outer: hull, holes: [] } : undefined;
}

/** Ground shadows of a piece, one per volume (each swept by its own height). */
export function pieceShadows(shape: Shape, m: MassingPiece): Shape[] {
  return pieceVolumes(shape, m).flatMap(v => { const s = pieceShadow(v.shape, v.eave_m + Math.max(0, v.rise_m)); return s ? [s] : []; });
}
