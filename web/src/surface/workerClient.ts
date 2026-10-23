import { isSurfaceBinary } from './binary';
import { assertNotAborted, type TerrainGrid } from './model';
import type { SurfaceRegistrationBinding } from './registrationBinding';
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
  registrationBinding?: Readonly<SurfaceRegistrationBinding>;
}
interface Pending {
  id: number; job: SurfaceCompilerJob; resolve(value: SurfaceCompilerResult): void; reject(error: Error): void;
  signal?: AbortSignal; abort(): void;
}
let clientSequence = 0;

/** One durable canonical build, one active job and one latest queued job.
 * Supersession rejects immediately without repeatedly discarding the initial context.
 * Epoch changes/dispose terminate immediately; a cancelled computation has a bounded grace period.
 */
export class SurfaceCompilerClient {
  private worker?: SurfaceCompilerWorker;
  private pending?: Pending;
  private activeRequestId?: number;
  private cancellationTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private requestSequence = 0;
  private disposed = false;
  private readonly clientId = ++clientSequence;
  private sessionId = '';
  environmentVersion?: string;
  constructor(private initialization: SurfaceWorkerInitialization, private readonly workerFactory: () => SurfaceCompilerWorker,
    private readonly cancellationGraceMs = 30000) {}
  private clearGrace(): void { if (this.cancellationTimer) clearTimeout(this.cancellationTimer); this.cancellationTimer = undefined; }
  private stopWorker(): void {
    this.clearGrace(); this.activeRequestId = undefined;
    const old = this.worker; this.worker = undefined;
    if (old) { old.onmessage = null; old.onerror = null; old.onmessageerror = null; old.terminate(); }
  }
  private finish(error?: Error, value?: SurfaceCompilerResult): void {
    const pending = this.pending; this.pending = undefined;
    if (!pending) return;
    pending.signal?.removeEventListener('abort', pending.abort);
    error ? pending.reject(error) : pending.resolve(value!);
  }
  cancel(): void {
    if (!this.pending) return;
    this.finish(new DOMException('Surface compilation cancelled or superseded', 'AbortError'));
    if (this.activeRequestId !== undefined && !this.cancellationTimer) {
      this.cancellationTimer = setTimeout(() => {
        this.stopWorker();
        // A newer queued job gets a fresh worker after the bounded grace period.
        if (this.pending) { this.ensureWorker(); this.pump(); }
      }, this.cancellationGraceMs);
    }
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
      if (m.kind === 'error' && m.requestId === undefined) {
        this.stopWorker(); this.finish(new Error(m.error.message)); return;
      }
      if (m.requestId !== this.activeRequestId) return;
      const current = this.pending?.id === m.requestId;
      this.activeRequestId = undefined; this.clearGrace();
      if (m.kind === 'error') {
        const error = new Error(m.error.message); error.name = m.error.name;
        // Routed validation failures leave a valid canonical cache alive.
        if (current) this.finish(error);
        this.pump(); return;
      }
      if (m.kind !== 'compiled' || !(m.binary instanceof ArrayBuffer) || !isSurfaceBinary(new Uint8Array(m.binary))) {
        this.stopWorker(); this.finish(new Error('Surface compiler returned an invalid binary packet')); return;
      }
      this.environmentVersion = m.environmentVersion;
      if (current) this.finish(undefined, { binary: m.binary, contextId: m.contextId, environmentVersion: m.environmentVersion, canonicalBuildCount: m.canonicalBuildCount });
      this.pump();
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
  private pump(): void {
    const pending = this.pending;
    if (!pending || this.activeRequestId !== undefined) return;
    try {
      const worker = this.ensureWorker(); assertNotAborted(pending.signal);
      const terrain = { ...pending.job.terrain, source: { ...pending.job.terrain.source }, heights: new Float32Array(pending.job.terrain.heights) };
      const message: SurfaceWorkerJob = { ...pending.job, terrain, protocol: SURFACE_WORKER_PROTOCOL, kind: 'compile', sessionId: this.sessionId,
        sourceEpoch: this.initialization.sourceEpoch, sceneEpoch: this.initialization.sceneEpoch, requestId: pending.id };
      this.activeRequestId = pending.id;
      worker.postMessage(message, [terrain.heights.buffer]);
    } catch (error) { this.stopWorker(); this.finish(error instanceof Error ? error : new Error(String(error))); }
  }
  compile(job: SurfaceCompilerJob, signal?: AbortSignal): Promise<SurfaceCompilerResult> {
    if (this.disposed) return Promise.reject(new Error('Surface compiler client is disposed'));
    try { assertNotAborted(signal); } catch (error) { return Promise.reject(error); }
    this.cancel();
    const requestId = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel();
      this.pending = { id: requestId, job, resolve, reject, signal, abort };
      signal?.addEventListener('abort', abort, { once: true });
      this.pump();
    });
  }
}
