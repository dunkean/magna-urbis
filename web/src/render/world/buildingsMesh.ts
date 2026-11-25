/**
 * Vertices of town buildings, built on the CPU from the display scene (city3d meshes, farms, walls, yards): the faces
 * of each building (eachBuildingTriangle) with their paint (culture tint, cover and wall material classes, snow), in
 * groups that one program state draws.
 *
 * Shared by the two views that stand buildings on a terrain: the separate 3D view (ui/urbanBuilding3d.ts, sectors of
 * 256 m, its own exaggerated relief) and the tilted world view (buildingsLayer.ts, blocks seated on TerrainHeights).
 * They differ only in where a vertex stands, which `BuildingSeat` decides; colours, classes and geometry are one code.
 *
 * Vertex layout (BUILDING_STRIDE floats): x and y relative to the block origin in the GL frame of the 3D view
 * (x, height, y south), the normal in that frame scaled by 1 + code / 32 (material class, town grain and drawing layer),
 * then either the colour (flat program) or uv + material layer (textured program), then the seat's second value.
 */
import type { HouseMaterial, MaterialPattern } from '../../../../rust/bridge/housesContract';
import { roofEdgeMasks } from '../roofEdges';
import { craftedMageCity } from '../craftedMageCity';
import { includeCraftedMassing } from '../craftedMassingBounds';
import { roofGrain, coverLayer, wallLayer, layerExtent, MATERIALS, type CoverGrain } from '../buildingMaterials';
import { buildingTint } from '../buildingPalette';
import { buildingHeat, roofSnowShare, snowRoofTint } from '../roofSnow';
import { mapGroundSnow } from '../seasonPalette';
import { buildingPaint, showsCraftedHouses, type UrbanBuildingAppearance } from '../urbanBuildingStyle';
import { building3dHeight, eachBuildingTriangle, isBuildingProjection, type Building3dVisual, type BuildingTriangle } from '../urbanBuildingGeometry';
import type { BuildingFeatureLod } from '../urbanBuildingFeatureLod';
import { massingLookOf } from '../city3d/materials';
import { volumeRoofPaint, volumeWallColor, type VolumeTownLook } from '../city/buildingLook';
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
  if (crafted && !isBuildingProjection(building) && building.volumes.length) includeCraftedMassing(building, box);
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
/** Class of a roof face under snow: the mantle is uneven, thinner in places (materialGrain). */
const SNOW_CLASS = 28;
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
    textured = !!appearance.textured && !crafted;
  const catalogue = { materials: paint.materials as HouseMaterial[] };
  const patterns = showsCraftedHouses(appearance) ? new Map(paint.materials.map(m => [m.id, m.pattern])) : undefined;
  for (const original of buildings) {
    const building = patterns && original.culture?.culture === 'wizard-city' && !isBuildingProjection(original) ? craftedMageCity(original) : original;
    const colors = new Map<string, Map<string, Vec3>>(),
      culture = building.culture?.culture ?? '';
    let h = 2166136261;
    for (let i = 0; i < building.id.length; i++) h = Math.imul(h ^ building.id.charCodeAt(i), 16777619);
    // Four lots can share one texture while retaining different course offsets and patinas.
    const finishOffset = (h >>> 30) * HOUSE_TILE_LAYERS;
    const tone = Math.round(((h >>> 0) / 0xffffffff) * 15) / 15;
    const programme = (building as unknown as { programme?: { role?: string; landmark?: boolean } }).programme;
    const role = `${programme?.role ?? ''}${programme?.landmark ? ' monument' : ''}`;
    const ground = buildingGround(building);
    const house = Number.isFinite(ground) && !building.id.startsWith('city3d-');
    const craftedHouse = house ? patterns : undefined;
    const mapper = craftedHouse ? houseSurfaceMapper(building) : undefined;
    const canInk = paint.roofInk && house && appearance.diagnostic === 'none';
    // The town item of the building, when the faces take the top view's look; the last roof face painted (the
    // triangles of one face come in a row, with the same normal and slots).
    const item = paint.look && !textured && appearance.diagnostic === 'none' ? paint.look.item(building.id) : undefined;
    let lastNormal: BuildingTriangle['normal'] | undefined, lastSlots: BuildingTriangle['materials'] | undefined, lastRoof: { color: Vec3; gain: number; family: number } | undefined;
    const paintFace = (face: BuildingTriangle, edges = 0, snow = 0): void => {
      const raw = face.material ?? (face.surface === 'roof' ? face.materials.cladding : face.materials.coating),
        tm = materialTint(raw);
      const id = tm ? raw.slice(0, tm.index) : raw;
      // The massing uses the same aperture ID for ordinary windows and entry doors. Both
      // triangles of the door reach its threshold, including volumes on a lower terrace.
      let aperture: 'door' | 'window' | undefined;
      if (craftedHouse && (id === 'city3d:wall:opening' || id === 'city3d:wall:lit')) {
        const threshold = (face.ground?.[0] ?? ground) + .3;
        aperture = face.entrance || face.points.some(p => p[2] <= threshold) ? 'door' : 'window';
      }
      const massing = item && face.surface !== 'yard' ? massingLookOf(face.materials) : undefined;
      // A face of the volume's cover takes its pan's paint; one of its walls (not an opening) the town's wall colour.
      let townRoof: { color: Vec3; gain: number; family: number } | undefined;
      const explicitDetailPaint = !!craftedHouse && !!tm && (id?.includes('@') || (raw !== face.materials.cladding && raw !== face.materials.coating));
      if (massing && face.surface === 'roof' && id?.startsWith('city3d:cover:') && !explicitDetailPaint) {
        if (face.normal !== lastNormal || face.materials !== lastSlots) {
          const p = volumeRoofPaint(paint.look!.frame, item!, { ...massing, normal: face.normal });
          lastRoof = { color: rgb(p.color), gain: p.gain, family: p.family };
          lastNormal = face.normal;
          lastSlots = face.materials;
        }
        townRoof = lastRoof;
      }
      const townWall = !!massing && raw === face.materials.coating;
      // Thin enclosures already carry their final yard colours. A roof/wall
      // atlas and its normal-map highlights turn subpixel copings into white
      // parcel outlines; retain the same matte material at every yard LOD.
      const solid = house && (appearance.roof === 'minimal' || (appearance.roof === 'flat' && face.surface === 'roof'));
      const layer = textured && !solid && !snow && face.surface !== 'yard' ? materialLayer(id ?? (face.surface === 'roof' ? face.materials.cladding : face.materials.coating)) : -1;
      let surfaceColors = colors.get(face.surface);
      if (!surfaceColors) colors.set(face.surface, (surfaceColors = new Map()));
      let c = townRoof?.color ?? surfaceColors.get(String(raw));
      if (!c && townWall) {
        c = rgb(volumeWallColor(paint.look!.frame, item!, massing!));
        surfaceColors.set(String(raw), c);
      }
      if (!c) {
        // The paint is read for the first face of each material and surface only.
        const p = buildingPaint(face.materials, building.function, building3dHeight(building), appearance, id, catalogue);
        c = rgb(face.surface === 'roof' ? p.roof : p.wall);
        if (appearance.diagnostic === 'none' || face.surface === 'yard') {
          if (tm?.[1].length === 6) c = rgb(`#${tm[1]}`);
          else if (tm) c = c.map((v, i) => Math.min(1, (v * parseInt(tm[1][i], 16)) / 8)) as Vec3;
          else if (culture && !building.id.startsWith('city3d-')) {
            const material = (s: string): string => /(?:^|[:/_-])(timber|wood|brick|stone|earth|plaster|bamboo|wattle|hide|coral|tile|slate|thatch|reed|palm|shingle|bark|turf|felt|snow|metal|lead)(?:$|[:/_-])/.exec(s)?.[1] ?? '';
            const w = material(face.materials.coating || face.materials.infill),
              r = material(face.materials.cladding);
            const t = buildingTint(culture, w, r, tone, role + (/tower|minaret|stone/.test(id) ? ' monument' : ''));
            c = face.surface === 'roof' ? t.roof : t.wall;
          }
        }
        if (face.surface === 'roof' && appearance.diagnostic === 'none' && appearance.colors?.building && !(craftedHouse && (id?.startsWith('city3d:detail:') || explicitDetailPaint))) c = rgb(appearance.colors.building);
        const tree = /^city3d:tree:(crown|trunk)$/.exec(id ?? ''); // switch treeHouseGreens: forest greens, whatever the colour mode
        if (tree) c = rgb(tm?.[1].length === 6 ? `#${tm[1]}` : tree[1] === 'crown' ? '#5f8247' : '#4b5a36'); // a canopy layer may carry its own green
        if (id === 'city3d:water') c = rgb('#' + (tm?.[1] ?? '8aaeb8'));
        surfaceColors.set(String(raw), c);
      }
      if (craftedHouse && culture === 'mongol-ordu' && !appearance.colors?.building) {
        const cloth = id === 'city3d:cover:felt' ? GER_CLOTH.roof : id === 'city3d:wall:hide' ? GER_CLOTH.wall : undefined;
        if (cloth) c = c.map((v, i) => (v + cloth[i]) * .5) as Vec3;
      }
      if (snow) c = snowRoofTint(c, snow, -(face.normal[0] + face.normal[1]) * 0.4);
      // The original aperture is almost black; leave enough daylight for glazing and joinery to read.
      if (aperture) c = aperture === 'door' ? DOOR_COLOR : WINDOW_COLOR;
      const recolored = appearance.diagnostic === 'none' && ((!!appearance.colors?.building && face.surface === 'roof') || tm?.[1].length === 6 || (!!culture && !building.id.startsWith('city3d-')));
      // Flat-colour program only: the material class rides on the normal's length (see materialGrain); a snowed face
      // takes the snow class in place of its cover's.
      // A face painted by the town look takes the grain family of its pan (the top view's grain marks, COVER_GRAIN_GLSL).
      const cls = !textured && !solid && face.surface !== 'yard' && appearance.style === 'cartographic' && appearance.diagnostic === 'none' ? (snow >= 0.4 ? SNOW_CLASS : townRoof ? townRoof.family : materialClass(id, face.normal, culture)) : 0;
      const drawing = aperture ? houseSurfaceLayer('wall', culture, aperture) : craftedHouse && snow < .4 && face.surface !== 'yard' ? craftedLayer(face, id ?? '', culture, craftedHouse, programme?.role ?? '') : 0;
      const finish = drawing && !aperture ? drawing + finishOffset : drawing;
      const project = drawing && mapper ? mapper(face, id ?? '', !!aperture) : undefined;
      // A complete sRGB8 colour fits exactly in one float. The two released channels carry
      // real per-vertex UVs on the crafted faces only. Plain and PBR meshes retain their original layout.
      const color24 = project ? (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255) : 0;
      const lateral = face.lateral,
        code = lateral ? (face.normal[2] > 0.5 ? STRIP_TOP_CLASS : STRIP_SIDE_CLASS) : id === 'city3d:wall:lit' ? LIT_CLASS : cls,
        unit = (1 + (faceCode(code, townRoof?.gain) + finish * 1024) / 32) / (lateral ? 1 : Math.hypot(face.normal[0], face.normal[1], face.normal[2]) || 1);
      const key = textured ? `${c.join(',')}|${layer}|${recolored}|${!!snow}` : snow ? 'vertex-colour|true' : 'vertex-colour|false';
      let group = groups.get(key);
      if (!group) {
        const mean = MATERIALS.layers[layer]?.mean_rgb,
          shade = c;
        const tint = mean && recolored ? (shade.map((v, i) => v / Math.max(0.04, mean[i] / 255)) as Vec3) : tm?.[1].length === 3 ? ([...tm[1]].map(v => parseInt(v, 16) / 8) as Vec3) : ([1, 1, 1] as Vec3);
        group = { batch: { color: textured ? c : [1, 1, 1], tint, recolored, vcolor: !textured, palette: [], stride: BUILDING_STRIDE, data: new Float32Array(4096) }, length: 0, seen: paint.collectPalette === false ? undefined : new Set() };
        groups.set(key, group);
      }
      const batch = group.batch,
        points = face.points;
      // A snowed face has a colour of its own (never seen before): it is compared by value, as every colour was.
      if (group.seen && (snow || !group.seen.has(c))) {
        if (!snow) group.seen.add(c);
        if (!batch.palette.some(q => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) batch.palette.push(c);
      }
      if (group.length + points.length * BUILDING_STRIDE > batch.data.length) {
        const grown = new Float32Array(Math.max(batch.data.length * 2, group.length + points.length * BUILDING_STRIDE));
        grown.set(batch.data.subarray(0, group.length));
        batch.data = grown;
      }
      const data = batch.data;
      let at = group.length;
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
          const uv = project(p);
          data[at++] = uv[0];
          data[at++] = uv[1];
          data[at++] = project.underEave ? -(color24 + 1) : color24;
        } else {
          // A negative channel is zero on that roof edge, positive is one. Interpolation in the
          // shader supplies distance to the side. All wall and interior triangle coordinates stay one.
          data[at++] = on & 1 ? -c[0] : c[0];
          data[at++] = on & 2 ? -c[1] : c[1];
          data[at++] = on & 4 ? -c[2] : c[2];
        }
        data[at++] = seatOut[1];
      }
      group.length = at;
    };
    const snow = appearance.style !== 'silhouette' && appearance.diagnostic === 'none' ? mapGroundSnow(paint.snowAltitudes.get(building.id) ?? building.ground_z_m, appearance.roofSnow) : 0;
    const heat = snow ? buildingHeat(building.function) : 0;
    const paintTriangle = (face: BuildingTriangle, edges = 0): void => {
      // Tint each pan directly so the snow does not add seams or depth bias.
      const material = face.material ?? face.materials.cladding;
      const covered = snow && face.surface === 'roof' && !/^city3d:(wall|tree|road|water)/.test(material) && !building.id.startsWith('city3d-');
      const share = covered ? roofSnowShare(face.normal, -(face.normal[0] + face.normal[1]) * 0.4, heat, /^city3d:cover:([a-z]+)/.exec(material)?.[1]) : 0;
      paintFace(face, edges, (snow * Math.round(share * 8)) / 8);
    };
    if (canInk) {
      const triangles: BuildingTriangle[] = [];
      eachBuildingTriangle(building, face => triangles.push(face), overview, featureLod, yardLevel, paint.yardStrips, !!craftedHouse);
      const masks = roofEdgeMasks(triangles);
      triangles.forEach((face, i) => paintTriangle(face, masks[i]));
    } else eachBuildingTriangle(building, paintTriangle, overview, featureLod, yardLevel, paint.yardStrips, !!craftedHouse);
  }
  const batches: BuildingBatchData[] = [];
  for (const { batch, length } of groups.values()) {
    if (!length) continue;
    batch.data = batch.data.slice(0, length);
    batches.push(batch);
  }
  return batches;
}
