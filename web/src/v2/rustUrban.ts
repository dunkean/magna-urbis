import type { World, UrbanLayer, UrbanBuilding, PolyH, UrbanZone, StreetRole, Options } from '../gen/types';
import type { Layout, Partition, UrbanResponse, Street, UrbanEngine } from '../../../rust/bridge/urban';
import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urbanConfig';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, normalizeParcelConfig } from '../../../rust/bridge/urbanConfig';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import type { PlacementBatch, PlacementRequest, PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';
import type { HouseConfig } from '../../../rust/bridge/housesContract';
import type { V2Settings, V2TownStage, ProgressCallback, V2UrbanControls, V2UrbanSettings } from './contracts';
import { forCellsNearPolyline } from '../gen/core/field';
import { differenceS } from '../gen/geo/bool';
import { ribbon } from '../gen/geo/offset';
import { pointInRing } from '../gen/geo/poly';

export interface RustTownSnapshot {
  backend: 'rust-wasm-cpu' | 'rust-native-cpu';
  stage: V2TownStage;
  layoutKey: string;
  parcelKey?: string;
  programmeKey?: string;
  requestKey?: string;
  buildingKey?: string;
  /** Reconciled native programme evidence for this exact retained house scene. */
  capacityKey?: string;
  layouts: Layout[];
  partitions?: Partition[];
  requests?: PlacementRequest[];
  scene?: PlacementBatch;
  houseSettingsKey?: string;
  houseOverrides?: Record<string, Partial<HouseConfig>>;
  lastBuildingRequests?: number;
  houseBaseline?: { key: string; originals: Record<string, Pick<PlacementBatch, 'buildings' | 'refusals' | 'open_spaces'> & { parcelId: string }> };
  /** Projection indexes refer to the actual native placement ids, not an invented TS house recipe. */
  buildingIds: string[];
  warnings: string[];
}
export interface RustTownResult { urban: UrbanLayer; snapshot: RustTownSnapshot; stats: Record<string, string | number> }
const engines = new Map<string, { engine: Promise<UrbanEngine>; terrainKey?: string }>();
interface RasterCacheEntry {
  width: number; cell: number; water: World['terrain']['water']; filled: World['terrain']['filled']; seaLevel: number;
  coastline: World['terrain']['coastline']; islands: World['terrain']['islands']; lakes: World['terrain']['lakes'];
  rivers: { path: World['terrain']['rivers'][number]['path']; width: World['terrain']['rivers'][number]['width']; id: number | undefined }[];
  raster: SettlementRaster;
}
const physicalRasters = new WeakMap<World['terrain']['height'], RasterCacheEntry>();
/** Native stage products are immutable. Transitions replace only changed
 * containers; old snapshots, geometry and compressed plans remain exact. */
export function cloneRustTownSnapshot(snapshot: RustTownSnapshot): RustTownSnapshot { return { ...snapshot }; }

function merge<T>(...sources: unknown[]): T {
  const out: Record<string, unknown> = {};
  for (const source of sources) if (source && typeof source === 'object') for (const [key, value] of Object.entries(source)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && !(ArrayBuffer.isView(value))
      ? merge(out[key], value) : value;
  }
  return out as T;
}
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
export function urbanBackend(settings: V2Settings): 'typescript' | 'rust' | 'native' {
  return settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
}

/** Retain cell-centred physical metres and the existing vector geography; never rerun terrain. */
export function rustSettlementRaster(world: World): SettlementRaster {
  const terrain = world.terrain, grid = terrain.height, n = grid.w, cell = grid.cell;
  if (grid.w !== grid.h) throw new Error('Le moteur urbain Rust requiert une grille carrée.');
  const cached = physicalRasters.get(grid);
  if (cached && cached.width === world.mapSize && cached.cell === cell && cached.raster.n === n && cached.raster.height === grid.data && cached.water === terrain.water && cached.filled === terrain.filled && cached.seaLevel === terrain.seaLevel
    && cached.coastline === terrain.coastline && cached.islands === terrain.islands && cached.lakes === terrain.lakes
    && cached.rivers.length === terrain.rivers.length && cached.rivers.every((river, i) => river.path === terrain.rivers[i].path && river.width === terrain.rivers[i].width && river.id === terrain.rivers[i].id)) return cached.raster;
  const waterLevel = new Float32Array(n * n), riverWidth = new Float32Array(n * n), riverIds = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < waterLevel.length; i++) if (terrain.water[i]) waterLevel[i] = terrain.water[i] === 1 ? terrain.seaLevel : Math.max(grid.data[i], terrain.filled[i]);
  for (const [index, river] of terrain.rivers.entries()) for (let j = 1; j < river.path.length; j++) {
    const width = Math.max(river.width[j - 1] ?? 1, river.width[j] ?? 1);
    forCellsNearPolyline([river.path[j - 1], river.path[j]], n, n, cell, Math.max(cell * .8, width / 2), i => {
      if (terrain.water[i] === 3 && width >= riverWidth[i]) { riverWidth[i] = width; riverIds[i] = river.id ?? index; }
    });
  }
  const square = [{ x: 0, y: 0 }, { x: world.mapSize, y: 0 }, { x: world.mapSize, y: world.mapSize }, { x: 0, y: world.mapSize }];
  const seaWater = terrain.coastline.map(outer => ({ outer, holes: (terrain.islands ?? []).filter(island => island.length && pointInRing(outer, island[0])) }));
  const water: PolyH[] = [...seaWater, ...terrain.lakes.map(outer => ({ outer, holes: [] }))];
  // Native geometry uses closed water domains, including the measured width of each river segment.
  // Raster river widths remain authoritative when a vector ribbon is absent.
  for (const river of terrain.rivers) if (river.path.length > 1) water.push({ outer: ribbon(river.path, river.width), holes: [] });
  // As in the original Rust bench adapter, the land envelope removes the sea;
  // lakes/rivers remain separate water constraints instead of a second expensive polygon boolean.
  const land = seaWater.length ? differenceS(square, seaWater) : [{ outer: square, holes: [] }];
  const raster: SettlementRaster = { width: world.mapSize, n, height: grid.data, water: terrain.water, waterLevel, riverWidth, riverIds,
    geometry: { land: land.flatMap(p => [p.outer, ...p.holes]), water: water.map(p => [p.outer, ...p.holes]) } };
  physicalRasters.set(grid, { width: world.mapSize, cell, water: terrain.water, filled: terrain.filled, seaLevel: terrain.seaLevel, coastline: terrain.coastline, islands: terrain.islands, lakes: terrain.lakes,
    rivers: terrain.rivers.map(river => ({ path: river.path, width: river.width, id: river.id })), raster });
  return raster;
}

export function resolveRustUrbanControls(settings: V2Settings, key: string, options: Options): { layout: LayoutConfig; parcels: ParcelConfig; houses: PlacementBatchSettings } {
  const base: Partial<V2UrbanSettings> = settings.urban ?? {}, local: V2UrbanControls = base.local?.[key] ?? {};
  if (options.plan) throw new Error('Le plan personnalisé TypeScript ne peut pas être traduit fidèlement vers Rust. Utilisez les paramètres Rust layout.phaseOverrides, ou le moteur urbain TypeScript.');
  if (options.cultureMix?.mode === 'blend') throw new Error('Le mélange continu TypeScript ne correspond pas aux phases ou secteurs Rust. Choisissez phases ou secteurs.');
  const layout = normalizeLayoutConfig(merge<LayoutConfig>(defaultLayoutConfig(), {
    culture: options.culture, density: 1 / (options.sprawl ?? 1), radiusScale: Math.sqrt(options.sprawl ?? 1),
    fortification: options.walls === 'none' || options.walls === 'no' ? 'none' : options.walls === 'auto' ? 'culture' : 'wall',
    suburbs: options.suburbs === 'some' ? 'few' : options.suburbs,
    ...(options.castle === 'yes' || Number(options.castles) > 0 ? { monument: 'castle' } : {}),
    ...(options.cathedral === 'yes' ? { monument: 'cathedral' } : {}),
    ...(options.palace === 'yes' ? { monument: 'palace' } : {}),
    ...(options.cultureMix ? { mixCulture: options.cultureMix.id, mixMode: options.cultureMix.mode, mixShare: options.cultureMix.t } : {}),
  }, base.layout, local.layout));
  const parcels = normalizeParcelConfig(merge<ParcelConfig>(defaultParcelConfig(), { culture: options.culture }, base.parcels, local.parcels));
  return { layout, parcels, houses: merge<PlacementBatchSettings>(base.houses, local.houses) };
}
function required<T>(response: UrbanResponse, field: keyof UrbanResponse): T {
  if (response.error) throw new Error(response.error);
  if (response[field] === undefined) throw new Error(`Le moteur Rust n’a pas renvoyé ${field}.`);
  return response[field] as T;
}
function surfaceBounds(surface: import('../../../rust/bridge/housesContract').Surface): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const piece of surface) for (const p of piece.outer) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
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
    return { ...request, neighbors: [...request.neighbors, ...neighbors.filter(({ bounds: b }) =>
      b.x0 <= bounds.x1 + 2 && b.x1 >= bounds.x0 - 2 && b.y0 <= bounds.y1 + 2 && b.y1 >= bounds.y0 - 2).map(({ building, occupation, height }) => ({
        id: `v2-retained:${building.id}`, footprint: occupation,
        height_m: height,
      }))] };
  });
}
function mergeHouseDelta(previous: PlacementBatch, delta: PlacementBatch, changedParcels: Set<string>): PlacementBatch {
  if (previous.generator_version !== delta.generator_version) throw new Error('Le moteur maisons a changé de version. Régénérez les maisons du lieu avant une modification individuelle.');
  const materials = new Map([...(previous.materials ?? []), ...(delta.materials ?? [])].map(material => [material.id, material]));
  return { ...delta, buildings: [...previous.buildings.filter(building => !changedParcels.has(building.parcel_id)), ...delta.buildings],
    refusals: [...previous.refusals.filter(refusal => !changedParcels.has(refusal.parcel_id)), ...delta.refusals],
    open_spaces: [...previous.open_spaces.filter(space => !changedParcels.has(space.parcel_id)), ...delta.open_spaces],
    materials: [...materials.values()], plan_archives: { ...previous.plan_archives, ...delta.plan_archives } };
}
const zones = new Set<UrbanZone>(['core', 'middle', 'edge', 'faubourg', 'village']);
const zone = (value?: string): UrbanZone => zones.has(value as UrbanZone) ? value as UrbanZone : 'core';
const roles = new Set<StreetRole>(['radial', 'ring', 'street', 'lane', 'close', 'quay', 'wall-lane', 'track', 'boundary']);
const nativeRequestIndexes = new WeakMap<PlacementRequest[], Map<string, string>>();
function requestIndex(requests?: PlacementRequest[]): ReadonlyMap<string, string> {
  if (!requests) return new Map();
  let index = nativeRequestIndexes.get(requests);
  if (!index) {
    index = new Map(); for (const request of requests) if (!index.has(request.parcel_id)) index.set(request.parcel_id, request.id);
    nativeRequestIndexes.set(requests, index);
  }
  return index;
}

/** A display projection of retained native geometry. The complete Rust snapshots remain available for inspection. */
export function projectRustTown(snapshot: RustTownSnapshot, population: number, culture: string): UrbanLayer {
  const layout = snapshot.layouts[0];
  if (!layout) throw new Error('Le moteur Rust a renvoyé un plan urbain vide.');
  const partition = snapshot.partitions?.[0];
  const footprintH = layout.structure?.allocated.length ? layout.structure.allocated : layout.quarters.map(q => q.shape);
  const buildings: UrbanBuilding[] = [], ids: string[] = [];
  // Preserve Array.find's first-match rule while avoiding a complete request
  // scan for every projected building/component of a large city.
  const requestByParcel = snapshot.scene?.buildings.length ? requestIndex(snapshot.requests) : new Map<string, string>();
  for (const building of snapshot.scene?.buildings ?? []) {
    const volumes = building.volumes, height = Math.max(0, ...volumes.map(v => v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m));
    const nativeRoof = volumes[0]?.roof_system ?? building.cartographic?.roof_system ?? '';
    const roof: UrbanBuilding['roof'] = /FLAT|TERRACE/.test(nativeRoof) ? 'flat' : /DOME/.test(nativeRoof) ? 'dome'
      : /CONE/.test(nativeRoof) ? 'conical' : /HIP/.test(nativeRoof) ? 'hip' : /PAGODA|CURVED/.test(nativeRoof) ? 'pagoda' : 'gable';
    for (const piece of building.footprint) {
      const projection: UrbanBuilding & { nativeId: string; nativeParcelId: string; nativeRequestId: string } = {
        // Native footprint holes already encode courts inside this exact component.
        // Adding the separate courtyard surface again would cancel even-odd holes in the V1 renderer.
        poly: piece.outer, courtyards: piece.holes,
        kind: building.function, height: height || building.cartographic?.height_m, arch: building.recipe_id, roof,
        storeys: Math.max(1, ...volumes.map(v => v.levels.length)), material: volumes[0]?.materials.infill,
        orientation: building.transform.orientation_deg * Math.PI / 180,
        nativeId: building.id, nativeParcelId: building.parcel_id,
        nativeRequestId: requestByParcel.get(building.parcel_id) ?? building.id,
      };
      buildings.push(projection); ids.push(building.id);
    }
  }
  snapshot.buildingIds = ids;
  const walls: UrbanLayer['walls'] = (layout.enclosures ?? []).map(wall => ({ path: wall.path, closed: true,
    towers: wall.towers ?? [], gates: wall.gates, thickness: wall.curtain_width_m ?? 2,
    towerShape: wall.towers_detail?.[0]?.shape === 'round' ? 'round' : 'square', role: wall.purpose ? 'castle' : 'town' }));
  const parcels = partition?.parcels ?? [];
  return {
    footprintH, footprint: footprintH.map(p => p.outer), population, culture, cultures: [culture],
    archetype: population < 200 ? 'hamlet' : population < 1200 ? 'nucleated-village' : 'town', morphology: `rust:${layout.structure?.family ?? layout.culture}`,
    blocks: layout.blocks.map(b => b.shape.outer),
    blockInfo: layout.blocks.map(b => ({ quarter: b.quarter, phase: b.phase ?? 0, zone: zone(b.zone),
      kind: b.kind === 'place' || b.kind === 'market' || b.kind === 'church' || b.kind === 'green' || b.kind === 'compound' ? b.kind : 'block', culture })),
    quarters: layout.quarters.map((q, index) => ({ poly: q.shape, phase: q.phase, zone: zone(q.zone), streetSpace: [], nativeId: String(index) })),
    phases: (layout.phases ?? []).map((phase, id) => ({ id, kind: phase.kind === 'village' ? 'village' : id === 0 ? 'core' : phase.kind === 'faubourg' ? 'faubourg' : 'ring', zone: zone(phase.zone), region: phase.shapes, walled: false, fossil: false })),
    streets: layout.streets.map(street => ({ path: street.path, width: street.widths.reduce((a, b) => a + b, 0) / Math.max(1, street.widths.length),
      widths: street.widths, rank: street.rank, kind: street.rank < 2 ? 'main' : street.rank < 4 ? 'street' : 'alley',
      role: roles.has(street.role as StreetRole) ? street.role as StreetRole : 'street', phase: 0 })),
    parcels: parcels.map(p => ({ poly: p.shape.outer, use: p.use === 'common' ? 'green' : p.use, block: p.block, front: p.front ?? undefined, nativeId: p.id })),
    buildings, masses: snapshot.scene?.buildings.flatMap(b => b.footprint) ?? [], walls,
    landmarks: [], squares: parcels.filter(p => ['place', 'market', 'court', 'common'].includes(p.use)).map(p => p.shape.outer),
    backLand: [...parcels.filter(p => ['garden', 'common', 'reserve', 'residual', 'court'].includes(p.use)).map(p => p.shape),
      ...(snapshot.scene?.open_spaces.flatMap(space => space.surface) ?? [])],
    ruralReserve: (layout.enclosures ?? []).flatMap(w => w.reserve ?? []),
    quays: layout.structure?.quays?.map(quay => [...quay.shape.outer, quay.shape.outer[0]]),
  };
}

/** Execute only invalidated native stages; house edits do not rerun terrain, layouts or cadastral partition. */
export async function generateRustTown(world: World, settings: V2Settings, key: string, onProgress?: ProgressCallback,
  through?: V2TownStage): Promise<RustTownResult> {
  const place = world.settlements?.find(s => s.key === key);
  if (!place) throw new Error(`Lieu inconnu : ${key}`);
  const backend = urbanBackend(settings);
  if (backend === 'typescript') throw new Error('Sélectionnez le moteur urbain Rust pour ses étapes indépendantes.');
  const options = { ...settings.options, ...settings.local[key],
    culture: settings.local[key]?.culture ?? String(world.stats['v2.culture:' + key] ?? place.culture),
    population: settings.local[key]?.population ?? Number(world.stats['v2.population:' + key] ?? place.population) };
  const config = resolveRustUrbanControls(settings, key, options), local = settings.urban?.local?.[key];
  const target = through ?? local?.through ?? settings.urban?.through ?? 'buildings';
  const stageIndex = ['layout', 'parcels', 'programme', 'buildings'].indexOf(target);
  if (stageIndex < 0) throw new Error('Étape urbaine inconnue.');
  const runtime = backend === 'native' ? { profile: 'local' as const, server: settings.runtime?.localServer ?? 'http://127.0.0.1:8791' } : undefined;
  const report = (stage: string, label: string, completed: number, total = 5): void => onProgress?.({ stage, label, completed, total });
  const previous = (world.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined)?.[key];
  const roads: Street[] = (world.roads ?? []).map(road => ({ path: road.path, widths: road.path.map(() => road.width),
    rank: road.kind === 'major' ? 1 : road.kind === 'minor' ? 2 : 3, role: 'regional' }));
  const seed = options.seed, layoutKey = fingerprint([world.stats['v2.terrainKey'], key, backend, seed, place.center, options.population, options.culture, config.layout, roads]);
  let snapshot: RustTownSnapshot = previous?.layoutKey === layoutKey ? cloneRustTownSnapshot(previous) : {
    backend: backend === 'native' ? 'rust-native-cpu' : 'rust-wasm-cpu', stage: 'layout', layoutKey, layouts: [], buildingIds: [], warnings: [] };
  // Reuse one terrain handle for this ordered request chain, not one copy for each urban step.
  let engine: UrbanEngine | undefined;
  const request = async (kind: 'quarters' | 'parcels' | 'programme' | 'buildingSites' | 'builtCapacity', extras: Record<string, unknown>): Promise<UrbanResponse> => {
    let raster: SettlementRaster | undefined;
    const engineKey = `${backend}|${runtime?.server ?? ''}`;
    let retained = engines.get(engineKey);
    if (!retained) {
      report('urban-engine', `Chargement du moteur urbain ${backend === 'native' ? 'Rust natif' : 'Rust/WASM'}…`, 0);
      const module = await import('../../../rust/bridge/urban');
      retained = { engine: module.createUrbanEngine(runtime) }; engines.set(engineKey, retained);
    }
    try { engine ??= await retained.engine; } catch (error) { engines.delete(engineKey); throw error; }
    const terrainKey = String(world.stats['v2.terrainKey']);
    if (retained.terrainKey !== terrainKey) raster = rustSettlementRaster(world);
    const result = await engine.run({ id: 1, kind, seed, runtime, ...(raster ? { raster } : {}), ...extras });
    if (!result.error && raster) retained.terrainKey = terrainKey;
    return result;
  };
  if (!snapshot.layouts.length) {
    report('urban-layout', 'Rust · emprise, phases, quartiers, rues et îlots…', 0);
    snapshot.layouts = required<Layout[]>(await request('quarters', { sites: [{ key, name: place.name ?? '', population: options.population,
      culture: options.culture, center: place.center, radius: place.radius }], roads, layoutConfig: config.layout }), 'layouts');
    snapshot.warnings.push(...snapshot.layouts.flatMap(layout => layout.warnings));
  } else report('urban-layout', 'Rust · plan urbain réutilisé', 1);
  const parcelKey = fingerprint([layoutKey, config.parcels]);
  if (stageIndex >= 1 && (!snapshot.partitions || snapshot.parcelKey !== parcelKey)) {
    report('urban-parcels', 'Rust · découpage des parcelles et accès cadastraux…', 1);
    snapshot.partitions = required<Partition[]>(await request('parcels', { layouts: snapshot.layouts, parcelConfig: config.parcels }), 'partitions');
    snapshot.parcelKey = parcelKey; snapshot.programmeKey = undefined; snapshot.requests = undefined; snapshot.scene = undefined;
  }
  if (stageIndex >= 2 && snapshot.programmeKey !== parcelKey) {
    report('urban-programme', 'Rust · fonctions, besoins, capacités et affectation des parcelles…', 2);
    snapshot.partitions = required<Partition[]>(await request('programme', { layouts: snapshot.layouts, partitions: snapshot.partitions, parcelConfig: config.parcels }), 'partitions');
    snapshot.programmeKey = parcelKey;
  }
  if (stageIndex >= 3) {
    const { architectureProfile } = await import('../../../rust/bridge/urbanArchitecture');
    const profile = architectureProfile(config.houses), requestKey = fingerprint([parcelKey, profile]);
    if (!snapshot.requests || snapshot.requestKey !== requestKey) {
      report('urban-building-sites', 'Rust · domaines constructibles, accès et contraintes des maisons…', 3);
      snapshot.requests = required<PlacementRequest[]>(await request('buildingSites', { layouts: snapshot.layouts, partitions: snapshot.partitions, architectureCulture: profile }), 'placementRequests');
      snapshot.requestKey = requestKey; snapshot.scene = undefined;
    }
    const relevantOverrides = Object.fromEntries((snapshot.requests ?? []).flatMap(request => {
      const patch = settings.urban?.buildings?.[`${key}/${request.id}`] ?? settings.urban?.buildings?.[request.id];
      return patch ? [[request.id, patch]] : [];
    }));
    const buildingKey = fingerprint([requestKey, config.houses, relevantOverrides]);
    if (!snapshot.scene || snapshot.buildingKey !== buildingKey) {
      report('urban-buildings', 'Chargement du moteur Rust des maisons…', 4);
      const { planUrbanBuildings } = await import('../../../rust/bridge/architecture');
      const houseSettingsKey = fingerprint(config.houses), baselineKey = fingerprint([requestKey, houseSettingsKey]);
      let baseline: PlacementBatch, baselineRequests = 0;
      if (snapshot.scene && snapshot.houseBaseline?.key === baselineKey) {
        snapshot.houseBaseline = { ...snapshot.houseBaseline, originals: { ...snapshot.houseBaseline.originals } };
        const originals = Object.values(snapshot.houseBaseline.originals);
        baseline = originals.length ? mergeHouseDelta(snapshot.scene, { ...snapshot.scene,
          buildings: originals.flatMap(value => value.buildings), refusals: originals.flatMap(value => value.refusals),
          open_spaces: originals.flatMap(value => value.open_spaces) }, new Set(originals.map(value => value.parcelId))) : snapshot.scene;
      } else {
        report('urban-buildings', 'Rust · plans sources des maisons avant les modifications individuelles…', 0, snapshot.requests.length);
        baseline = await planUrbanBuildings({ schema_version: '1', requests: snapshot.requests, settings: config.houses }, runtime, {
          progress: (completed, total) => report('urban-buildings', `Rust · maisons sources ${completed}/${total}…`, completed, total),
        });
        baselineRequests = snapshot.requests.length;
        snapshot.houseBaseline = { key: baselineKey, originals: {} };
      }
      // Canonical replay: restore only touched source houses, then apply the
      // current explicit house overrides in stable site order. A seed/recipe
      // import follows exactly the same path as an interactive local edit.
      let requests = snapshot.requests.filter(request => relevantOverrides[request.id]);
      const changedParcels = new Set(requests.map(request => request.parcel_id));
      for (const request of requests) if (!snapshot.houseBaseline!.originals[request.id]) {
        snapshot.houseBaseline!.originals[request.id] = { parcelId: request.parcel_id,
          buildings: baseline.buildings.filter(building => building.parcel_id === request.parcel_id),
          refusals: baseline.refusals.filter(refusal => refusal.parcel_id === request.parcel_id),
          open_spaces: baseline.open_spaces.filter(space => space.parcel_id === request.parcel_id) };
      }
      if (settings.urban?.buildings && Object.keys(settings.urban.buildings).length) {
        const { defaultHouseConfig } = await import('../../../rust/bridge/houses');
        requests = requests.map(request => {
          const patch = relevantOverrides[request.id];
          if (!patch) return request;
          const seed = patch.seed ?? request.seed;
          const house = merge<HouseConfig>(defaultHouseConfig(), { pack: request.culture.pack, mode: request.culture.mode },
            request.config, config.houses.house_config,
            config.houses.floors === undefined ? undefined : { overrides: { floors: config.houses.floors } }, patch,
            { seed, count: 1 });
          return { ...request, seed, config: house };
        });
      }
      requests = withRetainedNeighbors(requests, baseline.buildings.filter(building => !changedParcels.has(building.parcel_id)));
      // The native batch header deliberately outranks request.config. Split only
      // at explicit per-house overrides so a global floor/model control cannot
      // overwrite the user's more local choice. Keep original order and pass
      // earlier groups as binding occupations to the following group.
      const groups: { requests: PlacementRequest[]; settings: PlacementBatchSettings; key: string }[] = [];
      for (const request of requests) {
        const specific = relevantOverrides[request.id];
        const header = specific ? { ...config.houses, floors: undefined,
          house_config: config.houses.house_config ? request.config : undefined } : config.houses;
        const headerKey = fingerprint(header), previous = groups[groups.length - 1];
        if (previous?.key === headerKey) previous.requests.push(request);
        else groups.push({ requests: [request], settings: header, key: headerKey });
      }
      let delta: PlacementBatch | undefined, done = 0;
      for (const group of groups) {
        const batch = await planUrbanBuildings({ schema_version: '1',
          requests: delta ? withRetainedNeighbors(group.requests, delta.buildings) : group.requests, settings: group.settings }, runtime, {
          progress: completed => report('urban-buildings', `Rust · maisons ${done + completed}/${requests.length}…`, done + completed, requests.length),
        });
        delta = delta ? mergeHouseDelta(delta, batch, new Set()) : batch;
        done += group.requests.length;
      }
      snapshot.scene = delta ? mergeHouseDelta(baseline, delta, changedParcels) : baseline;
      const order = new Map(snapshot.requests.map((request, index) => [request.parcel_id, index]));
      const byParcel = (a: { parcel_id: string }, b: { parcel_id: string }) => (order.get(a.parcel_id) ?? 0) - (order.get(b.parcel_id) ?? 0);
      snapshot.scene = { ...snapshot.scene, buildings: [...snapshot.scene.buildings].sort(byParcel), refusals: [...snapshot.scene.refusals].sort(byParcel), open_spaces: [...snapshot.scene.open_spaces].sort(byParcel) };
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
    } else { snapshot.lastBuildingRequests = 0; report('urban-buildings', 'Rust · maisons conservées réutilisées', 5); }
    if (snapshot.capacityKey !== buildingKey) {
      report('urban-built-capacity', 'Rust · bilan du programme d’après les plans bâtis conservés…', 4);
      const balanced = required<Partition[]>(await request('builtCapacity', { layouts: snapshot.layouts, partitions: snapshot.partitions, scene: snapshot.scene, parcelConfig: config.parcels }), 'partitions');
      // Reconciliation is an evidence calculation, not a cadastral edit. Keep
      // authoritative parcel objects instead of installing a second JSON
      // floating-point round trip of their coordinates and access contacts.
      const byKey = new Map(balanced.map(partition => [partition.key, partition]));
      snapshot.partitions = snapshot.partitions!.map(partition => {
        const report = byKey.get(partition.key); if (!report) throw new Error(`Missing built-programme report for ${partition.key}.`);
        return { ...partition, programme: report.programme, warnings: report.warnings };
      });
      snapshot.capacityKey = buildingKey;
    }
  }
  // An earlier stopping stage intentionally removes the display of downstream products while retaining them for reuse.
  snapshot.stage = target;
  snapshot.warnings = [...new Set([...snapshot.layouts.flatMap(layout => layout.warnings),
    ...(stageIndex >= 1 ? snapshot.partitions?.flatMap(partition => partition.warnings) ?? [] : []),
    ...(stageIndex >= 3 ? snapshot.scene?.refusals.map(refusal => `${refusal.code}: ${refusal.message}`) ?? [] : [])])];
  const projection = stageIndex < 3 ? { ...snapshot, scene: undefined, ...(stageIndex === 0 ? { partitions: undefined } : {}) } : snapshot;
  const urban = projectRustTown(projection, options.population, options.culture);
  snapshot.buildingIds = projection.buildingIds;
  report('urban-complete', `Rust · ${target === 'buildings' ? 'maisons' : target === 'programme' ? 'programme' : target === 'parcels' ? 'parcelles' : 'plan'} prêt`, 5);
  return { urban, snapshot, stats: { 'v2.urbanBackend': snapshot.backend, [`v2.urbanBackend:${key}`]: snapshot.backend,
    [`v2.urbanStage:${key}`]: target, [`v2.urbanRefusals:${key}`]: stageIndex >= 3 ? snapshot.scene?.refusals.length ?? 0 : 0,
    [`v2.housesRegenerated:${key}`]: stageIndex >= 3 ? snapshot.lastBuildingRequests ?? 0 : 0,
    [`v2.urbanWarnings:${key}`]: [...new Set(snapshot.warnings)].join(' | ') } };
}
