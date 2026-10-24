import { decorHasParents } from './decor';
import { decodeDecorBounded, decorColdStates, encodeDecorAsync, type Decor } from './decor';
import { createIndexedDbBuildingChunkBackend } from './urbanBuildingChunkIndexedDb';
import { exportUrbanBuildingChunks, importUrbanBuildingChunks, type BuildingChunkBackend, type BuildingChunkManifest } from './urbanBuildingChunkStore';

export const COLD_DECOR_FORMAT = 'magna-cold-decor-1';
export const DECOR_FILE_MEMORY_LIMIT = 64 * 1024 * 1024;
export const DECOR_HEADER_LIMIT = 64 * 1024 * 1024;
const RAW_TERRAIN_LIMIT = 128 * 1024 * 1024;
type ColdState = ReturnType<typeof decorColdStates>[number];
export interface DecorFileOptions { backend?: BuildingChunkBackend | Promise<BuildingChunkBackend>; signal?: AbortSignal }
export interface DecorReadOptions extends DecorFileOptions {
  /** Consumer identity checks run before a cold stage can be published. */
  validate?(decor: Decor): void;
}
let defaultBackend: Promise<BuildingChunkBackend> | undefined;
function storage(options: DecorFileOptions): Promise<BuildingChunkBackend> {
  return Promise.resolve(options.backend ?? (defaultBackend ??= createIndexedDbBuildingChunkBackend()));
}
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function base64(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
function unbase64(value: unknown): Uint8Array {
  // Avoid a repeated-group regexp whose backtracking stack grows with a large
  // raster header. atob additionally checks padding position and length.
  assert(typeof value === 'string' && value.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(value), 'Invalid cold decor metadata encoding.');
  const decoded = atob(value);
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
function validateReference(state: ColdState, manifest: BuildingChunkManifest): void {
  assert(state?.store?.format === manifest.format && state.store.fingerprint === manifest.fingerprint
    && state.store.sourceFingerprint === manifest.sourceFingerprint && typeof state.store.sceneId === 'string' && state.store.sceneId.length > 0
    && state.counts?.schema_version === manifest.schema_version && state.counts.generator_version === manifest.generator_version
    && state.counts.buildings === manifest.buildings && state.counts.refusals === manifest.refusals
    && state.counts.open_spaces === manifest.openSpaces, 'Cold decor metadata does not match its complete native scene.');
  assert(state.offset === undefined || !!state.offset && Number.isFinite(state.offset.x) && Number.isFinite(state.offset.y), 'Invalid cold decor coordinate offset.');
  assert(state.cityKey === undefined || typeof state.cityKey === 'string' && state.cityKey.length > 0, 'Invalid cold decor city key.');
}
function validateSnapshots(decor: Decor): void {
  for (const urban of [decor.meta.pipeline?.urban, decor.meta.pipeline?.urbanDraft])
    assert(!urban?.buildingState?.scene, 'A cold decor cannot also embed a legacy native scene.');
}
function rewriteReferences(decor: Decor, manifest: BuildingChunkManifest): Decor {
  const pipeline = decor.meta.pipeline!;
  const rewrite = <T extends NonNullable<typeof pipeline.urban> | NonNullable<typeof pipeline.urbanDraft>>(urban: T | undefined): T | undefined => {
    const built = urban?.buildingState;
    return built?.cold ? { ...urban, buildingState: { ...built, cold: { ...built.cold,
      store: { ...built.cold.store, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint } } } } as T : urban;
  };
  return { ...decor, meta: { ...decor.meta, pipeline: { ...pipeline, urban: rewrite(pipeline.urban), urbanDraft: rewrite(pipeline.urbanDraft) } } };
}

/** Terrain gzip stays the legacy format. Cold cities prepend one bounded header
 * and then the existing exact native chunk frames, with stream backpressure. */
export async function* exportDecorFile(decor: Decor, options: DecorFileOptions = {}): AsyncGenerator<Uint8Array> {
  if (decorHasParents(decor)) throw new Error('Export complet du décor avec parents non pris en charge : utilisez l’export natif dans Bâtiments.');
  const states = decorColdStates(decor).map(state => structuredClone(state));
  if (states.length) validateSnapshots(decor);
  // The codec captures metadata/raster synchronously before its worker starts.
  const encoded = await encodeDecorAsync(decor, { localReferences: true });
  if (!states.length) { yield encoded; return; }
  const backend = await storage(options), manifest = await backend.manifest(states[0].store.sceneId);
  assert(manifest, 'Retained native buildings are absent; this decor cannot be exported portably.');
  for (const state of states) validateReference(state, manifest);
  const header = new TextEncoder().encode(JSON.stringify({ format: COLD_DECOR_FORMAT, decor: base64(encoded) }) + '\n');
  assert(header.byteLength <= DECOR_HEADER_LIMIT, 'Cold decor metadata exceeds header byte budget.');
  yield header;
  yield* exportUrbanBuildingChunks(backend, manifest.sceneId);
}

async function* blobParts(file: Blob): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; yield part.value; }
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
}
/** Only the bounded metadata header is accumulated. The remainder is consumed by
 * the existing chunk importer, which authenticates each frame and commits at EOF. */
export async function readDecorFile(file: Blob, options: DecorReadOptions = {}): Promise<Decor> {
  options.signal?.throwIfAborted();
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    assert(file.size <= DECOR_FILE_MEMORY_LIMIT, 'Legacy decor exceeds import byte budget.');
    const decor = decodeDecorBounded(new Uint8Array(await file.arrayBuffer()), RAW_TERRAIN_LIMIT);
    options.signal?.throwIfAborted();
    assert(!decorHasParents(decor), 'Incomplete parent decor: authoritative archives are missing.');
    assert(!decorColdStates(decor).length, 'Incomplete cold decor: native building frames are missing.');
    options.validate?.(decor);
    return decor;
  }
  const iterator = blobParts(file)[Symbol.asyncIterator]();
  try {
    const pieces: Uint8Array[] = []; let size = 0, remainder: Uint8Array | undefined;
    for (;;) {
      const part = await iterator.next(); options.signal?.throwIfAborted(); assert(!part.done, 'Truncated cold decor header.');
      const end = part.value.indexOf(10), piece = end < 0 ? part.value : part.value.subarray(0, end);
      size += piece.length; assert(size <= DECOR_HEADER_LIMIT, 'Cold decor metadata exceeds header byte budget.');
      pieces.push(piece);
      if (end >= 0) { remainder = part.value.subarray(end + 1); break; }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
    const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    assert(header?.format === COLD_DECOR_FORMAT, 'Unsupported decor file format.');
    const decor = decodeDecorBounded(unbase64(header.decor), RAW_TERRAIN_LIMIT), states = decorColdStates(decor);
    assert(states.length > 0, 'Cold decor header has no retained native scene.');
    validateSnapshots(decor);
    options.validate?.(decor);
    const backend = await storage(options);
    // Keep prototype-backed implementations intact; only the atomic commit is
    // intercepted. Header mismatches must fail BEFORE publishing the generation.
    const guarded = new Proxy(backend, { get(target, key) {
      if (key === 'commit') return async (manifest: BuildingChunkManifest, expected: string | null, commitOptions?: { signal?: AbortSignal }) => {
        options.signal?.throwIfAborted();
        for (const state of states) validateReference(state, manifest);
        await target.commit(manifest, expected, { ...commitOptions, signal: options.signal ?? commitOptions?.signal });
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    async function* rest() {
      options.signal?.throwIfAborted();
      if (remainder?.length) yield remainder;
      for (;;) { const part = await iterator.next(); options.signal?.throwIfAborted(); if (part.done) break; yield part.value; }
    }
    const manifest = await importUrbanBuildingChunks(guarded, rest());
    return rewriteReferences(decor, manifest);
  } finally { await iterator.return?.(undefined); }
}

export interface DecorFileWriter { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
interface DecorFileHandle { createWritable(): Promise<DecorFileWriter> }
export type DecorSavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<DecorFileHandle>;
export interface DecorDownloadOptions extends DecorFileOptions {
  /** Injectable platform boundary; null forces the bounded browser fallback. */
  picker?: DecorSavePicker | null;
  saveBlob?(blob: Blob, filename: string): void;
}
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
/** Enter directly from the button handler: picker invocation precedes ANY await,
 * including history lookup. Failure aborts the disk writer, never publishes it. */
export async function downloadDecorFile(decor: Decor | Promise<Decor>, filename: string, options: DecorDownloadOptions = {}): Promise<void> {
  const browserPicker = typeof window !== 'undefined' && 'showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function'
    ? window.showSaveFilePicker.bind(window) as DecorSavePicker : undefined;
  const picker = options.picker === null ? undefined : options.picker ?? browserPicker;
  // Start consuming the promise immediately too, so a canceled picker cannot
  // leave a failed history lookup as an unhandled rejection.
  const loaded = Promise.resolve(decor); void loaded.catch(() => {});
  const handle = picker ? await picker({ suggestedName: filename,
    types: [{ description: 'Carte et maisons natives complètes', accept: { 'application/octet-stream': ['.decor'] } }] }) : undefined;
  const value = await loaded;
  if (handle) {
    const writer = await handle.createWritable();
    try {
      for await (const part of exportDecorFile(value, options)) await writer.write(part);
      await writer.close();
    } catch (error) { try { await writer.abort?.(); } catch { /* Keep the original failure. */ } throw error; }
    return;
  }
  const parts: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  for await (const part of exportDecorFile(value, options)) {
    size += part.byteLength;
    assert(size <= DECOR_FILE_MEMORY_LIMIT, 'Ce fichier dépasse 64 Mio : utilisez un navigateur permettant l’enregistrement direct sur disque.');
    parts.push(new Uint8Array(part));
  }
  (options.saveBlob ?? saveBlob)(new Blob(parts, { type: 'application/octet-stream' }), filename);
}
