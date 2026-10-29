// Browser WASM execution mode, without loading any package (page code imports
// this; the loader is `wasmRuntime.ts`).
//
// `?threads=auto|on|off|pool` on the page (default auto). auto/on load
// `pkg/wasm-threads` when the page is cross-origin isolated (COOP/COEP headers,
// or the coi-serviceworker on github.io) and SharedArrayBuffer exists; otherwise
// the single-thread `pkg/wasm`. `pool` keeps the single-thread package and
// spreads independent work over several workers (`urbanPool.ts`).
// Workers do not see the page URL: page code passes the setting through the
// worker name (`wasmWorkerOptions()`). The chosen mode is on
// `window.magnaWasmThreads` (expected mode first, then what a worker reported).

export type WasmThreadsSetting = 'auto' | 'on' | 'off' | 'pool';
export type WasmThreadsMode = 'threads' | 'single' | 'pool';
export interface WasmThreadsInfo {
  setting: WasmThreadsSetting; mode: WasmThreadsMode;
  /** Rayon pool threads (threads mode) or pool workers (pool mode); 1 otherwise. */
  threads: number;
  /** Why auto/on stayed single-threaded, when it did. */
  reason?: string;
}

/** Upper bound of rayon threads / pool workers: memory per thread and diminishing returns. */
export const MAX_WASM_THREADS = 8;
const SETTINGS: readonly string[] = ['auto', 'on', 'off', 'pool'];

// Lazy and empty when the threads package was not built: auto then falls back.
const threadsJs = import.meta.glob('../pkg/wasm-threads/magna_urbis_wasm.js');
const threadsWasm = import.meta.glob<string>('../pkg/wasm-threads/magna_urbis_wasm_bg.wasm', { query: '?url&inline', import: 'default' });
export const threadsJsLoad = Object.values(threadsJs)[0] as (() => Promise<unknown>) | undefined;
export const threadsWasmLoad = Object.values(threadsWasm)[0];

const scope = globalThis as unknown as { name?: string; location?: { search?: string }; WorkerGlobalScope?: unknown; magnaWasmThreads?: WasmThreadsInfo };
export const inWorker = (): boolean => typeof scope.WorkerGlobalScope === 'function' && globalThis instanceof (scope.WorkerGlobalScope as typeof Object);

/** The requested setting: worker name (`threads=…`) in workers, page query otherwise. */
export function wasmThreadsSetting(): WasmThreadsSetting {
  if (inWorker()) {
    const named = /(?:^|[\s;&])threads=(auto|on|off|pool)\b/.exec(scope.name ?? '')?.[1];
    if (named) return named as WasmThreadsSetting;
  }
  try {
    const query = new URLSearchParams(scope.location?.search ?? '').get('threads');
    if (query && SETTINGS.includes(query)) return query as WasmThreadsSetting;
  } catch { /* no location */ }
  return 'auto';
}
/** Options for `new Worker(...)` / Vite `?worker` constructors: carries the setting. */
export function wasmWorkerOptions(name = 'magna-wasm'): WorkerOptions {
  return { name: `${name} threads=${wasmThreadsSetting()}` };
}
export const threadsIsolated = (): boolean => !!(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated && typeof SharedArrayBuffer === 'function';
export const threadsPackageBuilt = (): boolean => !!threadsJsLoad && !!threadsWasmLoad;
/** Rayon threads / pool workers for this device: cores - 1, capped. */
export function wasmThreadCount(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(cores - 1, MAX_WASM_THREADS));
}

/** What the loader would choose here, without loading anything. */
export function expectedWasmThreads(setting = wasmThreadsSetting()): WasmThreadsInfo {
  if (setting === 'off') return { setting, mode: 'single', threads: 1 };
  if (setting === 'pool') return { setting, mode: 'pool', threads: wasmThreadCount() };
  const reason = !threadsIsolated() ? 'page not cross-origin isolated (no SharedArrayBuffer)'
    : !threadsPackageBuilt() ? 'pkg/wasm-threads not built' : undefined;
  return reason ? { setting, mode: 'single', threads: 1, reason } : { setting, mode: 'threads', threads: wasmThreadCount() };
}

let current: WasmThreadsInfo | undefined;
/** Loader side: the mode actually loaded in this realm. */
export function setWasmThreadsInfo(info: WasmThreadsInfo): void { current = info; }
/** The mode loaded in this realm, else the one a worker reported, else the expectation. */
export function wasmThreadsInfo(): WasmThreadsInfo { return current ?? scope.magnaWasmThreads ?? expectedWasmThreads(); }
/** Page side: record the mode a worker reported (read by the benches). */
export function publishWasmThreads(info: WasmThreadsInfo | undefined): void {
  if (info) scope.magnaWasmThreads = info;
}
if (!inWorker()) scope.magnaWasmThreads ??= expectedWasmThreads();
