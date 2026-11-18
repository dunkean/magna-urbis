import { generateUrbanLanduse, cityCountrysideOptions } from '../ui/urbanLanduseData';
import { cityForestInput } from '../render/cityEnvironment';
import { retainedDecorOf } from './decorTerrain';
import { applyTerrainModification } from '../../../rust/bridge/terrainModification';
import { forestRetainedRiverSegments } from '../../../rust/bridge/terrainForestRiparian';
import { PROCEDURAL_RECIPE_VERSION, isCompactProcedural } from '../../../rust/bridge/terrainGenerationRecipe';
import { COMPACT_VERSION } from '../../../rust/bridge/terrainPhasor';
import { CLIMATE_ZONE_BASE, CLIMATE_ZONE_VALUES } from '../../../rust/bridge/terrainClimate';
import { Rng } from '../gen/core/rng';
import { urbanSeed } from './urbanSeeds';
import { seedRoot, seedSubset, stepSeed } from '../../../rust/bridge/generationSeed';
import { optionsForMainSettlement, sizeForPop, SETTLEMENT_OVERRIDE_KEYS, type Options, type SettlementOverrides } from '../gen/options';
import { terrainForExtent } from '../gen/terrain/hydrology';
import { refreshCavernMask } from '../gen/terrain/caverns';
import { generateNaturalCoverNative, generateRuralNative } from '../../../rust/bridge/landuseNative';
import { chooseSiteRust } from '../../../rust/bridge/siteNative';
import { loopbackServer } from './platform';
import { matchesRustTransport, terrainRecipeSettings } from './runtimeChoices';
import { effectiveRegion, generationRegion } from './regionSettings';
import { regionalPopulation, REGIONAL_POPULATION_VERSION } from './regionalPopulation';
import { routeRoads } from '../gen/roads/regional';
import { planSettlements, settlementRequests } from '../gen/settlements/planner';
import { routeNetwork } from '../gen/settlements/network';
import { generateSettlementUrban } from '../gen/settlements/urban';
import { generateUrban } from '../gen/urban';
import { generateMega } from '../gen/urban/mega/plan';
import { EAGER_MAIN_POP } from '../gen/urban/mega/types';
import { getCulture, populationCulture } from '../gen/urban/culture';
import { generateNames, settlementNames } from '../gen/names';
import { neighbourClaimsOf, planTownRun, townSeats, type TownRun } from './townNeighbours';
import { createTownRunQueue } from './townRunQueue';
import { builtCore } from './builtCore';
import type { Claim } from '../../../rust/bridge/urban';
import { mainPopulation, applyNameOverrides } from '../gen/pipeline';
import type { World, TerrainLayer, LandUseLayer } from '../gen/types';
import { TerrainCache, terrainCache, V2_ENGINE_VERSION } from './cache';
import type { V2Settings, ProgressCallback, V2TownStage } from './contracts';
import { validateSettings } from './project';
import { adaptedExtent } from './settings';
import { effectiveTerrainSettings } from './terrainSettings';
import { sourceDefinition } from '../../../rust/bridge/terrainDefinition';
import { projectEngineTerrain, assertUrbanPhysicalCapability, type V2TerrainLayer } from './terrainProjection';
import { importedHeightfield } from '../gen/terrain/import';
import { buildForestField, type ForestField } from '../../../rust/bridge/terrainForest';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import { gpuSetupDeadline } from '../../../rust/bridge/terrainProgress';
import { fingerprintBytes, fingerprintNumbers } from './terrainFingerprint';
import { cloneV2TerrainForStage, cloneV2WorldForGeneration } from './worldState';
import { proceduralSignatures, stableKey } from '../../../rust/bridge/terrainCheckpoints';
import { TERRAIN_STAGE_OUTPUTS } from './terrainStagePreview';
import { startTerrainDisplayPreparation } from './displayPrep';
import { recordGenerationValidity } from './stageValidity';
export { defaultSettings, adaptedExtent } from './settings';
export type { V2Settings, V2Progress, ProgressCallback, V2Project } from './contracts';
const forestFields = new Map<string, { field: ForestField; cover: Float32Array }>();
const naturalCovers = new Map<string, LandUseLayer>();
const stagePreviews = new Map<string, TerrainLayer>();
export function clearTerrainPreviews(): void {
  stagePreviews.clear();
}

function effectiveOptions(settings: V2Settings, mapSize = adaptedExtent(settings)): Options {
  const sketch = settings.terrain?.sketch;
  const importedHeight = settings.runtime?.backend === 'typescript' && sketch?.processing ? { w: sketch.resolution, h: sketch.resolution, rgba: new Uint8Array(0), elevations: Float32Array.from(sketch.heights) } : settings.options.importedHeight;
  return { ...settings.options, importedHeight, seed: seedRoot(settings.options.seed), mapSize };
}
function report(onProgress: ProgressCallback | undefined, stage: string, label: string, completed: number, total: number, cache?: 'memory' | 'disk' | 'miss'): void {
  onProgress?.({ stage, label, completed, total, ...(cache ? { cache } : {}) });
}
/** Progress of one settlement inside a town run: its events say which one it is, since their counters restart with each. */
function forSettlement(onProgress: ProgressCallback | undefined, index: number, total: number, place: { name?: string; key: string }): ProgressCallback | undefined {
  return onProgress && (p => onProgress({ ...p, settlement: { index: index + 1, total, name: place.name ?? place.key } }));
}

/** Hash imported pixels; retaining only their filename would incorrectly reuse a changed heightmap. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, item[key]]),
        )
      : item,
  );
}
export function terrainCacheKey(settings: V2Settings): string {
  // Only what changes the terrain: never where a run executed or which neural service a fallback picked.
  settings = terrainRecipeSettings(settings);
  const o = settings.options,
    image = o.importedHeight;
  const runtime = settings.runtime;
  const physics = runtime
    ? {
        ...(settings.terrain?.procedural ? { proceduralVersion: PROCEDURAL_RECIPE_VERSION } : {}),
        ...(isCompactProcedural({ source: runtime.source, procedural: settings.terrain?.procedural }) ? { compactVersion: COMPACT_VERSION } : {}),
        backend: runtime.backend,
        compute: runtime.compute,
        source: runtime.source,
        resolution: runtime.resolution ?? 512,
        erosion: runtime.erosion ?? 1,
        // Service endpoints and deployment origins are transport, not generation parameters.
        neuralAssets: ['procedural', 'procedural-phasor'].includes(runtime.source) ? undefined : (runtime.neuralAssets ?? './neural/'),
      }
    : null;
  const { forest: _forest, ...terrain } = effectiveTerrainSettings(settings, adaptedExtent(settings));
  const native = runtime && (runtime.backend !== 'typescript' || runtime.source !== 'procedural');
  const compactTerrain = native
    ? {
        ...terrain,
        ...(terrain.sketch ? { sketch: { ...terrain.sketch, heights: { fingerprint128: fingerprintNumbers(terrain.sketch.heights) } } } : {}),
        ...(terrain.modification ? { modification: { ...terrain.modification, delta: { fingerprint128: fingerprintNumbers(terrain.modification.delta) } } } : {}),
        ...(terrain.zones ? { zones: { ...terrain.zones, weights: { fingerprint128: fingerprintNumbers(terrain.zones.weights) } } } : {}),
      }
    : null;
  return stableStringify([
    V2_ENGINE_VERSION,
    settings.generation,
    seedSubset(o.seed, key => /^(relief-|water-)/.test(key)),
    adaptedExtent(settings),
    native ? terrain.relief : o.relief,
    o.coast,
    o.river,
    o.seaLevel ?? 0,
    (o as Options & { lakes?: string }).lakes ?? 'auto',
    physics,
    compactTerrain,
    image
      ? [image.w, image.h, fingerprintBytes(image.elevations ? new Uint8Array(image.elevations.buffer, image.elevations.byteOffset, image.elevations.byteLength) : image.rgba), o.heightScale ?? 120, o.importSea ?? 0]
      : settings.decor
        ? ['decor', settings.decor.id, fingerprintBytes(settings.decor.bytes)]
        : null,
  ]);
}
const LEGACY_BENCH_KEY = 'mu-v2-bench-terrain-2026-10-28.2';
const LEGACY_TS_KEY = 'mu-v2-ts-2026-10-28.1';
const compatibleTerrainKeys = new WeakMap<TerrainLayer['height'], { retained: string; current: string }>();
/** Exact historical fingerprint; used only to recognise saved keys, never for new cache entries. */
function legacyPixelsFingerprint(bytes: Uint8Array | Uint8ClampedArray): string {
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 16777619);
    b = Math.imul(b ^ (bytes[i] + i), 0x85ebca6b);
  }
  return `${bytes.length}:${a >>> 0}:${b >>> 0}`;
}
function classicTerrain(settings: V2Settings): boolean {
  return !settings.runtime || (settings.runtime.backend === 'typescript' && settings.runtime.source === 'procedural');
}
function historicalTerrainKey(settings: V2Settings, current: string, version: string): string {
  const frame: unknown[] = JSON.parse(current),
    image = settings.options.importedHeight;
  frame[0] = version;
  if (version === LEGACY_BENCH_KEY) {
    const { forest: _forest, ...terrain } = effectiveTerrainSettings(settings, adaptedExtent(settings));
    frame[10] = classicTerrain(settings) ? null : terrain;
  } else frame.splice(10, 1); // The original TS key predates the typed bench terrain recipe.
  frame[frame.length - 1] = image
    ? [image.w, image.h, legacyPixelsFingerprint(image.elevations ? new Uint8Array(image.elevations.buffer, image.elevations.byteOffset, image.elevations.byteLength) : image.rgba), settings.options.heightScale ?? 120, settings.options.importSea ?? 0]
    : null;
  return stableStringify(frame);
}
/**
 * Cache-format changes do not invalidate a retained scientific snapshot. Match the entire historical
 * recipe before accepting it; retain its original key/provenance instead of rewriting project history.
 */
export function retainedTerrainMatchesSettings(world: World, settings: V2Settings): boolean {
  if (seedRoot(world.seed) !== seedRoot(settings.options.seed) || (settings.extent !== 'auto' && Math.round(settings.extent) !== world.mapSize) || (settings.extent === 'auto' && settings.options.mapSize !== undefined && Math.round(settings.options.mapSize) !== world.mapSize))
    return false;
  const frozen = { ...settings, extent: world.mapSize },
    current = terrainCacheKey(frozen),
    retained = world.stats['v2.terrainKey'];
  if (retained === current || matchesRustTransport(frozen, terrainCacheKey, retained)) return true;
  if (typeof retained !== 'string') return false;
  const version = retained.startsWith(`["${LEGACY_BENCH_KEY}",`) ? LEGACY_BENCH_KEY : retained.startsWith(`["${LEGACY_TS_KEY}",`) && classicTerrain(settings) && world.mapSize >= 600 && world.mapSize <= 40000 ? LEGACY_TS_KEY : undefined;
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
  try {
    return new URL(value ?? './neural/', base).href;
  } catch {
    throw new Error('The neural model base URL must be passed to the worker.');
  }
}

export async function generateTerrain(settings: V2Settings, onProgress?: ProgressCallback, cache: TerrainCache = terrainCache, assetBase?: string, terrainStage?: string): Promise<World> {
  validateSettings(settings);
  if (settings.generation === 'neural' && !settings.options.importedHeight && (!settings.runtime || settings.runtime.source === 'procedural')) throw new Error('Le modèle neuronal doit d’abord fournir une heightmap. Aucun calcul procédural ne remplace silencieusement le modèle.');
  const t0 = performance.now(),
    key = terrainCacheKey(settings) + (terrainStage && terrainStage !== 'cover-climate' ? `|preview:${terrainStage}` : ''),
    options = effectiveOptions(settings);
  const configuration = effectiveTerrainSettings(settings, options.mapSize!);
  const includeCover = !terrainStage || terrainStage === 'cover-climate';
  const output = terrainStage ? (TERRAIN_STAGE_OUTPUTS[terrainStage] ?? (terrainStage === 'water-hydrology' ? 'hydrology' : 'sampling')) : undefined;
  const previewKey = !includeCover
    ? stableKey([V2_ENGINE_VERSION, settings.runtime, terrainStage, configuration.resolution, configuration.procedural && !configuration.sketch && !configuration.zones && !options.importedHeight ? proceduralSignatures(configuration).get(output!) : key])
    : undefined;
  if (!includeCover) {
    configuration.hydrology = { ...configuration.hydrology!, enabled: terrainStage === 'water-hydrology' && configuration.hydrology?.enabled !== false };
    if (!['relief-refine', 'water-hydrology'].includes(terrainStage!)) configuration.refine = false;
    if (terrainStage === 'relief-refine' && configuration.procedural) configuration.procedural = { ...configuration.procedural, enabled: { ...configuration.procedural.enabled, posterior: false, wind: false, coasts: false } };
  }
  const nativeEngine = !!settings.runtime && (settings.runtime.backend !== 'typescript' || settings.runtime.source !== 'procedural');
  if (!nativeEngine && (options.mapSize! < 600 || options.mapSize! > 40000)) throw new Error('The classic TypeScript engine supports 600–40,000 m. Select the Rust engine for 500–100,000 m.');
  // The classic engine keeps the dormant Rust recipe so switching engines never erases the user's draft.
  report(onProgress, 'terrain-cache', 'Looking for retained terrain and hydrology…', 0, 3);
  const preview = previewKey && stagePreviews.get(previewKey);
  const hit = preview ? { terrain: structuredClone(preview), source: 'memory' as const } : terrainStage && !includeCover ? undefined : await cache.get(key);
  let terrain: TerrainLayer,
    persisted = false;
  if (hit) {
    terrain = hit.terrain;
    report(onProgress, 'terrain', 'Terrain and hydrology reused', 1, 3, hit.source);
    if (preview && output) report(onProgress, `pipeline:${output}:cached`, 'Sortie intermédiaire conservée', 1, 1, 'memory');
  } else {
    report(onProgress, 'terrain', 'Computing terrain, drainage, rivers and lakes…', 0, 3, 'miss');
    let engineStats: Record<string, string | number> = { backend: 'typescript-cpu' };
    let nativeTerrain: TerrainLayer | undefined;
    if (settings.decor) {
      // A saved decor is the whole world: its relief, sea, lakes and rivers are kept, never regenerated.
      report(onProgress, 'terrain', `Opening the saved decor ${settings.decor.id}…`, 0, 3, 'miss');
      nativeTerrain = await (await import('./decorTerrain')).settingsDecorTerrain(settings.decor);
      if (configuration.modification) {
        const original = retainedDecorOf(nativeTerrain)!,
          base = original.raster.height.slice();
        const raster = { ...original.raster, height: applyTerrainModification(base, original.raster.n, configuration.modification) };
        nativeTerrain = await (await import('./decorTerrain')).decorTerrainLayer({ ...original, raster }, settings.decor.id);
        (nativeTerrain as V2TerrainLayer).v2ModificationBase = { n: raster.n, height: base };
      }
      engineStats = { backend: 'decor', decor: settings.decor.id };
    } else if (nativeEngine) {
      const runtime = settings.runtime,
        { generateEngineHeight } = await import('./platform');
      const remoteNeural = !options.importedHeight && !configuration.sketch?.processing && (runtime!.source === 'neural-python' || runtime!.source === 'neural');
      let compute: 'cpu' | 'gpu' = runtime!.compute === 'gpu' ? 'gpu' : 'cpu',
        softwareGpu = false;
      if (runtime!.compute === 'auto') {
        // Local CUDA services select their own device; an unrelated browser driver
        // must not hold up their model loading.
        if (remoteNeural) compute = 'gpu';
        else {
          report(onProgress, 'compute', 'Detecting CPU and WebGPU capabilities…', 0, 0);
          try {
            const adapter = await gpuSetupDeadline((await import('../../../rust/bridge/webGpuAdapter')).requestWebGpuAdapter());
            compute = adapter ? 'gpu' : 'cpu';
            softwareGpu = !!adapter?.info?.isFallbackAdapter;
            if (['procedural', 'procedural-phasor'].includes(runtime!.source) && softwareGpu) compute = 'cpu';
          } catch {
            compute = 'cpu';
          }
        }
      }
      const gpuGeneration = ['gpu', 'gpu-all', 'gpu-erosion'].includes(configuration.generationCompute ?? '');
      if (runtime!.compute === 'cpu' && (configuration.compute === 'gpu-f32' || gpuGeneration)) throw new Error('CPU execution conflicts with explicit GPU terrain controls. Choose automatic/GPU or reset those controls.');
      if (runtime!.compute === 'gpu' && configuration.compute === 'wasm' && !remoteNeural) throw new Error('GPU execution conflicts with explicit WASM CPU sampling. Choose automatic/CPU or reset the sampling control.');
      if (configuration.compute === 'wasm' && gpuGeneration) throw new Error('GPU terrain generation requires GPU sampling. Select GPU FP32 or reset generation compute.');
      if (configuration.compute === 'wasm' && !remoteNeural) compute = 'cpu';
      else if (configuration.compute === 'gpu-f32' || ['gpu', 'gpu-all', 'gpu-erosion'].includes(configuration.generationCompute ?? '')) compute = 'gpu';
      if (softwareGpu && compute === 'cpu' && ['procedural', 'procedural-phasor'].includes(runtime!.source)) report(onProgress, 'compute', 'WebGPU logiciel détecté · sélection du CPU pour le procédural', 0, 0);
      const { seed: _seed, width: _width, source: _source, neuralAssets: _assets, neuralServer: _server, forest: _forest, reliefClimate, ...controls } = configuration;
      // A climate variant may keep another zone's landforms: relief and water follow reliefClimate; cover, season and rendering keep configuration's zone.
      if (reliefClimate) Object.assign(controls, { climateZone: reliefClimate, climate: CLIMATE_ZONE_BASE[reliefClimate], climateValues: { ...CLIMATE_ZONE_VALUES[reliefClimate] } });
      if (runtime!.compute === 'gpu' && runtime!.backend !== 'native' && !remoteNeural && !options.importedHeight && !controls.sketch && !controls.zones && ['procedural', 'procedural-phasor'].includes(runtime!.source) && !controls.generationCompute)
        controls.generationCompute = 'gpu-erosion';
      if (options.importedHeight) {
        const sourceN = sourceDefinition(configuration).n;
        const image = importedHeightfield(options.importedHeight, options.mapSize!, sourceN, options.heightScale ?? 120, options.importSea ?? 0).height;
        controls.sketch = { version: 1, resolution: sourceN, heights: Array.from(image.data), processing: 'surface' };
      }
      const execute = () =>
        generateEngineHeight(
          {
            seed: configuration.seed,
            width: options.mapSize!,
            relief: configuration.relief,
            coast: options.coast,
            climate: options.biome === 'desert' ? 'arid' : options.biome === 'tropical' ? 'tropical' : options.biome === 'tundra' ? 'cold' : 'temperate',
            compute,
            strictCompute: runtime!.compute === 'gpu' || configuration.compute === 'gpu-f32' || gpuGeneration,
            source: runtime!.source,
            native: runtime!.backend === 'native',
            localServer: runtime!.localServer,
            pythonServer: runtime!.pythonServer,
            neuralServer: runtime!.neuralServer,
            neuralAssets: ['procedural', 'procedural-phasor'].includes(runtime!.source) || controls.sketch?.processing ? undefined : resolveModelAssets(runtime!.neuralAssets, assetBase),
            resolution: controls.resolution,
            erosion: controls.erosion,
            terrain: controls,
            terrainStage,
          },
          (message, work) => onProgress?.({ stage: work?.stage ?? 'relief-engine', label: message, completed: work?.completed ?? 0, total: work?.total ?? 0, ...(work?.detail ? { detail: work.detail } : {}) }),
        );
      let generated;
      try {
        generated = await execute();
      } catch (error) {
        if (runtime!.backend === 'native') throw error;
        if (runtime!.compute !== 'auto' || compute !== 'gpu' || !['procedural', 'procedural-phasor'].includes(runtime!.source) || configuration.compute === 'gpu-f32' || ['gpu', 'gpu-all', 'gpu-erosion'].includes(configuration.generationCompute ?? '')) throw error;
        report(onProgress, 'relief-engine', 'GPU unavailable: restarting procedural terrain on the CPU…', 0, 3);
        compute = 'cpu';
        generated = await execute();
      }
      options.importedHeight = generated.importedHeight;
      options.heightScale = generated.heightScale;
      options.importSea = generated.importSeaLevel;
      engineStats = generated.stats;
      if (!generated.terrain) throw new Error('The Rust adapter did not return the retained terrain and water network.');
      report(onProgress, 'terrain-projection', 'Preparing the map, coastlines and water network…', 0, 0);
      nativeTerrain = projectEngineTerrain(generated.terrain);
      // Overlap style-independent display fields with cover, regional and urban generation.
      if (includeCover) startTerrainDisplayPreparation(nativeTerrain, options.mapSize!);
    } else if (!options.importedHeight && settings.runtime?.compute === 'gpu') {
      throw new Error('Le moteur TypeScript fonctionne sur CPU. Choisissez Rust pour utiliser le GPU.');
    }
    terrain = nativeTerrain ?? terrainForExtent({ ...options, seed: configuration.seed }, options.mapSize!, new Rng('magna-urbis:' + configuration.seed)).terrain;
    // Rust results retain their own hydrology; only the explicitly selected classic engine runs TS drainage.
    (terrain as TerrainLayer & { v2EngineStats?: Record<string, string | number> }).v2EngineStats = engineStats;
    if (includeCover) startTerrainDisplayPreparation(terrain, options.mapSize!);
    report(onProgress, 'terrain-cache', 'Saving terrain and hydrology…', 1, 3);
    if (!terrainStage || includeCover) persisted = await cache.put(key, terrain);
  }
  if (!includeCover) {
    if (previewKey) {
      stagePreviews.delete(previewKey);
      stagePreviews.set(previewKey, structuredClone(terrain));
      if (stagePreviews.size > 4) stagePreviews.delete(stagePreviews.keys().next().value!);
    }
    return {
      seed: options.seed,
      options: { ...options, workflow: 'environment' },
      mapSize: options.mapSize!,
      terrain,
      landuse: { areas: [], farmsteads: [], reserve: [] },
      stats: {
        'v2.stage': 'terrain',
        'v2.previewStage': terrainStage!,
        'v2.engine': V2_ENGINE_VERSION,
        'v2.terrainKey': key,
        ...((terrain as V2TerrainLayer).v2EngineStats ?? {}),
        'v2.cache': hit?.source ?? 'miss',
        'v2.persisted': 0,
        'ms.total': Math.round(performance.now() - t0),
      },
    };
  }
  startTerrainDisplayPreparation(terrain, options.mapSize!);
  report(onProgress, 'biome', 'Classifying the biome and natural cover…', 2, 3);
  const retained = terrain as V2TerrainLayer;
  if (nativeEngine) {
    const forestKey = key + stableStringify(configuration.forest),
      cachedForest = forestFields.get(forestKey);
    if (cachedForest) {
      retained.v2ForestField = structuredClone(cachedForest.field);
      retained.v2NaturalForest = cachedForest.cover.slice();
    } else {
      const climate = configuration.climateValues!;
      const forestRuntime = settings.runtime?.backend === 'native' ? { profile: 'local' as const, server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') } : undefined;
      const forest = await buildForestField(
        {
          seed: seedHash(stepSeed(settings.options.seed, 'cover-climate')),
          climate: [climate.temperature, climate.precipitation],
          height: { x: 0, y: 0, width: options.mapSize!, n: terrain.height.w, data: terrain.height.data },
          water: terrain.water,
          // The displayed river geometry defines the riverside gallery (displayForest.ts forestDisplayRivers).
          riverSegments: (await import('./displayForest')).forestDisplayRivers(retained.v2NativeTerrain?.water, configuration.climateZone),
        },
        configuration.forest,
        forestRuntime,
      );
      retained.v2ForestField = forest;
      const cover = new Float32Array(terrain.height.data.length),
        n = terrain.height.w;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cover[y * n + x] = forest.rgba[(Math.min(forest.n - 1, Math.floor(((y + 0.5) * forest.n) / n)) * forest.n + Math.min(forest.n - 1, Math.floor(((x + 0.5) * forest.n) / n))) * 4] / 255;
      retained.v2NaturalForest = cover;
      forestFields.set(forestKey, { field: structuredClone(forest), cover: cover.slice() });
      if (forestFields.size > 3) forestFields.delete(forestFields.keys().next().value!);
    }
  }
  const biome = options.biome;
  const coverKey = key + stableStringify([biome, nativeEngine ? configuration.forest : null]);
  const cachedCover = naturalCovers.get(coverKey);
  const landuse = cachedCover
    ? structuredClone(cachedCover)
    : await generateNaturalCoverNative(
        terrain,
        biome,
        new Rng('magna-urbis:' + stepSeed(settings.options.seed, 'cover-climate')),
        retained.v2NaturalForest,
        settings.runtime?.backend === 'native' ? { profile: 'local', server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') } : undefined,
      );
  if (!cachedCover) {
    naturalCovers.set(coverKey, structuredClone(landuse));
    if (naturalCovers.size > 3) naturalCovers.delete(naturalCovers.keys().next().value!);
  }
  const world: World = {
    seed: options.seed,
    options: { ...options, workflow: 'environment' },
    mapSize: options.mapSize!,
    terrain,
    landuse,
    stats: {
      'v2.stage': 'terrain',
      'v2.engine': V2_ENGINE_VERSION,
      'v2.terrainKey': key,
      ...((terrain as TerrainLayer & { v2EngineStats?: Record<string, string | number> }).v2EngineStats ?? {}),
      'v2.cache': hit?.source ?? 'miss',
      'v2.persisted': persisted ? 1 : 0,
      'ms.total': Math.round(performance.now() - t0),
    },
  };
  refreshCavernMask(world);
  report(onProgress, 'terrain', 'Topography ready', 3, 3, hit?.source ?? 'miss');
  recordGenerationValidity(world, settings, 'terrain');
  return world;
}

function assertTerrain(world: World, settings: V2Settings): void {
  // Auto is a recommendation at terrain creation time, not permission to resize an already retained map.
  if (!retainedTerrainMatchesSettings(world, settings)) throw new Error('Terrain settings have changed. Regenerate the topography before continuing.');
}
function nameWorld(world: World, mainOptions?: Partial<Options>): void {
  const root = new Rng('magna-urbis:' + world.seed);
  const bank = world.names?.bank;
  world.names = generateNames(mainOptions ? { ...world, options: { ...world.options, ...mainOptions } } : world, root);
  world.names.bank = bank;
  settlementNames(world, root);
  applyNameOverrides(world);
}

/** A new placement replaces every place of the input world: the previous run's per-place targets, town stages,
 * refusals, warnings and placement/city fingerprints must not describe the new places (same keys, another seed). */
const PLACEMENT_STAT =
  /^(v2\.(population|culture|urban[A-Za-z]*|housesRegenerated):|v2\.valid:(settle|city)-|v2\.(planKey|placementKey|cityOutput|cityOutputKeys|regionPopulation|requestedRegionPopulation|requestedIsolatedSites|regionalRoads|baseBridges|unreachable|urbanBackend)$|settlements(\.|$)|ms\.(region|towns)$)/;
export function regionInputStats(stats: World['stats']): World['stats'] {
  return Object.fromEntries(Object.entries(stats).filter(([name]) => !PLACEMENT_STAT.test(name)));
}
/** This stage never invokes the urban generator: the retained region contains only sites and regional routes. */
/** `deferSite`: the town stages follow in this request (whole chain): the native site fields may arrive during them (finishTowns). */
export async function planRegion(terrainWorld: World, settings: V2Settings, onProgress?: ProgressCallback, deferSite = false): Promise<World> {
  validateSettings(settings);
  assertTerrain(terrainWorld, settings);
  const t0 = performance.now(),
    root = new Rng('magna-urbis:' + stepSeed(settings.options.seed, 'settle-sites'));
  const roadRoot = stepSeed(settings.options.seed, 'settle-roads') === stepSeed(settings.options.seed, 'settle-sites') ? root : new Rng('magna-urbis:' + stepSeed(settings.options.seed, 'settle-roads'));
  const options = effectiveOptions(settings, terrainWorld.mapSize);
  const placement = effectiveRegion(settings).placement;
  options.workflow = 'list';
  options.settlements = {
    list: placement.list.map(spec => ({
      key: spec.key,
      population: spec.population,
      culture: spec.culture,
      name: spec.name,
      position: spec.position,
      siteType: spec.siteType === 'auto' ? undefined : (spec.siteType as import('../gen/types').SiteArchetype),
      options: { sitePrefs: spec.sitePrefs },
    })),
  };
  const mainOptions = { ...optionsForMainSettlement(options), ...settings.local.main };
  mainOptions.size = sizeForPop(mainPopulation(mainOptions, root));
  const world: World = { seed: options.seed, options, mapSize: terrainWorld.mapSize, terrain: cloneV2TerrainForStage(terrainWorld.terrain), landuse: terrainWorld.landuse, stats: { ...regionInputStats(terrainWorld.stats), 'v2.stage': 'region' } };
  if (!placement.list.length) {
    world.settlements = [];
    world.roads = [];
    world.bridges = [];
    world.names = { family: 'english', town: settings.naming?.title ?? '', entries: [] };
    world.stats['v2.planKey'] = regionKey(settings);
    world.stats['v2.placementKey'] = placementKey(settings);
    Object.assign(world.stats, { settlements: 0, 'settlements.requested': 0, 'v2.regionPopulation': 0, 'v2.requestedRegionPopulation': regionalPopulation(settings).population });
    recordGenerationValidity(world, settings, 'region');
    return world;
  }
  if (settings.runtime?.backend && settings.runtime.backend !== 'typescript') {
    await (await import('./region')).planRustRegion(world, settings, onProgress, false, deferSite);
    world.stats['v2.planKey'] = regionKey(settings);
    world.stats['v2.placementKey'] = placementKey(settings);
    nameWorld(world, mainOptions);
    const native = (world.debug?.v2RustRegion as import('./region').RustRegionSnapshot).placement;
    for (const spec of native.settlements)
      if (spec.name) {
        const place = world.settlements!.find(s => s.key === spec.key);
        if (place) {
          place.name = spec.name;
          if (place.main) {
            world.names!.town = spec.name;
            const entry = world.names!.entries.find(e => e.kind === 'town');
            if (entry) entry.text = spec.name;
          } else {
            const entry = world.names!.entries.find(e => e.sub === 'settlement:' + place.key);
            if (entry) entry.text = spec.name;
          }
        }
      }
    refreshCavernMask(world);
    recordGenerationValidity(world, settings, 'region');
    return world;
  }
  report(onProgress, 'sites', 'Finding suitable settlement sites…', 0, 4);
  const cprefs = getCulture(mainOptions.culture).sitePrefs;
  const siteRuntime = settings.runtime?.backend === 'native' ? { profile: 'local' as const, server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') } : undefined;
  world.site = await chooseSiteRust(world.terrain, mainOptions.sitePrefs || !cprefs ? mainOptions : { ...mainOptions, sitePrefs: cprefs }, world.mapSize, root, siteRuntime);
  report(onProgress, 'roads', 'Routing regional connections…', 1, 4);
  const roads = routeRoads(world.terrain, world.site, mainOptions, world.mapSize, roadRoot);
  world.roads = roads.roads;
  world.bridges = roads.bridges;
  report(onProgress, 'sites', 'Placing the settlement hierarchy…', 2, 4);
  if (options.workflow !== 'list' && Object.keys(settings.local).some(key => key !== 'main')) {
    // Feed local positioning and site preferences into the real planner before geometry is committed.
    const t = world.terrain,
      count = t.height.w * t.height.h;
    let usable = 0;
    for (let i = 0; i < count; i += 2) if (t.water[i] === 0 && t.slope.data[i] < 0.3) usable++;
    const requests = settlementRequests(options, (usable * 2 * t.height.cell ** 2) / 1e6, mainPopulation(mainOptions, root), root);
    options.settlements = {
      list: [
        { population: mainPopulation(mainOptions, root), culture: mainOptions.culture, position: mainOptions.center, options: localOverrides(mainOptions) },
        ...requests.map(request => {
          const local = settings.local[request.key] ?? {};
          return {
            key: request.key,
            population: local.population ?? request.pop,
            culture: local.culture ?? request.culture,
            position: local.center ?? request.position,
            siteType: local.siteType === 'auto' ? undefined : (local.siteType ?? request.siteType),
            options: { ...request.options, ...localOverrides(local) },
          };
        }),
      ],
    };
    options.workflow = 'list';
  }
  const plan = planSettlements(world, options, root, mainOptions, mainPopulation(mainOptions, root));
  world.settlements = plan.settlements;
  for (const settlement of world.settlements) {
    world.stats['v2.population:' + settlement.key] = settlement.population;
    world.stats['v2.culture:' + settlement.key] = settlement.culture;
  }
  for (const settlement of world.settlements) if (!settlement.main && settlement.detail !== 'farmstead') settlement.detail = 'lazy';
  report(onProgress, 'network', 'Connecting settlements with the road network…', 3, 4);
  if (world.settlements.length > 1) {
    const net = routeNetwork(world, world.settlements, roadRoot);
    world.roads.push(...net.roads);
    world.bridges.push(...net.bridges);
    world.stats['v2.unreachable'] = net.unreachable.length;
    plan.warnings.push(...net.warnings);
  }
  world.stats['v2.regionalRoads'] = world.roads.length;
  world.stats['v2.baseBridges'] = world.bridges.length;
  world.debug = { v2BaseBridges: structuredClone(world.bridges), v2TownBridges: {} };
  world.stats['v2.planKey'] = regionKey(settings);
  world.stats['settlements'] = world.settlements.length;
  world.stats['settlements.requested'] = plan.requested;
  world.stats['v2.regionPopulation'] = world.settlements.reduce((n, p) => n + p.population, 0);
  world.stats['v2.requestedRegionPopulation'] = regionalPopulation(settings).population;
  if (world.site.warning) plan.warnings.push(world.site.warning);
  if (plan.warnings.length) world.stats['settlements.warning'] = plan.warnings.join(' | ');
  world.stats['ms.region'] = Math.round(performance.now() - t0);
  nameWorld(world, mainOptions);
  refreshCavernMask(world);
  report(onProgress, 'network', 'Settlement sites and roads ready', 4, 4);
  recordGenerationValidity(world, settings, 'region');
  return world;
}

/** Only parameters that can move the regional sites require replanning. Town morphology remains local. */
function regionKey(settings: V2Settings): string {
  const o = settings.options;
  return stableStringify([
    o.population,
    o.culture,
    o.siteType,
    o.sitePrefs,
    o.center,
    o.roads,
    o.settlements,
    o.workflow,
    settings.runtime?.backend,
    generationRegion(settings.region),
    settings.settlementCount,
    Object.entries(settings.local)
      .filter(([key, o]) => o.center !== undefined || o.siteType !== undefined || o.sitePrefs !== undefined || (key === 'main' && o.roads !== undefined))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, o]) => [key, o.center, o.siteType, o.sitePrefs, key === 'main' ? o.roads : undefined]),
    ...(stepSeed(o.seed, 'settle-sites') !== seedRoot(o.seed) || stepSeed(o.seed, 'settle-roads') !== seedRoot(o.seed) ? [stepSeed(o.seed, 'settle-sites'), stepSeed(o.seed, 'settle-roads')] : []),
    REGIONAL_POPULATION_VERSION,
  ]);
}
function historicalClassicRegionKey(settings: V2Settings): string {
  const frame: unknown[] = JSON.parse(regionKey(settings));
  frame.splice(8, 2);
  return stableStringify(frame);
}
function placementKey(settings: V2Settings): string {
  const recipe = { ...settings, options: { ...settings.options }, local: { ...settings.local }, ...(settings.region ? { region: { ...settings.region } } : {}) };
  delete (recipe.options as Partial<Options>).roads;
  if (recipe.region) {
    delete recipe.region.roads;
    delete recipe.region.resolution;
    if (!Object.keys(recipe.region).length) delete recipe.region;
  }
  if (recipe.local.main) {
    recipe.local.main = { ...recipe.local.main };
    delete recipe.local.main.roads;
  }
  recipe.options.seed = seedSubset(recipe.options.seed, key => key !== 'settle-roads');
  return regionKey(recipe);
}
/** Reuse exact sites, terrain and city geometry while replacing only the regional road network. */
export async function rerouteRegion(source: World, settings: V2Settings, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings);
  assertTerrain(source, settings);
  if (settings.runtime?.backend === 'typescript' || !settings.runtime) throw new Error('Independent regional routing requires the Rust engine.');
  if (!source.settlements?.length) throw new Error('Place settlements before routing their roads.');
  if (!matchesRustTransport(settings, placementKey, source.stats['v2.placementKey'])) throw new Error('The placement recipe has changed. Run placement before routing the new roads.');
  const world = cloneV2WorldForGeneration(source),
    oldTownBridges = world.debug?.v2TownBridges as Record<string, NonNullable<World['bridges']>> | undefined;
  const savedUrban = world.urban;
  await (await import('./region')).planRustRegion(world, settings, onProgress, true);
  world.urban = savedUrban;
  if (oldTownBridges) {
    world.debug!.v2TownBridges = oldTownBridges;
    world.bridges!.push(...Object.values(oldTownBridges).flat());
  }
  world.stats['v2.planKey'] = regionKey(settings);
  recordGenerationValidity(world, settings, 'roads');
  return world;
}
function localOverrides(options: Partial<Options>): SettlementOverrides {
  return Object.fromEntries(SETTLEMENT_OVERRIDE_KEYS.filter(key => options[key] !== undefined).map(key => [key, options[key]]));
}
function assertRegion(world: World, settings: V2Settings): void {
  assertTerrain(world, settings);
  if (!world.site || !world.settlements?.length) throw new Error('Place the settlement sites and roads first.');
  const legacyClassic = typeof world.stats['v2.terrainKey'] === 'string' && world.stats['v2.terrainKey'].startsWith(`["${LEGACY_TS_KEY}",`) && classicTerrain(settings);
  if (!matchesRustTransport(settings, regionKey, world.stats['v2.planKey']) && !(legacyClassic && world.stats['v2.planKey'] === historicalClassicRegionKey(settings))) throw new Error('Placement settings have changed. Recalculate settlement sites and roads.');
}

/** Independent native cities computed at once (the engine has one thread per connection). */
const TOWN_CONCURRENCY = 4;
/** Native towns of a run with the never-built earlier towns they may border, each after those it waits for
 * (`townNeighbours`); the classic engine keeps the selection as it is. */
function townRun(world: World, settings: V2Settings, keys: readonly string[]): TownRun | undefined {
  const backend = settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
  return backend === 'typescript' ? undefined : planTownRun(townSeats(world, settings), keys);
}
/** Stage of each town of a run: the requested one, except a town added as a dependent neighbour, which is
 * regenerated through the stage it was built to (never further). */
function runStages(world: World, run: TownRun | undefined, keys: readonly string[], through?: V2TownStage): Map<string, V2TownStage | undefined> {
  const cities = world.debug?.v2RustCities as Record<string, { stage?: V2TownStage }> | undefined;
  return new Map(keys.map(key => [key, run?.cascaded.has(key) ? (cities?.[key]?.stage ?? (world.stats[`v2.urbanStage:${key}`] as V2TownStage | undefined)) : through]));
}
async function buildTown(
  world: World,
  settings: V2Settings,
  key: string,
  onProgress?: ProgressCallback,
  through?: V2TownStage,
  /** Native city already computed (or being computed) concurrently from the pre-loop world; only applied here. */
  precomputed?: Promise<Awaited<ReturnType<typeof import('./rustUrban').generateRustTown>>>,
): Promise<void> {
  const settlement = world.settlements!.find(s => s.key === key);
  if (!settlement) throw new Error(`Lieu inconnu : ${key}`);
  const backend = settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
  const requestedStage = through ?? settings.urban?.local?.[key]?.through ?? settings.urban?.through ?? 'buildings';
  if (settlement.detail === 'farmstead' && backend === 'typescript') return;
  assertUrbanPhysicalCapability(world, backend);
  const override = settings.local[key] ?? {};
  const population = Number(world.stats['v2.population:' + key] ?? settlement.population);
  const options = {
    ...settings.options,
    ...override,
    mapSize: world.mapSize,
    population: override.population ?? population,
    culture: override.culture ?? String(world.stats['v2.culture:' + key] ?? settlement.culture),
    size: override.size ?? sizeForPop(override.population ?? population),
    workflow: 'list' as const,
    settlements: 'none' as const,
  };
  const localSeed = urbanSeed(settings, key, 'composition');
  options.seed = localSeed;
  const baseBridges = (world.debug?.v2BaseBridges ?? world.bridges ?? []) as NonNullable<World['bridges']>;
  world.debug ??= {};
  const townBridges = (world.debug.v2TownBridges ??= {}) as Record<string, NonNullable<World['bridges']>>;
  if (backend !== 'typescript') {
    const result = await (precomputed ?? (await import('./rustUrban')).generateRustTown(world, settings, key, onProgress, requestedStage));
    if (settlement.main) world.urban = result.urban;
    settlement.urban = result.urban;
    if (!settlement.main) settlement.detail = 'eager';
    const cities = (world.debug.v2RustCities ??= {}) as Record<string, unknown>;
    cities[key] = result.snapshot;
    // A town built beside its placed centre publishes its built core: label, click target and camera follow the houses.
    const core = builtCore(result.snapshot.layouts, settlement.center, settlement.radius, result.urban.buildings);
    if (core) settlement.core = core;
    else delete settlement.core;
    Object.assign(world.stats, result.stats);
    // The page draws the cities on this ground: the worker's cached settlement raster, not a second build on the main thread.
    (await import('./rustUrban')).retainCityGround(world);
  } else if (requestedStage !== 'buildings') {
    throw new Error('Independent urban stages require the Rust engine. The classic engine generates the complete plan.');
  } else if (settlement.main) {
    const sub: World = { seed: localSeed, options, mapSize: world.mapSize, terrain: world.terrain, site: structuredClone(world.site), roads: structuredClone(world.roads), bridges: structuredClone(baseBridges), stats: {} };
    const root = new Rng('magna-urbis:' + localSeed),
      eager = options.eagerPop ?? EAGER_MAIN_POP;
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
    const local = { ...settlement, culture: options.culture, population: options.population, options: { ...settlement.options, ...localOverrides(options) } };
    const sub: World = { ...world, seed: localSeed, options, bridges: baseBridges };
    const result = generateSettlementUrban(sub, local);
    if (result) {
      settlement.urban = result.urban;
      settlement.detail = 'eager';
      townBridges[key] = result.bridges;
    }
  }
  settlement.population = options.population;
  settlement.culture = options.culture;
  settlement.options = localOverrides(options);
  world.bridges = [
    ...baseBridges,
    ...Object.keys(townBridges)
      .sort()
      .flatMap(key => townBridges[key]),
  ];
  world.stats['v2.stage'] = 'towns';
  recordGenerationValidity(world, settings, 'town', key, requestedStage);
}

/** Set by the engine worker, which renames every result after its action (mapNaming.renameMap, from the same geometry):
 * the town stage then skips its own names pass, which that rename replaced entirely (0.6 s for a town of 100,000). */
let renamedAfterActions = false;
export function namesRenamedAfterActions(): void {
  renamedAfterActions = true;
}
async function finishTowns(world: World, settings: V2Settings, onProgress?: ProgressCallback): Promise<void> {
  // Rebuild cultivation from the retained plans, never from the expensive terrain stage.
  await (await import('./region')).settleRegionSite(world);
  report(onProgress, 'landuse', 'Updating cultivated land and names…', 0, 1);
  world.options = { ...effectiveOptions(settings, world.mapSize), workflow: world.options.workflow };
  const nativeRegion = world.debug?.v2RustRegion as import('./region').RustRegionSnapshot | undefined;
  const nativeCities = Object.values((world.debug?.v2RustCities ?? {}) as Record<string, import('./rustUrban').RustTownSnapshot>);
  if (nativeRegion && nativeCities.length) {
    const { rustSettlementRaster } = await import('./rustUrban');
    const raster = rustSettlementRaster(world),
      config = effectiveTerrainSettings(settings, world.mapSize),
      decor = retainedDecorOf(world.terrain);
    const layouts = nativeCities.flatMap(city => city.layouts),
      partitions = nativeCities.flatMap(city => city.partitions ?? []);
    const city = nativeRegion.placement.settlements.find(s => s.key === world.settlements?.find(s => s.main)?.key) ?? nativeRegion.placement.settlements[0];
    const parcel = partitions.find(p => p.key === city?.key);
    const rural = await generateUrbanLanduse({
      raster,
      seed: world.seed,
      biome: world.options.biome ?? 'temperate',
      relief: (['flat', 'hills', 'valley'].includes(config.relief) ? config.relief : 'mountains') as import('../gen/options').Relief,
      city,
      neighbours: nativeRegion.placement.settlements.filter(s => s.key !== city?.key),
      roads: nativeRegion.roads ?? undefined,
      layouts,
      ruralOptions: cityCountrysideOptions(parcel),
      forest: {
        settings: config.forest,
        input: cityForestInput(world.seed, config.climateValues!, { x: 0, y: 0, width: raster.width, n: raster.n, data: raster.height }, raster.water, decor ? { riverSegments: forestRetainedRiverSegments(decor.meta.waterSvg, raster.width) } : {}),
      },
      runtime: settings.runtime?.backend === 'native' ? { profile: 'local', server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') } : undefined,
    });
    world.landuse = rural.landuse;
  } else if (world.urban) {
    const mainOptions = { ...world.options, ...settings.local.main };
    // Rust resource soil (depth, stoniness, drainage); the noise field only when no resource payload exists (TypeScript backend).
    const resources = await (await import('./region')).regionResources(world, settings);
    const rural = await generateRuralNative(
      { ...world, options: mainOptions },
      new Rng('magna-urbis:' + world.seed),
      Number(world.stats['v2.regionalRoads'] ?? world.roads?.length ?? 0),
      undefined,
      (world.terrain as V2TerrainLayer).v2NaturalForest ? { footprint: world.urban.footprintH ?? [], population: world.urban.population, naturalForest: (world.terrain as V2TerrainLayer).v2NaturalForest, cropSurplus: effectiveRegion(settings).cropSurplus } : undefined,
      resources && (await import('./resourceSoil')).ruralSoilField(resources),
      settings.runtime?.backend === 'native' ? { profile: 'local', server: loopbackServer(settings.runtime.localServer ?? 'http://127.0.0.1:8791') } : undefined,
    );
    world.landuse = rural.layer;
  }
  if (!renamedAfterActions) nameWorld(world, settings.local.main);
  refreshCavernMask(world);
  // Isolated buildings (farms, mills, chapels…) follow the architecture in use, like the towns.
  await (await import('./activitySites')).planActivityArchitecture(world, settings);
  report(onProgress, 'complete', 'Settlements generated', 1, 1);
}
/** One town with the never-built neighbours it needs first and the built neighbours that follow it. */
async function buildTownRun(world: World, settings: V2Settings, key: string, onProgress?: ProgressCallback, stage?: V2TownStage): Promise<void> {
  const run = townRun(world, settings, [key]),
    order = run?.order ?? [key],
    stages = runStages(world, run, order, stage);
  for (const [i, place] of order.entries()) {
    const s = world.settlements!.find(s => s.key === place)!,
      town = forSettlement(onProgress, i, order.length, s);
    if (order.length > 1) report(town, 'town', `${s.name ?? s.key}: plan, streets, parcels and buildings…`, i, order.length);
    await buildTown(world, settings, place, town, stages.get(place));
  }
}
export async function generateTown(regionWorld: World, settings: V2Settings, key: string, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings);
  assertRegion(regionWorld, settings);
  const world = cloneV2WorldForGeneration(regionWorld),
    t0 = performance.now();
  report(onProgress, 'town', 'Plan → quarters → streets → blocks → parcels → buildings…', 0, 1);
  await buildTownRun(world, settings, key, onProgress);
  await finishTowns(world, settings, onProgress);
  world.stats['ms.towns'] = Math.round(performance.now() - t0);
  return world;
}
export async function generateTowns(regionWorld: World, settings: V2Settings, onProgress?: ProgressCallback, keys?: readonly string[], through?: V2TownStage, keepUrbanLanes = false): Promise<World> {
  if (regionWorld.settlements?.length === 0 && regionWorld.stats['v2.stage'] === 'region') return cloneV2WorldForGeneration(regionWorld);
  validateSettings(settings);
  assertRegion(regionWorld, settings);
  if (keys) {
    if (!keys.length) throw new Error('Select at least one city in the list on the right.');
    for (const key of keys) if (!regionWorld.settlements!.some(place => place.key === key)) throw new Error(`Unknown settlement: ${key}`);
  }
  const selected = keys ? new Set(keys) : undefined;
  const backend = settings.urban?.backend ?? settings.runtime?.backend ?? 'typescript';
  const world = cloneV2WorldForGeneration(regionWorld),
    t0 = performance.now(),
    chosen = world.settlements!.filter(s => (!selected || selected.has(s.key)) && (backend !== 'typescript' || s.detail !== 'farmstead'));
  // Native towns: neighbours first (canonical order), never-built neighbours included; far towns keep the list order.
  const run = townRun(
    world,
    settings,
    chosen.map(s => s.key),
  );
  const places = run ? run.order.map(key => world.settlements!.find(s => s.key === key)!) : chosen;
  const stages = runStages(
    world,
    run,
    places.map(place => place.key),
    through,
  );
  // WASM calls share this worker's JS thread: concurrent lanes only duplicate terrain/pools.
  // Its one engine uses the internal Rust/pool parallelism where a stage has enough work.
  if (backend !== 'native' || places.length < 2 || TOWN_CONCURRENCY < 2) {
    for (let i = 0; i < places.length; i++) {
      const town = forSettlement(onProgress, i, places.length, places[i]);
      report(town, 'town', `${places[i].name ?? places[i].key}: plan, streets, parcels and buildings…`, i, places.length);
      await buildTown(world, settings, places[i].key, town, stages.get(places[i].key));
    }
  } else {
    // Native cities only read the pre-loop world (roads, terrain key, their own retained snapshot) and write
    // only per-city entries: compute up to TOWN_CONCURRENCY at once, then apply in the original order.
    const n = places.length;
    type Outcome = { ok: true; value: Awaited<ReturnType<typeof import('./rustUrban').generateRustTown>> } | { ok: false; error: unknown };
    const waiters: ((o: Outcome) => void)[] = [],
      outcomes = places.map(
        (_, i) =>
          new Promise<Outcome>(resolve => {
            waiters[i] = resolve;
          }),
      );
    // Only the leader (first unapplied city) drives the stage rows, so progress never interleaves; a new leader replays its last event.
    let leader = 0;
    const last: (Parameters<ProgressCallback>[0] | undefined)[] = [];
    const towns = places.map((place, i) => forSettlement(onProgress, i, n, place));
    const forward =
      (i: number) =>
      (p: Parameters<ProgressCallback>[0]): void => {
        last[i] = p;
        if (i === leader) towns[i]?.(p);
      };
    const { generateRustTown, releaseUrbanLanes } = await import('./rustUrban');
    let completed = false;
    const index = new Map(places.map((place, i) => [place.key, i]));
    const work = createTownRunQueue(places.map(place => (run?.waits.get(place.key) ?? []).map(key => index.get(key)!)));
    const lane = async (laneId: number): Promise<void> => {
      for (;;) {
        const i = await work.next();
        if (i === undefined) return;
        try {
          // A town starts once the earlier towns it may border are done (they come first in `places`), with their fresh claims.
          const fresh = new Map<string, Claim>();
          for (const dep of run?.waits.get(places[i].key) ?? []) {
            const outcome = await outcomes[index.get(dep)!];
            if (!outcome.ok) throw outcome.error;
            const claim = outcome.value.snapshot.layouts?.[0]?.claim;
            if (claim) fresh.set(dep, claim);
          }
          const neighbours = run ? neighbourClaimsOf(world, settings, places[i].key, fresh) : undefined;
          waiters[i]({ ok: true, value: await generateRustTown(world, settings, places[i].key, forward(i), stages.get(places[i].key), laneId, neighbours) });
        } catch (error) {
          waiters[i]({ ok: false, error });
        } finally {
          work.complete(i);
        }
      }
    };
    const lanes: Promise<void>[] = [];
    for (let k = 0; k < Math.min(TOWN_CONCURRENCY, n); k++) lanes.push(lane(k));
    try {
      for (let i = 0; i < n; i++) {
        leader = i;
        report(towns[i], 'town', `${places[i].name ?? places[i].key}: plan, streets, parcels and buildings…`, i, n);
        if (last[i]) towns[i]?.(last[i]!);
        const outcome = await outcomes[i];
        if (!outcome.ok) throw outcome.error;
        await buildTown(world, settings, places[i].key, undefined, stages.get(places[i].key), Promise.resolve(outcome.value));
      }
      completed = true;
    } finally {
      work.stop();
      await Promise.allSettled(lanes);
      if (!keepUrbanLanes || !completed) await releaseUrbanLanes();
    }
  }
  await finishTowns(world, settings, onProgress);
  world.stats['ms.towns'] = Math.round(performance.now() - t0);
  return world;
}

/** Direct route edits already have valid placement: do not replan or replace the hand-edited network. */
export async function updateRoadTowns(source: World, settings: V2Settings, keys: readonly string[], mode: 'access' | 'rebuild', onProgress?: ProgressCallback): Promise<World> {
  const cities = source.debug?.v2RustCities as Record<string, import('./rustUrban').RustTownSnapshot> | undefined;
  const external = keys.filter(key => cities?.[key]?.pendingRoadChanges?.adaptAccess !== false);
  if (mode === 'access') return (await import('./roadTownAccess')).rebuildTownRoadAccesses(source, settings, external);
  const accessed = external.length ? await (await import('./roadTownAccess')).rebuildTownRoadAccesses(source, settings, external) : source;
  return (await import('./urbanRoadRebuild')).rebuildRoadBlocks(accessed, settings, keys, onProgress);
}

/** Strict native urban stages can be inspected and resumed independently. */
export async function generateTownStage(regionWorld: World, settings: V2Settings, key: string, stage: V2TownStage, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings);
  assertRegion(regionWorld, settings);
  const world = cloneV2WorldForGeneration(regionWorld),
    t0 = performance.now();
  await buildTownRun(world, settings, key, onProgress, stage);
  await finishTowns(world, settings, onProgress);
  world.stats['ms.towns'] = Math.round(performance.now() - t0);
  return world;
}

/** Direct outline edits stay inside the chosen settlement; do not replan neighbouring towns or the countryside. */
export async function updateContourTown(source: World, settings: V2Settings, key: string, onProgress?: ProgressCallback): Promise<World> {
  validateSettings(settings);
  assertRegion(source, settings);
  const world = cloneV2WorldForGeneration(source),
    previous = (source.debug?.v2RustCities as Record<string, import('./rustUrban').RustTownSnapshot> | undefined)?.[key];
  await buildTown(world, settings, key, onProgress, previous?.stage ?? 'buildings');
  return { ...world, terrain: source.terrain, landuse: source.landuse };
}

export { serializeProject, parseProject, validateSettings } from './project';
