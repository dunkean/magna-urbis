/** Lazy browser runtime. Models remain external to the ordinary TS application. */
interface NeuralOutput { heights: Float32Array; meta: string; free(): void }
interface NeuralEngine { generate_json(params: string, grid: string): Promise<NeuralOutput>; free(): void }
interface NeuralModule {
  default(options: { module_or_path: URL }): Promise<unknown>;
  NeuralRelief: { create(coarse: Uint8Array, base: Uint8Array, decoder: Uint8Array): Promise<NeuralEngine> };
  conditioning_json(params: string, grid: string): string;
  sketch_json(params: string): string;
}
interface ModelEntry { file: string; bytes: number; sha256: string }
interface Manifest { profile: string; engineRevision: string; runtimeSha256: string; models: Record<'coarse' | 'base' | 'decoder', ModelEntry> }
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
      const response = await fetch(new URL('models/manifest.json', assets));
      if (!response.ok) throw new Error('Neural models missing: run npm run wasm:neural.');
      const manifest = await response.json() as Manifest;
      modelIdentity = [manifest.runtimeSha256, ...(['coarse', 'base', 'decoder'] as const).map(name => manifest.models[name].sha256)].join(':');
      const cache = await globalThis.caches?.open('magna-urbis-neural-models-v1').catch(() => undefined);
      const models: Uint8Array[] = [];
      for (const name of ['coarse', 'base', 'decoder'] as const) {
        const entry = manifest.models[name], url = new URL(`models/${entry.file}`, assets);
        url.searchParams.set('sha256', entry.sha256);
        progress?.(`Neuronal WASM · ${name} · ${(entry.bytes / 1e6).toFixed(1)} Mo`);
        const stored = await cache?.match(url), downloaded = stored ?? await fetch(url);
        if (!downloaded.ok) throw new Error(`Cannot download ${name} weights: HTTP ${downloaded.status}`);
        const buffer = await downloaded.arrayBuffer();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), v => v.toString(16).padStart(2, '0')).join('');
        if (buffer.byteLength !== entry.bytes || digest !== entry.sha256) {
          await cache?.delete(url); throw new Error(`Invalid ${name} model: integrity check failed.`);
        }
        if (!stored) await cache?.put(url, new Response(buffer)).catch(() => {});
        models.push(new Uint8Array(buffer));
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
