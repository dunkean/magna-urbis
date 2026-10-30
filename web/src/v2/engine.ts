import { PROCEDURAL_RECIPE_VERSION, isCompactProcedural } from '../../../rust/bridge/terrainGenerationRecipe';
import { COMPACT_VERSION } from '../../../rust/bridge/terrainPhasor';
import { Rng } from '../gen/core/rng';
import { optionsForMainSettlement, sizeForPop, SETTLEMENT_OVERRIDE_KEYS, type Options, type SettlementOverrides } from '../gen/options';
import { terrainForExtent } from '../gen/terrain/hydrology';
import { refreshCavernMask } from '../gen/terrain/caverns';
import { generateNaturalCover } from '../gen/landuse/natural';
import { generateRural } from '../gen/landuse/rural';
import { chooseSite } from '../gen/site/site';
import { routeRoads } from '../gen/roads/regional';
import { planSettlements, settlementRequests } from '../gen/settlements/planner';
import { routeNetwork } from '../gen/settlements/network';
import { generateSettlementUrban } from '../gen/settlements/urban';
import { generateUrban } from '../gen/urban';
import { generateMega } from '../gen/urban/mega/plan';
import { EAGER_MAIN_POP } from '../gen/urban/mega/types';
import { getCulture, populationCulture } from '../gen/urban/culture';
import { generateNames, settlementNames } from '../gen/names';
import { mainPopulation, applyNameOverrides } from '../gen/pipeline';
import type { World, TerrainLayer, LandUseLayer } from '../gen/types';
import { TerrainCache, terrainCache, V2_ENGINE_VERSION } from './cache';
import type { V2Settings, ProgressCallback, V2TownStage } from './contracts';
import { validateSettings } from './project';
import { adaptedExtent } from './settings';
import { effectiveTerrainSettings } from './terrainSettings';
import { projectEngineTerrain, type V2TerrainLayer } from './terrainProjection';
import { importedHeightfield } from '../gen/terrain/import';
import { buildForestField, type ForestField } from '../../../rust/bridge/terrainForest';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import { gpuSetupDeadline } from '../../../rust/bridge/terrainProgress';
import { fingerprintBytes, fingerprintNumbers } from './terrainFingerprint';
import { cloneV2TerrainForStage, cloneV2WorldForGeneration } from './worldState';
export { defaultSettings, adaptedExtent } from './settings';
export type { V2Settings, V2Progress, ProgressCallback, V2Project } from './contracts';
const forestFields = new Map<string, { field: ForestField; cover: Float32Array }>();
const naturalCovers = new Map<string, LandUseLayer>();

function effectiveOptions(settings: V2Settings, mapSize = adaptedExtent(settings)): Options {
  return { ...settings.options, mapSize };
}
function report(onProgress: ProgressCallback | undefined, stage: string, label: string, completed: number, total: number,
  cache?: 'memory' | 'disk' | 'miss'): void { onProgress?.({ stage, label, completed, total, ...(cache ? { cache } : {}) }); }

/** Hash imported pixels; retaining only their filename would incorrectly reuse a changed heightmap. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function terrainCacheKey(settings: V2Settings): string {
  const o = settings.options, image = o.importedHeight;
  const runtime = settings.runtime;
  const physics = runtime ? { ...(settings.terrain?.procedural ? { proceduralVersion: PROCEDURAL_RECIPE_VERSION } : {}), ...(isCompactProcedural({source:runtime.source,procedural:settings.terrain?.procedural}) ? { compactVersion: COMPACT_VERSION } : {}), backend: runtime.backend, compute: runtime.compute, source: runtime.source,
    resolution: runtime.resolution ?? 512, erosion: runtime.erosion ?? 1,
    // Service endpoints and deployment origins are transport, not generation parameters.
    neuralAssets: ['procedural', 'procedural-phasor'].includes(runtime.source) ? undefined : runtime.neuralAssets ?? './neural/' } : null;
  const { forest: _forest, ...terrain } = effectiveTerrainSettings(settings, adaptedExtent(settings));
  const native = runtime && (runtime.backend !== 'typescript' || runtime.source !== 'procedural');
  const compactTerrain = native ? { ...terrain,
    ...(terrain.sketch ? { sketch: { ...terrain.sketch, heights: { fingerprint128: fingerprintNumbers(terrain.sketch.heights) } } } : {}),
    ...(terrain.zones ? { zones: { ...terrain.zones, weights: { fingerprint128: fingerprintNumbers(terrain.zones.weights) } } } : {}),
  } : null;
  return stableStringify([V2_ENGINE_VERSION, settings.generation, o.seed, adaptedExtent(settings), o.relief, o.coast,
    o.river, o.seaLevel ?? 0, (o as Options & { lakes?: string }).lakes ?? 'auto',
    physics, compactTerrain,
    image ? [image.w, image.h, fingerprintBytes(image.elevations ? new Uint8Array(image.elevations.buffer, image.elevations.byteOffset, image.elevations.byteLength) : image.rgba), o.heightScale ?? 120, o.importSea ?? 0] : null]);
}
const LEGACY_BENCH_KEY = 'mu-v2-bench-terrain-2026-10-28.2';
const LEGACY_TS_KEY = 'mu-v2-ts-2026-10-28.1';
const compatibleTerrainKeys = new WeakMap<TerrainLayer['height'], { retained: string; current: string }>();
/** Exact historical fingerprint; used only to recognise saved keys, never for new cache entries. */
function legacyPixelsFingerprint(bytes: Uint8Array | Uint8ClampedArray): string {
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i], 16777619); b = Math.imul(b ^ (bytes[i] + i), 0x85ebca6b); }
  return `${bytes.length}:${a >>> 0}:${b >>> 0}`;
}
function classicTerrain(settings: V2Settings): boolean {
  return !settings.runtime || settings.runtime.backend === 'typescript' && settings.runtime.source === 'procedural';
}
function historicalTerrainKey(settings: V2Settings, current: string, version: string): string {
  const frame: unknown[] = JSON.parse(current), image = settings.options.importedHeight;
  frame[0] = version;
  if (version === LEGACY_BENCH_KEY) {
    const { forest: _forest, ...terrain } = effectiveTerrainSettings(settings, adaptedExtent(settings));
    frame[10] = classicTerrain(settings) ? null : terrain;
  } else frame.splice(10, 1); // The original TS key predates the typed bench terrain recipe.
  frame[frame.length - 1] = image ? [image.w, image.h,
    legacyPixelsFingerprint(image.elevations ? new Uint8Array(image.elevations.buffer, image.elevations.byteOffset, image.elevations.byteLength) : image.rgba),
    settings.options.heightScale ?? 120, settings.options.importSea ?? 0] : null;
  return stableStringify(frame);
}
/**
 * Cache-format changes do not invalidate a retained scientific snapshot. Match the entire historical
 * recipe before accepting it; retain its original key/provenance instead of rewriting project history.
 */
export function retainedTerrainMatchesSettings(world: World, settings: V2Settings): boolean {
  if (world.seed !== settings.options.seed || settings.extent !== 'auto' && Math.round(settings.extent) !== world.mapSize
    || settings.extent === 'auto' && settings.options.mapSize !== undefined && Math.round(settings.options.mapSize) !== world.mapSize) return false;
  const frozen = { ...settings, extent: world.mapSize }, current = terrainCacheKey(frozen), retained = world.stats['v2.terrainKey'];
  if (retained === current) return true;
  if (typeof retained !== 'string') return false;
  const version = retained.startsWith(`["${LEGACY_BENCH_KEY}",`) ? LEGACY_BENCH_KEY
    : retained.startsWith(`["${LEGACY_TS_KEY}",`) && classicTerrain(settings) && world.mapSize >= 600 && world.mapSize <= 40000 ? LEGACY_TS_KEY : undefined;
  if (!version) return false;
  const remembered = compatibleTerrainKeys.get(world.terrain.height);
  if (remembered?.retained === retained && remembered.current === current) return true;
  if (retained !== historicalTerrainKey(frozen, current, version)) return false;
  compatibleTerrainKeys.set(world.terrain.height, { retained, current });
  return true;
}
/** Resolve at execution time; portable recipes keep relative model assets even in blob workers. */
export function resolveModelAssets(value: string | undefined, assetBase?: string): string {
  const base = assetBase ?? (typeof location === 'undefined' ? undefined : location.href);
  try { return new URL(value ?? './neural/', base).href; }
  catch { throw new Error('Lâ€™adresse de base des modÃ¨les neuronaux doit Ãªtre transmise au worker.'); }
}

export async function generateTerrain(settings: V2Settings, onProgress?: ProgressCallback,
  cache: TerrainCache = terrainCache, assetBase?: string, terrainStage?: string): Promise<World> {
  validateSettings(settings);
  if (settings.generation === 'neural' && !settings.options.importedHeight && (!settings.runtime || settings.runtime.source === 'procedural'))
    throw new Error('Le modèle neuronal doit d’abord fournir une heightmap. Aucun calcul procédural ne remplace silencieusement le modèle.');
  const t0 = performance.now(), key = terrainCacheKey(settings) + (terrainStage && terrainStage !== 'cover-climate' ? `|preview:${terrainStage}` : ''), options = effectiveOptions(settings);
  const configuration = effectiveTerrainSettings(settings, options.mapSize!);
  const includeCover = !terrainStage || terrainStage === 'cover-climate';
  if (!includeCover) {
    configuration.hydrology = { ...configuration.hydrology!, enabled: terrainStage === 'water-hydrology' && configuration.hydrology?.enabled !== false };
    if (!['relief-refine', 'water-hydrology'].includes(terrainStage!)) configuration.refine = false;
    if (terrainStage === 'relief-refine' && configuration.procedural) configuration.procedural = {
      ...configuration.procedural, enabled: { ...configuration.procedural.enabled, posterior: false, wind: false, coasts: false },
    };
  }
  const nativeEngine = !!settings.runtime && (settings.runtime.backend !== 'typescript' || settings.runtime.source !== 'procedural');
  if (!nativeEngine && (options.mapSize! < 600 || options.mapSize! > 40000)) throw new Error('The classic TypeScript engine supports 600â€“40,000 m. Select the Rust engine for 500â€“100,000 m.');
  // The classic engine keeps the dormant Rust recipe so switching engines never erases the user's draft.
  report(onProgress, 'terrain-cache', 'Recherche du relief et de lâ€™hydrologie conservÃ©sâ€¦', 0, 3);
  const hit = terrainStage && !includeCover ? undefined : await cache.get(key);
  let terrain: TerrainLayer, persisted = false;
  if (hit) {
    terrain = hit.terrain;
    report(onProgress, 'terrain', 'Relief et hydrologie rÃ©utilisÃ©s', 1, 3, hit.source);
  } else {
    report(onProgress, 'terrain', 'Calcul du relief, du drainage, des riviÃ¨res et des lacsâ€¦', 0, 3, 'miss');
    let engineStats: Record<string, string | number> = { backend: 'typescript-cpu' };
    let nativeTerrain: TerrainLayer | undefined;
    if (nativeEngine) {
      const runtime = settings.runtime, { generateEngineHeight } = await import('./platform');
      const remoteNeural = !options.importedHeight && !configuration.sketch?.processing && (runtime!.source === 'neural-python' || runtime!.source === 'neural');
      let compute: 'cpu' | 'gpu' = runtime!.compute === 'gpu' ? 'gpu' : 'cpu',softwareGpu=false;
      if (runtime!.compute === 'auto') {
        // Local CUDA services select their own device; an unrelated browser driver
        // must not hold up their model loading.
        if(remoteNeural)compute='gpu';
        else{
          report(onProgress,'compute','DÃ©tection des capacitÃ©s CPU et WebGPUâ€¦',0,0);
          try {const adapter=await gpuSetupDeadline(globalThis.navigator?.gpu?.requestAdapter({powerPreference:'high-performance'})??Promise.resolve(null));compute=adapter?'gpu':'cpu';softwareGpu=!!adapter?.info?.isFallbackAdapter;if(['procedural','procedural-phasor'].includes(runtime!.source)&&softwareGpu)compute='cpu';}catch { compute = 'cpu'; }
        }
      }
      const gpuGeneration = ['gpu', 'gpu-all', 'gpu-erosion'].includes(configuration.generationCompute ?? '');
      if (runtime!.compute === 'cpu' && (configuration.compute === 'gpu-f32' || gpuGeneration)) throw new Error('CPU execution conflicts with explicit GPU terrain controls. Choose automatic/GPU or reset those controls.');
      if (runtime!.compute === 'gpu' && configuration.compute === 'wasm' && !remoteNeural) throw new Error('GPU execution conflicts with explicit WASM CPU sampling. Choose automatic/CPU or reset the sampling control.');
      if (configuration.compute === 'wasm' && gpuGeneration) throw new Error('GPU terrain generation requires GPU sampling. Select GPU FP32 or reset generation compute.');
      if (configuration.compute === 'wasm' && !remoteNeural) compute = 'cpu';
      else if (configuration.compute === 'gpu-f32' || ['gpu', 'gpu-all', 'gpu-erosion'].includes(configuration.generationCompute ?? '')) compute = 'gpu';
      if(softwareGpu&&compute==='cpu'&&['procedural','procedural-phasor'].includes(runtime!.source))report(onProgress,'compute','WebGPU logiciel détecté · sélection du CPU pour le procédural',0,0);
      const { seed: _seed, width: _width, source: _source, neuralAssets: _assets, neuralServer: _server, forest: _forest, ...controls } = configuration;
      if (options.importedHeight) {
        const image = importedHeightfield(options.importedHeight, options.mapSize!, 1024, options.heightScale ?? 120, options.importSea ?? 0).height;
        controls.sketch = { version: 1, resolution: 1024, heights: Array.from(image.data), processing: 'surface' };
      }
      const execute = () => generateEngineHeight({ seed: options.seed, width: options.mapSize!,
        relief: options.relief, coast: options.coast,
        climate: options.biome === 'desert' ? 'arid' : options.biome === 'tropical' ? 'tropical' : options.biome === 'tundra' ? 'cold' : 'temperate',
        compute, source: runtime!.source, native: runtime!.backend === 'native',
        localServer: runtime!.localServer, pythonServer: runtime!.pythonServer, neuralServer: runtime!.neuralServer,
        neuralAssets: ['procedural', 'procedural-phasor'].includes(runtime!.source) || controls.sketch?.processing ? undefined : resolveModelAssets(runtime!.neuralAssets, assetBase),
        resolution: controls.resolution, erosion: controls.erosion, terrain: controls, terrainStage }, (message,work) => onProgress?.({stage:work?.stage??'relief-engine',label:message,completed:work?.completed??0,total:work?.total??0,...(work?.detail?{detail:work.detail}:{})}));
      let generated;
      try { generated = await execute(); } catch (error) {
        if (runtime!.compute !== 'auto' || compute !== 'gpu' || !['procedural', 'procedural-phasor'].includes(runtime!.source) || configuration.compute === 'gpu-f32' || ['gpu', 'gpu-all', 'gpu-erosion'].includes(configuration.generationCompute ?? '')) throw error;
        report(onProgress, 'relief-engine', 'GPU indisponible : reprise du relief procÃ©dural sur CPUâ€¦', 0, 3);
        compute = 'cpu'; generated = await execute();
      }
      options.importedHeight = generated.importedHeight; options.heightScale = generated.heightScale; options.importSea = generated.importSeaLevel;
      engineStats = generated.stats;
      if (!generated.terrain) throw new Error('The Rust adapter did not return the retained terrain and water network.');
      report(onProgress,'terrain-projection','PrÃ©paration de la carte, des cÃ´tes et du rÃ©seau hydrographiqueâ€¦',0,0);
      nativeTerrain = projectEngineTerrain(generated.terrain);
    } else if (!options.importedHeight && settings.runtime?.compute === 'gpu') {
      throw new Error('Le moteur TypeScript fonctionne sur CPU. Choisissez Rust pour utiliser le GPU.');
    }
    terrain = nativeTerrain ?? terrainForExtent(options, options.mapSize!, new Rng('magna-urbis:' + options.seed)).terrain;
    // Rust results retain their own hydrology; only the explicitly selected classic engine runs TS drainage.
    (terrain as TerrainLayer & { v2EngineStats?: Record<string, string | number> }).v2EngineStats = engineStats;
    report(onProgress, 'terrain-cache', 'Enregistrement du relief et de lâ€™hydrologieâ€¦', 1, 3);
    if (!terrainStage || includeCover) persisted = await cache.put(key, terrain);
  }
  if (!includeCover) {
    return { seed: options.seed, options: { ...options, workflow: 'environment' }, mapSize: options.mapSize!, terrain,
      landuse: { areas: [], farmsteads: [], reserve: [] },
      stats: { 'v2.stage': 'terrain', 'v2.previewStage': terrainStage!, 'v2.engine': V2_ENGINE_VERSION, 'v2.terrainKey': key,
        ...((terrain as V2TerrainLayer).v2EngineStats ?? {}), 'v2.cache': 'miss', 'v2.persisted': 0, 'ms.total': Math.round(performance.now() - t0) } };
  }
  report(onProgress, 'biome', 'Classification du biome et du couvert naturelâ€¦', 2, 3);
  const retained = terrain as V2TerrainLayer;
  if (nativeEngine) {
    const forestKey = key + stableStringify(configuration.forest), cachedForest = forestFields.get(forestKey);
    if (cachedForest) {
      retained.v2ForestField = structuredClone(cachedForest.field); retained.v2NaturalForest = cachedForest.cover.slice();
    } else {
    const climate = configuration.climateValues!;
    const forest = buildForestField({ seed: seedHash(options.seed), climate: [climate.temperature, climate.precipitation],
      height: { x: 0, y: 0, width: options.mapSize!, n: terrain.height.w, data: terrain.height.data }, water: terrain.water }, configuration.forest);
    retained.v2ForestField = forest;
    const cover = new Float32Array(terrain.height.data.length), n = terrain.height.w;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cover[y * n + x] = forest.rgba[(Math.min(forest.n - 1, Math.floor((y + .5) * forest.n / n)) * forest.n + Math.min(forest.n - 1, Math.floor((x + .5) * forest.n / n))) * 4] / 255;
    retained.v2NaturalForest = cover;
    forestFields.set(forestKey, { field: structuredClone(forest), cover: cover.slice() });
    if (forestFields.size > 3) forestFields.delete(forestFields.keys().next().value!);
    }
  }
  const biome = options.biome === 'underdark-caverns' ? 'underdark' : options.biome;
  const coverKey = key + stableStringify([biome, nativeEngine ? configuration.forest : null]);
  const cachedCover = naturalCovers.get(coverKey);
  const landuse = cachedCover ? structuredClone(cachedCover)
    : generateNaturalCover(terrain, biome, new Rng('magna-urbis:' + options.seed), retained.v2NaturalForest);
  if (!cachedCover) {
    naturalCovers.set(coverKey, structuredClone(landuse));
    if (naturalCovers.size > 3) naturalCovers.delete(naturalCovers.keys().next().value!);
  }
  const world: World = { seed: options.seed, options: { ...options, workflow: 'environment' }, mapSize: options.mapSize!, terrain,
    landuse,
    stats: { 'v2.stage': 'terrain', 'v2.engine': V2_ENGINE_VERSION, 'v2.terrainKey': key,
      ...((terrain as TerrainLayer & { v2EngineStats?: Record<string, string | number> }).v2EngineStats ?? {}),
      'v2.cache': hit?.source ?? 'miss', 'v2.persisted': persisted ? 1 : 0, 'ms.total': Math.round(performance.now() - t0) } };
  refreshCavernMask(world);
  report(onProgress, 'terrain', 'Topographie prÃªte', 3, 3, hit?.source ?? 'miss');
  return world;
}

function assertTerrain(world: World, settings: V2Settings): void {
  // Auto is a recommendation at terrain creation time, not permission to resize an already retained map.
  if (!retainedTerrainMatchesSettings(world, settings))
    throw new Error('Les paramÃ¨tres du terrain ont changÃ©. RÃ©gÃ©nÃ©rez la topographie avant de poursuivre.');
}
function nameWorld(world: World, mainOptions?: Partial<Options>): void {
  const root = new Rng('magna-urbis:' + world.seed);
  world.names = generateNames(mainOptions ? { ...world, options: { ...world.options, ...mainOptions } } : world, root);
  settlementNames(world, root);
  applyNameOverrides(world);
}

/** This stage never invokes the urban generator: the retained region contains only sites and regional routes. */
export async function planRegion(terrainWorld: World, settings: V2Settings, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings); assertTerrain(terrainWorld, settings);
  const t0 = performance.now(), root = new Rng('magna-urbis:' + settings.options.seed);
  const options = effectiveOptions(settings, terrainWorld.mapSize);
  options.workflow = options.workflow === 'list' ? 'list' : undefined;
  if (settings.settlementCount > 0 && options.workflow !== 'list') {
    const secondary = settings.settlementCount - 1;
    const village = Math.ceil(secondary * 2 / 3);
    options.settlements = { counts: { city: 0, town: 0, village, hamlet: secondary - village, farmstead: 0 } };
  }
  const mainOptions = { ...optionsForMainSettlement(options), ...settings.local.main };
  mainOptions.size = sizeForPop(mainPopulation(mainOptions, root));
  const world: World = { seed: options.seed, options, mapSize: terrainWorld.mapSize,
    terrain: cloneV2TerrainForStage(terrainWorld.terrain), landuse: terrainWorld.landuse,
    stats: { ...terrainWorld.stats, 'v2.stage': 'region' } };
  if(settings.runtime?.backend&&settings.runtime.backend!=='typescript'){
    await (await import('./region')).planRustRegion(world,settings,onProgress);
    world.stats['v2.planKey']=regionKey(settings);world.stats['v2.placementKey']=placementKey(settings);nameWorld(world,mainOptions);
    const native=(world.debug?.v2RustRegion as import('./region').RustRegionSnapshot).placement;
    for(const spec of native.settlements)if(spec.name){const place=world.settlements!.find(s=>s.key===spec.key);if(place){place.name=spec.name;if(place.main){world.names!.town=spec.name;const entry=world.names!.entries.find(e=>e.kind==='town');if(entry)entry.text=spec.name;}else{const entry=world.names!.entries.find(e=>e.sub==='settlement:'+place.key);if(entry)entry.text=spec.name;}}}
    refreshCavernMask(world);return world;
  }
  report(onProgress, 'sites', 'Recherche des sites habitablesâ€¦', 0, 4);
  const cprefs = getCulture(mainOptions.culture).sitePrefs;
  world.site = chooseSite(world.terrain, mainOptions.sitePrefs || !cprefs ? mainOptions : { ...mainOptions, sitePrefs: cprefs }, world.mapSize, root);
  report(onProgress, 'roads', 'TracÃ© des axes rÃ©gionauxâ€¦', 1, 4);
  const roads = routeRoads(world.terrain, world.site, mainOptions, world.mapSize, root);
  world.roads = roads.roads; world.bridges = roads.bridges;
  report(onProgress, 'sites', 'Implantation de la hiÃ©rarchie des lieuxâ€¦', 2, 4);
  if (Object.keys(settings.local).some(key => key !== 'main')) {
    // Feed local positioning and site preferences into the real planner before geometry is committed.
    const t = world.terrain, count = t.height.w * t.height.h;
    let usable = 0;
    for (let i = 0; i < count; i += 2) if (t.water[i] === 0 && t.slope.data[i] < .3) usable++;
    const requests = settlementRequests(options, usable * 2 * t.height.cell ** 2 / 1e6, mainPopulation(mainOptions, root), root);
    options.settlements = { list: [
      { population: mainPopulation(mainOptions, root), culture: mainOptions.culture, position: mainOptions.center, options: localOverrides(mainOptions) },
      ...requests.map(request => {
        const local = settings.local[request.key] ?? {};
        return { key: request.key, population: local.population ?? request.pop, culture: local.culture ?? request.culture,
          position: local.center ?? request.position, siteType: local.siteType === 'auto' ? undefined : local.siteType ?? request.siteType,
          options: { ...request.options, ...localOverrides(local) } };
      }),
    ] };
    options.workflow = 'list';
  }
  const plan = planSettlements(world, options, root, mainOptions, mainPopulation(mainOptions, root));
  world.settlements = plan.settlements;
  for (const settlement of world.settlements) {
    world.stats['v2.population:' + settlement.key] = settlement.population;
    world.stats['v2.culture:' + settlement.key] = settlement.culture;
  }
  for (const settlement of world.settlements) if (!settlement.main && settlement.detail !== 'farmstead') settlement.detail = 'lazy';
  report(onProgress, 'network', 'Connexion des lieux par le rÃ©seau routierâ€¦', 3, 4);
  if (world.settlements.length > 1) {
    const net = routeNetwork(world, world.settlements, root);
    world.roads.push(...net.roads); world.bridges.push(...net.bridges);
    world.stats['v2.unreachable'] = net.unreachable.length;
    plan.warnings.push(...net.warnings);
  }
  world.stats['v2.regionalRoads'] = world.roads.length;
  world.stats['v2.baseBridges'] = world.bridges.length;
  world.debug = { v2BaseBridges: structuredClone(world.bridges), v2TownBridges: {} };
  world.stats['v2.planKey'] = regionKey(settings);
  world.stats['settlements'] = world.settlements.length;
  world.stats['settlements.requested'] = plan.requested;
  if (world.site.warning) plan.warnings.push(world.site.warning);
  if (plan.warnings.length) world.stats['settlements.warning'] = plan.warnings.join(' | ');
  world.stats['ms.region'] = Math.round(performance.now() - t0);
  nameWorld(world, mainOptions);
  refreshCavernMask(world);
  report(onProgress, 'network', 'Implantations et routes prÃªtes', 4, 4);
  return world;
}

/** Only parameters that can move the regional sites require replanning. Town morphology remains local. */
function regionKey(settings: V2Settings): string {
  const o = settings.options;
  return stableStringify([o.population, o.culture, o.siteType, o.sitePrefs, o.center, o.roads, o.settlements, o.workflow,
    settings.runtime?.backend,settings.region,settings.settlementCount, Object.entries(settings.local).filter(([key, o]) => o.center !== undefined ||
      o.siteType !== undefined || o.sitePrefs !== undefined || key === 'main' && o.roads !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, o]) =>
      [key, o.center, o.siteType, o.sitePrefs, key === 'main' ? o.roads : undefined])]);
}
function historicalClassicRegionKey(settings: V2Settings): string {
  const frame: unknown[] = JSON.parse(regionKey(settings)); frame.splice(8, 2);
  return stableStringify(frame);
}
function placementKey(settings:V2Settings):string{
  const recipe={...settings,options:{...settings.options},local:{...settings.local},...(settings.region?{region:{...settings.region}}:{})};delete (recipe.options as Partial<Options>).roads;
  if(recipe.region){delete recipe.region.roads;delete recipe.region.resolution;if(!Object.keys(recipe.region).length)delete recipe.region;}
  if(recipe.local.main){recipe.local.main={...recipe.local.main};delete recipe.local.main.roads;}
  return regionKey(recipe);
}
/** Reuse exact sites, terrain and city geometry while replacing only the regional road network. */
export async function rerouteRegion(source:World,settings:V2Settings,onProgress?:ProgressCallback):Promise<World>{
  validateSettings(settings);assertTerrain(source,settings);
  if(settings.runtime?.backend==='typescript'||!settings.runtime)throw new Error('Independent regional routing requires the Rust engine.');
  if(!source.settlements?.length)throw new Error('Place settlements before routing their roads.');
  if(source.stats['v2.placementKey']!==placementKey(settings))throw new Error('The placement recipe has changed. Run placement before routing the new roads.');
  const world=cloneV2WorldForGeneration(source),oldTownBridges=world.debug?.v2TownBridges as Record<string,NonNullable<World['bridges']>>|undefined;
  const savedUrban=world.urban;
  await (await import('./region')).planRustRegion(world,settings,onProgress,true);
  world.urban=savedUrban;if(oldTownBridges){world.debug!.v2TownBridges=oldTownBridges;world.bridges!.push(...Object.values(oldTownBridges).flat());}
  world.stats['v2.planKey']=regionKey(settings);return world;
}
function localOverrides(options: Partial<Options>): SettlementOverrides {
  return Object.fromEntries(SETTLEMENT_OVERRIDE_KEYS.filter(key => options[key] !== undefined).map(key => [key, options[key]]));
}
function assertRegion(world: World, settings: V2Settings): void {
  assertTerrain(world, settings);
  if (!world.site || !world.settlements?.length) throw new Error('Implantez dâ€™abord les lieux et les routes.');
  const legacyClassic = typeof world.stats['v2.terrainKey'] === 'string'
    && world.stats['v2.terrainKey'].startsWith(`["${LEGACY_TS_KEY}",`) && classicTerrain(settings);
  if (world.stats['v2.planKey'] !== regionKey(settings) && !(legacyClassic && world.stats['v2.planKey'] === historicalClassicRegionKey(settings)))
    throw new Error('Les paramÃ¨tres dâ€™implantation ont changÃ©. Recalculez les lieux et les routes.');
}

async function buildTown(world: World, settings: V2Settings, key: string, onProgress?: ProgressCallback, through?: V2TownStage): Promise<void> {
  const settlement = world.settlements!.find(s => s.key === key);
  if (!settlement) throw new Error(`Lieu inconnu : ${key}`);
  const backend = settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
  const requestedStage = through ?? settings.urban?.local?.[key]?.through ?? settings.urban?.through ?? 'buildings';
  if (settlement.detail === 'farmstead' && backend === 'typescript') return;
  const override = settings.local[key] ?? {};
  const population = Number(world.stats['v2.population:' + key] ?? settlement.population);
  const options = { ...settings.options, ...override, mapSize: world.mapSize,
    population: override.population ?? population, culture: override.culture ?? String(world.stats['v2.culture:' + key] ?? settlement.culture),
    size: override.size ?? sizeForPop(override.population ?? population),
    workflow: 'list' as const, settlements: 'none' as const };
  const localSeed = override.seed ?? world.seed;
  if (options.biome === 'underdark-caverns') options.biome = 'underdark';
  const baseBridges = (world.debug?.v2BaseBridges ?? world.bridges ?? []) as NonNullable<World['bridges']>;
  world.debug ??= {};
  const townBridges = (world.debug.v2TownBridges ??= {}) as Record<string, NonNullable<World['bridges']>>;
  if (backend !== 'typescript') {
    const result = await (await import('./rustUrban')).generateRustTown(world, settings, key, onProgress, requestedStage);
    if (settlement.main) world.urban = result.urban;
    settlement.urban = result.urban;
    if (!settlement.main) settlement.detail = 'eager';
    const cities = (world.debug.v2RustCities ??= {}) as Record<string, unknown>;
    cities[key] = result.snapshot;
    Object.assign(world.stats, result.stats);
  } else if (requestedStage !== 'buildings') {
    throw new Error('Les Ã©tapes urbaines indÃ©pendantes requiÃ¨rent le moteur Rust. Le moteur classique gÃ©nÃ¨re le plan complet.');
  } else if (settlement.main) {
    const sub: World = { seed: localSeed, options, mapSize: world.mapSize, terrain: world.terrain,
      site: structuredClone(world.site), roads: structuredClone(world.roads), bridges: structuredClone(baseBridges), stats: {} };
    const root = new Rng('magna-urbis:' + localSeed), eager = options.eagerPop ?? EAGER_MAIN_POP;
    if (options.population > eager && !populationCulture(options.culture, options.population).camp) {
      const result = generateMega(sub, root, options.population, eager);
      world.urban = result.layer;
      townBridges[key] = result.bridges;
    } else {
      world.urban = generateUrban(sub, root).layer;
      townBridges[key] = (sub.bridges ?? []).slice(baseBridges.length);
    }
    settlement.urban = world.urban;
  } else {
    const local = { ...settlement, culture: options.culture, population: options.population,
      options: { ...settlement.options, ...localOverrides(options) } };
    const sub: World = { ...world, seed: localSeed, options, bridges: baseBridges };
    const result = generateSettlementUrban(sub, local);
    if (result) { settlement.urban = result.urban; settlement.detail = 'eager'; townBridges[key] = result.bridges; }
  }
  settlement.population = options.population; settlement.culture = options.culture;
  settlement.options = localOverrides(options);
  world.bridges = [...baseBridges, ...Object.keys(townBridges).sort().flatMap(key => townBridges[key])];
  world.stats['v2.stage'] = 'towns';
}

function finishTowns(world: World, settings: V2Settings, onProgress?: ProgressCallback): void {
  // Rebuild cultivation from the retained plans, never from the expensive terrain stage.
  report(onProgress, 'landuse', 'Mise Ã  jour des terres cultivÃ©es et des nomsâ€¦', 0, 1);
  world.options = { ...effectiveOptions(settings, world.mapSize), workflow: world.options.workflow };
  if (world.urban) {
    const mainOptions = { ...world.options, ...settings.local.main };
    if (mainOptions.biome === 'underdark-caverns') mainOptions.biome = 'underdark';
    const rural = generateRural({ ...world, options: mainOptions }, new Rng('magna-urbis:' + world.seed), Number(world.stats['v2.regionalRoads'] ?? world.roads?.length ?? 0), undefined,
      (world.terrain as V2TerrainLayer).v2NaturalForest ? { footprint: world.urban.footprintH ?? [], population: world.urban.population, naturalForest: (world.terrain as V2TerrainLayer).v2NaturalForest } : undefined);
    world.landuse = rural.layer;
  }
  nameWorld(world, settings.local.main);
  refreshCavernMask(world);
  report(onProgress, 'complete', 'Lieux gÃ©nÃ©rÃ©s', 1, 1);
}
export async function generateTown(regionWorld: World, settings: V2Settings, key: string, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings); assertRegion(regionWorld, settings);
  const world = cloneV2WorldForGeneration(regionWorld), t0 = performance.now();
  report(onProgress, 'town', 'Plan â†’ quartiers â†’ rues â†’ Ã®lots â†’ parcelles â†’ bÃ¢timentsâ€¦', 0, 1);
  await buildTown(world, settings, key, onProgress);
  finishTowns(world, settings, onProgress);
  world.stats['ms.towns'] = Math.round(performance.now() - t0);
  return world;
}
export async function generateTowns(regionWorld: World, settings: V2Settings, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings); assertRegion(regionWorld, settings);
  const backend = settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
  const world = cloneV2WorldForGeneration(regionWorld), t0 = performance.now(), places = world.settlements!.filter(s => backend !== 'typescript' || s.detail !== 'farmstead');
  for (let i = 0; i < places.length; i++) {
    report(onProgress, 'town', `${places[i].name ?? places[i].key} : plan, rues, parcelles et bÃ¢timentsâ€¦`, i, places.length);
    await buildTown(world, settings, places[i].key, onProgress);
  }
  finishTowns(world, settings, onProgress);
  world.stats['ms.towns'] = Math.round(performance.now() - t0);
  return world;
}

/** Strict native urban stages can be inspected and resumed independently. */
export async function generateTownStage(regionWorld: World, settings: V2Settings, key: string, stage: V2TownStage, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings); assertRegion(regionWorld, settings);
  const world = cloneV2WorldForGeneration(regionWorld), t0 = performance.now();
  await buildTown(world, settings, key, onProgress, stage);
  finishTowns(world, settings, onProgress);
  world.stats['ms.towns'] = Math.round(performance.now() - t0);
  return world;
}

export { serializeProject, parseProject, validateSettings } from './project';
