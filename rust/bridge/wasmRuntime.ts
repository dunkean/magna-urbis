// Core WASM loader: the single-thread package (`pkg/wasm`) or, in an isolated
// worker, the shared-memory package (`pkg/wasm-threads`) with its rayon pool
// (wasm-bindgen-rayon `initThreadPool`). Mode selection: `wasmThreads.ts`.
import singleInit, * as single from '../pkg/wasm/magna_urbis_wasm.js';
import singleWasmUrl from '../pkg/wasm/magna_urbis_wasm_bg.wasm?url&inline';
import { expectedWasmThreads, inWorker, setWasmThreadsInfo, threadsJsLoad, threadsWasmLoad, wasmThreadsInfo } from './wasmThreads';
export * from './wasmThreads';

export type CoreWasm = typeof single;
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
  ({ SettlementTerrain, TerrainEngine, TerrainPipeline, GenerationNoisePlan, HydrologyEngine, erosion_defaults, flood_hydrology, erode_relief, set_erosion_tuning } = mod);
  return mod;
}

let loading: Promise<CoreWasm> | undefined;
let singleLoading: Promise<CoreWasm> | undefined;
let singleModule: Promise<WebAssembly.Module> | undefined;
const initWith = (init: unknown, module_or_path: WebAssembly.Module | ArrayBuffer) =>
  (init as (options: { module_or_path: WebAssembly.Module | ArrayBuffer }) => Promise<unknown>)({ module_or_path });

/** The compiled single-thread module (pool workers instantiate it without recompiling). */
export function singleWasmModule(): Promise<WebAssembly.Module> {
  return singleModule ??= fetch(singleWasmUrl).then(r => r.arrayBuffer()).then(bytes => WebAssembly.compile(bytes));
}
/** The single-thread package, initialised once per realm. */
export function loadSingleWasm(): Promise<CoreWasm> {
  return singleLoading ??= (singleModule ?? fetch(singleWasmUrl).then(r => r.arrayBuffer()))
    .then(module => initWith(singleInit, module)).then(() => single);
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
  return loading ??= (async () => {
    if (wantsWasmThreads() && threadsJsLoad && threadsWasmLoad) {
      const expected = expectedWasmThreads();
      try {
        const [mod, url] = await Promise.all([threadsJsLoad() as Promise<ThreadsWasm>, threadsWasmLoad()]);
        await initWith(mod.default, await (await fetch(url)).arrayBuffer());
        await mod.initThreadPool!(expected.threads);
        setWasmThreadsInfo(expected);
        return select(mod);
      } catch (error) {
        console.warn('WASM threads unavailable, using the single-thread package:', error);
        setWasmThreadsInfo({ ...expected, mode: 'single', threads: 1, reason: String(error) });
        return loadSingleWasm();
      }
    }
    setWasmThreadsInfo(singleInfo());
    return loadSingleWasm();
  })();
}
/**
 * A caller that initialises the single-thread package itself (with download
 * progress) records it, so a later `loadCoreWasm` in this realm keeps that
 * instance instead of switching packages.
 */
export function adoptSingleWasm(initialise: () => Promise<unknown>): Promise<CoreWasm> {
  if (loading) return loading;
  setWasmThreadsInfo(singleInfo());
  return loading = singleLoading = initialise().then(() => single, error => { loading = singleLoading = undefined; throw error; });
}
