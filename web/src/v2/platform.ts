/** V2 execution capabilities. A detected GPU is never evidence a stage used it. */
export type ComputePreference = 'auto' | 'cpu' | 'gpu';
import type { ImportedHeight } from '../gen/terrain/import';
import type { NeuralClimate, TerrainRelief, TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import { defaultTerrainSettings, DEFAULT_HYDROLOGY, DEFAULT_NEURAL_TUNING, validateTerrainSettings, type V2TerrainSettings } from './terrainSettings';
import { CLIMATE_VALUES, CLIMATE_ZONE_VALUES } from '../../../rust/bridge/terrainClimate';
import type { ClimateValues } from '../../../rust/bridge/terrainClimate';
/** A zone's values, or a legacy preset's when the name is one of the V1 presets. */
const climatePresetValues = (zone: string | undefined, name: string): ClimateValues => (zone && (CLIMATE_ZONE_VALUES as Record<string, ClimateValues>)[zone]) || (CLIMATE_VALUES as Record<string, ClimateValues>)[name] || (CLIMATE_ZONE_VALUES as Record<string, ClimateValues>)[name] || CLIMATE_ZONE_VALUES.temperate;
import { DEFAULT_FRACTAL_DETAIL } from '../../../rust/bridge/terrainAdjust';
import type { TerrainProgressCallback } from '../../../rust/bridge/terrainProgress';
import { isCompactProcedural, type GenerationControl } from '../../../rust/bridge/terrainGenerationRecipe';
export type PlatformProgress = { phase: 'detecting' | 'loading' | 'ready' | 'unavailable'; message: string; source: 'browser' | 'rust' | 'python' };
export interface PlatformCapabilities {
  cpu: true;
  webgpu: boolean;
  adapterName?: string;
  desktop: boolean;
  local: { available: boolean; server: string; capabilities: string[]; error?: string };
  python: { available: boolean; server: string; backend?: string; loaded: boolean; state?: string; message?: string; error?: string };
}
export interface DetectPlatformOptions {
  profile?: 'web' | 'local';
  localServer?: string;
  pythonServer?: string;
  signal?: AbortSignal;
  onProgress?: (event: PlatformProgress) => void;
}

/** Native services deliberately accept loopback only; a project cannot redirect requests. */
export function loopbackServer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Le moteur local doit utiliser une adresse HTTP loopback (127.0.0.1 ou localhost).');
  }
  return url.origin;
}

export function runtimeOptions(location?: Pick<Location, 'search' | 'hostname'>): DetectPlatformOptions {
  const current = location ?? (typeof window !== 'undefined' ? window.location : undefined);
  const params = new URLSearchParams(current?.search ?? '');
  // A development URL remains a full web app until local is explicitly requested.
  return {
    profile: params.get('profile') === 'local' ? 'local' : 'web',
    localServer: params.get('localServer') ?? 'http://127.0.0.1:8791',
    pythonServer: params.get('pythonServer') ?? 'http://127.0.0.1:8793',
  };
}

async function serviceStatus(server: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(2500);
  const response = await fetch(`${server}/status`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function detectPlatform(options: DetectPlatformOptions = runtimeOptions()): Promise<PlatformCapabilities> {
  const localServer = loopbackServer(options.localServer ?? 'http://127.0.0.1:8791');
  const pythonServer = loopbackServer(options.pythonServer ?? 'http://127.0.0.1:8793');
  const result: PlatformCapabilities = {
    cpu: true, webgpu: false,
    desktop: typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || /(?:^|\.)tauri\.localhost$/.test(window.location.hostname) || window.location.protocol === 'tauri:'),
    local: { available: false, server: localServer, capabilities: [] },
    python: { available: false, server: pythonServer, loaded: false },
  };
  const progress = options.onProgress ?? (() => {});
  const gpu = async () => {
    progress({ phase: 'detecting', source: 'browser', message: 'Vérification du périphérique WebGPU…' });
    let device: GPUDevice | undefined;
    try {
      const adapter = await globalThis.navigator?.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        device = await adapter.requestDevice();
        result.webgpu = true;
        result.adapterName = adapter.info?.description || adapter.info?.device || 'WebGPU';
      }
    } catch { /* The API may exist while adapter/device creation is disabled. */ }
    finally { device?.destroy(); }
    progress({ phase: result.webgpu ? 'ready' : 'unavailable', source: 'browser', message: result.webgpu ? 'WebGPU disponible · CPU toujours disponible' : 'Calcul CPU disponible · WebGPU indisponible' });
  };
  const rust = async () => {
    progress({ phase: 'detecting', source: 'rust', message: 'Connexion au moteur Rust local…' });
    try {
      const status = await serviceStatus(localServer, options.signal);
      if (status.service !== 'magna-urbis-local' || status.backend !== 'rust-native' || !Array.isArray(status.capabilities)) throw new Error('Service Rust Magna Urbis non reconnu');
      result.local.available = true;
      result.local.capabilities = status.capabilities.filter((value): value is string => typeof value === 'string');
      progress({ phase: 'ready', source: 'rust', message: 'Moteur Rust natif connecté' });
    } catch (error) {
      result.local.error = String(error);
      progress({ phase: 'unavailable', source: 'rust', message: 'Moteur Rust local indisponible · le CPU navigateur reste disponible' });
    }
  };
  const python = async () => {
    progress({ phase: 'detecting', source: 'python', message: 'Vérification du service neuronal Python…' });
    try {
      const status = await serviceStatus(pythonServer, options.signal);
      // This service currently requires CUDA. Do not present it as Python/CPU.
      if (status.backend !== 'python-cuda') throw new Error('Service neuronal Python/CUDA non reconnu');
      Object.assign(result.python, { available: true, backend: 'python-cuda', loaded: status.loaded === true,
        state: typeof status.state === 'string' ? status.state : undefined,
        message: typeof status.message === 'string' ? status.message : undefined });
      progress({ phase: status.state === 'loading' ? 'loading' : 'ready', source: 'python',
        message: typeof status.message === 'string' ? status.message : 'Python/CUDA connecté · modèles chargés à la demande' });
    } catch (error) {
      result.python.error = String(error);
      progress({ phase: 'unavailable', source: 'python', message: 'Neuronal Python/CUDA indisponible' });
    }
  };
  await Promise.all([gpu(), ...(options.profile === 'local' ? [rust(), python()] : [])]);
  options.signal?.throwIfAborted();
  return result;
}

/** Selection is explicit. Auto may fall back; a forced GPU request must not silently run CPU. */
export function resolveCompute(requested: ComputePreference, capabilities: Pick<PlatformCapabilities, 'webgpu'>): { compute: 'cpu' | 'gpu'; reason?: string } {
  if (requested === 'cpu') return { compute: 'cpu' };
  if (capabilities.webgpu) return { compute: 'gpu' };
  if (requested === 'gpu') throw new Error('WebGPU indisponible. Choisissez CPU ou Automatique.');
  return { compute: 'cpu', reason: 'WebGPU indisponible · repli CPU' };
}

/** Poll only during a real Python request; model loads remain visible instead of a frozen button. */
export function observePythonStatus(server: string, onProgress: (event: PlatformProgress) => void, signal?: AbortSignal): () => void {
  const origin = loopbackServer(server);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (stopped || signal?.aborted) return;
    try {
      const status = await serviceStatus(origin, signal);
      if (!stopped && status.backend === 'python-cuda') onProgress({ source: 'python', phase: status.state === 'loading' ? 'loading' : 'ready',
        message: typeof status.message === 'string' ? status.message : 'Calcul neuronal Python/CUDA…' });
    } catch { /* A long inference can momentarily delay status; the request owns the error. */ }
    if (!stopped && !signal?.aborted) timer = setTimeout(() => { void poll(); }, 750);
  };
  const stop = () => { stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); };
  signal?.addEventListener('abort', stop, { once: true });
  void poll();
  return stop;
}

/** Native neural weights and GPU-kernel warmup run on a separate service thread. */
export function observeNativeNeuralStatus(server: string, onProgress: (event: PlatformProgress) => void, signal?: AbortSignal): () => void {
  const origin = loopbackServer(server); let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (stopped || signal?.aborted) return;
    try {
      const status = await serviceStatus(origin, signal);
      if (!stopped && typeof status.state === 'string' && typeof status.message === 'string') onProgress({ source: 'rust',
        phase: status.state === 'loading' || status.state === 'warming' ? 'loading' : status.state === 'error' ? 'unavailable' : 'ready', message: status.message });
    } catch { /* The generation request owns endpoint errors; status is informational. */ }
    if (!stopped && !signal?.aborted) timer = setTimeout(() => { void poll(); }, 750);
  };
  const stop = () => { stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); };
  signal?.addEventListener('abort', stop, { once: true }); void poll(); return stop;
}

export interface EngineHeightRequest {
  seed: string; width: number; relief: TerrainRelief;
  coast?: 'none' | 'N' | 'E' | 'S' | 'W' | 'random';
  climate?: NeuralClimate; compute: 'cpu' | 'gpu';
  source: 'procedural' | 'procedural-phasor' | 'neural-wasm' | 'neural-python' | 'neural';
  native?: boolean; localServer?: string; pythonServer?: string; neuralServer?: string; neuralAssets?: string;
  resolution?: number; erosion?: number;
  /** Flat bench parameters, fully merged by the orchestrator; optional for older callers. */
  terrain?: V2TerrainSettings;
}
export interface EngineHeightResult {
  importedHeight: ImportedHeight; heightScale: number; importSeaLevel: number;
  backend: string; generationBackend: string;
  stats: Record<string, string | number>;
  /** Exact overview, water network and physical field retained for rendering/export and project round trips. */
  terrain: TerrainData;
}

/** Run in V2's generation worker: reuse Rust/WASM, WebGPU and Python, retaining metre-valued FP32 input. */
export async function generateEngineHeight(request: EngineHeightRequest, onProgress?: TerrainProgressCallback, signal?: AbortSignal): Promise<EngineHeightResult> {
  signal?.throwIfAborted();
  const usesNeural = !['procedural', 'procedural-phasor'].includes(request.source) && !request.terrain?.sketch?.processing;
  if (request.source === 'procedural-phasor' && request.native) throw new Error('Compact Phasor uses the browser Rust/WebGPU backend. Select Rust browser, with CPU or GPU compute.');
  if (usesNeural && request.compute === 'cpu') throw new Error('Les moteurs neuronaux actuels nécessitent WebGPU ou un service GPU local. Le relief procédural fonctionne sur CPU.');
  if (!Number.isFinite(request.width) || request.width < 500 || request.width > 100000) throw new Error('Étendue moteur Rust invalide (500–100000 m).');
  if (request.terrain) validateTerrainSettings(request.terrain);
  const n = request.terrain?.resolution ?? request.resolution ?? 512;
  if (!Number.isInteger(n) || n < 64 || n > 2048) throw new Error('Résolution moteur invalide (64–2048).');
  const localServer = loopbackServer(request.localServer ?? 'http://127.0.0.1:8791');
  const pythonServer = loopbackServer(request.pythonServer ?? 'http://127.0.0.1:8793');
  const neuralServer = loopbackServer(request.neuralServer ?? 'http://127.0.0.1:8792');
  const neuralAssets = request.neuralAssets ?? (typeof window !== 'undefined' ? new URL('./neural/', window.location.href).href : undefined);
  if (usesNeural && (request.source === 'neural-wasm' || request.source === 'neural-python') && !neuralAssets) throw new Error('Adresse des modèles neuronaux absente.');
  if (usesNeural && (request.source === 'neural-wasm' || request.source === 'neural-python')) {
    onProgress?.('Vérification du runtime neuronal et des modèles disponibles…');
    const files = ['magna_urbis_neural_wasm.js', 'magna_urbis_neural_wasm_bg.wasm', ...(request.source === 'neural-wasm' ? ['models/manifest.json'] : [])];
    try {
      await Promise.all(files.map(async file => {
        const response = await fetch(new URL(file, neuralAssets), { method: 'HEAD', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`${file} : HTTP ${response.status}`);
      }));
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(`Runtime neuronal non préparé ou inaccessible. Depuis web/, lancez npm run prepare:v2 -- --neural (checkout ../infinite_map complet requis), puis reconstruisez la distribution. ${String(error)}`);
    }
  }
  onProgress?.('Chargement du module de génération du terrain…',{stage:'terrain-module'});
  const { sampleRustTerrain } = await import('../../../rust/bridge/terrain');
  signal?.throwIfAborted();
  const coasts = { none: 0, N: 1, E: 4, S: 16, W: 64, random: 255 };
  const custom = request.terrain ?? {}, defaults = defaultTerrainSettings();
  if (usesNeural && request.source !== 'neural-python' && [custom.coarseModel, custom.baseModel, custom.decoderModel].some(Boolean)) throw new Error('Checkpoint selection is available with Python/CUDA. Browser and native Rust neural generation use their installed model profile.');
  const settings: TerrainSettings = {
    ...defaults, ...custom,
    seed: request.seed, width: request.width, motifSize: custom.motifSize ?? 3000, relief: custom.relief ?? request.relief,
    coastMask: custom.coastMask ?? coasts[request.coast ?? 'none'], erosion: custom.erosion ?? request.erosion ?? 1, mountainMix: custom.mountainMix ?? .5, resolution: n,
    compute: custom.compute ?? (request.compute === 'cpu' ? 'wasm' : 'gpu-f32'),
    generationCompute: custom.generationCompute ?? (request.source === 'procedural-phasor' ? request.compute === 'cpu' ? 'cpu' : 'gpu-erosion' : request.native ? 'native' : request.compute === 'gpu' ? 'gpu-erosion' : 'cpu'),
    source: request.source, climate: custom.climate ?? request.climate ?? 'temperate', neuralAssets,
    neuralServer: request.source === 'neural-python' ? pythonServer : request.source === 'neural' ? neuralServer : undefined,
    hydrology: { ...DEFAULT_HYDROLOGY, ...custom.hydrology },
    neuralTuning: { ...DEFAULT_NEURAL_TUNING, ...custom.neuralTuning },
    climateValues: { ...climatePresetValues(custom.climateZone, custom.climate ?? request.climate ?? 'temperate'), ...custom.climateValues },
    detailNoise: { ...DEFAULT_FRACTAL_DETAIL, ...custom.detailNoise },
  } as TerrainSettings;
  // These are forest display controls, not inputs understood by the Rust terrain bridge.
  delete (settings as TerrainSettings & { forest?: unknown }).forest;
  if (settings.generationCompute === 'native' && !request.native) throw new Error('Native generation requires the local Rust backend.');
  if (request.compute === 'cpu' && (settings.compute === 'gpu-f32' || ['gpu', 'gpu-all', 'gpu-erosion'].includes(settings.generationCompute ?? ''))) throw new Error('CPU execution conflicts with explicit GPU terrain controls. Choose automatic/GPU or reset those controls.');
  if (request.compute === 'gpu' && settings.compute === 'wasm' && !['neural-python', 'neural'].includes(request.source)) throw new Error('GPU execution conflicts with explicit WASM CPU sampling. Choose automatic/CPU or reset the sampling control.');
  if (!['procedural', 'procedural-phasor'].includes(request.source) && !custom.sketch?.processing && !['flat', 'hills', 'valley', 'mountains', 'mixed', 'plateau', 'high-mountains'].includes(settings.relief)) throw new Error('This relief family is unavailable with neural generation.');
  const stopObserving = usesNeural && request.source === 'neural-python'
    ? observePythonStatus(pythonServer, event => onProgress?.(event.message), signal)
    : usesNeural && request.source === 'neural' ? observeNativeNeuralStatus(neuralServer, event => onProgress?.(event.message), signal) : () => {};
  try {
    // Stage timings for the V2 chain: the decomposed recipe already selects the staged CPU pipeline,
    // so a preview-free control only reports stage boundaries (no readbacks, no extra copies).
    const lab: GenerationControl | undefined = settings.procedural && !usesNeural && !custom.sketch && !custom.zones && !request.native ? {
      previews: false,
      before: async stage => { onProgress?.(`Procedural stage · ${stage}`, { stage: `pipeline:${stage}` }); },
      after: async stage => { onProgress?.(`Procedural stage · ${stage} · done`, { stage: `pipeline:${stage}:done` }); },
    } : undefined;
    const result = await sampleRustTerrain({
      id: 1, generation: 1, kind: 'overview',
      ...(request.native ? { runtime: { profile: 'local' as const, server: localServer } } : {}),
      settings,
      region: { x: 0, y: 0, extent: request.width, resolution: n },
      // SVG mode applies conditioning, hydrology carving and fractal detail to the retained height samples.
      display: 'svg',
      retainField: true,
    }, undefined, onProgress, lab);
    signal?.throwIfAborted();
    if (request.compute === 'gpu' && request.source !== 'neural-python' && request.source !== 'neural' && result.backend !== 'gpu-f32') {
      throw new Error(`Le calcul GPU demandé a échoué : ${result.backendReason ?? result.generationReason ?? 'GPU indisponible'}. Choisissez CPU ou Automatique.`);
    }
    if(!usesNeural&&!settings.sketch&&!settings.zones&&['gpu','gpu-all','gpu-erosion'].includes(custom.generationCompute??'')&&(result.generationBackend??'cpu')==='cpu'&&result.generationReason?.startsWith('GPU generation unavailable: ')){
      throw new Error(`La génération GPU demandée a échoué : ${result.generationReason??'GPU indisponible'}. Choisissez CPU ou Automatique.`);
    }
    if (isCompactProcedural(settings) && request.compute === 'gpu' && result.generationBackend !== 'compact-gpu-f32') throw new Error('Compact procedural GPU generation was requested but not used.');
    if (result.height.length !== n * n || result.height.some(v => !Number.isFinite(v))) throw new Error('Sortie moteur incomplète ou invalide.');
    const backend = result.neural?.backend ?? (result.generationBackend === 'native' ? 'rust-native' : result.backend === 'gpu-f32' ? 'rust-webgpu' : 'rust-wasm-cpu');
    const generationBackend = result.generationBackend ?? 'cpu';
    if (result.hydrologyError) throw new Error(`Hydrology failed: ${result.hydrologyError}. Change the water settings or disable hydrology explicitly.`);
    if (settings.hydrology?.compute === 'gpu' && result.hydrology && result.hydrology.backend !== 'gpu-f32') throw new Error(`Hydrology GPU request could not be fulfilled: ${result.hydrology.backendReason ?? 'CPU result'}.`);
    onProgress?.(`Relief et eau terminés · ${backend} · biomes ensuite`);
    return {
      importedHeight: { w: n, h: n, rgba: new Uint8Array(0), elevations: result.height.slice(), name: `${backend}-${request.seed}` },
      heightScale: Math.max(1, result.maxHeight), importSeaLevel: 0, backend, generationBackend, terrain: result,
      stats: { backend, generationBackend, 'ms.reliefEngine': Math.round(result.generationMs),
        samplingBackend: result.backend ?? 'wasm',
        hydrologyBackend: result.hydrology?.backend ?? (result.water ? 'vector-cpu' : 'disabled'),
        ...(result.generationReason ? { generationReason: result.generationReason } : {}),
        ...(result.neural?.modelIdentity ? { modelIdentity: result.neural.modelIdentity } : {}),
        ...(result.neural?.profile ? { modelProfile: result.neural.profile } : {}) },
    };
  } finally { stopObserving(); }
}
