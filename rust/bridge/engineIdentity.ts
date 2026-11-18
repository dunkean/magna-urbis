/**
 * Identity of the engine binary that computes a stage. The page keys its retained stage results with it
 * (placement, roads, urban products), so a rebuilt native engine or WASM package is asked again instead of
 * the page reusing what the previous binary produced.
 *
 * - Native: the `build` field of the engine's `/status` (version, executable size and modification time),
 *   recorded by every health probe and restart wait (`nativeAvailability.ts`).
 * - WASM: a fingerprint of the core module the page loads (its inlined bytes in builds; in the dev server,
 *   whose URL never changes, the file's ETag/Last-Modified read by `refreshWasmBuild`).
 *
 * The page resolves both before a run and stamps them on the run's settings (`EngineBuilds`), so the
 * generation worker records its results under the same identities the page later compares.
 */
export interface EngineBuilds {
  native?: string;
  wasm?: string;
}

const nativeBuilds = new Map<string, string>();
const origin = (server: string) => server.replace(/\/+$/, '');
/** `build` undefined forgets it: an engine that does not answer is not the identity of the next run. */
export function recordNativeBuild(server: string, build: string | undefined): void {
  if (build) nativeBuilds.set(origin(server), build);
  else nativeBuilds.delete(origin(server));
}
export function nativeBuild(server: string): string | undefined {
  return nativeBuilds.get(origin(server));
}

let wasmUrl: string | undefined, wasmId: string | undefined, wasmServed: string | undefined, stampedWasm: string | undefined;
/** Called by the WASM loader with the URL of its core module. */
export function registerWasmModuleUrl(url: string): void {
  if (url !== wasmUrl) {
    wasmUrl = url;
    wasmId = undefined;
    wasmServed = undefined;
  }
}
/** Sampled FNV-1a of a (possibly 30+ MB) data URL: a rebuilt module shifts its bytes everywhere. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 61) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}
export function wasmBuild(): string {
  if (!wasmUrl) return 'wasm';
  wasmId ??= wasmUrl.startsWith('data:') ? fingerprint(wasmUrl) : wasmUrl;
  return wasmServed ? `${wasmId}#${wasmServed}` : wasmId;
}
let served: { url: string; done: Promise<void> } | undefined;
/** Dev server: the module URL is constant, so ask the server once per page session for the file's validator
 * (a HEAD, no download): the module this realm runs does not change until the page reloads. Node (tests,
 * scripts) reads files, not URLs: nothing to ask. */
export async function refreshWasmBuild(): Promise<string> {
  const url = wasmUrl,
    node = typeof process !== 'undefined' && !!process.versions?.node && !('document' in globalThis);
  if (url && !url.startsWith('data:') && !node && typeof fetch === 'function' && served?.url !== url) {
    served = {
      url,
      done: (async () => {
        try {
          const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
          const validator = response.headers.get('etag') ?? response.headers.get('last-modified') ?? response.headers.get('content-length');
          if (response.ok && validator && wasmUrl === url) wasmServed = validator;
        } catch {
          /* Keep the URL identity. */
        }
      })(),
    };
  }
  await served?.done;
  return wasmBuild();
}

/** Identity of the engine a stage runs on: `backend` as the settings name it ('native' | 'rust' | 'typescript').
 * A native backend whose build is unknown (engine offline) runs in the browser: the WASM identity. */
export function engineIdentity(backend: string | undefined, server: string, stamped?: EngineBuilds): string {
  // A stamped run teaches this realm (the generation worker) the page's identities: its later
  // unstamped requests (resource payloads) then share the same retained engine handle.
  if (stamped?.native) recordNativeBuild(server, stamped.native);
  if (stamped?.wasm) stampedWasm = stamped.wasm;
  if (!backend || backend === 'typescript') return 'typescript';
  const native = backend === 'native' ? (stamped?.native ?? nativeBuild(server)) : undefined;
  return native ? `native:${native}` : `wasm:${stamped?.wasm ?? stampedWasm ?? wasmBuild()}`;
}
