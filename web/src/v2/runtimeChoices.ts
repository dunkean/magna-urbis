/** Single source of truth for execution choices (engine, compute, neural runtime, advanced overrides):
 * every coherence rule lives here, as pure functions over V2Settings. */
import type { V2Settings } from './contracts';
import { registerMessages } from './i18n';

export interface RuntimeCapabilities { checked: boolean; webgpu: boolean; native: boolean; python: boolean }
export interface ChoiceState { enabled: boolean; reason?: string }
export type EngineChoice = 'rust' | 'native' | 'typescript';
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

/** Apply a single runtime-related setting path, then restore global coherence. Returns true if the path was handled. */
export function applyRuntimePath(settings: V2Settings, path: string, value: unknown): void {
  const runtime = ensure(settings);
  if (path === 'runtime.source') {
    const wasClassic = runtime.backend === 'typescript';
    settings.generation = value === 'procedural' ? 'procedural' : 'neural';
    if (wasClassic) { runtime.backend = 'rust'; if (value !== 'procedural') runtime.compute = 'auto'; }
  }
  if (path === 'runtime.backend' && value === 'typescript') { runtime.source = 'procedural'; runtime.compute = 'cpu'; settings.generation = 'procedural'; }
  if (path === 'terrain.procedural.preset' && value === 'compact') {
    if (settings.terrain) { delete settings.terrain.generationCompute; delete settings.terrain.compute; }
    if (['plateau', 'volcano', 'caldera', 'cavern'].includes(String(settings.terrain?.relief ?? settings.options.relief))) { settings.terrain ??= {}; settings.terrain.relief = 'mixed'; }
  }
}

/** Idempotent: brings any settings object to a state that the engines accept. */
export function normalizeRuntime(settings: V2Settings): V2Settings {
  const runtime = ensure(settings);
  if ((runtime.source as string) === 'procedural-phasor') {
    settings.terrain ??= {}; settings.terrain.procedural = { ...settings.terrain.procedural, preset: 'compact' }; runtime.source = 'procedural';
  }
  if (settings.generation === 'neural' && runtime.source === 'procedural') runtime.source = runtime.backend === 'native' ? 'neural' : 'neural-wasm';
  if (settings.generation === 'procedural' && NEURAL_SOURCES.includes(runtime.source as never)) settings.generation = 'neural';
  const neural = isNeural(settings);
  if (runtime.backend === 'typescript') {
    if (neural) runtime.backend = 'rust';
    else { runtime.source = 'procedural'; runtime.compute = 'cpu'; settings.generation = 'procedural'; }
  }
  const terrain = settings.terrain;
  if ((terrain?.generationCompute as string) === 'native') { delete terrain!.generationCompute; runtime.backend = 'native'; }
  if (isCompact(settings) && !neural) {
    if (runtime.backend === 'native' && runtime.compute === 'gpu') runtime.compute = 'auto';
    if (terrain) { delete terrain.compute; if (terrain.generationCompute && !['cpu', 'gpu-erosion'].includes(terrain.generationCompute)) delete terrain.generationCompute; }
  }
  if (neural && runtime.compute === 'cpu') runtime.compute = 'auto';
  // Neural runtime follows the engine unless Python is explicitly chosen.
  if (neural && runtime.source !== 'neural-python') runtime.source = runtime.backend === 'native' ? 'neural' : 'neural-wasm';
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
  const gpuMissing = caps.checked && !caps.webgpu, nativeMissing = caps.checked && !caps.native, pythonMissing = caps.checked && !caps.python;
  const terrain = settings.terrain ?? {};
  const gpuOverride = terrain.compute === 'gpu-f32' || GPU_GEN.includes(terrain.generationCompute ?? '');
  const gpu = (): ChoiceState => classic ? no(R.engineNoGpu) : gpuMissing ? no(R.needGpu) : ok;
  return {
    engine: {
      rust: ok,
      native: nativeMissing ? no(R.needNative) : ok,
      typescript: neural ? no(R.classicNoNeural) : ok,
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
    urban: { '': ok, typescript: ok, rust: ok, native: nativeMissing ? no(R.needNative) : ok },
  };
}

export type RuntimeValues = Record<RuntimeKey, string>;
/** Current value of every choice ('' = follows the engine / automatic). */
export function runtimeValues(settings: V2Settings): RuntimeValues {
  const runtime = settings.runtime ?? { backend: 'rust', compute: 'auto', source: 'procedural' } as const;
  return {
    engine: runtime.backend, compute: runtime.compute, neural: runtime.source === 'neural-python' ? 'python' : 'auto',
    sampling: settings.terrain?.compute ?? '', generationCompute: settings.terrain?.generationCompute ?? '',
    hydrology: settings.terrain?.hydrology?.compute ?? 'auto', urban: settings.urban?.backend ?? '',
  };
}

/** Writes one choice and re-normalizes. Overrides set to '' (or hydrology 'auto') are removed so they follow the engine. */
export function setRuntimeChoice(settings: V2Settings, key: RuntimeKey, value: string): V2Settings {
  const runtime = ensure(settings);
  switch (key) {
    case 'engine': applyRuntimePath(settings, 'runtime.backend', value); runtime.backend = value as EngineChoice; break;
    case 'compute': runtime.compute = value as ComputeChoice; break;
    case 'neural': if (isNeural(settings)) runtime.source = value === 'python' ? 'neural-python' : runtime.backend === 'native' ? 'neural' : 'neural-wasm'; break;
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
