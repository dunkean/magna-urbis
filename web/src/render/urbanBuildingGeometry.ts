import type { MaterialSlots, Point, Surface } from '../../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';

export type BuildingVector = [number, number, number];
export interface BuildingTriangle { points: [BuildingVector, BuildingVector, BuildingVector]; normal: BuildingVector; surface: 'wall' | 'roof'; materials: MaterialSlots; material?: string }

/** Exact even-odd horizontal trapezoids, split only at boundary vertices. This
 * display triangulation retains holes and changes no native boundary. */
export function surfaceTriangles(surface: Surface): [Point, Point, Point][] {
  const triangles: [Point, Point, Point][] = [];
  for (const shape of surface) {
    const rings = [shape.outer, ...shape.holes];
    const ys = [...new Set(rings.flatMap(r => r.map(p => p.y)))].sort((a, b) => a - b);
    for (let j = 1; j < ys.length; j++) {
      const low = ys[j - 1], high = ys[j], middle = (low + high) / 2;
      const edges: { a: Point; b: Point; x: number }[] = [];
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if (middle > Math.min(a.y, b.y) && middle < Math.max(a.y, b.y)) edges.push({ a, b, x: a.x + (middle - a.y) / (b.y - a.y) * (b.x - a.x) });
      }
      edges.sort((a, b) => a.x - b.x);
      const at = (edge: typeof edges[number], y: number): Point => ({ x: edge.a.x + (y - edge.a.y) / (edge.b.y - edge.a.y) * (edge.b.x - edge.a.x), y });
      for (let i = 0; i + 1 < edges.length; i += 2) {
        const a = at(edges[i], low), b = at(edges[i + 1], low), c = at(edges[i + 1], high), d = at(edges[i], high);
        if (b.x - a.x > 1e-9) triangles.push([a, b, c]);
        if (c.x - d.x > 1e-9) triangles.push([a, c, d]);
      }
    }
  }
  return triangles;
}

/** One display mesh iterator shared by GPU preparation and picking. All z are
 * absolute physical metres; roof faces are copied from native geometry. */
export function eachBuildingTriangle(building: PlacedBuilding, emit: (triangle: BuildingTriangle) => void, overview = false): void {
  const extrude = (surface: Surface, z: number, height: number, materials: MaterialSlots, cap: boolean, material?: string): void => {
    if (height <= 1e-8) return;
    for (const shape of surface) for (const [ri, ring] of [shape.outer, ...shape.holes].entries()) {
      let area = 0;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a.x * b.y - b.x * a.y; }
      const sign = (area >= 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < 1e-8) continue;
        const normal: BuildingVector = [sign * dy / length, -sign * dx / length, 0];
        emit({ points: [[a.x, a.y, z], [b.x, b.y, z], [b.x, b.y, z + height]], normal, materials, material, surface: 'wall' });
        emit({ points: [[a.x, a.y, z], [b.x, b.y, z + height], [a.x, a.y, z + height]], normal, materials, material, surface: 'wall' });
      }
    }
    if (cap) for (const triangle of surfaceTriangles(surface)) emit({ points: triangle.map(p => [p.x, p.y, z + height]) as BuildingTriangle['points'], normal: [0, 0, 1], materials, material, surface: 'wall' });
  };
  for (const volume of building.volumes) {
    const foundation = volume.foundation;
    if (foundation) extrude(foundation.footprint, foundation.z_min_m, foundation.z_max_m - foundation.z_min_m, volume.materials, true);
    if (volume.envelope !== 'open') for (const level of volume.levels) extrude(level.footprint, level.z_m, level.height_m, level.materials ?? volume.materials, false);
    if (overview) {
      // Subpixel facets become a capped native body outline, retaining each
      // volume's holes, location and maximum physical height. Picking shares it.
      const eaves = volume.z_m + volume.wall_height_m, top = eaves + volume.roof_height_m;
      if (volume.envelope !== 'open') extrude(volume.footprint, eaves, volume.roof_height_m, volume.materials, false, volume.materials.cladding);
      for (const triangle of surfaceTriangles(volume.footprint)) emit({ points: triangle.map(p => [p.x, p.y, top]) as BuildingTriangle['points'], normal: [0, 0, 1], materials: volume.materials, material: volume.materials.cladding, surface: 'roof' });
      continue;
    }
    const roof = volume.roof_mesh;
    if (roof) for (const face of roof.faces) for (let i = 1; i + 1 < face.vertices.length; i++) {
      const points = [face.vertices[0], face.vertices[i], face.vertices[i + 1]].map(index => roof.vertices[index]);
      if (points.some(p => !p)) continue;
      emit({ points: points.map(p => [p.x, p.y, p.z]) as BuildingTriangle['points'], normal: face.normal, materials: volume.materials, material: face.material, surface: 'roof' });
    }
  }
  const materials = building.volumes[0]?.materials;
  if (materials) for (const foundation of building.structural_foundations ?? []) extrude(foundation.footprint, foundation.z_min_m, foundation.z_max_m-foundation.z_min_m, materials, true, materials.base);
  if (materials) for (const feature of building.structural_features ?? []) {
    if (['stair', 'ladder'].includes(feature.kind) && feature.vertices3d.length >= 3) {
      const vertices = feature.vertices3d;
      for (let i = 1; i + 1 < vertices.length; i++) {
        const [a, b, c] = [vertices[0], vertices[i], vertices[i + 1]];
        const ab = [b.x - a.x, b.y - a.y, b.z - a.z], ac = [c.x - a.x, c.y - a.y, c.z - a.z];
        const cross: BuildingVector = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]], length = Math.hypot(...cross);
        if (length > 1e-9) emit({ points: [[a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]], normal: cross.map(v => v / length) as BuildingVector, materials, material: feature.material, surface: 'wall' });
      }
    } else extrude(feature.surface, feature.z_m, feature.height_m, materials, true, feature.material);
  }
}

/** Moller-Trumbore ray/triangle intersection, double-sided and in metric space. */
export function buildingRayDistance(origin: BuildingVector, direction: BuildingVector, triangle: BuildingTriangle['points']): number | null {
  const [a, b, c] = triangle;
  const sub = (u: BuildingVector, v: BuildingVector): BuildingVector => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const cross = (u: BuildingVector, v: BuildingVector): BuildingVector => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u: BuildingVector, v: BuildingVector): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), p = cross(direction, ac), determinant = dot(ab, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inv = 1 / determinant, s = sub(origin, a), u = dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(s, ab), v = dot(direction, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(ac, q) * inv;
  return distance >= 0 ? distance : null;
}
