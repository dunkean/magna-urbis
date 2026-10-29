/** City Bench map layer: one viewport-sized Canvas 2D in world coordinates.
 * The plan is indexed once in spatial bins; every camera change repaints only
 * the visible items, batched by style, with a level of detail chosen from the
 * metres per pixel. Geometry is never altered: each level draws the same plan. */
import type { Layout, Parcel, Partition, Point, Quay, Shape, Street } from '../../../rust/bridge/urban';
import type { Surface } from '../../../rust/bridge/housesContract';
import type { PlacementBatch, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import { urbanFunctionColor, type UrbanBuildingAppearance } from './urbanBuildingStyle';
import { roleLabel } from './cityRoles';
import { MATERIALS, coverLayer, layerExtent, layerPattern, materialImagesNow, placeLayer, streetLayer, wallStoneLayer, type MaterialImages } from './buildingMaterials';
import { planBuildingColors, planRoofColor } from './cityBuildingPalette';
import { cityWallDetails, drawCityWallGround, drawCityWalls } from './cityWalls'; // walls hook (cityWalls.ts)
import { STRUCTURE_ROLES, blendLine, blendTone, blendsGround, groundWash, isBlended, softStreet, type WashKind } from './groundBlend';
import { CityGround, boardwalkWidth, isBoardwalk, type CityGroundRaster } from './cityGround';
import { buildingRoof, pieceShadows, pieceVolumes, readMassing, stiltDeck, stiltSupports, roofLight as roofLight3 } from './cityMassing';
import { drawGardenDetails } from './readableGardens';
import { polygonCentroid as shapeRingCenter } from '../gen/core/geom';

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export type CityView = 'tissue' | 'uses' | 'parcels' | 'buildings' | 'roles';
export type CityLod = 'far' | 'mid' | 'near' | 'close';
export type CityPalette = 'growth' | 'atlas' | 'ink' | 'terrain' | 'parchment';
export interface CityLayers { reserve: boolean; allocated: boolean; centers: boolean; domains: boolean; quarters: boolean; blocks: boolean; streets: boolean; enclosures: boolean; parcels: boolean; gardens: boolean; places: boolean; fronts: boolean; axes: boolean; access: boolean }

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
export const DISTRICT_ROLES: Record<string, { label: string; color: string }> = {
  civic: { label: 'Civique', color: '#d9a55b' }, market: { label: 'Marché', color: '#e8c35f' }, religious: { label: 'Religieux', color: '#b79bd1' },
  craft: { label: 'Artisanat', color: '#cf9270' }, port: { label: 'Port', color: '#7eb2cc' }, elite: { label: 'Notables', color: '#d98c8c' },
  commoner: { label: 'Commun', color: '#dccaa2' }, poor: { label: 'Pauvre', color: '#b9ae98' }, garrison: { label: 'Garnison', color: '#919c89' },
  gardens: { label: 'Jardins', color: '#a6c28a' }, foreign: { label: 'Étrangers', color: '#9cc6b6' },
};
export const BUILDING_FAMILIES: Record<string, { label: string; color: string }> = {
  worship: { label: 'Culte', color: '#7a54a8' }, commerce: { label: 'Commerce', color: '#c8862a' }, craft: { label: 'Artisanat', color: '#a2513a' },
  civic: { label: 'Civique', color: '#356fa3' }, defence: { label: 'Défense', color: '#4a505b' }, dwelling: { label: 'Habitat', color: '#8b7761' },
  garden: { label: 'Jardin', color: '#5c9a4b' },
};
const SPECIALITIES: Record<string, string> = { tanners: 'tanneurs', dyers: 'teinturiers', smiths: 'forgerons', potters: 'potiers', weavers: 'tisserands', butchers: 'bouchers', masons: 'maçons', millers: 'meuniers', fishers: 'pêcheurs', boatmen: 'bateliers', merchants: 'marchands', clergy: 'clergé' };
/** District role id (`craft:tanners` → craft) and its French label with speciality. */
export const districtRoleKey = (role?: string): string | undefined => role?.split(/[.:/]/)[0]?.toLowerCase() || undefined;
export function districtRoleLabel(role: string, label?: string): string {
  if (label) return label;
  const [head, tail] = role.split(/[.:/]/), base = DISTRICT_ROLES[head?.toLowerCase()]?.label ?? head;
  return tail ? `${base} · ${SPECIALITIES[tail] ?? tail.replace(/[-_]/g, ' ')}` : base;
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
/** French name of a landmark role (`label` from Rust wins); never a raw id tail such as « friday ». */
export const landmarkName = (role?: string, fallback = 'Monument', label?: string): string => label || (role ? roleLabel(role) : fallback);

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
  bins: { blocks: SpatialBins; parcels: SpatialBins; streets: SpatialBins; landmarks: SpatialBins };
  parcelById: Map<string, number>;
}
export interface CityBuilding { stilts?: boolean; id: string; surface: Surface; fn: string; family: string; role?: string; landmark: boolean; parcel?: number; building: PlacedBuilding; material?: { culture: string; wall: string; cover: string; tone: number }; path?: Path2D }
/** Roof pans of the massing (cityMassing.ts): one polygon per sloped face, its
 * building and its light; height shadows per building (sun from the north-west). */
/** `dir`: downslope direction of each pan in plan (radians, atan2 of the face normal's horizontal part; 0 when flat). */
export interface CityRoofs { shapes: Shape[]; owner: Uint32Array; light: Float32Array; cover: string[]; wall?: string[]; tone: Float32Array; dir: Float32Array; shadows: Shape[][] }
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
      blocks.push({ layout: li, index: bi, shape: block.shape, ground: ground?.clip(block.shape), kind: block.kind, zone: z.zone, phase: z.phase, quarter: block.quarter, district, peripheral: z.peripheral });
      if (district && !block.kind.startsWith('reserve')) districtShapes.get(district)!.push(block.shape);
      grow(extent, block.shape.outer);
    });
    for (const [district, shapes] of districtShapes) district.anchor = centroid(shapes);
    footprint.push(...(layout.structure?.allocated?.length ? layout.structure.allocated : layout.quarters.map(q => q.shape)).flatMap(s => ground?.clip(s) ?? [s]));
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
      parcels.push({ layout: li, index: pi, shape: parcel.shape, ground: ground?.clip(parcel.shape), use: parcel.use, block: parcel.block, zone: z.zone, id: parcel.id, allocation, district: block && byQuarter.get(block.quarter), peripheral: z.peripheral, source: parcel });
      if (parcel.id) parcelById.set(parcel.id, index);
      if (allocation?.landmark || parcel.use === 'market') {
        const point = centroid([parcel.shape]);
        if (point) landmarks.push({ point, parcel: index, box: { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y },
          family: parcel.use === 'market' && !allocation?.role ? 'commerce' : roleFamily(allocation?.role, allocation?.function), label: landmarkName(allocation?.role, parcel.use === 'market' ? 'Marché' : 'Monument', allocation?.label) });
      }
    });
  });
  return { layouts, blocks, parcels, streets, walls, districts, landmarks, footprint, extent, parcelById, quays, ground,
    bins: { blocks: new SpatialBins(blocks.map(b => shapeBox(b.shape)), 128), parcels: new SpatialBins(parcels.map(p => shapeBox(p.shape)), 64),
      streets: new SpatialBins(streets.map(s => grow({ ...EMPTY }, s.street.path, s.width)), 128), landmarks: new SpatialBins(landmarks.map(l => l.box), 128) } };
}

/** Buildings of a scene, linked to their parcel allocation for roles. */
export function buildCityBuildings(batch: Pick<PlacementBatch, 'buildings'> | undefined, plan?: CityScene): CityBuildings {
  const items: CityBuilding[] = [], byId = new Map<string, number>();
  const roofShapes: Shape[] = [], roofOwner: number[] = [], roofLight: number[] = [], roofCover: string[] = [], roofWall: string[] = [], roofTone: number[] = [], roofDir: number[] = [], shadows: Shape[][] = [];
  for (const building of batch?.buildings ?? []) {
    let surface = building.roof_footprint.length ? building.roof_footprint : building.footprint;
    if (!surface.length) continue;
    const programme = (building as PlacedBuilding & { programme?: AllocationContract }).programme;
    const parcel = plan?.parcelById.get(building.parcel_id), allocation = parcel === undefined ? undefined : plan!.parcels[parcel].allocation;
    const massing = readMassing(programme, building.footprint, building.id), first = massing?.[0] && pieceVolumes(building.footprint[0], massing[0])[0];
    if (massing) {
      const volumes = building.footprint.flatMap((shape, i) => pieceVolumes(shape, massing[i]));
      if (volumes.some(v => v.detail?.stilts_m || ['tree', 'mushroom', 'yurt', 'tower'].includes(v.detail?.form ?? ''))) surface = volumes.flatMap(v => v.detail?.stilts_m
        ? [{ ...v.shape, outer: stiltDeck(v.shape.outer) }, ...stiltSupports(v.shape.outer).map(p => ({ outer: [{ x: p.x - 0.16, y: p.y - 0.16 }, { x: p.x + 0.16, y: p.y - 0.16 }, { x: p.x + 0.16, y: p.y + 0.16 }, { x: p.x - 0.16, y: p.y + 0.16 }], holes: [] }))]
        : [v.shape]);
    }
    const culture = building.culture?.culture || allocation?.culture || (parcel === undefined ? '' : plan?.layouts[plan.parcels[parcel].layout]?.culture) || '';
    byId.set(building.id, items.length);
    items.push({ id: building.id, surface, fn: building.function, role: programme?.role ?? allocation?.role, family: roleFamily(programme?.role ?? allocation?.role, building.function),
      landmark: programme?.landmark === true || allocation?.landmark === true, parcel, building,
      stilts: massing?.some((m, i) => pieceVolumes(building.footprint[i], m).some(v => (v.detail?.stilts_m ?? 0) > 0)),
      material: { culture, wall: first?.wall ?? '', cover: first?.cover ?? '', tone: first?.tone ?? 0.5 } });
    if (!massing) { shadows.push([]); continue; }
    const owner = items.length - 1;
    for (const face of buildingRoof(building.footprint, massing)) {
      if (face.normal[2] < 0.08 || face.points.length < 3) continue; // gable ends and walls are edge-on from above
      roofShapes.push({ outer: face.points.map(p => ({ x: p.x, y: p.y })), holes: [] }); roofOwner.push(owner); roofLight.push(roofLight3(face.normal)); roofCover.push(face.cover); roofWall.push(face.wall); roofTone.push(face.tone); roofDir.push(Math.hypot(face.normal[0], face.normal[1]) > 1e-3 ? Math.atan2(face.normal[1], face.normal[0]) : 0);
    }
    shadows.push(building.footprint.flatMap((shape, i) => massing[i] ? pieceShadows(shape, massing[i]) : []));
  }
  const roofs = roofShapes.length ? { shapes: roofShapes, owner: Uint32Array.from(roofOwner), light: Float32Array.from(roofLight), cover: roofCover, wall: roofWall, tone: Float32Array.from(roofTone), dir: Float32Array.from(roofDir), shadows } : undefined;
  return { items, byId, bins: new SpatialBins(items.map(b => surfaceBox(b.surface)), 64), ...(roofs ? { roofs } : {}) };
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
  readableGardens?: boolean;
  /** Names, landmark glyphs and centre pins; omitted keeps the normal map. */
  labels?: boolean;
  viewport: Box; mpp: number; dpr: number; lod: CityLod; view: CityView; palette: CityPalette; width: number; layers: CityLayers;
  buildings?: CityBuildings; buildingsVisible: boolean; renderer?: CityBuildingRenderer; appearance: UrbanBuildingAppearance;
  selectedBuilding?: string; selectedParcel?: number; refusedParcels?: ReadonlySet<string>;
  /** Textured materials (PBR patterns in world metres) on roofs, streets, plazas and walls; `onTexturesReady` asks for a redraw once the atlases are loaded. */
  textured?: boolean; onTexturesReady?: () => void;
  /** Blended ground and streets (groundBlend.ts): translucent washes, no outlines or casings. Default: the shared setting. */
  groundBlend?: boolean;
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
  garden: '#d3cf98', place: '#ece0bf', market: '#e8d6a6', common: '#cdd097', reserve: '#d8c79a', footprint: '#d9c393',
  street: '#f4ead0', streetEdge: '#3f2f1f', bridge: '#f6edd0', ford: '#bccbc8', quay: '#e9dfc4',
  mass: '#4a3826', landmark: '#7d5f40', wall: '#3b2c1c', wallFill: '#6b5540', tower: '#4e3b28',
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
const STREET_MIN_PX = [3, 2.4, 1.6, 1.1, 0.8];
const CROSSINGS = new Set(['bridge', 'causeway', 'ford', 'pier', 'boardwalk', 'walkway']);
function streetPaint(role: string, rank: number, palette: CityPalette): { fill: string; casing: string; dash?: boolean } {
  if (role === 'track') { const ink = palette === 'ink' ? '#776348' : '#a58e65'; return { fill: ink, casing: ink }; }
  if (palette === 'ink') return { fill: '#6b5640', casing: '#3c3024' };
  if (isBoardwalk(role)) return { fill: '#b49a6d', casing: '#514431' };
  if (palette === 'parchment') return role === 'ford' ? { fill: PARCH.ford, casing: PARCH.ink, dash: true }
    : role === 'bridge' ? { fill: PARCH.bridge, casing: PARCH.wall } : role === 'quay' ? { fill: PARCH.quay, casing: PARCH.ink }
    : { fill: PARCH.street, casing: PARCH.streetEdge };
  switch (role) {
    case 'bridge': return { fill: '#ddd3c2', casing: '#4d4740' };
    case 'causeway': return { fill: '#dccaa0', casing: '#76664f' };
    case 'ford': return { fill: '#b9d0d6', casing: '#6f8f9a', dash: true };
    case 'quay': return { fill: '#ddd4c2', casing: '#57534b' };
    case 'port-stairs': case 'stairs': return { fill: '#e6d5b2', casing: '#705d45' };
    case 'market': return { fill: '#f5d98f', casing: '#9a7d4f' };
    case 'collective': return { fill: '#ccdacf', casing: '#8a9a8d' };
    case 'private': return { fill: '#d9cddf', casing: '#9a8ca1' };
    default: return { fill: rank <= 1 ? '#f6e3b8' : '#f3dfb3', casing: rank <= 1 ? '#7d6648' : '#9c8664' };
  }
}

const roofIndex = new WeakMap<CityRoofs, { byOwner: number[][]; paths: (Path2D | undefined)[] }>();
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
/** Same massing faces and shared tint as the GPU path, with optional material grain. */
function drawPlanRoofs(ctx: CanvasRenderingContext2D, b: CityBuildings, o: CityDrawOptions, images?: MaterialImages): void {
  const roofs = b.roofs!;
  let index = roofIndex.get(roofs);
  if (!index) { const byOwner: number[][] = b.items.map(() => []); roofs.owner.forEach((ow, k) => byOwner[ow]?.push(k)); roofIndex.set(roofs, index = { byOwner, paths: [] }); }
  for (const i of b.bins.query(o.viewport)) for (const k of index.byOwner[i] ?? []) {
    const path = index.paths[k] ??= shapePath(roofs.shapes[k]);
    ctx.fillStyle = planRoofColor(b.items[i], roofs, k, o.palette); ctx.fill(path);
    const layer = coverLayer(roofs.cover[k]), grain = images && layer >= 0 ? roofGrainPattern(ctx, images, layer, (roofs.dir[k] ?? 0) - Math.PI / 2) : undefined;
    if (grain) { ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = grain; ctx.fill(path); ctx.restore(); }
    if (o.lod === 'close') { ctx.strokeStyle = o.palette === 'parchment' ? 'rgba(63,47,31,0.35)' : 'rgba(31,24,17,0.5)'; ctx.lineWidth = (o.palette === 'parchment' ? 0.3 : 0.5) * o.mpp; ctx.stroke(path); }
  }
}

/** Paint the visible plan into a context already set to world coordinates. */
export function drawCity(ctx: CanvasRenderingContext2D, scene: CityScene, o: CityDrawOptions): CityFrameStats {
  const start = performance.now(), { viewport, mpp, lod, view, palette, layers } = o, px = (n: number): number => n * mpp;
  // Textured materials: repeating patterns anchored to world metres (ink and parchment keep their own look).
  const tex = o.textured && palette !== 'parchment' && palette !== 'ink' ? materialImagesNow(o.onTexturesReady) : undefined;
  const pat = (layer: number): CanvasPattern | undefined => tex ? layerPattern(ctx, tex, layer) ?? undefined : undefined;
  const plaza = (use: string, color: string | undefined): string | CanvasPattern | undefined => color && tex && (use === 'place' || use === 'market') ? pat(placeLayer()) ?? color : color;
  const stats: CityFrameStats = { lod, blocks: 0, parcels: 0, streets: 0, buildings: 0, ms: 0, pending: false };
  const parchment = palette === 'parchment', batch = new Batches(), outline = palette === 'ink' ? '#3c3024' : parchment ? PARCH.inkSoft : '#655847', lineW = px(Math.max(0.2, o.width));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const pathOf = <T extends { path?: Path2D; shape: Shape; ground?: Shape[]; groundPath?: Path2D }>(item: T): Path2D => {
    if (!item.ground) return item.path ??= shapePath(item.shape);
    if (!item.groundPath) { item.groundPath = new Path2D(); for (const s of item.ground) item.groundPath.addPath(shapePath(s)); }
    return item.groundPath;
  };
  const growthColor = (zone: string): string => ZONE_COLORS[zone] ?? ZONE_COLORS.core;

  // Far: the urban footprint as one tint, main roads and walls.
  const blend = (o.groundBlend ?? isBlended()) && blendsGround(view, palette), tone = blendTone(palette), softLine = blendLine(tone);
  if (lod === 'far') {
    if (blend && layers.blocks) { const w = groundWash('footprint', tone); for (const shape of scene.footprint) if (overlaps(shapeBox(shape), viewport)) batch.add({ fill: w.color, alpha: w.alpha }, shapePath(shape)); }
    else if (layers.blocks) for (const shape of scene.footprint) if (overlaps(shapeBox(shape), viewport)) batch.add({ fill: palette === 'terrain' ? undefined : parchment ? PARCH.footprint : '#cfb589', stroke: parchment ? PARCH.ink : '#7b6446', width: px(1), alpha: 0.9 }, shapePath(shape));
    if (parchment && layers.blocks && !blend) { const hatch = hatchPattern(ctx, mpp); if (hatch) for (const shape of scene.footprint) if (overlaps(shapeBox(shape), viewport)) batch.add({ fill: hatch }, shapePath(shape)); }
    batch.flush(ctx);
  } else {
    // Blocks: palette, district role, or the ground under buildings.
    if (layers.blocks || layers.domains) for (const i of scene.bins.blocks.query(viewport)) {
      const b = scene.blocks[i], reserve = b.kind.startsWith('reserve');
      if (reserve ? !layers.domains : !layers.blocks) continue;
      stats.blocks++;
      let fill: string | undefined;
      if (palette === 'terrain' && view !== 'roles') fill = undefined;
      else if (reserve) fill = parchment ? PARCH.reserve : '#cbc2a8';
      else if (b.kind === 'common') fill = parchment ? PARCH.common : '#adc5bf';
      else if (b.kind === 'place') fill = parchment ? PARCH.place : '#e8d6ae';
      else if (view === 'roles') fill = districtColor(b.district, growthColor(b.zone));
      else if (view === 'buildings') fill = parchment ? PARCH.yard : lod === 'mid' ? mix(districtColor(b.district, growthColor(b.zone)), PAPER, 0.35) : '#ece2cb';
      else if (palette === 'ink') fill = '#e3d1b5';
      else if (parchment) fill = PARCH.block;
      else fill = palette === 'atlas' ? ATLAS[b.quarter % ATLAS.length] : growthColor(b.zone);
      const stroke = view === 'buildings' && lod !== 'close' ? undefined : outline;
      if (blend && fill) {
        // Blended: one translucent wash (a wider low-alpha stroke of the same colour feathers the edge), faint lot lines only up close.
        const w = groundWash(reserve ? 'reserve' : b.kind === 'common' ? 'common' : b.kind === 'place' ? 'place' : 'block', tone), a = w.alpha * (b.peripheral && view !== 'buildings' ? 0.7 : 1);
        if (!tex || !(b.kind === 'place' || b.kind === 'market')) batch.add({ stroke: w.color, width: px(2.2), alpha: a * 0.4, cap: 'round' }, pathOf(b));
        batch.add({ fill: plaza(b.kind, w.color), alpha: a }, pathOf(b));
        if (lod === 'close') batch.add({ stroke: softLine.color, width: px(0.5), alpha: softLine.alpha }, pathOf(b));
        continue;
      }
      batch.add({ fill: plaza(b.kind, fill), stroke, width: lineW, alpha: b.peripheral && view !== 'buildings' ? 0.6 : 1, dash: reserve ? [px(3), px(2)] : undefined }, pathOf(b));
      // Parchment: built blocks hatched in ink, as on the engraved plans.
      if (parchment && !blend && !reserve && b.kind !== 'common' && b.kind !== 'place' && view !== 'roles') { const hatch = hatchPattern(ctx, mpp); if (hatch) batch.add({ fill: hatch, alpha: view === 'buildings' ? 0.5 : 1 }, pathOf(b)); }
    }
    batch.flush(ctx);
    // Parcels: cadastral detail from near; uses and roles from mid.
    const parcelLevel = view === 'uses' || view === 'roles' ? 'mid' : 'near';
    if (atLeast(lod, parcelLevel) && view !== 'tissue') for (const i of scene.bins.parcels.query(viewport)) {
      const p = scene.parcels[i], use = p.use;
      const built = ['plot', 'compound', 'residual', 'court'].includes(use), open = ['place', 'market', 'common'].includes(use);
      if (!(built && layers.parcels || use === 'garden' && layers.gardens || open && layers.places || use === 'reserve' && layers.domains)) continue;
      stats.parcels++;
      const openFill = parchment ? (use === 'garden' ? PARCH.garden : use === 'reserve' ? PARCH.reserve : use === 'common' ? PARCH.common : use === 'market' ? PARCH.market : use === 'place' ? PARCH.place : undefined)
        : use === 'garden' ? '#a8bc89' : use === 'reserve' ? '#cbc2a8' : use === 'common' ? '#adc5bf' : use === 'market' ? '#ead39a' : use === 'place' ? '#e6d1a5' : undefined;
      if (blend && (view === 'parcels' || view === 'buildings')) {
        const kind: WashKind = use === 'garden' ? 'garden' : use === 'reserve' ? 'reserve' : use === 'common' ? 'common' : use === 'market' ? 'market' : use === 'place' ? 'place' : 'parcel';
        const w = groundWash(kind, tone), a = w.alpha * (p.peripheral ? 0.7 : 1), ground = kind === 'parcel' || kind === 'reserve';
        // Plain lots add no wash over the block's (the buildings stand on it); gardens, commons and squares stack theirs.
        if (!(view === 'buildings' && ground)) batch.add({ fill: plaza(use, w.color), alpha: a }, pathOf(p));
        if (lod === 'close') batch.add({ stroke: softLine.color, width: px(0.5), alpha: softLine.alpha * (ground ? 0.8 : 1) }, pathOf(p));
      } else if (view === 'parcels') {
        const fill = palette === 'terrain' ? undefined : palette === 'ink' ? '#eee0c9' : parchment ? openFill ?? PARCH.lot : openFill ?? (palette === 'atlas' ? ATLAS[p.index % ATLAS.length] : growthColor(p.zone));
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
        if (openFill) batch.add({ fill: plaza(use, openFill), stroke: lod === 'close' ? parchment ? PARCH.inkSoft : '#b9a98d' : undefined, width: px(0.6), alpha: parchment && lod === 'close' ? 0.9 : 1 }, pathOf(p));
        else if (lod === 'close') batch.add({ stroke: parchment ? PARCH.inkSoft : '#c4b597', width: px(0.6), alpha: parchment ? 0.45 : 1 }, pathOf(p));
      }
    }
    batch.flush(ctx);
  }

  if (o.readableGardens && (lod === 'near' || lod === 'close') && view !== 'tissue') {
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
    ctx.fillStyle = q.material === 'timber' ? '#b49a6d' : '#c8c0a7'; ctx.fill(path);
    ctx.strokeStyle = parchment ? PARCH.ink : '#57534b'; ctx.lineWidth = px(0.9); ctx.stroke(path);
  }

  if (layers.enclosures) drawCityWallGround(ctx, scene, { viewport, mpp, lod, palette }); // walls hook: ditches and glacis under the streets
  // Streets: centrelines stroked by rank, casing first, majors and crossings on top.
  if (layers.streets) {
    const maxRank = lod === 'far' ? 1 : lod === 'mid' ? 2 : 9;
    const visible = scene.bins.streets.query(viewport).map(i => scene.streets[i]).filter(s => s.rank <= maxRank || CROSSINGS.has(s.role));
    const order = (s: CityStreet): number => CROSSINGS.has(s.role) ? -1 : s.rank;
    visible.sort((a, b) => order(b) - order(a));
    const casing = new Batches(), fill = new Batches(), marks = new Batches(), softStreets = (o.groundBlend ?? isBlended()) && !tex;
    for (const s of visible) {
      stats.streets++;
      const paint = streetPaint(s.role, s.rank, palette), path = s.path ??= linePath(s.street.path);
      const w = Math.max(s.width, px(isBoardwalk(s.role) ? 0.8 : STREET_MIN_PX[Math.min(4, Math.max(0, s.rank))])), w2 = Math.round(w * 4) / 4;
      if (softStreets && !STRUCTURE_ROLES.has(s.role)) {
        // Blended: earth wash at rank-decaying opacity and a faint soft edge instead of the dark casing.
        const soft = softStreet(s.role, s.rank, tone);
        if (lod !== 'far') casing.add({ stroke: soft.edge, width: w2 + 2 * px(lod === 'mid' ? 0.8 : 1.1), alpha: soft.edgeAlpha, cap: 'round' }, path);
        fill.add({ stroke: soft.fill, width: w2, alpha: soft.alpha, cap: 'round' }, path);
        continue;
      }
      const edge = s.role === 'bridge' || s.role === 'quay' ? Math.max(1.2, px(1.4)) : lod === 'far' ? 0 : px(lod === 'mid' ? 0.7 : 0.9);
      const cap = s.role === 'bridge' || s.role === 'quay' ? 'butt' : 'round';
      if (edge > 0) casing.add({ stroke: paint.casing, width: w2 + 2 * edge, dash: paint.dash ? [px(4), px(2)] : undefined, cap }, path);
      fill.add({ stroke: (tex && pat(streetLayer(s.role, s.rank))) || paint.fill, width: w2, cap }, path);
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
    casing.flush(ctx); fill.flush(ctx); marks.flush(ctx);
  }

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
    drawCityWalls(ctx, scene, { viewport, mpp, lod, palette }); // walls hook
  }

  // Buildings: native renderer (compact / detailed) or batched silhouettes.
  if (o.buildingsVisible && o.buildings && atLeast(lod, 'near') && (view === 'buildings' || view === 'roles')) {
    if (o.renderer && view === 'buildings') {
      stats.pending = o.renderer.draw(ctx, { viewport, metresPerPixel: mpp, appearance: o.appearance, selectedId: o.selectedBuilding }).rasterTilesPending > 0;
    } else {
      const edge = lod === 'close' ? { stroke: parchment ? '#f1e5c6' : '#2e261d', width: px(parchment ? 0.3 : 0.5) } : {};
      for (const i of o.buildings.bins.query(viewport)) {
        const b = o.buildings.items[i]; stats.buildings++;
        const tint = planBuildingColors(b, palette);
        const color = view === 'roles' ? BUILDING_FAMILIES[b.family]?.color ?? '#5a4b3c' : o.appearance.diagnostic === 'uses' ? urbanFunctionColor(b.fn) : o.buildings.roofs ? tint.wall : tint.roof;
        if (!b.path) { b.path = new Path2D(); for (const s of b.surface) b.path.addPath(shapePath(s)); }
        batch.add({ fill: color, ...edge, ...(b.stilts ? { stroke: '#514431', width: px(0.6) } : {}) }, b.path);
      }
      batch.flush(ctx);
      if (o.buildings.roofs && view === 'buildings' && o.appearance.diagnostic !== 'uses') drawPlanRoofs(ctx, o.buildings, o, tex);
      const selected = o.selectedBuilding === undefined ? undefined : o.buildings.byId.get(o.selectedBuilding);
      if (selected !== undefined && o.buildings.items[selected].path) { ctx.strokeStyle = '#197ea4'; ctx.lineWidth = px(2); ctx.stroke(o.buildings.items[selected].path!); }
    }
  }

  // Diagnostics of the plan.
  if (atLeast(lod, 'near')) {
    const access: Record<string, string> = { public: '#26815d', collective: '#456fba', private: '#aa6dad', unserved: '#cc383c', reserved: '#81725b', attached: '#91a36d' };
    if (layers.fronts || layers.axes || layers.access) for (const i of scene.bins.parcels.query(viewport)) {
      const p = scene.parcels[i], parcel = p.source;
      if (layers.fronts && parcel.front) batch.add({ stroke: '#a92d34', width: lineW * 2 }, linePath(parcel.front));
      if (layers.access && parcel.access) { const c = access[parcel.access.kind]; batch.add({ fill: c, alpha: 0.25 }, pathOf(p)); batch.add({ stroke: c, width: lineW * 1.5 }, pathOf(p)); }
      if (layers.axes && parcel.shape.outer.length) {
        const c = centroid([parcel.shape]); if (c) batch.add({ stroke: '#396781', width: lineW }, linePath([{ x: c.x - parcel.axis.x * 4, y: c.y - parcel.axis.y * 4 }, { x: c.x + parcel.axis.x * 4, y: c.y + parcel.axis.y * 4 }]));
      }
    }
    if (o.refusedParcels?.size) for (const i of scene.bins.parcels.query(viewport)) {
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
  const label = (text: string, p: Point, size: number, color: string, weight = 600): void => {
    ctx.font = `${weight} ${size}px Georgia, 'Times New Roman', serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(250,245,232,.9)'; ctx.strokeText(text, p.x, p.y); ctx.fillStyle = color; ctx.fillText(text, p.x, p.y);
  };
  if (lod !== 'far') for (const i of scene.bins.landmarks.query(viewport)) {
    const l = scene.landmarks[i], s = screen(l.point);
    landmarkGlyph(ctx, l.family, s.x, s.y);
    if (atLeast(lod, 'near')) label(l.label, { x: s.x, y: s.y + 13 }, 10, '#3a2f25');
  }
  if ((lod === 'mid' || lod === 'near') && (view === 'roles' || view === 'buildings' || layers.centers)) for (const d of scene.districts) {
    // Ordinary housing districts are named only from near, to keep the overview legible.
    if (!d.anchor || !(d.role || layers.centers) || lod === 'mid' && districtRoleKey(d.role) === 'commoner' && !layers.centers) continue;
    if (d.anchor.x < viewport.minX || d.anchor.x > viewport.maxX || d.anchor.y < viewport.minY || d.anchor.y > viewport.maxY) continue;
    label(d.role ? districtRoleLabel(d.role).toUpperCase() : `Q${d.id + 1}`, screen(d.anchor), lod === 'mid' ? 11 : 12, '#4a3b2c', 700);
  }
  if (layers.centers) for (const layout of scene.layouts) for (const c of layout.structure?.centers ?? []) {
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
