import { verifyNeuralFile, type NeuralManifest } from './neuralModels';

/** Browser-only runtime cache, keyed by the identified WASM build, separate from weights. */
export async function obtainNeuralRuntime(assets: string, manifest: NeuralManifest, signal?: AbortSignal) {
  const cache = await globalThis.caches?.open('magna-urbis-neural-runtime-v1');
  async function obtain(file: string, sha256?: string): Promise<Uint8Array<ArrayBuffer>> {
    const url = new URL(file, assets); url.searchParams.set('sha256', sha256 ?? manifest.runtimeSha256);
    const valid = (bytes: Uint8Array) => sha256 ? verifyNeuralFile(bytes, { bytes: bytes.length, sha256 }) : Promise.resolve(true);
    let savedUrl = url.href, saved = await cache?.match(url);
    if (cache && !saved) {
      for (const request of await cache.keys()) {
        const candidate = new URL(request.url);
        if (candidate.pathname.split('/').pop() !== file || candidate.searchParams.get('sha256') !== url.searchParams.get('sha256')) continue;
        saved = await cache.match(request);
        if (saved) { savedUrl = request.url; break; }
      }
    }
    if (saved) {
      const bytes = new Uint8Array(await saved.arrayBuffer());
      if (await valid(bytes)) return bytes;
      await cache?.delete(savedUrl);
    }
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Neural runtime unavailable. Check your connection and retry.');
    const bytes = new Uint8Array(await response.arrayBuffer()); signal?.throwIfAborted();
    if (!await valid(bytes)) throw new Error('Neural runtime integrity check failed. Please retry.');
    await cache?.put(url, new Response(bytes));
    return bytes;
  }
  const javascript = await obtain('magna_urbis_neural_wasm.js', manifest.runtimeJsSha256);
  const wasm = await obtain('magna_urbis_neural_wasm_bg.wasm', manifest.runtimeSha256);
  return { javascript, wasm };
}
