import { validateProceduralRecipe, erosionBiome, posteriorSettings, windSettings, stageEnabled, PROCEDURAL_RECIPE_VERSION, isCompactProcedural, type ProceduralRecipe, type GenerationControl } from './terrainGenerationRecipe';
import { generateCpuTerrain, releaseCpuCheckpoints } from './terrainCpuPipeline';
import { coreOperations, proceduralSignatures, TerrainFieldCheckpoints } from './terrainCheckpoints';
import { fingerprintBytes } from '../../web/src/v2/terrainFingerprint';
import { erodeWindGpu, erodeWindCpu } from './terrainWind';
import { CLIMATE_VALUES, type ClimateValues, type ClimateZone } from './terrainClimate';
export { CLIMATE_VALUES, type ClimateValues } from './terrainClimate';
import type { TerrainLayers, TerrainLighting } from '../../web/src/render/terrainLighting';
import init from '../pkg/wasm/magna_urbis_wasm.js';
import { TerrainEngine, erosion_defaults, flood_hydrology, erode_relief, set_erosion_tuning, adoptSingleWasm, loadCoreWasm, onCoreWasmReset, recoverCoreWasm, wantsWasmThreads } from './wasmRuntime';
import wasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import { GpuTerrainSampler, prepareGpu, generateGpuNoise, gpuContext, GPU_RELIEFS, GPU_GENERATION_RELIEFS } from './terrainGpu';
import { generateGpuTerrain, erodeGpuCoast, releaseGpuTerrainCheckpoints, type ErosionProfile } from './terrainErosion';
import { applyPhasorCpu, COMPACT_RELIEFS, compactBudget, compactProfile, COMPACT_VERSION, type PhasorSettings } from './terrainPhasor';
import { PreparedHydrology, applyHydrologySurface, riverAreaFor, type HydrologyData, type HydrologySettings } from './hydrology';
import { applyHydrologyHeight } from './hydrologySurface';
import type { TerrainScene, TerrainStyle } from './terrainRender';
import { refineSketch, parseTerrainSketch, neuralSketchInput, heightmapSurface, type TerrainSketch } from './terrainSketch';
import { parseTerrainZones, type TerrainZones } from './terrainZones';
import { applyDelta, applyFractalDetail, fitNeuralSurface, type FractalDetail, neuralWindow, seedHash, upsampleDelta } from './terrainAdjust';
import { conditionRelief, type ConditioningResult } from '../../web/src/ui/reliefConditioning';
import { computeVectorWater, type VectorWater } from '../../web/src/ui/vectorWater';
import { setFloodKernel } from '../../web/src/ui/simpleHydrology';
import { setErodeKernel } from '../../web/src/ui/reliefConditioning';
import { browserNeural, neuralModule, releaseNeuralBrowser } from './neuralBrowser';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { prepareNativeTerrain, sampleNativeTerrain } from './nativeTerrain';
import { loadTerrainRuntime, gpuSetupDeadline, type TerrainProgressCallback } from './terrainProgress';

export const RELIEFS = ['flat', 'hills', 'valley', 'canyon', 'mountains', 'mixed', 'plateau', 'high-mountains', 'volcano', 'caldera', 'cavern'] as const;
export type TerrainRelief = typeof RELIEFS[number];
export const GEOLOGICAL_RELIEFS = ['plateau', 'volcano', 'caldera'] as const;
export const ENVIRONMENT_RELIEFS = ['flat', 'hills', 'mixed', 'mountains', 'high-mountains'] as const;
export type TerrainEnvironment = typeof ENVIRONMENT_RELIEFS[number];
export const COMPUTE_MODES = ['wasm', 'gpu-f32'] as const;
export type TerrainCompute = typeof COMPUTE_MODES[number];
export const COAST_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
/** `random` is kept for saved recipes; `peninsula` ties one body to a single map edge. */
export const ISLAND_MODES = ['island', 'archipelago', 'random', 'peninsula'] as const;
export type IslandMode = typeof ISLAND_MODES[number];
export const TERRAIN_SOURCES = ['procedural', 'procedural-phasor', 'neural-wasm', 'neural-python', 'neural'] as const;
export type TerrainSource = typeof TERRAIN_SOURCES[number];
export const isNeuralSource = (source?: TerrainSource): boolean => source === 'neural-wasm' || source === 'neural-python' || source === 'neural';
/** Relief families sketched for the neural coarse network (7.68 km cells). */
export const NEURAL_RELIEFS = ['flat', 'hills', 'valley', 'mountains', 'mixed', 'plateau', 'high-mountains'] as const;
export const NEURAL_CLIMATES = ['temperate', 'oceanic', 'mediterranean', 'arid', 'cold', 'tropical'] as const;
export type NeuralClimate = typeof NEURAL_CLIMATES[number];
/** The neural chain delivers one 40 × 40 km surface, cropped or scaled to the map. */
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
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && ['8792', '8793'].includes(url.port) && url.pathname === '/' && !url.search && !url.hash
      && !url.username && !url.password) return fallback;
  } catch { /* Fetch reports an invalid custom address. */ }
  return server;
}
/** Sketch climate (`crates/neural/src/sketch.rs`): T °C at sea level, σT °C × 100, rain mm, rain CV %. */
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
/** Procedural erosion settings, in `EROSION_TUNING` order (`crates/core/src/erosion.rs`). */
export const EROSION_SETTINGS = [
  'iterations', 'incision', 'incisionSlope', 'fill', 'carve', 'finalCarve', 'talus', 'thermal', 'diffusion', 'detail', 'warp',
  'surfaceIterations', 'surfaceIncision', 'surfaceCarve', 'surfaceRouted', 'surfaceThermal', 'surfaceDiffusion',
] as const;
export type ErosionSetting = typeof EROSION_SETTINGS[number];
/** Overrides of the procedural erosion; a missing setting keeps the relief default. */
export type ErosionTuning = Partial<Record<ErosionSetting, number>>;
export interface TerrainSettings {
  zones?: TerrainZones;
  seed: string; width: number; motifSize: number; relief: TerrainRelief; environment?: TerrainEnvironment; coastMask?: number; islandMode?: IslandMode; erosion: number; mountainMix: number; resolution: number;
  compute?: TerrainCompute; generationCompute?: 'cpu' | 'gpu' | 'gpu-all' | 'gpu-erosion' | 'native'; hydrology?: HydrologySettings; source?: TerrainSource; climate?: NeuralClimate;
  /** V2 climate zone: shapes erosion, cover and rendering; `climate`/`climateValues` carry its legacy name and values. */
  climateZone?: ClimateZone; fidelity?: number; neuralServer?: string; sketch?: TerrainSketch;
  /** Absolute runtime URL supplied by the page; inline worker URLs are blob URLs. */
  neuralAssets?: string;
  /** Climate values (preset or custom): neural sketch and water budget. */
  climateValues?: ClimateValues;
  neuralTuning?: NeuralTuning;
  /** Selectable Python checkpoints; browser inference retains its pinned profile. */
  coarseModel?: string; baseModel?: string; decoderModel?: string;
  /** Neural surface on the map: a window of its size (crop) or the whole 40 km stretched (scale, heights too with `neuralSlopes`). */
  neuralFit?: 'crop' | 'scale'; neuralSlopes?: boolean;
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
export interface NeuralInfo { totalMs: number; coarseMs: number; baseMs: number; decoderMs: number; reconstructionMs: number; requestMs: number; evaluations: [number, number, number]; profile: string; land: number; backend?: string; precision?: string; modelIdentity?: string; neuralToken?: string; neuralSeed?: string }
export interface TerrainRegion { x: number; y: number; extent: number; resolution: number }
export interface TerrainData {
  /** Display-only source material coordinates, independent of generation. */
  waterSurface?: import('../../web/src/render/terrainWater').WaterSurface;
  x: number; y: number; width: number; resolution: number; minHeight: number; maxHeight: number;
  globalMinHeight: number; globalMaxHeight: number; motifSize: number;
  height: Float32Array; caveMask: Uint8Array;
  normalX: Float32Array; normalY: Float32Array; normalZ: Float32Array; generationMs: number;
  backend?: TerrainCompute | 'native'; backendReason?: string; prepareMs?: number; samplingMs?: number; gpuSetupMs?: number;
  generationBackend?: 'cpu' | 'native' | 'gpu-noise-f32' | 'gpu-noise-all-f32' | 'gpu-erosion-f32' | 'compact-gpu-f32' | 'compact-cpu' | 'neural'; generationReason?: string; noiseMs?: number; erosionMs?: number; gpuSimulationMs?: number; nativeEnvironmentMs?: number;
  erosionProfile?: ErosionProfile[];
  coastBackend?: 'cpu' | 'gpu-f32'; coastMs?: number; coastReason?: string;
  hydrology?: HydrologyData;
  hydrologySurfaceMs?: number;
  hydrologyError?: string;
  /** Procedural overviews: the relief's own erosion settings, in `EROSION_SETTINGS` order. */
  erosionDefaults?: number[];
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
  inspection?: { step: boolean; until?: import('./terrainGenerationRecipe').GenerationStage; previews: boolean };
  runtime?: ExecutionRuntime;
  id: number; generation: number; kind: 'overview' | 'detail'; settings: TerrainSettings; region: TerrainRegion; scene?: { style: TerrainStyle; waterStyle?: TerrainStyle; showContours: boolean; lighting?: TerrainLighting; layers?: TerrainLayers };
  /** `gl`: the page refines and shades on the GPU; replies carry raw heights and, for overviews, the display field. */
  display?: 'svg' | 'gl';
  /** Retain the physical B-spline field for saved V2 worlds independently of the current renderer. */
  retainField?: boolean;
}
export type TerrainPipelineCommand = {kind:'pipeline';generation:number;command:'next'|'all'|'cancel'};
export type TerrainResponse = Pick<TerrainRequest, 'id' | 'generation' | 'kind'> & ({ terrain: TerrainData; scene?: TerrainScene; scenePreparationMs?: number; /** Relief only; the full reply follows. */ partial?: boolean } | { error: string } | { progress: string } | {stage:import('./terrainGenerationRecipe').GenerationStageInfo;preview?:TerrainData});

let ready: Promise<unknown> | undefined;
let engine: TerrainEngine | undefined, engineKey = '';
let engineRetainedCoasts=false;
let engineCoastKey = '';
let coastBackend: TerrainData['coastBackend'], coastReason: string | undefined;
let sampler: GpuTerrainSampler | undefined, samplerMode: TerrainCompute | undefined;
let generationBackend: TerrainData['generationBackend'] = 'cpu', generationReason: string | undefined;
let queue: Promise<unknown> = Promise.resolve();
let preparedHydrology: PreparedHydrology | undefined, hydrologyKey = '', hydrologyVectorKey = '';
let hydrology: HydrologyData | undefined;
let neuralInfo: NeuralInfo | undefined;
let retainedPythonServer = '';
async function releasePythonNeural(): Promise<void> {
  if (!retainedPythonServer) return;
  const server = retainedPythonServer; retainedPythonServer = '';
  try { await fetch(`${server}/release`, { method: 'POST' }); } catch { /* An exited service has already released its GPU. */ }
}
let hydrologyFailure: { key: string; message: string } | undefined;
let conditioned: { key: string; n: number; height: Float32Array; delta?: Float32Array; m: number; stats?: Omit<ConditioningResult, 'height' | 'delta' | 'hydrology'>; drainage?: ConditioningResult['hydrology'] } | undefined;
let vectorWater: { key: string; water: VectorWater } | undefined;
const postCheckpoints = new TerrainFieldCheckpoints();
/** A project replacement releases session-local outputs, independently of WASM loading. */
export function releaseTerrainCheckpoints(): void {
  releaseCpuCheckpoints();releaseGpuTerrainCheckpoints();postCheckpoints.clear();
  sampler?.dispose();sampler=undefined;samplerMode=undefined;
  engine?.free();engine=undefined;engineKey='';engineCoastKey='';engineRetainedCoasts=false;
  preparedHydrology?.dispose();preparedHydrology=undefined;conditioned=undefined;vectorWater=undefined;
  hydrology=undefined;hydrologyKey='';hydrologyVectorKey='';hydrologyFailure=undefined;
}

/** Heights of the local Rust neural service: `1024²` FP32 metres over 40 km, sea at zero. */
async function fetchNeuralRelief(settings: TerrainSettings, coastMask: number, islandMode: IslandMode, progress?: (text: string) => void): Promise<{ heights: Float32Array; info: NeuralInfo }> {
  const server = neuralServerForSource(settings.source, settings.neuralServer);
  // The browser neural engine is a pinned build without the peninsula sketch (infinite_map/native/neural-earth).
  if (settings.source === 'neural-wasm' && islandMode === 'peninsula') { progress?.('Presqu’île indisponible dans le neuronal navigateur : île unique.'); islandMode = 'island'; }
  const params = new URLSearchParams({
    seed: settings.seed, relief: settings.relief, mix: String(settings.relief === 'mixed' ? settings.mountainMix : 0.5),
    coasts: String(coastMask), islands: islandMode, climate: settings.climate ?? 'temperate', noise: String(settings.fidelity ?? 0.05),
  });
  const climate = climateOf(settings), tuning = settings.neuralTuning ?? DEFAULT_NEURAL_TUNING;
  for (const [key, value] of Object.entries(climate)) params.set(key, String(value));
  params.set('landScale', String(tuning.landScale)); params.set('steps', String(tuning.steps)); params.set('detail', String(tuning.detail));
  for (const key of ['coarseModel', 'baseModel', 'decoderModel'] as const) if (settings[key]) params.set(key, settings[key]!);
  for (const key of ['noiseTemperature', 'noiseTemperatureStd', 'noisePrecipitation', 'noisePrecipitationCv'] as const) params.set(key, String(tuning[key]));
  params.set('histogram', tuning.histogram.join(','));
  const familyRelief = NEURAL_RELIEF_DEFAULTS[settings.relief];
  if (tuning.reliefMode === 'fixed') params.set('reliefFixed', String(tuning.reliefFixed));
  else if (tuning.reliefMode === 'auto' && familyRelief !== undefined) params.set('reliefFixed', String(familyRelief));
  else params.set('reliefScale', String(tuning.reliefMode === 'scale' ? tuning.reliefScale : 1));
  const window = neuralWindow(NEURAL_EXTENT, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, coastMask);
  const sketch = settings.zones ? { zones: parseTerrainZones(settings.zones), region: { x: window.x, y: window.y, width: window.width } }
    : settings.sketch ? neuralSketchInput(parseTerrainSketch(settings.sketch), window) : undefined;
  const started = performance.now();
  if (settings.source === 'neural-wasm') {
    await releasePythonNeural();
    if (!settings.neuralAssets) throw new Error('Neural browser runtime URL missing.');
    const result = await browserNeural(settings.neuralAssets, params, sketch, progress);
    if (result.heights.length !== 1024 * 1024 || result.heights.some(v => !Number.isFinite(v))) throw new Error('Invalid WASM neural surface.');
    return { heights: result.heights, info: { ...result.meta, requestMs: performance.now() - started } };
  }
  await releaseNeuralBrowser();
  let body: unknown = sketch;
  if (settings.source === 'neural-python') {
    if (settings.zones) {
      const capability = await fetch(`${server}/status`, { cache: 'no-store' }).then(response => response.json()) as { zoneConditioning?: number };
      if (capability.zoneConditioning !== 1) throw new Error('Le service Python ouvert précède les masques de zones. Relancez start-terrainbench.bat ou npm run neural:python, puis régénérez.');
    }
    if (!settings.neuralAssets) throw new Error('Neural conditioning runtime URL missing.');
    const module = await neuralModule(settings.neuralAssets);
    const input = Object.fromEntries(params);
    body = { params: input, conditioning: JSON.parse(module.conditioning_json(JSON.stringify(input), sketch ? JSON.stringify(sketch) : '')), edited: !!sketch };
    progress?.('Neuronal Python · calcul PyTorch/CUDA');
  }
  let response: Response;
  try { response = await fetch(`${server}/generate?${params}`, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error(`Neural service unreachable (${server}): run “npm run ${settings.source === 'neural-python' ? 'neural:python' : 'neural:serve'}” from web/`); }
  if (!response.ok) throw new Error(`Neural service: ${await response.text()}`);
  const heights = new Float32Array(await response.arrayBuffer());
  const meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}');
  if (settings.source === 'neural-python') retainedPythonServer = server;
  if (sketch && (meta.edited !== true || ((sketch.region.x !== 0 || sketch.region.y !== 0 || sketch.region.width !== NEURAL_EXTENT) && meta.sketchRegion !== true))) throw new Error('Outdated neural service: restart “npm run neural:serve” to apply the edited sketch.');
  if (heights.length !== 1024 * 1024 || heights.some(v => !Number.isFinite(v))) throw new Error('Neural service: incomplete or invalid surface');
  return { heights, info: { ...meta, requestMs: performance.now() - started } as NeuralInfo };
}

function loadRuntime(progress?: TerrainProgressCallback): Promise<unknown> {
  return ready ??= (async () => {
    // Isolated worker with ?threads=auto|on: shared-memory package and rayon pool.
    if(wantsWasmThreads()){progress?.('Chargement du moteur Rust/WASM (threads)…',{stage:'runtime-download'});await loadCoreWasm();progress?.('Moteur Rust/WASM prêt',{stage:'runtime-ready'});}
    else await adoptSingleWasm(()=>loadTerrainRuntime(wasmUrl,module=>init({module_or_path:module}),progress));
    // The water chain's floods run compiled from now on (same results).
    setFloodKernel(flood_hydrology);
    // Its stream-power pre-erosion too, in one call (same results).
    if (typeof erode_relief === 'function') setErodeKernel(erode_relief);
  })();
}
/** Start loading the Rust/WASM runtime (and its thread pool) before the first request needs it. */
export function prewarmTerrainRuntime(): void {
  loadRuntime().catch(() => { ready = undefined; });
}
/**
 * `onRelief`: GPU overviews whose waters must be computed first receive the
 * sampled relief at once (no water, no conditioning), then the full reply.
 */
// A terminated threads instance (wasmRuntime.recoverCoreWasm): its objects can
// neither be used nor freed; the next request rebuilds them on the single package.
onCoreWasmReset(() => {
  postCheckpoints.clear();
  ready = undefined; engine = undefined; engineKey = ''; engineCoastKey = ''; engineRetainedCoasts = false;
  preparedHydrology = undefined; hydrology = undefined; hydrologyKey = ''; hydrologyVectorKey = ''; hydrologyFailure = undefined;
  conditioned = undefined; vectorWater = undefined;
});
export function sampleRustTerrain(request: TerrainRequest, onRelief?: (relief: TerrainData) => void, progress?: TerrainProgressCallback, lab?: GenerationControl): Promise<TerrainData> {
  // Retried once when the failure terminated the threads instance.
  const result = queue.then(() => sampleTerrain(request, onRelief, progress, lab).catch(async error => {
    if (!await recoverCoreWasm(error)) throw error;
    progress?.('Rust/WASM threads interrompu : reprise sur le moteur mono-thread…', { stage: 'runtime-download' });
    return sampleTerrain(request, onRelief, progress, lab);
  }));
  queue = result.catch(() => undefined);
  return result;
}
async function sampleTerrain(request: TerrainRequest, onRelief?: (relief: TerrainData) => void, progress?: TerrainProgressCallback, lab?: GenerationControl): Promise<TerrainData> {
  const { settings, region, kind, display, runtime } = request;
  validateProceduralRecipe(settings.procedural);
  if(settings.procedural&&['plateau','volcano','caldera','cavern'].includes(settings.relief))throw new Error('La recette décomposée couvre les reliefs régionaux ; les formes finies et les cavernes gardent leur générateur normal.');
  if(lab)await lab.before('prepare');
  if(settings.procedural?.erosionTuning)settings.erosionTuning={...settings.erosionTuning,...settings.procedural.erosionTuning};
  const mode = settings.compute === 'wasm' ? 'wasm' : 'gpu-f32';
  const generationMode = settings.generationCompute ?? 'gpu-erosion';
  const compact = isCompactProcedural(settings);
  // CPU terrain execution keeps the water on the CPU too: the Rust drainage takes tens of ms at 512²,
  // while a WebGPU adapter request can stall for seconds (no adapter, busy GPU process).
  const hydrologyCompute: HydrologySettings['compute'] = settings.hydrology?.compute === 'auto' && (mode === 'wasm' || generationMode === 'cpu') ? 'cpu' : settings.hydrology?.compute ?? 'auto';
  // Otherwise ask for the adapter now, so its latency overlaps the relief generation.
  if (hydrologyCompute !== 'cpu' && settings.hydrology?.enabled && settings.hydrology.engine === 'rust') void gpuContext();
  if (compact && !settings.zones && !settings.sketch?.processing && (!(COMPACT_RELIEFS as readonly string[]).includes(settings.relief) || settings.sketch)) throw new Error('Procédural Phasor : choisir un relief de plaine, collines, vallée, canyon ou montagnes.');
  const nativeGeneration = generationMode === 'native' && !isNeuralSource(settings.source);
  if (nativeGeneration && runtime?.profile !== 'local') throw new Error('Le moteur natif nécessite le profil Local et son service Rust.');
  if (nativeGeneration && settings.relief === 'cavern') return sampleNativeTerrain(request);
  const environment = (GEOLOGICAL_RELIEFS as readonly string[]).includes(settings.relief) ? settings.environment ?? 'mixed' : 'mixed';
  const surfaceInput = settings.sketch?.processing;
  const coastMask = !stageEnabled(settings,'coasts') ? 0 : settings.relief === 'cavern' || surfaceInput ? 0 : settings.coastMask ?? 0;
  const islandMode = settings.islandMode ?? 'island';
  const supported = GPU_RELIEFS.includes(settings.relief);
  const gpu = mode !== 'wasm' && supported ? prepareGpu(mode, settings.relief).catch(() => undefined) : undefined;
  // Vite embeds this asset in the standalone HTML (and in the inline worker).
  if(ready)progress?.('Réutilisation du moteur Rust/WASM chargé',{stage:'runtime-ready'});
  try{await loadRuntime(progress);}catch(error){ready=undefined;throw error;}
  const started = performance.now();
  if(gpu)progress?.('Connexion au périphérique WebGPU…',{stage:'gpu-device'});
  const readyGpu = gpu ? await gpuSetupDeadline(gpu) : undefined;
  if(lab)await lab.after('prepare');
  const finishSource = async (input:Float32Array,cpuDetail=false):Promise<Float32Array> => {
    let height=cpuDetail && stageEnabled(settings,'phasor',false) ? applyPhasorCpu(input,settings) : input;const p=posteriorSettings(settings),w=windSettings(settings);
    const signatures=proceduralSignatures(settings);
    for(const stage of ['posterior','wind'] as const){
      const fieldKey=JSON.stringify([signatures.get(stage),runtime?.server,!!readyGpu,fingerprintBytes(new Uint8Array(height.buffer,height.byteOffset,height.byteLength))]);
      const saved=settings.procedural?postCheckpoints.get(stage,fieldKey):undefined;
      if(saved){height=saved;if(lab?.cached)await lab.cached(stage,lab.previews===false?undefined:height);else{await lab?.before(stage);await lab?.after(stage,lab.previews===false?undefined:height);}continue;}
      await lab?.before(stage);
      if(stage==='posterior'&&settings.procedural&&stageEnabled(settings,stage)&&p.mode!=='none'){
        const previous=height;height=conditionRelief(height,1024,settings.width,p).height;
        for(let i=0;i<height.length;i++)height[i]=previous[i]>0?Math.max(.3,height[i]):height[i];
      }
      if(stage==='wind'&&settings.procedural&&stageEnabled(settings,stage)&&w.iterations&&w.transport)height=readyGpu?await erodeWindGpu(readyGpu.context,height,settings.width,w):erodeWindCpu(height,settings.width,w);
      if(settings.procedural)postCheckpoints.put(stage,fieldKey,height);
      await lab?.after(stage,lab.previews===false?undefined:height);
    }
    // The geographic sampler expects a positive inland source. A cut placed
    // after normalization may still be signed: keep its land deformation and
    // let coastal finishing restore the selected sea, as for earlier cuts.
    return settings.procedural&&height.some(h=>h<.3)?height.map(h=>Math.max(.3,h)):height;
  };
  // Handle compilation failure immediately while preparation runs synchronously.
  const pipelineReady = readyGpu?gpuSetupDeadline(readyGpu.pipeline).then(pipeline=>({pipeline}),()=>undefined):undefined;
  const requestedGpuGeneration = !nativeGeneration && !settings.zones && !settings.sketch && generationMode !== 'cpu' && mode !== 'wasm' && GPU_GENERATION_RELIEFS.includes(settings.relief);
  const gpuGeneration = requestedGpuGeneration && !!readyGpu;
  const cpuPipeline = !!(settings.procedural||lab) && !settings.sketch && !settings.zones && ['hills','valley','mountains','mixed','high-mountains','canyon'].includes(settings.relief) && !isNeuralSource(settings.source) && (!gpuGeneration || generationMode!=='gpu-erosion');
  // Device loss affects sampling; it must not replace an already prepared landscape.
  const neural = !surfaceInput && isNeuralSource(settings.source);
  if (!neural) { await releaseNeuralBrowser(); await releasePythonNeural(); }
  const key = JSON.stringify([settings.zones, nativeGeneration ? [runtime!.server, coastMask, islandMode] : null]) + '|' + (neural
    ? JSON.stringify([settings.source, settings.seed, settings.relief, settings.relief === 'mixed' ? settings.mountainMix : 0.5, coastMask, coastMask === 255 ? islandMode : 'island', climateOf(settings), settings.fidelity ?? 0.05, settings.neuralServer ?? '', settings.sketch, settings.neuralTuning ?? DEFAULT_NEURAL_TUNING, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, settings.coarseModel, settings.baseModel, settings.decoderModel])
    : JSON.stringify([settings.seed, settings.width, settings.relief, settings.relief === 'cavern' ? 0 : settings.erosion, settings.motifSize, settings.relief === 'mixed' ? settings.mountainMix : 0.5, nativeGeneration ? 'native' : compact ? [generationMode,mode,!!readyGpu] : requestedGpuGeneration ? generationMode : 'cpu', environment, settings.sketch, settings.erosionTuning ?? {}, ...(settings.procedural ? [PROCEDURAL_RECIPE_VERSION,settings.procedural,settings.climate,settings.climateValues,settings.climateZone,!gpuGeneration?[coastMask,islandMode]:null] : []), ...(compact || settings.procedural?.enabled?.phasor ? [COMPACT_VERSION, settings.climate ?? 'temperate', settings.phasor ?? {}] : [])]));
  let prepareMs = 0, noiseMs = 0, erosionMs = 0, gpuSimulationMs = 0, nativeEnvironmentMs = 0;
  let erosionProfile: ErosionProfile[] | undefined;
  if (lab&&lab.previews!==false || !engine || engineKey !== key) {
    sampler?.dispose(); sampler = undefined; samplerMode = undefined;
    engine?.free(); engine = undefined; engineRetainedCoasts=false; engineKey = ''; engineCoastKey = '';
    const prepareStarted = performance.now();
    generationBackend = 'cpu'; generationReason = undefined;
    const mix = settings.relief === 'mixed' ? settings.mountainMix : 0.5;
    neuralInfo = undefined;
    // Read by the CPU engine and the GPU erosion plan built below, and by later coasts.
    set_erosion_tuning(Float64Array.from(EROSION_SETTINGS,name=>{
      let value=compact&&!settings.procedural?NaN:settings.procedural?.erosionTuning?.[name]??settings.erosionTuning?.[name]??NaN;
      if(settings.procedural?.biome&&!gpuGeneration&&!cpuPipeline&&(name==='incision'||name==='thermal'))value=(Number.isFinite(value)?value:1)*(name==='incision'?erosionBiome(settings).water:erosionBiome(settings).thermal);
      return value;
    }));
    if(cpuPipeline){
      progress?.(nativeGeneration?'Rust natif · pipeline procédural…':'Rust CPU/WASM · pipeline procédural…',{stage:'terrain-generation'});
      const source=await finishSource(await generateCpuTerrain(settings,lab,nativeGeneration?runtime:undefined,gpuGeneration&&readyGpu?()=>generateGpuNoise(readyGpu.context,settings,progress):undefined));
      if(lab)await lab.before('retain');
      engine=TerrainEngine.with_source(settings.seed,settings.width,settings.relief,settings.erosion,settings.motifSize,mix,source,environment);
      if(lab)await lab.after('retain',lab.previews===false?undefined:source);
      generationBackend=nativeGeneration?'native':gpuGeneration?(generationMode==='gpu-all'?'gpu-noise-all-f32':'gpu-noise-f32'):compact?'compact-cpu':'cpu';
      generationReason=`Pipeline procédural Rust ${nativeGeneration?'natif':'WASM'} · étapes partagées avec la génération globale.`;
    } else if (nativeGeneration) {
      progress?.('Rust natif · génération du relief et érosion…',{stage:'terrain-generation',detail:'Service Rust local · calcul du champ physique 1024 × 1024'});
      const nativeSettings = settings.procedural?.biome ? { ...settings, coastMask, erosionTuning: { ...settings.erosionTuning, incision: (settings.erosionTuning?.incision ?? 1) * erosionBiome(settings).water, thermal: (settings.erosionTuning?.thermal ?? 1) * erosionBiome(settings).thermal } } : settings;
      const result = await prepareNativeTerrain(nativeSettings.sketch && !surfaceInput ? { ...nativeSettings, sketch: undefined } : nativeSettings, runtime!);
      engine = TerrainEngine.with_surface(settings.seed, settings.width, settings.procedural?await finishSource(result.height,true):result.height);
      generationBackend = 'native';
      generationReason = 'Relief et côtes calculés par le service Rust natif ; surface conservée pour le rendu GPU et l’eau.';
      nativeEnvironmentMs = result.prepareMs;
    } else if (surfaceInput) {
      progress?.('Préparation des altitudes de la heightmap…',{stage:'terrain-import'});
      const height = heightmapSurface(parseTerrainSketch(settings.sketch));
      if (surfaceInput === 'erosion') {
        progress?.('CPU · érosion de la heightmap importée…',{stage:'terrain-generation'});
        engine = new TerrainEngine(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment);
        engine.set_edited_surface(height);
      } else engine = TerrainEngine.with_surface(settings.seed, settings.width, height);
      generationReason = surfaceInput === 'erosion' ? 'Heightmap éditée → érosion Rust, sans nouvelle génération.' : 'Heightmap éditée conservée, sans génération ni érosion.';
    } else if (neural) {
      // The coasts belong to the neural sketch; the engine retains the surface as is.
      const result = await fetchNeuralRelief(settings, coastMask, islandMode, progress);
      const surface = fitNeuralSurface(result.heights, NEURAL_EXTENT, settings.width, settings.neuralFit ?? 'crop', settings.neuralSlopes ?? true, coastMask);
      engine = settings.zones
        ? TerrainEngine.with_zoned_surface(settings.seed, settings.width, settings.motifSize, surface, JSON.stringify(settings.zones))
        : TerrainEngine.with_surface(settings.seed, settings.width, surface);
      neuralInfo = result.info;
      generationBackend = 'neural';
      if (settings.zones) generationReason = 'Zones → conditionnement régional et relief local neuronal, puis opération mer.';
    } else if (compact && !settings.zones) {
      if (readyGpu && mode !== 'wasm' && generationMode !== 'cpu') {
        progress?.('GPU · relief compact, érosion régionale et Phasor…',{stage:'terrain-generation'});
        const timing = { nativeEnvironmentMs: 0, profiles: [] as ErosionProfile[], control: lab };
        const source = await finishSource(await generateGpuTerrain(readyGpu.context, settings, timing, progress));
        if(lab)await lab.before('retain');
        erosionProfile = timing.profiles;
        // Retain the ordinary geographic sampler: it also shapes valleys and cuts coasts.
        engine = TerrainEngine.with_source(settings.seed, settings.width, settings.relief === 'flat' ? 'hills' : settings.relief, settings.erosion, settings.motifSize, mix, source, environment);
        if(lab)await lab.after('retain',source);
        generationBackend = 'compact-gpu-f32';
        generationReason = `${COMPACT_VERSION} · préréglage compact · grille ${settings.procedural?.regionalN??compactBudget(settings).n}² · ${settings.climate??'temperate'} · Phasor ${stageEnabled(settings,'phasor',true)?'actif':'désactivé'}.`;
      } else {
        progress?.('CPU · érosion régionale et Phasor…',{stage:'terrain-generation'});
        const b=settings.procedural?.biome?erosionBiome(settings):undefined;
        const profile = b?{incision:b.water,thermal:b.thermal}:settings.procedural?{incision:1,thermal:1}:compactProfile(settings), iterations = settings.procedural?.erosionTuning?.iterations??compactBudget(settings).steps;
        const manual=settings.erosionTuning??{};
        const tuning: ErosionTuning = { ...manual, iterations, surfaceIterations: stageEnabled(settings,'surface',false)?manual.surfaceIterations??12:0, detail: stageEnabled(settings,'ridged',false)?manual.detail:0, warp: manual.warp??0, incision: (manual.incision??1)*profile.incision, thermal: (manual.thermal??1)*profile.thermal };
        set_erosion_tuning(Float64Array.from(EROSION_SETTINGS, name => tuning[name] ?? NaN));
        let reference: TerrainEngine | undefined;
        try {
          reference = new TerrainEngine(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment);
          const sampled = reference.sample_region(0, 0, settings.width, 1024);
          try { engine = TerrainEngine.with_source(settings.seed, settings.width, 'hills', settings.erosion, settings.motifSize, mix, (stageEnabled(settings,'phasor',true)?applyPhasorCpu(sampled.height, settings):sampled.height), environment); }
          finally { sampled.free(); }
        } finally { reference?.free(); set_erosion_tuning(new Float64Array(EROSION_SETTINGS.length).fill(NaN)); }
        generationBackend = 'compact-cpu';
        generationReason = `${COMPACT_VERSION} · Rust CPU + Phasor scalaire · ${settings.climate ?? 'temperate'} ; topographie indépendante du GPU.`;
      }
    } else if (settings.zones) {
      progress?.('CPU · relief et érosion des zones peintes…',{stage:'terrain-generation',detail:'Rust/WASM · champ physique 1024 × 1024'});
      engine = TerrainEngine.with_zones(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment, JSON.stringify(parseTerrainZones(settings.zones)));
      generationReason = 'Masques de zones → soulèvement, bruits, crêtes et érosion Rust.';
    } else if (gpuGeneration && readyGpu) {
      try {
        if (generationMode === 'gpu-erosion' || settings.relief === 'volcano' || settings.relief === 'caldera' || settings.relief === 'plateau' || settings.relief === 'canyon') {
          const timing = { nativeEnvironmentMs: 0, profiles: [] as ErosionProfile[], control: lab };
          const source = await finishSource(await generateGpuTerrain(readyGpu.context, settings, timing, progress));
          if(lab)await lab.before('retain');
          nativeEnvironmentMs = timing.nativeEnvironmentMs;
          erosionProfile = timing.profiles;
          gpuSimulationMs = performance.now() - prepareStarted - nativeEnvironmentMs;
          engine = TerrainEngine.with_source(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, source, environment);
          if(lab)await lab.after('retain',source);
          generationBackend = 'gpu-erosion-f32';
        } else {
          const noise = await generateGpuNoise(readyGpu.context, settings, progress);
          noiseMs = performance.now() - prepareStarted;
          const erosionStarted = performance.now();
          progress?.('CPU · érosion à partir des bruits GPU…',{stage:'terrain-generation'});
          engine = TerrainEngine.with_generation_noise(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, noise.coarse, noise.fine, environment);
          erosionMs = performance.now() - erosionStarted;
          generationBackend = generationMode === 'gpu-all' ? 'gpu-noise-all-f32' : 'gpu-noise-f32';
        }
      } catch (error) {
        if(lab||settings.procedural)throw error;
        generationReason = `GPU generation unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (!engine){progress?.(settings.relief==='cavern'?'CPU · génération des cavernes…':'CPU · génération du relief et érosion…',{stage:'terrain-generation',detail:'Rust/WASM · calcul de la surface procédurale'});engine = new TerrainEngine(settings.seed, settings.width, settings.relief, settings.erosion, settings.motifSize, mix, environment);}
    if (!surfaceInput && !neural && settings.sketch && settings.relief !== 'cavern') {
      const sketch = parseTerrainSketch(settings.sketch);
      const sample = engine.sample_region(0, 0, settings.width, 1024);
      try { engine.set_edited_surface(refineSketch(sketch, sample.height, 1024)); }
      finally { sample.free(); }
      generationReason = 'Edited sketch + procedural detail and Rust erosion.';
    }
    const posterior=posteriorSettings(settings),wind=windSettings(settings);
    const hasCpuPost=stageEnabled(settings,'posterior')&&posterior.mode!=='none'||stageEnabled(settings,'wind')&&wind.iterations>0&&wind.transport>0;
    if(!cpuPipeline&&settings.procedural&&(hasCpuPost||!compact&&stageEnabled(settings,'phasor',false))&&!['gpu-erosion-f32','compact-gpu-f32'].includes(generationBackend)&&!neural&&!surfaceInput&&!nativeGeneration&&!settings.zones){
      engine!.set_coast(coastMask,islandMode);
      const sampled=engine!.sample_region(0,0,settings.width,1024);
      try{const height=await finishSource(sampled.height,!compact);engine!.free();engine=TerrainEngine.with_surface(settings.seed,settings.width,height);engineRetainedCoasts=true;}
      finally{sampled.free();}
    }
    prepareMs = performance.now() - prepareStarted;
    engineKey = key;
  }else {
    progress?.('Réutilisation du relief déjà calculé',{stage:'terrain-generation'});
    if(lab?.cached&&settings.procedural&&['hills','valley','mountains','mixed','high-mountains','canyon'].includes(settings.relief)){
      for(const stage of ['grids',...coreOperations(settings),'phasor','posterior','wind'] as const)await lab.cached(stage);
    }
  }
  const coastCheckpointKey=JSON.stringify([proceduralSignatures(settings).get('coasts'),generationBackend,runtime?.server]);
  const savedCoast=settings.procedural&&coastMask&&!neural&&!engineRetainedCoasts?postCheckpoints.get('coasts',coastCheckpointKey):undefined;
  if(!savedCoast&&lab)await lab.before('coasts');
  // Reuse the underlying relief, then cut the coast before its physical erosion.
  const gpuCoast = !settings.zones && !settings.sketch && coastMask !== 0 && generationMode !== 'cpu' && mode !== 'wasm';
  const coastKey = neural ? 'neural' : JSON.stringify([coastMask, coastMask === 255 ? islandMode : 'island', coastMask ? gpuCoast : false]);
  let coastMs = 0;
  if (neural || nativeGeneration&&!cpuPipeline || engineRetainedCoasts) {
    engineCoastKey = coastKey; coastBackend = engineRetainedCoasts&&coastMask?'cpu':undefined; coastReason = undefined;
  } else if (engineCoastKey !== coastKey) {
    sampler?.dispose(); sampler = undefined; samplerMode = undefined;
    coastBackend = undefined; coastReason = undefined;
    const coastStarted = performance.now();
    progress?.('Découpe des côtes et des îles…',{stage:'terrain-coast'});
    if(savedCoast){engine.configure_coast(coastMask,islandMode);engine.set_coast_surface(savedCoast);coastBackend='cpu';}
    if (!savedCoast && gpuCoast && readyGpu) {
      let coastSampler: GpuTerrainSampler | undefined;
      try {
        const compiled = await pipelineReady;
        if (!compiled || readyGpu.context.lost) throw new Error('WebGPU indisponible');
        engine.configure_coast(coastMask, islandMode);
        coastSampler = new GpuTerrainSampler(readyGpu.context, compiled.pipeline, mode, engine);
        const source = coastSampler.prepareCoastField(settings);
        const height = await erodeGpuCoast(readyGpu.context, settings, source, engine.coast_erosion_parameters(),progress);
        engine.set_coast_surface(height);
        coastBackend = 'gpu-f32';
      } catch (error) {
        coastReason = `Littoral GPU indisponible : ${error instanceof Error ? error.message : String(error)}`;
      } finally { coastSampler?.dispose(); }
    }
    if (!coastBackend) {
      const recipe=settings.procedural,tuning={...settings.erosionTuning,...recipe?.erosionTuning};
      if(recipe&&coastMask)set_erosion_tuning(Float64Array.from(EROSION_SETTINGS,name=>name==='surfaceIterations'?recipe.coastIterations??(compact?2:12):name==='surfaceIncision'?(tuning[name]??1)*(recipe.coastIncision??1):name==='surfaceThermal'?(tuning[name]??1)*(recipe.coastThermal??1):name==='surfaceDiffusion'?(tuning[name]??1)*(recipe.coastDiffusion??1):tuning[name]??NaN));
      try{engine.set_coast(coastMask, islandMode);}finally{if(recipe&&coastMask)set_erosion_tuning(Float64Array.from(EROSION_SETTINGS,name=>tuning[name]??NaN));}
      if (coastMask) coastBackend = 'cpu';
      if (gpuCoast && !readyGpu) coastReason = 'WebGPU indisponible';
    }
    engineCoastKey = coastKey;
    coastMs = coastMask ? performance.now() - coastStarted : 0;
    prepareMs += coastMs;
  }
  const coastHeight=coastMask&&settings.procedural?engine!.sampling_field().slice(0,1024*1024):undefined;
  if(coastHeight&&!savedCoast)postCheckpoints.put('coasts',coastCheckpointKey,coastHeight);
  if(savedCoast&&lab?.cached)await lab.cached('coasts',lab.previews===false?undefined:savedCoast);
  else if(lab)await lab.after('coasts',lab.previews===false?undefined:coastHeight);
  async function finish(data: TerrainData): Promise<TerrainData> {
    if(lab)await lab.after('sampling',data.height);
    if(lab)await lab.before('hydrology');
    const config = stageEnabled(settings,'hydrology') ? settings.hydrology : undefined;
    data.neural = neuralInfo;
    if (kind === 'overview' && !neural && settings.relief !== 'cavern') {
      data.erosionDefaults = Array.from(erosion_defaults(settings.relief, settings.width, settings.motifSize, settings.mountainMix));
    }
    const water = !!config?.enabled && settings.relief !== 'cavern', vector = config?.engine !== 'rust';
    const erosionEnabled = config?.erosionEnabled !== false;
    const showErosion = erosionEnabled && config?.showErosion !== false;
    const condMode = erosionEnabled ? config?.condMode : 'none';
    if (onRelief && config && water && kind === 'overview' && display === 'gl') {
      const n = vector ? config.vectorResolution : config.resolution;
      const condKey = JSON.stringify([engineKey, engineCoastKey, n, condMode, condMode === 'none' ? 0 : [config.condStrength, config.condDepth, config.condLength]]);
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
      const condKey = JSON.stringify([engineKey, engineCoastKey, n, condMode, condMode === 'none' ? 0 : [config.condStrength, config.condDepth, config.condLength]]);
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
        if (condMode === 'none') conditioned = { key: condKey, n, height, m: 0 };
        else {
          progress?.('Conditionnement du relief avant drainage…',{stage:'terrain-conditioning'});
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
          progress?.('Hydrologie vectorielle · bilan hydrique, lacs et cours d’eau…',{stage:'terrain-water'});
          vectorWater = { key: waterKey, water: computeVectorWater(conditioned.height, n, settings.width, vs, climate, settings.seed, conditioned.drainage) };
        }
      } else {
        const inputKey = JSON.stringify([condKey, hydrologyCompute]);
        // Display choices never change the network or invalidate a failed calculation.
        const routingConfig: HydrologySettings = { ...config, showErosion: true, erosionEnabled,
          ...(!erosionEnabled ? { incision: 0, depressionPolicy: 'fill', maxBreachDepth: 0, maxBreachLength: 0 } : {}) };
        // A refused neural relief is retried only when the relief or the hydrology settings change.
        const failureKey = `${inputKey}|${JSON.stringify(routingConfig)}`;
        if (neural && hydrologyFailure?.key === failureKey) data.hydrologyError = hydrologyFailure.message;
        else try {
          if (!preparedHydrology || hydrologyKey !== inputKey) {
            progress?.('Hydrologie Rust · préparation du drainage…',{stage:'terrain-drainage'});
            preparedHydrology?.dispose(); preparedHydrology = undefined; hydrology = undefined; hydrologyVectorKey = '';
            preparedHydrology = await PreparedHydrology.create(settings.seed, settings.width, n, conditioned.height.slice(), hydrologyCompute,
              settings.sketch || settings.zones ? engine!.min_height <= 0 : neural ? engine!.min_height < 0 : coastMask !== 0);
            hydrologyKey = inputKey;
          }
          const climate = climateOf(settings);
          const vectorKey = JSON.stringify([routingConfig, climate.temperature, climate.precipitation]);
          if (!hydrology || hydrologyVectorKey !== vectorKey) {
            progress?.('Hydrologie Rust · rivières, lacs et érosion…',{stage:'terrain-water'});
            hydrology = preparedHydrology.generate(routingConfig, climate); hydrologyVectorKey = vectorKey;
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
    progress?.('Application des lits fluviaux et des altitudes finales…',{stage:'terrain-carving'});
    if (water && showErosion && conditioned?.delta) applyDelta(data, conditioned.delta, conditioned.m, settings.width);
    if (water && showErosion && !vector && hydrology && !data.hydrologyError) {
      const surfaceStarted = performance.now();
      applyHydrologySurface(data, hydrology);
      data.hydrologySurfaceMs = performance.now() - surfaceStarted;
    }
    if (settings.refine && display !== 'gl') applyFractalDetail(data, settings.width / 1024, seedHash(settings.seed), settings.detailNoise);
    if (kind === 'overview' && (display === 'gl' || request.retainField)){progress?.('Conservation du champ physique et du réseau d’eau…',{stage:'terrain-retain'});data.field = displayField(data, water, vector);}
    // Intermediate grids stay in the worker cache. Only overview replies clone
    // them for inspection; camera requests carry just their terrain region.
    if (kind === 'overview' && water) {
      if (vector) data.water = vectorWater?.water;
      else if (hydrology && !data.hydrologyError) data.hydrology = hydrology;
      if (conditioned?.delta && conditioned.stats) data.conditioning = { delta: conditioned.delta, n: conditioned.m, stats: conditioned.stats };
    }
    if (kind === 'overview') data.relief = reliefStatistics(data);
    if (settings.zones && data.neural && data.relief) data.neural = { ...data.neural, land: data.relief.land };
    data.generationMs = performance.now() - started;
    if(lab)await lab.after('hydrology',data.height);
    return data;
  }
  /**
   * Regional reliefs and prepared surfaces (neural, coasts, sketches) sample
   * the B-spline of the engine's 1024² raster: the GPU draws that raster
   * exactly. Rust riverbeds modify that full-resolution field; camera regions
   * only refine their narrow cuts, never replace it with a coarser overview.
   */
  function displayField(data: TerrainData, water: boolean, vector: boolean): DisplayField {
    const family = engine!.sampling_parameters()[5];
    const showErosion = settings.hydrology?.erosionEnabled !== false && settings.hydrology?.showErosion !== false;
    if ((family === 1 || family === 4) && settings.relief !== 'cavern') {
      const n = 1024, field = engine!.sampling_field().slice(0, n * n);
      if (water && showErosion && conditioned?.delta) {
        const delta = upsampleDelta(conditioned.delta, conditioned.m, n);
        // Sea stays sea: the conditioning only reshapes land.
        for (let i = 0; i < n * n; i++) field[i] += field[i] <= 0 ? Math.min(0, delta[i]) : delta[i];
      }
      const riverbeds = water && showErosion && !vector && !data.hydrologyError ? hydrology : undefined;
      if (riverbeds) {
        applyHydrologyHeight({ x: 0, y: 0, width: settings.width, resolution: n, height: field,
          minHeight: data.globalMinHeight, maxHeight: data.globalMaxHeight }, riverbeds);
      }
      return { n, data: field, exact: !riverbeds, floor: family === 1 ? 0.3 : 0 };
    }
    return { n: data.resolution, data: data.height.slice(), exact: false, floor: 0, cave: data.caveMask.length ? data.caveMask.slice() : undefined };
  }
  if(lab)await lab.before('sampling',`Borne du moteur ${engine!.max_height.toFixed(2)} m · aperçu ${region.resolution}²`);
  let backendReason: string | undefined;
  let gpuSetupMs = 0;
  let gpuSampled: TerrainData | undefined;
  if (mode !== 'wasm' && supported) {
    progress?.('Préparation des shaders d’échantillonnage WebGPU…',{stage:'gpu-sampling-compile'});
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
        progress?.(`GPU · échantillonnage du relief ${region.resolution} × ${region.resolution}…`,{stage:'terrain-sampling'});
        const data = await sampler.sample(region, settings, engine.min_height, engine.max_height);
        gpuSampled = { ...data, generationMs: performance.now() - started, prepareMs, gpuSetupMs, generationBackend, generationReason, noiseMs, erosionMs, gpuSimulationMs, nativeEnvironmentMs, erosionProfile, coastBackend, coastMs, coastReason };
      }
      if (!gpuSampled) backendReason = 'WebGPU indisponible';
    } catch (error) {
      backendReason = `GPU indisponible : ${error instanceof Error ? error.message : String(error)}`;
      sampler?.dispose(); sampler = undefined; samplerMode = undefined;
    }
  } else if (mode !== 'wasm') backendReason = 'terrain currently sampled in WASM';
  if (gpuSampled) return finish(gpuSampled);
  progress?.(`CPU · échantillonnage du relief ${region.resolution} × ${region.resolution}…`,{stage:'terrain-sampling'});
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
