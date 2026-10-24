/** Selected/detail source reader, serialized and one opaque chunk cached.
 * A cached child is NEVER unpacked as a native plan or used to realize. */
import type { NativeParentApi, NativeParentPlan, NativeParentArchive } from '../../../rust/bridge/nativeParentContract';
import { parentIdentity } from '../../../rust/bridge/nativeParentContract';
import { decodeParentChunk, type ParentChunkBackend, type ParentSceneManifest, type ParentSourceRecord, type ParentChunkPayload } from './urbanParentChunkStore';
export interface NativeParentRead { plan: NativeParentPlan; archive: NativeParentArchive; record: ParentSourceRecord; sourceChunkSha256: string }
export function createParentNativeReader(backend: ParentChunkBackend, manifest: ParentSceneManifest, api: NativeParentApi) {
  let disposed = false, active = false, cache: { index: number; bytes: number; payload: ParentChunkPayload } | undefined;
  const queue: { id: string; signal?: AbortSignal; resolve(value: NativeParentRead): void; reject(error: unknown): void }[] = [];
  const check = (signal?: AbortSignal) => { signal?.throwIfAborted(); if (disposed) throw new DOMException('Native parent source disposed', 'AbortError'); };
  async function pump() {
    if (active) return; const job = queue.shift(); if (!job) return; active = true;
    try {
      check(job.signal); await api.require(); check(job.signal); // fresh BEFORE source/archive read.
      const index = await backend.parent(manifest.sceneId, job.id); check(job.signal);
      if (!index) throw new Error('Selected native parent source is absent.');
      const expected = manifest.chunks[index.chunkIndex]; if (!expected || expected.bytes > 8 * 1024 * 1024) throw new Error('Selected parent exceeds source read budget.');
      if (!cache || cache.index !== index.chunkIndex) {
        const chunk = await backend.chunk(manifest.sceneId, index.chunkIndex); check(job.signal);
        if (!chunk || chunk.sha256 !== expected.sha256) throw new Error('Selected parent source changed.');
        const payload = await decodeParentChunk(chunk); check(job.signal); cache = { index: chunk.index, bytes: chunk.bytes, payload };
      }
      const row = cache.payload.rows[index.rowIndex];
      if (row?.kind !== 'parent' || row.parent.id !== job.id || row.parent.parcelId !== index.parcelId) throw new Error('Selected parent index/source identity mismatch.');
      const record = row.parent, plan = await api.unpack(record.archive); check(job.signal);
      const identity = parentIdentity(plan), members = plan.kind === 'single' ? [{ id: plan.building.id, key: null }] : plan.assembly.members.map(m => ({ id: m.plan.id, key: m.key }));
      if (identity.id !== record.id || identity.parcel_id !== record.parcelId || plan.kind !== record.nativeKind || JSON.stringify(members) !== JSON.stringify(record.members))
        throw new Error('Native unpack changed the selected parent/member identities.');
      job.resolve({ plan, archive: record.archive, record, sourceChunkSha256: expected.sha256 });
    } catch (error) { job.reject(error); }
    finally { active = false; if (disposed) cache = undefined; void pump(); }
  }
  return {
    read(id: string, signal?: AbortSignal): Promise<NativeParentRead> {
      if (disposed || queue.length >= 6) return Promise.reject(new Error(disposed ? 'Native parent reader disposed.' : 'Native parent read queue is full.'));
      return new Promise((resolve, reject) => { queue.push({ id, signal, resolve, reject }); void pump(); });
    },
    get stats() { return { inFlight: Number(active), queued: queue.length, cacheBytes: cache?.bytes ?? 0, cachedChunks: Number(!!cache) }; },
    dispose() { disposed = true; cache = undefined; for (const job of queue.splice(0)) job.reject(new DOMException('Native parent reader disposed', 'AbortError')); },
  };
}
