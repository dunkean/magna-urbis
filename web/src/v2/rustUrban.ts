import { cityNamedSite } from '../render/cityGeneration';
import { defaultCityLayoutConfig as defaultLayoutConfig } from '../render/cityGeneration';
import { springPoints } from '../../../rust/bridge/urbanGeography';
import type { World, UrbanLayer, UrbanBuilding, PolyH, UrbanZone, StreetRole, Options } from '../gen/types';
import type { Claim, Layout, Partition, UrbanResponse, Street, UrbanEngine } from '../../../rust/bridge/urban';
import { nameNeighbourWarning, neighbourClaimsOf, neighbourFingerprint } from './townNeighbours';
import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urbanConfig';
import { defaultParcelConfig, normalizeLayoutConfig, normalizeParcelConfig } from '../../../rust/bridge/urbanConfig';
import { CAVE_ROCK_DEPTH, settlementRaster, type SettlementRaster } from '../../../rust/bridge/settlements';
import { cityRasterSide, citySiteArchetypes, cityTownRoads } from '../render/cityGeneration';
import type { RustRegionSnapshot } from './region';
import type { PlacementBatch, PlacementRequest, PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import type { HouseConfig } from '../../../rust/bridge/housesContract';
import { carryUrbanOpenDeficits } from '../../../rust/bridge/urbanOpenDeficits';
import type { V2Settings, V2TownStage, ProgressCallback, V2Progress, V2UrbanControls, V2UrbanSettings } from './contracts';
import { forCellsNearPolyline } from '../gen/core/field';
import { layoutFortification } from '../gen/options';
import { differenceS } from '../gen/geo/bool';
import { ribbon } from '../gen/geo/offset';
import { pointInRing } from '../gen/geo/poly';
import { streetSeedConfig, urbanSeed } from './urbanSeeds';
import { engineIdentityOf } from './runtimeChoices';
import type { CityGroundRaster } from '../render/cityGround';
import { cityArchitectureOf } from '../render/cityContract';
import { siteVisualScene, type CityPlacementRequest } from '../ui/urbanSilhouettes';
import { projectUrbanSite, type UrbanSiteVisual } from '../ui/urbanSiteStore';
import type { UrbanBuildingSiteQuery } from '../../../rust/bridge/urbanBuildingSite';
import { partitionsFromPack } from '../../../rust/bridge/urbanParcelPack';
import { geometryConfigs, localArchitectureSettings, scopedHouseEdit, siteQuarter, siteBlock, applyHouseEdit, requireHouseEditSuccess, isMassingEdit, massingEditApplied } from '../../../rust/bridge/urbanHouseEdits';
import { urbanParentControls } from './generationEdits';
import { runtimeBlockEdits, partitionLayout } from '../../../rust/bridge/urbanBlockEdits';
import { replayUrbanRoadEdits, type UrbanStreetEdit, type UrbanRoadSources, type RoadChanges } from './urbanRoadEditing';
import { roadBlockScope } from './urbanRoadBlocks';

export interface RustTownSnapshot {
  backend: 'rust-wasm-cpu' | 'rust-native-cpu';
  stage: V2TownStage;
  layoutKey: string;
  compositionKey?: string;
  compositionLayouts?: Layout[];
  parcelKey?: string;
  programmeKey?: string;
  requestKey?: string;
  siteBaseKey?: string;
  buildingKey?: string;
  /** Reconciled native programme evidence for this exact retained house scene. */
  capacityKey?: string;
  layouts: Layout[];
  /** Persistent manual streets, replayed before cadastral/building generation. */
  streetEdits?: UrbanStreetEdit[];
  roadSources?: UrbanRoadSources[];
  pendingRoadChanges?: RoadChanges;
  partitions?: Partition[];
  cadastralPartitions?: Partition[];
  programmePartitions?: Partition[];
  /** Complete placement requests: only for the houses crate (compact/detailed architecture); the city volumes need none. */
  requests?: PlacementRequest[];
  /** Display projection of the building sites (drawn surface, function, programme, entrance) in site order. */
  sites?: UrbanSiteVisual[];
  /** Native descriptor to read one complete site by offset/id while the engine retains this snapshot. */
  siteQuery?: UrbanBuildingSiteQuery;
  scene?: PlacementBatch;
  houseSettingsKey?: string;
  houseOverrides?: Record<string, Partial<HouseConfig>>;
  lastBuildingRequests?: number;
  houseBaseline?: { key: string; originals: Record<string, Pick<PlacementBatch, 'buildings' | 'refusals' | 'open_spaces'> & { parcelId: string }> };
  /** Projection indexes refer to the actual native placement ids, not an invented TS house recipe. */
  buildingIds: string[];
  warnings: string[];
}
export interface RustTownResult {
  urban: UrbanLayer;
  snapshot: RustTownSnapshot;
  stats: Record<string, string | number>;
}
/** `layouts`/`partitions`: the products the native engine session holds (the last quarters, parcels or programme reply),
 * by identity; a later stage that reads exactly these sends their handle instead of re-uploading the geometry. */
const engines = new Map<string, { engine: Promise<UrbanEngine>; terrainKey?: string; priming?: Promise<void>; layouts?: Layout[]; partitions?: Partition[]; source?: import('../../../rust/bridge/urban').UrbanSourceHandle }>();
interface RasterCacheEntry {
  width: number;
  cell: number;
  height: World['terrain']['height']['data'];
  water: World['terrain']['water'];
  filled: World['terrain']['filled'];
  seaLevel: number;
  physical?: Float32Array;
  physicalFloor?: number;
  physicalInterpolation?: 'bspline';
  coastline: World['terrain']['coastline'];
  islands: World['terrain']['islands'];
  lakes: World['terrain']['lakes'];
  rivers: { path: World['terrain']['rivers'][number]['path']; width: World['terrain']['rivers'][number]['width']; id: number | undefined }[];
  raster: SettlementRaster;
}
/** Parcels kept only engine-side (`reply: 'handle'`): a unique empty marker per reply, never uploaded. */
const heldPartitions = new WeakSet<Partition[]>();
/** WASM: complete requests of a site projection, kept in the urban worker and never sent to the page. */
const wasmSiteRequests = new WeakMap<UrbanSiteVisual[], PlacementRequest[]>();
type SiteResponse = UrbanResponse & { sites?: UrbanSiteVisual[]; siteQuery?: UrbanBuildingSiteQuery };
const physicalRasters = new WeakMap<World['terrain']['height'], RasterCacheEntry>();
/** Native stage products are immutable. Transitions replace only changed
 * containers; old snapshots, geometry and compressed plans remain exact. */
export function cloneRustTownSnapshot(snapshot: RustTownSnapshot): RustTownSnapshot {
  return { ...snapshot };
}

function merge<T>(...sources: unknown[]): T {
  const out: Record<string, unknown> = {};
  for (const source of sources)
    if (source && typeof source === 'object')
      for (const [key, value] of Object.entries(source)) {
        out[key] = value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value) ? merge(out[key], value) : value;
      }
  return out as T;
}
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [key, value[key]]),
        )
      : value,
  );
}
const roadFingerprints = new WeakMap<Street[], string>();
/** Roads are immutable regional products. Serialize their sorted keys once while preserving
 * the exact historical composition-key bytes (the roads remain an array, never an encoded string). */
export function townCompositionFingerprint(before: unknown[], roads: Street[], after: unknown[] = []): string {
  let retained = roadFingerprints.get(roads);
  if (retained === undefined) {
    retained = fingerprint(roads);
    roadFingerprints.set(roads, retained);
  }
  return '[' + [fingerprint(before).slice(1, -1), retained, fingerprint(after).slice(1, -1)].filter(Boolean).join(',') + ']';
}
export function urbanBackend(settings: V2Settings): 'typescript' | 'rust' | 'native' {
  return settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
}

/** Retain cell-centred physical metres and the existing vector geography; never rerun terrain. */
export function rustSettlementRaster(world: World): SettlementRaster {
  const terrain = world.terrain,
    grid = terrain.height;
  // A world opened from a saved decor keeps the decor's own raster: placement, roads and towns read City Bench's exact ground.
  const decor = (terrain as typeof terrain & { v2DecorRaster?: SettlementRaster }).v2DecorRaster;
  if (decor && decor.width === world.mapSize) return decor;
  const native = (terrain as typeof terrain & { v2NativeTerrain?: import('../../../rust/bridge/terrain').TerrainData }).v2NativeTerrain;
  const n = cityRasterSide({ mapSize: world.mapSize, gridSide: grid.w, nativeSide: native?.physical?.n });
  const cell = world.mapSize / n;
  const source = native?.physical,
    field = native?.field && source && native.field.n === source.n ? native.field : undefined;
  const sameHeight = !field && source?.n === grid.w && source.height.length === grid.data.length && source.height.every((h, i) => h === grid.data[i]);
  const physical: SettlementRaster['physical'] = field ? { n: field.n, height: field.data, interpolation: 'bspline', floor: field.floor } : source && !sameHeight ? { n: source.n, height: source.height } : undefined;
  if (grid.w !== grid.h) throw new Error('Le moteur urbain Rust requiert une grille carrée.');
  const cached = physicalRasters.get(grid);
  if (
    cached &&
    cached.width === world.mapSize &&
    cached.cell === cell &&
    cached.raster.n === n &&
    cached.height === grid.data &&
    cached.physical === physical?.height &&
    cached.physicalFloor === physical?.floor &&
    cached.physicalInterpolation === physical?.interpolation &&
    cached.water === terrain.water &&
    cached.filled === terrain.filled &&
    cached.seaLevel === terrain.seaLevel &&
    cached.coastline === terrain.coastline &&
    cached.islands === terrain.islands &&
    cached.lakes === terrain.lakes &&
    cached.rivers.length === terrain.rivers.length &&
    cached.rivers.every((river, i) => river.path === terrain.rivers[i].path && river.width === terrain.rivers[i].width && river.id === terrain.rivers[i].id)
  )
    return cached.raster;
  const planning = n !== grid.w ? settlementRaster(native!, n) : undefined;
  // Projection marks cave rock as class 4, which Rust rejects: send it as class 2 at ground level and keep the rock mask JS-side.
  const projectedRock = !planning && terrain.water.includes(4);
  const rock = planning?.rock ?? (projectedRock ? Uint8Array.from(terrain.water, v => (v === 4 ? 1 : 0)) : undefined);
  const height = planning?.height ?? grid.data,
    waterMask = planning?.water ?? (projectedRock ? Uint8Array.from(terrain.water, v => (v === 4 ? 2 : v)) : terrain.water);
  const waterLevel = planning?.waterLevel ?? new Float32Array(n * n),
    riverWidth = planning?.riverWidth ?? new Float32Array(n * n),
    riverIds = planning?.riverIds ?? new Int32Array(n * n).fill(-1);
  if (!planning) for (let i = 0; i < waterLevel.length; i++) if (terrain.water[i]) waterLevel[i] = terrain.water[i] === 1 ? terrain.seaLevel : terrain.water[i] === 4 ? grid.data[i] - CAVE_ROCK_DEPTH : Math.max(grid.data[i], terrain.filled[i]);
  if (!planning)
    for (const [index, river] of terrain.rivers.entries())
      for (let j = 1; j < river.path.length; j++) {
        const width = Math.max(river.width[j - 1] ?? 1, river.width[j] ?? 1);
        forCellsNearPolyline([river.path[j - 1], river.path[j]], n, n, cell, Math.max(cell * 0.8, width / 2), i => {
          if (waterMask[i] === 3 && width >= riverWidth[i]) {
            riverWidth[i] = width;
            riverIds[i] = river.id ?? index;
          }
        });
      }
  const square = [
    { x: 0, y: 0 },
    { x: world.mapSize, y: 0 },
    { x: world.mapSize, y: world.mapSize },
    { x: 0, y: world.mapSize },
  ];
  const seaWater = terrain.coastline.map(outer => ({ outer, holes: (terrain.islands ?? []).filter(island => island.length && pointInRing(outer, island[0])) }));
  const water: PolyH[] = [...seaWater];
  // Native geometry uses closed water domains, including the measured width of each river segment.
  // Raster river widths remain authoritative when a vector ribbon is absent.
  for (const river of terrain.rivers) if (river.path.length > 1) water.push({ outer: ribbon(river.path, river.width), holes: [] });
  // As in the original Rust bench adapter, the land envelope removes the sea;
  // lakes/rivers remain separate water constraints instead of a second expensive polygon boolean.
  const land = seaWater.length ? differenceS(square, seaWater) : [{ outer: square, holes: [] }];
  const raster: SettlementRaster = {
    width: world.mapSize,
    n,
    height,
    water: waterMask,
    waterLevel,
    riverWidth,
    riverIds,
    ...(rock ? { rock } : {}),
    ...(physical ? { physical } : {}),
    geometry: {
      land: land.flatMap(p => [p.outer, ...p.holes]),
      // Lakes are one even-odd ring group, as drawn; islands stay dry.
      water: [...water.map(p => [p.outer, ...p.holes]), ...(terrain.lakes.length ? [terrain.lakes] : [])],
      springs: springPoints(native?.water, native?.hydrology),
    },
  };
  physicalRasters.set(grid, {
    width: world.mapSize,
    cell,
    height: grid.data,
    physical: physical?.height,
    physicalFloor: physical?.floor,
    physicalInterpolation: physical?.interpolation,
    water: terrain.water,
    filled: terrain.filled,
    seaLevel: terrain.seaLevel,
    coastline: terrain.coastline,
    islands: terrain.islands,
    lakes: terrain.lakes,
    rivers: terrain.rivers.map(river => ({ path: river.path, width: river.width, id: river.id })),
    raster,
  });
  return raster;
}

type CityGroundTerrain = World['terrain'] & { v2CityGround?: CityGroundRaster };
/** The engine worker retains the display ground of the native cities (water mask and closed water
 * domains, river ribbons included) on the terrain it ships, so the page never rebuilds the
 * settlement raster: it is the worker's cached raster, without its heights and river planes. */
export function retainCityGround(world: World): void {
  const raster = rustSettlementRaster(world);
  (world.terrain as CityGroundTerrain).v2CityGround = { width: raster.width, n: raster.n, water: raster.water, ...(raster.geometry ? { geometry: { water: raster.geometry.water } } : {}) };
}
/** Display ground of the native cities: the retained engine product, rebuilt only for a world that has none (an imported project). */
export function cityGroundOf(world: World): CityGroundRaster {
  return (world.terrain as CityGroundTerrain).v2CityGround ?? rustSettlementRaster(world);
}

/** Regional roads of a V2 town, for its generation and its 3D bridges: the retained native network split at its
 * crossings and ranked by class, exactly as City Bench sends it (`cityTownRoads`). A TypeScript region has no
 * native network and keeps its projected roads. */
const townRoads = new WeakMap<object, Street[]>();
export function townRoadStreets(world: World): Street[] {
  const native = (world.debug?.v2RustRegion as RustRegionSnapshot | undefined)?.roads;
  if (native) {
    let streets = townRoads.get(native);
    if (!streets) townRoads.set(native, (streets = cityTownRoads({ ...native, segments: native.segments.filter((_, i) => !world.roads?.[i]?.urban) })));
    return streets;
  }
  return (world.roads ?? []).filter(r => !r.urban).map(road => ({ path: road.path, widths: road.path.map(() => road.width), rank: road.kind === 'major' ? 1 : road.kind === 'minor' ? 2 : 3, role: 'regional' }));
}
/** Site archetype of a V2 town (layout `siteArchetypes`), from its native placement record as City Bench reads it. */
export function townSiteArchetypes(world: World, key: string, explicit?: Record<string, string>): Record<string, string> {
  const placed = (world.debug?.v2RustRegion as RustRegionSnapshot | undefined)?.placement?.settlements.find(s => s.key === key);
  const place = world.settlements?.find(s => s.key === key);
  return citySiteArchetypes([placed ?? { key, archetype: place?.archetype }], explicit);
}

export function resolveRustUrbanControls(settings: V2Settings, key: string, options: Options): { layout: LayoutConfig; parcels: ParcelConfig; houses: PlacementBatchSettings } {
  const base: Partial<V2UrbanSettings> = settings.urban ?? {},
    local: V2UrbanControls = base.local?.[key] ?? {};
  const parent = urbanParentControls(base, local) ?? {};
  if (options.plan) throw new Error('Le plan personnalisé TypeScript ne peut pas être traduit fidèlement vers Rust. Utilisez les paramètres Rust layout.phaseOverrides, ou le moteur urbain TypeScript.');
  const layout = normalizeLayoutConfig(
    merge<LayoutConfig>(
      defaultLayoutConfig(),
      {
        culture: options.culture,
        density: 1 / (options.sprawl ?? 1),
        radiusScale: Math.sqrt(options.sprawl ?? 1),
        ...layoutFortification(options),
        suburbs: options.suburbs === 'some' ? 'few' : options.suburbs,
        ...(options.castle === 'yes' || Number(options.castles) > 0 ? { monument: 'castle' } : {}),
        ...(options.cathedral === 'yes' ? { monument: 'cathedral' } : {}),
        ...(options.palace === 'yes' ? { monument: 'palace' } : {}),
        ...(options.cultureMix ? { mixCulture: options.cultureMix.id, mixMode: options.cultureMix.mode, mixShare: options.cultureMix.t } : {}),
      },
      parent.layout,
      local.layout,
    ),
  );
  const parcels = normalizeParcelConfig(merge<ParcelConfig>(defaultParcelConfig(), { culture: local.layout?.culture ?? options.culture }, parent.parcels, local.parcels));
  return { layout, parcels, houses: merge<PlacementBatchSettings>(local.layout?.culture ? { culture: local.layout.culture } : undefined, parent.houses, local.houses) };
}
function required<T>(response: UrbanResponse, field: keyof UrbanResponse): T {
  if (response.error) throw new Error(response.error);
  if (response[field] === undefined) throw new Error(`Le moteur Rust n’a pas renvoyé ${field}.`);
  return response[field] as T;
}
function surfaceBounds(surface: import('../../../rust/bridge/housesContract').Surface): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const piece of surface)
    for (const p of piece.outer) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
  return { x0, y0, x1, y1 };
}
type RetainedOccupation = { building: PlacementBatch['buildings'][number]; occupation: import('../../../rust/bridge/housesContract').Surface; bounds: ReturnType<typeof surfaceBounds>; height: number };
const retainedOccupations = new WeakMap<PlacementBatch['buildings'][number], RetainedOccupation>();
function retainedOccupation(building: PlacementBatch['buildings'][number]): RetainedOccupation {
  let record = retainedOccupations.get(building);
  if (!record) {
    const occupation = [...building.footprint, ...building.courtyards, ...building.circulation, ...building.structural_features.flatMap(feature => feature.surface)];
    record = { building, occupation, bounds: surfaceBounds(occupation), height: Math.max(0, ...building.volumes.map(volume => volume.z_m + volume.wall_height_m + volume.roof_height_m - building.ground_z_m)) };
    retainedOccupations.set(building, record);
  }
  return record;
}
/** Keep all other retained occupations binding when a single native house is regenerated. */
export function withRetainedNeighbors(requests: PlacementRequest[], kept: PlacementBatch['buildings']): PlacementRequest[] {
  if (!requests.length) return requests;
  const neighbors = kept.map(retainedOccupation);
  return requests.map(request => {
    const bounds = surfaceBounds(request.cadastral);
    return {
      ...request,
      neighbors: [
        ...request.neighbors,
        ...neighbors.filter(({ bounds: b }) => b.x0 <= bounds.x1 + 2 && b.x1 >= bounds.x0 - 2 && b.y0 <= bounds.y1 + 2 && b.y1 >= bounds.y0 - 2).map(({ building, occupation, height }) => ({ id: `v2-retained:${building.id}`, footprint: occupation, height_m: height })),
      ],
    };
  });
}
export function mergeHouseDelta(previous: PlacementBatch, delta: PlacementBatch, changedParcels: Set<string>): PlacementBatch {
  if (previous.generator_version !== delta.generator_version) throw new Error('Le moteur maisons a changé de version. Régénérez les maisons du lieu avant une modification individuelle.');
  const materials = new Map([...(previous.materials ?? []), ...(delta.materials ?? [])].map(material => [material.id, material]));
  return {
    ...delta,
    buildings: [...previous.buildings.filter(building => !changedParcels.has(building.parcel_id)), ...delta.buildings],
    refusals: [...previous.refusals.filter(refusal => !changedParcels.has(refusal.parcel_id)), ...delta.refusals],
    open_spaces: [...previous.open_spaces.filter(space => !changedParcels.has(space.parcel_id)), ...delta.open_spaces],
    materials: [...materials.values()],
    plan_archives: { ...previous.plan_archives, ...delta.plan_archives },
  };
}
export { projectRustTown } from './rustTownProjection';
import { projectRustTown } from './rustTownProjection';

/** Execute only invalidated native stages; house edits do not rerun terrain, layouts or cadastral partition. */
/** Free the dedicated native sessions of the concurrent city lanes (one raster each). */
export async function releaseUrbanLanes(): Promise<void> {
  const lanes = [...engines.entries()].filter(([name]) => name.includes('|lane'));
  for (const [name] of lanes) engines.delete(name);
  await Promise.all(
    lanes.map(async ([name, retained]) => {
      try {
        await (await retained.engine).release?.({ profile: 'local', server: name.split('|')[1] });
      } catch {
        /* best effort */
      }
    }),
  );
}
export async function generateRustTown(
  world: World,
  settings: V2Settings,
  key: string,
  onProgress?: ProgressCallback,
  through?: V2TownStage,
  lane?: number,
  /** Claims of the earlier neighbouring towns; read from the world's retained towns when absent (`townNeighbours`). */
  neighbourClaims?: readonly Claim[],
  retainedLayouts?: Layout[],
): Promise<RustTownResult> {
  const place = world.settlements?.find(s => s.key === key);
  if (!place) throw new Error(`Lieu inconnu : ${key}`);
  const backend = urbanBackend(settings);
  if (backend === 'typescript') throw new Error('Sélectionnez le moteur urbain Rust pour ses étapes indépendantes.');
  const options = { ...settings.options, ...settings.local[key], culture: settings.local[key]?.culture ?? String(world.stats['v2.culture:' + key] ?? place.culture), population: settings.local[key]?.population ?? Number(world.stats['v2.population:' + key] ?? place.population) };
  const resolved = resolveRustUrbanControls(settings, key, options),
    local = settings.urban?.local?.[key];
  // Same site archetype as City Bench's quarters request (kinds.rs reads it for the village form and the defences).
  const geometry = geometryConfigs(resolved.layout, resolved.parcels);
  const config = { ...resolved, ...geometry, layout: { ...geometry.layout, siteArchetypes: townSiteArchetypes(world, key, resolved.layout.siteArchetypes) } };
  const target = through ?? local?.through ?? settings.urban?.through ?? 'buildings';
  const stageIndex = ['layout', 'parcels', 'programme', 'buildings'].indexOf(target);
  if (stageIndex < 0) throw new Error('Étape urbaine inconnue.');
  const runtime = backend === 'native' ? { profile: 'local' as const, server: settings.runtime?.localServer ?? 'http://127.0.0.1:8791' } : undefined;
  // The last stage label: a request that shows the engine loading or the terrain upload restores it afterwards.
  let shown: V2Progress | undefined;
  const report = (stage: string, label: string, completed: number, total = 5): void => {
    shown = { stage, label, completed, total };
    onProgress?.(shown);
  };
  const previous = (world.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined)?.[key];
  const roads = townRoadStreets(world);
  const seed = urbanSeed(settings, key, 'composition'),
    streetSeed = urbanSeed(settings, key, 'streets');
  // A town is regenerated when the claims of its neighbours change; a town without neighbours keeps its key and payload.
  const neighbours = [...(neighbourClaims ?? neighbourClaimsOf(world, settings, key))];
  // The engine build is part of the key: a rebuilt engine recomposes the town instead of reusing the old binary's plan.
  const compositionKey = townCompositionFingerprint(
    ['household-mix-1', world.stats['v2.terrainKey'], ...(world.stats['v2.waterEditRevision'] ? [world.stats['v2.waterEditRevision']] : []), key, backend, engineIdentityOf(settings, backend), seed, place.center, options.population, options.culture, config.layout],
    roads,
    neighbours.length ? [neighbourFingerprint(neighbours)] : [],
  );
  const layoutKey = streetSeed === seed ? compositionKey : fingerprint([compositionKey, streetSeed]);
  const previousComposition = previous?.compositionKey === compositionKey ? previous.compositionLayouts : !previous?.compositionKey && previous?.layoutKey === compositionKey ? previous.layouts : undefined;
  let snapshot: RustTownSnapshot =
    !retainedLayouts && previous?.layoutKey === layoutKey
      ? cloneRustTownSnapshot(previous)
      : { backend: backend === 'native' ? 'rust-native-cpu' : 'rust-wasm-cpu', stage: 'layout', layoutKey, compositionKey, compositionLayouts: previousComposition, layouts: retainedLayouts ?? [], streetEdits: previous?.streetEdits, buildingIds: [], warnings: [] };
  // Reuse one terrain handle for this ordered request chain, not one copy for each urban step.
  let engine: UrbanEngine | undefined;
  const request = async (kind: 'quarters' | 'parcels' | 'programme' | 'buildingSites' | 'builtCapacity', extras: Record<string, unknown>): Promise<SiteResponse> => {
    let raster: SettlementRaster | undefined;
    const engineKey = `${backend}|${runtime?.server ?? ''}${lane === undefined ? '' : `|lane${lane}`}`;
    let retained = engines.get(engineKey);
    let resume: V2Progress | undefined;
    if (!retained) {
      resume = shown;
      report('urban-engine', backend === 'native' ? 'Loading the native Rust urban engine…' : 'Loading the Rust/WASM urban engine…', 0);
      const module = await import('../../../rust/bridge/urban');
      retained = { engine: module.createUrbanEngine(runtime) };
      engines.set(engineKey, retained);
    }
    try {
      engine ??= await retained.engine;
    } catch (error) {
      engines.delete(engineKey);
      throw error;
    }
    const terrainKey = String(world.stats['v2.terrainKey']) + (world.stats['v2.waterEditRevision'] ? `/water-edit/${world.stats['v2.waterEditRevision']}` : '');
    // Concurrent cities: exactly one request uploads the terrain; the others wait for it (or take over if it failed).
    let primed: (() => void) | undefined;
    while (retained.terrainKey !== terrainKey) {
      if (retained.priming) {
        await retained.priming;
        continue;
      }
      raster = rustSettlementRaster(world);
      retained.priming = new Promise<void>(resolve => {
        primed = resolve;
      });
      break;
    }
    if (raster) {
      resume ??= shown;
      report('urban-terrain', 'Sending the terrain to the urban engine…', 0);
    }
    const resumed = (): void => {
      if (resume) report(resume.stage, resume.label, resume.completed, resume.total);
      resume = undefined;
    };
    if (!raster) resumed();
    // Native session chain: send handles for the products the engine already holds (never with a terrain upload).
    const held = backend === 'native' && !raster ? retained : undefined;
    let input = extras;
    if (held && kind === 'parcels' && held.layouts && extras.layouts === held.layouts) {
      const { layouts: _sent, ...rest } = extras;
      input = { ...rest, layoutsId: 1 };
    } else if (held && kind === 'programme' && held.layouts && held.partitions && extras.layouts === held.layouts && extras.partitions === held.partitions) {
      const { layouts: _l, partitions: _p, ...rest } = extras;
      input = { ...rest, retained: true };
    } else if (held && kind === 'buildingSites' && held.source && held.partitions && extras.partitions === held.partitions && extras.layouts === held.layouts) {
      const { layouts: _l, partitions: _p, ...rest } = extras;
      input = { ...rest, source: held.source };
    }
    if (raster || kind === 'quarters') {
      retained.layouts = retained.partitions = retained.source = undefined;
    }
    // Engine-held parcels are never uploaded: a programme that cannot continue the session asks for them again.
    if (kind === 'programme' && heldPartitions.has(extras.partitions as Partition[]) && input === extras) {
      if (primed) {
        retained.priming = undefined;
        primed();
      }
      return { id: 1, error: '[held_partitions] The engine no longer holds these parcels.' };
    }
    const { visuals, ...sent } = input as Record<string, unknown> & { visuals?: boolean };
    // City volumes: the binary site projection of the retained snapshot; complete requests stay in the engine.
    if (kind === 'buildingSites' && visuals && held?.source && input !== extras && runtime) {
      const query: UrbanBuildingSiteQuery = { source: held.source, seed: String(extras.seed), ...(typeof extras.architectureCulture === 'string' ? { architectureCulture: extras.architectureCulture } : {}) };
      try {
        const [{ readUrbanSiteVisuals }, { decodeCitySiteVisuals }] = await Promise.all([import('../../../rust/bridge/urbanDisplay'), import('../render/cityDisplayBuffers')]);
        return { id: 1, sites: decodeCitySiteVisuals(await readUrbanSiteVisuals(query, runtime)) as unknown as UrbanSiteVisual[], siteQuery: query };
      } catch (error) {
        return { id: 1, error: String(error) };
      }
    }
    input = sent;
    const { visuals: _visuals, ...plain } = extras;
    extras = plain;
    try {
      const pending = engine.run({ id: 1, kind, seed, runtime, ...(raster ? { raster } : {}), ...input } as Parameters<UrbanEngine['run']>[0], { terrainSent: resumed });
      if (kind === 'quarters' && backend === 'native') {
        // The engine composes the town on its own thread: meanwhile this worker computes the raster-only fields of the
        // land-use stage that follows (finishTowns), once the request has left (one macrotask).
        await new Promise(resolve => setTimeout(resolve, 0));
        try {
          (await import('../ui/urbanLanduseData')).prewarmUrbanLanduse(rustSettlementRaster(world));
        } catch (error) {
          console.warn('Land-use prewarm failed:', error);
        }
      }
      let result = await pending;
      resumed();
      // An engine without the retained chain (or a session evicted meanwhile): upload the geometry as before.
      if (result.error && input !== extras && !heldPartitions.has(extras.partitions as Partition[])) result = await engine.run({ id: 1, kind, seed, runtime, ...extras });
      // Parcels, programme and built capacity reply with a binary pack: the snapshot and the projection read objects
      // (a built-capacity pack takes its parcels from the uploaded partitions).
      if (result.partitionsPack && !result.partitions) result.partitions = partitionsFromPack(result.partitionsPack, extras.partitions as Partition[] | undefined);
      if (!result.error && raster) retained.terrainKey = terrainKey;
      if (backend === 'native' && !result.error) {
        if (kind === 'quarters') retained.layouts = result.layouts;
        else if (kind === 'parcels' || kind === 'programme') {
          // A handle-only parcels reply: the engine holds them; a unique marker stands for them in this chain.
          if (!result.partitions && result.urbanSource) {
            const marker: Partition[] = [];
            heldPartitions.add(marker);
            result.partitions = marker;
          }
          retained.partitions = result.partitions;
          retained.source = result.urbanSource;
        }
      } else if (backend === 'native') retained.layouts = retained.partitions = retained.source = undefined;
      return result;
    } finally {
      if (primed) {
        retained.priming = undefined;
        primed();
      }
    }
  };
  if (!snapshot.layouts.length) {
    const site = cityNamedSite({ key, name: place.name, population: options.population, culture: options.culture, center: place.center, radius: place.radius }, world.seed, options.language);
    const inputs = { sites: [neighbours.length ? { ...site, neighbours } : site], roads };
    if (!snapshot.compositionLayouts) {
      report('urban-layout', `Rust · urban composition… (${place.name ?? key})`, 0);
      snapshot.compositionLayouts = required<Layout[]>(await request('quarters', { ...inputs, layoutConfig: config.layout }), 'layouts');
    }
    snapshot.compositionKey = compositionKey;
    if (streetSeed === seed) snapshot.layouts = snapshot.compositionLayouts;
    else {
      report('urban-layout', 'Rust · nouveau tracé des rues internes, composition conservée…', 0);
      snapshot.layouts = required<Layout[]>(await request('quarters', { ...inputs, layoutConfig: streetSeedConfig(config.layout, snapshot.compositionLayouts, streetSeed) }), 'layouts');
    }
    snapshot.roadSources = snapshot.layouts.map(l => ({ layout: l.key, streets: l.streets }));
    snapshot.layouts = replayUrbanRoadEdits(snapshot.layouts, snapshot.streetEdits ?? []);
    if (snapshot.streetEdits?.length) {
      const changes = { old: snapshot.streetEdits.flatMap(e => (e.original ? [e.original.path] : [])), next: snapshot.streetEdits.flatMap(e => e.parts.map(p => p.street.path)) };
      snapshot.layouts = snapshot.layouts.map(l => roadBlockScope(l, changes).layout);
    }
    snapshot.warnings.push(...snapshot.layouts.flatMap(layout => layout.warnings));
  } else report('urban-layout', 'Rust · plan urbain réutilisé', 1);
  snapshot.compositionKey ??= compositionKey;
  snapshot.compositionLayouts ??= snapshot.layouts;
  config.parcels = runtimeBlockEdits(config.parcels, snapshot.layouts);
  const parcelSeed = urbanSeed(settings, key, 'parcels'),
    programmeSeed = urbanSeed(settings, key, 'programme');
  const buildingSeed = urbanSeed(settings, key, 'buildings'),
    houseSeed = urbanSeed(settings, key, 'houses');
  const parcelKey = fingerprint([...(parcelSeed === seed ? [layoutKey, config.parcels] : [layoutKey, config.parcels, parcelSeed]), ...(snapshot.streetEdits?.length ? [snapshot.streetEdits] : [])]);
  const programmeKey = programmeSeed === seed ? parcelKey : fingerprint([parcelKey, programmeSeed]);
  // Native chain through the programme: the cadastre stays in the engine (handle only, no download). A
  // programme rerun needs the cadastre again (the engine then holds the programme), so it recuts the parcels.
  const structuralBlocks = Object.values(config.parcels.overrides?.blocks ?? {}).some(e => e.shape || e.parts || e.deleted === true);
  const heldCadastre = backend === 'native' && stageIndex >= 2 && !structuralBlocks;
  const cadastre = async (handle: boolean): Promise<void> => {
    report('urban-parcels', 'Rust · découpage des parcelles et accès cadastraux…', 1);
    const response = await request('parcels', { seed: parcelSeed, layouts: snapshot.layouts, parcelConfig: config.parcels, ...(handle ? { reply: 'handle' } : {}) });
    snapshot.partitions = required<Partition[]>(response, 'partitions');
    if (snapshot.partitions.some(p => p.prepared))
      snapshot.layouts = snapshot.layouts.map(l => {
        const p = snapshot.partitions!.find(p => p.key === l.key);
        return p ? partitionLayout(l, p) : l;
      });
    snapshot.cadastralPartitions = snapshot.partitions;
    snapshot.programmePartitions = undefined;
    snapshot.parcelKey = parcelKey;
    snapshot.programmeKey = undefined;
    snapshot.requests = snapshot.sites = snapshot.siteQuery = undefined;
    snapshot.scene = undefined;
  };
  if (stageIndex >= 1 && (!snapshot.partitions || snapshot.parcelKey !== parcelKey || (heldCadastre && snapshot.programmeKey !== programmeKey && !snapshot.cadastralPartitions))) await cadastre(heldCadastre);
  if (stageIndex >= 2 && snapshot.programmeKey !== programmeKey) {
    report('urban-programme', 'Rust · fonctions, besoins, capacités et affectation des parcelles…', 2);
    const programme = () => request('programme', { seed: programmeSeed, layouts: snapshot.layouts, partitions: snapshot.cadastralPartitions ?? snapshot.partitions, parcelConfig: config.parcels });
    let response = await programme();
    if (response.error?.includes('[held_partitions]')) {
      await cadastre(false);
      response = await programme();
    }
    snapshot.partitions = required<Partition[]>(response, 'partitions');
    if (snapshot.cadastralPartitions && heldPartitions.has(snapshot.cadastralPartitions)) snapshot.cadastralPartitions = undefined;
    snapshot.programmePartitions = snapshot.partitions;
    snapshot.programmeKey = programmeKey;
    snapshot.requests = snapshot.sites = snapshot.siteQuery = undefined;
    snapshot.scene = undefined;
    snapshot.capacityKey = undefined;
  }
  if (stageIndex >= 3) {
    const { architectureProfile } = await import('../../../rust/bridge/urbanArchitecture');
    const architecture = cityArchitectureOf(settings.urban?.architecture);
    const buildingEdits = Object.fromEntries(
      Object.entries(settings.urban?.buildings ?? {})
        .filter(([id]) => id.startsWith(`${key}/`))
        .map(([id, edit]) => [id.slice(key.length + 1), edit]),
    );
    const profile = architectureProfile(localArchitectureSettings(config.houses, resolved.layout, runtimeBlockEdits(resolved.parcels, snapshot.layouts), buildingEdits, architecture === 'silhouette')),
      requestKey = fingerprint(buildingSeed === seed ? [programmeKey, profile] : [programmeKey, profile, buildingSeed]);
    const siteBaseKey = fingerprint([programmeKey, buildingSeed]);
    const styleOnlyChange = !!snapshot.scene && snapshot.siteBaseKey === siteBaseKey && snapshot.requestKey !== requestKey;
    // Same default as City Bench and the v7 sheets: city volumes raised by urban/massing.rs.
    // The houses crate only runs for the compact/detailed architectures and for edited houses.
    const siteInput = () => ({ seed: buildingSeed, layouts: snapshot.layouts, partitions: snapshot.programmePartitions ?? snapshot.partitions, architectureCulture: profile });
    /** Complete requests from the JSON stage (houses crate input). */
    const fullSites = async (): Promise<PlacementRequest[]> => required<PlacementRequest[]>(await request('buildingSites', siteInput()), 'placementRequests');
    if (!snapshot.sites || snapshot.requestKey !== requestKey) {
      report('urban-building-sites', 'Rust · domaines constructibles, accès et contraintes des maisons…', 3);
      snapshot.requests = snapshot.siteQuery = undefined;
      const response = await request('buildingSites', { ...siteInput(), visuals: architecture === 'silhouette' });
      if (response.error) throw new Error(response.error);
      if (response.sites) {
        snapshot.sites = response.sites;
        snapshot.siteQuery = response.siteQuery;
      } else {
        const requests = required<PlacementRequest[]>(response, 'placementRequests');
        snapshot.sites = requests.map((request, offset) => projectUrbanSite(request as CityPlacementRequest, offset));
        // City volumes keep only the projection; the complete requests stay in this worker for edits.
        if (architecture === 'silhouette') wasmSiteRequests.set(snapshot.sites, requests);
        else snapshot.requests = requests;
      }
      snapshot.requestKey = requestKey;
      if (!styleOnlyChange) snapshot.scene = undefined;
    }
    snapshot.siteBaseKey = siteBaseKey;
    const sites = snapshot.sites!;
    const previousSites = new Map(previous?.sites?.map(site => [site.id, site]));
    const changedStyles = new Set(styleOnlyChange ? sites.filter(site => fingerprint([previousSites.get(site.id)?.culture, previousSites.get(site.id)?.programme]) !== fingerprint([site.culture, site.programme])).map(site => site.id) : []);
    /** Complete requests of the given sites: read by id from the engine session, else from this worker's retained stage. */
    const completeSites = async (ids: Set<string>): Promise<PlacementRequest[]> => {
      if (snapshot.requests) return snapshot.requests.filter(request => ids.has(request.id));
      const picked = sites.filter(site => ids.has(site.id));
      // A few edited houses read their sites by id; a whole town (houses crate) takes the stage in one reply.
      if (snapshot.siteQuery && runtime && picked.length <= 32) {
        const { readUrbanBuildingSite } = await import('../../../rust/bridge/urbanBuildingSite');
        try {
          return await Promise.all(picked.map(site => readUrbanBuildingSite(snapshot.siteQuery!, runtime, site.offset, site.id, sites.length)));
        } catch {
          /* The engine moved on to another snapshot: recompute the stage below. */
        }
      }
      const all = wasmSiteRequests.get(sites) ?? (await fullSites());
      return all.filter(request => ids.has(request.id));
    };
    if (styleOnlyChange && previous?.requests?.length === sites.length) {
      const updates = new Map((await completeSites(changedStyles)).map(request => [request.id, request]));
      snapshot.requests = previous.requests.map(request => updates.get(request.id) ?? request);
    }
    const retainedBuildings = new Map(previous?.scene?.buildings.map(building => [building.id, building]));
    const blockHouseEdits = Object.values(resolved.parcels.overrides?.blocks ?? {}).some(edit => edit.houseConfig);
    const relevantOverrides = Object.fromEntries(
      sites.flatMap(request => {
        const own = settings.urban?.buildings?.[`${key}/${request.id}`] ?? settings.urban?.buildings?.[request.id];
        const patch = scopedHouseEdit(resolved.layout, resolved.parcels, siteQuarter(snapshot.layouts, request), request.parcel_id, own, blockHouseEdits ? siteBlock(snapshot.layouts, request) : undefined);
        if (architecture === 'silhouette' && (!retainedBuildings.get(request.id) || retainedBuildings.get(request.id)?.recipe_id === 'silhouette') && isMassingEdit(patch)) {
          if (!massingEditApplied(request.programme, patch)) throw new Error('Update the Rust engine to edit the roof or storeys while retaining the existing footprint.');
          return [];
        }
        return Object.keys(patch).length ? [[request.id, patch]] : [];
      }),
    );
    const changedOverrides = new Set([...Object.keys(relevantOverrides), ...Object.keys(snapshot.houseOverrides ?? {})].filter(id => fingerprint(relevantOverrides[id]) !== fingerprint(snapshot.houseOverrides?.[id])));
    changedStyles.forEach(id => changedOverrides.add(id));
    const buildingKey = fingerprint(houseSeed === seed ? [architecture, requestKey, config.houses, relevantOverrides] : [architecture, requestKey, config.houses, relevantOverrides, houseSeed]);
    if (architecture === 'silhouette' && (!snapshot.scene || snapshot.buildingKey !== buildingKey)) {
      report('urban-buildings', 'Rust · city volumes…', 4);
      const sourceScene = siteVisualScene(sites);
      if (styleOnlyChange)
        requireHouseEditSuccess(
          sourceScene,
          sites.filter(site => changedStyles.has(site.id) && previous?.scene?.buildings.some(building => building.parcel_id === site.parcel_id)),
        );
      const reuseScene = (previous?.requestKey === requestKey || styleOnlyChange) && snapshot.scene && previous?.houseSettingsKey === fingerprint([config.houses, houseSeed]);
      let scene = reuseScene ? snapshot.scene! : sourceScene;
      if (reuseScene) {
        const resetParcels = new Set(sites.filter(site => changedOverrides.has(site.id)).map(site => site.parcel_id));
        scene = { ...scene, buildings: [...scene.buildings.filter(b => !resetParcels.has(b.parcel_id)), ...sourceScene.buildings.filter(b => resetParcels.has(b.parcel_id))] };
      }
      const edits = Object.keys(relevantOverrides).filter(id => !reuseScene || changedOverrides.has(id));
      const edited = edits.length ? await completeSites(new Set(edits)) : [];
      if (edited.length) {
        // An edited house is planned by the houses crate inside its lot; every other lot keeps its volume.
        const { planUrbanBuildings } = await import('../../../rust/bridge/architecture');
        const { defaultHouseConfig } = await import('../../../rust/bridge/houses');
        const parcels = new Set(edited.map(request => request.parcel_id));
        const requests = withRetainedNeighbors(
          edited.map(request => {
            const patch = relevantOverrides[request.id],
              draw = patch.seed ?? (houseSeed === seed ? request.seed : `${houseSeed}/${request.id}`);
            return applyHouseEdit(request, merge<HouseConfig>(defaultHouseConfig(), { pack: request.culture.pack, mode: request.culture.mode }, request.config, config.houses.house_config, patch, { seed: draw, count: 1 }));
          }),
          scene.buildings.filter(building => !parcels.has(building.parcel_id)),
        );
        const planned = await planUrbanBuildings({ schema_version: '1', requests, settings: { ...config.houses, house_config: undefined, floors: undefined } }, runtime);
        requireHouseEditSuccess(planned, requests);
        scene = {
          ...scene,
          buildings: [...scene.buildings.filter(building => !parcels.has(building.parcel_id)), ...planned.buildings],
          refusals: planned.refusals,
          open_spaces: [...scene.open_spaces.filter(space => !parcels.has(space.parcel_id)), ...planned.open_spaces],
          materials: planned.materials,
          ...(planned.plan_archives ? { plan_archives: planned.plan_archives } : {}),
        };
      }
      snapshot.scene = scene;
      snapshot.houseBaseline = undefined;
      snapshot.lastBuildingRequests = edited.length + changedStyles.size;
      snapshot.houseSettingsKey = fingerprint([config.houses, houseSeed]);
      snapshot.partitions = snapshot.programmePartitions ?? snapshot.partitions;
      snapshot.houseOverrides = structuredClone(relevantOverrides);
      snapshot.buildingKey = buildingKey;
      // As in City Bench, volumes keep the programme's own capacities (no built-capacity balance).
      snapshot.capacityKey = buildingKey;
    } else if (architecture === 'silhouette') {
      snapshot.lastBuildingRequests = 0;
      report('urban-buildings', 'Rust · city volumes reused', 5);
    } else if (!snapshot.scene || snapshot.buildingKey !== buildingKey) {
      report('urban-buildings', 'Chargement du moteur Rust des maisons…', 4);
      snapshot.requests ??= await completeSites(new Set(sites.map(site => site.id)));
      const { planUrbanBuildings } = await import('../../../rust/bridge/architecture');
      const houseSettingsKey = fingerprint(houseSeed === seed ? config.houses : [config.houses, houseSeed]),
        baselineKey = fingerprint([requestKey, houseSettingsKey]);
      const sourceRequests =
        houseSeed === seed
          ? snapshot.requests
          : snapshot.requests.map(request => {
              const draw = `${houseSeed}/${request.id}`;
              return { ...request, seed: draw, ...(request.config ? { config: { ...request.config, seed: draw } } : {}) };
            });
      let baseline: PlacementBatch,
        baselineRequests = 0;
      const reuseBaseline = !!snapshot.scene && (snapshot.houseBaseline?.key === baselineKey || (styleOnlyChange && snapshot.houseSettingsKey === houseSettingsKey));
      if (reuseBaseline && snapshot.scene && snapshot.houseBaseline) {
        snapshot.houseBaseline = { key: baselineKey, originals: { ...snapshot.houseBaseline.originals } };
        let retainedScene = snapshot.scene;
        if (changedStyles.size) {
          const changed = sourceRequests.filter(request => changedStyles.has(request.id));
          const sources = await planUrbanBuildings({ schema_version: '1', requests: changed, settings: config.houses }, runtime);
          requireHouseEditSuccess(sources, changed);
          retainedScene = mergeHouseDelta(retainedScene, sources, new Set(changed.map(request => request.parcel_id)));
          baselineRequests = changed.length;
          for (const id of changedStyles) delete snapshot.houseBaseline.originals[id];
        }
        const originals = Object.entries(snapshot.houseBaseline.originals)
          .filter(([id]) => changedOverrides.has(id))
          .map(([, original]) => original);
        baseline = originals.length
          ? mergeHouseDelta(
              retainedScene,
              { ...retainedScene, buildings: originals.flatMap(value => value.buildings), refusals: originals.flatMap(value => value.refusals), open_spaces: originals.flatMap(value => value.open_spaces) },
              new Set(originals.map(value => value.parcelId)),
            )
          : retainedScene;
      } else {
        report('urban-buildings', 'Rust · plans sources des maisons avant les modifications individuelles…', 0, snapshot.requests.length);
        baseline = await planUrbanBuildings({ schema_version: '1', requests: sourceRequests, settings: config.houses }, runtime, { progress: (completed, total) => report('urban-buildings', `Rust · maisons sources ${completed}/${total}…`, completed, total) });
        baselineRequests = snapshot.requests.length;
        snapshot.houseBaseline = { key: baselineKey, originals: {} };
      }
      // Canonical replay: restore only touched source houses, then apply the
      // current explicit house overrides in stable site order. A seed/recipe
      // import follows exactly the same path as an interactive local edit.
      let requests = sourceRequests.filter(request => relevantOverrides[request.id] && (!reuseBaseline || changedOverrides.has(request.id)));
      const changedParcels = new Set(requests.map(request => request.parcel_id));
      for (const request of requests)
        if (!snapshot.houseBaseline!.originals[request.id]) {
          snapshot.houseBaseline!.originals[request.id] = {
            parcelId: request.parcel_id,
            buildings: baseline.buildings.filter(building => building.parcel_id === request.parcel_id),
            refusals: baseline.refusals.filter(refusal => refusal.parcel_id === request.parcel_id),
            open_spaces: baseline.open_spaces.filter(space => space.parcel_id === request.parcel_id),
          };
        }
      if (Object.keys(relevantOverrides).length) {
        const { defaultHouseConfig } = await import('../../../rust/bridge/houses');
        requests = requests.map(request => {
          const patch = relevantOverrides[request.id];
          if (!patch) return request;
          const seed = patch.seed ?? request.seed;
          const house = merge<HouseConfig>(defaultHouseConfig(), { pack: request.culture.pack, mode: request.culture.mode }, request.config, config.houses.house_config, config.houses.floors === undefined ? undefined : { overrides: { floors: config.houses.floors } }, patch, {
            seed,
            count: 1,
          });
          return applyHouseEdit(request, house);
        });
      }
      requests = withRetainedNeighbors(
        requests,
        baseline.buildings.filter(building => !changedParcels.has(building.parcel_id)),
      );
      // The native batch header deliberately outranks request.config. Split only
      // at explicit per-house overrides so a global floor/model control cannot
      // overwrite the user's more local choice. Keep original order and pass
      // earlier groups as binding occupations to the following group.
      const groups: { requests: PlacementRequest[]; settings: PlacementBatchSettings; key: string }[] = [];
      for (const request of requests) {
        const specific = relevantOverrides[request.id];
        const header = specific ? { ...config.houses, floors: undefined, house_config: undefined } : config.houses;
        const headerKey = fingerprint(header),
          previous = groups[groups.length - 1];
        if (previous?.key === headerKey) previous.requests.push(request);
        else groups.push({ requests: [request], settings: header, key: headerKey });
      }
      let delta: PlacementBatch | undefined,
        done = 0;
      for (const group of groups) {
        const batch = await planUrbanBuildings({ schema_version: '1', requests: delta ? withRetainedNeighbors(group.requests, delta.buildings) : group.requests, settings: group.settings }, runtime, {
          progress: completed => report('urban-buildings', `Rust · maisons ${done + completed}/${requests.length}…`, done + completed, requests.length),
        });
        requireHouseEditSuccess(batch, group.requests);
        delta = delta ? mergeHouseDelta(delta, batch, new Set()) : batch;
        done += group.requests.length;
      }
      snapshot.scene = delta ? mergeHouseDelta(baseline, delta, changedParcels) : baseline;
      const order = new Map(snapshot.requests.map((request, index) => [request.parcel_id, index]));
      const byParcel = (a: { parcel_id: string }, b: { parcel_id: string }) => (order.get(a.parcel_id) ?? 0) - (order.get(b.parcel_id) ?? 0);
      snapshot.scene = { ...snapshot.scene, buildings: [...snapshot.scene.buildings].sort(byParcel), refusals: [...snapshot.scene.refusals].sort(byParcel), open_spaces: [...snapshot.scene.open_spaces].sort(byParcel) };
      // Houses returns an open outcome; its architectural deficit is declared by
      // the actual Core request. Join the two on the whole retained scene (as
      // the CityBench scene stream does) so built capacity and every display
      // read one attested outcome. Idempotent on already carried baselines.
      snapshot.scene = carryUrbanOpenDeficits(snapshot.partitions!, snapshot.scene, snapshot.requests);
      for (const id of Object.keys(snapshot.houseBaseline!.originals)) if (!relevantOverrides[id]) delete snapshot.houseBaseline!.originals[id];
      if (snapshot.scene.plan_archives) {
        const retainedArchives = new Set<string>();
        const retain = (building: PlacementBatch['buildings'][number]): void => {
          const resolved = building.resolved as { archive_id?: unknown } | undefined;
          if (resolved && typeof resolved.archive_id === 'string') retainedArchives.add(resolved.archive_id);
        };
        snapshot.scene.buildings.forEach(retain);
        for (const original of Object.values(snapshot.houseBaseline!.originals)) original.buildings.forEach(retain);
        snapshot.scene.plan_archives = Object.fromEntries(Object.entries(snapshot.scene.plan_archives).filter(([id]) => retainedArchives.has(id)));
      }
      snapshot.lastBuildingRequests = baselineRequests + requests.length;
      snapshot.houseSettingsKey = houseSettingsKey;
      // Settings remain editable after a generation. Retained provenance owns
      // its small patch records; it must not alias a later input edit.
      snapshot.houseOverrides = structuredClone(relevantOverrides);
      snapshot.buildingKey = buildingKey;
    } else {
      snapshot.lastBuildingRequests = 0;
      report('urban-buildings', 'Rust · maisons conservées réutilisées', 5);
    }
    const forcedTypes = new Map(Object.entries(resolved.parcels.overrides?.parcels ?? {}).flatMap(([id, edit]) => (edit.role && edit.role !== 'auto' && !edit.role.startsWith('open.') ? [[id, edit.role] as const] : [])));
    if (Object.values(resolved.parcels.overrides?.blocks ?? {}).some(edit => edit.role && edit.role !== 'auto' && !edit.role.startsWith('open.'))) {
      for (const site of sites) {
        const block = siteBlock(snapshot.layouts, site),
          role = block === undefined ? undefined : resolved.parcels.overrides?.blocks?.[block]?.role;
        if (role && role !== 'auto' && !role.startsWith('open.')) forcedTypes.set(site.parcel_id, role);
      }
    }
    // A lot's fence edit reaches its house yard (`YardHouse.enclosure`, cityLotEnclosures.ts); the engine never sets it.
    const fences = resolved.parcels.overrides?.parcels ?? {};
    type Fenced = PlacementBatch['buildings'][number] & { enclosure?: string };
    if (snapshot.scene && (Object.values(fences).some(edit => edit.enclosure) || snapshot.scene.buildings.some(building => (building as Fenced).enclosure))) {
      snapshot.scene = {
        ...snapshot.scene,
        buildings: snapshot.scene.buildings.map(building => {
          const kind = fences[building.parcel_id]?.enclosure,
            own = (building as Fenced).enclosure;
          if (kind === own) return building;
          const next: Fenced = { ...building };
          if (kind) next.enclosure = kind;
          else delete next.enclosure;
          return next;
        }),
      };
    }
    // A forced use the lot cannot carry (size, slope, no model) leaves it open: name the cause (main.ts words it).
    for (const [parcel, role] of forcedTypes) {
      const open = snapshot.scene!.open_spaces.find(space => space.parcel_id === parcel && space.deficit);
      if (open) throw new Error(`forced_use_refused:${open.deficit!.cause}:${role}`);
    }
    if (forcedTypes.size)
      requireHouseEditSuccess(
        snapshot.scene!,
        [...forcedTypes.keys()].map(parcel_id => ({ id: `${parcel_id}/building`, parcel_id })),
      );
    if (snapshot.capacityKey !== buildingKey) {
      report('urban-built-capacity', 'Rust · bilan du programme d’après les plans bâtis conservés…', 4);
      const balanced = required<Partition[]>(await request('builtCapacity', { layouts: snapshot.layouts, partitions: snapshot.partitions, scene: snapshot.scene, parcelConfig: config.parcels }), 'partitions');
      // Reconciliation is an evidence calculation, not a cadastral edit. Keep
      // authoritative parcel objects instead of installing a second JSON
      // floating-point round trip of their coordinates and access contacts.
      const byKey = new Map(balanced.map(partition => [partition.key, partition]));
      snapshot.partitions = snapshot.partitions!.map(partition => {
        const report = byKey.get(partition.key);
        if (!report) throw new Error(`Missing built-programme report for ${partition.key}.`);
        return { ...partition, programme: report.programme, warnings: report.warnings };
      });
      snapshot.capacityKey = buildingKey;
    }
  }
  // An earlier stopping stage intentionally removes the display of downstream products while retaining them for reuse.
  snapshot.stage = target;
  const townName = (other: string): string | undefined => world.names?.entries.find(entry => entry.id === `settlement:${other}`)?.text ?? world.settlements?.find(s => s.key === other)?.name;
  snapshot.warnings = [
    ...new Set([
      ...snapshot.layouts.flatMap(layout => layout.warnings.map(warning => nameNeighbourWarning(warning, townName))),
      ...(stageIndex >= 1 ? (snapshot.partitions?.flatMap(partition => partition.warnings) ?? []) : []),
      ...(stageIndex >= 3 ? (snapshot.scene?.refusals.map(refusal => `${refusal.code}: ${refusal.message}`) ?? []) : []),
    ]),
  ];
  const projection = stageIndex < 3 ? { ...snapshot, scene: undefined, partitions: stageIndex === 0 ? undefined : stageIndex === 1 ? (snapshot.cadastralPartitions ?? snapshot.partitions) : (snapshot.programmePartitions ?? snapshot.partitions) } : snapshot;
  const urban = projectRustTown(projection, options.population, options.culture);
  snapshot.buildingIds = projection.buildingIds;
  report('urban-complete', `Rust · ${target === 'buildings' ? 'maisons' : target === 'programme' ? 'programme' : target === 'parcels' ? 'parcelles' : 'plan'} prêt`, 5);
  return {
    urban,
    snapshot,
    stats: {
      'v2.urbanBackend': snapshot.backend,
      [`v2.urbanBackend:${key}`]: snapshot.backend,
      [`v2.urbanStage:${key}`]: target,
      [`v2.urbanRefusals:${key}`]: stageIndex >= 3 ? (snapshot.scene?.refusals.length ?? 0) : 0,
      [`v2.housesRegenerated:${key}`]: stageIndex >= 3 ? (snapshot.lastBuildingRequests ?? 0) : 0,
      [`v2.urbanWarnings:${key}`]: [...new Set(snapshot.warnings)].join(' | '),
    },
  };
}
