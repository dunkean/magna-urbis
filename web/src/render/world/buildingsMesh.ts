/**
 * Vertices of town buildings, built on the CPU from the display scene (city3d meshes, farms, walls, yards): the faces
 * of each building (eachBuildingTriangle) with their paint (culture tint, cover and wall material classes, snow), in
 * groups that one program state draws.
 *
 * Shared by the two views that stand buildings on a terrain: V2's world view, top and tilted (buildingsLayer.ts, blocks
 * seated on TerrainHeights), and City Bench's separate 3D view (ui/urbanBuilding3d.ts, sectors of 256 m, its own relief).
 * They differ only in where a vertex stands, which `BuildingSeat` decides; colours, classes and geometry are one code.
 *
 * Vertex layout (BUILDING_STRIDE floats): x and y relative to the block origin in the GL frame of the 3D view
 * (x, height, y south), the normal in that frame scaled by 1 + code / 32 (material class, town grain and drawing layer),
 * then either the colour (flat program) or uv + material layer (textured program), then the seat's second value.
 *
 * The tilted world view keeps no colour in its vertices (`BuildingPaint.slots`): a face carries a colour slot, an index
 * into the look table of the style on screen (buildingsLookTable.ts), which `slotLooks` fills with the paint the colour
 * mode writes (`faceLook`, one code). Its normal's length then holds only what no look changes (lit windows, lot
 * boundary strips, crafted drawing layers), and its three colour floats are the slot (signed by the V1 roof edges) and
 * the night light of the wall, or uv + slot on a crafted face. Another style, season or ambience swaps the table.
 */
import type { HouseMaterial, MaterialPattern } from '../../../../rust/bridge/housesContract';
import { roofEdgeMasks } from '../roofEdges';
import { boundaryOf } from '../craftedBoundaries';
import { craftedMageCity } from '../craftedMageCity';
import { includeCraftedMassing } from '../craftedMassingBounds';
import { roofGrain, coverLayer, wallLayer, layerExtent, MATERIALS, type CoverGrain } from '../buildingMaterials';
import { buildingTint } from '../buildingPalette';
import { buildingHeat, nightSnow, roofSnowShare, snowRoofTint } from '../roofSnow';
import { mapGroundSnow } from '../seasonPalette';
import { buildingPaint, showsCraftedHouses, type UrbanBuildingAppearance } from '../urbanBuildingStyle';
import { building3dHeight, eachBuildingTriangle, isBuildingProjection, type Building3dVisual, type BuildingTriangle } from '../urbanBuildingGeometry';
import type { BuildingFeatureLod } from '../urbanBuildingFeatureLod';
import { massingLookOf } from '../city3d/materials';
import { volumeRoofPaint, volumeWallColor, type VolumeTownLook } from '../city/buildingLook';
import type { CityBuilding } from '../city/model/contract';
import { houseSurfaceLayer, HOUSE_TILE_LAYERS } from '../houseSurfaceTexture';
import { roofFaceForm } from '../houseRoofArt';
import { houseSurfaceMapper } from '../houseSurfaceUv';

export type Vec3 = [number, number, number];
/** min x, min y, min z, max x, max y, max z (map metres, absolute heights). */
export type BuildingBounds = [number, number, number, number, number, number];
export const BUILDING_STRIDE = 10;

/** Bounds of a building with its foundations and structural features. */
export function buildingBounds(building: Building3dVisual, crafted = false): BuildingBounds {
  if (crafted && building.culture?.culture === 'wizard-city' && !isBuildingProjection(building)) building = craftedMageCity(building);
  const box: BuildingBounds = [Infinity, Infinity, building.ground_z_m, -Infinity, -Infinity, building.ground_z_m + building3dHeight(building)];
  const features = isBuildingProjection(building) ? [] : building.structural_features;
  for (const surface of [building.footprint, building.roof_footprint, ...features.map(f => f.surface)])
    for (const shape of surface)
      for (const p of shape.outer) {
        box[0] = Math.min(box[0], p.x);
        box[1] = Math.min(box[1], p.y);
        box[3] = Math.max(box[3], p.x);
        box[4] = Math.max(box[4], p.y);
      }
  if (!isBuildingProjection(building)) for (const foundation of [...building.volumes.map(v => v.foundation), ...(building.structural_foundations ?? [])]) if (foundation) box[2] = Math.min(box[2], foundation.z_min_m);
  for (const feature of features) {
    box[2] = Math.min(box[2], feature.z_m);
    box[5] = Math.max(box[5], feature.z_m + feature.height_m);
  }
  for (const feature of features)
    for (const p of feature.vertices3d) {
      const point = [p.x, p.y, p.z];
      for (let i = 0; i < 3; i++) {
        box[i] = Math.min(box[i], point[i]);
        box[i + 3] = Math.max(box[i + 3], point[i]);
      }
    }
  if (crafted && !isBuildingProjection(building) && building.volumes.length) {
    const boundary = boundaryOf(building);
    if (boundary) {
      for (const line of boundary.lines)
        for (const p of line.points) {
          const pad = line.half + 0.48;
          box[0] = Math.min(box[0], p.x - pad);
          box[1] = Math.min(box[1], p.y - pad);
          box[2] = Math.min(box[2], p.g - 0.2);
          box[3] = Math.max(box[3], p.x + pad);
          box[4] = Math.max(box[4], p.y + pad);
          box[5] = Math.max(box[5], p.g + line.height + Math.max(0.85, line.height * 0.22));
        }
    } else includeCraftedMassing(building, box);
  }
  return box;
}

/** Terrain structures (city walls, bridges, quays, harbours) follow the relief whole: they have no ground level of
 * their own (Infinity). A building keeps its real height above its ground. */
export const buildingGround = (building: Building3dVisual): number => (/^city3d-(wall|bridge|quay|harbour|stairs)/.test(building.id) || !Number.isFinite(building.ground_z_m) ? Infinity : building.ground_z_m);

/** Where a vertex stands: fills `out[0]` (the vertex's second float) and `out[1]` (its last float). `ground` is
 * buildingGround(building); `faceGround` the ground under this point when the face follows the terrain (yards). */
export type BuildingSeat = (building: Building3dVisual, ground: number, x: number, y: number, z: number, faceGround: number | undefined, out: Float64Array) => void;
/** The separate 3D view: the absolute height, and the ground of the vertex its shader lifts with the exaggeration. */
export const viewSeat: BuildingSeat = (_building, ground, _x, _y, z, faceGround, out) => {
  out[0] = z;
  out[1] = faceGround ?? Math.min(z, ground);
};

/** What paints the faces: the appearance, the scene's material catalogue, the town altitudes that set the snow. */
export interface BuildingPaint {
  appearance: UrbanBuildingAppearance;
  materials: readonly HouseMaterial[];
  /** Keep the separate 3D viewer's inspectable list of distinct face colours. */
  collectPalette?: boolean;
  /** Mark house roof materials for the world plan shader. */
  planRoofs?: boolean;
  /** The world shader reads V1 roof edge coordinates from the sign bits of vertex colours. */
  roofInk?: boolean;
  /** The coarse levels of lot boundaries are strips that WORLD_BUILDING_VS widens (urbanBuildingGeometry.ts yardStrip). */
  yardStrips?: boolean;
  /** Mean ground of the town of a building (by id), which sets its snow (roofSnow.ts townRoofAltitudes). */
  snowAltitudes: { get(id: string): number | undefined };
  /** The tilted world view: the top view's town look. A massing roof face of a building the town draws takes the
   * colour of its pan there, light of its slope included (volumeRoofPaint), and is marked painted (its grain gain on
   * the normal's length, see `faceCode`); its walls take the town's wall colour and keep the volume's light. */
  look?: VolumeTownLook;
  /** The world view: faces carry colour slots gathered here instead of colours (see the header). */
  slots?: BuildingColorSlots;
}
/** What rides on the normal's length, 1 + code / 32: the material class (0 to 32), plus 64 times the grain gain of a
 * face painted by the town look in sixteenths (1 to 15; 0: not painted). Decoded by WORLD_BUILDING_VS. */
const faceCode = (cls: number, gain: number | undefined): number => cls + (gain === undefined ? 0 : 64 * Math.max(1, Math.min(15, Math.round(gain * 15))));
/** One group of faces drawn with one program state. `palette`: distinct colours of its faces (inspection). */
export interface BuildingBatchData {
  color: Vec3;
  tint: Vec3;
  recolored: boolean;
  vcolor: boolean;
  palette: Vec3[];
  stride: number;
  data: Float32Array;
}

function rgb(color: string): Vec3 {
  if (color.startsWith('rgb'))
    return color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map(v => v / 255) as Vec3;
  return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255) as Vec3;
}
/** Material layer of a display material id `city3d:<cover|wall|road>:<key>` (city3dMeshes.ts); -1 for any other material. */
function materialLayer(id: string | undefined): number {
  const m = /^city3d:(cover|wall|road):(.+)$/.exec(id ?? '');
  if (!m) return -1;
  return m[1] === 'cover' ? coverLayer(m[2]) : m[1] === 'wall' ? wallLayer(m[2]) : (MATERIALS.road[m[2]] ?? -1);
}
/** Procedural grain classes of the flat-colour program (materialGrain, buildingsShader.ts). Roof covers take the class
 * of the family the 2D plan gives the same pan (`roofGrain`: cover, flatness, culture), so both views show one cover;
 * wall materials follow. At most 31 (all in use): the class is stored in thirty-seconds on the normal's length. */
const ROOF_CLASS: Record<CoverGrain, number> = { tile: 1, pantile: 2, glazed: 3, slate: 4, slab: 5, paving: 6, thatch: 7, reed: 8, palm: 9, turf: 10, shingle: 11, bark: 12, bamboo: 13, earth: 14, lime: 15, metal: 16, felt: 17, hide: 18 };
/** Walls: lime plaster (rain streaks), timber frame (posts and rails under the plaster), boards and logs, brick, stone
 * courses, adobe and rammed earth, wattle and daub, upright bamboo, coral rag, hide (the stitched skins of the tent roof). */
const WALL_CLASS: Record<string, number> = {
  plaster: 19,
  timber: 20,
  wood: 21,
  brick: 22,
  stone: 23,
  earth: 24,
  wattle: 25,
  bamboo: 26,
  coral: 27,
  hide: 18,
  // Modern walls: cut limestone in large dressed courses, board-marked concrete (formwork panels, stains), curtain
  // wall (a regular grid of mullions on a smooth surface), steel cladding (the standing-seam class: upright joints).
  ashlar: 29,
  concrete: 30,
  glass: 31,
  steel: 16,
};
/** What a flat-coloured face carries above its colour, on the integer part of its red channel (red + 2 x extra, decoded
 * by FACE_EXTRA_GLSL): 1 to 15, the share of a full snow mantle on a roof face in fifteenths, which the shader lays over
 * the cover; 16 + 1 to 15, the light that falls at night on a wall from a lit door or window of it, whose place then rides
 * the same way on green (along the wall, half metres modulo 32 m) and blue (height above the ground, half metres). */
const GLOW_EXTRA = 16;
const snowExtra = (snow: number): number => Math.max(1, Math.min(15, Math.round(snow * 15)));
/** Walls lit by electric light: their cities burn brighter than hearths and lanterns. */
const ELECTRIC_WALLS = new Set(['concrete', 'glass', 'steel']);
/** Night light of the doors and windows of a house, 0 (dark) to 10: whether its people are up (its use and its own draw),
 * and its size. Nobody lives in monuments, halls and stores: their walls stay dark. */
function nightGlow(fn: string | undefined, height: number, draw: number, monument: boolean): number {
  const up = monument ? 0 : fn === 'mixed' ? 0.9 : fn === 'domestic' ? 0.85 : fn === 'workshop' ? 0.45 : 0;
  return draw < up ? Math.round(10 * Math.min(1, 0.55 + 0.04 * height) * (0.6 + (0.4 * draw) / up)) : 0;
}
/** A wall triangle written this building, waiting for the lit opening nearest it, and those openings. */
interface LitWall {
  batch: BuildingBatchData;
  at: number;
  normal: readonly number[];
  plane: number;
  low: number;
  high: number;
  level: number;
}
interface LitOpening {
  normal: readonly number[];
  plane: number;
  along: number;
  height: number;
}
/** Place along a wall, in the metres of the block (FACE_EXTRA_GLSL reads the same from the face normal). */
const alongWall = (x: number, y: number, normal: readonly number[]): number => (y * normal[0] - x * normal[1]) / (Math.hypot(normal[0], normal[1]) || 1);
/** Writes the light of the lit opening of its plane on each wall triangle, the lowest one (a door) first: both triangles
 * of a wall take the same. Boxes and overviews draw no opening: one stands every 32 m of their walls, in its own place. */
function lightWalls(walls: readonly LitWall[], openings: readonly LitOpening[], drawn: number | undefined, crafted: boolean, slotted: boolean): void {
  // `at` is the place in a batch that may have grown since: its data is read from the batch.
  for (const wall of walls) {
    let lit: LitOpening | undefined;
    for (const o of openings)
      if (o.along > wall.low - 0.5 && o.along < wall.high + 0.5 && Math.abs(o.plane - wall.plane) < 0.35 && o.normal[0] * wall.normal[0] + o.normal[1] * wall.normal[1] > 0.95 && (!lit || o.height < lit.height - 0.1 || (o.height < lit.height + 0.1 && o.along < lit.along)))
        lit = o;
    if (!lit && (drawn === undefined || crafted)) continue;
    const along = lit ? lit.along : drawn!,
      height = lit ? lit.height : 1.4,
      data = wall.batch.data,
      q = Math.floor((((along % 32) + 32) % 32) * 2) % 64,
      h = Math.max(0, Math.min(63, Math.round(height * 2)));
    for (let i = 0; i < 3; i++) {
      const at = wall.at + i * BUILDING_STRIDE;
      const add = (k: number, v: number): void => {
        const c = data[at + k];
        data[at + k] = c < 0 || Object.is(c, -0) ? c - v : c + v;
      };
      // A slotted face keeps its slot on the first float: the light and its place ride on the other two.
      if (slotted) {
        add(7, GLOW_EXTRA + wall.level + 32 * q);
        add(8, h);
        continue;
      }
      add(6, 2 * (GLOW_EXTRA + wall.level));
      add(7, 2 * q);
      add(8, 2 * h);
    }
  }
}
/** Class of a window lit at night (city3dMeshes.ts `LIT_WINDOW`), in every appearance and in both programs: past the
 * grain classes, it only tells the shaders which faces glow (buildingNight). */
const LIT_CLASS = 32;
const WINDOW_COLOR = rgb('#647779');
const DOOR_COLOR = rgb('#826549');
const GER_CLOTH = { roof: rgb('#e7ddca'), wall: rgb('#e4d8bf') };
/** Classes of a lot boundary strip, whose normal holds the side of the line of each vertex: a side face, the level top. */
const STRIP_SIDE_CLASS = 33,
  STRIP_TOP_CLASS = 34;
/** The matches of the two material id patterns read for every triangle, kept per id (a scene has a few dozen ids). */
const displayMaterials = new Map<string, RegExpExecArray | null>(),
  materialTints = new Map<string, RegExpExecArray | null>();
function displayMaterial(id: string): RegExpExecArray | null {
  let m = displayMaterials.get(id);
  if (m === undefined) {
    if (displayMaterials.size > 4096) displayMaterials.clear();
    displayMaterials.set(id, (m = /^city3d:(cover|wall):([a-z]+)$/.exec(id)));
  }
  return m;
}
/** The `@rrggbb` / `@rgb` tint suffix of a material id. */
function materialTint(raw: string | undefined): RegExpExecArray | null {
  const key = raw ?? '';
  let m = materialTints.get(key);
  if (m === undefined) {
    if (materialTints.size > 4096) materialTints.clear();
    materialTints.set(key, (m = /@([0-9a-f]{6}|[0-9a-f]{3})$/.exec(key)));
  }
  return m;
}
/** Grain class of a face from its display material id `city3d:<cover|wall>:<key>`; 0 (no grain) for openings, roads,
 * trees, snow huts, ruins and native materials. */
function materialClass(id: string | undefined, normal: readonly number[], culture: string): number {
  const m = displayMaterial(id ?? '');
  if (!m) return 0;
  if (m[1] === 'wall') return WALL_CLASS[m[2]] ?? 0;
  const grain = roofGrain(m[2], Math.abs(normal[2]) > 0.995 * (Math.hypot(normal[0], normal[1], normal[2]) || 1), culture);
  return grain ? ROOF_CLASS[grain] : 0;
}

const roofPatterns: Record<MaterialPattern, string> = { tile: 'tile', thatch: 'thatch', wood: 'shingle', stone: 'slab', earth: 'earth', fabric: 'felt', snow: 'snow', plain: 'lime' };
const wallPatterns: Record<MaterialPattern, string> = { tile: 'brick', thatch: 'wattle', wood: 'wood', stone: 'stone', earth: 'earth', fabric: 'hide', snow: 'snow', plain: 'plaster' };
/** Native plans use catalogue IDs. Massing plans also distinguish covers with the same grain, such as zinc and lead. */
function craftedLayer(face: BuildingTriangle, id: string, culture: string, patterns: Map<string, MaterialPattern>, role: string): number {
  // An ornament can tint an already-painted material again (mushroom caps, gills and skirts).
  // The face colour keeps that last tint; the drawing follows the underlying construction.
  const tint = id.indexOf('@');
  if (tint >= 0 && id.startsWith('city3d:')) id = id.slice(0, tint);
  if (id === 'city3d:tree:trunk') return houseSurfaceLayer('wall', culture, 'trunk');
  if (id === 'city3d:tree:crown') return houseSurfaceLayer('roof', culture, 'canopy');
  const m = displayMaterial(id);
  if (m?.[1] === 'wall') return m[2] in WALL_CLASS ? houseSurfaceLayer('wall', culture, m[2]) : 0;
  if (m?.[1] === 'cover') return houseSurfaceLayer('roof', culture, m[2], roofFaceForm(face.normal, role));
  if (id && id !== face.materials.coating && id !== face.materials.cladding) return 0;
  const pattern = patterns.get(id);
  const roof = face.surface === 'roof';
  if (id && !pattern) return 0;
  return roof ? houseSurfaceLayer('roof', culture, id, roofFaceForm(face.normal, role), roofPatterns[pattern ?? 'plain']) : houseSurfaceLayer('wall', culture, wallPatterns[pattern ?? 'plain']);
}
/** Texture coordinates (in tiles) of a point of a face, in world metres: vertical faces along the face and down (image upright),
 * pitched faces u along the ridge and v down the slope (stretched by the slope), flat faces on the plan. */
function faceUv(p: readonly number[], normal: readonly number[], layer: number): [number, number] {
  if (layer < 0) return [0, 0];
  const e = layerExtent(layer),
    nx = normal[0],
    ny = normal[1],
    nz = Math.abs(normal[2]),
    h = Math.hypot(nx, ny);
  if (nz < 0.3 && h > 1e-6) return [(p[0] * -ny + p[1] * nx) / h / e, -p[2] / e];
  if (h < 0.02) return [p[0] / e, p[1] / e];
  const dx = nx / h,
    dy = ny / h;
  return [(-p[0] * dy + p[1] * dx) / e, (p[0] * dx + p[1] * dy) / Math.max(nz, 0.2) / e];
}

/** The paint of one building's faces, whatever writes it (buildingBatches in colour mode, slotLooks for a look table). */
interface BuildingInk {
  building: Building3dVisual;
  culture: string;
  tone: number;
  role: string;
  house: boolean;
  /** A crafted house (showsCraftedHouses): its detail paint stays its own. */
  crafted: boolean;
  /** Its town item, when its faces take the top view's look. */
  item?: CityBuilding;
  catalogue: { materials: HouseMaterial[] };
  /** The colour of each surface and material, read for its first face. */
  colors: Map<string, Vec3>;
  /** Its ground snow (mapGroundSnow), which its roof faces hold a share of. */
  snow: number;
  /** The last roof face painted by the town look (the triangles of one face come in a row, with the same normal and slots). */
  lastNormal?: BuildingTriangle['normal'];
  lastSlots?: BuildingTriangle['materials'];
  lastRoof?: { color: Vec3; gain: number; family: number };
}
const idHash = (id: string): number => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h;
};
function buildingInk(building: Building3dVisual, paint: BuildingPaint): BuildingInk {
  const appearance = paint.appearance,
    ground = buildingGround(building),
    house = Number.isFinite(ground) && !building.id.startsWith('city3d-'),
    programme = (building as unknown as { programme?: { role?: string; landmark?: boolean } }).programme,
    textured = !!appearance.textured && appearance.roof !== 'crafted';
  return {
    building,
    culture: building.culture?.culture ?? '',
    tone: Math.round(((idHash(building.id) >>> 0) / 0xffffffff) * 15) / 15,
    role: `${programme?.role ?? ''}${programme?.landmark ? ' monument' : ''}`,
    house,
    crafted: house && showsCraftedHouses(appearance),
    item: paint.look && !textured && appearance.diagnostic === 'none' ? paint.look.item(building.id) : undefined,
    catalogue: { materials: paint.materials as HouseMaterial[] },
    colors: new Map(),
    snow: appearance.style !== 'silhouette' && appearance.diagnostic === 'none' ? mapGroundSnow(paint.snowAltitudes.get(building.id) ?? building.ground_z_m, appearance.roofSnow) : 0,
  };
}
type FaceOf = Pick<BuildingTriangle, 'surface' | 'materials' | 'normal'>;
/** The colour of a face before its snow (aperture joinery included), the town look's paint of its pan, and its grain
 * class: what both the vertex colours and the look tables write. */
function faceLook(ink: BuildingInk, face: FaceOf, raw: string, aperture: 'door' | 'window' | undefined, paint: BuildingPaint): { color: Vec3; townRoof?: { color: Vec3; gain: number; family: number }; cls: number } {
  const appearance = paint.appearance,
    building = ink.building,
    culture = ink.culture,
    tm = materialTint(raw),
    id = tm ? raw.slice(0, tm.index) : raw,
    item = ink.item;
  const massing = item && face.surface !== 'yard' ? massingLookOf(face.materials) : undefined;
  // A face of the volume's cover takes its pan's paint; one of its walls (not an opening) the town's wall colour.
  let townRoof: { color: Vec3; gain: number; family: number } | undefined;
  const explicitDetailPaint = ink.crafted && !!tm && (id?.includes('@') || (raw !== face.materials.cladding && raw !== face.materials.coating));
  if (massing && face.surface === 'roof' && id?.startsWith('city3d:cover:') && !explicitDetailPaint) {
    if (face.normal !== ink.lastNormal || face.materials !== ink.lastSlots) {
      const p = volumeRoofPaint(paint.look!.frame, item!, { ...massing, normal: face.normal });
      ink.lastRoof = { color: rgb(p.color), gain: p.gain, family: p.family };
      ink.lastNormal = face.normal;
      ink.lastSlots = face.materials;
    }
    townRoof = ink.lastRoof;
  }
  const townWall = !!massing && raw === face.materials.coating,
    key = face.surface + '|' + raw;
  let c = townRoof?.color ?? ink.colors.get(key);
  if (!c && townWall) {
    c = rgb(volumeWallColor(paint.look!.frame, item!, massing!));
    ink.colors.set(key, c);
  }
  if (!c) {
    // The paint is read for the first face of each material and surface only.
    const p = buildingPaint(face.materials, building.function, building3dHeight(building), appearance, id, ink.catalogue);
    c = rgb(face.surface === 'roof' ? p.roof : p.wall);
    if (appearance.diagnostic === 'none' || face.surface === 'yard') {
      if (tm?.[1].length === 6) c = rgb(`#${tm[1]}`);
      else if (tm) c = c.map((v, i) => Math.min(1, (v * parseInt(tm[1][i], 16)) / 8)) as Vec3;
      else if (culture && !building.id.startsWith('city3d-')) {
        const material = (s: string): string => /(?:^|[:/_-])(timber|wood|brick|stone|earth|plaster|bamboo|wattle|hide|coral|tile|slate|thatch|reed|palm|shingle|bark|turf|felt|snow|metal|lead)(?:$|[:/_-])/.exec(s)?.[1] ?? '';
        const w = material(face.materials.coating || face.materials.infill),
          r = material(face.materials.cladding);
        const t = buildingTint(culture, w, r, ink.tone, ink.role + (/tower|minaret|stone/.test(id) ? ' monument' : ''));
        c = face.surface === 'roof' ? t.roof : t.wall;
      }
    }
    if (face.surface === 'roof' && appearance.diagnostic === 'none' && appearance.colors?.building && !(ink.crafted && (id?.startsWith('city3d:detail:') || explicitDetailPaint))) c = rgb(appearance.colors.building);
    const tree = /^city3d:tree:(crown|trunk)$/.exec(id ?? ''); // switch treeHouseGreens: forest greens, whatever the colour mode
    if (tree) c = rgb(tm?.[1].length === 6 ? `#${tm[1]}` : tree[1] === 'crown' ? '#5f8247' : '#4b5a36'); // a canopy layer may carry its own green
    if (id === 'city3d:water') c = rgb('#' + (tm?.[1] ?? '8aaeb8'));
    ink.colors.set(key, c);
  }
  if (ink.crafted && culture === 'mongol-ordu' && !appearance.colors?.building) {
    const cloth = id === 'city3d:cover:felt' ? GER_CLOTH.roof : id === 'city3d:wall:hide' ? GER_CLOTH.wall : undefined;
    if (cloth) c = c.map((v, i) => (v + cloth[i]) * 0.5) as Vec3;
  }
  // The original aperture is almost black; leave enough daylight for glazing and joinery to read.
  if (aperture) c = aperture === 'door' ? DOOR_COLOR : WINDOW_COLOR;
  // Flat-colour program only: the material class rides on the normal's length (see materialGrain).
  // A face painted by the town look takes the grain family of its pan (the top view's grain marks, COVER_GRAIN_GLSL).
  const textured = !!appearance.textured && appearance.roof !== 'crafted',
    solid = ink.house && (appearance.roof === 'minimal' || (appearance.roof === 'flat' && face.surface === 'roof'));
  const cls = !textured && !solid && face.surface !== 'yard' && appearance.style === 'cartographic' && appearance.diagnostic === 'none' ? (townRoof ? townRoof.family : materialClass(id, face.normal, culture)) : 0;
  return { color: c, townRoof, cls };
}
/** Code 35 + class marks a house roof for the world plan shader (planRoofs), up to class 28. */
const roofCode = (paint: BuildingPaint, ink: BuildingInk, surface: BuildingTriangle['surface'], cls: number): number => (paint.planRoofs && ink.house && surface === 'roof' && cls <= 28 ? 35 + cls : cls);

/** One colour slot of the world view: what the paint of a face reads, besides the look. */
export interface ColorSlot extends FaceOf {
  building: Building3dVisual;
  raw: string;
  aperture?: 'door' | 'window';
  /** Eighths of its building's ground snow the face holds (roofSnowShare), in every season. */
  share: number;
  /** A crafted face drawn from the house surface atlas: its colour takes the snow tint, no mantle. */
  project: boolean;
}
/** Material slot objects by identity (the massing looks are kept by identity too), for the slot keys. */
const slotIds = new WeakMap<object, number>();
let slotIdNext = 0;
const slotIdOf = (slots: object): number => {
  let id = slotIds.get(slots);
  if (id === undefined) slotIds.set(slots, (id = slotIdNext++));
  return id;
};
/** The colour slots of a town's meshes, shared by every level and every look of one geometry (buildingsLayer.ts): one
 * per building, surface, material, pan and snow share. Grows as levels are built; never depends on the look. */
export class BuildingColorSlots {
  readonly list: (ColorSlot | undefined)[] = [];
  private readonly byBuilding = new Map<Building3dVisual, Map<string, number>>();
  private readonly free: number[] = [];
  private reused?: number[];
  private last = -1;
  get length(): number {
    return this.list.length;
  }
  /** Called after dropping old meshes. A retained building's meshes still address their original slots. */
  retainBuildings(buildings: readonly Building3dVisual[]): void {
    const keep = new Set(buildings);
    for (const [building, slots] of this.byBuilding) {
      if (keep.has(building)) continue;
      for (const index of slots.values()) {
        this.list[index] = undefined;
        this.free.push(index);
      }
      this.byBuilding.delete(building);
    }
  }
  takeReused(): number[] | undefined {
    const reused = this.reused;
    this.reused = undefined;
    return reused;
  }
  slot(building: Building3dVisual, face: FaceOf, raw: string, aperture: 'door' | 'window' | undefined, share: number, project: boolean): number {
    const last = this.list[this.last];
    if (last && last.normal === face.normal && last.materials === face.materials && last.raw === raw && last.surface === face.surface && last.share === share && last.aperture === aperture && last.project === project && last.building === building) return this.last;
    const n = face.normal,
      key = `${face.surface}|${raw}|${slotIdOf(face.materials)}|${n[0]},${n[1]},${n[2]}|${share}|${aperture ?? ''}|${project ? 1 : 0}`;
    let slots = this.byBuilding.get(building);
    if (!slots) this.byBuilding.set(building, (slots = new Map()));
    let index = slots.get(key);
    if (index === undefined) {
      index = this.free.pop();
      if (index === undefined) index = this.list.length;
      else (this.reused ??= []).push(index);
      slots.set(key, index);
      this.list[index] = { building, surface: face.surface, materials: face.materials, normal: face.normal, raw, aperture, share, project };
    }
    this.last = index;
    return index;
  }
}
/** The look table entries of slots `from` to `to` in `paint` (its appearance, season and town look), four floats each
 * at 4 x slot of `out`: the colour (a crafted face's under its snow tint), then the snow (fifteenths of a mantle the
 * shader lays) + 16 x the face code (faceCode: class and grain gain), which WORLD_BUILDING_VS reads. */
export function slotLooks(slots: BuildingColorSlots, from: number, to: number, paint: BuildingPaint, out: Float32Array): void {
  let ink: BuildingInk | undefined;
  for (let s = from; s < to; s++) {
    const slot = slots.list[s];
    if (!slot) continue;
    if (ink?.building !== slot.building) ink = buildingInk(slot.building, paint);
    const look = faceLook(ink, slot, slot.raw, slot.aperture, paint),
      snow = (ink.snow * slot.share) / 8,
      color = slot.project && snow ? snowRoofTint(look.color, snow, -(slot.normal[0] + slot.normal[1]) * 0.4, look.townRoof && paint.look!.frame.night ? nightSnow : undefined) : look.color;
    out[4 * s] = color[0];
    out[4 * s + 1] = color[1];
    out[4 * s + 2] = color[2];
    out[4 * s + 3] = (snow > 0 && !slot.project ? snowExtra(snow) : 0) + 16 * faceCode(roofCode(paint, ink, slot.surface, look.cls), look.townRoof?.gain);
  }
}

const seatOut = new Float64Array(2);
/** The vertex groups of `buildings` around `origin` (map metres), at one level of detail: `overview` (capped bodies),
 * `featureLod` (small structural features dropped), `yardLevel` (lot boundaries as ribbons). */
export function buildingBatches(buildings: Iterable<Building3dVisual>, origin: readonly [number, number], paint: BuildingPaint, overview: boolean, featureLod?: BuildingFeatureLod, yardLevel?: number, seat: BuildingSeat = viewSeat): BuildingBatchData[] {
  // Vertices go straight into one growing Float32Array per group. `seen` holds the colour objects already checked
  // against the palette (a building's faces share a few of them), so the palette is scanned once per colour, not once
  // per triangle.
  const appearance = paint.appearance,
    groups = new Map<string, { batch: BuildingBatchData; length: number; seen?: Set<Vec3> }>(),
    crafted = appearance.roof === 'crafted',
    textured = !!appearance.textured && !crafted,
    slots = textured ? undefined : paint.slots;
  const patterns = showsCraftedHouses(appearance) ? new Map(paint.materials.map(m => [m.id, m.pattern])) : undefined;
  const litWalls: LitWall[] = [],
    litOpenings: LitOpening[] = [];
  for (const original of buildings) {
    const building = patterns && original.culture?.culture === 'wizard-city' && !isBuildingProjection(original) ? craftedMageCity(original) : original;
    const culture = building.culture?.culture ?? '';
    const h = idHash(building.id);
    // Four lots can share one texture while retaining different course offsets and patinas.
    const finishOffset = (h >>> 30) * HOUSE_TILE_LAYERS;
    const programme = (building as unknown as { programme?: { role?: string; landmark?: boolean } }).programme;
    const ground = buildingGround(building);
    const house = Number.isFinite(ground) && !building.id.startsWith('city3d-');
    const craftedHouse = house ? patterns : undefined;
    const mapper = craftedHouse ? houseSurfaceMapper(building) : undefined;
    const glow = house && !textured ? nightGlow(building.function, building3dHeight(building), ((h >>> 8) & 255) / 256, !!programme?.landmark) : 0;
    litWalls.length = litOpenings.length = 0;
    const canInk = paint.roofInk && house && appearance.diagnostic === 'none';
    // Colour mode: the paint of the building's faces. The world view writes colour slots instead.
    const ink = slots ? undefined : buildingInk(building, paint);
    const paintFace = (face: BuildingTriangle, edges = 0, snow = 0, share = 0): void => {
      const raw = face.material ?? (face.surface === 'roof' ? face.materials.cladding : face.materials.coating),
        tm = materialTint(raw);
      const id = tm ? raw.slice(0, tm.index) : raw;
      // The massing uses the same aperture ID for ordinary windows and entry doors. Both
      // triangles of the door reach its threshold, including volumes on a lower terrace. A tipi's flap, up the slope of its
      // cover, is no joinery: it keeps its plain colour.
      let aperture: 'door' | 'window' | undefined;
      if (craftedHouse && (id === 'city3d:wall:opening' || id === 'city3d:wall:lit') && Math.abs(face.normal[2]) < 0.5 * Math.hypot(face.normal[0], face.normal[1], face.normal[2])) {
        const threshold = (face.ground?.[0] ?? ground) + 0.3;
        aperture = face.entrance || face.points.some(p => p[2] <= threshold) ? 'door' : 'window';
      }
      // Thin enclosures already carry their final yard colours. A roof/wall
      // atlas and its normal-map highlights turn subpixel copings into white
      // parcel outlines; retain the same matte material at every yard LOD.
      const solid = house && (appearance.roof === 'minimal' || (appearance.roof === 'flat' && face.surface === 'roof'));
      const layer = textured && !solid && !snow && face.surface !== 'yard' ? materialLayer(id ?? (face.surface === 'roof' ? face.materials.cladding : face.materials.coating)) : -1;
      const drawing = aperture ? houseSurfaceLayer('wall', culture, aperture) : craftedHouse && snow < 0.4 && face.surface !== 'yard' ? craftedLayer(face, id ?? '', culture, craftedHouse, programme?.role ?? '') : 0;
      const finish = drawing && !aperture ? drawing + finishOffset : drawing;
      const project = drawing && mapper ? mapper(face, id ?? '', !!aperture) : undefined;
      const lateral = face.lateral,
        // Codes 32 to 34 belong to the face whatever its look: a lit window, the side and top of a lot boundary strip.
        fixed = lateral ? (face.normal[2] > 0.5 ? STRIP_TOP_CLASS : STRIP_SIDE_CLASS) : id === 'city3d:wall:lit' ? LIT_CLASS : -1;
      let c: Vec3 | undefined,
        recolored = false,
        gain: number | undefined,
        code: number,
        key: string,
        red: number,
        green = 0,
        blue = 0,
        color24 = 0;
      if (slots) {
        // The world view: the slot whose paint the look table holds; the snow share rides in it, whatever the season.
        red = slots.slot(building, face, raw, aperture, share, !!project);
        code = Math.max(0, fixed);
        key = 'slot';
      } else {
        const look = faceLook(ink!, face, raw, aperture, paint);
        c = look.color;
        gain = look.townRoof?.gain;
        recolored = appearance.diagnostic === 'none' && ((!!appearance.colors?.building && face.surface === 'roof') || tm?.[1].length === 6 || (!!culture && !building.id.startsWith('city3d-')));
        // The shader lays the snow of a flat-coloured face over its cover. The other programs take it in the colour, under
        // the light the top view's look painted the pan with.
        const bare = c;
        if (snow) c = snowRoofTint(c, snow, -(face.normal[0] + face.normal[1]) * 0.4, look.townRoof && paint.look!.frame.night ? nightSnow : undefined);
        const laid = snow > 0 && !textured && !project,
          extra = laid ? snowExtra(snow) : 0;
        red = (laid ? bare[0] : c[0]) + 2 * extra;
        green = laid ? bare[1] : c[1];
        blue = laid ? bare[2] : c[2];
        // A complete sRGB8 colour fits exactly in one float. The two released channels carry
        // real per-vertex UVs on the crafted faces only. Plain and PBR meshes retain their original layout.
        color24 = project ? (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255) : 0;
        // Codes 35..63 carry a roof and its underlying grain class.
        code = fixed >= 0 ? fixed : roofCode(paint, ink!, face.surface, look.cls);
        key = textured ? `${c.join(',')}|${layer}|${recolored}|${!!snow}` : snow ? 'vertex-colour|true' : 'vertex-colour|false';
      }
      const unit = (1 + (faceCode(code, gain) + finish * 1024) / 32) / (lateral ? 1 : Math.hypot(face.normal[0], face.normal[1], face.normal[2]) || 1);
      let group = groups.get(key);
      if (!group) {
        const mean = MATERIALS.layers[layer]?.mean_rgb;
        const tint = mean && recolored && c ? (c.map((v, i) => v / Math.max(0.04, mean[i] / 255)) as Vec3) : tm?.[1].length === 3 ? ([...tm[1]].map(v => parseInt(v, 16) / 8) as Vec3) : ([1, 1, 1] as Vec3);
        group = { batch: { color: textured && c ? c : [1, 1, 1], tint, recolored, vcolor: !textured, palette: [], stride: BUILDING_STRIDE, data: new Float32Array(4096) }, length: 0, seen: paint.collectPalette === false || slots ? undefined : new Set() };
        groups.set(key, group);
      }
      const batch = group.batch,
        points = face.points;
      // A snowed face has a colour of its own (never seen before): it is compared by value, as every colour was.
      if (c && group.seen && (snow || !group.seen.has(c))) {
        const seen = c;
        if (!snow) group.seen.add(seen);
        if (!batch.palette.some(q => q[0] === seen[0] && q[1] === seen[1] && q[2] === seen[2])) batch.palette.push(seen);
      }
      if (group.length + points.length * BUILDING_STRIDE > batch.data.length) {
        const grown = new Float32Array(Math.max(batch.data.length * 2, group.length + points.length * BUILDING_STRIDE));
        grown.set(batch.data.subarray(0, group.length));
        batch.data = grown;
      }
      const data = batch.data;
      let at = group.length;
      if (glow && !project && !lateral && Math.abs(face.normal[2]) < 0.3) {
        const n = face.normal,
          flat = Math.hypot(n[0], n[1]) || 1,
          plane = (points[0][0] * n[0] + points[0][1] * n[1]) / flat;
        if (code === LIT_CLASS) {
          // One record per opening: the facade quads come as two triangles.
          const along = alongWall((points[0][0] + points[1][0] + points[2][0]) / 3 - origin[0], (points[0][1] + points[1][1] + points[2][1]) / 3 - origin[1], n),
            height = (Math.min(points[0][2], points[1][2], points[2][2]) + Math.max(points[0][2], points[1][2], points[2][2])) / 2 - ground,
            twin = litOpenings.at(-1);
          if (twin && twin.plane === plane && Math.abs(twin.along - along) < 1 && Math.abs(twin.height - height) < 0.2) twin.along = (twin.along + along) / 2;
          else litOpenings.push({ normal: n, plane, along, height });
        } else if (face.surface === 'wall' || displayMaterial(id ?? '')?.[1] === 'wall') {
          let low = Infinity,
            high = -Infinity;
          for (let i = 0; i < points.length; i++) {
            const along = ((points[i][1] - origin[1]) * n[0] - (points[i][0] - origin[0]) * n[1]) / flat;
            if (along < low) low = along;
            if (along > high) high = along;
          }
          const electric = ELECTRIC_WALLS.has(displayMaterial(id ?? '')?.[2] ?? '');
          litWalls.push({ batch, at, normal: n, plane, low, high, level: electric ? Math.round(glow * 1.5) : glow });
        }
      }
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        seat(building, ground, p[0], p[1], p[2], face.ground?.[i], seatOut);
        data[at++] = p[0] - origin[0];
        data[at++] = seatOut[0];
        data[at++] = p[1] - origin[1];
        data[at++] = (lateral ? lateral[i].x : face.normal[0]) * unit;
        data[at++] = (lateral ? 0 : face.normal[2]) * unit;
        data[at++] = (lateral ? lateral[i].y : face.normal[1]) * unit;
        const on = edges & ~(1 << i);
        if (textured) {
          const [u, v] = faceUv(p, face.normal, layer);
          data[at++] = u;
          data[at++] = v;
          // The material layer is integral; carry V1's mask in its fractional part.
          data[at++] = layer + on / 8;
        } else if (project) {
          const uv = project(p),
            packed = slots ? red : color24;
          data[at++] = uv[0];
          data[at++] = uv[1];
          data[at++] = project.underEave ? -(packed + 1) : packed;
        } else {
          // A negative channel is zero on that roof edge, positive is one. Interpolation in the
          // shader supplies distance to the side. All wall and interior triangle coordinates stay one.
          data[at++] = on & 1 ? -red : red;
          data[at++] = on & 2 ? -green : green;
          data[at++] = on & 4 ? -blue : blue;
        }
        data[at++] = seatOut[1];
      }
      group.length = at;
    };
    const snow = appearance.style !== 'silhouette' && appearance.diagnostic === 'none' ? mapGroundSnow(paint.snowAltitudes.get(building.id) ?? building.ground_z_m, appearance.roofSnow) : 0;
    // Slots keep the share of every roof face, whatever the season: the look table lays the snow.
    const heat = snow || slots ? buildingHeat(building.function) : 0;
    const paintTriangle = (face: BuildingTriangle, edges = 0): void => {
      // Tint each pan directly so the snow does not add seams or depth bias.
      const material = face.material ?? face.materials.cladding;
      const covered = (snow || slots) && face.surface === 'roof' && !/^city3d:(wall|tree|road|water)/.test(material) && !building.id.startsWith('city3d-');
      const share = covered ? Math.round(roofSnowShare(face.normal, -(face.normal[0] + face.normal[1]) * 0.4, heat, /^city3d:cover:([a-z]+)/.exec(material)?.[1]) * 8) : 0;
      paintFace(face, edges, (snow * share) / 8, share);
    };
    const detailed = !!craftedHouse || (!!patterns && !isBuildingProjection(building) && !!boundaryOf(building));
    if (canInk) {
      const triangles: BuildingTriangle[] = [];
      eachBuildingTriangle(building, face => triangles.push(face), overview, featureLod, yardLevel, paint.yardStrips, detailed);
      const masks = roofEdgeMasks(triangles);
      triangles.forEach((face, i) => paintTriangle(face, masks[i]));
    } else eachBuildingTriangle(building, paintTriangle, overview, featureLod, yardLevel, paint.yardStrips, detailed);
    if (litWalls.length) lightWalls(litWalls, litOpenings, overview ? (h >>> 16) % 32 : undefined, !!craftedHouse, !!slots);
  }
  const batches: BuildingBatchData[] = [];
  for (const { batch, length } of groups.values()) {
    if (!length) continue;
    batch.data = batch.data.slice(0, length);
    batches.push(batch);
  }
  return batches;
}
