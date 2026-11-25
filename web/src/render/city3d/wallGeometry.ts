/**
 * Draped prism meshes and closed curtain-path geometry. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads paths, levels and materials; writes only each WallMesh/Curtain instance and assembled display records.
 */
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { MaterialPattern, Point, Surface, Vertex3 } from '../../../../rust/bridge/housesContract';
import { surfaceTriangles, type Building3dVisual, type BuildingWalkSolid } from '../urbanBuildingGeometry';
import { RoofBuilder, ringArea, insetRoof, nearestOnSegment } from './roofGeometry';
import { slots } from './materials';
import { baseVolume } from './volume';

// ---------------------------------------------------------------- walls
/** Fortifications (Rust `urban::fortification`, Enclosure) as display volumes:
 * the plan only paints them on the ground texture. Every face is draped on the
 * relief (bottom below the ground, top at ground + height at each vertex), so long
 * curtains follow slopes without stepping. Curtains are cut into pieces of at most
 * WALL_CHUNK m so the building pass culls them by sector. Moats are dug into the
 * terrain (ui/urbanGroundCuts.ts), with their water and gate bridges here (city3dMoat.ts); the glacis stays on the plan texture; gate passages and water-gate spans leave the curtain open.
 * Display only, never authoritative geometry. */
export const WALL_STEP = 8,
  WALL_CHUNK = 80;

export type WallShape = { outer: Point[]; holes: Point[][] };

type Z = (p: Point) => number;

/** Edges no longer than `step` (so a draped top follows the relief). */
function densify(ring: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  return out;
}

export class WallMesh {
  readonly roof = new RoofBuilder();
  readonly footprint: Surface = [];
  readonly walkSolids: BuildingWalkSolid[] = [];
  bottom = Infinity;
  top = -Infinity;
  private face(points: Vertex3[], material: string): void {
    for (const p of points) {
      this.bottom = Math.min(this.bottom, p.z);
      this.top = Math.max(this.top, p.z);
    }
    this.roof.face(points, material);
  }
  /** Prism between two draped levels; `cap` closes the top, `under` the bottom (lintels, spans). */
  prism(shape: WallShape, zb: Z, zt: Z, side: string, cap: string | undefined, under = false): void {
    const rings = [shape.outer, ...shape.holes].filter(r => r.length >= 3).map(r => densify(r, WALL_STEP));
    if (!rings.length || Math.abs(ringArea(rings[0])) < 0.05) return;
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        this.face(
          [
            { ...a, z: zb(a) },
            { ...b, z: zb(b) },
            { ...b, z: zt(b) },
            { ...a, z: zt(a) },
          ],
          side,
        );
      }
    const flat = { outer: rings[0], holes: rings.slice(1) };
    let low = Infinity,
      high = -Infinity;
    for (const ring of rings)
      for (const p of ring) {
        low = Math.min(low, zb(p));
        high = Math.max(high, zt(p));
      }
    this.walkSolids.push({ footprint: [flat], z_min_m: low, z_max_m: high });
    if (cap)
      for (const t of surfaceTriangles([flat]))
        this.face(
          t.map(p => ({ ...p, z: zt(p) })),
          cap,
        );
    if (under) for (const t of surfaceTriangles([flat])) this.face(t.map(p => ({ ...p, z: zb(p) })).reverse(), side);
    this.footprint.push(flat);
  }
  cone(ring: readonly Point[], z: number, rise: number, material: string): void {
    const c = centroid(ring),
      apex = { ...c, z: z + rise };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      this.face([{ ...a, z }, { ...b, z }, apex], material);
    }
  }
  pitched(shape: WallShape, eave: number, rise: number, material: string): void {
    const before = this.roof.vertices.length;
    insetRoof(this.roof, [shape], eave, rise, material);
    for (const p of this.roof.vertices.slice(before)) {
      this.bottom = Math.min(this.bottom, p.z);
      this.top = Math.max(this.top, p.z);
    }
  }
  get empty(): boolean {
    return !this.roof.faces.length;
  }
  /** One raw face (moat sheets, see city3dMoat.ts). */
  add(points: Vertex3[], material: string): void {
    this.face(points, material);
  }
}

export const centroid = (ring: readonly Point[]): Point => {
  let x = 0,
    y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return ring.length ? { x: x / ring.length, y: y / ring.length } : { x: 0, y: 0 };
};

/** Closed curtain path with arc-length stations and outward miter offsets. */
export class Curtain {
  readonly pts: Point[];
  readonly cum: number[] = [0];
  readonly normals: Point[] = [];
  readonly miters: Point[] = [];
  readonly length: number;
  constructor(path: readonly Point[]) {
    const pts = path.slice(),
      f = pts[0],
      l = pts[pts.length - 1];
    if (pts.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) pts.pop();
    this.pts = pts;
    const n = pts.length,
      sign = ringArea(pts) > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n],
        len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
      // The interior lies on the left of a positive ring: outward is the right normal.
      this.normals.push({ x: (sign * (b.y - a.y)) / len, y: (-sign * (b.x - a.x)) / len });
      this.cum.push(this.cum[i] + len);
    }
    this.length = this.cum[n];
    for (let i = 0; i < n; i++) {
      // Miter of unit offset: bisector scaled by 1/cos(half turn), limited to 2.5.
      const p = this.normals[(i + n - 1) % n],
        q = this.normals[i],
        bx = p.x + q.x,
        by = p.y + q.y,
        bl = Math.hypot(bx, by);
      if (bl < 1e-6) {
        this.miters.push(q);
        continue;
      }
      const cos = (bx * q.x + by * q.y) / bl,
        k = Math.min(2.5, 1 / Math.max(0.4, cos)) / bl;
      this.miters.push({ x: bx * k, y: by * k });
    }
  }
  private segment(s: number): number {
    let lo = 0,
      hi = this.pts.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m - 1;
    }
    return lo;
  }
  /** Point and outward offset direction at arc length s (the miter on vertices). */
  at(s: number): { p: Point; o: Point } {
    const L = this.length;
    s = ((s % L) + L) % L;
    const i = this.segment(s),
      a = this.pts[i],
      b = this.pts[(i + 1) % this.pts.length],
      t = (s - this.cum[i]) / Math.max(1e-9, this.cum[i + 1] - this.cum[i]);
    return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, o: t < 1e-6 ? this.miters[i] : this.normals[i] };
  }
  /** Arc length of the nearest point of the path. */
  project(q: Point): number {
    let best = 0,
      distance = Infinity;
    for (let i = 0; i < this.pts.length; i++) {
      const a = this.pts[i],
        b = this.pts[(i + 1) % this.pts.length],
        p = nearestOnSegment(q, [a, b]),
        d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < distance) {
        distance = d;
        best = this.cum[i] + Math.hypot(p.x - a.x, p.y - a.y);
      }
    }
    return best;
  }
  /** Stations from s0 to s1 (s1 may pass the start): every vertex, at most `step` apart. */
  stations(s0: number, s1: number, step: number): { p: Point; o: Point }[] {
    const marks = [s0];
    for (let lap = 0; lap < 2; lap++)
      for (let i = 0; i < this.pts.length; i++) {
        const s = this.cum[i] + lap * this.length;
        if (s > s0 + 1e-6 && s < s1 - 1e-6) marks.push(s);
      }
    marks.push(s1);
    marks.sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 1; i < marks.length; i++) {
      const k = Math.max(1, Math.ceil((marks[i] - marks[i - 1]) / step));
      for (let j = 0; j < k; j++) out.push(marks[i - 1] + ((marks[i] - marks[i - 1]) * j) / k);
    }
    out.push(s1);
    return out.map(s => this.at(s));
  }
  /** Strip between the outward offsets a < b over [s0, s1]. */
  strip(s0: number, s1: number, a: number, b: number, step = WALL_STEP): WallShape {
    const st = this.stations(s0, s1, step),
      off = (x: { p: Point; o: Point }, d: number): Point => ({ x: x.p.x + x.o.x * d, y: x.p.y + x.o.y * d });
    return { outer: [...st.map(x => off(x, a)), ...st.reverse().map(x => off(x, b))], holes: [] };
  }
}

export function wallPiece(id: string, variant: string, mesh: WallMesh, pattern: MaterialPattern): (PlacedBuilding & Pick<Building3dVisual, 'walkSolids'>) | undefined {
  if (mesh.empty) return undefined;
  const ground = mesh.bottom,
    materials = slots(pattern, pattern),
    origin = centroid(mesh.footprint.flatMap(s => s.outer));
  const volume = baseVolume(`${id}:v`, mesh.footprint, ground, mesh.top - ground, 0, materials, mesh.roof.mesh(), 'RF-FLAT', { footprint: mesh.footprint, z_min_m: ground, z_max_m: ground }, []);
  return {
    id,
    parcel_id: '',
    function: 'collective',
    culture: { culture: '', pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
    recipe_id: 'city3d-wall',
    variant_id: variant,
    transform: { origin, orientation_deg: 0 },
    ground_z_m: ground,
    footprint: mesh.footprint,
    roof_footprint: mesh.footprint,
    courtyards: [],
    circulation: [],
    entrance: origin,
    access_id: '',
    volumes: [volume],
    useful_area_m2: 0,
    domestic_units: 0,
    structural_features: [],
    simplification: 'recipe_volumes',
    diagnostics: ['city3d fortification (display only)'],
    resolved: null,
    walkSolids: id.includes(':moat-bridge') ? [] : mesh.walkSolids,
  };
}
