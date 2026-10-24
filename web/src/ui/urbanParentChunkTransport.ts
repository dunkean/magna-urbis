import { projectParentRecords } from './urbanParentVisual';
import { encodeParentVisual } from './urbanParentVisualCache';
/** Exact archive-only NDJSON. Import validates every archive through the native
 * bulk reader, rebuilds indexes bounded by one chunk, then switches common active. */
import type { NativeParentApi, NativeParentPlan } from '../../../rust/bridge/nativeParentContract';
import { parentIdentity } from '../../../rust/bridge/nativeParentContract';
import { parentWire } from '../../../rust/bridge/nativeParentBudget';
import { parentDigest } from '../../../rust/bridge/nativeParentStream';
import { PARENT_CHUNK_BYTES, decodeParentChunk, validateParentManifest, unpackParentChunk, parentRecordIndexes,
  type ParentChunkBackend, type ParentSceneManifest, type StoredParentChunk, type ParentActiveReference, type ParentSourceIndex, type ParentMemberIndex } from './urbanParentChunkStore';
const frame = (v: unknown) => new TextEncoder().encode(parentWire(v).json + '\n');
export async function* exportUrbanParentChunks(backend: ParentChunkBackend, sceneId: string) {
  const manifest = await backend.manifest(sceneId); if (!manifest) throw new Error('Native parent scene is absent.');
  await validateParentManifest(manifest); yield frame({ type: 'manifest', manifest });
  for (const d of manifest.chunks) {
    const chunk = await backend.chunk(sceneId, d.index); if (!chunk) throw new Error('Native parent source chunk is absent.');
    const { json: _json, ...descriptor } = chunk;
    if (JSON.stringify(descriptor) !== JSON.stringify(d)) throw new Error('Native parent descriptor mismatch.');
    await decodeParentChunk(chunk); yield frame({ type: 'chunk', chunk });
  }
  yield frame({ type: 'complete', fingerprint: manifest.fingerprint });
}
async function* frames(source: AsyncIterable<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '', bytes = 0;
  for await (const piece of source) {
    if (!(piece instanceof Uint8Array)) throw new Error('Invalid parent import bytes.');
    let start = 0;
    for (let i = 0; i < piece.length; i++) if (piece[i] === 10) {
      bytes += i - start; if (bytes > PARENT_CHUNK_BYTES * 2 + 65536) throw new Error('Parent import frame budget exceeded.');
      pending += decoder.decode(piece.subarray(start, i), { stream: true }) + decoder.decode();
      if (!pending) throw new Error('Empty parent import frame.');
      yield JSON.parse(pending); pending = ''; bytes = 0; start = i + 1;
    }
    bytes += piece.length - start; if (bytes > PARENT_CHUNK_BYTES * 2 + 65536) throw new Error('Parent import frame budget exceeded.');
    pending += decoder.decode(piece.subarray(start), { stream: true });
  }
  pending += decoder.decode(); if (pending || bytes) throw new Error('Truncated native parent import.');
}
export async function importUrbanParentChunks(backend: ParentChunkBackend, source: AsyncIterable<Uint8Array>, api: NativeParentApi,
  options: { sceneId?: string; expectedActive?: ParentActiveReference | null; signal?: AbortSignal } = {}) {
  await api.require(); options.signal?.throwIfAborted();
  const expectedActive = options.expectedActive === undefined ? await backend.activeReference() ?? null : options.expectedActive;
  const sceneId = options.sceneId ?? crypto.randomUUID(); let original: ParentSceneManifest | undefined, ordinal = 0, complete = false, begun = false;
  try {
    for await (const f of frames(source)) {
      options.signal?.throwIfAborted(); if (complete) throw new Error('Trailing native parent import frames.');
      if (!original) {
        if (f.type !== 'manifest') throw new Error('Parent import must begin with manifest.');
        original = f.manifest as ParentSceneManifest; await validateParentManifest(original);
        await backend.begin(sceneId); begun = true;
      } else if (f.type === 'chunk') {
        const chunk = f.chunk as StoredParentChunk, { json: _json, ...descriptor } = chunk;
        if (JSON.stringify(descriptor) !== JSON.stringify(original.chunks[ordinal])) throw new Error('Parent import source sequence mismatch.');
        const decoded = await unpackParentChunk(chunk, api); options.signal?.throwIfAborted();
        const plans = new Map<string, NativeParentPlan>(decoded.plans.map(p => [parentIdentity(p).id, p]));
        const parents: ParentSourceIndex[] = [], members: ParentMemberIndex[] = [];
        for (const [rowIndex, row] of decoded.payload.rows.entries()) if (row.kind === 'parent') {
          const plan = plans.get(row.parent.id); if (!plan) throw new Error('Missing native unpacked parent.');
          const indexes = parentRecordIndexes(plan, chunk.index, rowIndex); parents.push(indexes.parent); members.push(...indexes.members);
        }
        const records = decoded.payload.rows.flatMap(row => row.kind === 'parent'
          ? [{ plan: plans.get(row.parent.id)!, archive: row.parent.archive, attempt: row.parent.attempt }] : []);
        const visual = await encodeParentVisual(chunk.index, chunk.sha256, projectParentRecords(records, decoded.payload.materials));
        await backend.append(sceneId, chunk, parents, members, visual); ordinal++;
      } else {
        if (f.type !== 'complete' || f.fingerprint !== original.fingerprint || ordinal !== original.chunks.length) throw new Error('Incomplete parent import.'); complete = true;
      }
    }
    if (!original || !complete) throw new Error('Incomplete parent import.'); options.signal?.throwIfAborted();
    const manifest = { ...original, sceneId };
    await validateParentManifest(manifest); await backend.commit(manifest, expectedActive, { signal: options.signal }); return manifest;
  } catch (e) { if (begun) await backend.discard(sceneId); throw e; }
}
