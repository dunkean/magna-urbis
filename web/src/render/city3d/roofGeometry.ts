/**
 * Ring geometry and roof-face construction. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads rings/ridges; writes only each RoofBuilder instance and returned geometry.
 */
import type { Point, Surface, Vertex3 } from '../../../../rust/bridge/housesContract';
import { surfaceTriangles } from '../urbanBuildingGeometry';
import { loftRidges } from '../cityMassing';
import { RoofMeshFace, RoofMesh } from './types';

// ---------------------------------------------------------------- geometry
export const ringArea = (ring: readonly Point[]): number =>
  ring.reduce((sum, p, i) => {
    const n = ring[(i + 1) % ring.length];
    return sum + p.x * n.y - n.x * p.y;
  }, 0) / 2;

const ringLength = (ring: readonly Point[]): number =>
  ring.reduce((sum, p, i) => {
    const n = ring[(i + 1) % ring.length];
    return sum + Math.hypot(n.x - p.x, n.y - p.y);
  }, 0);

export const surfaceArea = (surface: Surface): number => surface.reduce((sum, shape) => sum + Math.abs(ringArea(shape.outer)) - shape.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);

export function inRing(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Minimum-area oriented rectangle: centre, unit long axis, half length and half width. */
export function orientedBox(ring: readonly Point[]): { center: Point; axis: Point; half: number; halfWidth: number; area: number } | undefined {
  let best: { center: Point; axis: Point; half: number; halfWidth: number; area: number } | undefined;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const p of ring) {
      const s = p.x * u.x + p.y * u.y,
        t = -p.x * u.y + p.y * u.x;
      u0 = Math.min(u0, s);
      u1 = Math.max(u1, s);
      v0 = Math.min(v0, t);
      v1 = Math.max(v1, t);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (best && area >= best.area) continue;
    const s = (u0 + u1) / 2,
      t = (v0 + v1) / 2,
      center = { x: s * u.x - t * u.y, y: s * u.y + t * u.x };
    best = u1 - u0 >= v1 - v0 ? { center, axis: u, half: (u1 - u0) / 2, halfWidth: (v1 - v0) / 2, area } : { center, axis: { x: -u.y, y: u.x }, half: (v1 - v0) / 2, halfWidth: (u1 - u0) / 2, area };
  }
  return best;
}

export function nearestOnSegment(p: Point, [a, b]: [Point, Point]): Point {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function nearestOnRidges(p: Point, ridges: readonly [Point, Point][]): Point {
  let best = ridges[0][0],
    distance = Infinity;
  for (const ridge of ridges) {
    const q = nearestOnSegment(p, ridge),
      d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < distance) {
      distance = d;
      best = q;
    }
  }
  return best;
}

/** Inward miter offset of a ring (outer rings CCW, holes CW), with a miter limit. */
export function insetRing(ring: readonly Point[], distance: number, outer: boolean): Point[] {
  const ccw = ringArea(ring) > 0,
    points = ccw === outer ? ring : [...ring].reverse(),
    n = points.length,
    out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n],
      p = points[i],
      next = points[(i + 1) % n];
    const e0 = { x: p.x - prev.x, y: p.y - prev.y },
      e1 = { x: next.x - p.x, y: next.y - p.y };
    const l0 = Math.hypot(e0.x, e0.y) || 1,
      l1 = Math.hypot(e1.x, e1.y) || 1;
    const n0 = { x: -e0.y / l0, y: e0.x / l0 },
      n1 = { x: -e1.y / l1, y: e1.x / l1 };
    const bx = n0.x + n1.x,
      by = n0.y + n1.y,
      bl = Math.hypot(bx, by);
    if (bl < 1e-6) {
      out.push({ x: p.x + n1.x * distance, y: p.y + n1.y * distance });
      continue;
    }
    const cos = (bx * n1.x + by * n1.y) / bl,
      k = distance / Math.max(1 / 3, cos);
    out.push({ x: p.x + (bx / bl) * k, y: p.y + (by / bl) * k });
  }
  return ccw === outer ? out : out.reverse();
}

/** Roof faces with Newell normals (pointing up), shared by every roof builder. */
export class RoofBuilder {
  readonly vertices: Vertex3[] = [];
  readonly faces: RoofMeshFace[] = [];
  face(points: Vertex3[], material: string): void {
    let nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-9) return;
    const sign = nz < 0 ? -1 : 1,
      normal: [number, number, number] = [(sign * nx) / length, (sign * ny) / length, (sign * nz) / length];
    const start = this.vertices.length;
    this.vertices.push(...points);
    this.faces.push({ vertices: points.map((_, i) => start + i), normal, material, kind: Math.abs(normal[2]) < 0.05 ? 'gable' : Math.abs(normal[2]) > 0.999 ? 'slab' : 'pan' });
  }
  /** Vertical wall face above the wall top (gable end), its normal turned away from `centre`. */
  gable(points: Vertex3[], material: string, centre: Point): void {
    let nx = 0,
      ny = 0,
      nz = 0,
      mx = 0,
      my = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
      mx += a.x;
      my += a.y;
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-9) return;
    const sign = nx * (mx / points.length - centre.x) + ny * (my / points.length - centre.y) < 0 ? -1 : 1;
    const start = this.vertices.length;
    this.vertices.push(...points);
    this.faces.push({ vertices: points.map((_, i) => start + i), normal: [(sign * nx) / length, (sign * ny) / length, (sign * nz) / length], material, kind: 'gable' });
  }
  mesh(): RoofMesh {
    return { vertices: this.vertices, faces: this.faces, edges: [], groups: [] };
  }
}

/** Loft every eave edge to its projection on the ridges: hip, gable and L roofs. */
export function ridgeRoof(roof: RoofBuilder, ring: readonly Point[], ridges: readonly [Point, Point][], eave: number, top: number, material: string): void {
  const at = (p: Point, z: number): Vertex3 => ({ x: p.x, y: p.y, z });
  // Same ridge-axis construction as the 2D pans (cityMassing.loftRidges), checked in plan.
  const faces = ridges.length ? loftRidges(ring, ridges, eave, top) : undefined;
  if (faces) {
    for (const f of faces) roof.face(f, material);
    return;
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    const pa = nearestOnRidges(a, ridges),
      pb = nearestOnRidges(b, ridges);
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 1e-3) roof.face([at(a, eave), at(b, eave), at(pa, top)], material);
    else roof.face([at(a, eave), at(b, eave), at(pb, top), at(pa, top)], material);
  }
}

export function insetRoof(roof: RoofBuilder, surface: Surface, eave: number, rise: number, material: string): void {
  for (const shape of surface) {
    const perimeter = ringLength(shape.outer) + shape.holes.reduce((s, r) => s + ringLength(r), 0);
    const area = Math.abs(ringArea(shape.outer)) - shape.holes.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
    if (perimeter <= 0 || area <= 0) continue;
    const d = Math.min(6, (0.85 * area) / perimeter),
      top = eave + rise;
    const rings = [{ ring: shape.outer, outer: true }, ...shape.holes.map(ring => ({ ring, outer: false }))];
    const inset = rings.map(({ ring, outer }) => insetRing(ring, d, outer));
    rings.forEach(({ ring }, r) => {
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length,
          a = ring[i],
          b = ring[j],
          c = inset[r][j],
          e = inset[r][i];
        roof.face(
          [
            { ...a, z: eave },
            { ...b, z: eave },
            { ...c, z: top },
            { ...e, z: top },
          ],
          material,
        );
      }
    });
    for (const triangle of surfaceTriangles([{ outer: inset[0], holes: inset.slice(1) }]))
      roof.face(
        triangle.map(p => ({ x: p.x, y: p.y, z: top })),
        material,
      );
  }
}

export function flatRoof(roof: RoofBuilder, surface: Surface, z: number, material: string): void {
  for (const triangle of surfaceTriangles(surface))
    roof.face(
      triangle.map(p => ({ x: p.x, y: p.y, z })),
      material,
    );
}

export const ringCentre = (ring: readonly Point[]): Point => ({ x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length });
