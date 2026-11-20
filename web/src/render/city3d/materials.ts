/**
 * Display material catalogue and palette slots. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads culture/programme inputs; initializes the unchanged material catalogue and returns derived material values.
 */
import type { HouseMaterial, MaterialPattern, MaterialSlots } from '../../../../rust/bridge/housesContract';
import { buildingTint, tintedWallColor } from '../buildingPalette';

export const TREE_CROWNS = ['city3d:tree:crown@5a7b41', 'city3d:tree:crown@5d7f44', 'city3d:tree:crown@618347', 'city3d:tree:crown@65874a'];

// ---------------------------------------------------------------- materials
/** Display-only materials: their pattern picks the shared house colour. */
const PATTERNS: MaterialPattern[] = ['tile', 'thatch', 'wood', 'stone', 'earth', 'fabric', 'snow', 'plain'];

export const CITY3D_MATERIALS: HouseMaterial[] = PATTERNS.map(pattern => ({ id: `city3d:${pattern}`, label: pattern, roles: [], pattern, origin: 'city3d', source_ref: null }));

// Layered ids `city3d:cover:<massing cover>`, `city3d:wall:<massing wall>`, `city3d:road:<surface>` keep the original massing
// material for the textured view (urbanBuilding3d.ts); their display pattern is the pattern the flat render always used.
// `quay`: harbour decks are plain paving (a stone pattern stretched over a whole deck read as 30 m slabs).
const MESH_ROAD_PATTERNS: Record<string, MaterialPattern> = { bridge: 'stone', timber: 'wood', quay: 'plain' };

export const WALL_ID: Record<MaterialPattern, string> = { tile: 'wall:brick', thatch: 'cover:thatch', wood: 'wall:timber', stone: 'wall:stone', earth: 'wall:earth', fabric: 'wall:hide', snow: 'cover:snow', plain: 'wall:plaster' };

export const COVER_ID: Record<MaterialPattern, string> = { tile: 'cover:tile', thatch: 'cover:thatch', wood: 'cover:shingle', stone: 'cover:slate', earth: 'cover:earth', fabric: 'cover:felt', snow: 'cover:snow', plain: 'cover:plaster' };

export const mat = (pattern: MaterialPattern): string => `city3d:${WALL_ID[pattern]}`;

export const roofMat = (pattern: MaterialPattern): string => `city3d:${COVER_ID[pattern]}`;

export const slots = (wall: MaterialPattern, roof: MaterialPattern): MaterialSlots => ({ frame: mat(wall), infill: mat(wall), coating: mat(wall), cladding: roofMat(roof), base: mat('stone'), roof_frame: mat('wood') });

/** Slots from the massing's own cover / wall ids (fallback patterns when unknown). */
export const massingSlots = (wall: string, cover: string, fallbackWall: MaterialPattern, fallbackRoof: MaterialPattern): MaterialSlots => {
  const w = wall in WALLS ? `city3d:wall:${wall}` : mat(fallbackWall),
    c = cover in COVERS ? `city3d:cover:${cover}` : roofMat(fallbackRoof);
  return { frame: w, infill: w, coating: w, cladding: c, base: mat('stone'), roof_frame: mat('wood') };
};

/** Massing covers and walls (urban/massing.rs) on the display materials. */
export const COVERS: Record<string, MaterialPattern> = {
  tile: 'tile',
  slate: 'stone',
  thatch: 'thatch',
  reed: 'thatch',
  palm: 'thatch',
  bamboo: 'wood',
  shingle: 'wood',
  bark: 'wood',
  turf: 'earth',
  hide: 'fabric',
  felt: 'fabric',
  earth: 'earth',
  plaster: 'plain',
  stone: 'stone',
  snow: 'snow',
  metal: 'stone',
  lead: 'stone',
  fungal: 'plain',
  ruin: 'stone',
  zinc: 'stone',
  bitumen: 'earth',
  glass: 'plain',
};

export const WALLS: Record<string, MaterialPattern> = {
  timber: 'wood',
  wood: 'wood',
  brick: 'tile',
  stone: 'stone',
  earth: 'earth',
  plaster: 'plain',
  bamboo: 'wood',
  wattle: 'earth',
  hide: 'fabric',
  coral: 'stone',
  concrete: 'stone',
  glass: 'plain',
  steel: 'stone',
  ashlar: 'stone',
};

CITY3D_MATERIALS.push(
  ...Object.entries(COVERS).map(([k, pattern]) => ({ id: `city3d:cover:${k}`, label: k, roles: [], pattern, origin: 'city3d', source_ref: null }) as HouseMaterial),
  ...Object.entries(WALLS).map(([k, pattern]) => ({ id: `city3d:wall:${k}`, label: k, roles: [], pattern, origin: 'city3d', source_ref: null }) as HouseMaterial),
  { id: 'city3d:wall:opening', label: 'opening', roles: [], pattern: 'wood', origin: 'city3d', source_ref: null } as HouseMaterial,
  { id: 'city3d:wall:lit', label: 'lit window', roles: [], pattern: 'wood', origin: 'city3d', source_ref: null } as HouseMaterial,
  ...Object.entries(MESH_ROAD_PATTERNS).map(([k, pattern]) => ({ id: `city3d:road:${k}`, label: k, roles: [], pattern, origin: 'city3d', source_ref: null }) as HouseMaterial),
);

// ---------------------------------------------------------------- volume details
// Six-digit suffixes are final sRGB; bucket tone, never individual channels.
export const hex6 = (t: readonly number[]): string =>
  t
    .map(v =>
      Math.max(0, Math.min(255, Math.round(v * 255)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

export const tinted = (id: string, tint: string): string => (tint ? `${id}@${tint}` : id);

/** The massing of a volume as the top view's town reads it (one pan's cover, wall, tone and asked wall colour), by the
 * slots object paletteSlots made for that volume: the tilted view paints the volume's faces with the 2D town's look
 * (render/world/buildingsMesh.ts, render/city/buildingLook.ts volumeRoofPaint). */
export interface MassingLook {
  cover: string;
  wall: string;
  tone: number;
  tint?: string;
}
const massingLooks = new WeakMap<MaterialSlots, MassingLook>();
export const massingLookOf = (slots: MaterialSlots): MassingLook | undefined => massingLooks.get(slots);

/** `tint`: wall colour the volume asks for ("#rrggbb"); the wall goes three quarters of the way to its muted tone,
 * by the helper the 2D plan uses (tintedWallColor). */
export function paletteSlots(plain: MaterialSlots, culture: string, wall: string, cover: string, tone: number, role: string, tint?: string): MaterialSlots {
  const p = buildingTint(culture, wall, cover, Math.round(tone * 15) / 15, role);
  const w = tinted(plain.coating, hex6(tint ? tintedWallColor(p.wall, tint, wall) : p.wall));
  const slots = { ...plain, frame: w, infill: w, coating: w, base: w, cladding: tinted(plain.cladding, hex6(p.roof)) };
  massingLooks.set(slots, { cover, wall, tone, tint });
  return slots;
}

export const OPENING = 'city3d:wall:opening@393126';

/** A window that shows a light at night (UrbanBuildingPass); by day it is an opening like the others. */
export const LIT_WINDOW = 'city3d:wall:lit@393126';

CITY3D_MATERIALS.push({ id: 'city3d:yard:hedge', label: 'hedge', roles: [], pattern: 'plain', origin: 'city3d', source_ref: null } as HouseMaterial);
