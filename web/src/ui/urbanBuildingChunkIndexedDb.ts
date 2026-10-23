/** Real IndexedDB adapter. Transactions finish before append/commit resolve.
 * Browser quota and transaction lifetime require browser integration validation;
 * the memory-backend tests do not provide that evidence. */
import type { BuildingChunkBackend, BuildingChunkIndex, BuildingChunkManifest, StoredBuildingChunk } from './urbanBuildingChunkStore';

interface SceneRecord { sceneId: string; state: 'staging' | 'committed'; chunks: number; manifest?: BuildingChunkManifest }
type StoredChunk = StoredBuildingChunk & { sceneId: string };
type StoredIndex = BuildingChunkIndex & { sceneId: string; spatialKeys: string[] };
const SPATIAL = (sceneId: string, tile: string) => `${sceneId}\0${tile}`;

export async function createIndexedDbBuildingChunkBackend(name = 'magna-urban-building-chunks-v1'): Promise<BuildingChunkBackend & { close(): void }> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable for retained building chunks.');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1); let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('scenes', { keyPath: 'sceneId' });
      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('chunks', { keyPath: ['sceneId', 'index'] }).createIndex('scene', 'sceneId');
      const buildings = db.createObjectStore('buildings', { keyPath: ['sceneId', 'id'] });
      buildings.createIndex('scene', 'sceneId'); buildings.createIndex('tiles', 'spatialKeys', { multiEntry: true });
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Retained building database upgrade is blocked by another tab.')); };
  });
  function transaction<T>(names: string[], mode: IDBTransactionMode,
    action: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const tx = db.transaction(names, mode); let value: T, error: unknown;
      const fail = (reason: unknown) => {
        const previous = error; error = reason;
        try { tx.abort(); }
        catch { error = previous; /* A completed transaction cannot be rolled back by a late signal. */ }
      };
      const aborted = () => fail(signal?.reason ?? new DOMException('Building commit cancelled', 'AbortError'));
      const cleanup = () => signal?.removeEventListener('abort', aborted);
      signal?.addEventListener('abort', aborted, { once: true });
      tx.oncomplete = () => { cleanup(); resolve(value); };
      tx.onabort = () => { cleanup(); reject(error ?? tx.error ?? new Error('Retained building transaction aborted.')); };
      tx.onerror = () => { error ??= tx.error; };
      try { action(tx, result => { value = result; }, fail); } catch (reason) { fail(reason); }
    });
  }
  const get = <T>(store: string, key: IDBValidKey): Promise<T | undefined> => transaction([store], 'readonly', (tx, done) => {
    const request = tx.objectStore(store).get(key); request.onsuccess = () => done(request.result as T | undefined);
  });
  const stripIndex = ({ sceneId: _scene, spatialKeys: _keys, ...entry }: StoredIndex): BuildingChunkIndex => entry;
  const backend: BuildingChunkBackend & { close(): void } = {
    begin(sceneId) { return transaction(['scenes'], 'readwrite', (tx, done) => {
      tx.objectStore('scenes').add({ sceneId, state: 'staging', chunks: 0 } satisfies SceneRecord); done(undefined);
    }); },
    append(sceneId, chunk, entries) { return transaction(['scenes', 'chunks', 'buildings'], 'readwrite', (tx, done, fail) => {
      const scenes = tx.objectStore('scenes'), request = scenes.get(sceneId);
      request.onsuccess = () => {
        try {
          const stage = request.result as SceneRecord | undefined;
          if (!stage || stage.state !== 'staging' || stage.chunks !== chunk.index) throw new Error('Retained building stage sequence changed.');
          tx.objectStore('chunks').add({ ...chunk, sceneId } satisfies StoredChunk);
          for (const entry of entries) tx.objectStore('buildings').add({ ...entry, sceneId, spatialKeys: entry.tiles.map(tile => SPATIAL(sceneId, tile)) } satisfies StoredIndex);
          scenes.put({ ...stage, chunks: stage.chunks + 1 }); done(undefined);
        } catch (reason) { fail(reason); }
      };
    }); },
    commit(manifest, expectedActive, options) { return transaction(['scenes', 'meta'], 'readwrite', (tx, done, fail) => {
      const scenes = tx.objectStore('scenes'), meta = tx.objectStore('meta');
      const stage = scenes.get(manifest.sceneId), active = meta.get('active'); let finished = 0;
      const received = () => {
        if (++finished !== 2) return;
        try {
          const record = stage.result as SceneRecord | undefined;
          if (!record || record.state !== 'staging' || record.chunks !== manifest.chunks.length) throw new Error('Retained building stage is incomplete.');
          if ((active.result?.sceneId ?? null) !== expectedActive) throw new Error('Active retained building generation changed.');
          scenes.put({ ...record, state: 'committed', manifest } satisfies SceneRecord);
          meta.put({ key: 'active', sceneId: manifest.sceneId }); done(undefined);
        } catch (reason) { fail(reason); }
      };
      stage.onsuccess = received; active.onsuccess = received;
    }, options?.signal); },
    async active() { const pointer = await get<{ sceneId: string }>('meta', 'active'); return pointer ? backend.manifest(pointer.sceneId) : undefined; },
    async manifest(sceneId) { const record = await get<SceneRecord>('scenes', sceneId); return record?.state === 'committed' ? record.manifest : undefined; },
    async chunk(sceneId, index) {
      const record = await get<StoredChunk>('chunks', [sceneId, index]); if (!record) return undefined;
      const { sceneId: _scene, ...chunk } = record; return chunk;
    },
    async building(sceneId, id) { const entry = await get<StoredIndex>('buildings', [sceneId, id]); return entry && stripIndex(entry); },
    tile(sceneId, tile, limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0) return Promise.reject(new Error('Invalid retained tile read budget.'));
      return transaction(['buildings'], 'readonly', (tx, done) => {
        const request = tx.objectStore('buildings').index('tiles').getAll(IDBKeyRange.only(SPATIAL(sceneId, tile)), limit);
        // Conservatively report a full page as truncated; never fetch a lookahead record over budget.
        request.onsuccess = () => done({ entries: (request.result as StoredIndex[]).map(stripIndex), truncated: request.result.length === limit });
      });
    },
    discard(sceneId) { return transaction(['scenes', 'chunks', 'buildings'], 'readwrite', (tx, done, fail) => {
      const scenes = tx.objectStore('scenes'), request = scenes.get(sceneId);
      request.onsuccess = () => {
        if (request.result?.state === 'committed') { fail(new Error('Cannot discard a committed building scene.')); return; }
        scenes.delete(sceneId);
        for (const name of ['chunks', 'buildings']) {
          const cursor = tx.objectStore(name).index('scene').openCursor(IDBKeyRange.only(sceneId));
          cursor.onsuccess = () => { const current = cursor.result; if (current) { current.delete(); current.continue(); } };
        }
        done(undefined);
      };
    }); },
    close() { db.close(); },
  };
  return backend;
}
