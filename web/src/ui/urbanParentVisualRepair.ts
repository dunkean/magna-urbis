/** Explicit bounded repair of ONE child chunk from exact parent archives.
 * No call to old global cold sessions, no generation or city-sized DTO map. */
import type { NativeParentApi } from '../../../rust/bridge/nativeParentContract';
import { parentIdentity } from '../../../rust/bridge/nativeParentContract';
import { unpackParentChunk, type ParentChunkBackend, type ParentSceneManifest } from './urbanParentChunkStore';
import { encodeParentVisual, decodeParentVisual } from './urbanParentVisualCache';
import { projectParentRecords } from './urbanParentVisual';
export async function repairParentVisualChunk(backend: ParentChunkBackend, manifest: ParentSceneManifest, index: number,
  api: NativeParentApi, options: { signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  await api.require(); options.signal?.throwIfAborted(); // fresh capability BEFORE any native chunk read.
  const descriptor = manifest.chunks[index]; if (!descriptor || !backend.putVisual) throw new Error('Parent child cache repair is unavailable.');
  const chunk = await backend.chunk(manifest.sceneId, index); options.signal?.throwIfAborted();
  if (!chunk || chunk.sha256 !== descriptor.sha256) throw new Error('Native parent source changed/missing during child repair.');
  const native = await unpackParentChunk(chunk, api); options.signal?.throwIfAborted();
  const plans = new Map(native.plans.map(plan => [parentIdentity(plan).id, plan]));
  const records = native.payload.rows.flatMap(row => row.kind === 'parent'
    ? [{ plan: plans.get(row.parent.id)!, archive: row.parent.archive, attempt: row.parent.attempt }] : []);
  const visual = await encodeParentVisual(index, chunk.sha256, projectParentRecords(records, native.payload.materials));
  options.signal?.throwIfAborted(); await backend.putVisual(manifest.sceneId, visual); options.signal?.throwIfAborted();
  return { chunk: visual, records: await decodeParentVisual(visual, descriptor.sha256) };
}
