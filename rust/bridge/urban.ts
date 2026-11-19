import type { HousingFloorNeed } from './urbanArchitecture';
import { normalizeLayoutConfig, normalizeParcelConfig, styleSheetEmpty, type LayoutConfig, type ParcelConfig, type ProgrammeContext } from './urbanConfig';
export * from './urbanConfig';
import type { SettlementTerrain } from '../pkg/wasm/magna_urbis_wasm.js';
import { inWorker, loadCoreWasm, recoverCoreWasm, singleWasmModule, wasmThreadsInfo, type CoreWasm, type WasmThreadsInfo } from './wasmRuntime';
import { createUrbanPool, ranges, type PoolArgs, type UrbanPool } from './urbanPool';
import type { Point, RoadOutput, RoadSite, SettlementRaster } from './settlements';
import { validatePhysicalTerrain } from './settlements';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { contentType, nativeRasterClient, nativeRequest } from './nativeEngine';
import { isWholeParcelPack, packBuffer, packHeader, packOf, partitionsFromPack } from './urbanParcelPack';
export { packOf, partitionsFromPack, responsePartitions } from './urbanParcelPack';
import { validateUrbanSource, type UrbanSourceHandle } from './urbanSource';
import { digestValue, urbanCacheKey, readUrbanCache, writeUrbanCache, sha256, URBAN_CACHE_MAX_BYTES } from './urbanResultCache';
import { requiresProgrammeFunctions, requireLocalProgrammeFunctions, requireWasmProgrammeFunctions } from './urbanProgrammeSupport';
export type { UrbanSourceHandle } from './urbanSource';
export type { Point } from './settlements';

export interface Shape {
  outer: Point[];
  holes: Point[][];
}
export interface Street {
  path: Point[];
  widths: number[];
  rank: number;
  role: string;
}
export interface Quarter {
  shape: Shape;
  phase: number;
  zone?: string;
}
export interface Block {
  shape: Shape;
  quarter: number;
  kind: string;
  axis: Point;
  zone?: string;
  phase?: number;
}
export interface Enclosure {
  path: Point[];
  kind: string;
  gates: Point[];
  purpose?: 'citadel' | 'cathedral-close' | 'urban-castle' | string;
  /** Tower anchors on the curtain; towers[i] === towers_detail[i].anchor. */
  towers?: Point[];
  /** Fortification structures (Rust `urban::fortification`), all optional and snake_case. */
  style?: 'palisade' | 'gord' | 'hedge' | 'curtain' | 'flanked' | 'concentric' | 'rammed-earth' | 'wengcheng' | 'bastioned' | string;
  material?: 'timber' | 'timber-earth' | 'thorn' | 'stone' | 'brick' | 'rammed-earth' | 'earth-stone' | string;
  curtain_width_m?: number;
  height_m?: number;
  towers_detail?: { anchor: Point; center: Point; shape: 'round' | 'square' | 'd' | 'rect' | string; radius_m: number; depth_m?: number; angle: number; height_m: number; kind: 'corner' | 'flank' | 'gate' | 'water' | string; footprint: Shape }[];
  gatehouses?: { gate: number; kind: 'timber' | 'tower' | 'twin-tower' | 'bab' | 'ravelin' | 'water' | 'postern' | string; shape: Shape; masses?: Shape[]; passage: [Point, Point]; passage_width_m: number; height_m: number }[];
  bastions?: { kind: string; shape: Shape; height_m: number; passage?: [Point, Point] }[];
  outworks?: { kind: 'outer-wall' | 'barbican' | 'antemural' | 'wengcheng' | 'ravelin' | 'citadel' | 'glacis' | string; shape: Shape; height_m: number; passage?: [Point, Point] }[];
  ditch?: { kind: 'dry' | 'wet' | string; shape: Shape; height_m: number; passage?: [Point, Point] }[];
  attached?: { kind: 'lean-to' | string; side: 'out' | string; shape: Shape; height_m: number }[];
  reserve?: Shape[];
}
export interface GrowthPhase {
  culture?: string;
  kind: string;
  zone: string;
  recipe: string;
  population: number;
  targetArea: number;
  shapes: Shape[];
}
/** A harbour platform (`quay`, `landing`, `pier`, `mole`) or a piece of harbour furniture (`jetty`, `slip`, `steps`, `basin`, `boat`,
 * `mast`, `crane`, `beacon`, `post`, `cargo`, `shiphouse`…; Rust `urban::harbour_furniture`). `material` is `stone` or `timber`, a boat
 * class or a cargo kind; `deck_z_m` is one metre above the item's water level. Looks: web/src/render/harbourStyle.ts. */
export interface Quay {
  kind: string;
  shape: Shape;
  deck_z_m: number;
  material: string;
}
/** Town canal water (urban/lagoon.rs): one level per reach, bridges and lock gates over it. */
export interface Waterway {
  shape: Shape;
  levelM: number;
  crossings: Shape[];
  /** `canal` (with quays), `rio` (a lane turned to water over its whole width), `pool`, `mouth` (onto natural water), `feeder` or `basin`. */
  kind?: 'canal' | 'rio' | 'pool' | 'mouth' | 'feeder' | 'basin';
  /** 0 main canal, 1 secondary canal, 2 rio. */
  rank?: number;
  path?: Point[];
  widthM?: number;
  locks?: Shape[];
  /** Lowest ground along the piece: the 3D water lies just above it (the 3D ground is not dug). */
  bankM?: number;
}
export interface UrbanStructure {
  /** Engine-owned source data used to retain lots outside a redrawn quarter. */
  quarterBaseline?: unknown;
  waterways?: Waterway[];
  gateVillageCenters?: Point[];
  quays?: Quay[];
  portDistricts?: { district: number; role: 'port'; quarters: number[]; shapes: Shape[] }[];
  version: 1;
  mechanism: string;
  family: string;
  reserve: Shape[];
  allocated: Shape[];
  centers: { id: number; point: Point; weight: number }[];
  districts: { id: number; center: number; phase: number; tissue: string; quarters: number[]; role?: string; wealth?: number; label?: string }[];
  history: { epoch: number; kind: string; center: number; area: number }[];
  metrics: { targetArea: number; allocatedArea: number; streetArea: number; reservedArea: number; grossDensity: number; plannedPopulation: number; shortfallArea: number; components: number; accessAdded: number };
}
/** Land and edge streets a town holds (world metres), for the towns generated after it (`urban/neighbours.rs`). */
/** A placed neighbour generated after this town (canonical order): the engine keeps a core sized to its own population free. */
export interface ClaimReserve {
  population: number;
  culture: string;
  center: Point;
  radius: number;
}
export interface Claim {
  key: string;
  land: Shape[];
  streets: Street[];
  reserve?: ClaimReserve;
}
/** A site of a `quarters` request: `neighbours` are the claims of the earlier towns it must keep off and join. */
export type UrbanSite = RoadSite & { neighbours?: Claim[] };
export interface Layout {
  config?: LayoutConfig;
  programme?: UrbanProgramme;
  key: string;
  culture: string;
  center: Point;
  quarters: Quarter[];
  streets: Street[];
  blocks: Block[];
  enclosures?: Enclosure[];
  phases?: GrowthPhase[];
  archetype?: string;
  structure?: UrbanStructure;
  warnings: string[];
  claim?: Claim;
}
export interface Parcel {
  pressure?: number;
  id?: string;
  parentIds?: string[];
  provenance?: string[];
  family?: string;
  reason?: string;
  contacts?: ParcelContact[];
  envelope?: Shape;
  shape: Shape;
  block: number;
  use: 'plot' | 'garden' | 'place' | 'compound' | 'market' | 'reserve' | 'common' | 'residual' | 'court';
  front: [Point, Point] | null;
  axis: Point;
  rank: number;
  access?: { kind: 'public' | 'collective' | 'private' | 'unserved' | 'reserved' | 'attached'; street: number | null; frontLength: number };
}
export interface LotEnclosure {
  path: Point[];
  material: 'wall' | 'hedge' | 'fence';
  side: 'front' | 'side' | 'back';
}
export interface ResolvedEnclosure {
  plot: number;
  field: number;
  material: 'wall' | 'hedge' | 'fence';
  fieldMaterial: 'wall' | 'hedge' | 'fence';
  front: number;
  side: number;
  back: number;
  /** The culture draws no lot limits (catalogue `render.plotLines: false`). */ hideLotLines?: boolean;
  /** Share of the country lots (village, hamlet zones) that keep a yard; absent = 0.95. */ country?: number;
}
export interface Partition {
  enclosure?: ResolvedEnclosure;
  config?: ParcelConfig;
  programme?: UrbanProgramme;
  key: string;
  parcels: Parcel[];
  warnings: string[];
  diagnostics?: { coveredArea: number; residualArea: number; overlapArea: number; unservedArea: number };
  /** Present when structural block edits changed the input blocks: `parcels[].block` indexes `prepared.blocks`.
   * Every later stage reads the layout with `blocks = prepared.blocks` and `config.blockEdits = prepared.edits`. */
  prepared?: PreparedBlocks;
}
/** Prepared block `block` is part `part` of input block `source`; its edit key is `"<source>"` (part 0) or `"<source>/<part>"`. */
export interface BlockOrigin {
  block: number;
  source: number;
  part: number;
  deleted: boolean;
}
/** What a prepared layout replaced (Rust `BlockEdits`): the parcel stage restores it before applying the edits again. */
export interface BlockEdits {
  count: number;
  signature: string;
  originals: { index: number; block: Block }[];
  origins: BlockOrigin[];
}
export interface PreparedBlocks {
  blocks: Block[];
  edits?: BlockEdits;
}
/** Output quarter `quarter` is part `part` of source quarter `source`; its edit key is `"<source>"` (part 0) or `"<source>/<part>"`. */
export interface QuarterPart {
  quarter: number;
  source: number;
  part: number;
  deleted: boolean;
}
/** Quarter splits applied by the quarter stage (Rust `QuarterEdits`, `layout.config.quarterEdits`).
 * `count`: quarters of the plan before the splits (parts k ≥ 1 follow); `blockCount`: blocks before the splits (extra pieces follow).
 * `parts`: every output quarter of a split, part 0 included; a quarter absent here was not split. */
export interface QuarterEdits {
  count: number;
  blockCount: number;
  parts: QuarterPart[];
  originals: { index: number; shape: Shape }[];
}
export interface ParcelContact {
  a: Point;
  b: Point;
  street: number;
  rank: number;
  length: number;
  kind: string;
}
export interface UrbanAdmissibility {
  recipeId: string;
  nativeLayout: string;
  floors: [number, number];
  eras: string[];
  minFrontage: number;
  minAccessWidth: number;
  minArea: number;
  minDepth: number;
  maxSlope: number;
  sharedAccess: boolean;
  partyWalls: boolean;
}
export interface CultureMapping {
  culture: string;
  family: string;
  functionalProfile: string;
  architectureFamily: string;
  architecturePack: string;
  coverage: string;
  borrowing: string;
  admissibility: UrbanAdmissibility;
}
export interface UrbanDemand {
  id: string;
  role?: string;
  function: string;
  unit: 'domesticUnits' | 'usefulAreaM2';
  requested: number;
  targetArea: number;
  targetFrontage: number;
  provenance: string[];
  requires: string[];
  parcelCapacity: number;
  builtCapacity: number;
  openCapacity?: number;
  deficit: number;
  reasons: string[];
}
export interface UrbanAllocation {
  parcelId: string;
  demandId: string;
  role?: string;
  households?: number;
  residents?: number;
  function: string;
  culture: string;
  architecturePack: string;
  capacity: number;
  unit: 'domesticUnits' | 'usefulAreaM2';
  score: number;
  reasons: string[];
  housingFloorNeed?: HousingFloorNeed;
}
export interface UrbanProgramme {
  builtBalance?: import('./urbanBuiltBalance').BuiltOutcomeBalance;
  version: 1;
  population: number;
  context: import('./urbanConfig').ProgrammeContext;
  cultures: CultureMapping[];
  demands: UrbanDemand[];
  reservations: { id: string; demandId: string; block: number; shape: Shape; street: number; frontage: number }[];
  allocations: UrbanAllocation[];
  adjacency: { a: string; b: string; sharedLength: number }[];
  environment: { block: number; slope: number; wet: boolean; waterfront: boolean; pressure?: number }[];
  reconciliationPasses: number;
  warnings: string[];
  /** Households the domestic-admissible plots could hold (land capacity, before allocation). */
  housingCapacity?: number;
  /** Measured navigable quay frontage: the only evidence port storage is allocated against. */
  navigableFrontage?: boolean;
}
/** Include outward growth when framing a completed settlement. */
export function layoutExtent(layouts?: Layout[]): { center: Point; radius: number } | undefined {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const include = (p: Point, margin = 0): void => {
    x0 = Math.min(x0, p.x - margin);
    y0 = Math.min(y0, p.y - margin);
    x1 = Math.max(x1, p.x + margin);
    y1 = Math.max(y1, p.y + margin);
  };
  for (const layout of layouts ?? []) {
    const shapes = [...(layout.structure?.allocated ?? []), ...layout.quarters.map(q => q.shape), ...(layout.structure?.portDistricts ?? []).flatMap(d => d.shapes), ...(layout.structure?.quays ?? []).map(q => q.shape)];
    for (const shape of shapes) for (const p of shape.outer) include(p);
    for (const street of layout.streets) if (['quay', 'mole', 'pier', 'landing', 'port-street', 'port-stairs', 'port-road'].includes(street.role)) for (const p of street.path) include(p, Math.max(...street.widths, 0) / 2);
  }
  return Number.isFinite(x0) ? { center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, radius: Math.max(x1 - x0, y1 - y0) / 2 } : undefined;
}

/** Regional roads as urban streets (pure, `urbanRoads.ts`). */
export { regionalStreets } from './urbanRoads';
export interface UrbanRequest {
  id: number;
  seed: string;
  kind: 'quarters' | 'parcels' | 'programme' | 'buildingSites' | 'builtCapacity';
  /** Native parcels: `handle` returns only the retained source, the programme continues on the engine's parcels. */
  reply?: 'handle';
  architectureCulture?: string;
  scene?: import('./urbanArchitecture').PlacementBatch;
  raster?: SettlementRaster;
  sites?: UrbanSite[];
  roads?: Street[];
  layoutConfig?: LayoutConfig;
  parcelConfig?: ParcelConfig;
  layouts?: Layout[];
  partitions?: Partition[];
  layoutsId?: number;
  runtime?: ExecutionRuntime;
  /** Read a retained native snapshot across workers, without uploading geometry. */
  source?: UrbanSourceHandle;
  keys?: string[];
  /** Native programme: continue from the parcels the engine session holds (no layouts/partitions upload). */
  retained?: boolean;
}
export interface UrbanResponse {
  id: number;
  layouts?: Layout[];
  partitions?: Partition[];
  placementRequests?: import('./urbanArchitecture').PlacementRequest[];
  ms?: number;
  error?: string;
  urbanSource?: UrbanSourceHandle;
  /** `magna-city-parcels` pack of the partitions, in place of `partitions`: the realm that
   * consumes the response materialises it (`responsePartitions`, `partitionsFromPack`). */
  partitionsPack?: ArrayBuffer;
  /** Browser WASM execution mode that produced this response (threads/single/pool). */
  wasm?: WasmThreadsInfo;
}
/** `terrainSent`: called once a native request's terrain upload is done, before the engine computes. */
export interface UrbanRunHooks {
  terrainSent?: () => void;
}
export interface UrbanEngine {
  run(request: UrbanRequest, hooks?: UrbanRunHooks): UrbanResponse | Promise<UrbanResponse>;
  /** Native only: free this engine's retained session. */ release?(runtime: ExecutionRuntime): Promise<void>;
}

/** Absent native fields already mean auto/off. Omit those defaults so older
 * strict engines remain usable; explicit choices must still reach their validator.
 * UI settings, saved links and returned layouts retain their original config. */
function nativeLayoutConfig(config: LayoutConfig) {
  // Absent is off; keep the payload of old strict engines unchanged.
  const input: Partial<LayoutConfig> = { ...config };
  if (input.gateVillage === 0 && !input.gateVillages) delete input.gateVillage;
  for (const key of [
    'oldEnclosureCitadel',
    'medievalWalls',
    'riverControl',
    'dryDitches',
    'gateVillages',
    'shelteredHarbour',
    'powerHighGround',
    'mergeParallelStreets',
    'regularGridOutline',
    'roadMouths',
    'roadRemnants',
    'roadEndJoins',
    'smallPlaceCapacity',
    'naturalCampApproaches',
    'streetFrontage',
    'alignEnclosedGrid',
    'hideUnusedQuarters',
    'deepBlockLanes',
    'villageBridgeBudget',
    'linksJoinRoads',
    'roadNetworkPrune',
    'villageStreets',
  ] as const)
    if (input[key] === false || input[key] === undefined) delete input[key];
  for (const key of ['wallStiffness', 'wallTerrain', 'wallRelief', 'wallTowerSpacing', 'ditchWetness', 'lagoonCanals', 'campRingWobble'] as const) if (input[key] == null) delete input[key];
  for (const key of ['riverControlMode', 'portEnclosure', 'plannedWall', 'heightsCastle', 'wallExtension', 'moat'] as const) if (!input[key]) delete input[key];
  for (const key of ['roadWidthBySize', 'townMainRoad', 'polishRoadEnds', 'lowRuralHouses', 'riverSpurFilter', 'harbourBridgeClearance', 'wallGatePolicy', 'smallRoadLoops', 'isolatedAccess'] as const) if (input[key] === true || input[key] === undefined) delete input[key];
  if (input.campGrowth === 'ring' || !input.campGrowth) delete input.campGrowth;
  if (input.zoneDensity === 'phases' || !input.zoneDensity) delete input.zoneDensity;
  if (!input.parallelMerge) delete input.parallelMerge;
  if (input.outbuildings === 0.5 || input.outbuildings === undefined) delete input.outbuildings;
  if (input.houseComplexity === 'simple' || !input.houseComplexity) delete input.houseComplexity;
  if (input.singularDensity === 1 || input.singularDensity === undefined) delete input.singularDensity;
  if (input.backBuildings === 0.5 || input.backBuildings === undefined) delete input.backBuildings;
  if (!input.styleSheet || styleSheetEmpty(input.styleSheet)) delete input.styleSheet;
  if (input.shantyScale === 1 || input.shantyScale === undefined) delete input.shantyScale;
  if (!input.organicBranchVariation) delete input.organicBranchVariation;
  if (!input.ribbonWidthVariation) delete input.ribbonWidthVariation;
  if (input.portDetachment === 1) delete input.portDetachment;
  if (input.portShelter === 0 && !input.shelteredHarbour) delete input.portShelter;
  if (input.portType === 'auto' || !input.portType) delete input.portType;
  config = input as LayoutConfig;
  const programme = nativeProgrammeContext(config.programme);
  if (config.fortificationStyle !== 'auto') return programme === config.programme ? config : { ...config, programme };
  const { fortificationStyle: _automatic, ...automatic } = config;
  return programme === config.programme ? automatic : { ...automatic, programme };
}
/** Null has the same automatic meaning as absence, including on older strict
 * decoders. Never omit an explicit object, even an empty/zero-valued one. */
function nativeProgrammeContext(context: ProgrammeContext): ProgrammeContext {
  if (context.functions !== null) return context;
  const { functions: _automatic, ...input } = context;
  return input;
}
function nativeLayouts(layouts: Layout[]) {
  return layouts.map(layout => {
    const config = layout.config ? nativeLayoutConfig(layout.config) : undefined;
    const programme = layout.programme?.context?.functions === null ? { ...layout.programme, context: nativeProgrammeContext(layout.programme.context) } : layout.programme;
    return config !== layout.config || programme !== layout.programme ? { ...layout, ...(config ? { config } : {}), ...(programme ? { programme } : {}) } : layout;
  });
}
function nativePartitions(partitions: Partition[]) {
  return partitions.map(partition => (partition.programme?.context?.functions === null ? { ...partition, programme: { ...partition.programme, context: nativeProgrammeContext(partition.programme.context) } } : partition));
}
function nativeUrbanInput(request: UrbanRequest) {
  return { ...request, ...(request.layoutConfig ? { layoutConfig: nativeLayoutConfig(request.layoutConfig) } : {}), ...(request.layouts ? { layouts: nativeLayouts(request.layouts) } : {}), ...(request.partitions ? { partitions: nativePartitions(request.partitions) } : {}) };
}

/** Reconciliation needs capacities, identities and open surfaces, never roof
 * meshes or retained architectural plans. Keep those out of the native transfer. */
function capacityInput(scene: UrbanRequest['scene']) {
  if (!scene) return undefined;
  return {
    buildings: scene.buildings.map(({ parcel_id, function: fn, useful_area_m2, domestic_units }) => ({ parcel_id, function: fn, useful_area_m2, domestic_units })),
    refusals: scene.refusals.map(({ parcel_id, message }) => ({ parcel_id, message })),
    open_spaces: scene.open_spaces,
  };
}

/** A partial pack (built capacity: programme columns, no parcel geometry) is
 * completed here with the partitions the request uploaded. */
function packReply(request: UrbanRequest, pack: ArrayBuffer, envelope: Pick<UrbanResponse, 'id' | 'ms' | 'urbanSource'>): UrbanResponse {
  if (!isWholeParcelPack(pack) && request.partitions) {
    return { ...envelope, partitions: partitionsFromPack(pack, request.partitions) };
  }
  return { ...envelope, partitionsPack: pack };
}
/** A native `/urban` reply: JSON, or a `magna-city-parcels` pack whose header carries `id`, `ms`, `urbanSource`. */
async function nativeUrbanReply(request: UrbanRequest, response: Response): Promise<UrbanResponse> {
  if (contentType(response) !== 'application/octet-stream') return response.json() as Promise<UrbanResponse>;
  const pack = await response.arrayBuffer();
  const { id, ms, urbanSource } = packHeader(pack);
  return packReply(request, pack, { id: id ?? request.id, ...(ms !== undefined ? { ms } : {}), ...(urbanSource ? { urbanSource } : {}) });
}

/** Both calls run exclusively in Rust and keep their own immutable terrain handle. */
export async function createUrbanEngine(runtime?: ExecutionRuntime): Promise<UrbanEngine> {
  let core: CoreWasm | undefined = runtime?.profile !== 'local' ? await loadCoreWasm() : undefined;
  let Terrain = core?.SettlementTerrain;
  // `?threads=pool`: independent single-thread workers (urbanPool.ts), worker realm only.
  let pool: UrbanPool | undefined;
  if (core && wasmThreadsInfo().mode === 'pool' && inWorker()) {
    try {
      pool = createUrbanPool(wasmThreadsInfo().threads, await singleWasmModule());
    } catch (error) {
      console.warn('Urban worker pool unavailable:', error);
    }
  }
  const wasmInfo = (): WasmThreadsInfo => (pool ? { ...wasmThreadsInfo(), threads: pool.size } : wasmThreadsInfo());
  let terrain: SettlementTerrain | undefined;
  // Resident products: the Rust instance keeps the exact (decimal round-tripped)
  // layouts and partitions of the last stage under ids. `items` are the JS objects
  // handed to the caller; a later request carrying the same objects (or the
  // layoutsId) reuses the Rust copy instead of re-sending ≈5 MB of JSON.
  // `json` is the layouts text the UI received, kept only for cache digests.
  let retainedLayouts: { id: number; items: Layout[]; json?: string; digest?: string; rust?: number; terrain?: SettlementTerrain } | undefined;
  // Pack replies: `pack` is the buffer handed out; the partitions the caller
  // materialises from it (`partitionsFromPack`) are recognised by `packOf`.
  let retainedPartitions: { items?: Partition[]; pack?: ArrayBuffer; rust: number; terrain: SettlementTerrain } | undefined;
  // Rust JSON text of every product array this engine returned (cache digests and sizes).
  const texts = new WeakMap<object, string>(),
    digests = new WeakMap<object, Promise<string>>();
  const parsed = <T extends object>(json: string): T => {
    const value = JSON.parse(json) as T;
    texts.set(value, json);
    return value;
  };
  const textDigest = (value: object): Promise<string> | undefined => {
    let digest = digests.get(value);
    const text = texts.get(value);
    if (!digest && text !== undefined) digests.set(value, (digest = sha256([text])));
    // Partitions materialised from a pack: the digest of its bytes (a transferred pack is detached, length 0).
    const pack = !digest && Array.isArray(value) ? packOf(value as Partition[]) : undefined;
    if (pack?.byteLength) digests.set(value, (digest = sha256([new Uint8Array(pack)])));
    return digest;
  };
  // Cache hits skip the raster upload; build the terrain lazily on the first miss.
  let pendingRaster: SettlementRaster | undefined, terrainRaster: SettlementRaster | undefined, pendingDigest: string | undefined;
  const rasterDigests = new WeakMap<object, Promise<string>>();
  const native = nativeRasterClient();
  type Requests = import('./urbanArchitecture').PlacementRequest[];
  const sameItems = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  // Older generated packages lack the resident API: they keep the JSON path.
  const resident = typeof (Terrain?.prototype as { urban_quarters_resident?: unknown } | undefined)?.urban_quarters_resident === 'function';
  // Packages with the parcel pack exports (`resident.rs`) return partitions as packs.
  type PackTerrain = SettlementTerrain & {
    urban_parcels_resident_pack(seed: string, layoutsId: number, config: string, start: number, end: number): Uint8Array;
    urban_programme_resident_pack(layoutsId: number, partitionsId: number): Uint8Array;
    urban_parcel_pack_resident(partitionsId: number, groups: string): Uint8Array;
    retain_partitions_pack(bytes: Uint8Array): number;
    urban_built_capacity_resident(partitionsId: number, scene: string): Uint8Array;
  };
  // A boolean, not a type guard: with the current package every terrain has the pack calls, and a guard would
  // type the branches kept for a package built before them (threads and release variants rebuild separately) as unreachable.
  const packs = (t: SettlementTerrain): boolean => typeof (t as Partial<PackTerrain>).urban_parcels_resident_pack === 'function';
  /** A pack out of WASM; its header names the resident id of exactly these partitions. */
  const wasmPack = (bytes: Uint8Array): { pack: ArrayBuffer; rust: number } => {
    const pack = packBuffer(bytes);
    return { pack, rust: packHeader(pack).partitionsId ?? 0 };
  };
  /** Rust id of `items` (default: the retained layouts), uploading them only when Rust no longer holds them. */
  const layoutsHandle = (t: SettlementTerrain, items: Layout[]): number => {
    const held = retainedLayouts?.terrain === t ? retainedLayouts.rust : undefined;
    const same = !!retainedLayouts && (items === retainedLayouts.items || sameItems(items, retainedLayouts.items));
    if (held && same && t.resident_layouts_id() === held) return held;
    const rust = t.retain_layouts_json(JSON.stringify(nativeLayouts(items)));
    retainedLayouts = same ? { ...retainedLayouts!, rust, terrain: t } : { id: -1, items, rust, terrain: t };
    retainedPartitions = undefined;
    return rust;
  };
  const partitionsHandle = (t: SettlementTerrain, items: Partition[]): number => {
    const held = retainedPartitions?.terrain === t ? retainedPartitions.rust : undefined;
    const pack = packOf(items);
    const same = !!retainedPartitions && ((!!retainedPartitions.items && sameItems(items, retainedPartitions.items)) || (!!pack && pack === retainedPartitions.pack));
    if (held && t.resident_partitions_id() === held && same) return held;
    // Partitions materialised from a live pack go back as that pack: no JSON text.
    const rust = pack && pack.byteLength && packs(t) ? t.retain_partitions_pack(new Uint8Array(pack)) : t.retain_partitions_json(JSON.stringify(nativePartitions(items)));
    retainedPartitions = { items, rust, terrain: t };
    return rust;
  };
  /** Pool slices' JSON arrays joined as text: identical to concatenating the parsed arrays. */
  const joinArrays = (parts: string[]): string =>
    '[' +
    parts
      .map(p => p.trim().slice(1, -1))
      .filter(p => p.trim().length)
      .join(',') +
    ']';
  const quartersResident = async (t: SettlementTerrain, seed: string, sites: RoadSite[], config: string, roads: string): Promise<{ layouts: Layout[]; json: string }> => {
    const serial = () => {
      const json = t.urban_quarters_resident(seed, JSON.stringify(sites), config, roads);
      return { layouts: parsed<Layout[]>(json), json };
    };
    if (!pool || pool.size < 2 || sites.length < 2 || new Set(sites.map(s => s.key)).size !== sites.length) return serial();
    const jobs = ranges(sites.length, pool.size).map(([a, b]): PoolArgs => ({ seed, sites: JSON.stringify(sites.slice(a, b)), config, roads }));
    let json: string;
    try {
      json = joinArrays(await pool.run('quarters', jobs, undefined, a => t.urban_quarters(a.seed!, a.sites!, a.config!, a.roads!)));
    } catch {
      return serial();
    } // The exact serial error: validation order spans all sites.
    // Rust reparses the joined text: the same decimal round trip as the serial call.
    t.retain_layouts_json(json);
    return { layouts: parsed<Layout[]>(json), json };
  };
  const parcelsResident = async (t: SettlementTerrain, seed: string, layoutsId: number, config: string): Promise<{ partitions?: Partition[]; pack?: ArrayBuffer; rust: number }> => {
    const count = t.resident_layouts_len();
    if (!pool || pool.size < 2 || count < 2) {
      if (packs(t)) return wasmPack(t.urban_parcels_resident_pack(seed, layoutsId, config, 0, 0xffffffff));
      const partitions = parsed<Partition[]>(t.urban_parcels_resident(seed, layoutsId, config, 0, 0xffffffff));
      return { partitions, rust: t.resident_partitions_id() };
    }
    // Helpers decode the binary layouts image once for this batch, then cut
    // their layout ranges; the first error in order wins, as serially.
    const image = t.export_resident(layoutsId, 0);
    const jobs = ranges(count, pool.size).map(([a, b]): PoolArgs => ({ seed, config, start: String(a), end: String(b) }));
    const json = joinArrays(await pool.run('parcels-resident', jobs, { image }, a => t.urban_parcels_resident(seed, layoutsId, config, Number(a.start), Number(a.end))));
    const rust = t.retain_partitions_json(json);
    // The pack of the retained (normalised) values, as the serial path returns.
    if (packs(t)) return { pack: packBuffer(t.urban_parcel_pack_resident(rust, '')), rust };
    return { partitions: parsed<Partition[]>(json), rust };
  };
  const sitesResident = async (t: SettlementTerrain, seed: string, layoutsId: number, partitionsId: number, culture: string | undefined): Promise<Requests> => {
    const serial = () => parsed<Requests>(t.urban_building_sites_resident(seed, layoutsId, partitionsId, culture, 0, 0xffffffff));
    if (!pool || pool.size < 2) return serial();
    const total = t.urban_building_sites_total_resident(layoutsId, partitionsId);
    if (total < 32) return serial();
    // Several slices per participant: sites differ in cost, the queue balances them.
    const jobs = ranges(total, Math.min(Math.ceil(total / 16), pool.size * 4)).map(([a, b]): PoolArgs => ({ start: String(a), end: String(b) }));
    const parts = await pool.run('sites-resident', jobs, { seed, culture, image: t.export_resident(layoutsId, partitionsId) }, a => t.urban_building_sites_resident(seed, layoutsId, partitionsId, culture, Number(a.start), Number(a.end)));
    return parsed<Requests>(joinArrays(parts));
  };
  // JSON path of packages without the resident API.
  const quartersJson = async (t: SettlementTerrain, seed: string, sites: RoadSite[], config: string, roads: string): Promise<Layout[]> => {
    const serial = () => JSON.parse(t.urban_quarters(seed, JSON.stringify(sites), config, roads)) as Layout[];
    if (!pool || pool.size < 2 || sites.length < 2 || new Set(sites.map(s => s.key)).size !== sites.length) return serial();
    const jobs = ranges(sites.length, pool.size).map(([a, b]): PoolArgs => ({ seed, sites: JSON.stringify(sites.slice(a, b)), config, roads }));
    try {
      return (await pool.run('quarters', jobs, undefined, a => t.urban_quarters(a.seed!, a.sites!, a.config!, a.roads!))).flatMap(json => JSON.parse(json) as Layout[]);
    } catch {
      return serial();
    }
  };
  /** `keepLayouts`: a lazily built terrain for a cache-hit plan keeps the layouts the caller refers to. */
  const runWasmUncached = async (request: UrbanRequest, keepLayouts = false): Promise<UrbanResponse> => {
    if (request.raster) {
      const r = request.raster;
      validatePhysicalTerrain(r.physical);
      // Bound helper copies of the full height plane; a later smaller raster can use the pool again.
      const helperBytes = (wasmThreadsInfo().threads - 1) * (r.physical?.height.byteLength ?? 0);
      if (helperBytes > 128 * 1024 * 1024 && pool) {
        pool.dispose();
        pool = undefined;
      } else if (helperBytes <= 128 * 1024 * 1024 && !pool && core && wasmThreadsInfo().mode === 'pool' && inWorker()) {
        try {
          pool = createUrbanPool(wasmThreadsInfo().threads, await singleWasmModule());
        } catch (error) {
          console.warn('Urban worker pool unavailable:', error);
        }
      }
      if (!keepLayouts) retainedLayouts = undefined;
      retainedPartitions = undefined;
      terrain?.free();
      terrain = undefined;
      const next = new Terrain!(r.width, r.n, r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds);
      try {
        if (r.physical) {
          const physical = next as SettlementTerrain & { set_physical_height(n: number, height: Float32Array): void; set_physical_height_spline(n: number, height: Float32Array, floor: number): void };
          if (r.physical.interpolation === 'bspline') physical.set_physical_height_spline(r.physical.n, r.physical.height, r.physical.floor ?? 0);
          else physical.set_physical_height(r.physical.n, r.physical.height);
        }
        if (r.geometry) next.set_urban_geometry(JSON.stringify(r.geometry));
      } catch (error) {
        next.free();
        throw error;
      }
      terrain = next;
      terrainRaster = r;
      pool?.setRaster(r);
    }
    if (!terrain) throw new Error('[raster_missing] Generate the terrain before the quarters.');
    const t = terrain;
    const start = performance.now();
    if (request.kind === 'quarters') {
      retainedLayouts = undefined;
      retainedPartitions = undefined;
      const config = JSON.stringify(nativeLayoutConfig(normalizeLayoutConfig(request.layoutConfig, true))),
        roads = JSON.stringify(request.roads ?? []);
      if (resident) {
        const { layouts, json } = await quartersResident(t, request.seed, request.sites ?? [], config, roads);
        retainedLayouts = { id: request.id, items: layouts, json, rust: t.resident_layouts_id(), terrain: t };
        return { id: request.id, layouts, ms: performance.now() - start };
      }
      const layouts = await quartersJson(t, request.seed, request.sites ?? [], config, roads);
      // Preserve the existing JS number roundtrip before Rust parses parcels.
      // Keeping native f64 layouts instead can subtly change polygon cuts.
      retainedLayouts = { id: request.id, items: layouts, json: JSON.stringify(nativeLayouts(layouts)) };
      return { id: request.id, layouts, ms: performance.now() - start };
    }
    const items: Layout[] | undefined = request.layouts ?? (request.layoutsId === undefined ? [] : retainedLayouts?.id === request.layoutsId ? retainedLayouts.items : undefined);
    if (items === undefined) throw new Error('Le plan des quartiers a changé. Régénérez les quartiers avant les parcelles.');
    if (request.kind === 'builtCapacity') {
      if (resident && packs(t)) {
        // Programme columns only: completed here with the request's parcels.
        const pack = packBuffer(t.urban_built_capacity_resident(partitionsHandle(t, request.partitions ?? []), JSON.stringify(capacityInput(request.scene))));
        return packReply(request, pack, { id: request.id, ms: performance.now() - start });
      }
      const partitions = JSON.parse(t.urban_built_capacity(JSON.stringify(nativePartitions(request.partitions ?? [])), JSON.stringify(capacityInput(request.scene)))) as Partition[];
      return { id: request.id, partitions, ms: performance.now() - start };
    }
    if (resident) {
      const layoutsId = layoutsHandle(t, items);
      if (request.kind === 'programme') {
        if (packs(t)) {
          const { pack, rust } = wasmPack(t.urban_programme_resident_pack(layoutsId, partitionsHandle(t, request.partitions ?? [])));
          retainedPartitions = { pack, rust, terrain: t };
          return { id: request.id, partitionsPack: pack, ms: performance.now() - start };
        }
        const partitions = parsed<Partition[]>(t.urban_programme_resident(layoutsId, partitionsHandle(t, request.partitions ?? [])));
        retainedPartitions = { items: partitions, rust: t.resident_partitions_id(), terrain: t };
        return { id: request.id, partitions, ms: performance.now() - start };
      }
      if (request.kind === 'buildingSites') {
        const placementRequests = await sitesResident(t, request.seed, layoutsId, partitionsHandle(t, request.partitions ?? []), request.architectureCulture);
        return { id: request.id, placementRequests, ms: performance.now() - start };
      }
      const { partitions, pack, rust } = await parcelsResident(t, request.seed, layoutsId, JSON.stringify(normalizeParcelConfig(request.parcelConfig)));
      retainedPartitions = { items: partitions, pack, rust, terrain: t };
      return pack ? { id: request.id, partitionsPack: pack, ms: performance.now() - start } : { id: request.id, partitions, ms: performance.now() - start };
    }
    const layoutsJson = request.layouts || request.layoutsId === undefined ? JSON.stringify(nativeLayouts(items)) : retainedLayouts!.json!;
    if (request.kind === 'programme') {
      const partitions = JSON.parse(t.urban_programme(layoutsJson, JSON.stringify(nativePartitions(request.partitions ?? [])))) as Partition[];
      return { id: request.id, partitions, ms: performance.now() - start };
    }
    if (request.kind === 'buildingSites') {
      const placementRequests = JSON.parse(t.urban_building_sites(request.seed, layoutsJson, JSON.stringify(request.partitions ?? []), request.architectureCulture)) as Requests;
      return { id: request.id, placementRequests, ms: performance.now() - start };
    }
    const partitions = JSON.parse(t.urban_parcels(request.seed, layoutsJson, JSON.stringify(normalizeParcelConfig(request.parcelConfig)))) as Partition[];
    return { id: request.id, partitions, ms: performance.now() - start };
  };
  const engineId = (): string => {
    try {
      return String((Terrain as unknown as { urban_programme_functions_version?: () => number } | undefined)?.urban_programme_functions_version?.() ?? 0);
    } catch {
      return '0';
    }
  };
  const runWasm = async (request: UrbanRequest, keepLayouts = false): Promise<UrbanResponse> => {
    try {
      if (requiresProgrammeFunctions(request)) requireWasmProgrammeFunctions(Terrain, request);
      return { ...(await runWasmUncached(request, keepLayouts)), wasm: wasmInfo() };
    } catch (error) {
      // The failure terminated the threads instance: rebuild the terrain on the
      // single-thread package (layouts and partitions re-upload from their JS
      // objects) and retry once.
      if (!core || !(await recoverCoreWasm(error, core))) return { id: request.id, error: String(error), wasm: wasmInfo() };
      core = await loadCoreWasm();
      Terrain = core.SettlementTerrain;
      terrain = undefined;
      if (retainedLayouts) retainedLayouts = { ...retainedLayouts, rust: undefined, terrain: undefined };
      retainedPartitions = undefined;
      const raster = request.raster ?? terrainRaster;
      try {
        return { ...(await runWasmUncached(raster ? { ...request, raster } : request, keepLayouts || !request.raster)), wasm: wasmInfo() };
      } catch (retry) {
        return { id: request.id, error: String(retry), wasm: wasmInfo() };
      }
    }
  };
  const runCached = async (request: UrbanRequest): Promise<UrbanResponse> => {
    let key: string | undefined;
    try {
      if (request.raster) {
        pendingRaster = request.raster;
        let digest = rasterDigests.get(request.raster);
        if (!digest) rasterDigests.set(request.raster, (digest = digestValue(request.raster)));
        pendingDigest = await digest;
      }
      let layoutsDigest: string | undefined;
      if (request.kind !== 'quarters' && !request.layouts && request.layoutsId !== undefined) {
        if (retainedLayouts?.id !== request.layoutsId) return runWasm(request);
        retainedLayouts.digest ??= await sha256([retainedLayouts.json ?? JSON.stringify(nativeLayouts(retainedLayouts.items))]);
        layoutsDigest = retainedLayouts.digest;
      }
      // Products this engine returned are keyed by the digest of their Rust
      // text, without re-serialising megabytes of geometry in JS.
      const keyed: Record<string, unknown> = { ...request };
      for (const name of ['layouts', 'partitions'] as const) {
        const digest = request[name] && textDigest(request[name]!);
        if (digest) keyed[name] = { $digest: await digest };
      }
      if (pendingDigest) key = await urbanCacheKey(keyed, { engine: engineId(), terrain: pendingDigest, retainedLayouts: layoutsDigest });
    } catch {
      key = undefined;
    }
    if (key) {
      const hit = await readUrbanCache<Pick<UrbanResponse, 'layouts' | 'partitions' | 'placementRequests' | 'partitionsPack'>>(key);
      if (hit && (hit.layouts || hit.partitions || hit.placementRequests || hit.partitionsPack)) {
        if (request.kind === 'quarters' && hit.layouts) retainedLayouts = { id: request.id, items: hit.layouts };
        return { id: request.id, ...hit, ms: 0 };
      }
    }
    const lazy = !request.raster && !!pendingRaster && terrainRaster !== pendingRaster;
    const response = await runWasm(lazy ? { ...request, raster: pendingRaster } : request, lazy && request.kind !== 'quarters');
    if (!response.error && key) {
      const { id: _id, ms: _ms, wasm: _wasm, ...value } = response;
      // Byte size from the Rust texts when known: no JSON.stringify of the result.
      const present = ([value.layouts, value.partitions, value.placementRequests] as (object | undefined)[]).filter((v): v is object => !!v);
      const known = present.every(v => texts.has(v)) ? present.reduce((n, v) => n + texts.get(v)!.length, 0) : undefined;
      // The pack is stored as bytes. Copy it now: the caller may transfer (detach) the response's buffer.
      const pack = value.partitionsPack;
      if (pack && pack.byteLength > URBAN_CACHE_MAX_BYTES / 2) {
        /* too large to cache */
      } else if (pack) void writeUrbanCache(key, { ...value, partitionsPack: pack.slice(0) }, known === undefined ? undefined : known + pack.byteLength);
      else void writeUrbanCache(key, value, present.length ? known : undefined);
    }
    return response;
  };
  return {
    async release(runtime) {
      pool?.dispose();
      pool = undefined;
      terrain?.free();
      terrain = undefined;
      retainedLayouts = undefined;
      retainedPartitions = undefined;
      pendingRaster = terrainRaster = undefined;
      await native.release(runtime);
    },
    run(request, hooks) {
      if (request.source) {
        try {
          validateUrbanSource(request.source);
          if (request.runtime?.profile !== 'local' || (request.kind !== 'buildingSites' && request.kind !== 'builtCapacity') || request.raster || request.layouts || request.partitions) throw new Error('Retained urban reads require a local source without uploaded geometry.');
          const { runtime: _runtime, ...input } = nativeUrbanInput(request);
          // The handle belongs to the urban worker's session, not this engine's
          // private raster client. A missing/stale source must remain an error.
          // A built-capacity read replies a pack of the programme columns only:
          // `responsePartitions(response, base)` completes it with the caller's parcels.
          const read = async () => nativeUrbanReply(request, await nativeRequest(request.runtime!, '/urban', JSON.stringify({ ...input, ...(request.kind === 'builtCapacity' ? { scene: capacityInput(request.scene) } : {}), session: request.source!.session })));
          return (requiresProgrammeFunctions(request) ? requireLocalProgrammeFunctions(request.runtime, request).then(read) : read()).catch(error => ({ id: request.id, error: String(error) }));
        } catch (error) {
          return { id: request.id, error: String(error) };
        }
      }
      if (request.runtime?.profile === 'local') {
        // `parcels`, `programme` and `builtCapacity` reply a parcel pack; the others JSON.
        const run = async () =>
          nativeUrbanReply(
            request,
            await native.raw('/urban', {
              ...nativeUrbanInput(request),
              runtime: request.runtime!,
              ...(hooks?.terrainSent ? { onRasterSent: hooks.terrainSent } : {}),
              ...(request.kind === 'builtCapacity' ? { scene: capacityInput(request.scene) } : {}),
              ...(request.kind === 'quarters' ? { layoutConfig: nativeLayoutConfig(normalizeLayoutConfig(request.layoutConfig, true)) } : { parcelConfig: normalizeParcelConfig(request.parcelConfig) }),
            }),
          );
        return (requiresProgrammeFunctions(request) ? requireLocalProgrammeFunctions(request.runtime, request).then(run) : run()).catch(error => ({ id: request.id, error: String(error) }));
      }
      return runCached(request);
    },
  };
}
let fallback: Promise<UrbanEngine> | undefined;
export async function runUrbanRequest(request: UrbanRequest): Promise<UrbanResponse> {
  fallback ??= createUrbanEngine(request.runtime);
  return (await fallback).run(request);
}
