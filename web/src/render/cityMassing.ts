/** Building volumes from the city's massing (Rust `urban/massing.rs`): every
 * preview piece of a lot carries its floors, eave height and roof (kind, rise,
 * ridges), and this module turns them into roof faces for the 2D map (shaded
 * roof pans, height shadows) and the 3D view. The building shown is the planned
 * silhouette raised in volume; no other house generator is involved. */
import type { Point, Surface, Vertex3 } from '../../../rust/bridge/housesContract';
type Shape = Surface[number];

export type MassingRoof = 'gable' | 'hip' | 'shed' | 'pyramid' | 'cone' | 'dome' | 'barrel' | 'ring' | 'flat';
export interface MassingPiece {
  floors: number; eave_m: number; rise_m: number; roof: MassingRoof;
  ridges: [number, number, number, number][]; cover: string; wall: string;
}
/** One roof face: 3D polygon (z above the building ground) and its upward unit normal. */
export interface RoofFace { points: Vertex3[]; normal: [number, number, number]; piece: number }

/** Massing of a building's preview pieces, when the city sent one aligned with its footprint. */
export function readMassing(programme: unknown, footprint: Surface): MassingPiece[] | undefined {
  const massing = (programme as { massing?: unknown } | null | undefined)?.massing;
  if (!Array.isArray(massing) || massing.length !== footprint.length) return undefined;
  return massing.every(m => m && typeof m.eave_m === 'number' && typeof m.roof === 'string') ? massing as MassingPiece[] : undefined;
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
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function nearestOnRidges(p: Point, ridges: readonly [Point, Point][]): Point {
  let best = ridges[0][0], distance = Infinity;
  for (const [a, b] of ridges) { const q = nearestOnSegment(p, a, b), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < distance) { distance = d; best = q; } }
  return best;
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
  constructor(private piece: number) {}
  add(points: Vertex3[]): void {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y);
    }
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return;
    const s = nz < 0 ? -1 : 1;
    this.list.push({ points, normal: [s * nx / l, s * ny / l, s * nz / l], piece: this.piece });
  }
}
const at = (p: Point, z: number): Vertex3 => ({ x: p.x, y: p.y, z });

/** Every eave edge lofted to its projection on the ridges (gable, hip, shed, pyramid, cone). */
function lofted(f: Faces, ring: readonly Point[], ridges: readonly [Point, Point][], eave: number, top: number): void {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    const pa = nearestOnRidges(a, ridges), pb = nearestOnRidges(b, ridges);
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 1e-3) f.add([at(a, eave), at(b, eave), at(pa, top)]);
    else f.add([at(a, eave), at(b, eave), at(pb, top), at(pa, top)]);
  }
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

/** Roof faces of one piece, z relative to the building ground. */
export function pieceRoof(shape: Shape, m: MassingPiece, piece: number): RoofFace[] {
  const f = new Faces(piece), eave = m.eave_m, rise = Math.max(0, m.rise_m), outer = shape.outer;
  const ridges = m.ridges.map(([x0, y0, x1, y1]) => [{ x: x0, y: y0 }, { x: x1, y: y1 }] as [Point, Point]);
  if (outer.length < 3) return [];
  if (m.roof === 'ring') ring(f, shape, eave, rise);
  else if (m.roof === 'dome') dome(f, outer, eave, rise);
  else if (m.roof === 'shed' && ridges.length) shed(f, outer, ridges[0], eave, rise);
  else if (m.roof === 'barrel' && ridges.length) { barrel(f, outer, ridges[0], eave, rise); flat(f, outer, eave); }
  else if (rise > 0.05 && ridges.length) lofted(f, outer, ridges, eave, eave + rise);
  else flat(f, outer, eave);
  return f.list;
}
/** Roof faces of a building (all pieces). */
export function buildingRoof(footprint: Surface, massing: readonly MassingPiece[]): RoofFace[] {
  return footprint.flatMap((shape, i) => massing[i] ? pieceRoof(shape, massing[i], i) : []);
}
/** Highest point of a piece above the ground. */
export const pieceTop = (m: MassingPiece): number => m.eave_m + Math.max(0, m.rise_m);

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
