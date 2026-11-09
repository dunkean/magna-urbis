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

/** Snow remains on shallow faces; steep covers retain separated downslope strips.
 * Geometry stays inside the face, leaving a narrow dark ridge/eave border. */
export function roofSnowPatches(points: readonly Vertex3[], normal: readonly number[], border = .055): { points: Vertex3[]; weight: number }[] {
  const nz = normal[2];
  if (nz < .12 || points.length < 3) return [];
  const centre = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length, z: s.z + p.z / points.length }), { x: 0, y: 0, z: 0 });
  const inset = points.map(p => ({ x: p.x + (centre.x - p.x) * border, y: p.y + (centre.y - p.y) * border, z: p.z + (centre.z - p.z) * border }));
  if (nz > .9) return [{ points: inset, weight: .97 }];
  const h = Math.hypot(normal[0], normal[1]), ux = -normal[1] / h, uy = normal[0] / h;
  const at = (p: Vertex3): number => p.x * ux + p.y * uy;
  const lo = Math.min(...inset.map(at)), hi = Math.max(...inset.map(at)), step = (hi - lo) / 4;
  if (step < .04) return [{ points: inset, weight: nz * .8 }];
  const clip = (ring: Vertex3[], edge: number, sign: number): Vertex3[] => ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length], da = (at(a) - edge) * sign, db = (at(b) - edge) * sign;
    const out = da >= 0 ? [a] : [];
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }); }
    return out;
  });
  const width = .45 + .4 * nz;
  return Array.from({ length: 4 }, (_, i) => ({ points: clip(clip(inset, lo + step * (i + (1 - width) / 2), 1), lo + step * (i + (1 + width) / 2), -1), weight: .48 + .49 * nz }))
    .filter(p => p.points.length >= 3);
}
/** Snow is cooler on the unlit face, while the original cover shows through. */
export function snowRoofTint(base: PaletteRgb, amount: number, light: number): PaletteRgb {
  const shade = Math.max(0, Math.min(1, -light * 1.8));
  const snow = [.97 - .23 * shade, .985 - .19 * shade, .99 - .14 * shade];
  const t = Math.max(0, Math.min(1, amount));
  return base.map((v, i) => v + (snow[i] - v) * t) as PaletteRgb;
}
