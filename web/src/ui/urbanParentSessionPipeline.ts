/** Same durable source receiver as tranche A, now driven by the real retained
 * native generation session (no JS prefix occupation). Worker uses the receiver
 * on the main thread; fallback invokes this exact shared consumer directly. */
import type { ArchitectureBatchHeader, ArchitectureRequestSource } from '../../../rust/bridge/architectureBatch';
import type { NativeParentSessionApi, ParentSessionSource } from '../../../rust/bridge/nativeParentSessionContract';
import { streamNativeParentSession, type NativeParentSessionOptions } from '../../../rust/bridge/nativeParentSessionStream';
import { createUrbanParentReceiver, type UrbanParentStageOptions } from './urbanParentPipeline';
import type { ParentChunkBackend } from './urbanParentChunkStore';
export async function runUrbanParentSessionSource(header: ArchitectureBatchHeader, source: ArchitectureRequestSource,
  identity: ParentSessionSource, api: NativeParentSessionApi, backend: ParentChunkBackend,
  options: UrbanParentStageOptions & { onDurableBatch?: NativeParentSessionOptions['onBatch'] }) {
  let receiver: Awaited<ReturnType<typeof createUrbanParentReceiver>> | undefined;
  try {
    const summary = await streamNativeParentSession(header, source, identity, api, {
      cancelled: () => options.signal?.aborted === true,
      onBegin: async () => { receiver = await createUrbanParentReceiver(backend, { ...options, sourceFingerprint: identity.fingerprint, totalRequests: source.total }); },
      onBatch: async (batch, progress, boundary, requests, receipt, sessionId) => {
        if (!receiver) throw new Error('Native parent stage was not begun.');
        await receiver.receive(batch, progress, boundary, requests,
          () => options.onDurableBatch?.(batch, progress, boundary, requests, receipt, sessionId));
      },
    });
    options.signal?.throwIfAborted(); if (!receiver) throw new Error('Native parent receiver is absent.');
    const manifest = await receiver.commit(summary);
    return { kind: 'cold-native-parent-scene' as const, manifest, summary };
  } catch (e) {
    // Native stream has its own finally. Failure here must not prevent that
    // native cleanup; conversely its failure never suppresses stage discard.
    try { await receiver?.abort(); } catch (cleanup) { throw new AggregateError([e, cleanup], 'Native city generation and stage cleanup failed.'); }
    throw e;
  }
}
