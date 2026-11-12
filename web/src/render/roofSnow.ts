import type { Vertex3 } from '../../../rust/bridge/housesContract';
import type { PaletteRgb } from './buildingPalette';

/** Retained parcel identities start with their owning layout. Sample one mean
 * altitude for the whole town, rather than changing snow at each house. */
export function townRoofAltitudes(buildings: readonly { id: string; parcel_id?: string; ground_z_m?: number }[]): Map<string, number> {
  const towns = new Map<string, { sum: number; count: number }>();
  const owner = (b: typeof buildings[number]): string => b.parcel_id?.split('/')[0].startsWith('layout-') ? b.parcel_id.split('/')[0] : b.id;
  for (const b of buildings) {
    const key = owner(b), town = towns.get(key) ?? { sum: 0, count: 0 };
    if (Number.isFinite(b.ground_z_m)) { town.sum += b.ground_z_m!; town.count++; }
    towns.set(key, town);
  }
  return new Map(buildings.map(b => { const town = towns.get(owner(b))!; return [b.id, town.count ? town.sum / town.count : 0]; }));
}

/** Snow share of a roof face: one even cover, a touch thinner on steep pitches; walls and near-vertical
 * faces (nz < .12) hold none. */
export function roofSnowCover(normal: readonly number[]): number {
  const nz = normal[2];
  return nz < .12 ? 0 : .98 - .04 * (1 - nz);
}

/** Plan (2D) roofs: snow is one uniform cover on every roof face (walls stay untouched).
 * Geometry stays inside the face, leaving a narrow dark ridge/eave border. The 3D view whitens the
 * roof triangles in place instead (an inset per triangle draws the triangulation as stripes). */
export function roofSnowPatches(points: readonly Vertex3[], normal: readonly number[], border = .055): { points: Vertex3[]; weight: number }[] {
  const weight = roofSnowCover(normal);
  if (!weight || points.length < 3) return [];
  const centre = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length, z: s.z + p.z / points.length }), { x: 0, y: 0, z: 0 });
  const inset = points.map(p => ({ x: p.x + (centre.x - p.x) * border, y: p.y + (centre.y - p.y) * border, z: p.z + (centre.z - p.z) * border }));
  return [{ points: inset, weight }];
}
/** Snow is cooler on the unlit face, while the original cover shows through. */
export function snowRoofTint(base: PaletteRgb, amount: number, light: number): PaletteRgb {
  const shade = Math.max(0, Math.min(1, -light * 1.8));
  const snow = [.97 - .23 * shade, .985 - .19 * shade, .99 - .14 * shade];
  const t = Math.max(0, Math.min(1, amount));
  return base.map((v, i) => v + (snow[i] - v) * t) as PaletteRgb;
}
