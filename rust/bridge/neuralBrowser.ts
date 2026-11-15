/** Lazy browser runtime. Models remain external to the ordinary TS application. */
import { loadNeuralManifest, obtainNeuralModel, NEURAL_MODEL_NAMES, type NeuralManifest } from './neuralModels';
import { obtainNeuralRuntime } from './neuralRuntime';
interface NeuralOutput { heights: Float32Array; meta: string; free(): void }
interface NeuralEngine { generate_json(params: string, grid: string): Promise<NeuralOutput>; free(): void }
interface NeuralModule {
  default(options: { module_or_path: URL | Uint8Array<ArrayBuffer> }): Promise<unknown>;
  NeuralRelief: { create(coarse: Uint8Array, base: Uint8Array, decoder: Uint8Array): Promise<NeuralEngine> };
  conditioning_json(params: string, grid: string): string;
  sketch_json(params: string): string;
}
let moduleUrl = '', moduleReady: Promise<NeuralModule> | undefined;
let engineUrl = '', engineReady: Promise<NeuralEngine> | undefined;
let modelIdentity = '';

export function neuralModule(assets: string, manifest?: NeuralManifest): Promise<NeuralModule> {
  if (new URL(assets).protocol === 'file:') return Promise.reject(new Error('Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS.'));
  const identity = assets + (manifest?.runtimeSha256 ?? '') + (manifest?.runtimeJsSha256 ?? '');
  if (moduleUrl !== identity || !moduleReady) {
    moduleUrl = identity;
    moduleReady = (async () => {
      if (manifest) {
        const { javascript, wasm } = await obtainNeuralRuntime(assets, manifest);
        const blob = URL.createObjectURL(new Blob([javascript], { type: 'text/javascript' }));
        try {
          const module = await import(/* @vite-ignore */ blob) as NeuralModule;
          await module.default({ module_or_path: wasm });
          return module;
        } finally { URL.revokeObjectURL(blob); }
      }
      const url = new URL('magna_urbis_neural_wasm.js', assets).href;
      const module = await import(/* @vite-ignore */ url) as NeuralModule;
      await module.default({ module_or_path: new URL('magna_urbis_neural_wasm_bg.wasm', assets) });
      return module;
    })().catch(error => { moduleReady = undefined; if (import.meta.env?.DEV) console.warn('Prepare browser runtime with npm run prepare:v2 -- --neural.', error); throw new Error('Neural runtime unavailable. Check your connection and retry.'); });
  }
  return moduleReady;
}

export async function releaseNeuralBrowser(): Promise<void> {
  if (!engineReady) return;
  try { (await engineReady).free(); } catch { }
  engineReady = undefined; engineUrl = '';
}

export async function browserNeural(assets: string, params: URLSearchParams, sketch: unknown, progress?: (text: string) => void) {
  if (!globalThis.navigator?.gpu) throw new Error('Neuronal WASM requires WebGPU on HTTPS or localhost.');
  const { manifest } = await loadNeuralManifest(assets);
  const identity = [manifest.runtimeSha256, ...NEURAL_MODEL_NAMES.map(name => manifest.models[name].sha256)].join(':');
  if (engineUrl !== assets + identity || !engineReady) {
    await releaseNeuralBrowser(); engineUrl = assets + identity;
    engineReady = (async () => {
      const module = await neuralModule(assets, manifest);
      modelIdentity = identity;
      const models: Uint8Array[] = [];
      for (const name of NEURAL_MODEL_NAMES) {
        const entry = manifest.models[name];
        progress?.(`Neuronal WASM · ${name} · ${(entry.bytes / 1e6).toFixed(1)} Mo`);
        models.push(await obtainNeuralModel(assets, manifest, name, { onStorageFailure: () => progress?.('Neural model storage unavailable; weights will need to be downloaded again.') }));
      }
      progress?.('Neuronal WASM · transfert des poids vers le GPU');
      return module.NeuralRelief.create(models[0], models[1], models[2]);
    })().catch(error => { engineReady = undefined; throw error; });
  }
  const engine = await engineReady;
  progress?.('Neuronal WASM · calcul coarse → base → decoder');
  const output = await engine.generate_json(JSON.stringify(Object.fromEntries(params)), sketch ? JSON.stringify(sketch) : '');
  try {
    const heights = new Float32Array(output.heights);
    const meta = JSON.parse(output.meta) as { extent?: number; resolution?: number; nativeCellM?: number; nativeResolution?: number; outputCellM?: number };
    const extent = Number(params.get('extent') ?? 40000);
    const expectedN = Number(params.get('resolution') ?? Math.ceil(extent / Number(params.get('sampleSpacing') ?? 30)));
    const n = meta.resolution;
    if (meta.extent !== extent || meta.nativeCellM !== 30 || meta.nativeResolution !== Math.ceil(extent / 30)
      || typeof n !== 'number' || !Number.isInteger(n) || n !== expectedN || heights.length !== n * n
      || meta.outputCellM !== extent / n || heights.some(v => !Number.isFinite(v))) {
      throw new Error('Neural browser runtime returned an incompatible physical surface; rebuild the neural WASM assets.');
    }
    return { heights, meta: { ...meta, modelIdentity } };
  }
  finally { output.free(); }
}
