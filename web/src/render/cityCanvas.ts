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
import { buildingColors, type UrbanBuildingAppearance } from './urbanBuildingStyle';
import { buildingHeat, roofSnowPatches, roofSnowRidgeMelt, roofSnowShare } from './roofSnow';
import { roleLabel, uiRoleLocale, type RoleLocale } from './cityRoles';
import { DISTRICT_NAMES_EN, buildingFamilyName, districtName, districtRoleFromLabel, roleText, specialityName } from './cityRolesLocale';
import { COVER_GRAINS, MATERIALS, coverGrainPattern, coverLayer, roofGrain as roofGrainFamily, layerExtent, layerPattern, materialImagesNow, placeLayer, wallStoneLayer, type MaterialImages } from './buildingMaterials';
import { drawLotEnclosures, updateYardEnclosures } from './cityLotEnclosures'; // enclosures hook (cityLotEnclosures.ts)
import { cityWallDetails, drawCityWallGround, drawCityWalls } from './cityWalls'; // walls hook (cityWalls.ts)
import { roadGrain, roadPaint } from './roadStyle';
import { layoutStreetPavements } from './roadPavement';
import { cityGroundFor, boardwalkWidth, isBoardwalk, type CityGround, type CityGroundRaster } from './cityGround';
import { massingFootprint, planRoof, pieceShadows, pieceVolumes, readMassing, stiltDeck, stiltSupports, roofLight as roofLight3, type ResolvedVolume } from './cityMassing';
import { drawGardenDetails } from './readableGardens';
import { softenRuralGround } from './countryside';
import { polygonCentroid as shapeRingCenter } from '../gen/core/geom';
import { roadSurface } from './roadSurface';
import { differenceS, unionS } from '../gen/geo/bool';
import { drawNightBuildings, drawNightTown } from './cityNight';
import { drawRuinPlan, ruinFootprint } from './cityRuins';
import { drawFarTown } from './cityFarRaster';
import {
  ATLAS,
  DISTRICT_COLORS,
  FAMILY_COLORS,
  FOOTPRINT_EDGE_PX,
  GRAIN_SHIFT,
  PARCH,
  PARCHMENT_HATCH,
  REFUSED_PARCEL,
  SELECTION,
  SNOW_SHIFT,
  ZONE_COLORS,
  atLeast,
  blockOps,
  buildingBody,
  buildingEdgeInk,
  buildingEdgePx,
  buildingGroundSnow,
  buildingsShown,
  castShadowFill,
  farTownAlpha,
  farTownShown,
  footprintOps,
  parcelOps,
  parcelsShown,
  planFrame,
  quayPaint,
  roleFamily,
  roofFrame,
  roofPanGrain,
  roofPanPaint,
  roofPanSnow,
  roofPansShown,
  streetFrame,
  streetLook,
  streetOrder,
  streetShown,
  wallLook,
  type BuildingFrame,
  type BuildingsShownInput,
  type PaintOp,
  type StreetFill,
  type StreetLayer,
  type StreetPaint,
  type StreetSurface,
} from './city/look';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export type CityView = 'tissue' | 'uses' | 'parcels' | 'buildings' | 'roles';
export type CityLod = 'far' | 'mid' | 'near' | 'close';
export type CityPalette = 'growth' | 'atlas' | 'ink' | 'terrain' | 'parchment';
export interface CityLayers {
  waterways?: boolean;
  reserve: boolean;
  allocated: boolean;
  centers: boolean;
  domains: boolean;
  quarters: boolean;
  blocks: boolean;
  streets: boolean;
  enclosures: boolean;
  /** Composition visibility for all parcel types and details; retained on the GPU's Canvas overlay. */ parcelOverlay?: boolean;
  /** Walls, hedges and fences of the lots; absent = shown. */ lotEnclosures?: boolean;
  /** Abstract outlines of lots, blocks and squares (the Urban plan's lines); absent = shown. */ planLines?: boolean;
  /** The fences stand as 3D meshes: the plan paints the yard ground only. */ lotEnclosureMeshes?: boolean;
  /** Streets as a ground surface (square junctions, curb returns, tapers); absent = on, off = round-capped strokes. */ roadSurface?: boolean;
  parcels: boolean;
  gardens: boolean;
  places: boolean;
  fronts: boolean;
  axes: boolean;
  access: boolean;
}

// ---------------------------------------------------------------- levels of detail and roles
// Limits, hysteresis and role families are the look's (city/look.ts); the hosts import them from here.
export { CITY_LOD_LIMITS, CITY_LOD_OFF, selectCityLod, districtRoleKey, roleFamily } from './city/look';

// ---------------------------------------------------------------- roles
/** `label` is the name in the UI language (`<html lang>`, English by default), read on access; `labelEn` is the English source. */
export const DISTRICT_ROLES: Record<string, { label: string; labelEn: string; color: string }> = Object.fromEntries(
  Object.entries(DISTRICT_COLORS).map(([id, color]) => [
    id,
    {
      get label(): string {
        return districtName(id, uiRoleLocale()) ?? id;
      },
      labelEn: DISTRICT_NAMES_EN[id],
      color,
    },
  ]),
);
/** `label` is the name in the UI language, read on access. */
export const BUILDING_FAMILIES: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.entries(FAMILY_COLORS).map(([id, color]) => [
    id,
    {
      get label(): string {
        return buildingFamilyName(id, uiRoleLocale());
      },
      color,
    },
  ]),
);
/** Preserve district toponyms in their culture's language. Only the service
 * catalogue's generic French role labels are translated into the UI language. */
export function districtRoleLabel(role: string, label?: string, locale: RoleLocale = uiRoleLocale()): string {
  if (label && (locale === 'fr' || !districtRoleFromLabel(label))) return label;
  const key = role || districtRoleFromLabel(label) || '';
  if (!key) return roleText('District', locale);
  const [head, tail] = key.split(/[.:/]/),
    id = head?.toLowerCase(),
    base = districtName(id, locale) ?? head;
  return tail ? `${base} · ${specialityName(tail, locale)}` : base;
}
/** Name of a landmark role in the UI language (the engine's `label` only without a role); never a raw id tail such as « friday ». */
export const landmarkName = (role?: string, fallback = 'Monument', label?: string, locale: RoleLocale = uiRoleLocale()): string => (role ? roleLabel(role, locale) : (locale === 'fr' ? label : undefined) || roleText(fallback, locale));

// ---------------------------------------------------------------- geometry
const EMPTY: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
function grow(box: Box, points: readonly Point[], pad = 0): Box {
  for (const p of points) {
    if (p.x - pad < box.minX) box.minX = p.x - pad;
    if (p.y - pad < box.minY) box.minY = p.y - pad;
    if (p.x + pad > box.maxX) box.maxX = p.x + pad;
    if (p.y + pad > box.maxY) box.maxY = p.y + pad;
  }
  return box;
}
export const shapeBox = (shape: Shape): Box => grow({ ...EMPTY }, shape.outer);
const surfaceBox = (surface: Surface): Box => surface.reduce((box, shape) => grow(box, shape.outer), { ...EMPTY });
const overlaps = (a: Box, b: Box): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const ringArea = (ring: readonly Point[]): number => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return s / 2;
};
function inRing(ring: readonly Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i].y > p.y !== ring[j].y > p.y && p.x < ((ring[j].x - ring[i].x) * (p.y - ring[i].y)) / (ring[j].y - ring[i].y) + ring[i].x) hit = !hit;
  return hit;
}
export const shapeContains = (shape: Shape, p: Point): boolean => inRing(shape.outer, p) && !(shape.holes ?? []).some(h => inRing(h, p));
/** Area-weighted centroid of the outer rings. */
function centroid(shapes: readonly Shape[]): Point | undefined {
  let a = 0,
    x = 0,
    y = 0;
  for (const { outer } of shapes)
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const c = outer[j].x * outer[i].y - outer[i].x * outer[j].y;
      a += c;
      x += (outer[j].x + outer[i].x) * c;
      y += (outer[j].y + outer[i].y) * c;
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
  private seen: Uint32Array;
  private stamp = 0;
  constructor(
    readonly boxes: readonly Box[],
    private readonly cell = 96,
  ) {
    this.seen = new Uint32Array(boxes.length);
    boxes.forEach((box, index) => {
      if (!(box.minX <= box.maxX && box.minY <= box.maxY)) return;
      const x0 = Math.floor(box.minX / cell),
        x1 = Math.floor(box.maxX / cell),
        y0 = Math.floor(box.minY / cell),
        y1 = Math.floor(box.maxY / cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1024) {
        this.overflow.push(index);
        return;
      }
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const key = (x + 32768) * 65536 + (y + 32768),
            list = this.cells.get(key);
          if (list) list.push(index);
          else this.cells.set(key, [index]);
        }
    });
  }
  query(box: Box): number[] {
    const result: number[] = [],
      stamp = ++this.stamp;
    if (stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const take = (i: number): void => {
      if (this.seen[i] !== this.stamp && overlaps(this.boxes[i], box)) {
        this.seen[i] = this.stamp;
        result.push(i);
      }
    };
    const x0 = Math.floor(box.minX / this.cell),
      x1 = Math.floor(box.maxX / this.cell),
      y0 = Math.floor(box.minY / this.cell),
      y1 = Math.floor(box.maxY / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (const list of this.cells.values()) for (const i of list) take(i);
    } else for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (const i of this.cells.get((x + 32768) * 65536 + (y + 32768)) ?? []) take(i);
    for (const i of this.overflow) take(i);
    return result.sort((a, b) => a - b);
  }
}

// ---------------------------------------------------------------- scene
export interface CityDistrict {
  layout: number;
  id: number;
  role?: string;
  label?: string;
  wealth?: number;
  tissue: string;
  phase: number;
  anchor?: Point;
}
export interface CityAllocation {
  role?: string;
  label?: string;
  wealth?: number;
  function: string;
  landmark: boolean;
  households?: number;
  residents?: number;
  demandId: string;
  culture: string;
}
export interface CityBlock {
  ground?: Shape[];
  groundPath?: Path2D;
  layout: number;
  index: number;
  shape: Shape;
  kind: string;
  zone: string;
  phase: number;
  quarter: number;
  district?: CityDistrict;
  peripheral: boolean;
  path?: Path2D;
}
export interface CityParcel {
  ground?: Shape[];
  groundPath?: Path2D;
  layout: number;
  index: number;
  shape: Shape;
  use: string;
  block: number;
  zone: string;
  id?: string;
  allocation?: CityAllocation;
  district?: CityDistrict;
  peripheral: boolean;
  source: Parcel;
  path?: Path2D;
}
export interface CityStreet {
  layout: number;
  index: number;
  street: Street;
  width: number;
  rank: number;
  role: string;
  path?: Path2D;
}
export interface CityWall {
  kind: string;
  pieces: Point[][];
  gates: Point[];
  gateTowers: Point[];
  towers: Point[];
}
export interface CityLandmark {
  point: Point;
  family: string;
  label: string;
  parcel?: number;
  box: Box;
}
export interface CityScene {
  layouts: readonly Layout[];
  blocks: CityBlock[];
  parcels: CityParcel[];
  streets: CityStreet[];
  walls: CityWall[];
  districts: CityDistrict[];
  landmarks: CityLandmark[];
  footprint: Shape[];
  ground?: CityGround;
  extent: Box;
  quays?: Quay[];
  /** Walls, hedges and fences round the lots (enclosures hook). */
  lotEnclosures?: import('../../../rust/bridge/urban').LotEnclosure[];
  enclosureProfiles?: (import('../../../rust/bridge/urban').ResolvedEnclosure | undefined)[];
  lotYards?: import('./cityLotEnclosures').Yard[];
  bins: { blocks: SpatialBins; parcels: SpatialBins; streets: SpatialBins; landmarks: SpatialBins };
  parcelById: Map<string, number>;
}
export interface CityBuilding {
  ruins?: Surface;
  stilts?: boolean;
  /** Some volume has a flat roof (bevelled rim in plan; parchment draws its ground shadow). */ flat?: boolean;
  snowAltitude?: number;
  /** Weathering of the roof, 0 (new cover) to 1 (old, mossy), stable per building. */ age?: number;
  /** Mill works seen from above on a natural ground: sails (hub at (x, y), `z` above the ground, blades `w` long and `d` wide in the vertical plane facing `angle`) and water wheels (axle centre, radius `w`, width `d`, axle along `angle`). */ marks?: {
    kind: 'sails' | 'wheel';
    x: number;
    y: number;
    w: number;
    d: number;
    z: number;
    angle: number;
    turn: number;
  }[];
  id: string;
  surface: Surface;
  footprint?: Surface;
  fn: string;
  family: string;
  role?: string;
  landmark: boolean;
  parcel?: number;
  building: PlacedBuilding;
  material?: { culture: string; wall: string; cover: string; tone: number; /** Wall colour the building asks for ("#rrggbb"). */ tint?: string };
  path?: Path2D;
  footprintPath?: Path2D;
}
/** Roof pans of the massing (cityMassing.ts): one polygon per sloped face, its
 * building and its light; height shadows per building (sun from the north-west). */
/** `dir`: downslope direction of each pan in plan (radians, atan2 of the face normal's horizontal part; 0 when flat). */
export interface CityRoofs {
  shapes: Shape[];
  owner: Uint32Array;
  light: Float32Array;
  cover: string[];
  wall?: string[];
  tone: Float32Array;
  dir: Float32Array;
  /** 0 = pitched, 1 = single flat slab, 2 = terrace. */ flat?: Uint8Array;
  /** Share of a full snow mantle the pan keeps (0: never snowed). */ snow?: Float32Array;
  /** 1: inset snow patch of the pan before it (drawn only with snow on the ground). */ patch?: Uint8Array;
  /** 1: bevel of the rim around a flat roof (parapet or kerb). */ rim?: Uint8Array;
  /** Wall colour asked for the pan's volume ("#rrggbb"). */ tint?: (string | undefined)[];
  /** Grain family of the pan: 1 + its index in COVER_GRAINS (buildingMaterials.ts), 0 for none. */ grain?: Uint8Array;
  shadows: Shape[][];
}
export interface CityBuildings {
  items: CityBuilding[];
  bins: SpatialBins;
  byId: Map<string, number>;
  roofs?: CityRoofs;
  /** Class of the retained roof and shadow paths (default: the native Path2D); the vector recorder needs paths it can read. */ pathClass?: new () => Path2D;
}

/** Optional contract fields read defensively: older plans render without them. */
type DistrictContract = { role?: string; label?: string; wealth?: number };
type AllocationContract = { role?: string; label?: string; wealth?: number; landmark?: boolean; households?: number };
type EnclosureContract = { towers?: Point[] };

/** The wall stroke stops at each gate, so roads remain visible through it. */
function wallPieces(points: Point[], gates: Point[]): { pieces: Point[][]; gateTowers: Point[] } {
  const pieces: Point[][] = [],
    gateTowers: Point[] = [];
  if (points.length < 2) return { pieces, gateTowers };
  const closed = points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y ? points : [...points, points[0]];
  let current: Point[] = [];
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1],
      b = closed[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const at = (d: number): Point => ({ x: a.x + (dx * d) / length, y: a.y + (dy * d) / length });
    const gaps = gates
      .flatMap(g => {
        const along = ((g.x - a.x) * dx + (g.y - a.y) * dy) / length,
          across = Math.abs((g.x - a.x) * dy - (g.y - a.y) * dx) / length;
        if (across > 6 || along < -6 || along > length + 6) return [];
        const half = Math.sqrt(36 - across * across);
        return [[Math.max(0, along - half), Math.min(length, along + half)]];
      })
      .sort((p, q) => p[0] - q[0]);
    let start = 0;
    if (!current.length) current.push(a);
    for (const [from, to] of gaps) {
      if (from > start) current.push(at(from));
      if (current.length > 1) pieces.push(current);
      if (from > 0.01) gateTowers.push(at(from));
      if (to < length - 0.01) gateTowers.push(at(to));
      current = [at(Math.max(start, to))];
      start = Math.max(start, to);
    }
    current.push(b);
  }
  if (current.length > 1) pieces.push(current);
  return { pieces, gateTowers };
}

/** The shapes `buildCityScene` clips against the water for these layouts and partitions (blocks, lots, allocated
 * ground), the very objects it will ask for: a clip ahead (CityGround.clipAhead) then answers them from its cache.
 * A shape missing here is simply clipped by the scene itself. */
export function cityGroundSubjects(layouts: readonly Layout[], partitions: readonly Partition[] = []): Shape[] {
  const shapes: Shape[] = [];
  for (const layout of layouts) {
    for (const block of layout.blocks) shapes.push(block.kind === 'reserve' ? softenRuralGround(block.shape) : block.shape);
    for (const shape of layout.structure?.allocated?.length ? layout.structure.allocated : layout.quarters.map(q => q.shape)) shapes.push(shape);
    for (const parcel of partitions.find(p => p.key === layout.key)?.parcels ?? []) shapes.push(parcel.use === 'reserve' ? softenRuralGround(parcel.shape) : parcel.shape);
  }
  return shapes;
}
export function buildCityScene(layouts: readonly Layout[], partitions: readonly Partition[] = [], terrain?: CityGroundRaster): CityScene {
  const ground = terrain && cityGroundFor(terrain);
  const blocks: CityBlock[] = [],
    parcels: CityParcel[] = [],
    streets: CityStreet[] = [],
    walls: CityWall[] = [],
    districts: CityDistrict[] = [];
  const landmarks: CityLandmark[] = [],
    footprint: Shape[] = [],
    parcelById = new Map<string, number>();
  const extent = { ...EMPTY },
    quays: Quay[] = [];
  // Water clipping runs once for the whole scene (one Rust call), after the walk.
  const pendingGround: { target: { ground?: Shape[] }; shape: Shape }[] = [],
    footprintSources: Shape[] = [];
  layouts.forEach((layout, li) => {
    for (const q of layout.structure?.quays ?? []) {
      quays.push(q);
      grow(extent, q.shape.outer);
    }
    const phases = layout.phases ?? [];
    const byQuarter = new Map<number, CityDistrict>(),
      districtShapes = new Map<CityDistrict, Shape[]>();
    for (const d of layout.structure?.districts ?? []) {
      const extra = d as typeof d & DistrictContract;
      const district: CityDistrict = { layout: li, id: d.id, role: extra.role || undefined, label: extra.label || undefined, wealth: typeof extra.wealth === 'number' ? extra.wealth : undefined, tissue: d.tissue, phase: d.phase };
      districts.push(district);
      districtShapes.set(district, []);
      for (const q of d.quarters) byQuarter.set(q, district);
    }
    const walled = (layout.enclosures?.length ?? 0) > 0;
    const zoneOf = (quarter: number, zone?: string, phase?: number): { zone: string; phase: number; peripheral: boolean } => {
      const q = layout.quarters[quarter],
        p = phase ?? q?.phase ?? 0,
        growth = phases[p];
      const z = zone ?? q?.zone ?? growth?.zone ?? 'core',
        kind = growth?.kind;
      return { zone: kind === 'faubourg' ? 'faubourg' : z, phase: p, peripheral: kind === 'faubourg' || (['edge', 'faubourg', 'village'].includes(growth?.zone ?? z) && !walled) };
    };
    layout.blocks.forEach((block, bi) => {
      const z = zoneOf(block.quarter, block.zone, block.phase),
        district = byQuarter.get(block.quarter);
      const shape = block.kind === 'reserve' ? softenRuralGround(block.shape) : block.shape;
      const item: CityBlock = { layout: li, index: bi, shape, ground: undefined, kind: block.kind, zone: z.zone, phase: z.phase, quarter: block.quarter, district, peripheral: z.peripheral };
      blocks.push(item);
      if (ground) pendingGround.push({ target: item, shape });
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
      allocations.set(a.parcelId, {
        role: extra.role || undefined,
        label: extra.label || undefined,
        wealth: typeof extra.wealth === 'number' ? extra.wealth : undefined,
        function: a.function,
        landmark: extra.landmark === true,
        households: typeof extra.households === 'number' ? extra.households : undefined,
        residents: a.residents,
        demandId: a.demandId,
        culture: a.culture,
      });
    }
    partition.parcels.forEach((parcel, pi) => {
      const block = layout.blocks[parcel.block],
        z = zoneOf(block?.quarter ?? -1, block?.zone, block?.phase);
      const allocation = parcel.id ? allocations.get(parcel.id) : undefined,
        index = parcels.length;
      const shape = parcel.use === 'reserve' ? softenRuralGround(parcel.shape) : parcel.shape;
      const item: CityParcel = { layout: li, index: pi, shape, ground: undefined, use: parcel.use, block: parcel.block, zone: z.zone, id: parcel.id, allocation, district: block && byQuarter.get(block.quarter), peripheral: z.peripheral, source: parcel };
      parcels.push(item);
      if (ground) pendingGround.push({ target: item, shape });
      if (parcel.id) parcelById.set(parcel.id, index);
      if (allocation?.landmark || parcel.use === 'market') {
        const point = centroid([parcel.shape]);
        if (point)
          landmarks.push({
            point,
            parcel: index,
            box: { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y },
            family: parcel.use === 'market' && !allocation?.role ? 'commerce' : roleFamily(allocation?.role, allocation?.function),
            label: landmarkName(allocation?.role, parcel.use === 'market' ? 'Market' : 'Monument', allocation?.label),
          });
      }
    });
  });
  if (ground) {
    const clipped = ground.clipMany([...pendingGround.map(p => p.shape), ...footprintSources]);
    pendingGround.forEach((p, i) => {
      p.target.ground = clipped[i];
    });
    footprint.push(...clipped.slice(pendingGround.length).flat());
  } else footprint.push(...footprintSources);
  // Native previews supply occupied houses later; an empty cadastre has no fences.
  const lotEnclosures: import('../../../rust/bridge/urban').LotEnclosure[] = [];
  const enclosureProfiles = layouts.map(l => partitions.find(p => p.key === l.key)?.enclosure);
  return {
    layouts,
    blocks,
    parcels,
    streets,
    walls,
    districts,
    landmarks,
    footprint,
    extent,
    parcelById,
    quays,
    ground,
    lotEnclosures,
    enclosureProfiles,
    bins: {
      blocks: new SpatialBins(
        blocks.map(b => shapeBox(b.shape)),
        128,
      ),
      parcels: new SpatialBins(
        parcels.map(p => shapeBox(p.shape)),
        64,
      ),
      streets: new SpatialBins(
        streets.map(s => grow({ ...EMPTY }, s.street.path, s.width)),
        128,
      ),
      landmarks: new SpatialBins(
        landmarks.map(l => l.box),
        128,
      ),
    },
  };
}

/** Sails and water wheels of a building's volumes (massing features), with their height above the building ground. */
function millMarks(volumes: readonly ResolvedVolume[] | undefined): CityBuilding['marks'] {
  const marks: NonNullable<CityBuilding['marks']> = [];
  for (const v of volumes ?? [])
    for (const f of v.detail?.features ?? []) {
      if (f.kind === 'sails') marks.push({ kind: 'sails', x: f.x, y: f.y, w: f.w, d: f.d, z: v.eave_m + f.h, angle: f.angle, turn: f.turn ?? 0 });
      else if (f.kind === 'wheel') marks.push({ kind: 'wheel', x: f.x, y: f.y, w: f.w, d: f.d, z: (v.base_m ?? 0) + f.h, angle: f.angle, turn: f.turn ?? 0 });
    }
  return marks.length ? marks : undefined;
}
/** Stable 0..1 value of a building id (one independent stream per salt). */
function idUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 8) & 0xffff) / 0xffff;
}
/** Buildings of a scene, linked to their parcel allocation for roles. `roofs: false` keeps the items (footprints, roles,
 * materials) without the roof pans, snow patches and cast shadows: the far view of a very large town, whose detail is
 * built later for the visible area only (v2/nativeCityMap.ts). */
/** Plan links of a building item (parcel, role, family, landmark): shared by `buildCityBuildings` and the parallel
 * build (cityBuildingsParallel.ts), whose workers have no plan. */
export function cityBuildingLink(building: PlacedBuilding, plan?: CityScene): Pick<CityBuilding, 'parcel' | 'role' | 'family' | 'landmark'> & { allocation?: CityAllocation } {
  const programme = (building as PlacedBuilding & { programme?: AllocationContract }).programme;
  const parcel = plan?.parcelById.get(building.parcel_id),
    allocation = parcel === undefined ? undefined : plan!.parcels[parcel].allocation;
  return { parcel, allocation, role: programme?.role ?? allocation?.role, family: roleFamily(programme?.role ?? allocation?.role, building.function), landmark: programme?.landmark === true || allocation?.landmark === true };
}
/** Material culture of a building: its own, else its parcel's allocation, else its town's. */
export function cityBuildingCulture(building: PlacedBuilding, plan?: CityScene): string {
  const { parcel, allocation } = cityBuildingLink(building, plan);
  return building.culture?.culture || allocation?.culture || (parcel === undefined ? '' : plan?.layouts[plan.parcels[parcel].layout]?.culture) || '';
}
/** Snow line of each item: the mean ground of its town. */
export function citySnowAltitudes(items: CityBuilding[], plan?: CityScene): void {
  const altitudes = new Map<number, { sum: number; count: number }>();
  for (const b of items) {
    const town = b.parcel === undefined ? -1 : (plan?.parcels[b.parcel]?.layout ?? -1);
    const a = altitudes.get(town) ?? { sum: 0, count: 0 };
    a.sum += b.building.ground_z_m || 0;
    a.count++;
    altitudes.set(town, a);
  }
  for (const b of items) {
    const town = b.parcel === undefined ? -1 : (plan?.parcels[b.parcel]?.layout ?? -1),
      a = altitudes.get(town)!;
    b.snowAltitude = a.sum / a.count;
  }
}
/** Spatial bins of the items (same boxes as `buildCityBuildings`). */
export const cityBuildingBins = (items: readonly CityBuilding[]): SpatialBins =>
  new SpatialBins(
    items.map(b => surfaceBox([...b.surface, ...(b.footprint ?? [])])),
    64,
  );
/** `cultures`: the material culture of each building of the batch, given by the caller (a worker chunk has no plan);
 * `rawRoofs`: the roof arrays are returned even when they hold no pan (a chunk's shadows stay aligned with its items). */
export function buildCityBuildings(batch: Pick<PlacementBatch, 'buildings'> | undefined, plan?: CityScene, options: { roofs?: boolean; cultures?: readonly string[]; rawRoofs?: boolean } = {}): CityBuildings {
  const withRoofs = options.roofs !== false;
  const items: CityBuilding[] = [],
    byId = new Map<string, number>();
  const roofShapes: Shape[] = [],
    roofOwner: number[] = [],
    roofLight: number[] = [],
    roofCover: string[] = [],
    roofWall: string[] = [],
    roofTone: number[] = [],
    roofDir: number[] = [],
    roofFlat: number[] = [],
    roofSnow: number[] = [],
    roofPatch: number[] = [],
    roofGrainOf: number[] = [],
    roofRim: number[] = [],
    roofTint: (string | undefined)[] = [],
    shadows: Shape[][] = [];
  let bi = -1;
  for (const building of batch?.buildings ?? []) {
    bi++;
    let surface = building.roof_footprint.length ? building.roof_footprint : building.footprint;
    if (!surface.length) continue;
    const programme = (building as PlacedBuilding & { programme?: AllocationContract }).programme;
    const link = cityBuildingLink(building, plan),
      parcel = link.parcel;
    const massing = readMassing(programme, building.footprint, building.id);
    const byPiece = massing && building.footprint.map((shape, i) => pieceVolumes(shape, massing[i])),
      volumes = byPiece?.flat(),
      first = volumes?.[0];
    if (volumes) {
      if (volumes.some(v => v.detail?.stilts_m || ['tree', 'mushroom', 'yurt', 'tower'].includes(v.detail?.form ?? '')))
        surface = volumes.flatMap(v =>
          v.detail?.stilts_m
            ? [
                { ...v.shape, outer: stiltDeck(v.shape.outer) },
                ...stiltSupports(v.shape.outer).map(p => ({
                  outer: [
                    { x: p.x - 0.16, y: p.y - 0.16 },
                    { x: p.x + 0.16, y: p.y - 0.16 },
                    { x: p.x + 0.16, y: p.y + 0.16 },
                    { x: p.x - 0.16, y: p.y + 0.16 },
                  ],
                  holes: [],
                })),
              ]
            : [v.shape],
        );
    }
    const culture = options.cultures ? options.cultures[bi] : cityBuildingCulture(building, plan);
    byId.set(building.id, items.length);
    items.push({
      id: building.id,
      surface,
      footprint: massingFootprint(building.footprint, massing),
      fn: building.function,
      role: link.role,
      family: link.family,
      landmark: link.landmark,
      parcel,
      building,
      ruins: ruinFootprint(building.footprint, programme, massing),
      stilts: volumes?.some(v => (v.detail?.stilts_m ?? 0) > 0),
      age: idUnit(building.id, 0x51ed),
      marks: millMarks(volumes),
      material: { culture, wall: first?.wall ?? '', cover: first?.cover ?? '', tone: first?.tone ?? 0.5, tint: first?.tint },
    });
    if (!massing || !withRoofs) {
      shadows.push([]);
      continue;
    }
    const owner = items.length - 1,
      heat = buildingHeat(building.function);
    let terraced = false;
    // Explicit pans come out of `planRoof` unchanged (no polygon boolean). A face of a small decorative volume is one
    // polygon carrying its own snow share (no inset snow patch, no ink edge): a third of the draws of a full face.
    // Every face keeps its own share of the mantle (pitch, cover, exposure, the heat of the building's use: one rule
    // for every roof). Its snow is one inset patch: eaves, hips and ridges stay free of snow, and a heated roof
    // leaves a wider bare strip below the ridge. Only the faces that reach the top of their volume open there: the
    // lower courses of a dome, a cone or a tent keep an even patch (no bare rings), the crown opens like a smoke hole.
    // The corners of each patch move a little (a hash of the building and the face, the same amplitude everywhere),
    // so the bare rim is not ruler-drawn; the patch never reaches the edge of its face.
    const planned = planRoof(building.footprint, massing),
      tops = new Map<number, number>();
    for (const face of planned) {
      const key = face.piece * 4096 + face.vol;
      let top = tops.get(key) ?? -Infinity;
      for (const p of face.points) if (p.z > top) top = p.z;
      tops.set(key, top);
    }
    const snowSeed = Math.round(idUnit(building.id, 0x2b7) * 0xffff);
    for (const face of planned.flatMap((face, fi) => {
      const light = face.light ?? roofLight3(face.normal),
        share = roofSnowShare(face.normal, light, heat, face.cover);
      const top = tops.get(face.piece * 4096 + face.vol)!,
        ridge = face.points.some(p => p.z > top - 0.05) ? roofSnowRidgeMelt(heat, light) : 0.055;
      return face.minor && share ? [{ ...face, snow: share }] : [{ ...face, snow: 0 }, ...(face.snow === 0 ? [] : roofSnowPatches(face.points, face.normal, 0.055, ridge, snowSeed + fi * 131, 0.09).map(p => ({ ...face, points: p.points, snow: share, patch: 1 })))];
    })) {
      if (face.normal[2] < 0.08 || face.points.length < 3) continue; // gable ends and walls are edge-on from above
      if (face.flat) items[owner].flat = true;
      terraced ||= !!face.terrace;
      // Grain family of the pan: by cover, flatness and culture; none on living crowns (tree dwellings) and on small
      // decorative volumes (chimneys, dormers: a few pixels).
      const grain = face.minor || byPiece![face.piece]?.[face.vol]?.tree ? undefined : roofGrainFamily(face.cover, !!face.flat || face.normal[2] > 0.995, culture);
      roofGrainOf.push(grain ? COVER_GRAINS.indexOf(grain) + 1 : 0);
      roofFlat.push(face.terrace ? 2 : face.flat ? 1 : 0);
      roofSnow.push(face.snow ?? 0);
      roofPatch.push('patch' in face ? face.patch : 0);
      roofRim.push(face.rim ? 1 : 0);
      roofTint.push(face.tint);
      roofShapes.push({ outer: face.points.map(p => ({ x: p.x, y: p.y })), holes: face.holes ?? [] });
      roofOwner.push(owner);
      roofLight.push(face.light ?? roofLight3(face.normal));
      roofCover.push(face.cover);
      roofWall.push(face.wall);
      roofTone.push(face.tone);
      roofDir.push(Math.hypot(face.normal[0], face.normal[1]) > 1e-3 ? Math.atan2(face.normal[1], face.normal[0]) : 0);
    }
    const casts = building.footprint.flatMap((shape, i) => (massing[i] ? pieceShadows(shape, massing[i]) : []));
    // Terrace receivers already have their own opaque shade. The ground pass must
    // contain only the exterior SE cast, with no overlapping hulls or courtyard wash.
    shadows.push(
      terraced && casts.length
        ? differenceS(
            unionS(casts[0], ...casts.slice(1)),
            [...building.footprint, ...surface].map(s => ({ outer: s.outer, holes: [] })),
          )
        : casts,
    );
  }
  citySnowAltitudes(items, plan);
  const roofs =
    roofShapes.length || options.rawRoofs
      ? {
          shapes: roofShapes,
          owner: Uint32Array.from(roofOwner),
          light: Float32Array.from(roofLight),
          cover: roofCover,
          wall: roofWall,
          tone: Float32Array.from(roofTone),
          dir: Float32Array.from(roofDir),
          flat: Uint8Array.from(roofFlat),
          snow: Float32Array.from(roofSnow),
          patch: Uint8Array.from(roofPatch),
          grain: Uint8Array.from(roofGrainOf),
          rim: Uint8Array.from(roofRim),
          tint: roofTint,
          shadows,
        }
      : undefined;
  return { items, byId, bins: cityBuildingBins(items), ...(roofs ? { roofs } : {}) };
}

export interface CityPick {
  building?: CityBuilding;
  parcel?: CityParcel;
  block?: CityBlock;
}
/** Topmost item under a world point: building, then parcel, then block. */
export function pickCity(scene: CityScene, buildings: CityBuildings | undefined, p: Point): CityPick {
  const point: Box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
    result: CityPick = {};
  if (buildings)
    for (const i of buildings.bins.query(point).reverse())
      if (buildings.items[i].surface.some(s => shapeContains(s, p))) {
        result.building = buildings.items[i];
        break;
      }
  for (const i of scene.bins.parcels.query(point).reverse())
    if (shapeContains(scene.parcels[i].shape, p)) {
      result.parcel = scene.parcels[i];
      break;
    }
  for (const i of scene.bins.blocks.query(point).reverse())
    if (shapeContains(scene.blocks[i].shape, p)) {
      result.block = scene.blocks[i];
      break;
    }
  return result;
}

// ---------------------------------------------------------------- drawing
export interface CityBuildingRenderer {
  draw(ctx: CanvasRenderingContext2D, options: { viewport: Box; metresPerPixel: number; appearance: UrbanBuildingAppearance; selectedId?: string }): { rasterTilesPending: number };
}
export interface CityDrawOptions {
  colors?: import('./customColors').RenderColors;
  readableGardens?: boolean;
  /** Names, landmark glyphs and centre pins; omitted keeps the normal map. */
  labels?: boolean;
  text?: Readonly<TextSettings>;
  textPalette?: Palette;
  viewport: Box;
  mpp: number;
  dpr: number;
  lod: CityLod;
  view: CityView;
  palette: CityPalette;
  width: number;
  layers: CityLayers;
  buildings?: CityBuildings;
  buildingsVisible: boolean;
  renderer?: CityBuildingRenderer;
  appearance: UrbanBuildingAppearance;
  selectedBuilding?: string;
  selectedParcel?: number;
  refusedParcels?: ReadonlySet<string>;
  /** Textured materials (PBR patterns in world metres) on roofs, streets, plazas and walls; `onTexturesReady` asks for a redraw once the atlases are loaded. */
  textured?: boolean;
  onTexturesReady?: () => void;
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
  /** Puts the map's drawn water back over the town ground and its streets (world-coordinate context), before the
   * quays, bridges and fords: the river is above the roads, quays and bridges above the river. */
  waterAbove?: (ctx: CanvasRenderingContext2D, box: Box, over?: () => void) => void;
  /** Satellite grounds: below the scale of single roofs the town is its far raster (cityFarRaster.ts), cross-faded with the buildings. */
  farTown?: boolean;
  /** The whole town for that raster when `buildings` holds only the visible detail of a very large town (default: `buildings`). */
  farBuildings?: CityBuildings;
}
export interface CityFrameStats {
  lod: CityLod;
  blocks: number;
  parcels: number;
  streets: number;
  buildings: number;
  ms: number;
  pending: boolean;
}

/** Ink hatching in screen pixels (one tile per context, rescaled to the frame): the look's PARCHMENT_HATCH as a pattern. */
const hatches = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
function hatchPattern(ctx: CanvasRenderingContext2D, mpp: number): CanvasPattern | undefined {
  let pattern = hatches.get(ctx);
  if (!pattern) {
    const tile = document.createElement('canvas'),
      p = PARCHMENT_HATCH.periodPx;
    tile.width = tile.height = p;
    const t = tile.getContext('2d');
    if (!t) return undefined;
    t.strokeStyle = PARCHMENT_HATCH.color;
    t.globalAlpha = PARCHMENT_HATCH.alpha;
    t.lineWidth = PARCHMENT_HATCH.widthPx;
    t.beginPath();
    t.moveTo(-1, p + 1);
    t.lineTo(p + 1, -1);
    t.moveTo(-1, 1);
    t.lineTo(1, -1);
    t.moveTo(p - 1, p + 1);
    t.lineTo(p + 1, p - 1);
    t.stroke();
    pattern = ctx.createPattern(tile, 'repeat') ?? undefined;
    if (!pattern) return undefined;
    hatches.set(ctx, pattern);
  }
  pattern.setTransform(new DOMMatrix().scale(mpp));
  return pattern;
}
/** Outer rings counter-clockwise, holes clockwise: batches fill with the nonzero
 * rule, so overlapping items of one style unite while courts stay open. */
function shapePath(shape: Shape, Path: new () => Path2D = Path2D): Path2D {
  const path = new Path();
  const ring = (points: readonly Point[], hole: boolean): void => {
    if (points.length < 3) return;
    const reverse = ringArea(points) < 0 !== hole,
      n = points.length,
      at = (i: number): Point => points[reverse ? n - 1 - i : i];
    path.moveTo(at(0).x, at(0).y);
    for (let i = 1; i < n; i++) path.lineTo(at(i).x, at(i).y);
    path.closePath();
  };
  ring(shape.outer, false);
  for (const hole of shape.holes ?? []) ring(hole, true);
  return path;
}
function linePath(points: readonly Point[]): Path2D {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  return path;
}
interface Style {
  fill?: string | CanvasPattern;
  stroke?: string | CanvasPattern;
  width?: number;
  alpha?: number;
  dash?: number[];
  cap?: CanvasLineCap;
}
const patternIds = new WeakMap<CanvasPattern, number>();
let patternSeq = 0;
const patternKey = (v: string | CanvasPattern | undefined): string | undefined => {
  if (!v || typeof v === 'string') return v;
  let id = patternIds.get(v);
  if (!id) patternIds.set(v, (id = ++patternSeq));
  return `pattern${id}`;
};
/** Style batches: one fill or stroke call per style, in first-use order. */
class Batches {
  private groups = new Map<string, { style: Style; path: Path2D }>();
  add(style: Style, path: Path2D): void {
    const key = `${patternKey(style.fill)}|${patternKey(style.stroke)}|${style.width}|${style.alpha}|${style.dash}|${style.cap}`;
    let group = this.groups.get(key);
    if (!group) {
      group = { style, path: new Path2D() };
      this.groups.set(key, group);
    }
    group.path.addPath(path);
  }
  flush(ctx: CanvasRenderingContext2D): void {
    for (const { style, path } of this.groups.values()) {
      ctx.globalAlpha = style.alpha ?? 1;
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill(path, 'nonzero');
      }
      if (style.stroke && style.width) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.width;
        ctx.setLineDash(style.dash ?? []);
        ctx.lineCap = style.cap ?? 'round';
        ctx.stroke(path);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    this.groups.clear();
  }
  /** `flush` with a pause after each style: the same calls in the same order (resumable painting, drawCitySteps). */
  *flushSteps(ctx: CanvasRenderingContext2D): Generator<void, void> {
    for (const { style, path } of this.groups.values()) {
      ctx.globalAlpha = style.alpha ?? 1;
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill(path, 'nonzero');
      }
      if (style.stroke && style.width) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.width;
        ctx.setLineDash(style.dash ?? []);
        ctx.lineCap = style.cap ?? 'round';
        ctx.stroke(path);
      }
      yield;
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    this.groups.clear();
  }
}
/** Street surface rings per scene, by streets, widths and edges drawn (a few camera steps). */
const SURFACE_CACHE = new WeakMap<object, Map<string, { casing: { street: number; path: Path2D }[]; fill: { street: number; path: Path2D }[]; inner: { street: number; path: Path2D }[] }>>();

const roofIndex = new WeakMap<CityRoofs, { byOwner: number[][]; paths: (Path2D | undefined)[] }>();
const roofShadowPaths = new WeakMap<CityRoofs, (Path2D | undefined)[]>();
const roofGrain = new WeakMap<ImageBitmap, Map<number, CanvasPattern>>();
/** Mean-centred grain, shared per material; soft light keeps the final palette colour. */
function roofGrainPattern(ctx: CanvasRenderingContext2D, images: MaterialImages, layer: number, angle: number): CanvasPattern | undefined {
  let cache = roofGrain.get(images.albedo);
  if (!cache) roofGrain.set(images.albedo, (cache = new Map()));
  let pattern = cache.get(layer);
  if (!pattern) {
    const t = MATERIALS.tile,
      tile = Object.assign(document.createElement('canvas'), { width: t, height: t }),
      c = tile.getContext('2d')!;
    c.drawImage(images.albedo, 0, layer * t, t, t, 0, 0, t, t);
    const pixels = c.getImageData(0, 0, t, t),
      data = pixels.data,
      mean = MATERIALS.layers[layer].mean_rgb;
    const luma = Math.max(5, mean[0] * 0.3 + mean[1] * 0.59 + mean[2] * 0.11);
    for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, ((data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / luma - 1) * 89.25 + 127.5));
    c.putImageData(pixels, 0, 0);
    pattern = ctx.createPattern(tile, 'repeat') ?? undefined;
    if (!pattern) return undefined;
    cache.set(layer, pattern);
  }
  const s = layerExtent(layer) / MATERIALS.tile;
  pattern.setTransform(new DOMMatrix().rotate((angle * 180) / Math.PI).scale(s, s));
  return pattern;
}
/** Final colour of every roof pan, kept until the ground tones, the palette, the season or the custom ink change:
 * a frame only reads them. */
const roofPaint = new WeakMap<CityRoofs, { key: string; colors: (string | undefined)[]; gains: number[] }>();
/** Same massing faces and shared tint as the GPU path. On natural grounds (terrain palette, by day) a pitched pan
 * takes the capped light of its cover (planPanLight: thatch never shines), its weathering and its procedural grain
 * along the slope (`images`, textured materials, replaces that grain); the rim of a flat roof on masonry walls is
 * the top of those walls, in their colour (the brick of a block shows from above); snow is the inset patch of each
 * face, an uneven mantle at the scales of the cover grain (the same on every roof), the flat snow tint further out. */
function drawPlanRoofs(ctx: CanvasRenderingContext2D, b: CityBuildings, o: CityDrawOptions, images?: MaterialImages): void {
  const steps = drawPlanRoofsSteps(ctx, b, o, images);
  while (!steps.next().done);
}
/** Buildings between two pauses of the resumable roof and shadow loops (a few milliseconds of Canvas calls). */
const ROOF_STEP = 16,
  SHADOW_STEP = 128;
/** `drawPlanRoofs` in resumable steps: the same calls in the same order, with a pause every `ROOF_STEP` buildings. The
 * context must not be drawn on by anyone else between two steps. */
function* drawPlanRoofsSteps(ctx: CanvasRenderingContext2D, b: CityBuildings, o: CityDrawOptions, images?: MaterialImages): Generator<void, void> {
  const roofs = b.roofs!;
  let index = roofIndex.get(roofs);
  if (!index) {
    const byOwner: number[][] = b.items.map(() => []);
    roofs.owner.forEach((ow, k) => byOwner[ow]?.push(k));
    roofIndex.set(roofs, (index = { byOwner, paths: [] }));
  }
  // What a pan is painted with is the look's (city/buildingLook.ts): its colour and grain gain are kept per pan.
  const f = roofFrame({ palette: o.palette, mpp: o.mpp, dpr: o.dpr, night: o.night, cave: o.appearance.cave, diagnostic: o.appearance.diagnostic, colors: o.colors, textured: !!images });
  let paint = roofPaint.get(roofs);
  if (!paint || paint.key !== f.key) roofPaint.set(roofs, (paint = { key: f.key, colors: [], gains: [] }));
  const edge = parseInt(f.edge.color.slice(1), 16);
  ctx.strokeStyle = `rgba(${(edge >> 16) & 255},${(edge >> 8) & 255},${edge & 255},${f.edge.alpha})`;
  ctx.lineWidth = f.edge.widthPx * o.mpp;
  let drawn = 0;
  for (const i of b.bins.query(o.viewport)) {
    const pans = index.byOwner[i];
    if (!pans?.length) continue;
    if (++drawn % ROOF_STEP === 0) yield;
    const item = b.items[i],
      age = item.age ?? 0.5,
      ground = buildingGroundSnow(item);
    for (const k of pans) {
      // Without snow on the ground a snow patch repeats the pan under it.
      if (roofs.patch?.[k] && !ground) continue;
      const path = (index.paths[k] ??= shapePath(roofs.shapes[k], b.pathClass));
      let color = paint.colors[k];
      if (color === undefined) {
        const made = roofPanPaint(f, item, roofs, k, ground);
        color = paint.colors[k] = made.color;
        paint.gains[k] = made.gain;
      }
      // The snow of a patch is uneven at the scales of the cover grain: the mantle as a pattern over the cover (thin
      // places drawn out down the slope, the cover faintly through them), the same tile on every roof, shifted per
      // building. Further out it is the flat snow tint; the two cross-fade.
      const mantle = roofPanSnow(f, roofs, k, ground),
        snow = mantle ? coverGrainPattern(ctx, mantle.shaded ? 'snowShade' : 'snow', f.grain!.level, roofs.dir[k] ?? 0, age * SNOW_SHIFT[0], age * SNOW_SHIFT[1]) : undefined;
      if (!mantle || !snow) {
        ctx.fillStyle = color;
        ctx.fill(path);
      } else {
        if (mantle.under > 0) {
          ctx.globalAlpha = mantle.under;
          ctx.fillStyle = color;
          ctx.fill(path);
        }
        ctx.globalAlpha = mantle.alpha;
        ctx.fillStyle = snow;
        ctx.fill(path);
        ctx.globalAlpha = 1;
      }
      if (!(roofs.snow?.[k] && ground)) {
        // The cover's own grain, wherever the cover shows (textured materials replace the procedural one).
        const layer = images ? coverLayer(roofs.cover[k]) : -1;
        if (images && layer >= 0) {
          const grain = roofGrainPattern(ctx, images, layer, (roofs.dir[k] ?? 0) - Math.PI / 2);
          if (grain) {
            ctx.save();
            ctx.globalCompositeOperation = 'soft-light';
            ctx.fillStyle = grain;
            ctx.fill(path);
            ctx.restore();
          }
        } else {
          // The shift gives every building its own piece of the tile.
          const laid = roofPanGrain(f, roofs, k, ground, paint.gains[k]),
            grain = laid ? coverGrainPattern(ctx, COVER_GRAINS[laid.family - 1], f.grain!.level, roofs.dir[k] ?? 0, age * GRAIN_SHIFT[0], age * GRAIN_SHIFT[1]) : undefined;
          if (laid && grain) {
            ctx.globalAlpha = laid.strength;
            ctx.fillStyle = grain;
            ctx.fill(path);
            ctx.globalAlpha = 1;
          }
        }
      }
      if (!roofs.snow?.[k]) ctx.stroke(path);
    }
    if (f.natural && item.marks) drawMillMarks(ctx, b, item, o);
  }
}
const millPaths = new WeakMap<CityBuilding, { Path: unknown; shadow: Path2D; bars: Path2D; wheels: Path2D; paddles: Path2D; cloth: number }>();
/** Mill works of a building as an aerial photograph shows them (natural grounds). Sails stand in a vertical plane:
 * from above they are a short pale bar across the cap, and what tells the windmill is their long cross-shaped shadow
 * on the ground, cast like the building's (sun from the north-west). A water wheel is a dark timber rectangle, as
 * long as its diameter and as wide as the wheel, beside the building, with its float boards across it. */
function drawMillMarks(ctx: CanvasRenderingContext2D, b: CityBuildings, item: CityBuilding, o: CityDrawOptions): void {
  const Path = b.pathClass ?? Path2D;
  let held = millPaths.get(item);
  if (!held || held.Path !== Path) {
    held = { Path, shadow: new Path(), bars: new Path(), wheels: new Path(), paddles: new Path(), cloth: 0.5 };
    for (const m of item.marks ?? []) {
      const ax = Math.cos(m.angle),
        ay = Math.sin(m.angle),
        tx = -ay,
        ty = ax;
      if (m.kind === 'sails') {
        // Same cast as pieceShadow: a point h above the ground falls .55 h east and .44 h south.
        const foot = (s: number, u: number): Point => ({ x: m.x + tx * s + (m.z + u) * 0.55, y: m.y + ty * s + (m.z + u) * 0.44 }),
          hub = foot(0, 0);
        for (let k = 0; k < 4; k++) {
          const a = m.turn + (k * Math.PI) / 2,
            tip = foot(Math.cos(a) * m.w, Math.sin(a) * m.w);
          held.shadow.moveTo(hub.x, hub.y);
          held.shadow.lineTo(tip.x, tip.y);
        }
        const reach = m.w * Math.max(Math.abs(Math.cos(m.turn)), Math.abs(Math.sin(m.turn)));
        held.bars.moveTo(m.x - tx * reach + ax * 0.5, m.y - ty * reach + ay * 0.5);
        held.bars.lineTo(m.x + tx * reach + ax * 0.5, m.y + ty * reach + ay * 0.5);
        held.cloth = Math.max(held.cloth, m.d, m.w * 0.16);
      } else {
        const r = Math.max(0.6, m.w),
          half = Math.max(0.3, m.d) / 2,
          at = (s: number, off: number): Point => ({ x: m.x + tx * s + ax * off, y: m.y + ty * s + ay * off });
        const corners = [at(-r, -half), at(r, -half), at(r, half), at(-r, half)];
        held.wheels.moveTo(corners[0].x, corners[0].y);
        for (const c of corners.slice(1)) held.wheels.lineTo(c.x, c.y);
        held.wheels.closePath();
        for (let k = 1; k < 6; k++) {
          const s = -r + (k * r) / 3,
            p = at(s, -half),
            q = at(s, half);
          held.paddles.moveTo(p.x, p.y);
          held.paddles.lineTo(q.x, q.y);
        }
      }
    }
    millPaths.set(item, held);
  }
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.strokeStyle = castShadowFill(o.palette, !!o.night, item.snowAltitude);
  ctx.lineWidth = Math.max(held.cloth * 0.6, 1.2 * o.mpp);
  ctx.stroke(held.shadow);
  ctx.fillStyle = '#3b3127';
  ctx.fill(held.wheels);
  if (o.mpp <= 0.5) {
    ctx.strokeStyle = 'rgba(128,112,88,0.7)';
    ctx.lineWidth = Math.max(0.1, 0.5 * o.mpp);
    ctx.stroke(held.paddles);
  }
  ctx.strokeStyle = 'rgba(226,220,202,0.92)';
  ctx.lineWidth = Math.max(0.35, 1.1 * o.mpp);
  ctx.stroke(held.bars);
  ctx.restore();
}
/** Buildings that stand outside any town plan (farmsteads, isolated houses), painted as the buildings of a town
 * are in the buildings view: cast shadow, wall base with its edge, then the roof pans of `drawPlanRoofs` (pan light,
 * grain by cover and culture, weathering, snow). The context is in world coordinates; nothing is batched, so the
 * calls are those the vector recorder reads (give `buildings.pathClass` a path class it can read). Returns the
 * number of buildings drawn. */
export function drawRoofedBuildings(ctx: CanvasRenderingContext2D, buildings: CityBuildings, o: Pick<CityDrawOptions, 'viewport' | 'mpp' | 'dpr' | 'palette' | 'appearance' | 'colors' | 'night'>): number {
  const roofs = buildings.roofs,
    visible = buildings.bins.query(o.viewport);
  if (!roofs || !visible.length) return 0;
  const night = !!o.night,
    Path = buildings.pathClass ?? Path2D,
    group = (shapes: readonly Shape[]): Path2D => {
      const p = new Path();
      for (const s of shapes) p.addPath(shapePath(s, Path));
      return p;
    };
  let shadows = roofShadowPaths.get(roofs);
  if (!shadows) roofShadowPaths.set(roofs, (shadows = []));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  for (const i of visible) {
    // Each isolated building stands at its own altitude: its own shadow tone (snow or bare ground).
    ctx.fillStyle = castShadowFill(o.palette, night, buildings.items[i].snowAltitude);
    ctx.fill((shadows[i] ??= group(roofs.shadows[i] ?? [])));
  }
  const colors = buildingColors(o.appearance.colors, o.appearance.ambience),
    body: BuildingFrame = { view: 'buildings', palette: o.palette, footprint: false, diagnostic: 'none', colors };
  ctx.strokeStyle = buildingEdgeInk(colors, false, false);
  ctx.lineWidth = buildingEdgePx(false, false) * o.mpp;
  for (const i of visible) {
    const item = buildings.items[i],
      path = (item.path ??= group(item.surface));
    ctx.fillStyle = buildingBody(body, item, true).fill;
    ctx.fill(path, 'nonzero');
    ctx.stroke(path);
  }
  drawPlanRoofs(ctx, buildings, o as CityDrawOptions);
  ctx.restore();
  return visible.length;
}

/** Paint the visible plan into a context already set to world coordinates. */
export function drawCity(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityDrawOptions): CityFrameStats {
  const steps = drawCitySteps(ctx, scene, o);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
/** `drawCity` in resumable steps, for a caller that paints a large town over several tasks (the live town layer of
 * the V2): the same Canvas calls in the same order, with a pause between the layers of the plan and every few
 * buildings. No `save()` is open at a pause; the context must not be drawn on by anyone else between two steps. */
export function* drawCitySteps(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityDrawOptions): Generator<void, CityFrameStats> {
  if (o.buildings) updateYardEnclosures(scene, o.buildings.items, () => o.buildings!.items.map(b => b.building));
  const start = performance.now(),
    { viewport, mpp, lod, view, palette, layers } = o,
    px = (n: number): number => n * mpp;
  // Textured materials: repeating patterns anchored to world metres (ink and parchment keep their own look).
  const tex = o.textured && !o.night && palette !== 'parchment' && palette !== 'ink' ? materialImagesNow(o.onTexturesReady) : undefined;
  const pat = (layer: number): CanvasPattern | undefined => (tex ? (layerPattern(ctx, tex, layer) ?? undefined) : undefined);
  const stats: CityFrameStats = { lod, blocks: 0, parcels: 0, streets: 0, buildings: 0, ms: 0, pending: false };
  const parchment = palette === 'parchment',
    night = !!o.night;
  // The plan's paint is the look's (city/planLook.ts); this function turns each operation into one batched call.
  const plan = planFrame({ view, lod, palette, layers, width: o.width, night, groundBlend: o.groundBlend, materialGround: o.materialGround, roadLook: o.roadLook, textured: !!tex });
  const batch = new Batches(),
    lineW = px(plan.lineWidthPx);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const pathOf = <T extends { path?: Path2D; shape: Shape; ground?: Shape[]; groundPath?: Path2D }>(item: T): Path2D => {
    if (!item.ground) return (item.path ??= shapePath(item.shape));
    if (!item.groundPath) {
      item.groundPath = new Path2D();
      for (const s of item.ground) item.groundPath.addPath(shapePath(s));
    }
    return item.groundPath;
  };
  const growthColor = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;
  /** The operations of one element, batched over its path: widths and dashes from CSS pixels to world units, the
   * hatching and the paving material as patterns of this context. */
  const paint = (ops: readonly PaintOp[], path: Path2D): void => {
    for (const op of ops) {
      const fill = op.hatch ? hatchPattern(ctx, mpp) : op.plaza && op.fill && tex ? (pat(placeLayer()) ?? op.fill) : op.fill;
      if (op.hatch && !fill) continue;
      batch.add({ fill, stroke: op.stroke, width: op.widthPx === undefined ? undefined : px(op.widthPx), alpha: op.alpha, dash: op.dashPx?.map(px), cap: op.cap }, path);
    }
  };

  if (lod === 'far') {
    // Far: the urban footprint as one tint, main roads and walls.
    for (const shape of scene.footprint) {
      if (!overlaps(shapeBox(shape), viewport)) continue;
      const ops = footprintOps(plan, shape);
      if (ops.length) paint(ops, shapePath(shape));
    }
    batch.flush(ctx);
  } else {
    // Blocks: palette, district role, or the ground under buildings.
    if (layers.blocks || layers.domains)
      for (const i of scene.bins.blocks.query(viewport)) {
        const b = scene.blocks[i],
          ops = blockOps(plan, b, scene.enclosureProfiles?.[b.layout]?.hideLotLines);
        if (!ops) continue;
        stats.blocks++;
        paint(ops, pathOf(b));
      }
    yield* batch.flushSteps(ctx);
    // Parcels: cadastral detail from near; uses and roles from mid.
    if (parcelsShown(plan))
      for (const i of scene.bins.parcels.query(viewport)) {
        const p = scene.parcels[i],
          ops = parcelOps(plan, p, scene.enclosureProfiles?.[p.layout]?.hideLotLines);
        if (!ops) continue;
        stats.parcels++;
        paint(ops, pathOf(p));
      }
    yield* batch.flushSteps(ctx);
  }
  yield;

  if (layers.parcelOverlay !== false && o.readableGardens && (lod === 'near' || lod === 'close') && view !== 'tissue') {
    for (const i of scene.bins.parcels.query(viewport)) {
      const garden = scene.parcels[i];
      if (garden.use !== 'garden') continue;
      const center = shapeRingCenter(garden.shape.outer);
      const neighbours = scene.bins.parcels
        .query(shapeBox(garden.shape))
        .map(j => scene.parcels[j])
        .filter(p => p.layout === garden.layout && p.block === garden.block && ['plot', 'compound', 'court'].includes(p.use));
      const nearest = neighbours.sort((a, b) => {
        const x = shapeRingCenter((a.source.envelope ?? a.shape).outer),
          y = shapeRingCenter((b.source.envelope ?? b.shape).outer);
        return Math.hypot(x.x - center.x, x.y - center.y) - Math.hypot(y.x - center.x, y.y - center.y);
      })[0];
      if (nearest) drawGardenDetails(ctx, garden.shape, shapeRingCenter((nearest.source.envelope ?? nearest.shape).outer), mpp);
    }
  }
  // Harbour platforms and furniture (harbourStyle.ts, shared with cityGl and the 3D city); small furniture on close
  // views only. The quay band hugs the drawn water (urban::harbour_furniture): drawn above the streets and the water
  // put back over them, below the bridges and fords; a street reaching the waterfront ends on the quay.
  const drawQuays = (): void => {
    for (const q of scene.quays ?? []) {
      if (!overlaps(shapeBox(q.shape), viewport)) continue;
      const quay = quayPaint(plan, q.kind, q.material);
      if (!quay) continue;
      const path = shapePath(q.shape),
        alpha = ctx.globalAlpha;
      if (quay.fillAlpha > 0) {
        ctx.globalAlpha = alpha * quay.fillAlpha;
        ctx.fillStyle = quay.fill;
        ctx.fill(path);
      }
      if (quay.lineAlpha > 0) {
        ctx.globalAlpha = alpha * quay.lineAlpha;
        ctx.strokeStyle = quay.line;
        ctx.lineWidth = px(quay.width);
        ctx.stroke(path);
      }
      ctx.globalAlpha = alpha;
    }
  };

  if (layers.enclosures) drawCityWallGround(ctx, scene, { viewport, mpp, lod, palette, night }); // walls hook: ditches and glacis under the streets
  // Streets: centrelines stroked by rank, casing first, majors and crossings on top. What each street is painted with
  // is the look's (city/streetLook.ts); here its strokes are batched by draw layer and its surface rings are built.
  if (layers.streets) {
    // Stable order by descending rank (crossings last): bucket by rank, O(n) instead of a per-frame sort.
    const buckets = new Map<number, CityStreet[]>();
    for (const i of scene.bins.streets.query(viewport)) {
      const s = scene.streets[i];
      if (!streetShown(s, lod)) continue;
      const k = streetOrder(s),
        list = buckets.get(k);
      if (list) list.push(s);
      else buckets.set(k, [s]);
    }
    const visible = [...buckets.keys()].sort((a, b) => b - a).flatMap(k => buckets.get(k)!);
    const stroked: Record<StreetLayer, Batches> = { casing: new Batches(), under: new Batches(), marks2: new Batches(), over: new Batches(), marks: new Batches() },
      surface = new Batches(),
      carriageways = new Batches();
    const frame = streetFrame({
      lod,
      palette,
      streetPalette: o.streetPalette,
      mpp,
      layers,
      night,
      roadLook: o.roadLook,
      roadEmphasis: o.roadEmphasis,
      groundBlend: o.groundBlend,
      materialGround: o.materialGround,
      textured: !!tex,
      colors: o.colors,
      paintColors: o.appearance.colors,
      paintNight: o.appearance.ambience === 'night',
    });
    // A paint of the look in this context: a colour as it is, the ground-textured road paint of a rank (one pattern per
    // rank and context, so its strokes batch together), the aggregate grain, a textured material.
    const paintOf = (p: StreetPaint): string | CanvasPattern | undefined => (typeof p === 'string' ? p : 'grain' in p ? roadGrain(ctx) : 'material' in p ? pat(p.material) || p.fallback : roadPaint(ctx, p.road, p.style));
    const fillOf = (f: StreetFill): Style => ({ fill: paintOf(f.paint), alpha: f.alpha });
    // Near and close: streets drawn as their ground surface (roadSurface.ts), filled once per style.
    const surfaced: { s: CityStreet; x: StreetSurface; casing?: Style; fill: Style; inner?: Style }[] = [];
    for (const s of visible) {
      stats.streets++;
      const layout = scene.layouts[s.layout],
        look = streetLook(frame, s, { pavement: layoutStreetPavements(layout)?.[s.index], population: layout?.programme?.population });
      const path = (s.path ??= linePath(s.street.path));
      for (const k of look.strokes) {
        const stroke = paintOf(k.paint);
        if (stroke) stroked[k.layer].add({ stroke, width: k.width, alpha: k.alpha, dash: k.dash as number[] | undefined, cap: k.cap }, path);
      }
      if (look.surface) surfaced.push({ s, x: look.surface, casing: look.surface.casing && fillOf(look.surface.casing), fill: fillOf(look.surface.fill), inner: look.surface.inner && fillOf(look.surface.inner) });
      if (look.rails) {
        const rails = new Path2D(),
          offset = look.rails.offset;
        for (let i = 1; i < s.street.path.length; i++) {
          const a = s.street.path[i - 1],
            b = s.street.path[i],
            len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.01) continue;
          const nx = (-(b.y - a.y) / len) * offset,
            ny = ((b.x - a.x) / len) * offset;
          for (const side of [-1, 1]) {
            rails.moveTo(a.x + nx * side, a.y + ny * side);
            rails.lineTo(b.x + nx * side, b.y + ny * side);
          }
        }
        stroked.marks.add({ stroke: look.rails.paint, width: look.rails.width, cap: 'butt' }, rails);
      }
      if (look.stairs) stroked.marks.add({ stroke: look.stairs.paint, width: look.stairs.width }, stairMarks(s.street.path, s.width));
    }
    if (surfaced.length) {
      const streets = surfaced.map(x => x.s.street),
        ring = (r: readonly Point[]): Path2D => {
          const p = new Path2D();
          p.moveTo(r[0].x, r[0].y);
          for (let i = 1; i < r.length; i++) p.lineTo(r[i].x, r[i].y);
          p.closePath();
          return p;
        };
      const tolerance = Math.max(0.05, 0.35 * px(1)),
        minWidth = (i: number): number => surfaced[i].x.w;
      const ends = surfaced.some(x => x.x.end) ? (i: number): 'round' | 'square' | 'taper' | 'butt' => surfaced[i].x.end ?? 'round' : undefined;
      // Same streets, widths and edges (a camera move within one zoom step): same rings.
      const key = `${tolerance.toFixed(3)}|${surfaced.map(x => `${x.s.layout}.${x.s.index}:${x.x.w.toFixed(2)}:${x.casing ? x.x.edge.toFixed(2) : '-'}${x.x.inset ? `:${x.x.inset.toFixed(2)}` : ''}${x.x.end ? `:${x.x.end}` : ''}`).join(',')}`;
      let rings = SURFACE_CACHE.get(scene)?.get(key);
      if (!rings) {
        const cas = surfaced.some(x => x.casing) ? roadSurface(streets, { extra: i => (surfaced[i].casing ? surfaced[i].x.edge : 0), minWidth, tolerance, ends }) : [];
        yield;
        const inner = surfaced.some(x => x.x.inset) ? roadSurface(streets, { extra: i => -(surfaced[i].x.inset ?? 0), minWidth, tolerance, ends }).filter(p => surfaced[p.street].x.inset) : [];
        yield;
        const body = roadSurface(streets, { minWidth, tolerance, ends });
        yield;
        rings = { casing: cas.map(p => ({ street: p.street, path: ring(p.ring) })), fill: body.map(p => ({ street: p.street, path: ring(p.ring) })), inner: inner.map(p => ({ street: p.street, path: ring(p.ring) })) };
        let memo = SURFACE_CACHE.get(scene);
        if (!memo) SURFACE_CACHE.set(scene, (memo = new Map()));
        if (memo.size >= 8) memo.delete(memo.keys().next().value!);
        memo.set(key, rings);
      }
      for (const p of rings.casing) {
        const st = surfaced[p.street].casing;
        if (st) stroked.casing.add(st, p.path);
      }
      for (const p of rings.fill) surface.add(surfaced[p.street].fill, p.path);
      for (const p of rings.inner) {
        const st = surfaced[p.street].inner;
        if (st) carriageways.add(st, p.path);
      }
    }
    yield;
    yield* stroked.casing.flushSteps(ctx);
    yield* stroked.under.flushSteps(ctx);
    yield* surface.flushSteps(ctx);
    yield* carriageways.flushSteps(ctx);
    yield* stroked.marks2.flushSteps(ctx);
    // Draw order on the water: streets, the water (put back), the quays over it, bridges and fords. Only around this
    // town's own streets: another town's quays and bridges drawn before stay above the water.
    if (o.waterAbove && visible.length) {
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const s of visible)
        for (const q of s.street.path) {
          const r = s.width + 20;
          box.minX = Math.min(box.minX, q.x - r);
          box.minY = Math.min(box.minY, q.y - r);
          box.maxX = Math.max(box.maxX, q.x + r);
          box.maxY = Math.max(box.maxY, q.y + r);
        }
      o.waterAbove(ctx, box);
    }
    drawQuays();
    stroked.over.flush(ctx);
    stroked.marks.flush(ctx);
  }
  yield;

  if (layers.lotEnclosures !== false) drawLotEnclosures(ctx, scene, { mpp, lod, palette, groundOnly: layers.lotEnclosureMeshes }); // enclosures hook

  // Walls: thick line broken at gates, gate and wall towers.
  if (layers.enclosures) {
    const towers = new Batches(),
      detailed = cityWallDetails(scene); // walls hook
    for (const [wi, wall] of scene.walls.entries()) {
      if (detailed[wi]) continue; // walls hook: detailed walls are drawn by drawCityWalls
      const look = wallLook(wall.kind, palette, lod, mpp);
      for (const piece of wall.pieces) {
        const path = linePath(piece);
        batch.add({ stroke: look.outer, width: look.thick, dash: look.dash, cap: 'butt' }, path);
        if (look.inner) batch.add({ stroke: (tex && pat(wallStoneLayer(false))) || look.inner.color, width: look.thick * look.inner.share, cap: 'butt' }, path);
      }
      if (!look.tower) continue;
      for (const t of [...wall.gateTowers, ...wall.towers]) {
        const c = new Path2D();
        c.arc(t.x, t.y, look.tower.radius, 0, Math.PI * 2);
        towers.add({ fill: look.tower.fill, stroke: look.tower.stroke, width: px(look.tower.strokePx) }, c);
      }
    }
    batch.flush(ctx);
    towers.flush(ctx);
    drawCityWalls(ctx, scene, { viewport, mpp, lod, palette, night }); // walls hook
  }

  if (layers.waterways !== false && (layers.streets || layers.waterways)) drawCityWaterways(ctx, scene.layouts, mpp, o.waterColor);

  yield;
  o.beforeBuildings?.(ctx);

  // Buildings: native renderer (compact / detailed) or batched silhouettes. On satellite grounds the far raster stands
  // for them above the fade band, whatever the level's hysteresis, so zooming either way crosses the same blend.
  const footprint = o.appearance.style === 'silhouette',
    shown: BuildingsShownInput = { view, lod, mpp, footprint, diagnostic: o.appearance.diagnostic, buildingsVisible: o.buildingsVisible && !!o.buildings, farTown: o.farTown, houseRenderer: !!o.renderer };
  const farTown = farTownShown(shown);
  if (o.buildings && buildingsShown(shown)) {
    const colors = buildingColors(o.appearance.colors, o.appearance.ambience);
    if (o.renderer && view === 'buildings' && !footprint) {
      stats.pending = o.renderer.draw(ctx, { viewport, metresPerPixel: mpp, appearance: o.appearance, selectedId: o.selectedBuilding }).rasterTilesPending > 0;
    } else {
      const body: BuildingFrame = { view, palette, footprint, diagnostic: o.appearance.diagnostic, colors },
        roofs = o.buildings.roofs,
        pans = !!roofs && roofPansShown(shown);
      if (roofs && pans) {
        let paths = roofShadowPaths.get(roofs);
        if (!paths) roofShadowPaths.set(roofs, (paths = []));
        ctx.fillStyle = castShadowFill(palette, night, o.buildings.items[0]?.snowAltitude);
        let cast = 0;
        for (const i of o.buildings.bins.query(viewport)) {
          let path = paths[i];
          if (!path) {
            path = paths[i] = new Path2D();
            for (const s of roofs.shadows[i] ?? []) path.addPath(shapePath(s));
          }
          ctx.fill(path);
          if (++cast % SHADOW_STEP === 0) yield;
        }
        yield;
      }
      for (const i of o.buildings.bins.query(viewport)) {
        const b = o.buildings.items[i];
        stats.buildings++;
        const made = buildingBody(body, b, !!roofs),
          style: Style = { fill: made.fill, stroke: made.stroke, width: px(made.widthPx) };
        if (footprint) {
          if (!b.footprintPath) {
            b.footprintPath = new Path2D();
            for (const s of b.footprint ?? b.building.footprint) b.footprintPath.addPath(shapePath(s));
          }
          batch.add(style, b.footprintPath);
        } else {
          if (!b.path) {
            b.path = new Path2D();
            for (const s of b.surface) b.path.addPath(shapePath(s));
          }
          batch.add(style, b.path);
        }
      }
      yield;
      yield* batch.flushSteps(ctx);
      if (pans) yield* drawPlanRoofsSteps(ctx, o.buildings, o, tex);
      yield;
      if (footprint && !parchment) {
        ctx.strokeStyle = buildingEdgeInk(colors, false, false);
        ctx.lineWidth = px(FOOTPRINT_EDGE_PX);
        for (const i of o.buildings.bins.query(viewport)) if (o.buildings.items[i].footprintPath) ctx.stroke(o.buildings.items[i].footprintPath!);
      }
      if (footprint) for (const i of o.buildings.bins.query(viewport)) drawRuinPlan(ctx, o.buildings.items[i].ruins ?? [], mpp);
      const selected = o.selectedBuilding === undefined ? undefined : o.buildings.byId.get(o.selectedBuilding);
      const selectedPath = selected === undefined ? undefined : footprint ? o.buildings.items[selected].footprintPath : o.buildings.items[selected].path;
      if (selectedPath) {
        ctx.strokeStyle = SELECTION.stroke!;
        ctx.lineWidth = px(SELECTION.widthPx!);
        ctx.stroke(selectedPath);
      }
    }
  }
  if (farTown) drawFarTown(ctx, scene, o.farBuildings ?? o.buildings!, { viewport, mpp, dpr: o.dpr, palette, night, custom: o.colors?.building, alpha: farTownAlpha(mpp), onReady: o.onTexturesReady });

  if ((o.appearance.lightsOn ?? night) && o.appearance.diagnostic === 'none') {
    if (!o.deferNightTown) drawNightTown(ctx, scene, viewport, mpp, parchment, layers.streets);
    if (o.buildingsVisible && o.buildings)
      drawNightBuildings(
        ctx,
        o.buildings.items.map(b => b.building),
        viewport,
        mpp,
        parchment,
      );
  }

  // Diagnostics of the plan.
  if (atLeast(lod, 'near')) {
    const access: Record<string, string> = { public: '#26815d', collective: '#456fba', private: '#aa6dad', unserved: '#cc383c', reserved: '#81725b', attached: '#91a36d' };
    if (layers.parcelOverlay !== false && (layers.fronts || layers.axes || layers.access))
      for (const i of scene.bins.parcels.query(viewport)) {
        const p = scene.parcels[i],
          parcel = p.source;
        if (layers.fronts && parcel.front) batch.add({ stroke: '#a92d34', width: lineW * 2 }, linePath(parcel.front));
        if (layers.access && parcel.access) {
          const c = access[parcel.access.kind];
          batch.add({ fill: c, alpha: 0.25 }, pathOf(p));
          batch.add({ stroke: c, width: lineW * 1.5 }, pathOf(p));
        }
        if (layers.axes && parcel.shape.outer.length) {
          const c = centroid([parcel.shape]);
          if (c)
            batch.add(
              { stroke: '#396781', width: lineW },
              linePath([
                { x: c.x - parcel.axis.x * 4, y: c.y - parcel.axis.y * 4 },
                { x: c.x + parcel.axis.x * 4, y: c.y + parcel.axis.y * 4 },
              ]),
            );
        }
      }
    if (layers.parcelOverlay !== false && layers.planLines !== false && o.refusedParcels?.size)
      for (const i of scene.bins.parcels.query(viewport)) {
        const p = scene.parcels[i];
        if (p.id && o.refusedParcels.has(p.id)) batch.add({ stroke: REFUSED_PARCEL.stroke, width: px(REFUSED_PARCEL.widthPx!), dash: REFUSED_PARCEL.dashPx!.map(px) }, pathOf(p));
      }
  }
  for (const layout of scene.layouts) {
    if (layers.reserve) for (const s of (layout.structure?.reserve ?? []).flatMap(shape => scene.ground?.clip(shape) ?? [shape])) (batch.add({ fill: '#6a8eb1', alpha: 0.08 }, shapePath(s)), batch.add({ stroke: '#416784', width: lineW * 2, dash: [px(7), px(4)] }, shapePath(s)));
    if (layers.allocated) for (const s of (layout.structure?.allocated ?? []).flatMap(shape => scene.ground?.clip(shape) ?? [shape])) (batch.add({ fill: '#c0a366', alpha: 0.12 }, shapePath(s)), batch.add({ stroke: '#8a632d', width: lineW * 2 }, shapePath(s)));
    if (layers.quarters) layout.quarters.forEach((q, i) => batch.add({ stroke: palette === 'atlas' ? ATLAS[i % ATLAS.length] : parchment ? PARCH.ink : growthColor(q.zone ?? 'core'), width: lineW * 2, dash: [px(4), px(3)] }, shapePath(q.shape)));
  }
  if (o.selectedParcel !== undefined && scene.parcels[o.selectedParcel]) batch.add({ stroke: SELECTION.stroke, width: px(SELECTION.widthPx!) }, pathOf(scene.parcels[o.selectedParcel]));
  batch.flush(ctx);

  // Screen-space marks: landmarks, district names, centres.
  if (o.labels === false) {
    stats.ms = performance.now() - start;
    return stats;
  }
  ctx.save();
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  const screen = (p: Point): Point => ({ x: (p.x - viewport.minX) / mpp, y: (p.y - viewport.minY) / mpp });
  const text = o.text ?? DEFAULT_TEXT,
    pal = o.textPalette ?? PALETTES.parchment;
  const labels = cityTextLabels(scene, text, pal);
  const w = (viewport.maxX - viewport.minX) / mpp,
    h = (viewport.maxY - viewport.minY) / mpp;
  const placed = placeMapLabels(labels, { cx: (viewport.minX + viewport.maxX) / 2, cy: (viewport.minY + viewport.maxY) / 2, scale: 1 / mpp }, w, h, (t, size, st) => measureTextCached(ctx, t, size, st, textFamily(text, pal)), textPlacement(text));
  drawMapLabels(ctx, placed, pal, textFamily(text, pal));
  if (text.visible && text.groups.city && layers.centers)
    for (const layout of scene.layouts)
      for (const c of layout.structure?.centers ?? []) {
        const s = screen(c.point);
        ctx.strokeStyle = '#a43526';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - 5, s.y);
        ctx.lineTo(s.x + 5, s.y);
        ctx.moveTo(s.x, s.y - 5);
        ctx.lineTo(s.x, s.y + 5);
        ctx.stroke();
      }
  ctx.restore();
  stats.ms = performance.now() - start;
  return stats;
}
function stairMarks(points: readonly Point[], width: number): Path2D {
  const path = new Path2D();
  let next = 1.25;
  const half = Math.min(2, width) * 0.48;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    for (; next < length; next += 2.5) {
      const x = a.x + (dx * next) / length,
        y = a.y + (dy * next) / length;
      path.moveTo(x - (dy * half) / length, y + (dx * half) / length);
      path.lineTo(x + (dy * half) / length, y - (dx * half) / length);
    }
    next -= length;
  }
  return path;
}
/** Small vector glyphs: no font dependency in headless or offline browsers. */
export function landmarkGlyph(ctx: CanvasRenderingContext2D, family: string, x: number, y: number, size = 7): void {
  const color = BUILDING_FAMILIES[family]?.color ?? '#3d3226';
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#fbf6ea';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, size + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const s = size * 0.62;
  switch (family) {
    case 'worship':
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.moveTo(-s * 0.6, -s * 0.35);
      ctx.lineTo(s * 0.6, -s * 0.35);
      ctx.stroke();
      break;
    case 'defence':
      ctx.fillRect(-s * 0.7, -s * 0.4, s * 1.4, s * 1.2);
      for (const dx of [-0.7, -0.1, 0.5]) ctx.fillRect(dx * s, -s * 0.8, s * 0.3, s * 0.45);
      break;
    case 'civic':
      ctx.moveTo(-s, -s * 0.15);
      ctx.lineTo(0, -s * 0.85);
      ctx.lineTo(s, -s * 0.15);
      ctx.fill();
      ctx.fillRect(-s * 0.75, -s * 0.05, s * 1.5, s * 0.85);
      break;
    case 'commerce':
      ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'craft':
      ctx.moveTo(0, -s * 0.8);
      ctx.lineTo(s * 0.8, 0);
      ctx.lineTo(0, s * 0.8);
      ctx.lineTo(-s * 0.8, 0);
      ctx.fill();
      break;
    case 'garden':
      ctx.arc(0, -s * 0.2, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-s * 0.1, 0, s * 0.2, s * 0.8);
      break;
    default:
      ctx.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
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
  ctx.clearRect(0, 0, w, top);
  if (h > top) ctx.clearRect(0, top, w, h - top);
}
export interface CityCanvasFrame {
  viewport: Box;
  mpp: number;
  dpr: number;
}
/** A viewport-sized canvas inside the map SVG (foreignObject), so it keeps the
 * SVG stacking order: under roads and markers, above the map background. */
export class CityCanvasLayer {
  readonly canvas = document.createElement('canvas');
  private host: SVGForeignObjectElement;
  private frame = 0;
  constructor(
    private readonly map: SVGSVGElement,
    parent: Element,
    private readonly paint: (ctx: CanvasRenderingContext2D, frame: CityCanvasFrame) => boolean,
  ) {
    this.host = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    this.host.addEventListener('illustration:capture', () => this.draw());
    this.host.dataset.cityCanvas = '';
    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'none';
    this.host.append(this.canvas);
    this.attach(parent);
  }
  attach(parent: Element): void {
    if (this.host.parentNode !== parent) parent.append(this.host);
  }
  request(): void {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
  }
  draw(): void {
    const box = this.map.viewBox.baseVal,
      rect = this.map.getBoundingClientRect(),
      ctx = this.canvas.getContext('2d');
    if (!ctx || !box || !(box.width > 0) || !(rect.width > 0) || !(rect.height > 0)) return;
    const dpr = window.devicePixelRatio || 1,
      w = Math.max(1, Math.round(rect.width * dpr)),
      h = Math.max(1, Math.round(rect.height * dpr));
    for (const [key, value] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height })) this.host.setAttribute(key, String(value));
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    clearCanvas2d(ctx, w, h);
    const k = w / box.width;
    ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
    const more = this.paint(ctx, { viewport: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height }, mpp: box.width / rect.width, dpr });
    if (more) this.request();
  }
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.host.remove();
  }
}
