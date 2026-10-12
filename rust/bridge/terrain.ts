import init, { TerrainEngine, flood_hydrology } from '../pkg/wasm/magna_urbis_wasm.js';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import { GpuTerrainSampler, prepareGpu, generateGpuNoise, GPU_RELIEFS, GPU_GENERATION_RELIEFS } from './terrainGpu';
import { generateGpuTerrain, erodeGpuCoast, type ErosionProfile } from './terrainErosion';
import { PreparedHydrology, applyHydrologySurface, riverAreaFor, type HydrologyData, type HydrologySettings } from './hydrology';
import type { TerrainScene, TerrainStyle } from './terrainRender';
import { refineSketch, parseTerrainSketch, neuralSketchInput, type TerrainSketch } from './terrainSketch';
import { applyDelta, applyFractalDetail, fitNeuralSurface, type FractalDetail, neuralWindow, seedHash, upsampleDelta } from './terrainAdjust';
import { conditionRelief, type ConditioningResult } from '../../web/src/ui/reliefConditioning';
import { computeVectorWater, type VectorWater } from '../../web/src/ui/vectorWater';
import { setFloodKernel } from '../../web/src/ui/simpleHydrology';

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
/** The neural chain delivers one 40 × 40 km surface, cropped or scaled to the map. */
export const NEURAL_EXTENT = 40000;
export const DEFAULT_NEURAL_SERVER = 'http://127.0.0.1:8792';
/** Sketch climate (`crates/neural/src/sketch.rs`): T °C at sea level, σT °C × 100, rain mm, rain CV %. */
export interface ClimateValues { temperature: number; temperatureStd: number; precipitation: number; precipitationCv: number }
export const CLIMATE_VALUES: Record<NeuralClimate, ClimateValues> = {
  temperate: { temperature: 18, temperatureStd: 600, precipitation: 1000, precipitationCv: 35 },
  oceanic: { temperature: 11, temperatureStd: 450, precipitation: 1300, precipitationCv: 25 },
  mediterranean: { temperature: 16, temperatureStd: 550, precipitation: 600, precipitationCv: 60 },
  arid: { temperature: 23, temperatureStd: 800, precipitation: 150, precipitationCv: 85 },
  cold: { temperature: 1, temperatureStd: 1100, precipitation: 550, precipitationCv: 35 },
  tropical: { temperature: 26, temperatureStd: 150, precipitation: 2300, precipitationCv: 50 },
};
/** Network properties of the neural chain (former neural bench). */
export interface NeuralTuning {
  landScale: number; steps: number;
  noiseTemperature: number; noiseTemperatureStd: number; noisePrecipitation: number; noisePrecipitationCv: number;
  /** Local relief passed from coarse to base: per family (auto), the network's × scale, or imposed metres. */
  reliefMode: 'auto' | 'scale' | 'fixed'; reliefScale: number; reliefFixed: number;
  histogram: number[]; detail: number;
}
export const DEFAULT_NEURAL_TUNING: NeuralTuning = {
  landScale: 1, steps: 4, noiseTemperature: 0.5, noiseTemperatureStd: 0.5, noisePrecipitation: 0.5, noisePrecipitationCv: 0.5,
  reliefMode: 'auto', reliefScale: 1, reliefFixed: 50, histogram: [0, 0, 0, 0, 0], detail: 1,
};
/**
 * The coarse network draws the local relief freely, so a plain may come out
 * as uplands and a plateau as a massif. Imposed local relief per family (m),
 * measured on seeds 42, 7 and 1234: plains 20 m (slopes ≈ 1.5°), hills 110 m
 * (≈ 11°), plateaus 100 m (flat tables and escarpments).
 */
export const NEURAL_RELIEF_DEFAULTS: Partial<Record<TerrainRelief, number>> = { flat: 20, hills: 110, plateau: 100 };
export interface TerrainSettings {
  seed: string; width: number; motifSize: number; relief: TerrainRelief; environment?: TerrainEnvironment; coastMask?: number; islandMode?: IslandMode; erosion: number; mountainMix: number; resolution: number;
  compute?: TerrainCompute; generationCompute?: 'cpu' | 'gpu' | 'gpu-all' | 'gpu-erosion'; hydrology?: HydrologySettings; source?: TerrainSource; climate?: NeuralClimate; fidelity?: number; neuralServer?: string; sketch?: TerrainSketch;
  /** Climate values (preset or custom): neural sketch and water budget. */
  climateValues?: ClimateValues;
  neuralTuning?: NeuralTuning;
  /** Neural surface on the map: a window of its size (crop) or the whole 40 km stretched (scale, heights too with `neuralSlopes`). */
  neuralFit?: 'crop' | 'scale'; neuralSlopes?: boolean;
  /** Fractal refinement below the source raster's cell when zooming in. */
  refine?: boolean;
  /** Shape of that refinement (defaults: `DEFAULT_FRACTAL_DETAIL`). */
  detailNoise?: FractalDetail;
}
export const climateOf = (settings: TerrainSettings): ClimateValues => settings.climateValues ?? CLIMATE_VALUES[settings.climate ?? 'temperate'];
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
  /** Vector water chain (overview replies). */
  water?: VectorWater;
  /** Pre-hydrology conditioning: height change on its grid and statistics (overview replies). */
  conditioning?: { delta: Float32Array; n: number; stats: Omit<ConditioningResult, 'height' | 'delta' | 'hydrology'> };
  /** GPU display (overview replies): B-spline control grid of the whole map. */
  field?: DisplayField;
  /** Land heights (p5, median, p95, metres), mean land slope (radians) and land share (overview replies). */
  relief?: { p5: number; p50: number; p95: number; slope: number; land: number };
}
/** Relief statistics of a sampled grid, off the page's thread. */
export function reliefStatistics(data: Pick<TerrainData, 'height' | 'normalZ'>): NonNullable<TerrainData['relief']> {
  const all = new Float32Array(data.height.length);
  let slope = 0, count = 0;
  for (let i = 0; i < data.height.length; i++) if (data.height[i] > 0) { all[count++] = data.height[i]; slope += Math.acos(Math.min(1, data.normalZ[i])); }
  const land = all.subarray(0, count).sort(), at = (p: number): number => count ? land[Math.min(count - 1, Math.floor(p * count))] : 0;
  return { p5: at(0.05), p50: at(0.5), p95: at(0.95), slope: slope / Math.max(1, count), land: count / Math.max(1, data.height.length) };
}
/**
 * Control points whose cubic B-spline is the displayed relief over the whole map.
 * `exact`: the engine's own physical raster (plus conditioning), identical at
 * every zoom; otherwise sampled heights, refined by camera regions.
 */
export interface DisplayField { n: number; data: Float32Array; exact: boolean; floor: number; cave?: Uint8Array }
export interface TerrainRequest {
  id: number; generation: number; kind: 'overview' | 'detail'; settings: TerrainSettings; region: TerrainRegion; scene?: { style: TerrainStyle; showContours: boolean };
  /** `gl`: the page refines and shades on the GPU; replies carry raw heights and, for overviews, the display field. */
  display?: 'svg' | 'gl';
}
export type TerrainResponse = Pick<TerrainRequest, 'id' | 'generation' | 'kind'> & ({ terrain: TerrainData; scene?: TerrainScene; scenePreparationMs?: number; /** Relief only; the full reply follows. */ partial?: boolean } | { error: string });

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
let conditioned: { key: string; n: number; height: Float32Array; delta?: Float32Array; m: number; stats?: Omit<ConditioningResult, 'height' | 'delta' | 'hydrology'>; drainage?: ConditioningResult['hydrology'] } | undefined;
let vectorWater: { key: string; water: VectorWater } | undefined;

/** Heights of the local Rust neural service: `1024²` FP32 metres over 40 km, sea at zero. */
async function fetchNeuralRelief(settings: TerrainSettings, coastMask: number, islandMode: IslandMode): Promise<{ heights: Float32Array; info: NeuralInfo }> {
  const server = (settings.neuralServer || DEFAULT_NEURAL_SERVER).replace(/\/$/, '');
  const params = new URLSearchParams({
    seed: settings.seed, relief: settings.relief, mix: String(settings.relief === 'mixed' ? settings.mountainMix : 0.5),
    coasts: String(coastMask), islands: islandMode, climate: settings.climate ?? 'temperate', noise: String(settings.fidelity ?? 0.05),
  });
  const climate = climateOf(settings), tuning = settings.neuralTuning ?? DEFAULT_NEURAL_TUNING;
  for (const [key, value] of Object.entries(climate)) params.set(key, String(value));
  params.set('landScale', String(tuning.landScale)); params.set('steps', String(tuning.steps)); params.set('detail', String(tuning.detail));
  for (const key of ['noiseTemperature', 'noiseTemperatureStd', 'noisePrecipitation', 'noisePrecipitationCv'] as const) params.set(key, String(tuning[key]));
  params.set('histogram', tuning.histogram.join(','));
  const familyRelief = NEURAL_RELIEF_DEFAULTS[settings.relief];
  if (tuning.reliefMode === 'fixed') params.set('reliefFixed', String(tuning.reliefFixed));
  else if (tuning.reliefMode === 'auto' && familyRelief !== undefined) params.set('reliefFixed', String(familyRelief));
  else params.set('reliefScale', String(tuning.reliefMode === 'scale' ? tuning.reliefScale : 1));
  const sketch = settings.sketch ? neuralSketchInput(parseTerrainSketch(settings.sketch),
    neuralWindow(NEURAL_EXTENT, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, coastMask)) : undefined;
  const started = performance.now();
  let response: Response;
  try { response = await fetch(`${server}/generate?${params}`, { cache: 'no-store', ...(sketch ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sketch) } : {}) }); }
  catch { throw new Error(`service neuronal injoignable (${server}) : lancer « npm run neural:serve » dans web/`); }
  if (!response.ok) throw new Error(`service neuronal : ${await response.text()}`);
  const heights = new Float32Array(await response.arrayBuffer());
  const meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}');
  if (sketch && (meta.edited !== true || ((sketch.region.x !== 0 || sketch.region.y !== 0 || sketch.region.width !== NEURAL_EXTENT) && meta.sketchRegion !== true))) throw new Error('Service neuronal ancien : redémarrer « npm run neural:serve » pour appliquer l’esquisse éditée.');
  if (heights.length !== 1024 * 1024) throw new Error('service neuronal : surface incomplète');
  return { heights, info: { ...meta, requestMs: performance.now() - started } as NeuralInfo };
}

/**
 * `onRelief`: GPU overviews whose waters must be computed first receive the
 * sampled relief at once (no water, no conditioning), then the full reply.
 */
export function sampleRustTerrain(request: TerrainRequest, onRelief?: (relief: TerrainData) => void): Promise<TerrainData> {
  const result = queue.then(() => sampleTerrain(request, onRelief));
  queue = result.catch(() => undefined);
  return result;
}
async function sampleTerrain({ settings, region, kind, display }: TerrainRequest, onRelief?: (relief: TerrainData) => void): Promise<TerrainData> {
  const mode = settings.compute === 'wasm' ? 'wasm' : 'gpu-f32';
  const generationMode = settings.generationCompute ?? 'gpu-erosion';
  const environment = (GEOLOGICAL_RELIEFS as readonly string[]).includes(settings.relief) ? settings.environment ?? 'mixed' : 'mixed';
  const coastMask = settings.relief === 'cavern' ? 0 : settings.coastMask ?? 0;
  const islandMode = settings.islandMode ?? 'island';
  const supported = GPU_RELIEFS.includes(settings.relief);
  const gpu = mode !== 'wasm' && supported ? prepareGpu(mode, settings.relief).catch(() => undefined) : undefined;
  // Vite embeds this asset in the standalone HTML (and in the inline worker).
  ready ??= (async () => {
    await init({ module_or_path: await (await fetch(wasmUrl)).arrayBuffer() });
    // The water chain's floods run compiled from now on (same results).
    setFloodKernel(flood_hydrology);
  })();
  await ready;
  const started = performance.now();
  const readyGpu = await gpu;
  // Handle compilation failure immediately while preparation runs synchronously.
  const pipelineReady = readyGpu?.pipeline.then(pipeline => ({ pipeline }), () => undefined);
  const requestedGpuGeneration = !settings.sketch && generationMode !== 'cpu' && mode !== 'wasm' && GPU_GENERATION_RELIEFS.includes(settings.relief);
  const gpuGeneration = requestedGpuGeneration && !!readyGpu;
  // Device loss affects sampling; it must not replace an already prepared landscape.
  const neural = settings.source === 'neural';
  const key = neural
    ? JSON.stringify(['neural', settings.seed, settings.relief, settings.relief === 'mixed' ? settings.mountainMix : 0.5, coastMask, coastMask === 255 ? islandMode : 'island', climateOf(settings), settings.fidelity ?? 0.05, settings.neuralServer ?? '', settings.sketch, settings.neuralTuning ?? DEFAULT_NEURAL_TUNING, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true])
    : JSON.stringify([settings.seed, settings.width, settings.relief, settings.relief === 'cavern' ? 0 : settings.erosion, settings.motifSize, settings.relief === 'mixed' ? settings.mountainMix : 0.5, requestedGpuGeneration ? generationMode : 'cpu', environment, settings.sketch]);
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
      const surface = fitNeuralSurface(result.heights, NEURAL_EXTENT, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, coastMask);
      engine = TerrainEngine.with_surface(settings.seed, settings.width, surface);
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
    if (!neural && settings.sketch && settings.relief !== 'cavern') {
      const sketch = parseTerrainSketch(settings.sketch);
      const sample = engine.sample_region(0, 0, settings.width, 1024);
      try { engine.set_edited_surface(refineSketch(sketch, sample.height, 1024)); }
      finally { sample.free(); }
      generationReason = 'Esquisse éditée + détail procédural et érosion Rust.';
    }
    prepareMs = performance.now() - prepareStarted;
    engineKey = key;
  }
  // Reuse the underlying relief, then cut the coast before its physical erosion.
  const gpuCoast = !settings.sketch && coastMask !== 0 && generationMode !== 'cpu' && mode !== 'wasm';
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
    const water = !!config?.enabled && settings.relief !== 'cavern', vector = config?.engine !== 'rust';
    if (onRelief && config && water && kind === 'overview' && display === 'gl') {
      const n = vector ? config.vectorResolution : config.resolution;
      const condKey = JSON.stringify([engineKey, engineCoastKey, n, config.condMode, config.condMode === 'none' ? 0 : [config.condStrength, config.condDepth, config.condLength]]);
      // Seconds of water work ahead: show the relief now.
      if (!conditioned || conditioned.key !== condKey || (vector && !vectorWater)) {
        onRelief({
          ...data, height: data.height.slice(), normalX: data.normalX.slice(), normalY: data.normalY.slice(), normalZ: data.normalZ.slice(),
          caveMask: data.caveMask.slice(), neural: neuralInfo, field: displayField(data, false, vector), relief: reliefStatistics(data), generationMs: performance.now() - started,
        });
      }
    }
    if (config && water) {
      const n = vector ? config.vectorResolution : config.resolution;
      // The whole map on the hydrology grid, conditioned before any drainage.
      const condKey = JSON.stringify([engineKey, engineCoastKey, n, config.condMode, config.condMode === 'none' ? 0 : [config.condStrength, config.condDepth, config.condLength]]);
      if (!conditioned || conditioned.key !== condKey) {
        conditioned = undefined; vectorWater = undefined;
        preparedHydrology?.dispose(); preparedHydrology = undefined; hydrology = undefined; hydrologyKey = ''; hydrologyVectorKey = '';
        let height: Float32Array;
        if (data.x === 0 && data.y === 0 && data.width === settings.width && data.resolution === n) {
          height = data.height.slice();
        } else if (sampler && !sampler.lost) {
          height = (await sampler.sample({ x: 0, y: 0, extent: settings.width, resolution: n }, settings, engine!.min_height, engine!.max_height)).height;
        } else {
          const source = engine!.sample_region(0, 0, settings.width, n);
          try { height = source.height; } finally { source.free(); }
        }
        if (config.condMode === 'none') conditioned = { key: condKey, n, height, m: 0 };
        else {
          // Erosion runs on at most 512², breaching on the whole grid; the change is spline-interpolated to the camera.
          const result = conditionRelief(height, n, settings.width,
            { mode: config.condMode, strength: config.condStrength, maxDepth: config.condDepth, maxLength: config.condLength });
          const { height: out, delta, hydrology: drainage, ...stats } = result;
          conditioned = { key: condKey, n, height: out, delta, m: n, stats, drainage };
        }
      }
      if (vector) {
        const climate = climateOf(settings);
        const vs = {
          riverArea: riverAreaFor(config, settings.width), lakeDepth: config.lakeDepth, lakeArea: config.lakeArea, riverMode: config.riverMode,
          flatSlope: config.flatSlope, sinuosity: config.sinuosity, widthScale: config.vectorWidth, balance: config.balance, braiding: config.braiding,
          anabranching: config.anabranching, terrainInfluence: config.terrainInfluence, avulsions: config.avulsions, confluence: config.confluence, deltas: config.deltas,
        };
        const waterKey = JSON.stringify([condKey, vs, climate.temperature, climate.precipitation]);
        if (!vectorWater || vectorWater.key !== waterKey) {
          vectorWater = { key: waterKey, water: computeVectorWater(conditioned.height, n, settings.width, vs, climate, settings.seed, conditioned.drainage) };
        }
      } else {
        const inputKey = JSON.stringify([condKey, config.compute]);
        // A refused neural relief is retried only when the relief or the hydrology settings change.
        const failureKey = `${inputKey}|${JSON.stringify(config)}`;
        if (neural && hydrologyFailure?.key === failureKey) data.hydrologyError = hydrologyFailure.message;
        else try {
          if (!preparedHydrology || hydrologyKey !== inputKey) {
            preparedHydrology?.dispose(); preparedHydrology = undefined; hydrology = undefined; hydrologyVectorKey = '';
            preparedHydrology = await PreparedHydrology.create(settings.seed, settings.width, n, conditioned.height.slice(), config.compute,
              settings.sketch ? engine!.min_height <= 0 : neural ? engine!.min_height < 0 : coastMask !== 0);
            hydrologyKey = inputKey;
          }
          const vectorKey = JSON.stringify(config);
          if (!hydrology || hydrologyVectorKey !== vectorKey) {
            hydrology = preparedHydrology.generate(config); hydrologyVectorKey = vectorKey;
          }
        } catch (error) {
          // Neural surfaces can exceed the current river-profile budgets: keep the relief.
          if (!neural) throw error;
          preparedHydrology?.dispose(); preparedHydrology = undefined; hydrology = undefined; hydrologyKey = '';
          hydrologyFailure = { key: failureKey, message: error instanceof Error ? error.message : String(error) };
          data.hydrologyError = hydrologyFailure.message;
        }
      }
    }
    // The displayed terrain: conditioning, Rust riverbeds, then fractal refinement.
    if (water && conditioned?.delta) applyDelta(data, conditioned.delta, conditioned.m, settings.width);
    if (water && !vector && hydrology && !data.hydrologyError) {
      const surfaceStarted = performance.now();
      applyHydrologySurface(data, hydrology);
      data.hydrologySurfaceMs = performance.now() - surfaceStarted;
    }
    if (settings.refine && display !== 'gl') applyFractalDetail(data, settings.width / 1024, seedHash(settings.seed), settings.detailNoise);
    if (kind === 'overview' && display === 'gl') data.field = displayField(data, water, vector);
    // Intermediate grids stay in the worker cache. Only overview replies clone
    // them for inspection; camera requests carry just their terrain region.
    if (kind === 'overview' && water) {
      if (vector) data.water = vectorWater?.water;
      else if (hydrology && !data.hydrologyError) data.hydrology = hydrology;
      if (conditioned?.delta && conditioned.stats) data.conditioning = { delta: conditioned.delta, n: conditioned.m, stats: conditioned.stats };
    }
    if (kind === 'overview') data.relief = reliefStatistics(data);
    data.generationMs = performance.now() - started;
    return data;
  }
  /**
   * Regional reliefs and prepared surfaces (neural, coasts, sketches) sample
   * the B-spline of the engine's 1024² raster: the GPU draws that raster
   * exactly. Other families (plains, valleys, finite shapes, caverns) and Rust
   * riverbeds send sampled heights and rely on camera regions.
   */
  function displayField(data: TerrainData, water: boolean, vector: boolean): DisplayField {
    const family = engine!.sampling_parameters()[5];
    if ((family === 1 || family === 4) && settings.relief !== 'cavern' && (!water || vector)) {
      const n = 1024, field = engine!.sampling_field().slice(0, n * n);
      if (water && conditioned?.delta) {
        const delta = upsampleDelta(conditioned.delta, conditioned.m, n);
        // Sea stays sea: the conditioning only reshapes land.
        for (let i = 0; i < n * n; i++) field[i] += field[i] <= 0 ? Math.min(0, delta[i]) : delta[i];
      }
      return { n, data: field, exact: true, floor: family === 1 ? 0.3 : 0 };
    }
    return { n: data.resolution, data: data.height.slice(), exact: false, floor: 0, cave: data.caveMask.length ? data.caveMask.slice() : undefined };
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
