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

const idHash = (id: string, salt: number): number => {
  let h = 2166136261 ^ salt; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 8 & 0xffff) / 0xffff;
};

/** How much a building thaws its own roof snow, 0 (the mantle stays whole) to 1 (hearth burning all day under a thin
 * roof). Stable per building, from a hash of its id, and skewed: most roofs of a town keep their snow, a few thaw
 * well, so no rule shows from house to house. Dwellings and workshops reach the top of the range, halls and shrines
 * half of it, barns and stores a quarter. */
export function buildingHeat(id: string, fn = 'domestic'): number {
  const u = idHash(id, 0x3a1f), top = fn === 'domestic' || fn === 'mixed' || fn === 'workshop' ? 1 : fn === 'collective' ? .5 : .25;
  return top * u ** 2.2;
}

/** Depth of the mantle a building kept, 1 for most; about one roof in eight stands in the wind or was swept and
 * keeps a thin, even dusting (.45 to .8) on every face. */
export function buildingSnowDepth(id: string): number {
  const u = idHash(id, 0x77c5);
  return u < .125 ? .45 + 2.8 * u : 1;
}

/** Share of a full mantle left on a roof face (0..1). Every face of an ordinary building stays close to full: a
 * little less on steep pitches and smooth covers (metal, lead, slate let the slab slide; thatch and turf keep it).
 * Only a building that thaws (`heat`, see buildingHeat) loses more, first on the faces turned to the scene sun
 * (`light` > 0, the plan light of `roofLight`) and on its steep ones. */
export function roofSnowShare(normal: readonly number[], light: number, heat = 0, cover = ''): number {
  const hold = roofSnowCover(normal);
  if (!hold) return 0;
  const steep = clamp01((.86 - normal[2]) / .36), sun = clamp01(light * 2.2), warm = clamp01(heat);
  const slip = /^(metal|lead|slate)$/.test(cover) ? 1.35 : /^(thatch|reed|palm|turf)$/.test(cover) ? .55 : 1;
  // Flat roofs of the busiest households are shovelled after each fall (earthen terraces leak under a thaw).
  const cleared = normal[2] > .995 ? .4 * clamp01((warm - .6) * 2.5) : 0;
  const loss = .07 * steep * slip + warm * (slip < 1 ? .5 : 1) * (.1 + .45 * sun + .3 * steep * slip) + cleared;
  return hold * Math.max(.1, 1 - loss);
}

/** Bare strip below the ridge of a heated roof, as a share of the way from the ridge to the middle of the face: the
 * warm air under the ridge and around the chimney melts there first, the cold eaves keep their snow. */
export function roofSnowRidgeMelt(heat: number, light: number): number {
  return .055 + .4 * clamp01(heat) * (.45 + .55 * clamp01(.5 + light * 1.6));
}

/** Plan (2D) roofs: the snow patch of one roof face (walls stay untouched). Geometry stays inside the face: `border`
 * leaves a narrow dark edge at the eaves, `ridge` (default: the same) a wider bare strip towards the top of the face.
 * With a `seed`, every corner moves in or out by up to half `jitter` (a share of its way to the middle of the face,
 * never past the face's edge), so the patch of each face and of each building has its own uneven outline.
 * The 3D view whitens the roof triangles in place instead (an inset per triangle draws the triangulation as stripes). */
export function roofSnowPatches(points: readonly Vertex3[], normal: readonly number[], border = .055, ridge = border, seed?: number, jitter = 0): { points: Vertex3[]; weight: number }[] {
  const weight = roofSnowCover(normal);
  if (!weight || points.length < 3) return [];
  const centre = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length, z: s.z + p.z / points.length }), { x: 0, y: 0, z: 0 });
  let low = Infinity, high = -Infinity;
  for (const p of points) { low = Math.min(low, p.z); high = Math.max(high, p.z); }
  const span = high - low;
  const inset = points.map((p, i) => {
    let k = span > .05 ? border + (ridge - border) * (p.z - low) / span : border;
    if (seed !== undefined) {
      let h = Math.imul(seed ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
      k = Math.max(.02, Math.min(.85, k + jitter * (((h ^ (h >>> 13)) >>> 8 & 0xffff) / 0xffff - .5)));
    }
    return { x: p.x + (centre.x - p.x) * k, y: p.y + (centre.y - p.y) * k, z: p.z + (centre.z - p.z) * k };
  });
  return [{ points: inset, weight }];
}
/** Snow is cooler on the unlit face, while the original cover shows through. A thin cover (`amount` well below 1)
 * shows less than its share: a dusting only whitens the faces that hold snow best, a deep mantle whitens them all. */
export function snowRoofTint(base: PaletteRgb, amount: number, light: number): PaletteRgb {
  const shade = Math.max(0, Math.min(1, -light * 1.8));
  // Never pure white: sunlit snow keeps a warm grey, shaded snow is only a little bluer (both faces of a roof stay bright).
  const snow = [.955 - .11 * shade, .965 - .08 * shade, .97 - .04 * shade];
  const a = clamp01(amount), t = a * a * (3 - 2 * a);
  return base.map((v, i) => v + (snow[i] - v) * t) as PaletteRgb;
}
