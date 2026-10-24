/** Actual City scene client for the shared worker/fallback producer. There is
 * one authoritative source receiver and a durable CAS before UI publication. */
import SceneWorker from './urbanSceneWorker?worker&inline';
import { produceUrbanParentScene } from './urbanParentSceneProducer';
import { urbanSceneTransport, type UrbanSceneRequest, type UrbanSceneResponse } from './urbanSceneProtocol';
import { createUrbanParentReceiver, type UrbanParentStageOptions } from './urbanParentPipeline';
import { parseNativeParentBatchJson, parentSessionAssert } from '../../../rust/bridge/nativeParentSessionValidation';
import { sameParentSessionReceipt, type BeginParentSessionReply, type ParentSessionReceipt } from '../../../rust/bridge/nativeParentSessionContract';
import { NATIVE_PARENT_SCHEMA, validateParentBatch, type NativeParentBatch } from '../../../rust/bridge/nativeParentContract';
import type { ParentChunkBackend, ParentSceneManifest } from './urbanParentChunkStore';
import type { UrbanParentWorkerBatch, UrbanParentWorkerDrained, UrbanParentAcknowledged } from './urbanParentSceneProtocol';
export type UrbanParentSceneInput = Omit<UrbanSceneRequest, 'id' | 'progressive' | 'parentSession'> & { mode: 'compact' | 'detailed'; parentSession: NonNullable<UrbanSceneRequest['parentSession']> };
export interface UrbanParentSceneResult { kind: 'cold-native-parent-scene'; id: number;
  store: Pick<ParentSceneManifest, 'format' | 'sceneId' | 'fingerprint' | 'sourceFingerprint'>;
  counts: ParentSceneManifest['counts'] & Pick<ParentSceneManifest, 'schema_version' | 'generator_version'>;
  generation: NonNullable<ParentSceneManifest['generation']>; timing?: NonNullable<UrbanSceneResponse['parentComplete']>['timing'] }
export interface UrbanParentSceneOptions extends UrbanParentStageOptions { backend: ParentChunkBackend;
  forceFallback?: boolean;
  onAcknowledged?(value: UrbanParentAcknowledged): void | Promise<void>;
  progress?(completed: number, total: number): void;
  /** Bounded preview/cache consumer of THIS successful native batch only. */
  onBatch?(batch: NativeParentBatch, message: UrbanParentWorkerBatch): void | Promise<void> }
type Receiver = Awaited<ReturnType<typeof createUrbanParentReceiver>>;
export function createUrbanParentSceneClient() {
  let worker: Worker | undefined, nextId = 0, current: Run | undefined, barrier: Promise<void> = Promise.resolve(), disposed = false;
  const workerRuns = new Map<number, { worker: Worker; promise: Promise<UrbanParentWorkerDrained>; resolve(value: UrbanParentWorkerDrained): void }>();
  interface Run { request: UrbanSceneRequest; options: UrbanParentSceneOptions; abort: AbortController; begin?: BeginParentSessionReply; lastReceipt?: ParentSessionReceipt;
    receiver?: Receiver; work: Promise<void>; producer?: Promise<void>; workerDrain?: Promise<UrbanParentWorkerDrained>; stopping: boolean; received: number;
    resolve(value: UrbanParentSceneResult): void; reject(error: unknown): void; removeSignal(): void }
  const live = (item: Run) => current === item && !item.abort.signal.aborted && !disposed;
  function stop(item: Run, reason: unknown) {
    if (item.stopping) return; item.stopping = true; item.abort.abort(reason); item.removeSignal();
    if (current === item) current = undefined;
    try { worker?.postMessage({ cancel: item.request.id }); } catch { /* native cleanup still belongs to its draining producer */ }
    const cleanup = Promise.allSettled([item.work, item.producer, item.workerDrain] as const).then(async results => {
      const terminal = results[2];
      const late = terminal.status === 'fulfilled' ? terminal.value : undefined;
      const actualReason = late && (late.state === 'worker_failed' || late.error?.startsWith('AggregateError:'))
        ? new AggregateError([reason, new Error(late.error ?? 'Native worker cleanup unconfirmed')], 'Parent cancellation with unconfirmed native cleanup.') : reason;
      try { await item.receiver?.abort(); item.reject(actualReason); }
      catch (error) { item.reject(new AggregateError([actualReason, error], 'Parent scene and source-stage cleanup failed.')); }
    });
    barrier = Promise.allSettled([barrier, cleanup]).then(() => {});
  }
  async function receive(item: Run, response: UrbanSceneResponse, source?: Worker) {
    if (!live(item) || response.id !== item.request.id || source && source !== worker) return;
    if (response.error) throw new Error(response.error);
    if (response.parentAcknowledged) {
      const value = response.parentAcknowledged, begin = item.begin;
      parentSessionAssert(begin && item.lastReceipt && sameParentSessionReceipt(value.receipt, item.lastReceipt) && value.receipt.session_id === begin.session_id && value.receipt.source_fingerprint === begin.source.fingerprint
        && value.receipt.revision === begin.source.revision && value.receipt.completed === item.received
        && value.reply.session_id === begin.session_id && value.reply.completed === item.received
        && value.reply.source_fingerprint === begin.source.fingerprint && value.reply.revision === begin.source.revision, 'Native acknowledged prefix/source mismatch.');
      await item.options.onAcknowledged?.(value); return;
    }
    if (response.parentBegin) {
      if (item.begin || item.receiver) throw new Error('Duplicate native parent begin.');
      const begin = response.parentBegin, identity = item.request.parentSession!;
      parentSessionAssert(begin.schema_version === 'native-parent-session-1' && begin.source?.fingerprint === identity.fingerprint
        && begin.source.revision === identity.revision && begin.source.coordinate_space === 'world-metres'
        && Number.isSafeInteger(begin.total_requests) && begin.total_requests >= 0 && begin.offset === 0, 'Parent source begin changed.');
      item.begin = begin;
      item.receiver = await createUrbanParentReceiver(item.options.backend, { sceneId: item.options.sceneId, expectedActive: item.options.expectedActive,
        sourceFingerprint: identity.fingerprint, totalRequests: begin.total_requests, signal: item.abort.signal });
      if (!live(item)) throw new DOMException('Parent scene replaced', 'AbortError'); return;
    }
    if (response.parentBatch) {
      if (!item.begin || !item.receiver || response.parentComplete) throw new Error('Native parent chunk has no begun source.');
      const message = response.parentBatch, { receipt, progress, boundary, sites } = message, begin = item.begin;
      parentSessionAssert(message.sessionId === begin.session_id && progress.start === item.received && progress.total === begin.total_requests
        && progress.completed <= progress.total && Array.isArray(sites) && sites.length === progress.completed - progress.start
        && sites.every((s, i) => s.offset === progress.start + i && typeof s.id === 'string' && typeof s.parcel_id === 'string'), 'Parent source site/progress identity mismatch.');
      let batch: NativeParentBatch;
      if (receipt) {
        parentSessionAssert(!message.administrativeEmpty && receipt.session_id === begin.session_id && receipt.source_fingerprint === begin.source.fingerprint
          && receipt.revision === begin.source.revision && receipt.offset === progress.start && receipt.completed === progress.completed && receipt.total === progress.total
          && boundary.sessionReceipt && sameParentSessionReceipt(boundary.sessionReceipt, receipt), 'Worker receipt differs from retained native batch.');
        batch = await parseNativeParentBatchJson(message.batch_json, receipt, sites, begin.limits.max_output_bytes);
      } else {
        parentSessionAssert(message.administrativeEmpty && begin.total_requests === 0 && begin.state === 'complete' && progress.start === 0 && progress.completed === 0
          && boundary.emptySessionId === begin.session_id && !boundary.sessionReceipt && new TextEncoder().encode(message.batch_json).byteLength < 65536, 'Invalid administrative empty parent scene.');
        batch = JSON.parse(message.batch_json); validateParentBatch(batch, []);
        parentSessionAssert(batch.schema_version === NATIVE_PARENT_SCHEMA && batch.generator_version === begin.generator_version, 'Empty parent metadata differs from native begin.');
      }
      if (!live(item)) throw new DOMException('Parent scene replaced', 'AbortError');
      await item.receiver.receive(batch, progress, boundary, sites, async () => {
        if (!live(item)) throw new DOMException('Parent scene replaced', 'AbortError');
        await item.options.onBatch?.(batch, message);
        if (!live(item)) throw new DOMException('Parent scene replaced', 'AbortError');
        item.lastReceipt = receipt ? { ...receipt } : undefined;
        source?.postMessage({ parentAck: { id: item.request.id, sessionId: message.sessionId, receipt } });
      });
      item.received = progress.completed; item.options.progress?.(progress.completed, progress.total); return;
    }
    if (response.parentComplete) {
      if (!item.begin || !item.receiver) throw new Error('Parent scene completed without a source.');
      const { summary, timing } = response.parentComplete;
      parentSessionAssert(summary.session?.status === 'completed-and-released' && summary.session.begin.session_id === item.begin.session_id
        && summary.session.begin.source.fingerprint === item.begin.source.fingerprint && summary.counts.requests === item.received
        && item.received === item.begin.total_requests, 'Incomplete native parent source/session.');
      const manifest = await item.receiver.commit(summary); if (!live(item)) throw new DOMException('Parent publication replaced after durable commit', 'AbortError');
      parentSessionAssert(manifest.generation, 'Missing native generation evidence.'); current = undefined; item.removeSignal();
      item.resolve({ kind: 'cold-native-parent-scene', id: item.request.id,
        store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
        counts: { ...manifest.counts, schema_version: manifest.schema_version, generator_version: manifest.generator_version }, generation: manifest.generation, timing }); return;
    }
    if (response.progress) { item.options.progress?.(response.progress.completed, response.progress.total); return; }
    throw new Error('Legacy scene received on native parent stream; no downgrade or flattened group accepted.');
  }
  function queue(item: Run, response: UrbanSceneResponse, source?: Worker) {
    if (!live(item)) return;
    // At most begin + one native batch can wait: producer blocks on our ACK.
    item.work = item.work.then(() => receive(item, response, source));
    void item.work.catch(error => stop(item, error));
  }
  function fallback(item: Run) {
    item.producer = produceUrbanParentScene(item.request, { cancelled: () => !live(item),
      acknowledged: parentAcknowledged => receive(item, { id: item.request.id, parentAcknowledged }),
      begin: parentBegin => receive(item, { id: item.request.id, parentBegin }),
      batch: parentBatch => receive(item, { id: item.request.id, parentBatch }),
      complete: parentComplete => receive(item, { id: item.request.id, parentComplete }),
    });
    void item.producer.catch(error => stop(item, error));
  }
  function dispatch(item: Run) {
    if (!live(item)) return;
    if (item.options.forceFallback || typeof Worker === 'undefined') { fallback(item); return; }
    if (!worker) {
      try {
        worker = new SceneWorker(); const source = worker;
        source.onmessage = event => {
          const response = event.data as UrbanSceneResponse;
          if (response.parentDrained) {
            const pending = workerRuns.get(response.id);
            if (pending?.worker === source && ['settled', 'not_started'].includes(response.parentDrained.state)) {
              workerRuns.delete(response.id); pending.resolve(response.parentDrained);
            } return; // lifecycle is independent of current publication/epoch.
          }
          if (current) queue(current, response, source);
        };
        // Once a worker exists, an error is NOT permission to replan its run in fallback.
        source.onerror = error => {
          // A fatal worker cannot provide a finally receipt. Report uncertainty,
          // never call it a successful native release, and never hang disposal.
          for (const [id, pending] of workerRuns) if (pending.worker === source) { workerRuns.delete(id);
            pending.resolve({ state: 'worker_failed', error: `Worker failed; native cleanup unconfirmed: ${error.message}` }); }
          if (current) stop(current, new Error(`Parent architecture worker failed; native cleanup unconfirmed: ${error.message}`));
        };
      } catch { fallback(item); return; }
    }
    let finishDrain!: (value: UrbanParentWorkerDrained) => void;
    item.workerDrain = new Promise(resolve => { finishDrain = resolve; });
    workerRuns.set(item.request.id, { worker, promise: item.workerDrain, resolve: finishDrain });
    try { worker.postMessage(item.request); }
    catch (e) { workerRuns.delete(item.request.id); finishDrain({ state: 'not_started', error: String(e) }); stop(item, e); } // no hidden retry/replan after ambiguous dispatch.
  }
  return {
    run(input: UrbanParentSceneInput, options: UrbanParentSceneOptions): Promise<UrbanParentSceneResult> {
      if (disposed) return Promise.reject(new Error('Parent scene client is disposed.'));
      let request: UrbanSceneRequest;
      try { request = urbanSceneTransport({ ...input, parentSession: { ...input.parentSession },
        ...(input.settings ? { settings: structuredClone(input.settings) } : {}),
        ...(input.buildingOverrides ? { buildingOverrides: structuredClone(input.buildingOverrides) } : {}),
        ...(input.source ? { source: { ...input.source } } : {}), ...(input.keys ? { keys: input.keys.slice() } : {}),
        ...(input.runtime ? { runtime: { ...input.runtime } } : {}), id: ++nextId, progressive: true,
        ...(input.source ? { requireProjectedSiteStream: true as const } : {}) }); }
      catch (e) { return Promise.reject(e); }
      if (current) stop(current, new DOMException('Parent generation replaced', 'AbortError'));
      return new Promise((resolve, reject) => {
        const abort = new AbortController(); let removeSignal = () => {};
        const item: Run = { request, options, abort, resolve, reject, removeSignal, work: Promise.resolve(), stopping: false, received: 0 };
        current = item;
        const aborted = () => stop(item, options.signal?.reason ?? new DOMException('Parent generation cancelled', 'AbortError'));
        removeSignal = () => options.signal?.removeEventListener('abort', aborted); item.removeSignal = removeSignal;
        if (options.signal?.aborted) aborted(); else options.signal?.addEventListener('abort', aborted, { once: true });
        void barrier.then(() => dispatch(item), error => stop(item, error));
      });
    },
    invalidate() { if (current) stop(current, new DOMException('City source replaced', 'AbortError')); },
    async dispose() { disposed = true; if (current) stop(current, new DOMException('City parent workshop closed', 'AbortError'));
      await barrier;
      // A successful completion may already have cleared current while the
      // producer's terminal message is still queued. Drain those runs too.
      await Promise.all([...workerRuns.values()].map(run => run.promise)); worker?.terminate(); worker = undefined; },
  };
}
