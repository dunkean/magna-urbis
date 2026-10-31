/** Lazy browser runtime. Models remain external to the ordinary TS application. */
import { loadNeuralManifest, obtainNeuralModel, NEURAL_MODEL_NAMES } from './neuralModels';
interface NeuralOutput { heights: Float32Array; meta: string; free(): void }
interface NeuralEngine { generate_json(params: string, grid: string): Promise<NeuralOutput>; free(): void }
interface NeuralModule {
  default(options: { module_or_path: URL }): Promise<unknown>;
  NeuralRelief: { create(coarse: Uint8Array, base: Uint8Array, decoder: Uint8Array): Promise<NeuralEngine> };
  conditioning_json(params: string, grid: string): string;
  sketch_json(params: string): string;
}
let moduleUrl = '', moduleReady: Promise<NeuralModule> | undefined;
let engineUrl = '', engineReady: Promise<NeuralEngine> | undefined;
let modelIdentity = '';

export function neuralModule(assets: string): Promise<NeuralModule> {
  if (new URL(assets).protocol === 'file:') return Promise.reject(new Error('Open the site through http://127.0.0.1:5173/rustbench.html: neural runtime assets require HTTP or HTTPS.'));
  if (moduleUrl !== assets || !moduleReady) {
    moduleUrl = assets;
    moduleReady = (async () => {
      const url = new URL('magna_urbis_neural_wasm.js', assets).href;
      const module = await import(/* @vite-ignore */ url) as NeuralModule;
      await module.default({ module_or_path: new URL('magna_urbis_neural_wasm_bg.wasm', assets) });
      return module;
    })().catch(error => { moduleReady = undefined; throw new Error(`Neural runtime unavailable: run npm run wasm:neural. ${error}`); });
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
  if (engineUrl !== assets || !engineReady) {
    await releaseNeuralBrowser(); engineUrl = assets;
    engineReady = (async () => {
      const module = await neuralModule(assets);
      const { manifest } = await loadNeuralManifest(assets);
      modelIdentity = [manifest.runtimeSha256, ...(['coarse', 'base', 'decoder'] as const).map(name => manifest.models[name].sha256)].join(':');
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
  try { return { heights: new Float32Array(output.heights), meta: { ...JSON.parse(output.meta), modelIdentity } }; }
  finally { output.free(); }
}
