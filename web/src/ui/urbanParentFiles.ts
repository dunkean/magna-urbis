/** Exact native parent frames, plus explicit DISPLAY transform. Native archive
 * bits/geometry are never translated, clipped or rebuilt by the frontend. */
import { exportUrbanParentChunks, importUrbanParentChunks } from './urbanParentChunkTransport';
import { parentStateFromManifest, type UrbanParentBuildingState } from './urbanParentState';
import type { NativeParentApi } from '../../../rust/bridge/nativeParentContract';
import type { ParentChunkBackend, ParentActiveReference } from './urbanParentChunkStore';
interface Writer { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
type Picker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<Writer> }>;
export async function downloadParentBuildings(backend: ParentChunkBackend | Promise<ParentChunkBackend>, state: UrbanParentBuildingState) {
  const pending = Promise.resolve(backend);
  const picker: Picker | undefined = 'showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function' ? window.showSaveFilePicker.bind(window) : undefined;
  const handle = picker ? await picker({ suggestedName: 'native-city-parents.ndjson', types: [{ description: 'Parents et membres natifs complets', accept: { 'application/x-ndjson': ['.ndjson'] } }] }) : undefined;
  const storage = await pending, manifest = await storage.manifest(state.store.sceneId);
  if (!manifest || manifest.fingerprint !== state.store.fingerprint) throw new Error('Native parent export source changed.');
  async function* parts() { let first = true;
    for await (const piece of exportUrbanParentChunks(storage, state.store.sceneId)) {
      if (first) { first = false; const header = JSON.parse(new TextDecoder().decode(piece));
        yield new TextEncoder().encode(JSON.stringify({ ...header, city: { format: 'native-city-transform-1', offset: state.offset ?? { x: 0, y: 0 }, cityKey: state.cityKey } }) + '\n');
      } else yield piece;
    }
  }
  if (handle) { const writer = await handle.createWritable(); try { for await (const piece of parts()) await writer.write(piece); await writer.close(); }
    catch (e) { try { await writer.abort?.(); } catch {} throw e; } return; }
  const cap = 64 * 1024 * 1024; if (manifest.chunks.reduce((n, d) => n + d.bytes * 2 + 4096, JSON.stringify(manifest).length * 2) > cap)
    throw new Error('Cette archive nécessite un navigateur permettant l’enregistrement direct sur disque.');
  const collected: Uint8Array<ArrayBuffer>[] = []; let count = 0;
  for await (const piece of parts()) { count += piece.byteLength; if (count > cap) throw new Error('Native parent download exceeds bounded in-memory compatibility budget.'); collected.push(new Uint8Array(piece)); }
  const url = URL.createObjectURL(new Blob(collected, { type: 'application/x-ndjson' })), link = document.createElement('a'); link.href = url; link.download = 'native-city-parents.ndjson'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
export async function readParentBuildings(file: Blob, backend: ParentChunkBackend, api: NativeParentApi, options: {
  signal?: AbortSignal; expectedCityKey?: string; expectedActive?: ParentActiveReference | null;
} = {}): Promise<UrbanParentBuildingState> {
  await api.require(); options.signal?.throwIfAborted();
  const reader = file.stream().getReader(), chunks: Uint8Array[] = []; let bytes = 0, remainder: Uint8Array | undefined;
  try {
    for (;;) { const part = await reader.read(); options.signal?.throwIfAborted(); if (part.done) throw new Error('Truncated native parent file header.');
      const end = part.value.indexOf(10), first = end < 0 ? part.value : part.value.subarray(0, end);
      bytes += first.length; if (bytes > 16 * 1024 * 1024) throw new Error('Native parent file header exceeds budget.'); chunks.push(first);
      if (end >= 0) { remainder = part.value.subarray(end + 1); break; }
    }
    const headerBytes = new Uint8Array(bytes + 1); let offset = 0; for (const c of chunks) { headerBytes.set(c, offset); offset += c.length; } headerBytes[bytes] = 10;
    const first = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes)), city = first.city;
    if (first.type !== 'manifest' || first.manifest?.format !== 'urban-native-parent-chunks-1') throw new Error('Unsupported native parent file format; legacy imports keep their own reader.');
    if (city !== undefined && (city.format !== 'native-city-transform-1' || !city.offset || ![city.offset.x, city.offset.y].every(Number.isFinite)
      || city.cityKey !== undefined && (typeof city.cityKey !== 'string' || !city.cityKey))) throw new Error('Invalid native parent display transform.');
    if (options.expectedCityKey && city?.cityKey && options.expectedCityKey !== city.cityKey) throw new Error('Cette archive appartient à une autre ville ; aucun remplacement effectué.');
    async function* source() { yield headerBytes; if (remainder?.length) yield remainder;
      for (;;) { const part = await reader.read(); options.signal?.throwIfAborted(); if (part.done) return; yield part.value; } }
    const manifest = await importUrbanParentChunks(backend, source(), api, { expectedActive: options.expectedActive, signal: options.signal });
    return { ...parentStateFromManifest(manifest, { ...(city?.offset ? { offset: city.offset } : {}), ...(city?.cityKey ? { cityKey: city.cityKey } : {}) }), binding: 'imported' };
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
}
