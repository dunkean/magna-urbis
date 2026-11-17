/** Single source of truth for execution choices (engine, compute, neural runtime, advanced overrides):
 * coherence rules are pure; per-run selection also checks native reachability. */
import type { V2Settings } from './contracts';
import { registerMessages } from './i18n';
import { isNativeConnectionFailure, markNativeUnavailable, nativeRuntimeAvailable } from '../../../rust/bridge/nativeAvailability';
import { loopbackServer, runtimeOptions, type RuntimeLocation } from './platform';
import { engineIdentity, nativeBuild, refreshWasmBuild } from '../../../rust/bridge/engineIdentity';

export interface RuntimeCapabilities { checked: boolean; servicesChecked?: boolean; webgpu: boolean; native: boolean; python: boolean }
export interface ChoiceState { enabled: boolean; reason?: string }
export type EngineChoice = 'rust' | 'native' | 'typescript';
type OriginLocation = RuntimeLocation;
export type ComputeChoice = 'auto' | 'cpu' | 'gpu';
export type NeuralChoice = 'auto' | 'python';
export type RuntimeKey = 'engine' | 'compute' | 'neural' | 'sampling' | 'generationCompute' | 'hydrology' | 'urban';

const copy = (en: string, fr: string) => { registerMessages({ [en]: { en, fr } }); return en; };
export const R = {
  needGpu: copy('Needs WebGPU, which this browser does not provide (see Settings).', 'Nécessite WebGPU, absent de ce navigateur (voir Réglages).'),
  needNative: copy('Needs the native Rust service, which is offline (see Settings).', 'Nécessite le service Rust natif, hors ligne (voir Réglages).'),
  needPython: copy('Needs the Python/CUDA neural server, which is offline (see Settings).', 'Nécessite le serveur neuronal Python/CUDA, hors ligne (voir Réglages).'),
  classicCpu: copy('The classic TypeScript engine only runs procedural relief on CPU.', 'Le moteur TypeScript classique ne calcule que le relief procédural, sur CPU.'),
  classicNoNeural: copy('Neural generation needs a Rust engine.', 'La génération neuronale nécessite un moteur Rust.'),
  compactBrowser: copy('The compact procedural preset only uses the GPU in the browser Rust engine.', 'Le préréglage procédural compact n’utilise le GPU que dans le moteur Rust du navigateur.'),
  neuralNoCpu: copy('Neural generation needs a GPU (WebGPU or a GPU service).', 'La génération neuronale nécessite un GPU (WebGPU ou service GPU).'),
  cpuVsGpu: copy('Conflicts with an explicit GPU override below.', 'En conflit avec un forçage GPU explicite ci-dessous.'),
  noNeuralScope: copy('Only used by neural generation.', 'Utilisé uniquement par la génération neuronale.'),
  proceduralOnly: copy('Only used by procedural relief.', 'Utilisé uniquement par le relief procédural.'),
  compactCompute: copy('Not available with the compact procedural preset.', 'Indisponible avec le préréglage procédural compact.'),
  cpuNoGpu: copy('Compute is set to CPU.', 'Le calcul est réglé sur CPU.'),
  engineNoGpu: copy('This engine has no GPU path.', 'Ce moteur n’a pas de chemin GPU.'),
};
export const NEURAL_SOURCES = ['neural-wasm', 'neural-python', 'neural'] as const;
const isNeural = (s: V2Settings) => s.generation === 'neural' || NEURAL_SOURCES.includes(s.runtime?.source as never);
const GPU_GEN = ['gpu', 'gpu-all', 'gpu-erosion'];
export const isCompact = (s: V2Settings) => s.terrain?.procedural?.preset === 'compact';

function ensure(s: V2Settings): NonNullable<V2Settings['runtime']> {
  return s.runtime ??= { backend: 'rust', compute: 'auto', source: 'procedural' };
}

/** Only an explicit local profile or the desktop app may use native services. */
export function nativeOrigin(location?: OriginLocation): boolean {
  return runtimeOptions(location).profile === 'local';
}
/** Automatic engine: native preferred where reachable from this origin, else Rust in the browser. The run still
 * re-checks native reachability and silently uses the browser when it does not answer. */
export function resolveAutoBackend(settings: V2Settings, location?: OriginLocation): V2Settings {
  const runtime = settings.runtime;
  if (!runtime?.autoBackend) return normalizeRuntime(settings, location);
  const backend = nativeOrigin(location) ? 'native' : 'rust';
  runtime.backend = backend;
  if (backend === 'rust') runtime.compute = 'auto';
  return normalizeRuntime(settings, location);
}

/** Apply a single runtime-related setting path, then restore global coherence. Returns true if the path was handled. */
export function applyRuntimePath(settings: V2Settings, path: string, value: unknown): void {
  const runtime = ensure(settings);
  if (path === 'runtime.compute' && !nativeOrigin()) delete runtime.autoBackend;
  if (path === 'runtime.source') {
    const wasClassic = runtime.backend === 'typescript';
    settings.generation = value === 'procedural' ? 'procedural' : 'neural';
    if (wasClassic) { runtime.backend = 'rust'; if (value !== 'procedural') runtime.compute = 'auto'; }
  }
  if (path === 'runtime.backend' && value === 'typescript') { runtime.source = 'procedural'; runtime.compute = 'cpu'; settings.generation = 'procedural'; }
  if (path === 'terrain.procedural.preset' && value === 'compact') {
    if (settings.terrain) { delete settings.terrain.generationCompute; delete settings.terrain.compute; }
    if (['plateau', 'volcano', 'caldera'].includes(String(settings.terrain?.relief ?? settings.options.relief))) { settings.terrain ??= {}; settings.terrain.relief = 'mixed'; }
  }
}

/** Idempotent: brings any settings object to a state that the engines accept. */
export function normalizeRuntime(settings: V2Settings, location?: OriginLocation): V2Settings {
  const runtime = ensure(settings);
  if ((runtime.source as string) === 'procedural-phasor') {
    settings.terrain ??= {}; settings.terrain.procedural = { ...settings.terrain.procedural, preset: 'compact' }; runtime.source = 'procedural';
  }
  if (settings.generation === 'neural' && runtime.source === 'procedural') runtime.source = runtime.backend === 'native' && !runtime.autoBackend ? 'neural' : 'neural-wasm';
  if (settings.generation === 'procedural' && NEURAL_SOURCES.includes(runtime.source as never)) settings.generation = 'neural';
  const neural = isNeural(settings);
  if (runtime.backend === 'typescript') {
    if (neural) runtime.backend = 'rust';
    else { runtime.source = 'procedural'; runtime.compute = 'cpu'; settings.generation = 'procedural'; }
  }
  const terrain = settings.terrain;
  if ((terrain?.generationCompute as string) === 'native') { delete terrain!.generationCompute; runtime.backend = 'native'; }
  if (!nativeOrigin(location)) {
    if (runtime.backend === 'typescript') runtime.compute = 'cpu';
    runtime.backend = 'rust';
    if (runtime.source === 'neural') runtime.source = 'neural-wasm';
    if (settings.urban?.backend === 'native' || settings.urban?.backend === 'typescript') settings.urban.backend = 'rust';
  }
  if (isCompact(settings) && !neural) {
    if (runtime.backend === 'native' && runtime.compute === 'gpu') runtime.compute = 'auto';
    if (terrain) { delete terrain.compute; if (terrain.generationCompute && !['cpu', 'gpu-erosion'].includes(terrain.generationCompute)) delete terrain.generationCompute; }
  }
  if (neural && runtime.compute === 'cpu') runtime.compute = 'auto';
  // Only invalid combinations are corrected: the native neural service (:8792) needs the native engine.
  // Python or browser neural stays as chosen (or as the run fallback set it), even with the native engine:
  // the neural source only produces the height; the rest of the chain keeps its engine.
  // Automatic selects the native neural service only once its probe answered (fallbackRuntime).
  if (neural && runtime.source === 'neural' && runtime.backend !== 'native') runtime.source = 'neural-wasm';
  if (runtime.backend === 'typescript' && terrain) { delete terrain.compute; delete terrain.generationCompute; }
  // Explicit overrides never contradict the global compute choice.
  if (terrain) {
    const gpuGen = GPU_GEN.includes(terrain.generationCompute ?? '');
    if (runtime.compute === 'cpu') { if (terrain.compute === 'gpu-f32') delete terrain.compute; if (gpuGen) delete terrain.generationCompute; }
    else if (runtime.compute === 'gpu' && terrain.compute === 'wasm' && !neural) delete terrain.compute;
    if (terrain.compute === 'wasm' && GPU_GEN.includes(terrain.generationCompute ?? '')) delete terrain.generationCompute;
  }
  return settings;
}

const ok: ChoiceState = { enabled: true };
const no = (reason: string): ChoiceState => ({ enabled: false, reason });

/** Per choice, per option value: whether it can be picked right now, and why not. */
export function runtimeChoiceStates(settings: V2Settings, caps: RuntimeCapabilities): Record<RuntimeKey, Record<string, ChoiceState>> {
  const runtime = settings.runtime ?? { backend: 'rust', compute: 'auto', source: 'procedural' } as const;
  const neural = isNeural(settings), compact = isCompact(settings), classic = runtime.backend === 'typescript';
  const servicesChecked = caps.servicesChecked ?? caps.checked;
  const gpuMissing = caps.checked && !caps.webgpu, nativeMissing = servicesChecked && !caps.native, pythonMissing = servicesChecked && !caps.python;
  const terrain = settings.terrain ?? {};
  const gpuOverride = terrain.compute === 'gpu-f32' || GPU_GEN.includes(terrain.generationCompute ?? '');
  const gpu = (): ChoiceState => classic ? no(R.engineNoGpu) : gpuMissing ? no(R.needGpu) : ok;
  return {
    engine: {
      auto: ok,
      rust: ok,
      cpu: neural ? no(R.neuralNoCpu) : ok,
      gpu: gpuMissing ? no(R.needGpu) : ok,
      native: !nativeOrigin() || nativeMissing ? no(R.needNative) : ok,
      typescript: !nativeOrigin() || neural ? no(R.classicNoNeural) : ok,
    },
    compute: {
      auto: ok,
      cpu: neural && !classic ? no(R.neuralNoCpu) : gpuOverride && !classic ? no(R.cpuVsGpu) : ok,
      gpu: classic ? no(R.classicCpu) : compact && !neural && runtime.backend === 'native' ? no(R.compactBrowser) : gpuMissing ? no(R.needGpu) : ok,
    },
    neural: {
      auto: neural && gpuMissing && runtime.backend === 'rust' ? no(R.needGpu) : neural && runtime.backend === 'native' && nativeMissing ? no(R.needNative) : ok,
      python: classic ? no(R.classicNoNeural) : pythonMissing ? no(R.needPython) : ok,
    },
    sampling: {
      '': classic ? no(R.classicCpu) : ok,
      wasm: classic ? no(R.classicCpu) : runtime.compute === 'gpu' && !neural ? no(R.cpuVsGpu) : ok,
      'gpu-f32': classic ? no(R.classicCpu) : compact && !neural ? no(R.compactCompute) : runtime.compute === 'cpu' ? no(R.cpuNoGpu) : gpuMissing ? no(R.needGpu) : ok,
    },
    generationCompute: {
      '': ok,
      cpu: neural || classic ? no(neural ? R.proceduralOnly : R.classicCpu) : ok,
      gpu: neural ? no(R.proceduralOnly) : compact ? no(R.compactCompute) : runtime.compute === 'cpu' ? no(R.cpuNoGpu) : terrain.compute === 'wasm' ? no(R.cpuVsGpu) : gpu(),
      'gpu-all': neural ? no(R.proceduralOnly) : compact ? no(R.compactCompute) : runtime.compute === 'cpu' ? no(R.cpuNoGpu) : terrain.compute === 'wasm' ? no(R.cpuVsGpu) : gpu(),
      'gpu-erosion': neural ? no(R.proceduralOnly) : runtime.compute === 'cpu' ? no(R.cpuNoGpu) : terrain.compute === 'wasm' ? no(R.cpuVsGpu) : gpu(),
    },
    hydrology: { auto: ok, cpu: ok, gpu: gpuMissing ? no(R.needGpu) : ok },
    urban: { '': ok, typescript: nativeOrigin() ? ok : no(R.classicNoNeural), rust: ok, native: !nativeOrigin() || nativeMissing ? no(R.needNative) : ok },
  };
}

export type RuntimeValues = Record<RuntimeKey, string>;
/** Current value of every choice ('' = follows the engine / automatic). */
export function runtimeValues(settings: V2Settings): RuntimeValues {
  const runtime = settings.runtime ?? { backend: 'rust', compute: 'auto', source: 'procedural' } as const;
  return {
    engine: settings.runtime?.autoBackend ? 'auto' : nativeOrigin() ? runtime.backend : runtime.compute, compute: runtime.compute, neural: runtime.source === 'neural-python' ? 'python' : 'auto',
    sampling: settings.terrain?.compute ?? '', generationCompute: settings.terrain?.generationCompute ?? '',
    hydrology: settings.terrain?.hydrology?.compute ?? 'auto', urban: settings.urban?.backend ?? '',
  };
}

/** Writes one choice and re-normalizes. Overrides set to '' (or hydrology 'auto') are removed so they follow the engine.
 * `caps` decides the automatic neural source: native neural only when its probe answered (the run then still picks
 * Python before the browser when the native neural service is not usable, see fallbackRuntime). */
export function setRuntimeChoice(settings: V2Settings, key: RuntimeKey, value: string, caps?: ServiceCapabilities): V2Settings {
  const runtime = ensure(settings);
  switch (key) {
    case 'engine':
      if (value === 'auto') { runtime.autoBackend = true; resolveAutoBackend(settings); break; }
      if (value === 'cpu' || value === 'gpu') { delete runtime.autoBackend; runtime.backend = 'rust'; runtime.compute = value; break; }
      delete runtime.autoBackend; applyRuntimePath(settings, 'runtime.backend', value); runtime.backend = value as EngineChoice;
      // Automatic neural follows an explicit engine choice; the run checks the native neural service.
      if (isNeural(settings) && runtime.source !== 'neural-python') runtime.source = runtime.backend === 'native' ? 'neural' : 'neural-wasm';
      break;
    case 'compute': runtime.compute = value as ComputeChoice; break;
    case 'neural':
      if (value === 'python') { settings.generation = 'neural'; runtime.source = 'neural-python'; }
      else if (isNeural(settings)) runtime.source = runtime.backend === 'native' && caps?.nativeNeural === true ? 'neural' : 'neural-wasm';
      break;
    case 'sampling': settings.terrain ??= {}; if (value) settings.terrain.compute = value as 'wasm' | 'gpu-f32'; else delete settings.terrain.compute; break;
    case 'generationCompute': settings.terrain ??= {}; if (value) settings.terrain.generationCompute = value as never; else delete settings.terrain.generationCompute; break;
    case 'hydrology': settings.terrain ??= {}; settings.terrain.hydrology = { ...settings.terrain.hydrology }; if (value === 'auto') delete settings.terrain.hydrology.compute; else settings.terrain.hydrology.compute = value as 'cpu' | 'gpu'; break;
    case 'urban': if (value) settings.urban = { ...settings.urban, backend: value as EngineChoice }; else if (settings.urban) delete settings.urban.backend; break;
  }
  return normalizeRuntime(settings);
}

/** Compact read-only chip text, e.g. "Rust · GPU · neural browser". */
export function runtimeSummary(settings: V2Settings, effectiveGpu?: boolean): string {
  const runtime = settings.runtime ?? { backend: 'rust', compute: 'auto', source: 'procedural' } as const;
  const engine = runtime.backend === 'native' ? 'Rust native' : runtime.backend === 'typescript' ? 'TypeScript' : 'Rust';
  const compute = runtime.compute === 'auto' ? effectiveGpu === undefined ? 'auto' : effectiveGpu ? 'GPU' : 'CPU' : runtime.compute.toUpperCase();
  const parts = [engine, compute];
  if (isNeural(settings)) parts.push(runtime.source === 'neural-python' ? 'neural Python' : runtime.source === 'neural' ? 'neural native' : 'neural browser');
  return parts.join(' · ');
}

// ── Offline backends ──────────────────────────────────────────────────────────────────────
/** `nativeNeural`: the native neural service (:8792); only `true` (a probe saw it answer) makes it usable. */
export interface ServiceCapabilities extends RuntimeCapabilities { nativeNeural?: boolean }
export const F = {
  connection: copy('NativeConnectionError: Native engine is unreachable.', 'NativeConnectionError : Le moteur natif est inaccessible.'),
  engineToBrowser: copy('The native Rust service is offline: the engine switched to Rust in the browser.', 'Le service Rust natif est hors ligne : le moteur passe sur Rust dans le navigateur.'),
  neuralToBrowser: copy('The neural service is offline: neural generation switched to the browser (Rust · WebGPU).', 'Le service neuronal est hors ligne : la génération neuronale passe dans le navigateur (Rust · WebGPU).'),
  neuralToPython: copy('No usable neural engine on this path: neural generation switched to the Python/CUDA service.', 'Aucun moteur neuronal utilisable sur ce chemin : la génération neuronale passe sur le service Python/CUDA.'),
  pythonToNative: copy('The Python/CUDA service is offline: neural generation now follows the native Rust engine.', 'Le service Python/CUDA est hors ligne : la génération neuronale suit désormais le moteur Rust natif.'),
  urbanToEngine: copy('The native Rust service is offline: cities now follow the main engine.', 'Le service Rust natif est hors ligne : les villes suivent désormais le moteur principal.'),
  suggest: copy('You can select {alternative} in Settings instead.', 'Vous pouvez choisir {alternative} dans les Réglages à la place.'),
  check: copy('Check the available engines in Settings.', 'Vérifiez les moteurs disponibles dans les Réglages.'),
  open: copy('Open Settings', 'Ouvrir les Réglages'),
  altBrowserGpu: copy('the Rust engine in the browser, with WebGPU', 'le moteur Rust du navigateur, avec WebGPU'),
  altBrowserCpu: copy('the Rust engine in the browser, on CPU', 'le moteur Rust du navigateur, sur CPU'),
  altBrowserNeural: copy('browser neural generation (Rust · WebGPU)', 'la génération neuronale du navigateur (Rust · WebGPU)'),
  altPython: copy('the Python/CUDA neural service', 'le service neuronal Python/CUDA'),
  altNativeNeural: copy('native Rust neural generation', 'la génération neuronale Rust native'),
  runningInBrowser: copy('running in the browser (native unreachable)', 'exécution dans le navigateur (natif inaccessible)'),
  nativeQuiet: copy('Native engine not answering: this action stopped; the next run picks the available engine.', 'Moteur natif sans réponse : cette action s’est arrêtée ; le prochain calcul choisit le moteur disponible.'),
  autoNative: copy('In use: native Rust service', 'En cours : service Rust natif'),
  autoBrowser: copy('In use: Rust in the browser', 'En cours : Rust dans le navigateur'),
};

export const usesNativeRuntime = (settings: V2Settings, action?: string): boolean => settings.runtime?.backend === 'native'
  || settings.urban?.backend === 'native' && (action === undefined || ['town', 'towns', 'all'].includes(action));
const nativeRuntime = (settings: V2Settings) => ({ profile: 'local' as const, server: loopbackServer(settings.runtime?.localServer ?? 'http://127.0.0.1:8791') });
/** Optional neural/illustration services cannot take the procedural engine offline. */
export function isSelectedNativeServer(settings: V2Settings, server: string, action?: string): boolean {
  return usesNativeRuntime(settings, action) && server.replace(/\/+$/, '') === nativeRuntime(settings).server;
}

/** The UI keeps preferences and effective execution separate; repeated stages share one notice. */
export class RuntimeFallbackState {
  private episode?: string;
  private key(settings: V2Settings): string {
    return JSON.stringify([settings.runtime?.backend ?? 'rust', settings.urban?.backend ?? '', settings.runtime?.localServer ?? 'http://127.0.0.1:8791']);
  }
  update(preference: V2Settings, effective: V2Settings): boolean {
    const fellBack = preference.runtime?.backend === 'native' && effective.runtime?.backend === 'rust'
      || preference.urban?.backend === 'native' && effective.urban?.backend === 'rust';
    const episode = fellBack ? this.key(preference) : undefined, notify = episode !== undefined && episode !== this.episode;
    this.episode = episode;
    return notify;
  }
  status(preference: V2Settings): string | undefined {
    return this.episode === this.key(preference) ? F.runningInBrowser : undefined;
  }
}
function copyRuntimeSettings(settings: V2Settings): V2Settings {
  return { ...settings, runtime: settings.runtime && { ...settings.runtime }, urban: settings.urban && { ...settings.urban },
    terrain: settings.terrain && { ...settings.terrain } };
}

/** A run owns its effective choices; the recipe and the user's native preference stay intact. */
export function browserRuntimeSettings(settings: V2Settings): V2Settings {
  const browser = copyRuntimeSettings(settings);
  if (browser.runtime?.backend === 'native') browser.runtime.backend = 'rust';
  if (browser.runtime?.source === 'neural') browser.runtime.source = 'neural-wasm';
  if (browser.urban?.backend === 'native') browser.urban.backend = 'rust';
  if ((browser.terrain?.generationCompute as string) === 'native') delete browser.terrain!.generationCompute;
  return browser;
}

/** The settings as terrain keys see them: only what changes the terrain. Where it ran (native, browser, the neural
 * service a fallback picked for one run), the devices and the endpoints are left out; the classic TypeScript engine,
 * procedural vs neural, and Python checkpoint choices (which only Python runs) stay in. */
export function terrainRecipeSettings(settings: V2Settings): V2Settings {
  const recipe = browserRuntimeSettings(settings), runtime = recipe.runtime;
  if (runtime) {
    const checkpoints = [settings.terrain?.coarseModel, settings.terrain?.baseModel, settings.terrain?.decoderModel].some(Boolean);
    if (NEURAL_SOURCES.includes(runtime.source as never)) runtime.source = runtime.source === 'neural-python' && checkpoints ? 'neural-python' : 'neural-wasm';
    if (runtime.backend !== 'typescript') runtime.compute = 'auto'; // the classic engine always runs on CPU
    delete runtime.autoBackend; delete runtime.localServer; delete runtime.pythonServer; delete runtime.neuralServer; delete runtime.engineBuilds;
  }
  if (recipe.terrain) {
    delete recipe.terrain.compute; delete recipe.terrain.generationCompute;
    if (recipe.terrain.hydrology) { recipe.terrain.hydrology = { ...recipe.terrain.hydrology }; delete recipe.terrain.hydrology.compute; }
  }
  return recipe;
}

/** Explicit runs recheck completed health results, sharing only an in-flight probe.
 * The native engine is chosen automatically: used when reachable, otherwise the run silently
 * moves to Rust in the browser (`nativeOffline`, shown only as a Settings status; no notice). */
export async function runtimeForRun(settings: V2Settings, capabilities?: ServiceCapabilities, action?: string, location?: OriginLocation): Promise<{ settings: V2Settings; notes: string[]; nativeOffline: boolean }> {
  settings = resolveAutoBackend(copyRuntimeSettings(settings), location);
  let effective = copyRuntimeSettings(settings), notes: string[] = [];
  let native: boolean | undefined;
  if (usesNativeRuntime(settings, action)) {
    native = await nativeRuntimeAvailable(nativeRuntime(settings), true);
    if (!native) effective = browserRuntimeSettings(settings);
  }
  if (capabilities && native !== false) notes.push(...fallbackRuntime(effective, { ...capabilities,
    // An unused city override must not trigger a terrain fallback.
    native: native ?? (settings.urban?.backend === 'native' && !usesNativeRuntime(settings, action) ? true : capabilities.native) }, location)
    .filter(note => note !== F.engineToBrowser && note !== F.urbanToEngine));
  // The worker records its results under the engine builds the page compares (engineIdentity.ts).
  if (effective.runtime) effective.runtime.engineBuilds = { native: nativeBuild(nativeRuntime(settings).server), wasm: await refreshWasmBuild() };
  return { settings: effective, notes, nativeOffline: native === false };
}

/** Identity of the engine that runs `backend` (default: the terrain/region backend) for these settings:
 * part of every retained stage key, so a rebuilt engine invalidates what the previous binary produced. */
export function engineIdentityOf(settings: V2Settings, backend: string | undefined = settings.runtime?.backend): string {
  return engineIdentity(backend, nativeRuntime(settings).server, settings.runtime?.engineBuilds);
}
/** Re-read the engine identities before deciding which stages a run may reuse (one short /status probe). */
export async function refreshEngineIdentity(settings: V2Settings): Promise<void> {
  if (usesNativeRuntime(settings)) await nativeRuntimeAvailable(nativeRuntime(settings), true);
  await refreshWasmBuild();
}

/** One retry of this stage, never a replay of earlier completed generation stages.
 * JSON/HTTP engine failures have no transport marker and propagate unchanged. */
export async function retryNativeStage<T>(settings: V2Settings, stage: (effective: V2Settings) => Promise<T>,
  onFallback: (effective: V2Settings, note: string) => void, action?: string): Promise<T> {
  try { return await stage(settings); }
  catch (error) {
    if (!usesNativeRuntime(settings, action) || !isNativeConnectionFailure(error)) throw error;
    if (error && typeof error === 'object' && 'server' in error && !isSelectedNativeServer(settings, String(error.server), action)) throw error;
    markNativeUnavailable(nativeRuntime(settings).server);
    const browser = browserRuntimeSettings(settings);
    onFallback(browser, F.engineToBrowser);
    return stage(browser);
  }
}

/** Retained terrain/sites remain usable when only Rust's execution location changes.
 * Cache creation still records the actual backend; all other recipe fields must match. */
export function matchesRustTransport(settings: V2Settings, key: (settings: V2Settings) => string, retained: unknown): boolean {
  if (retained === key(settings)) return true;
  if (!settings.runtime || !['rust', 'native'].includes(settings.runtime.backend)) return false;
  const peer = copyRuntimeSettings(settings), runtime = peer.runtime!;
  runtime.backend = runtime.backend === 'native' ? 'rust' : 'native';
  if (runtime.source === 'neural') runtime.source = 'neural-wasm';
  else if (runtime.source === 'neural-wasm') runtime.source = 'neural';
  return retained === key(peer);
}

/** True when a service the settings rely on has not been probed, or was last seen offline (it may be back). */
export function runtimeNeedsProbe(settings: V2Settings, caps: RuntimeCapabilities): boolean {
  const runtime = settings.runtime; if (!runtime) return false;
  const native = nativeOrigin() && (runtime.backend === 'native' || settings.urban?.backend === 'native');
  const python = isNeural(settings) && runtime.source === 'neural-python';
  const gpuNeural = isNeural(settings) && runtime.source === 'neural-wasm';
  return !caps.checked ? native || python || gpuNeural : native && !caps.native || python && !caps.python;
}

/** Moves every choice whose backend is known to be offline to the best available alternative.
 * Returns one note per change ([] when nothing is offline, or when no alternative exists: the run then reports the error). */
export function fallbackRuntime(settings: V2Settings, caps: ServiceCapabilities, location?: OriginLocation): string[] {
  if (!nativeOrigin(location)) normalizeRuntime(settings, location);
  if (!caps.checked || !settings.runtime) return [];
  const runtime = settings.runtime, notes: string[] = [], neural = isNeural(settings);
  const servicesChecked = caps.servicesChecked ?? caps.checked;
  if (runtime.backend === 'native' && servicesChecked && !caps.native) {
    if (!neural || runtime.source === 'neural-python') { runtime.backend = 'rust'; notes.push(F.engineToBrowser); }
    else if (nativeOrigin(location) && caps.python) { runtime.backend = 'rust'; runtime.source = 'neural-python'; notes.push(F.neuralToPython); }
    else if (caps.webgpu) { runtime.backend = 'rust'; runtime.source = 'neural-wasm'; notes.push(F.neuralToBrowser); }
  } else if (runtime.backend === 'native' && neural && nativeOrigin(location) && (runtime.source === 'neural' || runtime.source === 'neural-wasm')) {
    // Native engine up: only the neural source is chosen here, the rest of the chain stays native.
    // The native neural service (:8792) is a separate process, used only once a probe saw it answer;
    // otherwise Python/CUDA when it answers, else the browser.
    const source = caps.nativeNeural === true ? 'neural' : caps.python ? 'neural-python' : 'neural-wasm';
    if (source !== runtime.source) {
      // Leaving an unusable native neural service, or a browser without WebGPU, is announced; an automatic upgrade is not.
      if (runtime.source === 'neural' || !caps.webgpu) notes.push(source === 'neural-python' ? F.neuralToPython : F.neuralToBrowser);
      runtime.source = source;
    }
  }
  if (neural && runtime.source === 'neural-python' && servicesChecked && !caps.python) {
    if (runtime.backend === 'native' && caps.nativeNeural === true) { runtime.source = 'neural'; notes.push(F.pythonToNative); }
    else if (caps.webgpu) { runtime.source = 'neural-wasm'; notes.push(F.neuralToBrowser); }
  }
  if (nativeOrigin(location) && neural && runtime.backend === 'rust' && runtime.source === 'neural-wasm' && !caps.webgpu && caps.python) { runtime.source = 'neural-python'; notes.push(F.neuralToPython); }
  if (settings.urban?.backend === 'native' && servicesChecked && !caps.native) { delete settings.urban.backend; notes.push(F.urbanToEngine); }
  if (notes.length) normalizeRuntime(settings, location);
  return notes;
}

export type BackendFailure = 'native' | 'neural-service' | 'webgpu';
/** Recognises the errors raised when the selected backend is missing (French sources and their English translations). */
export function backendFailure(message: string): BackendFailure | undefined {
  if (/Moteur (Rust local|natif) inaccessible|local Rust engine is unreachable|native engine is unreachable|Native generation requires the local Rust backend/i.test(message)) return 'native';
  if (/Neural service unreachable|Service neuronal inaccessible|Could not start the neural service|Impossible de démarrer le service neuronal/i.test(message)) return 'neural-service';
  if (/WebGPU is unavailable|WebGPU indisponible|nécessitent WebGPU/i.test(message)) return 'webgpu';
  return undefined;
}

/** The English label of the best alternative to a failed backend, or undefined when none is available. */
export function backendAlternative(settings: V2Settings, caps: RuntimeCapabilities, failure: BackendFailure): string | undefined {
  const trial = { ...settings, runtime: settings.runtime && { ...settings.runtime }, urban: settings.urban && { ...settings.urban },
    terrain: settings.terrain && { ...settings.terrain } } as V2Settings;
  const source = settings.runtime?.source;
  const failed: ServiceCapabilities = { ...caps, checked: true, servicesChecked: true, ...(failure === 'native' ? { native: false } : failure === 'webgpu' ? { webgpu: false }
    : source === 'neural-python' ? { python: false } : { nativeNeural: false }) };
  if (!fallbackRuntime(trial, failed).length) return undefined;
  const runtime = trial.runtime!;
  if (isNeural(trial)) return runtime.source === 'neural-python' ? F.altPython : runtime.source === 'neural' ? F.altNativeNeural : F.altBrowserNeural;
  return failed.webgpu && runtime.compute !== 'cpu' ? F.altBrowserGpu : F.altBrowserCpu;
}
