import init, { TerrainEngine } from '../pkg/wasm/magna_urbis_wasm.js';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import { GpuTerrainSampler, prepareGpu, generateGpuNoise, GPU_RELIEFS, GPU_GENERATION_RELIEFS } from './terrainGpu';
import { generateGpuTerrain, erodeGpuCoast, type ErosionProfile } from './terrainErosion';
import { PreparedHydrology, applyHydrologySurface, type HydrologyData, type HydrologySettings } from './hydrology';
import type { TerrainScene, TerrainStyle } from './terrainRender';

export const RELIEFS = ['flat', 'hills', 'valley', 'canyon', 'mountains', 'mixed', 'plateau', 'high-mountains', 'volcano', 'caldera', 'cavern'] as const;
export type TerrainRelief = typeof RELIEFS[number];
export const GEOLOGICAL_RELIEFS = ['plateau', 'volcano', 'caldera'] as const;
export const ENVIRONMENT_RELIEFS = ['flat', 'hills', 'mixed', 'mountains', 'high-mountains'] as const;
export type TerrainEnvironment = typeof ENVIRONMENT_RELIEFS[number];
export const COMPUTE_MODES = ['wasm', 'gpu-f32'] as const;
export type TerrainCompute = typeof COMPUTE_MODES[number];
export const COAST_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const ISLAND_MODES = ['island', 'archipelago', 'random'] as const;
export type IslandMode = typeof ISLAND_MODES[number];
export const TERRAIN_SOURCES = ['procedural', 'neural'] as const;
export type TerrainSource = typeof TERRAIN_SOURCES[number];
/** Relief families sketched for the neural coarse network (7.68 km cells). */
export const NEURAL_RELIEFS = ['flat', 'hills', 'valley', 'mountains', 'mixed', 'plateau', 'high-mountains'] as const;
export const NEURAL_CLIMATES = ['temperate', 'oceanic', 'mediterranean', 'arid', 'cold', 'tropical'] as const;
export type NeuralClimate = typeof NEURAL_CLIMATES[number];
/** The neural chain currently delivers one fixed 40 × 40 km map. */
export const NEURAL_EXTENT = 40000;
export const DEFAULT_NEURAL_SERVER = 'http://127.0.0.1:8792';
export interface TerrainSettings { seed: string; width: number; motifSize: number; relief: TerrainRelief; environment?: TerrainEnvironment; coastMask?: number; islandMode?: IslandMode; erosion: number; mountainMix: number; resolution: number; compute?: TerrainCompute; generationCompute?: 'cpu' | 'gpu' | 'gpu-all' | 'gpu-erosion'; hydrology?: HydrologySettings; source?: TerrainSource; climate?: NeuralClimate; fidelity?: number; neuralServer?: string }
export interface NeuralInfo { totalMs: number; coarseMs: number; baseMs: number; decoderMs: number; reconstructionMs: number; requestMs: number; evaluations: [number, number, number]; profile: string; land: number }
export interface TerrainRegion { x: number; y: number; extent: number; resolution: number }
export interface TerrainData {
  x: number; y: number; width: number; resolution: number; minHeight: number; maxHeight: number;
  globalMinHeight: number; globalMaxHeight: number; motifSize: number;
  height: Float32Array; caveMask: Uint8Array;
  normalX: Float32Array; normalY: Float32Array; normalZ: Float32Array; generationMs: number;
  backend?: TerrainCompute; backendReason?: string; prepareMs?: number; samplingMs?: number; gpuSetupMs?: number;
  generationBackend?: 'cpu' | 'gpu-noise-f32' | 'gpu-noise-all-f32' | 'gpu-erosion-f32' | 'neural'; generationReason?: string; noiseMs?: number; erosionMs?: number; gpuSimulationMs?: number; nativeEnvironmentMs?: number;
  erosionProfile?: ErosionProfile[];
  coastBackend?: 'cpu' | 'gpu-f32'; coastMs?: number; coastReason?: string;
  hydrology?: HydrologyData;
  hydrologySurfaceMs?: number;
  hydrologyError?: string;
  neural?: NeuralInfo;
}
export interface TerrainRequest { id: number; generation: number; kind: 'overview' | 'detail'; settings: TerrainSettings; region: TerrainRegion; scene?: { style: TerrainStyle; showContours: boolean } }
export type TerrainResponse = Pick<TerrainRequest, 'id' | 'generation' | 'kind'> & ({ terrain: TerrainData; scene?: TerrainScene; scenePreparationMs?: number } | { error: string });

let ready: Promise<unknown> | undefined;
let engine: TerrainEngine | undefined, engineKey = '';
let engineCoastKey = '';
let coastBackend: TerrainData['coastBackend'], coastReason: string | undefined;
let sampler: GpuTerrainSampler | undefined, samplerMode: TerrainCompute | undefined;
let generationBackend: TerrainData['generationBackend'] = 'cpu', generationReason: string | undefined;
let queue: Promise<unknown> = Promise.resolve();
let preparedHydrology: PreparedHydrology | undefined, hydrologyKey = '', hydrologyVectorKey = '';
let hydrology: HydrologyData | undefined;
let neuralInfo: NeuralInfo | undefined;
let hydrologyFailure: { key: string; message: string } | undefined;

/** Heights of the local Rust neural service: `1024²` FP32 metres over 40 km, sea at zero. */
async function fetchNeuralRelief(settings: TerrainSettings, coastMask: number, islandMode: IslandMode): Promise<{ heights: Float32Array; info: NeuralInfo }> {
  const server = (settings.neuralServer || DEFAULT_NEURAL_SERVER).replace(/\/$/, '');
  const params = new URLSearchParams({
    seed: settings.seed, relief: settings.relief, mix: String(settings.relief === 'mixed' ? settings.mountainMix : 0.5),
    coasts: String(coastMask), islands: islandMode, climate: settings.climate ?? 'temperate', noise: String(settings.fidelity ?? 0.05),
  });
  const started = performance.now();
  let response: Response;
  try { response = await fetch(`${server}/generate?${params}`, { cache: 'no-store' }); }
  catch { throw new Error(`service neuronal injoignable (${server}) : lancer « npm run neural:serve » dans web/`); }
  if (!response.ok) throw new Error(`service neuronal : ${await response.text()}`);
  const heights = new Float32Array(await response.arrayBuffer());
  const meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}');
  if (heights.length !== 1024 * 1024) throw new Error('service neuronal : surface incomplète');
  return { heights, info: { ...meta, requestMs: performance.now() - started } as NeuralInfo };
}

export function sampleRustTerrain(request: TerrainRequest): Promise<TerrainData> {
  const result = queue.then(() => sampleTerrain(request));
  queue = result.catch(() => undefined);
  return result;
}
async function sampleTerrain({ settings, region, kind }: TerrainRequest): Promise<TerrainData> {
  const mode = settings.compute === 'wasm' ? 'wasm' : 'gpu-f32';
  const generationMode = settings.generationCompute ?? 'gpu-erosion';
  const environment = (GEOLOGICAL_RELIEFS as readonly string[]).includes(settings.relief) ? settings.environment ?? 'mixed' : 'mixed';
  const coastMask = settings.relief === 'cavern' ? 0 : settings.coastMask ?? 0;
  const islandMode = settings.islandMode ?? 'island';
  const supported = GPU_RELIEFS.includes(settings.relief);
  const gpu = mode !== 'wasm' && supported ? prepareGpu(mode, settings.relief).catch(() => undefined) : undefined;
  // Vite embeds this asset in the standalone HTML (and in the inline worker).
  ready ??= (async () => init({ module_or_path: await (await fetch(wasmUrl)).arrayBuffer() }))();
  await ready;
  const started = performance.now();
  const readyGpu = await gpu;
  // Handle compilation failure immediately while preparation runs synchronously.
  const pipelineReady = readyGpu?.pipeline.then(pipeline => ({ pipeline }), () => undefined);
  const requestedGpuGeneration = generationMode !== 'cpu' && mode !== 'wasm' && GPU_GENERATION_RELIEFS.includes(settings.relief);
  const gpuGeneration = requestedGpuGeneration && !!readyGpu;
  // Device loss affects sampling; it must not replace an already prepared landscape.
  const neural = settings.source === 'neural';
  const key = neural
    ? JSON.stringify(['neural', settings.seed, settings.relief, settings.relief === 'mixed' ? settings.mountainMix : 0.5, coastMask, coastMask === 255 ? islandMode : 'island', settings.climate ?? 'temperate', settings.fidelity ?? 0.05, settings.neuralServer ?? ''])
    : JSON.stringify([settings.seed, settings.width, settings.relief, settings.relief === 'cavern' ? 0 : settings.erosion, settings.motifSize, settings.relief === 'mixed' ? settings.mountainMix : 0.5, requestedGpuGeneration ? generationMode : 'cpu', environment]);
  let prepareMs = 0, noiseMs = 0, erosionMs = 0, gpuSimulationMs = 0, nativeEnvironmentMs = 0;
  let erosionProfile: ErosionProfile[] | undefined;
  if (!engine || engineKey !== key) {
    sampler?.dispose(); sampler = undefined; samplerMode = undefined;
    engine?.free(); engine = undefined; engineKey = ''; engineCoastKey = '';
    const prepareStarted = performance.now();
    generationBackend = 'cpu'; generationReason = undefined;
    const mix = settings.relief === 'mixed' ? settings.mountainMix : 0.5;
    neuralInfo = undefined;
    if (neural) {
      // The coasts belong to the neural sketch; the engine retains the surface as is.
      const result = await fetchNeuralRelief(settings, coastMask, islandMode);
      engine = TerrainEngine.with_surface(settings.seed, NEURAL_EXTENT, result.heights);
      neuralInfo = result.info;
      generationBackend = 'neural';
    } else if (gpuGeneration && readyGpu) {
      try {
        if (generationMode === 'gpu-erosion' || settings.relief === 'volcano' || settings.relief === 'caldera' || settings.relief === 'plateau' || settings.relief === 'canyon') {
          const timing = { nativeEnvironmentMs: 0, profiles: [] as ErosionProfile[] };
          const source = await generateGpuTerrain(readyGpu.context, settings, timing);
          nativeEnvironmentMs = timing.nativeEnvironmentMs;
          erosionProfile = timing.profiles;
          gpuSimulationMs = performance.now() - prepareStarted - nativeEnvironmentMs;
          engine = TerrainEngine.with_source(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, source, environment);
          generationBackend = 'gpu-erosion-f32';
        } else {
          const noise = await generateGpuNoise(readyGpu.context, settings);
          noiseMs = performance.now() - prepareStarted;
          const erosionStarted = performance.now();
          engine = TerrainEngine.with_generation_noise(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, noise.coarse, noise.fine, environment);
          erosionMs = performance.now() - erosionStarted;
          generationBackend = generationMode === 'gpu-all' ? 'gpu-noise-all-f32' : 'gpu-noise-f32';
        }
      } catch (error) {
        generationReason = `Génération GPU indisponible : ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (!engine) engine = new TerrainEngine(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment);
    prepareMs = performance.now() - prepareStarted;
    engineKey = key;
  }
  // Reuse the underlying relief, then cut the coast before its physical erosion.
  const gpuCoast = coastMask !== 0 && generationMode !== 'cpu' && mode !== 'wasm';
  const coastKey = neural ? 'neural' : JSON.stringify([coastMask, coastMask === 255 ? islandMode : 'island', coastMask ? gpuCoast : false]);
  let coastMs = 0;
  if (neural) {
    engineCoastKey = coastKey; coastBackend = undefined; coastReason = undefined;
  } else if (engineCoastKey !== coastKey) {
    sampler?.dispose(); sampler = undefined; samplerMode = undefined;
    coastBackend = undefined; coastReason = undefined;
    const coastStarted = performance.now();
    if (gpuCoast && readyGpu) {
      let coastSampler: GpuTerrainSampler | undefined;
      try {
        const compiled = await pipelineReady;
        if (!compiled || readyGpu.context.lost) throw new Error('WebGPU indisponible');
        engine.configure_coast(coastMask, islandMode);
        coastSampler = new GpuTerrainSampler(readyGpu.context, compiled.pipeline, mode, engine);
        const source = coastSampler.prepareCoastField(settings);
        const height = await erodeGpuCoast(readyGpu.context, settings, source, engine.coast_erosion_parameters());
        engine.set_coast_surface(height);
        coastBackend = 'gpu-f32';
      } catch (error) {
        coastReason = `Littoral GPU indisponible : ${error instanceof Error ? error.message : String(error)}`;
      } finally { coastSampler?.dispose(); }
    }
    if (!coastBackend) {
      engine.set_coast(coastMask, islandMode);
      if (coastMask) coastBackend = 'cpu';
      if (gpuCoast && !readyGpu) coastReason = 'WebGPU indisponible';
    }
    engineCoastKey = coastKey;
    coastMs = coastMask ? performance.now() - coastStarted : 0;
    prepareMs += coastMs;
  }
  async function finish(data: TerrainData): Promise<TerrainData> {
    const config = settings.hydrology;
    data.neural = neuralInfo;
    const inputKey = config ? JSON.stringify([engineKey, engineCoastKey, config.resolution, config.compute]) : '';
    // A refused neural relief is retried only when the relief or the hydrology settings change.
    const failureKey = `${inputKey}|${JSON.stringify(config)}`;
    if (neural && hydrologyFailure?.key === failureKey) data.hydrologyError = hydrologyFailure.message;
    else if (config?.enabled && settings.relief !== 'cavern') try {
      if (!preparedHydrology || hydrologyKey !== inputKey) {
        preparedHydrology?.dispose(); preparedHydrology = undefined; hydrology = undefined;
        hydrologyVectorKey = '';
        const n = config.resolution;
        let height: Float32Array;
        if (data.x === 0 && data.y === 0 && data.width === settings.width && data.resolution === n) {
          height = data.height.slice();
        } else if (sampler && !sampler.lost) {
          height = (await sampler.sample({ x: 0, y: 0, extent: settings.width, resolution: n }, settings, engine!.min_height, engine!.max_height)).height;
        } else {
          const source = engine!.sample_region(0, 0, settings.width, n);
          try { height = source.height; } finally { source.free(); }
        }
        preparedHydrology = await PreparedHydrology.create(settings.seed, settings.width, n, height, config.compute, neural ? engine!.min_height < 0 : coastMask !== 0);
        hydrologyKey = inputKey;
      }
      const vectorKey = JSON.stringify(config);
      if (!hydrology || hydrologyVectorKey !== vectorKey) {
        hydrology = preparedHydrology.generate(config); hydrologyVectorKey = vectorKey;
      }
      const surfaceStarted = performance.now();
      applyHydrologySurface(data, hydrology);
      data.hydrologySurfaceMs = performance.now() - surfaceStarted;
      // Intermediate grids stay in the worker cache. Only overview replies clone
      // them for inspection; camera requests carry just their terrain region.
      if (kind === 'overview') data.hydrology = hydrology;
    } catch (error) {
      // Neural surfaces can exceed the current river-profile budgets: keep the relief.
      if (!neural) throw error;
      preparedHydrology?.dispose(); preparedHydrology = undefined; hydrology = undefined; hydrologyKey = '';
      hydrologyFailure = { key: failureKey, message: error instanceof Error ? error.message : String(error) };
      data.hydrologyError = hydrologyFailure.message;
    }
    data.generationMs = performance.now() - started;
    return data;
  }
  let backendReason: string | undefined;
  let gpuSetupMs = 0;
  let gpuSampled: TerrainData | undefined;
  if (mode !== 'wasm' && supported) {
    const setupStarted = performance.now();
    try {
      const compiled = await pipelineReady;
      if (readyGpu && compiled && !readyGpu.context.lost) {
        if (!sampler || samplerMode !== mode || sampler.lost) {
          sampler?.dispose(); sampler = undefined;
          sampler = new GpuTerrainSampler(readyGpu.context, compiled.pipeline, mode, engine);
          samplerMode = mode;
        }
        gpuSetupMs = performance.now() - setupStarted;
        const data = await sampler.sample(region, settings, engine.min_height, engine.max_height);
        gpuSampled = { ...data, generationMs: performance.now() - started, prepareMs, gpuSetupMs, generationBackend, generationReason, noiseMs, erosionMs, gpuSimulationMs, nativeEnvironmentMs, erosionProfile, coastBackend, coastMs, coastReason };
      }
      if (!gpuSampled) backendReason = 'WebGPU indisponible';
    } catch (error) {
      backendReason = `GPU indisponible : ${error instanceof Error ? error.message : String(error)}`;
      sampler?.dispose(); sampler = undefined; samplerMode = undefined;
    }
  } else if (mode !== 'wasm') backendReason = 'relief actuellement échantillonné en WASM';
  if (gpuSampled) return finish(gpuSampled);
  const samplingStarted = performance.now();
  const result = engine.sample_region(region.x, region.y, region.extent, region.resolution);
  try {
    return await finish({
      x: result.x, y: result.y, width: result.width, resolution: result.resolution,
      minHeight: result.min_height, maxHeight: result.max_height,
      globalMinHeight: engine.min_height, globalMaxHeight: engine.max_height, motifSize: settings.motifSize,
      height: result.height, caveMask: result.cave_mask,
      normalX: result.normal_x, normalY: result.normal_y, normalZ: result.normal_z,
      generationMs: performance.now() - started,
      backend: 'wasm', backendReason, prepareMs, samplingMs: performance.now() - samplingStarted, gpuSetupMs,
      generationBackend, generationReason, noiseMs, erosionMs, gpuSimulationMs, nativeEnvironmentMs, erosionProfile,
      coastBackend, coastMs, coastReason,
    });
  } finally { result.free(); }
}
