import { DEFAULT_TEXT, cityTextLabels, drawMapLabels, textFamily, textPlacement, measureTextCached, type TextSettings } from './textLayer';
import { placeMapLabels } from './mapLabels';
import { PALETTES, type Palette } from './styles';
import { drawCityWaterways } from './cityWaterways';
/** City Bench map layer: one viewport-sized Canvas 2D in world coordinates.
 * The plan is indexed once in spatial bins; every camera change repaints only
 * the visible items, batched by style, with a level of detail chosen from the
 * metres per pixel. Geometry is never altered: each level draws the same plan. */
import type { Layout, Parcel, Partition, Point, Quay, Shape, Street } from '../../../rust/bridge/urban';
import type { Surface } from '../../../rust/bridge/housesContract';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { buildingColors, urbanFunctionColor, type UrbanBuildingAppearance } from './urbanBuildingStyle';
import { mapGroundSnow, roofSeasonKey } from './seasonPalette';
import { buildingHeat, buildingSnowDepth, roofSnowPatches, roofSnowRidgeMelt, roofSnowShare } from './roofSnow';
import { funeraryLandFill, roleLabel, uiRoleLocale, type RoleLocale } from './cityRoles';
import { COVER_GRAINS, MATERIALS, coverGrainFrame, coverGrainPattern, coverLayer, roofGrain as roofGrainFamily, roofPatternLevel, layerExtent, layerPattern, materialImagesNow, placeLayer, streetLayer, wallStoneLayer, type MaterialImages } from './buildingMaterials';
import { planBuildingColors, planRoofColor, planShade, roofRelief } from './cityBuildingPalette';
import { drawLotEnclosures, updateYardEnclosures } from './cityLotEnclosures'; // enclosures hook (cityLotEnclosures.ts)
import { cityWallDetails, drawCityWallGround, drawCityWalls } from './cityWalls'; // walls hook (cityWalls.ts)
import { streetToneAt, toneStamp, washAt } from './groundTone';
import { STREET_MIN_PX, emphasisAlpha, naturalMarks, pavedMarks, pavedRank, quayFill, roadGrain, roadPaint, sidewalkTone, streetRank, type RoadStyle } from './roadStyle';
import { layoutStreetPavements } from './roadPavement';
import { STRUCTURE_ROLES, blendLine, blendTone, blendsGround, groundWash, naturalGroundWash, isBlended, softStreet, type WashKind } from './groundBlend';
import { CityGround, boardwalkWidth, isBoardwalk, type CityGroundRaster } from './cityGround';
import { massingFootprint, planRoof, pieceShadows, pieceVolumes, readMassing, stiltDeck, stiltSupports, roofLight as roofLight3 } from './cityMassing';
import { drawGardenDetails } from './readableGardens';
import { softenRuralGround } from './countryside';
import { polygonCentroid as shapeRingCenter } from '../gen/core/geom';
import { roadSurface } from './roadSurface';
import { differenceS, unionS } from '../gen/geo/bool';
import { drawNightBuildings, drawNightTown, nightRoof } from './cityNight';
import { drawRuinPlan, ruinFootprint } from './cityRuins';

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export type CityView = 'tissue' | 'uses' | 'parcels' | 'buildings' | 'roles';
export type CityLod = 'far' | 'mid' | 'near' | 'close';
export type CityPalette = 'growth' | 'atlas' | 'ink' | 'terrain' | 'parchment';
export interface CityLayers { waterways?: boolean; reserve: boolean; allocated: boolean; centers: boolean; domains: boolean; quarters: boolean; blocks: boolean; streets: boolean; enclosures: boolean; /** Composition visibility for all parcel types and details; retained on the GPU's Canvas overlay. */ parcelOverlay?: boolean; /** Walls, hedges and fences of the lots; absent = shown. */ lotEnclosures?: boolean; /** The fences stand as 3D meshes: the plan paints the yard ground only. */ lotEnclosureMeshes?: boolean; /** Streets as a ground surface (square junctions, curb returns, tapers); absent = on, off = round-capped strokes. */ roadSurface?: boolean; parcels: boolean; gardens: boolean; places: boolean; fronts: boolean; axes: boolean; access: boolean }

// ---------------------------------------------------------------- levels of detail
const LOD_ORDER: CityLod[] = ['close', 'near', 'mid', 'far'];
/** Upper metres-per-pixel bound of close, near and mid; far is everything above. */
export const CITY_LOD_LIMITS = [0.55, 2.2, 9];
/** Level for a scale, keeping the previous one while the scale stays within
 * `hysteresis` (relative) of its band, so a zoom at a limit does not flicker. */
/** `?lod=off`: the building level of detail is never left, whatever the scale (houses on a whole town). */
export const CITY_LOD_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lod') === 'off';
export function selectCityLod(mpp: number, previous?: CityLod, hysteresis = 0.15): CityLod {
  if (CITY_LOD_OFF) return mpp <= CITY_LOD_LIMITS[0] ? 'close' : 'near';
  const index = CITY_LOD_LIMITS.findIndex(limit => mpp <= limit), raw = LOD_ORDER[index < 0 ? 3 : index];
  if (!previous || previous === raw) return raw;
  const i = LOD_ORDER.indexOf(previous), low = i === 0 ? 0 : CITY_LOD_LIMITS[i - 1], high = i === 3 ? Infinity : CITY_LOD_LIMITS[i];
  return mpp >= low * (1 - hysteresis) && mpp <= high * (1 + hysteresis) ? previous : raw;
}
const atLeast = (lod: CityLod, level: CityLod): boolean => LOD_ORDER.indexOf(lod) <= LOD_ORDER.indexOf(level);

// ---------------------------------------------------------------- roles
export const DISTRICT_ROLES: Record<string, { label: string; labelEn: string; color: string }> = {
  shanty: { label: 'Habitat informel', labelEn: 'Informal housing', color: '#b69274' },
  civic: { label: 'Civique', labelEn: 'Civic', color: '#d9a55b' }, market: { label: 'Marché', labelEn: 'Market', color: '#e8c35f' }, religious: { label: 'Religieux', labelEn: 'Religious', color: '#b79bd1' },
  craft: { label: 'Artisanat', labelEn: 'Crafts', color: '#cf9270' }, port: { label: 'Port', labelEn: 'Port', color: '#7eb2cc' }, elite: { label: 'Notables', labelEn: 'Notables', color: '#d98c8c' },
  commoner: { label: 'Commun', labelEn: 'Commoners', color: '#dccaa2' }, poor: { label: 'Pauvre', labelEn: 'Poor', color: '#b9ae98' }, garrison: { label: 'Garnison', labelEn: 'Garrison', color: '#919c89' },
  gardens: { label: 'Jardins', labelEn: 'Gardens', color: '#a6c28a' }, foreign: { label: 'Étrangers', labelEn: 'Foreigners', color: '#9cc6b6' },
};
export const BUILDING_FAMILIES: Record<string, { label: string; color: string }> = {
  worship: { label: 'Culte', color: '#7a54a8' }, commerce: { label: 'Commerce', color: '#c8862a' }, craft: { label: 'Artisanat', color: '#a2513a' },
  civic: { label: 'Civique', color: '#356fa3' }, defence: { label: 'Défense', color: '#4a505b' }, dwelling: { label: 'Habitat', color: '#8b7761' },
  garden: { label: 'Jardin', color: '#5c9a4b' },
};
const SPECIALITIES: Record<string, string> = { tanners: 'tanneurs', dyers: 'teinturiers', smiths: 'forgerons', potters: 'potiers', weavers: 'tisserands', butchers: 'bouchers', masons: 'maçons', millers: 'meuniers', fishers: 'pêcheurs', boatmen: 'bateliers', merchants: 'marchands', clergy: 'clergé' };
/** District role id (`craft:tanners` → craft). */
export const districtRoleKey = (role?: string): string | undefined => role?.split(/[.:/]/)[0]?.toLowerCase() || undefined;
/** District role label with its speciality in `locale`; the engine's French `label` is used in French only. */
export function districtRoleLabel(role: string, label?: string, locale: RoleLocale = uiRoleLocale()): string {
  if (label && locale === 'fr') return label;
  const [head, tail] = role.split(/[.:/]/), entry = DISTRICT_ROLES[head?.toLowerCase()];
  const base = (locale === 'fr' ? entry?.label : entry?.labelEn) ?? head;
  const speciality = tail && (locale === 'fr' ? SPECIALITIES[tail] : undefined) || tail?.replace(/[-_]/g, ' ');
  return speciality ? `${base} · ${speciality}` : base;
}
const FAMILY_ALIASES: Record<string, string> = { religious: 'worship', religion: 'worship', temple: 'worship', market: 'commerce', trade: 'commerce', shop: 'commerce', inn: 'commerce',
  military: 'defence', defense: 'defence', garrison: 'defence', fort: 'defence', housing: 'dwelling', domestic: 'dwelling', residential: 'dwelling', house: 'dwelling',
  gardens: 'garden', green: 'garden', open: 'garden', open_space: 'garden', institution: 'civic', public: 'civic', industry: 'craft', workshop: 'craft' };
const FUNCTION_FAMILY: Record<string, string> = { domestic: 'dwelling', mixed: 'commerce', workshop: 'craft', warehouse: 'commerce', collective: 'civic', open_space: 'garden', market: 'commerce', common: 'garden' };
/** Role family of a building: `worship.parish` → worship; the function when no role is known. */
export function roleFamily(role?: string | null, fn?: string): string {
  const head = role?.split(/[.:/]/)[0]?.toLowerCase();
  if (head && BUILDING_FAMILIES[head]) return head;
  if (head && FAMILY_ALIASES[head]) return FAMILY_ALIASES[head];
  return FUNCTION_FAMILY[fn ?? ''] ?? 'dwelling';
}
/** Name of a landmark role in the UI language (the engine's `label` only without a role); never a raw id tail such as « friday ». */
export const landmarkName = (role?: string, fallback = 'Monument', label?: string): string => role ? roleLabel(role) : label || fallback;

// ---------------------------------------------------------------- geometry
const EMPTY: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
function grow(box: Box, points: readonly Point[], pad = 0): Box {
  for (const p of points) {
    if (p.x - pad < box.minX) box.minX = p.x - pad; if (p.y - pad < box.minY) box.minY = p.y - pad;
    if (p.x + pad > box.maxX) box.maxX = p.x + pad; if (p.y + pad > box.maxY) box.maxY = p.y + pad;
  }
  return box;
}
export const shapeBox = (shape: Shape): Box => grow({ ...EMPTY }, shape.outer);
const surfaceBox = (surface: Surface): Box => surface.reduce((box, shape) => grow(box, shape.outer), { ...EMPTY });
const overlaps = (a: Box, b: Box): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const ringArea = (ring: readonly Point[]): number => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y; return s / 2; };
function inRing(ring: readonly Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i].y > p.y) !== (ring[j].y > p.y) && p.x < (ring[j].x - ring[i].x) * (p.y - ring[i].y) / (ring[j].y - ring[i].y) + ring[i].x) hit = !hit;
  return hit;
}
export const shapeContains = (shape: Shape, p: Point): boolean => inRing(shape.outer, p) && !(shape.holes ?? []).some(h => inRing(h, p));
/** Area-weighted centroid of the outer rings. */
function centroid(shapes: readonly Shape[]): Point | undefined {
  let a = 0, x = 0, y = 0;
  for (const { outer } of shapes) for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const c = outer[j].x * outer[i].y - outer[i].x * outer[j].y; a += c; x += (outer[j].x + outer[i].x) * c; y += (outer[j].y + outer[i].y) * c;
  }
  if (Math.abs(a) > 1e-6) return { x: x / (3 * a), y: y / (3 * a) };
  const box = shapes.reduce((b, s) => grow(b, s.outer), { ...EMPTY });
  return Number.isFinite(box.minX) ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : undefined;
}

// ---------------------------------------------------------------- spatial bins
/** Uniform bins over item boxes; a query returns each candidate once, in input order. */
export class SpatialBins {
  private cells = new Map<number, number[]>();
  private overflow: number[] = [];
  private seen: Uint32Array; private stamp = 0;
  constructor(readonly boxes: readonly Box[], private readonly cell = 96) {
    this.seen = new Uint32Array(boxes.length);
    boxes.forEach((box, index) => {
      if (!(box.minX <= box.maxX && box.minY <= box.maxY)) return;
      const x0 = Math.floor(box.minX / cell), x1 = Math.floor(box.maxX / cell), y0 = Math.floor(box.minY / cell), y1 = Math.floor(box.maxY / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1024) { this.overflow.push(index); return; }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const key = (x + 32768) * 65536 + (y + 32768), list = this.cells.get(key);
        if (list) list.push(index); else this.cells.set(key, [index]);
      }
    });
  }
  query(box: Box): number[] {
    const result: number[] = [], stamp = ++this.stamp;
    if (stamp === 0xffffffff) { this.seen.fill(0); this.stamp = 1; }
    const take = (i: number): void => { if (this.seen[i] !== this.stamp && overlaps(this.boxes[i], box)) { this.seen[i] = this.stamp; result.push(i); } };
    const x0 = Math.floor(box.minX / this.cell), x1 = Math.floor(box.maxX / this.cell), y0 = Math.floor(box.minY / this.cell), y1 = Math.floor(box.maxY / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) { for (const list of this.cells.values()) for (const i of list) take(i); }
    else for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const i of this.cells.get((x + 32768) * 65536 + (y + 32768)) ?? []) take(i);
    for (const i of this.overflow) take(i);
    return result.sort((a, b) => a - b);
  }
}

// ---------------------------------------------------------------- scene
export interface CityDistrict { layout: number; id: number; role?: string; label?: string; wealth?: number; tissue: string; phase: number; anchor?: Point }
export interface CityAllocation { role?: string; label?: string; wealth?: number; function: string; landmark: boolean; households?: number; demandId: string; culture: string }
export interface CityBlock { ground?: Shape[]; groundPath?: Path2D; layout: number; index: number; shape: Shape; kind: string; zone: string; phase: number; quarter: number; district?: CityDistrict; peripheral: boolean; path?: Path2D }
export interface CityParcel { ground?: Shape[]; groundPath?: Path2D; layout: number; index: number; shape: Shape; use: string; block: number; zone: string; id?: string; allocation?: CityAllocation; district?: CityDistrict; peripheral: boolean; source: Parcel; path?: Path2D }
export interface CityStreet { layout: number; index: number; street: Street; width: number; rank: number; role: string; path?: Path2D }
export interface CityWall { kind: string; pieces: Point[][]; gates: Point[]; gateTowers: Point[]; towers: Point[] }
export interface CityLandmark { point: Point; family: string; label: string; parcel?: number; box: Box }
export interface CityScene {
  layouts: readonly Layout[]; blocks: CityBlock[]; parcels: CityParcel[]; streets: CityStreet[]; walls: CityWall[]; districts: CityDistrict[];
  landmarks: CityLandmark[]; footprint: Shape[]; ground?: CityGround; extent: Box; quays?: Quay[];
  /** Walls, hedges and fences round the lots (enclosures hook). */
  lotEnclosures?: import('../../../rust/bridge/urban').LotEnclosure[];
  enclosureProfiles?: (import('../../../rust/bridge/urban').ResolvedEnclosure | undefined)[];
  lotYards?: import('./cityLotEnclosures').Yard[];
  bins: { blocks: SpatialBins; parcels: SpatialBins; streets: SpatialBins; landmarks: SpatialBins };
  parcelById: Map<string, number>;
}
export interface CityBuilding { ruins?: Surface; stilts?: boolean; /** Some volume has a flat roof (bevelled rim in plan; parchment draws its ground shadow). */ flat?: boolean; snowAltitude?: number; /** Depth of the snow mantle the building kept: 1, or less for a thin even dusting (roofSnow.ts). */ snowDepth?: number; /** Weathering of the roof, 0 (new cover) to 1 (old, mossy), stable per building. */ age?: number; id: string; surface: Surface; footprint?: Surface; fn: string; family: string; role?: string; landmark: boolean; parcel?: number; building: PlacedBuilding; material?: { culture: string; wall: string; cover: string; tone: number }; path?: Path2D; footprintPath?: Path2D }
/** Roof pans of the massing (cityMassing.ts): one polygon per sloped face, its
 * building and its light; height shadows per building (sun from the north-west). */
/** `dir`: downslope direction of each pan in plan (radians, atan2 of the face normal's horizontal part; 0 when flat). */
export interface CityRoofs { shapes: Shape[]; owner: Uint32Array; light: Float32Array; cover: string[]; wall?: string[]; tone: Float32Array; dir: Float32Array; /** 0 = pitched, 1 = single flat slab, 2 = terrace. */ flat?: Uint8Array; /** Share of a full snow mantle the pan keeps (0: never snowed). */ snow?: Float32Array; /** Snow patch laid over the pan before it (drawn only with snow on the ground): 1 the wide thin one, 2 the full core (natural grounds only). */ patch?: Uint8Array; /** Grain family of the pan: 1 + its index in COVER_GRAINS (buildingMaterials.ts), 0 for none. */ grain?: Uint8Array; shadows: Shape[][] }
export interface CityBuildings { items: CityBuilding[]; bins: SpatialBins; byId: Map<string, number>; roofs?: CityRoofs }

/** Optional contract fields read defensively: older plans render without them. */
type DistrictContract = { role?: string; label?: string; wealth?: number };
type AllocationContract = { role?: string; label?: string; wealth?: number; landmark?: boolean; households?: number };
type EnclosureContract = { towers?: Point[] };

/** The wall stroke stops at each gate, so roads remain visible through it. */
function wallPieces(points: Point[], gates: Point[]): { pieces: Point[][]; gateTowers: Point[] } {
  const pieces: Point[][] = [], gateTowers: Point[] = [];
  if (points.length < 2) return { pieces, gateTowers };
  const closed = points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y ? points : [...points, points[0]];
  let current: Point[] = [];
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1], b = closed[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const at = (d: number): Point => ({ x: a.x + dx * d / length, y: a.y + dy * d / length });
    const gaps = gates.flatMap(g => {
      const along = ((g.x - a.x) * dx + (g.y - a.y) * dy) / length, across = Math.abs((g.x - a.x) * dy - (g.y - a.y) * dx) / length;
      if (across > 6 || along < -6 || along > length + 6) return [];
      const half = Math.sqrt(36 - across * across);
      return [[Math.max(0, along - half), Math.min(length, along + half)]];
    }).sort((p, q) => p[0] - q[0]);
    let start = 0;
    if (!current.length) current.push(a);
    for (const [from, to] of gaps) {
      if (from > start) current.push(at(from));
      if (current.length > 1) pieces.push(current);
      if (from > 0.01) gateTowers.push(at(from));
      if (to < length - 0.01) gateTowers.push(at(to));
      current = [at(Math.max(start, to))]; start = Math.max(start, to);
    }
    current.push(b);
  }
  if (current.length > 1) pieces.push(current);
  return { pieces, gateTowers };
}

export function buildCityScene(layouts: readonly Layout[], partitions: readonly Partition[] = [], terrain?: CityGroundRaster): CityScene {
  const ground = terrain && new CityGround(terrain);
  const blocks: CityBlock[] = [], parcels: CityParcel[] = [], streets: CityStreet[] = [], walls: CityWall[] = [], districts: CityDistrict[] = [];
  const landmarks: CityLandmark[] = [], footprint: Shape[] = [], parcelById = new Map<string, number>();
  const extent = { ...EMPTY }, quays: Quay[] = [];
  // Water clipping runs once for the whole scene (one Rust call), after the walk.
  const pendingGround: { target: { ground?: Shape[] }; shape: Shape }[] = [], footprintSources: Shape[] = [];
  layouts.forEach((layout, li) => {
    for (const q of layout.structure?.quays ?? []) { quays.push(q); grow(extent, q.shape.outer); }
    const phases = layout.phases ?? [];
    const byQuarter = new Map<number, CityDistrict>(), districtShapes = new Map<CityDistrict, Shape[]>();
    for (const d of layout.structure?.districts ?? []) {
      const extra = d as typeof d & DistrictContract;
      const district: CityDistrict = { layout: li, id: d.id, role: extra.role || undefined, label: extra.label || undefined, wealth: typeof extra.wealth === 'number' ? extra.wealth : undefined, tissue: d.tissue, phase: d.phase };
      districts.push(district); districtShapes.set(district, []);
      for (const q of d.quarters) byQuarter.set(q, district);
    }
    const walled = (layout.enclosures?.length ?? 0) > 0;
    const zoneOf = (quarter: number, zone?: string, phase?: number): { zone: string; phase: number; peripheral: boolean } => {
      const q = layout.quarters[quarter], p = phase ?? q?.phase ?? 0, growth = phases[p];
      const z = zone ?? q?.zone ?? growth?.zone ?? 'core', kind = growth?.kind;
      return { zone: kind === 'faubourg' ? 'faubourg' : z, phase: p, peripheral: kind === 'faubourg' || ['edge', 'faubourg', 'village'].includes(growth?.zone ?? z) && !walled };
    };
    layout.blocks.forEach((block, bi) => {
      const z = zoneOf(block.quarter, block.zone, block.phase), district = byQuarter.get(block.quarter);
      const shape = block.kind === 'reserve' ? softenRuralGround(block.shape) : block.shape;
      const item: CityBlock = { layout: li, index: bi, shape, ground: undefined, kind: block.kind, zone: z.zone, phase: z.phase, quarter: block.quarter, district, peripheral: z.peripheral };
      blocks.push(item); if (ground) pendingGround.push({ target: item, shape });
      if (district && !block.kind.startsWith('reserve')) districtShapes.get(district)!.push(block.shape);
      grow(extent, block.shape.outer);
    });
    for (const [district, shapes] of districtShapes) district.anchor = centroid(shapes);
    footprintSources.push(...(layout.structure?.allocated?.length ? layout.structure.allocated : layout.quarters.map(q => q.shape)));
    layout.streets.forEach((street, si) => {
      const width = street.widths.length ? street.widths.reduce((s, w) => s + w, 0) / street.widths.length : 4;
      streets.push({ layout: li, index: si, street, width: isBoardwalk(street.role) ? boardwalkWidth(width) : Number.isFinite(width) && width > 0 ? width : 4, rank: street.rank, role: street.role });
    });
    for (const enclosure of layout.enclosures ?? []) {
      const { pieces, gateTowers } = wallPieces(enclosure.path, enclosure.gates);
      walls.push({ kind: enclosure.kind, pieces, gates: enclosure.gates, gateTowers, towers: (enclosure as typeof enclosure & EnclosureContract).towers ?? [] });
    }
    const partition = partitions.find(p => p.key === layout.key);
    if (!partition) return;
    const allocations = new Map<string, CityAllocation>();
    for (const a of partition.programme?.allocations ?? []) {
      const extra = a as typeof a & AllocationContract;
      allocations.set(a.parcelId, { role: extra.role || undefined, label: extra.label || undefined, wealth: typeof extra.wealth === 'number' ? extra.wealth : undefined, function: a.function, landmark: extra.landmark === true, households: typeof extra.households === 'number' ? extra.households : undefined, demandId: a.demandId, culture: a.culture });
    }
    partition.parcels.forEach((parcel, pi) => {
      const block = layout.blocks[parcel.block], z = zoneOf(block?.quarter ?? -1, block?.zone, block?.phase);
      const allocation = parcel.id ? allocations.get(parcel.id) : undefined, index = parcels.length;
      const shape = parcel.use === 'reserve' ? softenRuralGround(parcel.shape) : parcel.shape;
      const item: CityParcel = { layout: li, index: pi, shape, ground: undefined, use: parcel.use, block: parcel.block, zone: z.zone, id: parcel.id, allocation, district: block && byQuarter.get(block.quarter), peripheral: z.peripheral, source: parcel };
      parcels.push(item); if (ground) pendingGround.push({ target: item, shape });
      if (parcel.id) parcelById.set(parcel.id, index);
      if (allocation?.landmark || parcel.use === 'market') {
        const point = centroid([parcel.shape]);
        if (point) landmarks.push({ point, parcel: index, box: { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y },
          family: parcel.use === 'market' && !allocation?.role ? 'commerce' : roleFamily(allocation?.role, allocation?.function), label: landmarkName(allocation?.role, parcel.use === 'market' ? 'Marché' : 'Monument', allocation?.label) });
      }
    });
  });
  if (ground) {
    const clipped = ground.clipMany([...pendingGround.map(p => p.shape), ...footprintSources]);
    pendingGround.forEach((p, i) => { p.target.ground = clipped[i]; });
    footprint.push(...clipped.slice(pendingGround.length).flat());
  } else footprint.push(...footprintSources);
  // Native previews supply occupied houses later; an empty cadastre has no fences.
  const lotEnclosures: import('../../../rust/bridge/urban').LotEnclosure[] = [];
  const enclosureProfiles = layouts.map(l => partitions.find(p => p.key === l.key)?.enclosure);
  return { layouts, blocks, parcels, streets, walls, districts, landmarks, footprint, extent, parcelById, quays, ground, lotEnclosures, enclosureProfiles,
    bins: { blocks: new SpatialBins(blocks.map(b => shapeBox(b.shape)), 128), parcels: new SpatialBins(parcels.map(p => shapeBox(p.shape)), 64),
      streets: new SpatialBins(streets.map(s => grow({ ...EMPTY }, s.street.path, s.width)), 128), landmarks: new SpatialBins(landmarks.map(l => l.box), 128) } };
}

/** Stable 0..1 value of a building id (one independent stream per salt). */
function idUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 8) & 0xffff) / 0xffff;
}
/** Buildings of a scene, linked to their parcel allocation for roles. */
export function buildCityBuildings(batch: Pick<PlacementBatch, 'buildings'> | undefined, plan?: CityScene): CityBuildings {
  const items: CityBuilding[] = [], byId = new Map<string, number>();
  const roofShapes: Shape[] = [], roofOwner: number[] = [], roofLight: number[] = [], roofCover: string[] = [], roofWall: string[] = [], roofTone: number[] = [], roofDir: number[] = [], roofFlat: number[] = [], roofSnow: number[] = [], roofPatch: number[] = [], roofGrainOf: number[] = [], shadows: Shape[][] = [];
  for (const building of batch?.buildings ?? []) {
    let surface = building.roof_footprint.length ? building.roof_footprint : building.footprint;
    if (!surface.length) continue;
    const programme = (building as PlacedBuilding & { programme?: AllocationContract }).programme;
    const parcel = plan?.parcelById.get(building.parcel_id), allocation = parcel === undefined ? undefined : plan!.parcels[parcel].allocation;
    const massing = readMassing(programme, building.footprint, building.id);
    const byPiece = massing && building.footprint.map((shape, i) => pieceVolumes(shape, massing[i])), volumes = byPiece?.flat(), first = volumes?.[0];
    if (volumes) {
      if (volumes.some(v => v.detail?.stilts_m || ['tree', 'mushroom', 'yurt', 'tower'].includes(v.detail?.form ?? ''))) surface = volumes.flatMap(v => v.detail?.stilts_m
        ? [{ ...v.shape, outer: stiltDeck(v.shape.outer) }, ...stiltSupports(v.shape.outer).map(p => ({ outer: [{ x: p.x - 0.16, y: p.y - 0.16 }, { x: p.x + 0.16, y: p.y - 0.16 }, { x: p.x + 0.16, y: p.y + 0.16 }, { x: p.x - 0.16, y: p.y + 0.16 }], holes: [] }))]
        : [v.shape]);
    }
    const culture = building.culture?.culture || allocation?.culture || (parcel === undefined ? '' : plan?.layouts[plan.parcels[parcel].layout]?.culture) || '';
    byId.set(building.id, items.length);
    items.push({ id: building.id, surface, footprint: massingFootprint(building.footprint, massing), fn: building.function, role: programme?.role ?? allocation?.role, family: roleFamily(programme?.role ?? allocation?.role, building.function),
      landmark: programme?.landmark === true || allocation?.landmark === true, parcel, building, ruins: ruinFootprint(building.footprint, programme, massing),
      stilts: volumes?.some(v => (v.detail?.stilts_m ?? 0) > 0), age: idUnit(building.id, 0x51ed), snowDepth: buildingSnowDepth(building.id),
      material: { culture, wall: first?.wall ?? '', cover: first?.cover ?? '', tone: first?.tone ?? 0.5 } });
    if (!massing) { shadows.push([]); continue; }
    const owner = items.length - 1, heat = buildingHeat(building.id, building.function);
    let terraced = false;
    // Explicit pans come out of `planRoof` unchanged (no polygon boolean). A face of a small decorative volume is one
    // polygon carrying its own snow share (no inset snow patch, no ink edge): a third of the draws of a full face.
    // Every face keeps its own share of the mantle (pitch, exposure, the building's heat), and the patch of a heated
    // roof leaves a bare strip below the ridge. Only the faces that reach the top of their volume open there: the
    // lower courses of a dome, a cone or a tent keep an even patch (no bare rings), the crown opens like a smoke hole.
    // The snow of a face is two patches with corners moved by the building's own hash: a wide thin one, and a smaller
    // full one over it, so the mantle thins toward eaves, ridge and corners along an outline no two roofs share.
    const planned = planRoof(building.footprint, massing), tops = new Map<number, number>();
    for (const face of planned) { const key = face.piece * 4096 + face.vol; let top = tops.get(key) ?? -Infinity; for (const p of face.points) if (p.z > top) top = p.z; tops.set(key, top); }
    const snowSeed = Math.round(idUnit(building.id, 0x2b7) * 0xffff), core = .16 + .2 * idUnit(building.id, 0x9d1);
    for (const face of planned.flatMap((face, fi) => {
      const light = face.light ?? roofLight3(face.normal), share = roofSnowShare(face.normal, light, heat, face.cover);
      const top = tops.get(face.piece * 4096 + face.vol)!, ridge = face.points.some(p => p.z > top - .05) ? roofSnowRidgeMelt(heat, light) : .055;
      return face.minor && share ? [{ ...face, snow: share }]
        : [{ ...face, snow: 0 }, ...(face.snow === 0 ? [] : [
          ...roofSnowPatches(face.points, face.normal, .05, ridge, snowSeed + fi * 131, .07).map(p => ({ ...face, points: p.points, snow: share, patch: 1 })),
          ...roofSnowPatches(face.points, face.normal, core, Math.max(core, ridge + .1), snowSeed + fi * 131 + 77, .2).map(p => ({ ...face, points: p.points, snow: share, patch: 2 }))])];
    })) {
      if (face.normal[2] < 0.08 || face.points.length < 3) continue; // gable ends and walls are edge-on from above
      if (face.flat) items[owner].flat = true;
      terraced ||= !!face.terrace;
      // Grain family of the pan: by cover, flatness and culture; none on living crowns (tree dwellings) and on small
      // decorative volumes (chimneys, dormers: a few pixels).
      const grain = face.minor || byPiece![face.piece]?.[face.vol]?.tree ? undefined : roofGrainFamily(face.cover, !!face.flat || face.normal[2] > .995, culture);
      roofGrainOf.push(grain ? COVER_GRAINS.indexOf(grain) + 1 : 0);
      roofFlat.push(face.terrace ? 2 : face.flat ? 1 : 0); roofSnow.push(face.snow ?? 0); roofPatch.push('patch' in face ? face.patch : 0);
      roofShapes.push({ outer: face.points.map(p => ({ x: p.x, y: p.y })), holes: face.holes ?? [] }); roofOwner.push(owner); roofLight.push(face.light ?? roofLight3(face.normal)); roofCover.push(face.cover); roofWall.push(face.wall); roofTone.push(face.tone); roofDir.push(Math.hypot(face.normal[0], face.normal[1]) > 1e-3 ? Math.atan2(face.normal[1], face.normal[0]) : 0);
    }
    const casts = building.footprint.flatMap((shape, i) => massing[i] ? pieceShadows(shape, massing[i]) : []);
    // Terrace receivers already have their own opaque shade. The ground pass must
    // contain only the exterior SE cast, with no overlapping hulls or courtyard wash.
    shadows.push(terraced && casts.length ? differenceS(unionS(casts[0], ...casts.slice(1)),
      [...building.footprint, ...surface].map(s => ({ outer: s.outer, holes: [] }))) : casts);
  }
  const altitudes = new Map<number, { sum: number; count: number }>();
  for (const b of items) {
    const town = b.parcel === undefined ? -1 : plan?.parcels[b.parcel]?.layout ?? -1;
    const a = altitudes.get(town) ?? { sum: 0, count: 0 }; a.sum += b.building.ground_z_m || 0; a.count++; altitudes.set(town, a);
  }
  for (const b of items) {
    const town = b.parcel === undefined ? -1 : plan?.parcels[b.parcel]?.layout ?? -1, a = altitudes.get(town)!;
    b.snowAltitude = a.sum / a.count;
  }
  const roofs = roofShapes.length ? { shapes: roofShapes, owner: Uint32Array.from(roofOwner), light: Float32Array.from(roofLight), cover: roofCover, wall: roofWall, tone: Float32Array.from(roofTone), dir: Float32Array.from(roofDir), flat: Uint8Array.from(roofFlat), snow: Float32Array.from(roofSnow), patch: Uint8Array.from(roofPatch), grain: Uint8Array.from(roofGrainOf), shadows } : undefined;
  return { items, byId, bins: new SpatialBins(items.map(b => surfaceBox([...b.surface, ...b.footprint ?? []])), 64), ...(roofs ? { roofs } : {}) };
}

export interface CityPick { building?: CityBuilding; parcel?: CityParcel; block?: CityBlock }
/** Topmost item under a world point: building, then parcel, then block. */
export function pickCity(scene: CityScene, buildings: CityBuildings | undefined, p: Point): CityPick {
  const point: Box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, result: CityPick = {};
  if (buildings) for (const i of buildings.bins.query(point).reverse()) if (buildings.items[i].surface.some(s => shapeContains(s, p))) { result.building = buildings.items[i]; break; }
  for (const i of scene.bins.parcels.query(point).reverse()) if (shapeContains(scene.parcels[i].shape, p)) { result.parcel = scene.parcels[i]; break; }
  for (const i of scene.bins.blocks.query(point).reverse()) if (shapeContains(scene.blocks[i].shape, p)) { result.block = scene.blocks[i]; break; }
  return result;
}

// ---------------------------------------------------------------- drawing
export interface CityBuildingRenderer { draw(ctx: CanvasRenderingContext2D, options: { viewport: Box; metresPerPixel: number; appearance: UrbanBuildingAppearance; selectedId?: string }): { rasterTilesPending: number } }
export interface CityDrawOptions {
  colors?: import('./customColors').RenderColors;
  readableGardens?: boolean;
  /** Names, landmark glyphs and centre pins; omitted keeps the normal map. */
  labels?: boolean; text?: Readonly<TextSettings>; textPalette?: Palette;
  viewport: Box; mpp: number; dpr: number; lod: CityLod; view: CityView; palette: CityPalette; width: number; layers: CityLayers;
  buildings?: CityBuildings; buildingsVisible: boolean; renderer?: CityBuildingRenderer; appearance: UrbanBuildingAppearance;
  selectedBuilding?: string; selectedParcel?: number; refusedParcels?: ReadonlySet<string>;
  /** Textured materials (PBR patterns in world metres) on roofs, streets, plazas and walls; `onTexturesReady` asks for a redraw once the atlases are loaded. */
  textured?: boolean; onTexturesReady?: () => void;
  /** Blended ground and streets (groundBlend.ts): translucent washes, no outlines or casings. Default: the shared setting. */
  groundBlend?: boolean;
  /** Unlit physical albedo tile; lighting and night tint belong to the terrain shader. */
  materialGround?: boolean;
  roadLook?: import('./composition').RoadLook;
  /** Contrast of the roads against their ground, 0.5–1.5 (roadStyle.ts). */
  roadEmphasis?: number;
  /** The same display water colour as the terrain rivers. */
  waterColor?: string;
  /** Ink streets of another palette than the blocks: the 3D plan keeps its ground plain but draws the streets of the 2D map. */
  streetPalette?: CityPalette;
  /** Night ambience: blocks, parcels and yards take dark slate tones whatever the palette (diagnostic views keep their colours). */
  night?: boolean;
  /** A host with a separate native building pass paints town lights after those roofs. */
  deferNightTown?: boolean;
  /** Painted above the streets, walls and waterways and below the buildings, in the same world-coordinate context (semantic district usage). */
  beforeBuildings?: (ctx: CanvasRenderingContext2D) => void;
}
export interface CityFrameStats { lod: CityLod; blocks: number; parcels: number; streets: number; buildings: number; ms: number; pending: boolean }

const ZONE_COLORS: Record<string, string> = { core: '#dfb973', middle: '#bfa4ca', edge: '#91bdc5', faubourg: '#a0bc84', village: '#dfb973' };
const ATLAS = ['#dfb973', '#90bdc7', '#c5a3ce', '#a0bc84', '#d29c8e', '#bdc4d5'];
const PAPER = '#f2ead8';
/** Parchment plan, matched to the parchment map background (render/styles.ts PARCHMENT
 * and its urban colours): ink outlines, ochre hatched blocks, light lots, pale streets
 * between dark ink casings, dark ink masses. */
const PARCH = {
  ink: '#4e3b28', inkSoft: '#5a4530', block: '#e2cf9f', hatch: '#6b5236', lot: '#ece0bf', yard: '#e6d6a8',
  garden: '#d3cf98', place: '#d5cdb7', market: '#d9c9a1', common: '#cdd097', reserve: '#d8c79a', footprint: '#d9c393',
  street: '#ebdeba', streetEdge: '#5e4a34', bridge: '#ece0bc', ford: '#bccbc8', quay: '#dccfa8',
  mass: '#4a3826', landmark: '#7d5f40', wall: '#3b2c1c', wallFill: '#6b5540', tower: '#4e3b28',
};
/** Night plan grounds, matched to render/styles.ts PALETTES.night urban colours and buildingColors (dark slate blocks under dark masses). */
const NIGHT_PLAN = {
  ink: '#04060e', inkSoft: '#04060e', block: '#182038', lot: '#1d2640', yard: '#141a2c',
  garden: '#14281f', place: '#2e2b30', market: '#3d372b', common: '#162a30', reserve: '#1a2236', footprint: '#18203a',
};
/** Ink hatching in screen pixels (one tile per context, rescaled to the frame). */
const hatches = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
function hatchPattern(ctx: CanvasRenderingContext2D, mpp: number): CanvasPattern | undefined {
  let pattern = hatches.get(ctx);
  if (!pattern) {
    const tile = document.createElement('canvas'); tile.width = tile.height = 7;
    const t = tile.getContext('2d'); if (!t) return undefined;
    t.strokeStyle = PARCH.hatch; t.globalAlpha = 0.42; t.lineWidth = 0.8;
    t.beginPath(); t.moveTo(-1, 8); t.lineTo(8, -1); t.moveTo(-1, 1); t.lineTo(1, -1); t.moveTo(6, 8); t.lineTo(8, 6); t.stroke();
    pattern = ctx.createPattern(tile, 'repeat') ?? undefined; if (!pattern) return undefined;
    hatches.set(ctx, pattern);
  }
  pattern.setTransform(new DOMMatrix().scale(mpp));
  return pattern;
}
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), c = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}
const districtColor = (d: CityDistrict | undefined, fallback: string): string => {
  const base = DISTRICT_ROLES[districtRoleKey(d?.role) ?? '']?.color ?? fallback;
  return d?.wealth === undefined ? base : mix(base, PAPER, Math.max(0, 0.45 - d.wealth * 0.45));
};
/** Outer rings counter-clockwise, holes clockwise: batches fill with the nonzero
 * rule, so overlapping items of one style unite while courts stay open. */
function shapePath(shape: Shape): Path2D {
  const path = new Path2D();
  const ring = (points: readonly Point[], hole: boolean): void => {
    if (points.length < 3) return;
    const reverse = (ringArea(points) < 0) !== hole, n = points.length, at = (i: number): Point => points[reverse ? n - 1 - i : i];
    path.moveTo(at(0).x, at(0).y); for (let i = 1; i < n; i++) path.lineTo(at(i).x, at(i).y); path.closePath();
  };
  ring(shape.outer, false); for (const hole of shape.holes ?? []) ring(hole, true);
  return path;
}
function linePath(points: readonly Point[]): Path2D {
  const path = new Path2D(); if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  return path;
}
interface Style { fill?: string | CanvasPattern; stroke?: string | CanvasPattern; width?: number; alpha?: number; dash?: number[]; cap?: CanvasLineCap }
const patternIds = new WeakMap<CanvasPattern, number>(); let patternSeq = 0;
const patternKey = (v: string | CanvasPattern | undefined): string | undefined => {
  if (!v || typeof v === 'string') return v;
  let id = patternIds.get(v); if (!id) patternIds.set(v, id = ++patternSeq);
  return `pattern${id}`;
};
/** Style batches: one fill or stroke call per style, in first-use order. */
class Batches {
  private groups = new Map<string, { style: Style; path: Path2D }>();
  add(style: Style, path: Path2D): void {
    const key = `${patternKey(style.fill)}|${patternKey(style.stroke)}|${style.width}|${style.alpha}|${style.dash}|${style.cap}`;
    let group = this.groups.get(key); if (!group) { group = { style, path: new Path2D() }; this.groups.set(key, group); }
    group.path.addPath(path);
  }
  flush(ctx: CanvasRenderingContext2D): void {
    for (const { style, path } of this.groups.values()) {
      ctx.globalAlpha = style.alpha ?? 1;
      if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(path, 'nonzero'); }
      if (style.stroke && style.width) { ctx.strokeStyle = style.stroke; ctx.lineWidth = style.width; ctx.setLineDash(style.dash ?? []); ctx.lineCap = style.cap ?? 'round'; ctx.stroke(path); }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]); this.groups.clear();
  }
}
const CROSSINGS = new Set(['bridge', 'causeway', 'ford', 'pier', 'boardwalk', 'walkway']);
/** Trodden snow mixed with earth: busy streets and squares in winter. */
const SLUSH = 'rgb(124,117,106)';
/** Street surface rings per scene, by streets, widths and edges drawn (a few camera steps). */
const SURFACE_CACHE = new WeakMap<object, Map<string, { casing: { street: number; path: Path2D }[]; fill: { street: number; path: Path2D }[]; inner: { street: number; path: Path2D }[] }>>();
/** Stroked even near and close: square-ended structures and stepped ways. */
const SURFACE_SKIP = new Set(['quay', 'mole', 'stairs', 'port-stairs', 'landing']);
function streetPaint(role: string, rank: number, palette: CityPalette): { fill: string; casing: string; dash?: boolean } {
  if (role === 'track') { const ink = palette === 'ink' ? '#776348' : '#a58e65'; return { fill: ink, casing: ink }; }
  if (role === 'mole') return { fill: quayFill('stone'), casing: '#2b2015' };   // stone port works: dark outline, legible zoomed out
  if (palette === 'ink') return { fill: '#6b5640', casing: '#3c3024' };
  if (isBoardwalk(role)) return { fill: '#b49a6d', casing: '#514431' };
  if (palette === 'parchment') return role === 'ford' ? { fill: PARCH.ford, casing: PARCH.ink, dash: true }
    : role === 'bridge' ? { fill: PARCH.bridge, casing: PARCH.wall } : role === 'quay' ? { fill: PARCH.quay, casing: PARCH.ink }
    : { fill: PARCH.street, casing: PARCH.streetEdge };
  switch (role) {
    case 'bridge': return { fill: '#ddd3c2', casing: '#4d4740' };
    case 'causeway': return { fill: '#dccaa0', casing: '#76664f' };
    case 'ford': return { fill: '#b9d0d6', casing: '#6f8f9a', dash: true };
    case 'quay': return { fill: '#bdb4a0', casing: '#57534b' };
    case 'port-stairs': case 'stairs': return { fill: '#e6d5b2', casing: '#705d45' };
    case 'market': return { fill: '#f5d98f', casing: '#9a7d4f' };
    case 'collective': return { fill: '#ccdacf', casing: '#8a9a8d' };
    case 'private': return { fill: '#d9cddf', casing: '#9a8ca1' };
    default: return { fill: rank <= 1 ? '#f6e3b8' : '#f3dfb3', casing: rank <= 1 ? '#7d6648' : '#9c8664' };
  }
}

const roofIndex = new WeakMap<CityRoofs, { byOwner: number[][]; paths: (Path2D | undefined)[] }>();
const roofShadowPaths = new WeakMap<CityRoofs, (Path2D | undefined)[]>();
const roofGrain = new WeakMap<ImageBitmap, Map<number, CanvasPattern>>();
/** Mean-centred grain, shared per material; soft light keeps the final palette colour. */
function roofGrainPattern(ctx: CanvasRenderingContext2D, images: MaterialImages, layer: number, angle: number): CanvasPattern | undefined {
  let cache = roofGrain.get(images.albedo); if (!cache) roofGrain.set(images.albedo, cache = new Map());
  let pattern = cache.get(layer);
  if (!pattern) {
    const t = MATERIALS.tile, tile = Object.assign(document.createElement('canvas'), { width: t, height: t }), c = tile.getContext('2d')!;
    c.drawImage(images.albedo, 0, layer * t, t, t, 0, 0, t, t);
    const pixels = c.getImageData(0, 0, t, t), data = pixels.data, mean = MATERIALS.layers[layer].mean_rgb;
    const luma = Math.max(5, mean[0] * 0.3 + mean[1] * 0.59 + mean[2] * 0.11);
    for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, ((data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / luma - 1) * 89.25 + 127.5));
    c.putImageData(pixels, 0, 0); pattern = ctx.createPattern(tile, 'repeat') ?? undefined; if (!pattern) return undefined;
    cache.set(layer, pattern);
  }
  const s = layerExtent(layer) / MATERIALS.tile;
  pattern.setTransform(new DOMMatrix().rotate(angle * 180 / Math.PI).scale(s, s)); return pattern;
}
/** Final colour of every roof pan, kept until the ground tones, the palette, the season or the custom ink change:
 * a frame only reads them. */
const roofPaint = new WeakMap<CityRoofs, { key: string; colors: (string | undefined)[]; gains: number[] }>();
/** Covers that gather moss and soot on their shaded pans (not metal, hides or earthen terraces). */
const MOSSY = /^(tile|slate|stone|thatch|reed|palm|shingle|bark|turf)$/;
/** Age is a tone of the whole roof (a new cover a touch lighter, an old one darker), and the shaded pans of an old
 * roof are a little greener than its sunny ones. */
function weatheredRoof(color: string, light: number, age: number, cover: string): string {
  const shade = Math.max(0, Math.min(1, -light * 2.4)), toned = planShade(color, (.5 - age) * .07);
  return shade > 0 && MOSSY.test(cover) ? mix(toned, '#4b4f38', shade * (.04 + .1 * age)) : toned;
}
/** Share of the grain a roof colour takes: on a very light cover (lime, snow-white plaster) only the dark marks
 * show, on a very dark one (old slate, tarred bark) only the light ones, so both ends take less. */
function grainGain(color: string): number {
  const v = parseInt(color.slice(1), 16), l = (((v >> 16) & 255) * .3 + ((v >> 8) & 255) * .59 + (v & 255) * .11) / 255;
  return 1 - .5 * Math.max(0, Math.min(1, (l - .68) / .2)) - .45 * Math.max(0, Math.min(1, (.3 - l) / .15));
}
/** Same massing faces and shared tint as the GPU path. On natural grounds (terrain palette, by day) every cover also
 * takes its procedural grain along the slope and its weathering; `images` (textured materials) replaces that grain. */
function drawPlanRoofs(ctx: CanvasRenderingContext2D, b: CityBuildings, o: CityDrawOptions, images?: MaterialImages): void {
  const roofs = b.roofs!;
  let index = roofIndex.get(roofs);
  if (!index) { const byOwner: number[][] = b.items.map(() => []); roofs.owner.forEach((ow, k) => byOwner[ow]?.push(k)); roofIndex.set(roofs, index = { byOwner, paths: [] }); }
  const custom = (o.appearance.diagnostic === 'none' && o.colors?.building) || undefined, parchment = o.palette === 'parchment';
  const key = `${toneStamp()}|${o.palette}|${roofSeasonKey()}|${custom ?? ''}|${o.night ? 1 : 0}`;
  let paint = roofPaint.get(roofs);
  if (!paint || paint.key !== key) roofPaint.set(roofs, paint = { key, colors: [], gains: [] });
  const natural = o.palette === 'terrain' && !o.night && !custom && o.appearance.diagnostic === 'none';
  const frame = natural && !images ? coverGrainFrame(o.mpp / (o.dpr || 1)) : undefined, snowLevel = roofPatternLevel(o.mpp / (o.dpr || 1));
  // Pan edges (eaves, ridges, hips): ink on the drawn plans, a soft joint on a natural ground.
  ctx.strokeStyle = parchment ? 'rgba(44,33,23,0.65)' : natural ? 'rgba(31,24,17,0.45)' : 'rgba(31,24,17,0.65)'; ctx.lineWidth = (parchment ? 0.3 : 0.5) * o.mpp;
  for (const i of b.bins.query(o.viewport)) {
    const pans = index.byOwner[i]; if (!pans?.length) continue;
    const item = b.items[i], age = item.age ?? .5, ground = mapGroundSnow(item.snowAltitude ?? item.building.ground_z_m), depth = item.snowDepth ?? 1;
    for (const k of pans) {
      // Without snow on the ground a snow patch repeats the pan under it.
      const patch = roofs.patch?.[k] ?? 0;
      if (patch && !ground) continue;
      const path = index.paths[k] ??= shapePath(roofs.shapes[k]);
      if (patch && natural) {
        // Snow as its own uneven cover over the roof: a whole mantle with thin places where the face keeps most of
        // its share, broken patches showing the cover where it lost more; the building's depth thins it evenly.
        const amount = Math.min(1, roofs.snow![k] * ground), t = amount * amount * (3 - 2 * amount), patchy = amount < .7, shade = roofs.light[k] < -.08;
        const snow = coverGrainPattern(ctx, patchy ? shade ? 'snowPatchyShade' : 'snowPatchy' : shade ? 'snowShade' : 'snow', snowLevel, roofs.dir[k] ?? 0, age * 53.1, age * 71.9);
        if (snow) { ctx.globalAlpha = Math.min(1, (patchy ? 1.6 * t : t) * depth * (patch === 1 ? .9 : 1)); ctx.fillStyle = snow; ctx.fill(path); ctx.globalAlpha = 1; continue; }
      }
      if (patch === 2) continue;
      let color = paint.colors[k];
      if (color === undefined) {
        const base = planRoofColor(item, roofs, k, o.palette, custom);
        const aged = natural && !roofs.snow?.[k] ? weatheredRoof(base, roofs.light[k], age, roofs.cover[k]) : base;
        // Grade after snow/material colour: a custom night ink must not leave daylight snow above it.
        color = paint.colors[k] = o.night ? nightRoof(aged, parchment) : aged;
        paint.gains[k] = natural ? grainGain(aged) : 0;
      }
      ctx.fillStyle = color; ctx.fill(path);
      if (!(roofs.snow?.[k] && ground)) {
        const layer = images ? coverLayer(roofs.cover[k]) : -1, family = frame && ground < .6 ? roofs.grain?.[k] ?? 0 : 0;
        if (images && layer >= 0) {
          const grain = roofGrainPattern(ctx, images, layer, (roofs.dir[k] ?? 0) - Math.PI / 2);
          if (grain) { ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = grain; ctx.fill(path); ctx.restore(); }
        } else if (family) {
          // Only while the family's own units are resolved; the shift gives every building its own piece of the tile.
          const strength = frame!.alpha[family - 1] * paint.gains[k];
          const grain = strength > .03 ? coverGrainPattern(ctx, COVER_GRAINS[family - 1], frame!.level, roofs.dir[k] ?? 0, age * 37.7, age * 91.3) : undefined;
          if (grain) { ctx.globalAlpha = strength; ctx.fillStyle = grain; ctx.fill(path); ctx.globalAlpha = 1; }
        }
      }
      // A pan under a good share of snow keeps no ink edge: ridges and hips are not outlined on a white roof.
      if (!roofs.snow?.[k] && !(ground && roofs.patch?.[k + 1] && roofs.snow![k + 1] * ground * depth > .45)) ctx.stroke(path);
    }
  }
}

/** Paint the visible plan into a context already set to world coordinates. */
export function drawCity(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityDrawOptions): CityFrameStats {
  if (o.buildings) updateYardEnclosures(scene, o.buildings.items, () => o.buildings!.items.map(b => b.building));
  const start = performance.now(), { viewport, mpp, lod, view, palette, layers } = o, px = (n: number): number => n * mpp;
  // Textured materials: repeating patterns anchored to world metres (ink and parchment keep their own look).
  const tex = o.textured && !o.night && palette !== 'parchment' && palette !== 'ink' ? materialImagesNow(o.onTexturesReady) : undefined;
  const pat = (layer: number): CanvasPattern | undefined => tex ? layerPattern(ctx, tex, layer) ?? undefined : undefined;
  const plaza = (use: string, color: string | undefined): string | CanvasPattern | undefined => color && tex && (use === 'place' || use === 'market') ? pat(placeLayer()) ?? color : color;
  const stats: CityFrameStats = { lod, blocks: 0, parcels: 0, streets: 0, buildings: 0, ms: 0, pending: false };
  const parchment = palette === 'parchment', night = !!o.night, pl = parchment || night, C = night ? NIGHT_PLAN : PARCH;
  const batch = new Batches(), outline = night ? NIGHT_PLAN.ink : palette === 'ink' ? '#3c3024' : parchment ? PARCH.inkSoft : '#655847', lineW = px(Math.max(0.2, o.width));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const pathOf = <T extends { path?: Path2D; shape: Shape; ground?: Shape[]; groundPath?: Path2D }>(item: T): Path2D => {
    if (!item.ground) return item.path ??= shapePath(item.shape);
    if (!item.groundPath) { item.groundPath = new Path2D(); for (const s of item.ground) item.groundPath.addPath(shapePath(s)); }
    return item.groundPath;
  };
  const growthColor = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;

  // Far: the urban footprint as one tint, main roads and walls.
  const material=!!o.materialGround,naturalGround=material||palette==='terrain'||o.roadLook==='natural';
  const blend = material||(o.groundBlend ?? isBlended()) && (naturalGround?view!=='uses'&&view!=='roles':blendsGround(view,palette)), tone = material?'earth':blendTone(palette), softLine = blendLine(tone);
  const wash=(kind: WashKind,shape: Shape) => {
    if(material){const w=groundWash(kind,'earth');return {color:w.color,alpha:Math.min(.8,w.alpha*1.8)};}
    const raw=washAt(kind,tone,shape), w=naturalGround?naturalGroundWash(raw,kind):raw;
    return night ? { ...w, color: nightRoof(w.color, parchment) } : w;
  };
  // Squares and markets of a snowed town are trodden like its main streets (natural grounds only).
  const slush = naturalGround && !night ? mapGroundSnow() : 0;
  if (lod === 'far') {
    if (blend && layers.blocks) { for (const shape of scene.footprint) if (overlaps(shapeBox(shape), viewport)) { const w = wash('footprint', shape),path=shapePath(shape); batch.add({ stroke:w.color,width:px(2.2),alpha:w.alpha*.35 },path);batch.add({ fill: w.color, alpha: w.alpha }, path); } }
    else if (layers.blocks) for (const shape of scene.footprint) if (overlaps(shapeBox(shape), viewport)) batch.add({ fill: palette === 'terrain' ? undefined : pl ? C.footprint : '#cfb589', stroke: pl ? C.ink : '#7b6446', width: px(1), alpha: 0.9 }, shapePath(shape));
    if (parchment && !night && layers.blocks && !blend) { const hatch = hatchPattern(ctx, mpp); if (hatch) for (const shape of scene.footprint) if (overlaps(shapeBox(shape), viewport)) batch.add({ fill: hatch }, shapePath(shape)); }
    batch.flush(ctx);
  } else {
    // Blocks: palette, district role, or the ground under buildings.
    if (layers.blocks || layers.domains) for (const i of scene.bins.blocks.query(viewport)) {
      const b = scene.blocks[i], reserve = b.kind.startsWith('reserve');
      if (reserve ? !layers.domains : !layers.blocks) continue;
      stats.blocks++;
      let fill: string | undefined;
      if (palette === 'terrain' && view !== 'roles' && !blend) fill = undefined;
      else if (reserve) fill = pl ? C.reserve : '#cbc2a8';
      else if (b.kind === 'common') fill = pl ? C.common : '#adc5bf';
      else if (b.kind === 'place') fill = pl ? C.place : '#e8d6ae';
      else if (view === 'roles') fill = districtColor(b.district, growthColor(b.zone));
      else if (view === 'buildings') fill = pl ? C.yard : lod === 'mid' ? mix(districtColor(b.district, growthColor(b.zone)), PAPER, 0.35) : '#ece2cb';
      else if (night) fill = C.block;
      else if (palette === 'ink') fill = '#e3d1b5';
      else if (parchment) fill = PARCH.block;
      else fill = palette === 'atlas' ? ATLAS[b.quarter % ATLAS.length] : growthColor(b.zone);
      const stroke = view === 'buildings' && lod !== 'close' ? undefined : outline;
      if (blend && fill) {
        // Blended: one translucent wash (a wider low-alpha stroke of the same colour feathers the edge), faint lot lines only up close.
        const w = wash(reserve ? 'reserve' : b.kind === 'common' ? 'common' : b.kind === 'place' ? 'place' : 'block', b.shape), a = w.alpha * (b.peripheral && view !== 'buildings' ? 0.7 : 1);
        if (!tex || !(b.kind === 'place' || b.kind === 'market')) batch.add({ stroke: w.color, width: px(2.2), alpha: a * 0.4, cap: 'round' }, pathOf(b));
        batch.add({ fill: plaza(b.kind, w.color), alpha: a }, pathOf(b));
        if (slush && b.kind === 'place') batch.add({ fill: SLUSH, alpha: .3 * slush }, pathOf(b));
        if (lod === 'close'&&!material) batch.add({ stroke: softLine.color, width: px(0.5), alpha: softLine.alpha }, pathOf(b));
        continue;
      }
      batch.add({ fill: plaza(b.kind, fill), stroke: stroke ?? (parchment && b.kind === 'place' ? PARCH.inkSoft : undefined), width: lineW, alpha: b.peripheral && view !== 'buildings' ? 0.6 : 1, dash: reserve ? [px(3), px(2)] : undefined }, pathOf(b));
      // Parchment: built blocks hatched in ink, as on the engraved plans.
      if (parchment && !night && !blend && !reserve && b.kind !== 'common' && b.kind !== 'place' && view !== 'roles') { const hatch = hatchPattern(ctx, mpp); if (hatch) batch.add({ fill: hatch, alpha: view === 'buildings' ? 0.5 : 1 }, pathOf(b)); }
    }
    batch.flush(ctx);
    // Parcels: cadastral detail from near; uses and roles from mid.
    const parcelLevel = view === 'uses' || view === 'roles' ? 'mid' : 'near';
    if (layers.parcelOverlay !== false && atLeast(lod, parcelLevel) && view !== 'tissue') for (const i of scene.bins.parcels.query(viewport)) {
      const p = scene.parcels[i], use = p.use;
      const built = ['plot', 'compound', 'residual', 'court'].includes(use), open = ['place', 'market', 'common'].includes(use);
      if (!(built && layers.parcels || use === 'garden' && layers.gardens || open && layers.places || use === 'reserve' && layers.domains)) continue;
      stats.parcels++;
      const burialFill = funeraryLandFill(p.allocation?.role);
      const openFill = burialFill ?? (pl ? (use === 'garden' ? C.garden : use === 'reserve' ? C.reserve : use === 'common' ? C.common : use === 'market' ? C.market : use === 'place' ? C.place : undefined)
        : use === 'garden' ? '#a8bc89' : use === 'reserve' ? '#cbc2a8' : use === 'common' ? '#adc5bf' : use === 'market' ? '#ead39a' : use === 'place' ? '#e6d1a5' : undefined);
      if (blend && (view === 'parcels' || view === 'buildings')) {
        const kind: WashKind = use === 'garden' ? 'garden' : use === 'reserve' ? 'reserve' : use === 'common' ? 'common' : use === 'market' ? 'market' : use === 'place' ? 'place' : 'parcel';
        const w = wash(kind, p.shape), a = w.alpha * (p.peripheral ? 0.7 : 1), ground = kind === 'parcel' || kind === 'reserve';
        // Plain lots add no wash over the block's (the buildings stand on it); gardens, commons and squares stack theirs.
        if (!(view === 'buildings' && ground)) batch.add({ fill: burialFill ?? plaza(use, w.color), alpha: burialFill ? 0.85 : a }, pathOf(p));
        if (slush && (use === 'place' || use === 'market')) batch.add({ fill: SLUSH, alpha: .3 * slush }, pathOf(p));
        if (lod === 'close'&&!material) batch.add({ stroke: softLine.color, width: px(0.5), alpha: softLine.alpha * (ground ? 0.8 : 1) }, pathOf(p));
      } else if (view === 'parcels') {
        const fill = palette === 'terrain' ? undefined : night ? openFill ?? C.lot : palette === 'ink' ? '#eee0c9' : parchment ? openFill ?? PARCH.lot : openFill ?? (palette === 'atlas' ? ATLAS[p.index % ATLAS.length] : growthColor(p.zone));
        batch.add({ fill: plaza(use, fill), stroke: atLeast(lod, 'near') ? outline : undefined, width: lineW, alpha: p.peripheral ? 0.65 : 1 }, pathOf(p));
      } else if (view === 'uses') {
        if (p.allocation) { const c = urbanFunctionColor(p.allocation.function); batch.add({ fill: c, alpha: 0.62 }, pathOf(p)); batch.add({ stroke: c, width: px(0.55) }, pathOf(p)); }
        else if (openFill) batch.add({ fill: openFill }, pathOf(p));
      } else if (view === 'roles') {
        const family = p.allocation ? roleFamily(p.allocation.role, p.allocation.function) : open ? 'commerce' : use === 'garden' ? 'garden' : undefined;
        if (family && family !== 'dwelling') batch.add({ fill: BUILDING_FAMILIES[family].color, alpha: p.allocation?.landmark ? 0.75 : 0.45 }, pathOf(p));
        if (p.allocation?.landmark) batch.add({ stroke: BUILDING_FAMILIES[family ?? 'civic'].color, width: px(1.6) }, pathOf(p));
      } else {
        // Buildings view: paved places and gardens, faint lot lines when close.
        if (openFill) batch.add({ fill: plaza(use, openFill), stroke: lod === 'close' ? parchment ? PARCH.inkSoft : '#b9a98d' : parchment && (use === 'place' || use === 'market') ? PARCH.inkSoft : undefined, width: px(0.6), alpha: parchment && lod === 'close' ? 0.9 : 1 }, pathOf(p));
        else if (lod === 'close') batch.add({ stroke: parchment ? PARCH.inkSoft : '#c4b597', width: px(0.6), alpha: parchment ? 0.45 : 1 }, pathOf(p));
      }
    }
    batch.flush(ctx);
  }

  if (layers.parcelOverlay !== false && o.readableGardens && (lod === 'near' || lod === 'close') && view !== 'tissue') {
    for (const i of scene.bins.parcels.query(viewport)) {
      const garden = scene.parcels[i];
      if (garden.use !== 'garden') continue;
      const center = shapeRingCenter(garden.shape.outer);
      const neighbours = scene.bins.parcels.query(shapeBox(garden.shape)).map(j => scene.parcels[j])
        .filter(p => p.layout === garden.layout && p.block === garden.block && ['plot', 'compound', 'court'].includes(p.use));
      const nearest = neighbours.sort((a, b) => {
        const x = shapeRingCenter((a.source.envelope ?? a.shape).outer), y = shapeRingCenter((b.source.envelope ?? b.shape).outer);
        return Math.hypot(x.x - center.x, x.y - center.y) - Math.hypot(y.x - center.x, y.y - center.y);
      })[0];
      if (nearest) drawGardenDetails(ctx, garden.shape, shapeRingCenter((nearest.source.envelope ?? nearest.shape).outer), mpp);
    }
  }
  if (layers.streets) for (const q of scene.quays ?? []) {
    if (!overlaps(shapeBox(q.shape), viewport)) continue;
    const path = shapePath(q.shape);
    ctx.fillStyle = quayFill(q.material, parchment); ctx.fill(path);
    ctx.strokeStyle = q.kind === 'mole' ? '#2b2015' : parchment ? PARCH.ink : '#57534b'; ctx.lineWidth = px(q.kind === 'mole' ? 1.6 : 0.9); ctx.stroke(path);
  }

  if (layers.enclosures) drawCityWallGround(ctx, scene, { viewport, mpp, lod, palette, night }); // walls hook: ditches and glacis under the streets
  // Streets: centrelines stroked by rank, casing first, majors and crossings on top.
  if (layers.streets) {
    const maxRank = lod === 'far' ? 1 : lod === 'mid' ? 2 : 9;
    // Stable order by descending rank (crossings last): bucket by rank, O(n) instead of a per-frame sort.
    const order = (s: CityStreet): number => CROSSINGS.has(s.role) ? -1 : s.rank;
    const buckets = new Map<number, CityStreet[]>();
    for (const i of scene.bins.streets.query(viewport)) {
      const s = scene.streets[i]; if (!(s.rank <= maxRank || CROSSINGS.has(s.role))) continue;
      const k = order(s), list = buckets.get(k); if (list) list.push(s); else buckets.set(k, [s]);
    }
    const visible = [...buckets.keys()].sort((a, b) => b - a).flatMap(k => buckets.get(k)!);
    const casing = new Batches(), under = new Batches(), surface = new Batches(), over = new Batches(), marks = new Batches(), marks2 = new Batches(), softStreets = o.roadLook!=='ink'&&(o.groundBlend ?? isBlended()) && !tex;
    // Near and close: streets are their ground surface (roadSurface.ts) — square ends at
    // junctions, curb returns, tapers — filled once per style, so nothing shows twice.
    // Decks, quays, fords, dashed tracks and stairs keep their stroked art.
    // `inset` and `inner`: the carriageway of a paved street, inside its sidewalks.
    const surfaced: { s: CityStreet; w: number; edge: number; casing?: Style; fill: Style; inset?: number; inner?: Style }[] = [];
    const surfaceOk = (s: CityStreet, dash?: boolean): boolean => layers.roadSurface !== false && atLeast(lod, 'near') && !dash && !CROSSINGS.has(s.role) && !SURFACE_SKIP.has(s.role);
    const emphasis = o.roadEmphasis ?? 1, inkEmphasis = emphasisAlpha(emphasis);
    // The user's own colours; the night defaults of `colors` belong to the ink look.
    const roadStyle: RoadStyle = { look: 'natural', emphasis, night: o.appearance.ambience === 'night', colors: o.appearance.colors }, natural = o.roadLook === 'natural';
    const pavedStyle: RoadStyle = { ...roadStyle, pavement: 'asphalt' }, carriageways = new Batches();
    for (const s of visible) {
      stats.streets++;
      // Stroked ways under the surfaced streets, crossings over them.
      const fill = CROSSINGS.has(s.role) ? over : under;
      const paint = streetPaint(s.role, s.rank, o.streetPalette ?? palette);
      if (night) { paint.fill = parchment ? '#647b95' : '#242e3b'; paint.casing = '#172538'; }
      paint.fill = (s.role === 'track' ? o.colors?.track : o.colors?.road) ?? paint.fill; paint.casing = o.colors?.roadEdge ?? paint.casing;
      const path = s.path ??= linePath(s.street.path);
      let w = Math.max(s.width, px(isBoardwalk(s.role) ? 0.8 : s.role === 'mole' ? 3.4 : STREET_MIN_PX[Math.min(4, Math.max(0, s.rank))])), w2 = Math.round(w * 4) / 4;
      if (natural && !STRUCTURE_ROLES.has(s.role)) {
        // Natural grounds: a street narrower than the pixel is not inflated to a plan stroke. It thins to about one
        // pixel and fades with its true share of that pixel, so a town seen from afar is its ground and its roofs,
        // not a street diagram laid over the land.
        const floor = px(1.1), thin = Math.max(.35, Math.min(1, s.width / floor));
        if (s.width < w) { w = Math.max(s.width, floor); w2 = Math.round(w * 4) / 4; }
        const rank = streetRank(s.role, s.rank);
        if (pavedRank(rank, layoutStreetPavements(scene.layouts[s.layout])?.[s.index])) {
          // Paved town street (roadPavement.ts): an asphalt carriageway, pale kerb and sidewalk strips inside the street
          // space of the wider streets, a centre line on the main ones; lanes and alleys are plain. Squares keep their paving.
          const paintRoad = roadPaint(ctx, rank, pavedStyle), snow = pavedStyle.night ? 0 : mapGroundSnow();
          const walk = s.rank <= 2 && w >= 9 ? Math.min(3, Math.max(1.4, w * .16)) : 0, road = Math.round((w - 2 * walk) * 4) / 4;
          const paved = pavedMarks(rank, road, 1 / mpp, pavedStyle, s.rank <= 1 && road >= 7, false); paved.bed *= thin;
          const bedStyle: Style = { fill: paintRoad, alpha: paved.bed };
          if (snow && road / mpp >= 4) {
            // Same winter as the earth streets: slush over a busy carriageway, a beaten line on a quiet one.
            const busy = s.rank <= 1 ? 1 : s.rank === 2 ? .62 : .24;
            marks2.add({ stroke: busy > .5 ? SLUSH : 'rgb(130,151,170)', width: road * (.5 + .32 * busy), alpha: (.2 + .32 * busy) * snow, cap: 'round' }, path);
            marks2.add({ stroke: paintRoad, width: road * (.16 + .18 * busy), alpha: paved.bed * (.55 + .45 * busy), cap: 'round' }, path);
          }
          for (const k of paved.strokes) marks2.add({ stroke: k.paint ?? paintRoad, width: k.width, alpha: k.alpha, dash: k.dash as number[] | undefined, cap: k.cap }, path);
          const grain = paved.grain ? roadGrain(ctx) : undefined; if (grain) marks2.add({ stroke: grain, width: road, alpha: paved.grain, cap: 'round' }, path);
          const sidewalk = walk ? sidewalkTone(pavedStyle) : undefined;
          if (surfaceOk(s)) { surfaced.push({ s, w, edge: 0, fill: sidewalk ? { fill: sidewalk, alpha: paved.bed } : bedStyle, inset: walk, inner: sidewalk ? bedStyle : undefined }); continue; }
          if (sidewalk) casing.add({ stroke: sidewalk, width: w2, alpha: paved.bed, cap: 'round' }, path);
          fill.add({ stroke: paintRoad, width: sidewalk ? road : w2, alpha: paved.bed, cap: 'round' }, path);
          continue;
        }
        // Same paint as the regional roads: a tone of the local ground, a soft shoulder instead of a casing, wear up close.
        const marks = naturalMarks(rank, w, 1 / mpp, roadStyle), bed = { alpha: marks.bed.alpha * thin }, edge = Math.max(px(lod === 'mid' ? 0.9 : 1.4), w * .09), shoulder = marks.shadow && { ...marks.shadow, alpha: marks.shadow.alpha * .8 };
        const paintRoad = roadPaint(ctx, rank, roadStyle);
        const snow = !roadStyle.night && mapGroundSnow();
        if (snow && rank !== 'path' && w2 / mpp >= 4) {
          // Main streets are trodden to a grey-brown slush over most of their width; back lanes and tracks keep
          // their snow, with a cool shade and one narrow beaten line.
          const busy = s.role === 'track' ? .3 : s.rank <= 1 ? 1 : s.rank === 2 ? .62 : .24;
          marks2.add({ stroke: busy > .5 ? SLUSH : 'rgb(130,151,170)', width: w2 * (.5 + .32 * busy), alpha: (.2 + .32 * busy) * Number(snow), cap: 'round' }, path);
          marks2.add({ stroke: paintRoad, width: w2 * (.16 + .18 * busy), alpha: bed.alpha * (.55 + .45 * busy), cap: 'round' }, path);
        }
        if (marks.wear) marks2.add({ stroke: marks.wear.color, width: w2 * marks.wear.share, alpha: marks.wear.alpha, dash: marks.wear.dash as number[], cap: 'round' }, path);
        const grain = marks.grain ? roadGrain(ctx) : undefined; if (grain) marks2.add({ stroke: grain, width: w2, alpha: marks.grain, cap: 'round' }, path);
        if (surfaceOk(s)) { surfaced.push({ s, w, edge, casing: shoulder && lod !== 'far' ? { fill: shoulder.color, alpha: shoulder.alpha } : undefined, fill: { fill: paintRoad, alpha: bed.alpha } }); continue; }
        if (shoulder && lod !== 'far') casing.add({ stroke: shoulder.color, width: w2 + 2 * edge, alpha: shoulder.alpha, cap: 'round' }, path);
        fill.add({ stroke: paintRoad, width: w2, alpha: bed.alpha, cap: 'round' }, path);
        continue;
      }
      const toned = o.roadLook === 'ink' || night ? undefined : streetToneAt(s.street.path, s.role, s.rank);   // map-tinted street (groundTone.ts)
      if (toned || !night && softStreets && !STRUCTURE_ROLES.has(s.role)) {
        // Blended: earth wash at rank-decaying opacity and a faint soft edge instead of the dark casing.
        const soft = toned ?? softStreet(s.role, s.rank, tone); soft.fill = (s.role === 'track' ? o.colors?.track : o.colors?.road) ?? soft.fill; soft.edge = o.colors?.roadEdge ?? soft.edge;
        const edge = px(lod === 'mid' ? 0.8 : 1.1);
        if (toned && s.role !== 'track') casing.add({ stroke: toned.ground, width: w + 7 * edge, alpha: 0.45, cap: 'round' }, path);
        if (surfaceOk(s)) { surfaced.push({ s, w, edge, casing: lod !== 'far' ? { fill: soft.edge, alpha: soft.edgeAlpha } : undefined, fill: { fill: soft.fill, alpha: soft.alpha } }); continue; }
        // The land use leaves a corridor along every street (the darker decor shows there): an apron of the ground tone hides it.
        if (toned && s.role !== 'track') casing.add({ stroke: toned.ground, width: w2 + 7 * edge, alpha: 0.45, cap: 'round' }, path);
        if (lod !== 'far') casing.add({ stroke: soft.edge, width: w2 + 2 * edge, alpha: soft.edgeAlpha, cap: 'round' }, path);
        fill.add({ stroke: soft.fill, width: w2, alpha: soft.alpha, cap: 'round' }, path);
        continue;
      }
      const edge = s.role === 'bridge' || s.role === 'quay' || s.role === 'mole' ? Math.max(1.2, px(1.4)) : lod === 'far' ? 0 : px(lod === 'mid' ? 0.7 : 0.9);
      const cap = s.role === 'bridge' || s.role === 'quay' || s.role === 'mole' ? 'butt' : 'round';
      const body = (!(s.role === 'track' ? o.colors?.track : o.colors?.road) && o.roadLook !== 'ink' && tex && pat(streetLayer(s.role, s.rank))) || paint.fill;
      const inkEdge = edge * Math.max(1, emphasis), inkAlpha = Math.min(1, inkEmphasis);
      if (surfaceOk(s, paint.dash)) { surfaced.push({ s, w, edge: inkEdge, casing: edge > 0 ? { fill: paint.casing, alpha: inkAlpha } : undefined, fill: { fill: body, alpha: inkAlpha } }); continue; }
      if (edge > 0) casing.add({ stroke: paint.casing, width: w2 + 2 * inkEdge, alpha: inkAlpha, dash: paint.dash ? [px(4), px(2)] : undefined, cap }, path);
      fill.add({ stroke: body, width: w2, alpha: inkAlpha, cap }, path);
      if (s.role === 'bridge' && w2 > px(3.5)) {
        const rails = new Path2D(), offset = w2 / 2 - Math.max(0.4, px(0.8));
        for (let i = 1; i < s.street.path.length; i++) {
          const a = s.street.path[i - 1], b = s.street.path[i], len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 0.01) continue;
          const nx = -(b.y - a.y) / len * offset, ny = (b.x - a.x) / len * offset;
          for (const side of [-1, 1]) { rails.moveTo(a.x + nx * side, a.y + ny * side); rails.lineTo(b.x + nx * side, b.y + ny * side); }
        }
        marks.add({ stroke: paint.casing, width: Math.max(0.25, px(0.55)), cap: 'butt' }, rails);
      }
      if ((s.role === 'stairs' || s.role === 'port-stairs') && lod === 'close') marks.add({ stroke: '#705d45', width: px(0.6) }, stairMarks(s.street.path, s.width));
    }
    if (surfaced.length) {
      const streets = surfaced.map(x => x.s.street), ring = (r: readonly Point[]): Path2D => { const p = new Path2D(); p.moveTo(r[0].x, r[0].y); for (let i = 1; i < r.length; i++) p.lineTo(r[i].x, r[i].y); p.closePath(); return p; };
      const tolerance = Math.max(0.05, 0.35 * px(1)), minWidth = (i: number): number => surfaced[i].w;
      // Same streets, widths and edges (a camera move within one zoom step): same rings.
      const key = `${tolerance.toFixed(3)}|${surfaced.map(x => `${x.s.layout}.${x.s.index}:${x.w.toFixed(2)}:${x.casing ? x.edge.toFixed(2) : '-'}${x.inset ? `:${x.inset.toFixed(2)}` : ''}`).join(',')}`;
      let rings = SURFACE_CACHE.get(scene)?.get(key);
      if (!rings) {
        const cas = surfaced.some(x => x.casing) ? roadSurface(streets, { extra: i => surfaced[i].casing ? surfaced[i].edge : 0, minWidth, tolerance }) : [];
        const inner = surfaced.some(x => x.inset) ? roadSurface(streets, { extra: i => -(surfaced[i].inset ?? 0), minWidth, tolerance }).filter(p => surfaced[p.street].inset) : [];
        rings = { casing: cas.map(p => ({ street: p.street, path: ring(p.ring) })), fill: roadSurface(streets, { minWidth, tolerance }).map(p => ({ street: p.street, path: ring(p.ring) })), inner: inner.map(p => ({ street: p.street, path: ring(p.ring) })) };
        let memo = SURFACE_CACHE.get(scene); if (!memo) SURFACE_CACHE.set(scene, memo = new Map());
        if (memo.size >= 8) memo.delete(memo.keys().next().value!);
        memo.set(key, rings);
      }
      for (const p of rings.casing) { const st = surfaced[p.street].casing; if (st) casing.add(st, p.path); }
      for (const p of rings.fill) surface.add(surfaced[p.street].fill, p.path);
      for (const p of rings.inner) { const st = surfaced[p.street].inner; if (st) carriageways.add(st, p.path); }
    }
    casing.flush(ctx); under.flush(ctx); surface.flush(ctx); carriageways.flush(ctx); marks2.flush(ctx); over.flush(ctx); marks.flush(ctx);
  }

  if (layers.lotEnclosures !== false) drawLotEnclosures(ctx, scene, { mpp, lod, palette, groundOnly: layers.lotEnclosureMeshes }); // enclosures hook

  // Walls: thick line broken at gates, gate and wall towers.
  if (layers.enclosures) {
    const towers = new Batches(), detailed = cityWallDetails(scene); // walls hook
    for (const [wi, wall] of scene.walls.entries()) {
      if (detailed[wi]) continue; // walls hook: detailed walls are drawn by drawCityWalls
      const palisade = wall.kind === 'palisade', thick = Math.max(palisade ? 2 : 3.5, px(lod === 'far' ? 1.6 : 2.4));
      for (const piece of wall.pieces) {
        const path = linePath(piece);
        batch.add({ stroke: palisade ? '#72533a' : parchment ? PARCH.wall : '#4b443b', width: thick, dash: palisade ? [Math.max(1.3, px(2)), Math.max(0.5, px(1))] : undefined, cap: 'butt' }, path);
        if (!palisade && lod !== 'far') batch.add({ stroke: (tex && pat(wallStoneLayer(false))) || (parchment ? PARCH.wallFill : '#b6a793'), width: thick * 0.45, cap: 'butt' }, path);
      }
      if (lod === 'far' || palisade) continue;
      const radius = Math.max(thick * 0.95, px(2.2));
      for (const t of [...wall.gateTowers, ...wall.towers]) { const c = new Path2D(); c.arc(t.x, t.y, radius, 0, Math.PI * 2); towers.add({ fill: parchment ? PARCH.tower : '#5a5248', stroke: parchment ? PARCH.wall : '#2f2a24', width: px(0.6) }, c); }
    }
    batch.flush(ctx); towers.flush(ctx);
    drawCityWalls(ctx, scene, { viewport, mpp, lod, palette, night }); // walls hook
  }

  if (layers.waterways !== false && (layers.streets || layers.waterways)) drawCityWaterways(ctx, scene.layouts, mpp, o.waterColor);

  o.beforeBuildings?.(ctx);

  // Buildings: native renderer (compact / detailed) or batched silhouettes.
  if (o.buildingsVisible && o.buildings && (o.appearance.style === 'silhouette' || atLeast(lod, 'near')) && (o.appearance.style === 'silhouette' || view === 'buildings' || view === 'roles')) {
    const footprint = o.appearance.style === 'silhouette', colors = buildingColors(o.appearance.colors, o.appearance.ambience);
    if (o.renderer && view === 'buildings' && !footprint) {
      stats.pending = o.renderer.draw(ctx, { viewport, metresPerPixel: mpp, appearance: o.appearance, selectedId: o.selectedBuilding }).rasterTilesPending > 0;
    } else {
      const edge = { stroke: colors?.buildingEdge ?? (footprint && parchment ? '#f1e5c6' : '#2e261d'), width: px(footprint && parchment ? 0.3 : 0.55) };
      const roofs = o.buildings.roofs;
      if (!footprint && roofs && view === 'buildings' && o.appearance.diagnostic !== 'uses') {
        let paths = roofShadowPaths.get(roofs);
        if (!paths) roofShadowPaths.set(roofs, paths = []);
        // Neutral attenuation cannot brighten any channel of the receiving ground. On a natural ground the cast is a
        // near-black cool shade, and on snow the blue of skylit shade (snow is lighter than that tint in every channel).
        const shadeSnow = palette === 'terrain' && !night ? mapGroundSnow(o.buildings.items[0]?.snowAltitude) : -1;
        ctx.fillStyle = parchment ? 'rgba(0,0,0,0.2)' : shadeSnow < 0 ? 'rgba(0,0,0,0.3)' : shadeSnow > .3 ? 'rgba(22,38,70,0.3)' : 'rgba(10,14,24,0.34)';
        for (const i of o.buildings.bins.query(viewport)) {
          let path = paths[i];
          if (!path) { path = paths[i] = new Path2D(); for (const s of roofs.shadows[i] ?? []) path.addPath(shapePath(s)); }
          ctx.fill(path);
        }
      }
      for (const i of o.buildings.bins.query(viewport)) {
        const b = o.buildings.items[i]; stats.buildings++;
        const tint = planBuildingColors(b, footprint ? 'terrain' : palette);
        const color = view === 'roles' ? BUILDING_FAMILIES[b.family]?.color ?? '#5a4b3c' : o.appearance.diagnostic === 'uses' ? urbanFunctionColor(b.fn) : colors?.building ?? (footprint ? tint.roof : o.buildings.roofs ? tint.wall : tint.roof);
        if (footprint) {
          if (!b.footprintPath) { b.footprintPath = new Path2D(); for (const s of b.footprint ?? b.building.footprint) b.footprintPath.addPath(shapePath(s)); }
          batch.add({ fill: color, ...edge }, b.footprintPath);
        } else {
          if (!b.path) { b.path = new Path2D(); for (const s of b.surface) b.path.addPath(shapePath(s)); }
          batch.add({ fill: color, ...edge, ...(b.stilts ? { stroke: '#514431', width: px(0.6) } : {}) }, b.path);
        }
      }
      batch.flush(ctx);
      if (!footprint && o.buildings.roofs && view === 'buildings' && o.appearance.diagnostic !== 'uses') drawPlanRoofs(ctx, o.buildings, o, tex);
      if (footprint && !parchment) {
        ctx.strokeStyle = colors?.buildingEdge ?? '#2e261d'; ctx.lineWidth = px(0.4);
        for (const i of o.buildings.bins.query(viewport)) if (o.buildings.items[i].footprintPath) ctx.stroke(o.buildings.items[i].footprintPath!);
      }
      if (footprint) for (const i of o.buildings.bins.query(viewport)) drawRuinPlan(ctx, o.buildings.items[i].ruins ?? [], mpp);
      const selected = o.selectedBuilding === undefined ? undefined : o.buildings.byId.get(o.selectedBuilding);
      const selectedPath = selected === undefined ? undefined : footprint ? o.buildings.items[selected].footprintPath : o.buildings.items[selected].path;
      if (selectedPath) { ctx.strokeStyle = '#197ea4'; ctx.lineWidth = px(2); ctx.stroke(selectedPath); }
    }
  }

  if (night && o.appearance.diagnostic === 'none') {
    if (!o.deferNightTown) drawNightTown(ctx, scene, viewport, mpp, parchment, layers.streets);
    if (o.buildingsVisible && o.buildings) drawNightBuildings(ctx, o.buildings.items.map(b => b.building), viewport, mpp, parchment);
  }

  // Diagnostics of the plan.
  if (atLeast(lod, 'near')) {
    const access: Record<string, string> = { public: '#26815d', collective: '#456fba', private: '#aa6dad', unserved: '#cc383c', reserved: '#81725b', attached: '#91a36d' };
    if (layers.parcelOverlay !== false && (layers.fronts || layers.axes || layers.access)) for (const i of scene.bins.parcels.query(viewport)) {
      const p = scene.parcels[i], parcel = p.source;
      if (layers.fronts && parcel.front) batch.add({ stroke: '#a92d34', width: lineW * 2 }, linePath(parcel.front));
      if (layers.access && parcel.access) { const c = access[parcel.access.kind]; batch.add({ fill: c, alpha: 0.25 }, pathOf(p)); batch.add({ stroke: c, width: lineW * 1.5 }, pathOf(p)); }
      if (layers.axes && parcel.shape.outer.length) {
        const c = centroid([parcel.shape]); if (c) batch.add({ stroke: '#396781', width: lineW }, linePath([{ x: c.x - parcel.axis.x * 4, y: c.y - parcel.axis.y * 4 }, { x: c.x + parcel.axis.x * 4, y: c.y + parcel.axis.y * 4 }]));
      }
    }
    if (layers.parcelOverlay !== false && o.refusedParcels?.size) for (const i of scene.bins.parcels.query(viewport)) {
      const p = scene.parcels[i]; if (p.id && o.refusedParcels.has(p.id)) batch.add({ stroke: urbanFunctionColor('refusal'), width: px(1.8), dash: [px(4), px(2)] }, pathOf(p));
    }
  }
  for (const layout of scene.layouts) {
    if (layers.reserve) for (const s of (layout.structure?.reserve ?? []).flatMap(shape => scene.ground?.clip(shape) ?? [shape])) batch.add({ fill: '#6a8eb1', alpha: 0.08 }, shapePath(s)), batch.add({ stroke: '#416784', width: lineW * 2, dash: [px(7), px(4)] }, shapePath(s));
    if (layers.allocated) for (const s of (layout.structure?.allocated ?? []).flatMap(shape => scene.ground?.clip(shape) ?? [shape])) batch.add({ fill: '#c0a366', alpha: 0.12 }, shapePath(s)), batch.add({ stroke: '#8a632d', width: lineW * 2 }, shapePath(s));
    if (layers.quarters) layout.quarters.forEach((q, i) => batch.add({ stroke: palette === 'atlas' ? ATLAS[i % ATLAS.length] : parchment ? PARCH.ink : growthColor(q.zone ?? 'core'), width: lineW * 2, dash: [px(4), px(3)] }, shapePath(q.shape)));
  }
  if (o.selectedParcel !== undefined && scene.parcels[o.selectedParcel]) batch.add({ stroke: '#197ea4', width: px(2) }, pathOf(scene.parcels[o.selectedParcel]));
  batch.flush(ctx);

  // Screen-space marks: landmarks, district names, centres.
  if (o.labels === false) { stats.ms = performance.now() - start; return stats; }
  ctx.save(); ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  const screen = (p: Point): Point => ({ x: (p.x - viewport.minX) / mpp, y: (p.y - viewport.minY) / mpp });
  const text = o.text ?? DEFAULT_TEXT, pal = o.textPalette ?? PALETTES.parchment;
  const labels = cityTextLabels(scene, text, pal);
  const w = (viewport.maxX - viewport.minX) / mpp, h = (viewport.maxY - viewport.minY) / mpp;
  const placed = placeMapLabels(labels, { cx: (viewport.minX + viewport.maxX) / 2, cy: (viewport.minY + viewport.maxY) / 2, scale: 1 / mpp }, w, h, (t, size, st) => measureTextCached(ctx, t, size, st, textFamily(text, pal)), textPlacement(text));
  drawMapLabels(ctx, placed, pal, textFamily(text, pal));
  if (text.visible && text.groups.city && layers.centers) for (const layout of scene.layouts) for (const c of layout.structure?.centers ?? []) {
    const s = screen(c.point); ctx.strokeStyle = '#a43526'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x - 5, s.y); ctx.lineTo(s.x + 5, s.y); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x, s.y + 5); ctx.stroke();
  }
  ctx.restore();
  stats.ms = performance.now() - start;
  return stats;
}
function stairMarks(points: readonly Point[], width: number): Path2D {
  const path = new Path2D(); let next = 1.25; const half = Math.min(2, width) * 0.48;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    for (; next < length; next += 2.5) { const x = a.x + dx * next / length, y = a.y + dy * next / length; path.moveTo(x - dy * half / length, y + dx * half / length); path.lineTo(x + dy * half / length, y - dx * half / length); }
    next -= length;
  }
  return path;
}
/** Small vector glyphs: no font dependency in headless or offline browsers. */
export function landmarkGlyph(ctx: CanvasRenderingContext2D, family: string, x: number, y: number, size = 7): void {
  const color = BUILDING_FAMILIES[family]?.color ?? '#3d3226';
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#fbf6ea'; ctx.strokeStyle = color; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, size + 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
  const s = size * 0.62;
  switch (family) {
    case 'worship': ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.moveTo(-s * 0.6, -s * 0.35); ctx.lineTo(s * 0.6, -s * 0.35); ctx.stroke(); break;
    case 'defence': ctx.fillRect(-s * 0.7, -s * 0.4, s * 1.4, s * 1.2); for (const dx of [-0.7, -0.1, 0.5]) ctx.fillRect(dx * s, -s * 0.8, s * 0.3, s * 0.45); break;
    case 'civic': ctx.moveTo(-s, -s * 0.15); ctx.lineTo(0, -s * 0.85); ctx.lineTo(s, -s * 0.15); ctx.fill(); ctx.fillRect(-s * 0.75, -s * 0.05, s * 1.5, s * 0.85); break;
    case 'commerce': ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2); ctx.fill(); break;
    case 'craft': ctx.moveTo(0, -s * 0.8); ctx.lineTo(s * 0.8, 0); ctx.lineTo(0, s * 0.8); ctx.lineTo(-s * 0.8, 0); ctx.fill(); break;
    case 'garden': ctx.arc(0, -s * 0.2, s * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-s * 0.1, 0, s * 0.2, s * 0.8); break;
    default: ctx.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- host
/** Empties a whole Canvas 2D bitmap, in two strips. One clearRect (or a 'copy' fill) over
 * the whole canvas takes Chrome's "overwrite" fast path, which discards the pending
 * recording without flushing; on an accelerated canvas whose next frames draw nothing
 * else (the City Bench overlay once WebGL draws the plan), the last flushed bitmap stays:
 * the first full Canvas 2D frame of the plan then showed at its own scale and screen
 * position at every later zoom (a town « emprise » at 1/45 scale), and old landmark glyphs
 * stayed pinned to the screen. Two partial clears are ordinary draw operations. */
export function clearCanvas2d(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const top = Math.max(1, h >> 1);
  ctx.clearRect(0, 0, w, top); if (h > top) ctx.clearRect(0, top, w, h - top);
}
export interface CityCanvasFrame { viewport: Box; mpp: number; dpr: number }
/** A viewport-sized canvas inside the map SVG (foreignObject), so it keeps the
 * SVG stacking order: under roads and markers, above the map background. */
export class CityCanvasLayer {
  readonly canvas = document.createElement('canvas');
  private host: SVGForeignObjectElement;
  private frame = 0;
  constructor(private readonly map: SVGSVGElement, parent: Element, private readonly paint: (ctx: CanvasRenderingContext2D, frame: CityCanvasFrame) => boolean) {
    this.host = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    this.host.addEventListener('illustration:capture', () => this.draw());
    this.host.dataset.cityCanvas = ''; this.canvas.style.display = 'block'; this.canvas.style.pointerEvents = 'none';
    this.host.append(this.canvas); this.attach(parent);
  }
  attach(parent: Element): void { if (this.host.parentNode !== parent) parent.append(this.host); }
  request(): void { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }
  draw(): void {
    const box = this.map.viewBox.baseVal, rect = this.map.getBoundingClientRect(), ctx = this.canvas.getContext('2d');
    if (!ctx || !box || !(box.width > 0) || !(rect.width > 0) || !(rect.height > 0)) return;
    const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    for (const [key, value] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height })) this.host.setAttribute(key, String(value));
    this.canvas.style.width = `${box.width}px`; this.canvas.style.height = `${box.height}px`;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    clearCanvas2d(ctx, w, h);
    const k = w / box.width; ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
    const more = this.paint(ctx, { viewport: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }, mpp: box.width / rect.width, dpr });
    if (more) this.request();
  }
  dispose(): void { cancelAnimationFrame(this.frame); this.frame = 0; this.host.remove(); }
}
