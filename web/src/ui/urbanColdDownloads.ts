import { exportUrbanBuildingChunks, type BuildingChunkBackend } from './urbanBuildingChunkStore';
import type { ColdCityState } from './urbanColdCitySession';

interface ChunkFile { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }
interface ChunkFileHandle { createWritable(): Promise<ChunkFile> }
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<ChunkFileHandle>;
const FALLBACK_LIMIT = 64 * 1024 * 1024;

/** The picker is requested before the first await so the export button keeps
 * browser user activation. Large archives are never accumulated into a Blob. */
export async function downloadColdBuildings(backend: BuildingChunkBackend | Promise<BuildingChunkBackend>, state: ColdCityState): Promise<void> {
  const pendingStorage = Promise.resolve(backend).then(storage => ({ storage }), error => ({ error }));
  const picker: SavePicker | undefined = 'showSaveFilePicker' in window && typeof window.showSaveFilePicker === 'function'
    ? window.showSaveFilePicker.bind(window) : undefined;
  const handle = picker ? await picker({ suggestedName: 'urban-buildings.ndjson',
    types: [{ description: 'Maisons natives complètes', accept: { 'application/x-ndjson': ['.ndjson'] } }] }) : undefined;
  const storageResult = await pendingStorage; if ('error' in storageResult) throw storageResult.error;
  const storage = storageResult.storage, manifest = await storage.manifest(state.store.sceneId);
  if (!manifest || manifest.fingerprint !== state.store.fingerprint) throw new Error('La scène à exporter a été remplacée.');
  async function* parts() {
    let first = true;
    for await (const part of exportUrbanBuildingChunks(storage, state.store.sceneId)) {
      if (first) {
        first = false;
        const frame = JSON.parse(new TextDecoder().decode(part));
        yield new TextEncoder().encode(JSON.stringify({ ...frame,
          city: { format: 'native-city-transform-1', offset: state.offset ?? { x: 0, y: 0 }, cityKey: state.cityKey } }) + '\n');
      } else yield part;
    }
  }
  if (handle) {
    const writer = await handle.createWritable();
    try {
      for await (const part of parts()) await writer.write(part);
      await writer.close();
    } catch (error) { try { await writer.abort?.(); } catch { /* Preserve the original export failure. */ } throw error; }
    return;
  }
  // Browser compatibility path has an explicit bound, including framing.
  if (manifest.chunks.reduce((n, chunk) => n + chunk.bytes + 2048, 0) + JSON.stringify(manifest).length * 2 > FALLBACK_LIMIT)
    throw new Error('Cette archive nécessite un navigateur permettant d’enregistrer un gros fichier directement sur disque.');
  const collected: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  for await (const part of parts()) {
    bytes += part.byteLength; if (bytes > FALLBACK_LIMIT) throw new Error('Archive trop grande pour le téléchargement en mémoire de ce navigateur.');
    collected.push(new Uint8Array(part));
  }
  const url = URL.createObjectURL(new Blob(collected, { type: 'application/x-ndjson' }));
  const link = document.createElement('a'); link.href = url; link.download = 'urban-buildings.ndjson'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
