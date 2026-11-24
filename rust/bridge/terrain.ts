import { validateProceduralRecipe, erosionBiome, posteriorSettings, windSettings, stageEnabled, PROCEDURAL_RECIPE_VERSION, isCompactProcedural, type ProceduralRecipe, type GenerationControl } from './terrainGenerationRecipe';
import { generateCpuTerrain, releaseCpuCheckpoints } from './terrainCpuPipeline';
import { coastProfile } from './terrainCoastProfile';
import { configureEngineCoast, setEngineCoast } from './terrainCoastWasm';
import { seedRoot, seedSubset, stepSeed } from './generationSeed';
import { coreOperations, proceduralSignatures, TerrainFieldCheckpoints } from './terrainCheckpoints';
import { fingerprintBytes, fingerprintNumbers } from '../../web/src/v2/terrainFingerprint';
import { applyTerrainModification, type TerrainModification } from './terrainModification';
import { erodeWindGpu, erodeWindCpu } from './terrainWind';
import { CLIMATE_VALUES, type ClimateValues, type ClimateZone } from './terrainClimate';
export { CLIMATE_VALUES, type ClimateValues } from './terrainClimate';
import type { TerrainLayers, TerrainLighting } from '../../web/src/render/terrainLighting';
import init from '../pkg/wasm/magna_urbis_wasm.js';
import { TerrainEngine, erosion_defaults, set_erosion_tuning, adoptSingleWasm, loadCoreWasm, onCoreWasmReset, recoverCoreWasm, wantsWasmThreads } from './wasmRuntime';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import { GpuTerrainSampler, prepareGpu, generateGpuNoise, gpuContext, GPU_RELIEFS, GPU_GENERATION_RELIEFS } from './terrainGpu';
import { generateGpuTerrain, erodeGpuCoast, planGpuErosion, releaseGpuTerrainCheckpoints, type ErosionProfile } from './terrainErosion';
import { applyPhasorCpu, COMPACT_RELIEFS, compactBudget, compactProfile, COMPACT_VERSION, type PhasorSettings } from './terrainPhasor';
import { PreparedHydrology, applyHydrologySurface, lakesOff, riverAreaFor, type HydrologyData, type HydrologySettings } from './hydrology';
import { applyHydrologyHeight } from './hydrologySurface';
import type { TerrainScene, TerrainStyle } from './terrainRender';
import { refineSketch, parseTerrainSketch, neuralSketchInput, heightmapSurface, type TerrainSketch } from './terrainSketch';
import { parseTerrainZones, type TerrainZones } from './terrainZones';
import { applyDelta, applyFractalDetail, fitNeuralSurface, type FractalDetail, neuralWindow, seedHash, upsampleDelta } from './terrainAdjust';
import type { ConditioningResult } from '../../web/src/ui/reliefConditioning';
import type { VectorWater } from '../../web/src/ui/vectorWater';
import { conditionRelief, computeVectorWater, conditionAndWater } from './waterNative';
import { browserNeural, neuralModule, releaseNeuralBrowser } from './neuralBrowser';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { prepareNativeTerrain, sampleNativeTerrain } from './nativeTerrain';
import { NativeReliefEngine, type UnderdarkCarve } from './nativeRelief';
import { nativeFetch } from './nativeAvailability';
import { loadTerrainRuntime, gpuSetupDeadline, type TerrainProgressCallback } from './terrainProgress';
import { hydrologyGrid, MAX_GPU_SOURCE_RESOLUTION, preferCpuGeneration, sourceDefinition, unsupportedExplicitGpuResolution, type SourceDefinition } from './terrainDefinition';

export const RELIEFS = ['flat', 'hills', 'valley', 'canyon', 'mountains', 'mixed', 'plateau', 'high-mountains', 'volcano', 'caldera', 'cavern'] as const;
export type TerrainRelief = (typeof RELIEFS)[number];
export const GEOLOGICAL_RELIEFS = ['plateau', 'volcano', 'caldera'] as const;
export const ENVIRONMENT_RELIEFS = ['flat', 'hills', 'mixed', 'mountains', 'high-mountains'] as const;
export type TerrainEnvironment = (typeof ENVIRONMENT_RELIEFS)[number];
export const COMPUTE_MODES = ['wasm', 'gpu-f32'] as const;
export type TerrainCompute = (typeof COMPUTE_MODES)[number];
export const COAST_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** `random` is kept for saved recipes; `peninsula` ties one body to a single map edge. */
export const ISLAND_MODES = ['island', 'archipelago', 'random', 'peninsula'] as const;
export type IslandMode = (typeof ISLAND_MODES)[number] | `traced:${string}`;
export const TERRAIN_SOURCES = ['procedural', 'procedural-phasor', 'neural-wasm', 'neural-python', 'neural'] as const;
export type TerrainSource = (typeof TERRAIN_SOURCES)[number];
export const isNeuralSource = (source?: TerrainSource): boolean => source === 'neural-wasm' || source === 'neural-python' || source === 'neural';
/** Relief families sketched for the neural coarse network (7.68 km cells). */
export const NEURAL_RELIEFS = ['flat', 'hills', 'valley', 'mountains', 'mixed', 'plateau', 'high-mountains'] as const;
export const NEURAL_CLIMATES = ['temperate', 'oceanic', 'mediterranean', 'arid', 'cold', 'tropical'] as const;
export type NeuralClimate = (typeof NEURAL_CLIMATES)[number];
/** Reference extent of the fixed Tile40 profile; conventional profiles generate the requested extent. */
export const NEURAL_EXTENT = 40000;
export const DEFAULT_NEURAL_SERVER = 'http://127.0.0.1:8792';
export const DEFAULT_PYTHON_SERVER = 'http://127.0.0.1:8793';
/** Old shared links can retain the native service port after selecting Python. */
export function neuralServerForSource(source?: TerrainSource, override?: string | null): string {
  const fallback = source === 'neural-python' ? DEFAULT_PYTHON_SERVER : DEFAULT_NEURAL_SERVER;
  const server = override?.trim().replace(/\/+$/, '');
  if (!server) return fallback;
  try {
    const url = new URL(server);
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && ['8792', '8793'].includes(url.port) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password) return fallback;
  } catch {
    /* Fetch reports an invalid custom address. */
  }
  return server;
}
/** Sketch climate (`crates/neural/src/sketch.rs`): T °C at sea level, σT °C × 100, rain mm, rain CV %. */
/** Network properties of the neural chain (former neural bench). */
export interface NeuralTuning {
  landScale: number;
  steps: number;
  noiseTemperature: number;
  noiseTemperatureStd: number;
  noisePrecipitation: number;
  noisePrecipitationCv: number;
  /** Local relief passed from coarse to base: per family (auto), the network's × scale, or imposed metres. */
  reliefMode: 'auto' | 'scale' | 'fixed';
  reliefScale: number;
  reliefFixed: number;
  histogram: number[];
  detail: number;
}
export const DEFAULT_NEURAL_TUNING: NeuralTuning = { landScale: 1, steps: 4, noiseTemperature: 0.5, noiseTemperatureStd: 0.5, noisePrecipitation: 0.5, noisePrecipitationCv: 0.5, reliefMode: 'auto', reliefScale: 1, reliefFixed: 50, histogram: [0, 0, 0, 0, 0], detail: 1 };
/**
 * The coarse network draws the local relief freely, so a plain may come out
 * as uplands and a plateau as a massif. Imposed local relief per family (m),
 * measured on seeds 42, 7 and 1234: plains 20 m (slopes ≈ 1.5°), hills 110 m
 * (≈ 11°), plateaus 100 m (flat tables and escarpments).
 */
export const NEURAL_RELIEF_DEFAULTS: Partial<Record<TerrainRelief, number>> = { flat: 20, hills: 110, plateau: 100 };
/** Procedural erosion settings, in `EROSION_TUNING` order (`crates/terrain/src/erosion.rs`). */
export const EROSION_SETTINGS = ['iterations', 'incision', 'incisionSlope', 'fill', 'carve', 'finalCarve', 'talus', 'thermal', 'diffusion', 'detail', 'warp', 'surfaceIterations', 'surfaceIncision', 'surfaceCarve', 'surfaceRouted', 'surfaceThermal', 'surfaceDiffusion'] as const;
export type ErosionSetting = (typeof EROSION_SETTINGS)[number];
/** Overrides of the procedural erosion; a missing setting keeps the relief default. */
export type ErosionTuning = Partial<Record<ErosionSetting, number>>;
export interface TerrainSettings {
  coastProfile?: Partial<import('./terrainCoastProfile').CoastProfile>;
  /** Underdark: the finished relief is carved into caves and tunnels (`carve_underdark`) before the water. */
  underdark?: boolean;
  /** Underdark natural and side tunnels amount: 0 none, 1 a few (default), up to 3. */
  underdarkTunnels?: number;
  /** Share of an Underdark map its caverns open (default 0.2). */
  underdarkCaverns?: number;
  /** Encoded independent variations; the ordinary seed remains the initial noise draw. */
  generalSeed?: string;
  /** Coarse original drawing, refined by the procedural generator. */
  drawing?: TerrainSketch;
  /** Separate non-destructive sculpt offsets applied after terrain generation. */
  modification?: TerrainModification;
  zones?: TerrainZones;
  seed: string;
  width: number;
  motifSize: number;
  relief: TerrainRelief;
  environment?: TerrainEnvironment;
  coastMask?: number;
  islandMode?: IslandMode;
  erosion: number;
  mountainMix: number;
  resolution: number;
  /** Requested physical source spacing in metres, independent of overview pixels. */
  sampleSpacing?: number;
  /** Derived native grid dimension for an imported image; never a user resolution knob. */
  sourceNativeResolution?: number;
  compute?: TerrainCompute;
  generationCompute?: 'cpu' | 'gpu' | 'gpu-all' | 'gpu-erosion' | 'native';
  hydrology?: HydrologySettings;
  source?: TerrainSource;
  climate?: NeuralClimate;
  /** V2 climate zone: shapes erosion, cover and rendering; `climate`/`climateValues` carry its legacy name and values. */
  climateZone?: ClimateZone;
  fidelity?: number;
  neuralServer?: string;
  sketch?: TerrainSketch;
  /** Absolute runtime URL supplied by the page; inline worker URLs are blob URLs. */
  neuralAssets?: string;
  /** Climate values (preset or custom): neural sketch and water budget. */
  climateValues?: ClimateValues;
  neuralTuning?: NeuralTuning;
  /** Selectable Python checkpoints; browser inference retains its pinned profile. */
  coarseModel?: string;
  baseModel?: string;
  decoderModel?: string;
  /** Retained recipe fields; physical generation never stretches a source. */
  neuralFit?: 'crop' | 'scale';
  neuralSlopes?: boolean;
  /** Fractal refinement below the source raster's cell when zooming in. */
  refine?: boolean;
  /** Shape of that refinement (defaults: `DEFAULT_FRACTAL_DETAIL`). */
  detailNoise?: FractalDetail;
  erosionTuning?: ErosionTuning;
  /** Independent compact noise / erosion / Phasor source; legacy sources ignore this block. */
  phasor?: PhasorSettings;
  /** Bench recipe; absent preserves the historical generators. */
  procedural?: ProceduralRecipe;
}
export const climateOf = (settings: TerrainSettings): ClimateValues => settings.climateValues ?? CLIMATE_VALUES[settings.climate ?? 'temperate'];
export interface NeuralInfo {
  totalMs: number;
  coarseMs: number;
  baseMs: number;
  decoderMs: number;
  reconstructionMs: number;
  requestMs: number;
  evaluations: [number, number, number];
  profile: string;
  land: number;
  backend?: string;
  precision?: string;
  modelIdentity?: string;
  neuralToken?: string;
  neuralSeed?: string;
  extent?: number;
  resolution?: number;
  nativeCellM?: number;
  nativeResolution?: number;
  outputCellM?: number;
}
export interface TerrainRegion {
  x: number;
  y: number;
  extent: number;
  resolution: number;
}
export interface TerrainData {
  /** Display-only source material coordinates, independent of generation. */
  waterSurface?: import('../../web/src/render/terrainWater').WaterSurface;
  x: number;
  y: number;
  width: number;
  resolution: number;
  minHeight: number;
  maxHeight: number;
  globalMinHeight: number;
  globalMaxHeight: number;
  motifSize: number;
  height: Float32Array;
  caveMask: Uint8Array;
  normalX: Float32Array;
  normalY: Float32Array;
  normalZ: Float32Array;
  generationMs: number;
  backend?: TerrainCompute | 'native';
  backendReason?: string;
  prepareMs?: number;
  samplingMs?: number;
  gpuSetupMs?: number;
  generationBackend?: 'cpu' | 'native' | 'gpu-noise-f32' | 'gpu-noise-all-f32' | 'gpu-erosion-f32' | 'compact-gpu-f32' | 'compact-cpu' | 'neural';
  generationReason?: string;
  noiseMs?: number;
  erosionMs?: number;
  gpuSimulationMs?: number;
  nativeEnvironmentMs?: number;
  erosionProfile?: ErosionProfile[];
  coastBackend?: 'cpu' | 'gpu-f32' | 'native';
  coastMs?: number;
  coastReason?: string;
  hydrology?: HydrologyData;
  hydrologySurfaceMs?: number;
  hydrologyError?: string;
  /** Procedural overviews: the relief's own erosion settings, in `EROSION_SETTINGS` order. */
  erosionDefaults?: number[];
  neural?: NeuralInfo;
  /** Vector water chain (overview replies). */
  water?: VectorWater;
  /** Pre-hydrology conditioning: height change on its grid and statistics (overview replies). */
  conditioning?: { delta: Float32Array; n: number; stats: Omit<ConditioningResult, 'height' | 'delta' | 'hydrology'> & { census?: boolean } };
  /** GPU display (overview replies): B-spline control grid of the whole map. */
  field?: DisplayField;
  /** Authoritative post-water cell-centred metre heights for city and export consumers. */
  physical?: { n: number; height: Float32Array };
  /** Unmodified generated surface for reopening/resetting the sculpt layer. */
  modificationBase?: { n: number; height: Float32Array };
  /** Effective physical definition, separate from the sampled overview resolution. */
  definition?: SourceDefinition;
  /** Land heights (p5, median, p95, metres), mean land slope (radians) and land share (overview replies). */
  relief?: { p5: number; p50: number; p95: number; slope: number; land: number };
}
/** Relief statistics of a sampled grid, off the page's thread. */
export function reliefStatistics(data: Pick<TerrainData, 'height' | 'normalZ'>): NonNullable<TerrainData['relief']> {
  const all = new Float32Array(data.height.length);
  let slope = 0,
    count = 0;
  for (let i = 0; i < data.height.length; i++)
    if (data.height[i] > 0) {
      all[count++] = data.height[i];
      slope += Math.acos(Math.min(1, data.normalZ[i]));
    }
  const land = all.subarray(0, count).sort(),
    at = (p: number): number => (count ? land[Math.min(count - 1, Math.floor(p * count))] : 0);
  return { p5: at(0.05), p50: at(0.5), p95: at(0.95), slope: slope / Math.max(1, count), land: count / Math.max(1, data.height.length) };
}
/**
 * Control points whose cubic B-spline is the displayed relief over the whole map.
 * `exact`: the engine's own physical raster (plus conditioning), identical at
 * every zoom; otherwise sampled heights, refined by camera regions.
 */
export interface DisplayField {
  n: number;
  data: Float32Array;
  exact: boolean;
  floor: number;
  cave?: Uint8Array;
  /** Underdark natural tunnels, flattened `[kind, halfWidth, count, x0, y0, …]` in metres (kind 1 lava tube, 2 river passage). */
  tunnels?: Float32Array;
}
export interface TerrainRequest {
  inspection?: { step: boolean; until?: import('./terrainGenerationRecipe').GenerationStage; previews: boolean };
  runtime?: ExecutionRuntime;
  id: number;
  generation: number;
  kind: 'overview' | 'detail';
  settings: TerrainSettings;
  region: TerrainRegion;
  scene?: { style: TerrainStyle; waterStyle?: TerrainStyle; showContours: boolean; lighting?: TerrainLighting; layers?: TerrainLayers };
  /** `gl`: the page refines and shades on the GPU; replies carry raw heights and, for overviews, the display field. */
  display?: 'svg' | 'gl';
  /** Retain the physical B-spline field for saved V2 worlds independently of the current renderer. */
  retainField?: boolean;
}
export type TerrainPipelineCommand = { kind: 'pipeline'; generation: number; command: 'next' | 'all' | 'cancel' };
export type TerrainResponse = Pick<TerrainRequest, 'id' | 'generation' | 'kind'> &
  ({ terrain: TerrainData; scene?: TerrainScene; scenePreparationMs?: number; /** Relief only; the full reply follows. */ partial?: boolean } | { error: string } | { progress: string } | { stage: import('./terrainGenerationRecipe').GenerationStageInfo; preview?: TerrainData });

let ready: Promise<unknown> | undefined;
let engine: TerrainEngine | undefined,
  engineKey = '';
let underdarkApplied = '';
let modificationSource: Float32Array | undefined;
let modificationApplied = '',
  modificationBase: TerrainData['modificationBase'],
  modifiedPhysical: Float32Array | undefined;
let enginePhysicalPlan: Pick<SourceDefinition, 'erosionSpacing' | 'regionalErosionSpacing'> | undefined;
let engineRetainedCoasts = false;
/**
 * Local profile (native generation or neural surface): the relief engine lives on the native
 * service instead of `engine`; coasts, sketch edits and sampling never run in WASM there.
 */
let nativeRelief: NativeReliefEngine | undefined;
/** Engine metadata read synchronously, WASM or native. */
const reliefMeta = (): Pick<NativeReliefEngine, 'min_height' | 'max_height' | 'source_resolution' | 'erosion_spacing' | 'sampling_parameters'> => nativeRelief ?? engine!;
const physicalHeightField = (): Promise<Float32Array> => (nativeRelief ? nativeRelief.physicalHeightField() : Promise.resolve(engine!.physical_height_field()));
/** Natural Underdark tunnels of the carved relief; empty from an engine built before tunnels. */
const underdarkTunnels = async (): Promise<Float32Array> => {
  if (nativeRelief) return nativeRelief.underdarkTunnels().catch(() => new Float32Array(0));
  const read = (engine as unknown as { underdark_tunnels?: () => Float32Array } | undefined)?.underdark_tunnels;
  return read ? read.call(engine) : new Float32Array(0);
};
const samplingBaseField = (): Promise<Float32Array> => (nativeRelief ? nativeRelief.samplingBaseField() : Promise.resolve(engine!.sampling_base_field()));
let engineCoastKey = '';
let coastBackend: TerrainData['coastBackend'], coastReason: string | undefined;
let sampler: GpuTerrainSampler | undefined, samplerMode: TerrainCompute | undefined;
let generationBackend: TerrainData['generationBackend'] = 'cpu',
  generationReason: string | undefined;
let queue: Promise<unknown> = Promise.resolve();
let preparedHydrology: PreparedHydrology | undefined,
  hydrologyKey = '',
  hydrologyVectorKey = '';
let hydrology: HydrologyData | undefined;
let neuralInfo: NeuralInfo | undefined;
let retainedPythonServer = '';
async function releasePythonNeural(): Promise<void> {
  if (!retainedPythonServer) return;
  const server = retainedPythonServer;
  retainedPythonServer = '';
  try {
    await fetch(`${server}/release`, { method: 'POST' });
  } catch {
    /* An exited service has already released its GPU. */
  }
}
let hydrologyFailure: { key: string; message: string } | undefined;
let conditioned: { key: string; n: number; height: Float32Array; source?: Float32Array; delta?: Float32Array; m: number; stats?: Omit<ConditioningResult, 'height' | 'delta' | 'hydrology'> & { census?: boolean }; drainage?: ConditioningResult['hydrology'] } | undefined;
let vectorWater: { key: string; water: VectorWater } | undefined;
const postCheckpoints = new TerrainFieldCheckpoints();
/** A project replacement releases session-local outputs, independently of WASM loading. */
export function releaseTerrainCheckpoints(): void {
  releaseCpuCheckpoints();
  releaseGpuTerrainCheckpoints();
  postCheckpoints.clear();
  modificationSource = undefined;
  sampler?.dispose();
  sampler = undefined;
  samplerMode = undefined;
  engine?.free();
  engine = undefined;
  nativeRelief?.free();
  nativeRelief = undefined;
  engineKey = '';
  engineCoastKey = '';
  engineRetainedCoasts = false;
  enginePhysicalPlan = undefined;
  preparedHydrology?.dispose();
  preparedHydrology = undefined;
  conditioned = undefined;
  vectorWater = undefined;
  hydrology = undefined;
  hydrologyKey = '';
  hydrologyVectorKey = '';
  hydrologyFailure = undefined;
}

/** Physical neural heights over the requested extent, sea at zero. */
async function fetchNeuralRelief(settings: TerrainSettings, progress?: (text: string) => void): Promise<{ heights: Float32Array; info: NeuralInfo }> {
  const definition = sourceDefinition(settings);
  const expectedNative = Math.ceil(settings.width / 30);
  const validSurface = (heights: Float32Array, meta: Partial<NeuralInfo>): boolean =>
    meta.extent === settings.width && meta.resolution === definition.n && meta.nativeCellM === 30 && meta.nativeResolution === expectedNative && meta.outputCellM === settings.width / definition.n && heights.length === definition.n * definition.n && heights.every(Number.isFinite);
  const server = neuralServerForSource(settings.source, settings.neuralServer);
  const params = new URLSearchParams({
    seed: settings.seed,
    relief: settings.relief,
    mix: String(settings.relief === 'mixed' ? settings.mountainMix : 0.5),
    coasts: '0',
    islands: 'island',
    climate: settings.climate ?? 'temperate',
    noise: String(settings.fidelity ?? 0.05),
    extent: String(settings.width),
    sampleSpacing: String(definition.requestedSpacing),
    resolution: String(definition.n),
  });
  const climate = climateOf(settings),
    tuning = settings.neuralTuning ?? DEFAULT_NEURAL_TUNING;
  for (const [key, value] of Object.entries(climate)) params.set(key, String(value));
  params.set('landScale', String(tuning.landScale));
  params.set('steps', String(tuning.steps));
  params.set('detail', String(tuning.detail));
  for (const key of ['coarseModel', 'baseModel', 'decoderModel'] as const) if (settings[key]) params.set(key, settings[key]!);
  for (const key of ['noiseTemperature', 'noiseTemperatureStd', 'noisePrecipitation', 'noisePrecipitationCv'] as const) params.set(key, String(tuning[key]));
  params.set('histogram', tuning.histogram.join(','));
  const familyRelief = NEURAL_RELIEF_DEFAULTS[settings.relief];
  if (tuning.reliefMode === 'fixed') params.set('reliefFixed', String(tuning.reliefFixed));
  else if (tuning.reliefMode === 'auto' && familyRelief !== undefined) params.set('reliefFixed', String(familyRelief));
  else params.set('reliefScale', String(tuning.reliefMode === 'scale' ? tuning.reliefScale : 1));
  const window = neuralWindow(settings.width, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, 0);
  const sketch = settings.zones ? { zones: parseTerrainZones(settings.zones), region: { x: window.x, y: window.y, width: window.width } } : settings.sketch ? neuralSketchInput(parseTerrainSketch(settings.sketch), window) : undefined;
  const started = performance.now();
  if (settings.source === 'neural-wasm') {
    await releasePythonNeural();
    if (!settings.neuralAssets) throw new Error('Neural browser runtime URL missing.');
    const result = await browserNeural(settings.neuralAssets, params, sketch, progress);
    if (!validSurface(result.heights, result.meta)) throw new Error('Invalid WASM neural surface or physical definition.');
    return { heights: result.heights, info: { ...result.meta, requestMs: performance.now() - started } as NeuralInfo };
  }
  await releaseNeuralBrowser();
  let body: unknown = sketch;
  if (settings.source === 'neural-python') {
    if (settings.zones) {
      const capability = (await fetch(`${server}/status`, { cache: 'no-store' }).then(response => response.json())) as { zoneConditioning?: number };
      if (capability.zoneConditioning !== 1) throw new Error('The running Python service predates zone masks. Restart start-terrainbench.bat or npm run neural:python, then regenerate.');
    }
    if (!settings.neuralAssets) throw new Error('Neural conditioning runtime URL missing.');
    const module = await neuralModule(settings.neuralAssets);
    const input = Object.fromEntries(params);
    body = { params: input, conditioning: JSON.parse(module.conditioning_json(JSON.stringify(input), sketch ? JSON.stringify(sketch) : '')), edited: !!sketch };
    progress?.('Neural Python · computing with PyTorch/CUDA');
  }
  const request = { cache: 'no-store' as const, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) };
  let response: Response;
  if (settings.source === 'neural') response = await nativeFetch({ profile: 'local', server }, `/generate?${params}`, request);
  else {
    try {
      response = await fetch(`${server}/generate?${params}`, request);
    } catch {
      throw new Error(`Neural service unreachable (${server}): run “npm run neural:python” from web/`);
    }
  }
  if (!response.ok) throw new Error(`Neural service: ${await response.text()}`);
  const heights = new Float32Array(await response.arrayBuffer());
  const meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}');
  if (settings.source === 'neural-python') retainedPythonServer = server;
  if (sketch && (meta.edited !== true || meta.sketchRegion !== true)) throw new Error('Outdated neural service: restart it to apply the edited sketch.');
  if (!validSurface(heights, meta)) throw new Error('Neural service: incomplete surface or mismatched physical definition');
  return { heights, info: { ...meta, requestMs: performance.now() - started } as NeuralInfo };
}

function loadRuntime(progress?: TerrainProgressCallback): Promise<unknown> {
  return (ready ??= (async () => {
    // Isolated worker with ?threads=auto|on: shared-memory package and rayon pool.
    if (wantsWasmThreads()) {
      progress?.('Loading the Rust/WASM engine (threads)…', { stage: 'runtime-download' });
      await loadCoreWasm();
      progress?.('Rust/WASM engine ready', { stage: 'runtime-ready' });
    } else await adoptSingleWasm(() => loadTerrainRuntime(wasmUrl, module => init({ module_or_path: module }), progress));
  })());
}
/** Start loading the Rust/WASM runtime (and its thread pool) before the first request needs it. */
export function prewarmTerrainRuntime(): void {
  loadRuntime().catch(() => {
    ready = undefined;
  });
}
/**
 * `onRelief`: GPU overviews whose waters must be computed first receive the
 * sampled relief at once (no water, no conditioning), then the full reply.
 */
// A terminated threads instance (wasmRuntime.recoverCoreWasm): its objects can
// neither be used nor freed; the next request rebuilds them on the single package.
onCoreWasmReset(() => {
  postCheckpoints.clear();
  ready = undefined;
  engine = undefined;
  nativeRelief?.free();
  nativeRelief = undefined;
  engineKey = '';
  engineCoastKey = '';
  engineRetainedCoasts = false;
  preparedHydrology = undefined;
  hydrology = undefined;
  hydrologyKey = '';
  hydrologyVectorKey = '';
  hydrologyFailure = undefined;
  conditioned = undefined;
  vectorWater = undefined;
});
export function sampleRustTerrain(request: TerrainRequest, onRelief?: (relief: TerrainData) => void, progress?: TerrainProgressCallback, lab?: GenerationControl): Promise<TerrainData> {
  // Retried once when the failure terminated the threads instance.
  const result = queue.then(() =>
    sampleTerrain(request, onRelief, progress, lab).catch(async error => {
      if (!(await recoverCoreWasm(error))) throw error;
      progress?.('Rust/WASM threads stopped: continuing on the single-thread engine…', { stage: 'runtime-download' });
      return sampleTerrain(request, onRelief, progress, lab);
    }),
  );
  queue = result.catch(() => undefined);
  return result;
}
async function sampleTerrain(request: TerrainRequest, onRelief?: (relief: TerrainData) => void, progress?: TerrainProgressCallback, lab?: GenerationControl): Promise<TerrainData> {
  const { settings: inputSettings, region, kind, display, runtime } = request;
  // A retained V2 trace cannot cut imported surfaces or underground terrain.
  const settings = inputSettings.islandMode?.startsWith('traced:') && (inputSettings.sketch?.processing || inputSettings.relief === 'cavern' || inputSettings.underdark) ? { ...inputSettings, islandMode: 'island' as const } : inputSettings;
  const definition = sourceDefinition(settings);
  validateProceduralRecipe(settings.procedural);
  if (settings.procedural && ['plateau', 'volcano', 'caldera', 'cavern'].includes(settings.relief)) throw new Error('The decomposed recipe covers regional reliefs; finite shapes and caverns keep their normal generator.');
  if (lab) await lab.before('prepare');
  if (settings.procedural?.erosionTuning) settings.erosionTuning = { ...settings.erosionTuning, ...settings.procedural.erosionTuning };
  // Marshes keep their hollows as ponds: in the wetland zone the sills are not carved (defaults 0.1, 1 and 0.3), the
  // basins only silt up. Every other zone drains its basins. Explicit tuning wins.
  if (settings.climateZone === 'wetland') settings.erosionTuning = { carve: 0, finalCarve: 0, surfaceCarve: 0, ...settings.erosionTuning };
  const mode = settings.compute === 'wasm' ? 'wasm' : 'gpu-f32';
  const generationMode = settings.generationCompute ?? 'gpu-erosion';
  if (unsupportedExplicitGpuResolution(settings, definition.n)) throw new Error(`GPU generation is limited to ${MAX_GPU_SOURCE_RESOLUTION}² cells; requested spacing ${definition.spacing.toFixed(2)} m (${definition.n}²). Choose CPU or native.`);
  const coastSeed = stepSeed(settings.generalSeed ?? settings.seed, 'relief-coast-cut');
  const seededStages = !!settings.generalSeed && seedSubset(settings.generalSeed, key => key.startsWith('relief-')) !== seedRoot(settings.generalSeed);
  const compact = isCompactProcedural(settings);
  // CPU terrain execution keeps the water on the CPU too: the Rust drainage takes tens of ms at 512²,
  // while a WebGPU adapter request can stall for seconds (no adapter, busy GPU process).
  const hydrologyCompute: HydrologySettings['compute'] = settings.hydrology?.compute === 'auto' && (mode === 'wasm' || generationMode === 'cpu') ? 'cpu' : (settings.hydrology?.compute ?? 'auto');
  // Otherwise ask for the adapter now, so its latency overlaps the relief generation.
  if (hydrologyCompute !== 'cpu' && settings.hydrology?.enabled && settings.hydrology.engine === 'rust') void gpuContext();
  if (compact && !settings.zones && !settings.sketch?.processing && (!(COMPACT_RELIEFS as readonly string[]).includes(settings.relief) || (settings.sketch && !settings.drawing))) throw new Error('Procedural Phasor: choose a plains, hills, valley, canyon or mountains relief.');
  const nativeGeneration = generationMode === 'native' && !isNeuralSource(settings.source);
  if (nativeGeneration && runtime?.profile !== 'local') throw new Error('The native engine requires the Local profile and its Rust service.');
  if (nativeGeneration && settings.relief === 'cavern') return sampleNativeTerrain({ ...request, settings });
  const environment = (GEOLOGICAL_RELIEFS as readonly string[]).includes(settings.relief) ? (settings.environment ?? 'mixed') : 'mixed';
  const surfaceInput = settings.sketch?.processing;
  const coastMask = !stageEnabled(settings, 'coasts') ? 0 : settings.relief === 'cavern' || settings.underdark ? 0 : (settings.coastMask ?? 0);
  const islandMode = settings.islandMode ?? 'island';
  const profile = coastProfile(settings);
  const supported = GPU_RELIEFS.includes(settings.relief);
  const gpu = mode !== 'wasm' && supported ? prepareGpu(mode, settings.relief).catch(() => undefined) : undefined;
  // Vite embeds this asset in the standalone HTML (and in the inline worker).
  if (ready) progress?.('Reusing the loaded Rust/WASM engine', { stage: 'runtime-ready' });
  try {
    await loadRuntime(progress);
  } catch (error) {
    ready = undefined;
    throw error;
  }
  const started = performance.now();
  if (gpu) progress?.('Connecting to the WebGPU device…', { stage: 'gpu-device' });
  const readyGpu = gpu ? await gpuSetupDeadline(gpu) : undefined;
  if (lab) await lab.after('prepare');
  const retainGpuPhysicalPlan = (erosionSpacing?: number, regionalErosionSpacing?: number) => {
    const previous = enginePhysicalPlan;
    enginePhysicalPlan = {
      erosionSpacing: erosionSpacing === undefined ? previous?.erosionSpacing : Math.max(previous?.erosionSpacing ?? 0, erosionSpacing),
      regionalErosionSpacing: regionalErosionSpacing === undefined ? previous?.regionalErosionSpacing : Math.max(previous?.regionalErosionSpacing ?? 0, regionalErosionSpacing),
    };
    Object.assign(definition, enginePhysicalPlan);
  };
  const finishSource = async (input: Float32Array, cpuDetail = false): Promise<Float32Array> => {
    let height = cpuDetail && stageEnabled(settings, 'phasor', false) ? applyPhasorCpu(input, settings) : input;
    const p = posteriorSettings(settings),
      w = windSettings(settings);
    const signatures = proceduralSignatures(settings);
    for (const stage of ['posterior', 'wind'] as const) {
      const fieldKey = JSON.stringify([signatures.get(stage), runtime?.server, !!readyGpu, fingerprintBytes(new Uint8Array(height.buffer, height.byteOffset, height.byteLength))]);
      const saved = settings.procedural ? postCheckpoints.get(stage, fieldKey) : undefined;
      if (saved) {
        height = saved;
        if (lab?.cached) await lab.cached(stage, lab.previews === false ? undefined : height);
        else {
          await lab?.before(stage);
          await lab?.after(stage, lab.previews === false ? undefined : height);
        }
        continue;
      }
      await lab?.before(stage);
      if (stage === 'posterior' && settings.procedural && stageEnabled(settings, stage) && p.mode !== 'none') {
        const previous = height,
          heightN = Math.sqrt(height.length);
        height = (await conditionRelief(height, heightN, settings.width, p, { stats: false }, runtime)).height;
        for (let i = 0; i < height.length; i++) height[i] = previous[i] > 0 ? Math.max(0.3, height[i]) : height[i];
      }
      if (stage === 'wind' && settings.procedural && stageEnabled(settings, stage) && w.iterations && w.transport) height = readyGpu ? await erodeWindGpu(readyGpu.context, height, settings.width, w) : erodeWindCpu(height, settings.width, w);
      if (settings.procedural && definition.n <= 1024) postCheckpoints.put(stage, fieldKey, height);
      await lab?.after(stage, lab.previews === false ? undefined : height);
    }
    // The geographic sampler expects a positive inland source. A cut placed
    // after normalization may still be signed: keep its land deformation and
    // let coastal finishing restore the selected sea, as for earlier cuts.
    return settings.procedural && height.some(h => h < 0.3) ? height.map(h => Math.max(0.3, h)) : height;
  };
  // Handle compilation failure immediately while preparation runs synchronously.
  const pipelineReady = readyGpu
    ? gpuSetupDeadline(readyGpu.pipeline).then(
        pipeline => ({ pipeline }),
        () => undefined,
      )
    : undefined;
  const proceduralGpu = !nativeGeneration && !settings.zones && !settings.sketch && generationMode !== 'cpu' && mode !== 'wasm' && !isNeuralSource(settings.source) && settings.relief !== 'cavern';
  // Device limits are known here; one rule decides for every size. An explicit GPU choice never moves to the CPU silently.
  const gpuPlan = proceduralGpu && readyGpu ? planGpuErosion(readyGpu.context, settings) : undefined;
  if (gpuPlan?.error && settings.generationCompute) throw new Error(gpuPlan.error);
  const autoCpuReason = settings.generationCompute || !gpuPlan ? undefined : (gpuPlan.error ?? (preferCpuGeneration(gpuPlan) ? `Source ${definition.n}²: the fixed GPU cost exceeds the estimated CPU compute.` : undefined));
  const gpuAllowed = !!gpuPlan && !gpuPlan.error && !autoCpuReason;
  const requestedGpuGeneration = proceduralGpu && GPU_GENERATION_RELIEFS.includes(settings.relief);
  const gpuGeneration = requestedGpuGeneration && gpuAllowed;
  const cpuPipeline =
    (definition.n !== 1024 || !!(settings.procedural || lab || seededStages)) &&
    !settings.sketch &&
    !settings.zones &&
    ['hills', 'valley', 'mountains', 'mixed', 'high-mountains', 'canyon'].includes(settings.relief) &&
    !isNeuralSource(settings.source) &&
    (!gpuGeneration || generationMode !== 'gpu-erosion');
  // Device loss affects sampling; it must not replace an already prepared landscape.
  const neural = !surfaceInput && isNeuralSource(settings.source);
  if (!neural) {
    await releaseNeuralBrowser();
    await releasePythonNeural();
  }
  // Local profile: the relief engine is retained by the native service (no WASM relief work).
  const localRelief = runtime?.profile === 'local' && (nativeGeneration || neural);
  const modificationKey = settings.modification ? JSON.stringify([settings.modification.resolution, settings.modification.width, fingerprintNumbers(settings.modification.delta)]) : '';
  // The carve replaces the relief: other options need the uncarved relief again.
  const underdark: UnderdarkCarve = { tunnels: settings.underdarkTunnels, caverns: settings.underdarkCaverns, lakes: settings.hydrology && lakesOff(settings.hydrology) ? 0 : settings.hydrology?.lakeAbundance };
  const key =
    JSON.stringify([settings.zones, modificationKey, settings.underdark ? underdark : null, coastSeed, nativeGeneration ? [runtime!.server, coastMask, islandMode, profile] : null, localRelief ? runtime!.server : null]) +
    '|' +
    (neural
      ? JSON.stringify([
          settings.source,
          settings.seed,
          settings.relief,
          settings.relief === 'mixed' ? settings.mountainMix : 0.5,
          climateOf(settings),
          settings.fidelity ?? 0.05,
          settings.neuralServer ?? '',
          settings.sketch,
          settings.neuralTuning ?? DEFAULT_NEURAL_TUNING,
          settings.width,
          definition.n,
          settings.coarseModel,
          settings.baseModel,
          settings.decoderModel,
          settings.neuralFit,
          settings.neuralSlopes,
        ])
      : JSON.stringify([
          settings.seed,
          ...(settings.generalSeed ? [seedSubset(settings.generalSeed, key => key.startsWith('relief-'))] : []),
          settings.width,
          definition.n,
          settings.relief,
          settings.relief === 'cavern' ? 0 : settings.erosion,
          settings.motifSize,
          settings.relief === 'mixed' ? settings.mountainMix : 0.5,
          nativeGeneration ? 'native' : compact ? [generationMode, mode, !!readyGpu] : requestedGpuGeneration ? generationMode : 'cpu',
          environment,
          settings.sketch,
          settings.erosionTuning ?? {},
          ...(settings.procedural ? [PROCEDURAL_RECIPE_VERSION, profile, settings.procedural, settings.climate, settings.climateValues, settings.climateZone, !gpuGeneration ? [coastMask, islandMode, profile] : null] : []),
          ...(compact || settings.procedural?.enabled?.phasor ? [COMPACT_VERSION, settings.climate ?? 'temperate', settings.phasor ?? {}] : []),
        ]));
  let prepareMs = 0,
    noiseMs = 0,
    erosionMs = 0,
    gpuSimulationMs = 0,
    nativeEnvironmentMs = 0;
  let erosionProfile: ErosionProfile[] | undefined;
  if ((lab && lab.previews !== false) || !(engine || nativeRelief) || engineKey !== key) {
    sampler?.dispose();
    sampler = undefined;
    samplerMode = undefined;
    engine?.free();
    engine = undefined;
    nativeRelief?.free();
    nativeRelief = undefined;
    engineRetainedCoasts = false;
    engineKey = '';
    engineCoastKey = '';
    enginePhysicalPlan = undefined;
    const prepareStarted = performance.now();
    modificationApplied = '';
    underdarkApplied = '';
    modificationBase = undefined;
    modifiedPhysical = undefined;
    modificationSource = undefined;
    generationBackend = 'cpu';
    generationReason = undefined;
    const mix = settings.relief === 'mixed' ? settings.mountainMix : 0.5;
    neuralInfo = undefined;
    // Read by the CPU engine and the GPU erosion plan built below, and by later coasts.
    const engineTuning = Float64Array.from(EROSION_SETTINGS, name => {
      let value = compact && !settings.procedural ? NaN : (settings.procedural?.erosionTuning?.[name] ?? settings.erosionTuning?.[name] ?? NaN);
      if (settings.procedural?.biome && !gpuGeneration && !cpuPipeline && (name === 'incision' || name === 'thermal')) value = (Number.isFinite(value) ? value : 1) * (name === 'incision' ? erosionBiome(settings).water : erosionBiome(settings).thermal);
      return value;
    });
    set_erosion_tuning(engineTuning);
    if (cpuPipeline) {
      progress?.(autoCpuReason ? `${autoCpuReason} Rust CPU generation at ${definition.spacing.toFixed(2)} m…` : nativeGeneration ? 'Native Rust · procedural pipeline…' : 'Rust CPU/WASM · procedural pipeline…', { stage: 'terrain-generation' });
      const source = await finishSource(
        await generateCpuTerrain(settings, lab, nativeGeneration ? runtime : undefined, gpuGeneration && readyGpu ? () => generateGpuNoise(readyGpu.context, settings, progress) : undefined, (spacing, regionalSpacing) => {
          enginePhysicalPlan = { erosionSpacing: spacing, regionalErosionSpacing: regionalSpacing };
          Object.assign(definition, enginePhysicalPlan);
        }),
      );
      if (lab) await lab.before('retain');
      if (localRelief) nativeRelief = await NativeReliefEngine.build(runtime!, { kind: 'source', seed: coastSeed, width: settings.width, relief: settings.relief, erosion: settings.erosion, motifSize: settings.motifSize, mountainMix: mix, environment }, source, engineTuning);
      else engine = TerrainEngine.with_source(coastSeed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, source, environment);
      if (lab) await lab.after('retain', lab.previews === false ? undefined : source);
      generationBackend = nativeGeneration ? 'native' : gpuGeneration ? (generationMode === 'gpu-all' ? 'gpu-noise-all-f32' : 'gpu-noise-f32') : compact ? 'compact-cpu' : 'cpu';
      generationReason = autoCpuReason ?? `${nativeGeneration ? 'Native' : 'WASM'} Rust procedural pipeline · stages shared with global generation.`;
    } else if (nativeGeneration) {
      progress?.('Native Rust · generating terrain and erosion…', { stage: 'terrain-generation', detail: `Local Rust service · computing the ${definition.n} × ${definition.n} physical field` });
      const nativeSettings = settings.procedural?.biome
        ? { ...settings, coastMask, erosionTuning: { ...settings.erosionTuning, incision: (settings.erosionTuning?.incision ?? 1) * erosionBiome(settings).water, thermal: (settings.erosionTuning?.thermal ?? 1) * erosionBiome(settings).thermal } }
        : { ...settings, coastMask };
      const result = await prepareNativeTerrain(nativeSettings.sketch && !surfaceInput ? { ...nativeSettings, sketch: undefined } : nativeSettings, runtime!);
      // The native service already cut the coast; finishing clamps to a positive inland source, so keep its sea.
      // Painted zones are already a finished relief: like the WASM path, they skip the procedural post stages.
      const finished = surfaceInput !== 'surface' && settings.procedural && !settings.zones ? await finishSource(result.height.slice(), true) : undefined;
      if (finished && coastMask) for (let i = 0; i < finished.length; i++) if (result.height[i] <= 0) finished[i] = result.height[i];
      nativeRelief = await NativeReliefEngine.build(runtime!, { kind: 'surface', seed: coastSeed, width: settings.width }, finished ?? result.height, engineTuning);
      generationBackend = 'native';
      generationReason = 'Terrain and coasts computed by the native Rust service; the surface is retained for GPU rendering and water.';
      nativeEnvironmentMs = result.prepareMs;
    } else if (surfaceInput) {
      progress?.('Preparing the imported heightmap elevations…', { stage: 'terrain-import' });
      const height = heightmapSurface(parseTerrainSketch(settings.sketch), definition.n);
      if (surfaceInput === 'erosion') {
        progress?.('CPU · eroding the imported heightmap…', { stage: 'terrain-generation' });
        engine = TerrainEngine.at_resolution(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment, definition.n);
        engine.set_edited_surface(height);
        const eroded = engine.sampling_base_field();
        engine.free();
        engine = TerrainEngine.with_surface(coastSeed, settings.width, eroded);
      } else engine = TerrainEngine.with_surface(coastSeed, settings.width, height);
      generationReason = surfaceInput === 'erosion' ? 'Edited heightmap → Rust erosion, without generating new terrain.' : 'Edited heightmap retained, without generation or erosion.';
    } else if (neural) {
      // Generate inland relief first; the map-scale coast is applied below.
      const result = await fetchNeuralRelief(settings, progress);
      const surface = fitNeuralSurface(result.heights, settings.width, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, coastMask);
      if (localRelief)
        nativeRelief = await NativeReliefEngine.build(
          runtime!,
          settings.zones ? { kind: 'zonedSurface', seed: coastSeed, width: settings.width, motifSize: settings.motifSize, zones: settings.zones } : { kind: 'surface', seed: coastSeed, width: settings.width },
          surface,
          engineTuning,
        );
      else engine = settings.zones ? TerrainEngine.with_zoned_surface(coastSeed, settings.width, settings.motifSize, surface, JSON.stringify(settings.zones)) : TerrainEngine.with_surface(coastSeed, settings.width, surface);
      neuralInfo = result.info;
      generationBackend = 'neural';
      if (settings.zones) generationReason = 'Zones → regional conditioning and local neural relief, then sea operation.';
    } else if (compact && !settings.zones) {
      if (readyGpu && gpuAllowed) {
        progress?.('GPU · compact relief, regional erosion and Phasor…', { stage: 'terrain-generation' });
        const timing = { nativeEnvironmentMs: 0, profiles: [] as ErosionProfile[], control: lab, onPhysicalPlan: retainGpuPhysicalPlan };
        const source = await finishSource(await generateGpuTerrain(readyGpu.context, settings, timing, progress));
        if (lab) await lab.before('retain');
        erosionProfile = timing.profiles;
        // Retain the ordinary geographic sampler: it also shapes valleys and cuts coasts.
        engine = TerrainEngine.with_source(coastSeed, settings.width, settings.relief === 'flat' ? 'hills' : settings.relief, settings.erosion, settings.motifSize, mix, source, environment);
        if (lab) await lab.after('retain', source);
        generationBackend = 'compact-gpu-f32';
        generationReason = `${COMPACT_VERSION} · compact preset · ${settings.procedural?.regionalN ?? compactBudget(settings).n}² grid · ${settings.climate ?? 'temperate'} · Phasor ${stageEnabled(settings, 'phasor', true) ? 'enabled' : 'disabled'}.`;
      } else {
        progress?.('CPU · regional erosion and Phasor…', { stage: 'terrain-generation' });
        const b = settings.procedural?.biome ? erosionBiome(settings) : undefined;
        const profile = b ? { incision: b.water, thermal: b.thermal } : settings.procedural ? { incision: 1, thermal: 1 } : compactProfile(settings),
          iterations = settings.procedural?.erosionTuning?.iterations ?? compactBudget(settings).steps;
        const manual = settings.erosionTuning ?? {};
        const tuning: ErosionTuning = {
          ...manual,
          iterations,
          surfaceIterations: stageEnabled(settings, 'surface', false) ? (manual.surfaceIterations ?? 12) : 0,
          detail: stageEnabled(settings, 'ridged', false) ? manual.detail : 0,
          warp: manual.warp ?? 0,
          incision: (manual.incision ?? 1) * profile.incision,
          thermal: (manual.thermal ?? 1) * profile.thermal,
        };
        set_erosion_tuning(Float64Array.from(EROSION_SETTINGS, name => tuning[name] ?? NaN));
        let reference: TerrainEngine | undefined;
        try {
          reference = TerrainEngine.at_resolution(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment, definition.n);
          const sampled = reference.physical_height_field();
          engine = TerrainEngine.with_source(coastSeed, settings.width, 'hills', settings.erosion, settings.motifSize, mix, stageEnabled(settings, 'phasor', true) ? applyPhasorCpu(sampled, settings) : sampled, environment);
        } finally {
          reference?.free();
          set_erosion_tuning(new Float64Array(EROSION_SETTINGS.length).fill(NaN));
        }
        generationBackend = 'compact-cpu';
        generationReason = `${COMPACT_VERSION} · Rust CPU + scalar Phasor · ${settings.climate ?? 'temperate'}; GPU-independent topography.`;
      }
    } else if (settings.zones) {
      progress?.('CPU · generating and eroding painted terrain zones…', { stage: 'terrain-generation', detail: `Rust/WASM · ${definition.n} × ${definition.n} physical field` });
      engine = TerrainEngine.with_zones_at_resolution(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment, JSON.stringify(parseTerrainZones(settings.zones)), definition.n);
      generationReason = 'Zone masks → uplift, noise, ridges and Rust erosion.';
    } else if (gpuGeneration && readyGpu) {
      try {
        if (generationMode === 'gpu-erosion' || settings.relief === 'volcano' || settings.relief === 'caldera' || settings.relief === 'plateau' || settings.relief === 'canyon') {
          const timing = { nativeEnvironmentMs: 0, profiles: [] as ErosionProfile[], control: lab, onPhysicalPlan: retainGpuPhysicalPlan };
          const source = await finishSource(await generateGpuTerrain(readyGpu.context, settings, timing, progress));
          if (lab) await lab.before('retain');
          nativeEnvironmentMs = timing.nativeEnvironmentMs;
          erosionProfile = timing.profiles;
          gpuSimulationMs = performance.now() - prepareStarted - nativeEnvironmentMs;
          engine = TerrainEngine.with_source(coastSeed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, source, environment);
          if (lab) await lab.after('retain', source);
          generationBackend = 'gpu-erosion-f32';
        } else {
          const noise = await generateGpuNoise(readyGpu.context, settings, progress);
          noiseMs = performance.now() - prepareStarted;
          const erosionStarted = performance.now();
          progress?.('CPU · eroding the GPU-generated noise…', { stage: 'terrain-generation' });
          engine = TerrainEngine.with_generation_noise(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, noise.coarse, noise.fine, environment);
          erosionMs = performance.now() - erosionStarted;
          generationBackend = generationMode === 'gpu-all' ? 'gpu-noise-all-f32' : 'gpu-noise-f32';
        }
      } catch (error) {
        if (lab || settings.procedural) throw error;
        generationReason = `GPU generation unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (!engine && !nativeRelief) {
      progress?.(settings.relief === 'cavern' ? 'CPU · generating caverns…' : 'CPU · generating terrain and erosion…', { stage: 'terrain-generation', detail: `Rust/WASM · ${definition.n}² physical source at ${definition.spacing.toFixed(2)} m` });
      engine = TerrainEngine.at_resolution(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment, definition.n);
      if (autoCpuReason) generationReason = autoCpuReason;
    }
    if (!surfaceInput && !neural && settings.sketch && settings.relief !== 'cavern') {
      const sketch = parseTerrainSketch(settings.sketch);
      const sample = await physicalHeightField(),
        edited = refineSketch(sketch, sample, definition.n);
      if (nativeRelief) await nativeRelief.editSurface(edited);
      else engine!.set_edited_surface(edited);
      generationReason = 'Edited sketch + procedural detail and Rust erosion.';
    }
    const posterior = posteriorSettings(settings),
      wind = windSettings(settings);
    const hasCpuPost = (stageEnabled(settings, 'posterior') && posterior.mode !== 'none') || (stageEnabled(settings, 'wind') && wind.iterations > 0 && wind.transport > 0);
    if (!cpuPipeline && settings.procedural && (hasCpuPost || (!compact && stageEnabled(settings, 'phasor', false))) && !['gpu-erosion-f32', 'compact-gpu-f32'].includes(generationBackend) && !neural && !surfaceInput && !nativeGeneration && !settings.zones) {
      setEngineCoast(engine!, coastMask, islandMode, profile);
      const sampled = engine!.physical_height_field();
      const height = await finishSource(sampled, !compact);
      engine!.free();
      engine = TerrainEngine.with_surface(coastSeed, settings.width, height);
      engineRetainedCoasts = true;
    }
    // Sculpting replaces the engine; retain its bare prepared input for later coast edits.
    if (settings.modification && (neural || surfaceInput)) modificationSource = await samplingBaseField();
    prepareMs = performance.now() - prepareStarted;
    engineKey = key;
  } else {
    progress?.('Reusing the previously generated terrain', { stage: 'terrain-generation' });
    if (enginePhysicalPlan) Object.assign(definition, enginePhysicalPlan);
    if (lab?.cached && settings.procedural && ['hills', 'valley', 'mountains', 'mixed', 'high-mountains', 'canyon'].includes(settings.relief)) {
      for (const stage of ['grids', ...coreOperations(settings), 'phasor', 'posterior', 'wind'] as const) await lab.cached(stage);
    }
  }
  const coastCheckpointKey = JSON.stringify([
    key,
    coastSeed,
    coastMask,
    islandMode,
    profile,
    proceduralSignatures(settings).get('coasts'),
    generationBackend,
    runtime?.server,
    settings.sketch && [settings.sketch.resolution, settings.sketch.processing, fingerprintNumbers(settings.sketch.heights)],
    settings.zones && [settings.zones.resolution, fingerprintNumbers(settings.zones.weights)],
  ]);
  const cacheCoast = !!(settings.procedural || neural || surfaceInput) && !engineRetainedCoasts && !(nativeGeneration && !cpuPipeline);
  const savedCoast = cacheCoast && coastMask ? postCheckpoints.get('coasts', coastCheckpointKey) : undefined;
  if (!savedCoast && lab) await lab.before('coasts');
  // Reuse the underlying relief, then cut the coast before its physical erosion.
  const gpuCoast = !neural && !surfaceInput && !engineRetainedCoasts && !gpuPlan?.error && !autoCpuReason && !settings.zones && !settings.sketch && coastMask !== 0 && generationMode !== 'cpu' && mode !== 'wasm';
  const coastKey = JSON.stringify([
    coastSeed,
    coastMask,
    coastMask ? islandMode : 'island',
    profile,
    coastMask ? gpuCoast : false,
    settings.procedural?.coastIterations,
    settings.procedural?.coastIncision,
    settings.procedural?.coastThermal,
    settings.procedural?.coastDiffusion,
    settings.erosionTuning,
  ]);
  let coastMs = 0;
  if (modificationSource && modificationApplied && modificationApplied !== key + '|' + coastKey) {
    sampler?.dispose();
    sampler = undefined;
    samplerMode = undefined;
    if (nativeRelief) {
      const previous = nativeRelief;
      nativeRelief = await NativeReliefEngine.build(runtime!, { kind: 'surface', seed: coastSeed, width: settings.width }, modificationSource, new Float64Array(EROSION_SETTINGS.length).fill(NaN));
      previous.free();
    } else {
      engine?.free();
      engine = TerrainEngine.with_surface(coastSeed, settings.width, modificationSource);
    }
    engineCoastKey = '';
    modificationApplied = '';
    modifiedPhysical = undefined;
    modificationBase = undefined;
    underdarkApplied = '';
  }
  if ((nativeGeneration && !cpuPipeline) || engineRetainedCoasts) {
    engineCoastKey = coastKey;
    coastBackend = engineRetainedCoasts && coastMask ? 'cpu' : undefined;
    coastReason = undefined;
  } else if (engineCoastKey !== coastKey) {
    sampler?.dispose();
    sampler = undefined;
    samplerMode = undefined;
    coastBackend = undefined;
    coastReason = undefined;
    const coastStarted = performance.now();
    progress?.('Shaping coastlines and islands…', { stage: 'terrain-coast' });
    const recipe = settings.procedural,
      tuning = { ...settings.erosionTuning, ...recipe?.erosionTuning };
    const coastTuning = coastMask
      ? Float64Array.from(EROSION_SETTINGS, name =>
          recipe && name === 'surfaceIterations'
            ? (recipe.coastIterations ?? (compact ? 2 : 12))
            : name === 'surfaceIncision'
              ? (tuning[name] ?? 1) * (recipe?.coastIncision ?? 1)
              : name === 'surfaceThermal'
                ? (tuning[name] ?? 1) * (recipe?.coastThermal ?? 1)
                : name === 'surfaceDiffusion'
                  ? (tuning[name] ?? 1) * (recipe?.coastDiffusion ?? 1)
                  : (tuning[name] ?? NaN),
        )
      : undefined;
    if (nativeRelief) {
      // Local profile: the coast cut and its surface erosion on the retained native engine.
      await nativeRelief.coast(coastMask, islandMode, savedCoast ? undefined : coastTuning, savedCoast, profile);
      if (coastMask) coastBackend = 'native';
    } else if (savedCoast) {
      configureEngineCoast(engine!, coastMask, islandMode, profile);
      engine!.set_coast_surface(savedCoast);
      coastBackend = 'cpu';
    }
    if (!nativeRelief && !savedCoast && gpuCoast && readyGpu) {
      let coastSampler: GpuTerrainSampler | undefined;
      try {
        const compiled = await pipelineReady;
        if (!compiled || readyGpu.context.lost) throw new Error('WebGPU unavailable');
        configureEngineCoast(engine!, coastMask, islandMode, profile);
        coastSampler = new GpuTerrainSampler(readyGpu.context, compiled.pipeline, mode, engine!);
        const source = coastSampler.prepareCoastField(settings);
        const height = await erodeGpuCoast(readyGpu.context, settings, source, engine!.coast_erosion_parameters(), progress);
        engine!.set_coast_surface(height);
        coastBackend = 'gpu-f32';
      } catch (error) {
        coastReason = `GPU coast unavailable: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        coastSampler?.dispose();
      }
    }
    if (!nativeRelief && !coastBackend) {
      if (coastTuning) set_erosion_tuning(coastTuning);
      try {
        setEngineCoast(engine!, coastMask, islandMode, profile);
      } finally {
        if (coastTuning) set_erosion_tuning(Float64Array.from(EROSION_SETTINGS, name => tuning[name] ?? NaN));
      }
      if (coastMask) coastBackend = 'cpu';
      if (gpuCoast && !readyGpu) coastReason = 'WebGPU unavailable';
    }
    engineCoastKey = coastKey;
    coastMs = coastMask ? performance.now() - coastStarted : 0;
    prepareMs += coastMs;
  }
  // Checkpoints retain the generated coast, never a sculpted/underdark derivative.
  const coastHeight = coastMask && cacheCoast && ((!savedCoast && definition.n <= 1024) || (lab && lab.previews !== false && !(savedCoast && lab.cached))) ? await samplingBaseField() : undefined;
  if (coastHeight && !savedCoast && definition.n <= 1024) postCheckpoints.put('coasts', coastCheckpointKey, coastHeight);
  if (savedCoast && lab?.cached) await lab.cached('coasts', lab.previews === false ? undefined : savedCoast);
  else if (lab) await lab.after('coasts', lab.previews === false ? undefined : coastHeight);
  // Sculpting is an independent offset layer, applied once to a freshly generated source.
  // Clearing the layer rebuilds the untouched generation instead of recycling an edited heightmap.
  if (settings.modification && modificationApplied !== key + '|' + coastKey) {
    const n = reliefMeta().source_resolution(),
      base = surfaceInput === 'surface' && !coastMask ? heightmapSurface(parseTerrainSketch(settings.sketch), n) : await physicalHeightField();
    modificationBase = { n, height: base.slice() };
    modifiedPhysical = applyTerrainModification(base, n, settings.modification);
    sampler?.dispose();
    sampler = undefined;
    samplerMode = undefined;
    if (nativeRelief) {
      const previous = nativeRelief;
      nativeRelief = await NativeReliefEngine.build(runtime!, { kind: 'surface', seed: coastSeed, width: settings.width }, modifiedPhysical, new Float64Array(EROSION_SETTINGS.length).fill(NaN));
      previous.free();
    } else {
      engine?.free();
      engine = TerrainEngine.with_surface(coastSeed, settings.width, modifiedPhysical);
    }
    modificationApplied = key + '|' + coastKey;
  }
  // Underdark: the finished relief (any source, coasts and sculpt included) becomes caves and tunnels, once per relief.
  if (settings.underdark && underdarkApplied !== key + '|' + coastKey + '|' + modificationApplied) {
    progress?.('Underdark · carving caverns and tunnels…', { stage: 'terrain-generation' });
    sampler?.dispose();
    sampler = undefined;
    samplerMode = undefined;
    if (nativeRelief) await nativeRelief.carveUnderdark(settings.seed, underdark);
    else (engine!.carve_underdark as (seed: string, tunnels?: number, caverns?: number, lakes?: number) => void)(settings.seed, underdark.tunnels, underdark.caverns, underdark.lakes);
    underdarkApplied = key + '|' + coastKey + '|' + modificationApplied;
  }
  // The overview's physical field and the display field both take the conditioning change on the source grid.
  let upsampled: { delta: Float32Array; m: number; n: number; out: Float32Array } | undefined;
  const sourceDelta = async (delta: Float32Array, m: number, n: number): Promise<Float32Array> => {
    if (upsampled?.delta !== delta || upsampled.m !== m || upsampled.n !== n) upsampled = { delta, m, n, out: await upsampleDelta(delta, m, n, runtime) };
    return upsampled.out;
  };
  async function finish(data: TerrainData): Promise<TerrainData> {
    if (enginePhysicalPlan) Object.assign(definition, enginePhysicalPlan);
    else definition.erosionSpacing ??= reliefMeta().erosion_spacing();
    data.definition = definition;
    if (lab) await lab.after('sampling', data.height);
    if (lab) await lab.before('hydrology');
    const config = stageEnabled(settings, 'hydrology') ? settings.hydrology : undefined;
    data.neural = neuralInfo;
    if (kind === 'overview' && !neural && settings.relief !== 'cavern') {
      data.erosionDefaults = Array.from(erosion_defaults(settings.relief, settings.width, settings.motifSize, settings.mountainMix));
    }
    const water = !!config?.enabled && settings.relief !== 'cavern',
      vector = config?.engine !== 'rust';
    const erosionEnabled = config?.erosionEnabled !== false;
    const showErosion = erosionEnabled && config?.showErosion !== false;
    const condMode = erosionEnabled ? config?.condMode : 'none';
    // Vector chain: the lake settings keep a share of the closed depressions as lakes instead of breaching or filling them.
    const condLakes = vector && config && !lakesOff(config) ? [config.lakeAbundance, config.lakeArea, config.lakeDepth, config.lakeCoverage, config.maxLakeArea] : [0, 0, 0, 0, 0];
    const conditioningSettings = config && {
      mode: config.condMode,
      strength: config.condStrength,
      maxDepth: config.condDepth,
      maxLength: config.condLength,
      banks: config.condBanks,
      lakes: condLakes[0],
      lakeArea: condLakes[1],
      lakeDepth: condLakes[2],
      lakeCoverage: condLakes[3],
      maxLakeArea: condLakes[4],
      // A marsh rolls more than a plain: twice the undulations of the ground (hollows of decimetres to a metre), which its ponds fill.
      ...(settings.climateZone === 'wetland' ? { undulation: 2 } : {}),
    };
    if (onRelief && config && water && kind === 'overview' && display === 'gl') {
      const n = hydrologyGrid(vector ? config.vectorResolution : config.resolution, definition.n);
      const condKey = JSON.stringify([engineKey, engineCoastKey, n, condMode, condMode === 'none' ? 0 : [config.condStrength, config.condDepth, config.condBanks, config.condLength, condLakes]]);
      // Seconds of water work ahead: show the relief now.
      if (!conditioned || conditioned.key !== condKey || (vector && !vectorWater)) {
        const relief = reliefStatistics(data);
        onRelief({
          ...data,
          height: data.height.slice(),
          normalX: data.normalX.slice(),
          normalY: data.normalY.slice(),
          normalZ: data.normalZ.slice(),
          caveMask: data.caveMask.slice(),
          neural: neuralInfo && { ...neuralInfo, land: relief.land },
          field: await displayField(data, false, vector),
          relief,
          generationMs: performance.now() - started,
        });
      }
    }
    if (config && water) {
      const n = hydrologyGrid(vector ? config.vectorResolution : config.resolution, definition.n);
      // The whole map on the hydrology grid, conditioned before any drainage.
      const condKey = JSON.stringify([engineKey, engineCoastKey, n, condMode, condMode === 'none' ? 0 : [config.condStrength, config.condDepth, config.condBanks, config.condLength, condLakes]]);
      const climate = climateOf(settings);
      const vs = {
        // The tributary density scales the catchment that starts a river; headwaters then follow the valleys upstream.
        // Below 1 the engine removes whole rivers (smallest first, all at 0) and keeps the others' sources; above 1 heads extend.
        // At 0 no catchment is large enough: every reader of this threshold then finds no river either.
        riverArea: config.density > 0 ? riverAreaFor(config, settings.width) / Math.max(1, config.density) ** 2 : 1e9,
        density: Math.min(1, config.density),
        noLakes: lakesOff(config),
        headwaters: config.headwaters !== false ? 1 : 0,
        minRiverLength: config.minRiverLength,
        lakeDepth: config.lakeDepth,
        lakeArea: config.lakeArea,
        riverMode: config.riverMode,
        flatSlope: config.flatSlope,
        sinuosity: config.sinuosity,
        widthScale: config.vectorWidth,
        balance: config.balance,
        braiding: config.braiding,
        anabranching: config.anabranching,
        terrainInfluence: config.terrainInfluence,
        avulsions: config.avulsions,
        confluence: config.confluence,
        deltas: config.deltas,
        // Oxbow lakes: none (a cut-off loop leaves dry ground), except an occasional one in a marsh, detached and partly silted.
        ...(settings.climateZone === 'wetland' ? { oxbows: 0.35 } : {}),
      };
      const waterKey = JSON.stringify([condKey, vs, climate.temperature, climate.precipitation, stepSeed(settings.generalSeed ?? settings.seed, 'water-hydrology')]);
      if (!conditioned || conditioned.key !== condKey) {
        conditioned = undefined;
        vectorWater = undefined;
        preparedHydrology?.dispose();
        preparedHydrology = undefined;
        hydrology = undefined;
        hydrologyKey = '';
        hydrologyVectorKey = '';
        let height: Float32Array;
        if (data.x === 0 && data.y === 0 && data.width === settings.width && data.resolution === n) {
          height = data.height.slice();
        } else if (sampler && !sampler.lost) {
          height = (await sampler.sample({ x: 0, y: 0, extent: settings.width, resolution: n }, settings, engine!.min_height, engine!.max_height)).height;
        } else {
          const source = nativeRelief ? await nativeRelief.sampleRegion(0, 0, settings.width, n) : engine!.sample_region(0, 0, settings.width, n);
          try {
            height = source.height;
          } finally {
            source.free();
          }
        }
        if (condMode === 'none') conditioned = { key: condKey, n, height, m: 0 };
        else {
          progress?.('Conditionnement du relief avant drainage…', { stage: 'terrain-conditioning' });
          // Erosion runs on at most 512², breaching on the whole grid; the change is spline-interpolated to the camera.
          const conditioning = conditioningSettings!;
          if (vector) {
            const result = await conditionAndWater(height, n, settings.width, conditioning, vs, climate, stepSeed(settings.generalSeed ?? settings.seed, 'water-hydrology'), runtime);
            const { height: out, delta, ...stats } = result.conditioning;
            conditioned = { key: condKey, n, height: out, source: height, delta, m: n, stats };
            vectorWater = { key: waterKey, water: result.water };
          } else {
            const result = await conditionRelief(height, n, settings.width, conditioning, { stats: false, drainage: false }, runtime);
            const { height: out, delta, hydrology: drainage, ...stats } = result;
            conditioned = { key: condKey, n, height: out, source: height, delta, m: n, stats: { ...stats, census: false }, drainage };
          }
        }
      }
      if (vector) {
        if (!vectorWater || vectorWater.key !== waterKey) {
          progress?.('Vector hydrology · water budget, lakes and streams…', { stage: 'terrain-water' });
          if (conditioned.source) {
            // Settling retains the pre-settle routing. Re-run the stateless chain
            // on settings changes so that routing never has to cross the bridge.
            const result = await conditionAndWater(conditioned.source, n, settings.width, conditioningSettings!, vs, climate, stepSeed(settings.generalSeed ?? settings.seed, 'water-hydrology'), runtime);
            const { height: out, delta, ...stats } = result.conditioning;
            Object.assign(conditioned, { height: out, delta, stats });
            vectorWater = { key: waterKey, water: result.water };
          } else {
            vectorWater = { key: waterKey, water: await computeVectorWater(conditioned.height, n, settings.width, vs, climate, stepSeed(settings.generalSeed ?? settings.seed, 'water-hydrology'), conditioned.drainage, runtime) };
          }
        }
      } else {
        const inputKey = JSON.stringify([condKey, hydrologyCompute, stepSeed(settings.generalSeed ?? settings.seed, 'water-hydrology')]);
        // Display choices never change the network or invalidate a failed calculation.
        const routingConfig: HydrologySettings = { ...config, showErosion: true, erosionEnabled, ...(!erosionEnabled ? { incision: 0, depressionPolicy: 'fill', maxBreachDepth: 0, maxBreachLength: 0 } : {}) };
        // A refused neural relief is retried only when the relief or the hydrology settings change.
        const failureKey = `${inputKey}|${JSON.stringify(routingConfig)}`;
        if (neural && hydrologyFailure?.key === failureKey) data.hydrologyError = hydrologyFailure.message;
        else
          try {
            if (!preparedHydrology || hydrologyKey !== inputKey) {
              progress?.('Rust hydrology · preparing drainage…', { stage: 'terrain-drainage' });
              preparedHydrology?.dispose();
              preparedHydrology = undefined;
              hydrology = undefined;
              hydrologyVectorKey = '';
              preparedHydrology = await PreparedHydrology.create(
                stepSeed(settings.generalSeed ?? settings.seed, 'water-hydrology'),
                settings.width,
                n,
                conditioned.height.slice(),
                hydrologyCompute,
                coastMask !== 0 || (surfaceInput || neural || settings.sketch || settings.zones ? reliefMeta().min_height <= 0 : false),
              );
              hydrologyKey = inputKey;
            }
            const climate = climateOf(settings);
            const vectorKey = JSON.stringify([routingConfig, climate.temperature, climate.precipitation]);
            if (!hydrology || hydrologyVectorKey !== vectorKey) {
              progress?.('Rust hydrology · rivers, lakes and erosion…', { stage: 'terrain-water' });
              hydrology = preparedHydrology.generate(routingConfig, climate);
              hydrologyVectorKey = vectorKey;
            }
          } catch (error) {
            // Neural surfaces can exceed the current river-profile budgets: keep the relief.
            if (!neural) throw error;
            preparedHydrology?.dispose();
            preparedHydrology = undefined;
            hydrology = undefined;
            hydrologyKey = '';
            hydrologyFailure = { key: failureKey, message: error instanceof Error ? error.message : String(error) };
            data.hydrologyError = hydrologyFailure.message;
          }
      }
    }
    // The displayed terrain: conditioning, Rust riverbeds, then fractal refinement.
    progress?.('Application des lits fluviaux et des altitudes finales…', { stage: 'terrain-carving' });
    if (water && showErosion && conditioned?.delta && !settings.underdark) await applyDelta(data, conditioned.delta, conditioned.m, settings.width, runtime);
    if (water && showErosion && !vector && hydrology && !data.hydrologyError) {
      const surfaceStarted = performance.now();
      applyHydrologySurface(data, hydrology);
      data.hydrologySurfaceMs = performance.now() - surfaceStarted;
    }
    if (kind === 'overview') {
      const n = reliefMeta().source_resolution();
      // Preserve imported/painted metre samples. Re-evaluating height_at applies the
      // renderer's reconstruction filter and would smooth the saved global source again.
      const height = settings.underdark ? await physicalHeightField() : (modifiedPhysical?.slice() ?? (surfaceInput === 'surface' && !coastMask ? heightmapSurface(parseTerrainSketch(settings.sketch), n) : await physicalHeightField()));
      if (water && showErosion && conditioned?.delta && !settings.underdark) {
        const delta = await sourceDelta(conditioned.delta, conditioned.m, n);
        for (let i = 0; i < height.length; i++) height[i] += height[i] <= 0 ? Math.min(0, delta[i]) : delta[i];
      }
      if (water && showErosion && !vector && hydrology && !data.hydrologyError) applyHydrologyHeight({ x: 0, y: 0, width: settings.width, resolution: n, height, minHeight: data.globalMinHeight, maxHeight: data.globalMaxHeight }, hydrology);
      data.physical = { n, height };
      if (modificationBase) data.modificationBase = modificationBase;
    }
    if (settings.refine && display !== 'gl') applyFractalDetail(data, settings.width / reliefMeta().source_resolution(), seedHash(settings.seed), settings.detailNoise);
    if (kind === 'overview' && (display === 'gl' || request.retainField)) {
      progress?.('Retaining the physical field and water network…', { stage: 'terrain-retain' });
      data.field = await displayField(data, water, vector);
    }
    // Intermediate grids stay in the worker cache. Only overview replies clone
    // them for inspection; camera requests carry just their terrain region.
    if (kind === 'overview' && water) {
      if (vector) data.water = vectorWater?.water;
      else if (hydrology && !data.hydrologyError) data.hydrology = hydrology;
      if (conditioned?.delta && conditioned.stats) data.conditioning = { delta: conditioned.delta, n: conditioned.m, stats: conditioned.stats };
    }
    if (kind === 'overview') data.relief = reliefStatistics(data);
    if (data.neural && data.relief) data.neural = { ...data.neural, land: data.relief.land };
    data.generationMs = performance.now() - started;
    if (lab) await lab.after('hydrology', data.height);
    return data;
  }
  /**
   * Regional reliefs and prepared surfaces (neural, coasts, sketches) sample
   * the B-spline of the engine's physical raster: the GPU draws that raster
   * exactly. Rust riverbeds modify that full-resolution field; camera regions
   * only refine their narrow cuts, never replace it with a coarser overview.
   */
  async function displayField(data: TerrainData, water: boolean, vector: boolean): Promise<DisplayField> {
    const family = reliefMeta().sampling_parameters()[5];
    const showErosion = settings.hydrology?.erosionEnabled !== false && settings.hydrology?.showErosion !== false;
    if ((family === 1 || family === 4) && settings.relief !== 'cavern') {
      const n = reliefMeta().source_resolution(),
        field = await samplingBaseField();
      if (water && showErosion && conditioned?.delta && !settings.underdark) {
        const delta = await sourceDelta(conditioned.delta, conditioned.m, n);
        // Sea stays sea: the conditioning only reshapes land.
        for (let i = 0; i < n * n; i++) field[i] += field[i] <= 0 ? Math.min(0, delta[i]) : delta[i];
      }
      const riverbeds = water && showErosion && !vector && !data.hydrologyError ? hydrology : undefined;
      if (riverbeds) {
        applyHydrologyHeight({ x: 0, y: 0, width: settings.width, resolution: n, height: field, minHeight: data.globalMinHeight, maxHeight: data.globalMaxHeight }, riverbeds);
      }
      const cave = settings.underdark ? (nativeRelief ? await nativeRelief.physicalCaveField() : engine!.physical_cave_field()) : undefined;
      const tunnels = settings.underdark ? await underdarkTunnels() : undefined;
      return { n, data: field, exact: !riverbeds, floor: family === 1 ? 0.3 : 0, cave: cave?.length ? cave : undefined, ...(tunnels?.length ? { tunnels } : {}) };
    }
    const n = reliefMeta().source_resolution();
    const field = data.physical?.height.slice() ?? (await physicalHeightField());
    const cave = settings.relief !== 'cavern' && !settings.underdark ? undefined : nativeRelief ? await nativeRelief.physicalCaveField() : engine!.physical_cave_field();
    const tunnels = settings.underdark ? await underdarkTunnels() : undefined;
    return { n, data: field, exact: false, floor: 0, cave: cave?.length ? cave : undefined, ...(tunnels?.length ? { tunnels } : {}) };
  }
  if (lab) await lab.before('sampling', `Borne du moteur ${reliefMeta().max_height.toFixed(2)} m · aperçu ${region.resolution}²`);
  let backendReason: string | undefined;
  let gpuSetupMs = 0;
  let gpuSampled: TerrainData | undefined;
  // The local profile samples on its native engine; the GPU sampler reads a WASM engine.
  // Underdark: the rock mask comes from the engine's own sampling (the GPU sampler has none).
  if (mode !== 'wasm' && supported && !nativeRelief && !settings.underdark) {
    progress?.('Preparing WebGPU terrain sampling shaders…', { stage: 'gpu-sampling-compile' });
    const setupStarted = performance.now();
    try {
      const compiled = await pipelineReady;
      if (readyGpu && compiled && !readyGpu.context.lost) {
        if (!sampler || samplerMode !== mode || sampler.lost) {
          sampler?.dispose();
          sampler = undefined;
          sampler = new GpuTerrainSampler(readyGpu.context, compiled.pipeline, mode, engine!);
          samplerMode = mode;
        }
        gpuSetupMs = performance.now() - setupStarted;
        progress?.(`GPU · sampling the terrain ${region.resolution} × ${region.resolution}…`, { stage: 'terrain-sampling' });
        const data = await sampler.sample(region, settings, engine!.min_height, engine!.max_height);
        gpuSampled = { ...data, generationMs: performance.now() - started, prepareMs, gpuSetupMs, generationBackend, generationReason, noiseMs, erosionMs, gpuSimulationMs, nativeEnvironmentMs, erosionProfile, coastBackend, coastMs, coastReason };
      }
      if (!gpuSampled) backendReason = 'WebGPU indisponible';
    } catch (error) {
      backendReason = `GPU indisponible : ${error instanceof Error ? error.message : String(error)}`;
      sampler?.dispose();
      sampler = undefined;
      samplerMode = undefined;
    }
  } else if (nativeRelief) backendReason = 'Native Rust sampling on the local service.';
  else if (mode !== 'wasm') backendReason = 'terrain currently sampled in WASM';
  if (gpuSampled) return finish(gpuSampled);
  progress?.(`${nativeRelief ? 'Native Rust' : 'CPU'} · sampling the terrain ${region.resolution} × ${region.resolution}…`, { stage: 'terrain-sampling' });
  const samplingStarted = performance.now();
  const result = nativeRelief ? await nativeRelief.sampleRegion(region.x, region.y, region.extent, region.resolution) : engine!.sample_region(region.x, region.y, region.extent, region.resolution);
  try {
    return await finish({
      x: result.x,
      y: result.y,
      width: result.width,
      resolution: result.resolution,
      minHeight: result.min_height,
      maxHeight: result.max_height,
      globalMinHeight: reliefMeta().min_height,
      globalMaxHeight: reliefMeta().max_height,
      motifSize: settings.motifSize,
      height: result.height,
      caveMask: result.cave_mask,
      normalX: result.normal_x,
      normalY: result.normal_y,
      normalZ: result.normal_z,
      generationMs: performance.now() - started,
      backend: nativeRelief ? 'native' : 'wasm',
      backendReason,
      prepareMs,
      samplingMs: performance.now() - samplingStarted,
      gpuSetupMs,
      generationBackend,
      generationReason,
      noiseMs,
      erosionMs,
      gpuSimulationMs,
      nativeEnvironmentMs,
      erosionProfile,
      coastBackend,
      coastMs,
      coastReason,
    });
  } finally {
    result.free();
  }
}
