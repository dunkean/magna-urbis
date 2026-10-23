import { isSurfaceBinary } from './binary';
import { assertNotAborted, type TerrainGrid } from './model';
import { SURFACE_WORKER_PROTOCOL, type SurfaceWorkerInitialization, type SurfaceWorkerJob, type SurfaceWorkerRequest, type SurfaceWorkerResponse, type SurfaceWorkerRegion } from './workerProtocol';

export interface SurfaceCompilerWorker {
  onmessage: ((event: MessageEvent<SurfaceWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  postMessage(message: SurfaceWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}
export interface SurfaceCompilerResult { binary: ArrayBuffer; contextId: string; environmentVersion: string; canonicalBuildCount: number }
export interface SurfaceCompilerJob {
  terrain: TerrainGrid; region: SurfaceWorkerRegion;
  maxCandidates?: number; maxCheckedSlots?: number; binaryBudgetBytes?: number; memoryBudgetBytes?: number;
}
interface Pending {
  id: number; resolve(value: SurfaceCompilerResult): void; reject(error: Error): void;
  signal?: AbortSignal; abort(): void;
}
let clientSequence = 0;

/** One persistent worker caches the canonical context. Abort/supersession terminates active computation, then the next job reinitializes a fresh worker. */
export class SurfaceCompilerClient {
  private worker?: SurfaceCompilerWorker;
  private pending?: Pending;
  private generation = 0;
  private requestSequence = 0;
  private disposed = false;
  private readonly clientId = ++clientSequence;
  private sessionId = '';
  environmentVersion?: string;
  constructor(private initialization: SurfaceWorkerInitialization, private readonly workerFactory: () => SurfaceCompilerWorker) {}
  private stopWorker(): void { const old = this.worker; this.worker = undefined; if (old) { old.onmessage = null; old.onerror = null; old.onmessageerror = null; old.terminate(); } }
  private finish(error?: Error, value?: SurfaceCompilerResult): void {
    const pending = this.pending; this.pending = undefined;
    if (!pending) return;
    pending.signal?.removeEventListener('abort', pending.abort);
    error ? pending.reject(error) : pending.resolve(value!);
  }
  /** Idle workers keep their canonical cache. Active workers are physically terminated. */
  cancel(): void {
    if (!this.pending) return;
    this.stopWorker(); this.finish(new DOMException('Surface compilation cancelled or superseded', 'AbortError'));
  }
  invalidate(initialization: SurfaceWorkerInitialization): void {
    this.cancel(); this.stopWorker(); this.initialization = initialization; this.environmentVersion = undefined;
  }
  dispose(): void { this.disposed = true; this.cancel(); this.stopWorker(); }
  private ensureWorker(): SurfaceCompilerWorker {
    if (this.worker) return this.worker;
    const worker = this.workerFactory(); this.worker = worker;
    const generation = ++this.generation;
    this.sessionId = `surface-${this.clientId}-${generation}`;
    worker.onmessage = event => {
      if (this.worker !== worker || generation !== this.generation) return;
      const m = event.data;
      if (!m || m.protocol !== SURFACE_WORKER_PROTOCOL) { this.stopWorker(); this.finish(new Error('Invalid surface compiler response protocol')); return; }
      if (m.sessionId !== this.sessionId || m.sourceEpoch !== this.initialization.sourceEpoch || m.sceneEpoch !== this.initialization.sceneEpoch) return;
      if (m.kind === 'initialized') return;
      if (!this.pending || m.requestId !== undefined && m.requestId !== this.pending.id) return;
      if (m.kind === 'error') {
        const error = new Error(m.error.message); error.name = m.error.name;
        this.stopWorker(); this.finish(error); return;
      }
      if (m.kind !== 'compiled' || !(m.binary instanceof ArrayBuffer) || !isSurfaceBinary(new Uint8Array(m.binary))) {
        this.stopWorker(); this.finish(new Error('Surface compiler returned an invalid binary packet')); return;
      }
      this.environmentVersion = m.environmentVersion;
      this.finish(undefined, { binary: m.binary, contextId: m.contextId, environmentVersion: m.environmentVersion, canonicalBuildCount: m.canonicalBuildCount });
    };
    worker.onerror = event => {
      if (this.worker !== worker || generation !== this.generation) return;
      this.stopWorker(); this.finish(new Error(event.message || 'Surface compiler worker failed'));
    };
    worker.onmessageerror = () => {
      if (this.worker !== worker || generation !== this.generation) return;
      this.stopWorker(); this.finish(new Error('Surface compiler response could not be transferred'));
    };
    worker.postMessage({ protocol: SURFACE_WORKER_PROTOCOL, kind: 'initialize', sessionId: this.sessionId, ...this.initialization });
    return worker;
  }
  compile(job: SurfaceCompilerJob, signal?: AbortSignal): Promise<SurfaceCompilerResult> {
    if (this.disposed) return Promise.reject(new Error('Surface compiler client is disposed'));
    try { assertNotAborted(signal); } catch (error) { return Promise.reject(error); }
    this.cancel();
    const requestId = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel();
      this.pending = { id: requestId, resolve, reject, signal, abort };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const worker = this.ensureWorker();
        assertNotAborted(signal);
        // Only the new copy is transferred; caller/provider/retained buffers remain usable.
        const terrain = { ...job.terrain, source: { ...job.terrain.source }, heights: new Float32Array(job.terrain.heights) };
        const message: SurfaceWorkerJob = { ...job, terrain, protocol: SURFACE_WORKER_PROTOCOL, kind: 'compile', sessionId: this.sessionId,
          sourceEpoch: this.initialization.sourceEpoch, sceneEpoch: this.initialization.sceneEpoch, requestId };
        worker.postMessage(message, [terrain.heights.buffer]);
      } catch (error) { this.stopWorker(); this.finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }
}
