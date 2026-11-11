// Core WASM loader: the single-thread package (`pkg/wasm`) or, in an isolated
// worker, the shared-memory package (`pkg/wasm-threads`) with its rayon pool
// (wasm-bindgen-rayon `initThreadPool`). Mode selection: `wasmThreads.ts`.
import singleInit, * as single from '../pkg/wasm/magna_urbis_wasm.js';
import singleJsUrl from '../pkg/wasm/magna_urbis_wasm.js?url';
import singleWasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import { expectedWasmThreads, inWorker, setWasmThreadsInfo, threadsJsLoad, threadsWasmLoad, wasmThreadsInfo } from './wasmThreads';
export * from './wasmThreads';

export type CoreWasm = typeof single;
let activeCoreWasm: CoreWasm = single;
let synchronousSingleReady = false;
/** Every synchronous bridge requires an asynchronous load first. */
export function synchronousCoreWasm(): CoreWasm {
  if (!synchronousSingleReady && activeCoreWasm === singleInstance) throw new Error('Core WASM is not ready: await loadCoreWasm() first.');
  return activeCoreWasm;
}
let singleInstance: CoreWasm = single;
type ThreadsWasm = CoreWasm & { initThreadPool?: (threads: number) => Promise<unknown> };

// Live bindings: bridges import the classes from here, so they follow the
// package `loadCoreWasm` selected (objects never mix the two instances).
// (Read defensively: partial test mocks of the package throw on missing exports.)
const pick = <K extends keyof CoreWasm>(key: K): CoreWasm[K] => { try { return single[key]; } catch { return undefined as never; } };
export let SettlementTerrain = pick('SettlementTerrain'); export type SettlementTerrain = single.SettlementTerrain;
export let TerrainEngine = pick('TerrainEngine'); export type TerrainEngine = single.TerrainEngine;
export let TerrainPipeline = pick('TerrainPipeline'); export type TerrainPipeline = single.TerrainPipeline;
export let GenerationNoisePlan = pick('GenerationNoisePlan'); export type GenerationNoisePlan = single.GenerationNoisePlan;
export let HydrologyEngine = pick('HydrologyEngine'); export type HydrologyEngine = single.HydrologyEngine;
export let erosion_defaults = pick('erosion_defaults');
export let flood_hydrology = pick('flood_hydrology');
export let erode_relief = pick('erode_relief');
export let set_erosion_tuning = pick('set_erosion_tuning');
function select(mod: CoreWasm): CoreWasm {
  activeCoreWasm = mod;
  ({ SettlementTerrain, TerrainEngine, TerrainPipeline, GenerationNoisePlan, HydrologyEngine, erosion_defaults, flood_hydrology, erode_relief, set_erosion_tuning } = mod);
  return mod;
}

let loading: Promise<CoreWasm> | undefined;
let singleLoading: Promise<CoreWasm> | undefined;
let singleModule: Promise<WebAssembly.Module> | undefined;
const initWith = (init: unknown, module_or_path: WebAssembly.Module | ArrayBuffer) =>
  (init as (options: { module_or_path: WebAssembly.Module | ArrayBuffer }) => Promise<unknown>)({ module_or_path });

/**
 * Streaming compilation: the module compiles while it downloads, and the browser
 * keeps the optimised code in its cache for the next visit (array-buffer
 * compiles are never code-cached). Falls back when the server sends another MIME type.
 */
export async function compileWasm(url: string): Promise<WebAssembly.Module> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`WASM download failed: HTTP ${response.status} (${url.slice(0, 80)})`);
  if (typeof WebAssembly.compileStreaming === 'function' && /^application\/wasm/.test(response.headers.get('content-type') ?? '')) return WebAssembly.compileStreaming(response);
  return WebAssembly.compile(await response.arrayBuffer());
}
/** The compiled single-thread module (pool workers instantiate it without recompiling). */
export function singleWasmModule(): Promise<WebAssembly.Module> {
  return singleModule ??= compileWasm(singleWasmUrl).catch(error => { singleModule = undefined; throw error; });
}
/** A rayon pool whose workers never report (blocked worker scripts in some WebViews) must not hold the engine forever. */
export const THREAD_POOL_START_MS = 15000;
function deadline<T>(operation: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}
/** The single-thread package, initialised once per realm. */
export function loadSingleWasm(): Promise<CoreWasm> {
  if (singleRecovery) return singleRecovery.then(() => singleInstance);
  // Asynchronous compile and instantiation: browsers refuse both synchronously on the main thread for this module.
  return singleLoading ??= singleWasmModule()
    .then(async module => {
      if (!synchronousSingleReady) await initWith(singleInit, module);
      synchronousSingleReady = true; return singleInstance;
    });
}
/** Whether `loadCoreWasm` would start the threads package in this realm. */
export const wantsWasmThreads = (): boolean => expectedWasmThreads().mode === 'threads' && inWorker();
const singleInfo = () => {
  const expected = expectedWasmThreads();
  return expected.mode === 'threads' ? { ...expected, mode: 'single' as const, threads: 1, reason: 'main thread (rayon needs a worker)' } : expected;
};
/**
 * The core WASM package for this realm, initialised once. Threads only start
 * in a worker (rayon blocks with Atomics.wait, refused on the main thread) and
 * fall back to the single-thread package on any failure (e.g. a browser that
 * cannot reserve the 4 GiB shared memory).
 */
export function loadCoreWasm(): Promise<CoreWasm> {
  if (singleRecovery) return singleRecovery.then(() => singleInstance);
  return loading ??= (async () => {
    if (!threadsFailure && wantsWasmThreads() && threadsJsLoad && threadsWasmLoad) {
      const expected = expectedWasmThreads();
      try {
        const [mod, url] = await Promise.all([threadsJsLoad() as Promise<ThreadsWasm>, threadsWasmLoad()]);
        // Compiled once (streaming, code-cached); rayon workers receive this module, they never recompile it.
        await initWith(mod.default, await compileWasm(url));
        await deadline(mod.initThreadPool!(expected.threads), THREAD_POOL_START_MS, `rayon pool of ${expected.threads} workers did not start within ${THREAD_POOL_START_MS / 1000} s`);
        setWasmThreadsInfo(expected);
        threadsModule = mod;
        return select(mod);
      } catch (error) {
        console.warn('WASM threads unavailable, using the single-thread package:', error);
        threadsFailure = `threads package failed to start: ${errorText(error)}`;
        setWasmThreadsInfo({ ...expected, mode: 'single', threads: 1, reason: threadsFailure });
        return select(await loadSingleWasm());
      }
    }
    if (threadsFailure) setWasmThreadsInfo({ ...expectedWasmThreads(), mode: 'single', threads: 1, reason: threadsFailure });
    else setWasmThreadsInfo(singleInfo());
    return select(await loadSingleWasm());
  })();
}

// The threads package unwinds (panic=unwind): a Rust panic reaches JS as a
// PanicError and the instance stays usable, but any other exception escaping a
// call (a trap: out of memory, `unreachable`, abort) marks the instance
// terminated and every later call throws "Module terminated". A worker cannot
// instantiate the same glue twice, so the realm moves to the single-thread package.
let threadsModule: ThreadsWasm | undefined;
let threadsFailure: string | undefined;
const terminatedModules = new WeakSet<object>();
let singleRecovery: Promise<void> | undefined;
let singleGeneration = 0;
const errorText = (error: unknown): string => error instanceof Error ? `${error.name === 'Error' ? '' : error.name + ': '}${error.message}` : String(error);
/** Whether the threads instance of this realm is terminated (its guard refuses calls). */
export function coreWasmTerminated(): boolean {
  if (!threadsModule) return false;
  try { threadsModule.wasm_threads(); return false; } catch (error) { return /Module terminated/.test(String(error)); }
}
const resetListeners = new Set<() => void>();
/** Bridges drop their cached instances of the dead package (they cannot be freed). */
export function onCoreWasmReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}
/**
 * After a failed call: when it terminated the threads instance, switch this
 * realm to the single-thread package (recorded on `wasmThreadsInfo().reason`),
 * reset the bridges and return true so the caller retries once. False when the
 * error is an ordinary one (the instance is still usable). `used`: the package
 * the caller holds, true when it is one an earlier recovery already replaced.
 */
export async function recoverCoreWasm(error: unknown, used?: CoreWasm): Promise<boolean> {
  if (used && terminatedModules.has(used)) { await loadCoreWasm(); return true; }
  if (activeCoreWasm === singleInstance && (error instanceof WebAssembly.RuntimeError || /unreachable|Module terminated/.test(String(error)))) {
    if (singleRecovery) { await singleRecovery; return true; }
    const dead = singleInstance;
    terminatedModules.add(dead); synchronousSingleReady = false;
    singleRecovery = (async () => {
      // wasm-bindgen init caches its instance: fresh glue is needed after panic=abort.
      const url = new URL(singleJsUrl, import.meta.url); url.searchParams.set('recovery', String(++singleGeneration));
      const fresh = await import(/* @vite-ignore */ url.href) as CoreWasm;
      await initWith(fresh.default, await singleWasmModule());
      singleInstance = fresh; synchronousSingleReady = true;
      singleLoading = Promise.resolve(fresh); loading = singleLoading; select(fresh);
      for (const listener of resetListeners) { try { listener(); } catch (e) { console.warn(e); } }
    })().finally(() => { singleRecovery = undefined; });
    await singleRecovery; return true;
  }
  if (!coreWasmTerminated()) return false;
  terminatedModules.add(threadsModule!);
  const expected = expectedWasmThreads();
  threadsFailure = `threads module terminated: ${errorText(error)}`;
  console.error(`WASM threads module terminated; continuing on the single-thread package. First error:`, error);
  threadsModule = undefined;
  loading = undefined;
  setWasmThreadsInfo({ ...expected, mode: 'single', threads: 1, reason: threadsFailure });
  await loadCoreWasm();
  for (const listener of resetListeners) { try { listener(); } catch (reset) { console.warn('WASM reset listener failed:', reset); } }
  return true;
}
/**
 * A caller that initialises the single-thread package itself (with download
 * progress) records it, so a later `loadCoreWasm` in this realm keeps that
 * instance instead of switching packages.
 */
export function adoptSingleWasm(initialise: () => Promise<unknown>): Promise<CoreWasm> {
  if (loading) return loading;
  setWasmThreadsInfo(singleInfo());
  return loading = singleLoading = initialise().then(() => { synchronousSingleReady = true; return singleInstance; }, error => { loading = singleLoading = undefined; throw error; });
}
