/** Native-only/invalid-child-store migration. Reuses the EXACT A2 derivation,
 * serial one authenticated native chunk -> disposable child -> release parent.
 * No projection accumulator, native construction, query capability or ID map. */
import { beginDerivedWrite, openDerivedCache } from './urbanBuildingDerivedCache';
import { openUrbanBuildingChunks, iterateUrbanBuildingChunkRecords, BUILDING_CHUNK_MAX_BYTES, type BuildingChunkBackend } from './urbanBuildingChunkStore';
import { projectNativeBuildingChunk } from './urbanBuildingProjection';
import type { ColdCityState } from './urbanColdCitySession';
export interface DerivedRepairProgress { completed: number; total: number; chunks: number; nativeEncodedBytes: number; phase: 'reading' | 'persisting' | 'complete' }
export async function repairColdDerivedCache(backend: BuildingChunkBackend, state: ColdCityState, options: {
  signal?: AbortSignal; current?(): boolean; progress?(value: DerivedRepairProgress): void;
  maxNativeChunkBytes?: number; yieldControl?(): Promise<void>;
} = {}) {
  const check = () => { options.signal?.throwIfAborted(); if (options.current?.() === false) throw new DOMException('Scène remplacée pendant la réparation', 'AbortError'); };
  check();
  const native = await openUrbanBuildingChunks(backend, state.store.sceneId), m = native.manifest;
  if (m.fingerprint !== state.store.fingerprint || m.sourceFingerprint !== state.store.sourceFingerprint || m.buildings !== state.counts.buildings
    || m.refusals !== state.counts.refusals || m.openSpaces !== state.counts.open_spaces || m.generator_version !== state.counts.generator_version
    || m.schema_version !== state.counts.schema_version || m.format !== state.store.format) throw new Error('Parent natif de réparation remplacé.');
  const cap = options.maxNativeChunkBytes ?? BUILDING_CHUNK_MAX_BYTES;
  if (!Number.isSafeInteger(cap) || cap <= 0 || cap > BUILDING_CHUNK_MAX_BYTES) throw new Error('Budget de chunk natif invalide.');
  check(); const writer = await beginDerivedWrite(backend, m.sceneId, m.sourceFingerprint, m.totalRequests);
  if (!writer) throw new Error('Stockage dérivé indisponible : aucune archive native n’a été modifiée.');
  let chunks = 0, bytes = 0, maxRecords = 0, completed = 0;
  try {
    for await (const record of iterateUrbanBuildingChunkRecords(backend, m.sceneId, { maxChunkBytes: cap,
      cancelled: () => options.signal?.aborted || options.current?.() === false })) {
      check(); const records = record.delta.buildings.length + record.delta.refusals.length + record.delta.open_spaces.length;
      if (records > 64) throw new Error('Chunk natif hors contrat de64requêtes.');
      maxRecords = Math.max(maxRecords, records); bytes += record.descriptor.bytes;
      options.progress?.({ phase: 'reading', completed, total: m.totalRequests, chunks, nativeEncodedBytes: bytes });
      // A2 writer authenticates source/count/descriptor and preserves exact child
      // surfaces. Original live sites are unknown here, never fabricated.
      await writer.append(projectNativeBuildingChunk(record.delta), record.descriptor);
      check(); chunks++; completed = record.descriptor.progress.completed;
      options.progress?.({ phase: 'persisting', completed, total: m.totalRequests, chunks, nativeEncodedBytes: bytes });
      await (options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0))))(); check();
    }
    check(); await writer.commit(m, options.signal); check();
    const child = await openDerivedCache(backend, m); check();
    options.progress?.({ phase: 'complete', completed, total: m.totalRequests, chunks, nativeEncodedBytes: bytes });
    return { parentFingerprint: m.fingerprint, derivedFingerprint: child.manifest.fingerprint, origins: child.manifest.origins,
      chunks, nativeEncodedBytes: bytes, maxRetainedNativeChunks: 1 as const, maxParsedRecords: maxRecords, maxNativeChunkBytes: cap };
  } catch (e) {
    try { await writer.abort(); } catch { /* Late completed cache publication never changes native archives. */ }
    throw e;
  } finally { native.clearCache(); }
}
