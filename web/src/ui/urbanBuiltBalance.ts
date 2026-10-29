import type { Partition } from '../../../rust/bridge/urban';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import { builtOutcomeSource, createBuiltOutcomeBalance } from '../../../rust/bridge/urbanBuiltBalance';
import { iterateUrbanBuildingChunks, type BuildingChunkBackend } from './urbanBuildingChunkStore';
import { decodeParentChunk, validateParentManifest, type ParentChunkBackend } from './urbanParentChunkStore';

export function reconcileCompactBuiltBalance(partitions: readonly Partition[], scene: PlacementBatch): Partition[] {
  const balance = createBuiltOutcomeBalance(partitions); balance.append(scene); return balance.complete(builtOutcomeSource(scene));
}

/** Restores from authenticated native chunks too. No detail realization, plan
 * unpack, full-city accumulator or capacity from cartographic projections. */
export async function reconcileColdBuiltBalance(partitions: readonly Partition[], backend: BuildingChunkBackend,
  sceneId: string, cancelled?: () => boolean): Promise<Partition[]> {
  const balance = createBuiltOutcomeBalance(partitions);
  const manifest = await backend.manifest(sceneId);
  if (!manifest) throw new Error('Retained balance source is absent.');
  for await (const delta of iterateUrbanBuildingChunks(backend, sceneId, { maxChunkBytes: 64 * 1024 * 1024, cancelled })) balance.append(delta);
  return balance.complete(manifest.fingerprint);
}

/** Read native admission headers; opaque archives remain opaque. One parent
 * contributes one unknown outcome. Physical members never become households. */
export async function reconcileParentBuiltBalance(partitions: readonly Partition[], backend: ParentChunkBackend,
  sceneId: string, cancelled?: () => boolean): Promise<Partition[]> {
  const manifest=await backend.manifest(sceneId);
  if (!manifest) throw new Error('Retained parent balance source is absent.');
  await validateParentManifest(manifest);
  const balance=createBuiltOutcomeBalance(partitions);
  for (const expected of manifest.chunks) {
    if (cancelled?.()) throw new DOMException('Parent balance replaced','AbortError');
    const chunk=await backend.chunk(sceneId,expected.index);
    if (!chunk || chunk.index!==expected.index || chunk.sha256!==expected.sha256 || chunk.bytes!==expected.bytes
      || chunk.nativeBatch!==expected.nativeBatch || JSON.stringify(chunk.progress)!==JSON.stringify(expected.progress)
      || JSON.stringify(chunk.counts)!==JSON.stringify(expected.counts)) throw new Error('Parent balance chunk differs from its manifest.');
    const payload=await decodeParentChunk(chunk);
    if (cancelled?.()) throw new DOMException('Parent balance replaced','AbortError');
    balance.appendUncertified(payload.rows.map(row=>row.kind==='parent' ? {kind:'admitted',parcel_id:row.parent.parcelId}
      : row.kind==='refusal' ? {kind:'refusal',parcel_id:row.refusal.parcel_id,message:row.refusal.message}
      : {kind:'open',parcel_id:row.open.parcel_id,message:row.open.deficit?.message}));
  }
  return balance.complete(manifest.fingerprint);
}
