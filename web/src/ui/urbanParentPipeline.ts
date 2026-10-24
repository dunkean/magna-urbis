/** One real adapter/receiver path for worker ACK and fallback. No applied UI
 * state is returned before native source/index CAS commit succeeds. */
import type { ArchitectureBatchHeader, ArchitectureBatchProgress, ArchitectureRequestSource } from '../../../rust/bridge/architectureBatch';
import type { NativeParentApi, NativeParentBatch } from '../../../rust/bridge/nativeParentContract';
import { streamNativeParents, type ParentBatchBoundary } from '../../../rust/bridge/nativeParentStream';
import { beginUrbanParentStage, type ParentChunkBackend, type ParentActiveReference } from './urbanParentChunkStore';
export interface UrbanParentStageOptions { sceneId?: string; sourceFingerprint: string; expectedActive?: ParentActiveReference | null; signal?: AbortSignal }
export async function createUrbanParentReceiver(backend: ParentChunkBackend, options: UrbanParentStageOptions & { totalRequests: number }) {
  const stage = await beginUrbanParentStage(backend, options);
  return {
    async receive(batch: NativeParentBatch, progress: ArchitectureBatchProgress, boundary: ParentBatchBoundary,
      requests: readonly { id: string; parcel_id: string }[], acknowledge: () => void | Promise<void>) {
      options.signal?.throwIfAborted();
      await stage.append(batch, progress, boundary, requests); // all source fragments + parent/member indexes DURABLE
      options.signal?.throwIfAborted();
      await acknowledge(); // caller worker message; failure never publishes scene.
    },
    commit: stage.commit, abort: stage.abort,
  };
}
export async function runUrbanParentSource(header: ArchitectureBatchHeader, source: ArchitectureRequestSource,
  api: NativeParentApi, backend: ParentChunkBackend, options: UrbanParentStageOptions & {
    onDurableBatch?(batch: NativeParentBatch, progress: ArchitectureBatchProgress): void | Promise<void>;
  }) {
  await api.require(); options.signal?.throwIfAborted();
  const receiver = await createUrbanParentReceiver(backend, { ...options, totalRequests: source.total });
  try {
    const summary = await streamNativeParents(header, source, api, {
      cancelled: () => options.signal?.aborted === true,
      onBatch: (batch, progress, boundary, requests) => receiver.receive(batch, progress, boundary, requests,
        () => options.onDurableBatch?.(batch, progress)),
    });
    options.signal?.throwIfAborted(); const manifest = await receiver.commit(summary);
    return { kind: 'cold-native-parent-scene' as const, manifest, summary };
  } catch (e) { await receiver.abort(); throw e; }
}
