// Fallback parallelism without shared memory (`?threads=pool`): N independent
// single-thread workers, each with its own WASM instance and terrain handle.
// Independent slices of one request (settlements of a quarters call, layouts of
// a parcels call, ranges of building sites) are spread over the pool and the
// calling worker, then merged in input order: the output is the serial output.
// Any pool failure re-runs that slice locally, so errors are the serial errors.
import type { SettlementRaster } from './settlements';

export type PoolOp = 'quarters' | 'parcels' | 'sites';
export type PoolArgs = Record<string, string | undefined>;
export type PoolMessage =
  | { type: 'init'; module: WebAssembly.Module }
  | { type: 'raster'; version: number; raster: SettlementRaster }
  | { type: 'job'; id: number; version: number; batch: number; op: PoolOp; args: PoolArgs; shared?: PoolArgs };
export type PoolReply = { id: number; json?: string; error?: string };

interface Helper { worker: Worker; version: number; batch: number; busy: boolean; broken: boolean; pending?: (reply: PoolReply) => void }

export interface UrbanPool {
  /** Participants including the calling worker. */
  readonly size: number;
  setRaster(raster: SettlementRaster): void;
  /**
   * Runs `jobs` (same `op`, `shared` context) on the pool and locally, returns
   * the JSON results in job order. `local` must be the exact serial operation.
   */
  run(op: PoolOp, jobs: PoolArgs[], shared: PoolArgs | undefined, local: (args: PoolArgs) => string): Promise<string[]>;
  dispose(): void;
}

export function createUrbanPool(size: number, module: WebAssembly.Module): UrbanPool {
  const helpers: Helper[] = [];
  let raster: SettlementRaster | undefined, version = 0, batch = 0, nextId = 1;
  for (let i = 0; i < size - 1; i++) {
    try {
      const worker = new Worker(new URL('./urbanPoolWorker.ts', import.meta.url), { type: 'module', name: `magna-urban-pool-${i}` });
      const helper: Helper = { worker, version: -1, batch: -1, busy: false, broken: false };
      worker.onmessage = (event: MessageEvent<PoolReply>) => { const done = helper.pending; helper.pending = undefined; done?.(event.data); };
      worker.onerror = event => { event.preventDefault(); helper.broken = true; const done = helper.pending; helper.pending = undefined; done?.({ id: -1, error: 'urban pool worker failed' }); };
      worker.postMessage({ type: 'init', module } satisfies PoolMessage);
      helpers.push(helper);
    } catch { break; }
  }
  const send = (helper: Helper, op: PoolOp, args: PoolArgs, shared: PoolArgs | undefined, current: number): Promise<PoolReply> =>
    new Promise(resolve => {
      if (helper.version !== version && raster) {
        // Structured clone (no transfer): the coordinator keeps its raster.
        helper.worker.postMessage({ type: 'raster', version, raster } satisfies PoolMessage);
        helper.version = version;
      }
      const id = nextId++;
      helper.pending = resolve;
      helper.worker.postMessage({ type: 'job', id, version, batch: current, op, args, ...(helper.batch !== current ? { shared: shared ?? {} } : {}) } satisfies PoolMessage);
      helper.batch = current;
    });
  return {
    get size() { return helpers.filter(h => !h.broken).length + 1; },
    setRaster(next) {
      raster = next; version++;
      // Eager: helpers build their terrain while the caller runs the first stage.
      for (const helper of helpers) if (!helper.broken) {
        helper.worker.postMessage({ type: 'raster', version, raster } satisfies PoolMessage);
        helper.version = version;
      }
    },
    run(op, jobs, shared, local) {
      const current = ++batch;
      const results: { json?: string; failed?: true; error?: unknown }[] = new Array(jobs.length);
      let next = 0, done = 0;
      return new Promise<string[]>((resolve, reject) => {
        // The first error in job order wins, as in the serial call.
        const settle = () => {
          if (done !== jobs.length) return;
          const failed = results.find(r => r.failed);
          // Rethrow the raw value: callers format it exactly like a serial throw.
          if (failed) reject(failed.error); else resolve(results.map(r => r.json!));
        };
        const runLocal = (i: number) => {
          try { results[i] = { json: local(jobs[i]) }; } catch (error) { results[i] = { failed: true, error }; }
          done++;
        };
        const give = (helper: Helper) => {
          if (helper.broken || next >= jobs.length) { helper.busy = false; return; }
          const i = next++;
          helper.busy = true;
          void send(helper, op, jobs[i], shared, current).then(reply => {
            // Re-run failed slices locally: same result or the serial error.
            if (reply.json === undefined) runLocal(i); else { results[i] = { json: reply.json }; done++; }
            give(helper);
            settle();
          });
        };
        for (const helper of helpers) give(helper);
        // The calling worker takes slices too, yielding between them so the
        // helpers' replies can be answered with the next slice.
        const step = () => {
          if (next < jobs.length) { runLocal(next++); setTimeout(step, 0); }
          settle();
        };
        step();
      });
    },
    dispose() { for (const h of helpers) h.worker.terminate(); helpers.length = 0; },
  };
}

/** `parts` contiguous, non-empty [start, end) ranges covering `total` items. */
export function ranges(total: number, parts: number): [number, number][] {
  const out: [number, number][] = [];
  const count = Math.max(1, Math.min(total, parts));
  for (let k = 0; k < count; k++) out.push([Math.floor(total * k / count), Math.floor(total * (k + 1) / count)]);
  return out.filter(([a, b]) => b > a);
}
