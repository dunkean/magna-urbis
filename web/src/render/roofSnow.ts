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

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Snow a roof face can hold under a full mantle, before exposure and the building's own heat (`roofSnowShare`):
 * a touch thinner on steep pitches; walls and near-vertical faces (nz < .12) hold none. */
export function roofSnowCover(normal: readonly number[]): number {
  const nz = normal[2];
  return nz < .12 ? 0 : .98 - .04 * (1 - nz);
}

/** How much a building melts its own roof snow, by its use alone (one rule for every roof of a town, no draw per
 * building): dwellings and workshops keep a fire, halls and shrines are heated at times, barns and stores are cold. */
export function buildingHeat(fn = 'domestic'): number {
  return fn === 'domestic' || fn === 'mixed' ? .65 : fn === 'workshop' ? .6 : fn === 'collective' ? .18 : .08;
}

/** Share of a full mantle left on a roof face (0..1), so a snowy town is not one white sheet: steep faces shed, faces
 * turned to the scene sun (`light` > 0, the plan light of `roofLight`) thaw, heated buildings thaw more and mostly where
 * the sun helps; smooth covers (metal, lead, slate) let the slab slide, thatch and turf insulate and keep it.
 * Shaded pitches of cold buildings stay white. */
export function roofSnowShare(normal: readonly number[], light: number, heat = 0, cover = ''): number {
  const hold = roofSnowCover(normal);
  if (!hold) return 0;
  const steep = clamp01((.86 - normal[2]) / .36), sun = clamp01(light * 2.2);
  const slip = /^(metal|lead|slate)$/.test(cover) ? 1.35 : /^(thatch|reed|palm|turf)$/.test(cover) ? .55 : 1;
  const warm = clamp01(heat) * (slip < 1 ? .5 : 1);
  // Flat roofs of the busiest households are shovelled after each fall (earthen terraces leak under a thaw).
  const cleared = normal[2] > .995 ? .4 * clamp01((heat - .6) * 2.5) : 0;
  const loss = .3 * steep * slip + .16 * sun + warm * (.05 + .3 * sun) + cleared;
  return hold * Math.max(.12, 1 - loss);
}

/** Bare strip below the ridge of a heated roof, as a share of the way from the ridge to the middle of the face: the
 * warm air under the ridge and around the chimney melts there first, the cold eaves keep their snow. */
export function roofSnowRidgeMelt(heat: number, light: number): number {
  return .055 + .4 * clamp01(heat) * (.45 + .55 * clamp01(.5 + light * 1.6));
}

/** Plan (2D) roofs: the snow patch of one roof face (walls stay untouched). Geometry stays inside the face: `border`
 * leaves a narrow dark edge at the eaves, `ridge` (default: the same) a wider bare strip towards the top of the face.
 * The 3D view whitens the roof triangles in place instead (an inset per triangle draws the triangulation as stripes). */
export function roofSnowPatches(points: readonly Vertex3[], normal: readonly number[], border = .055, ridge = border): { points: Vertex3[]; weight: number }[] {
  const weight = roofSnowCover(normal);
  if (!weight || points.length < 3) return [];
  const centre = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length, z: s.z + p.z / points.length }), { x: 0, y: 0, z: 0 });
  let low = Infinity, high = -Infinity;
  for (const p of points) { low = Math.min(low, p.z); high = Math.max(high, p.z); }
  const span = high - low;
  const inset = points.map(p => {
    const k = span > .05 ? border + (ridge - border) * (p.z - low) / span : border;
    return { x: p.x + (centre.x - p.x) * k, y: p.y + (centre.y - p.y) * k, z: p.z + (centre.z - p.z) * k };
  });
  return [{ points: inset, weight }];
}
/** Snow is cooler on the unlit face, while the original cover shows through. A thin cover (`amount` well below 1)
 * shows less than its share: a dusting only whitens the faces that hold snow best, a deep mantle whitens them all. */
export function snowRoofTint(base: PaletteRgb, amount: number, light: number): PaletteRgb {
  const shade = Math.max(0, Math.min(1, -light * 1.8));
  // Never pure white: sunlit snow keeps a warm grey, shaded snow the blue of the sky.
  const snow = [.955 - .18 * shade, .965 - .14 * shade, .97 - .09 * shade];
  const a = clamp01(amount), t = a * a * (3 - 2 * a);
  return base.map((v, i) => v + (snow[i] - v) * t) as PaletteRgb;
}
