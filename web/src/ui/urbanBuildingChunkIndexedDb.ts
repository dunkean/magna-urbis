import type { ParentChunkBackend } from './urbanParentChunkStore';
import { upgradeParentChunkStores, createParentChunkIndexedDbAdapter } from './urbanParentChunkIndexedDb';
/** Real IndexedDB adapter. Transactions finish before append/commit resolve.
 * Browser quota and transaction lifetime require browser integration validation;
 * the memory-backend tests do not provide that evidence. */
import type { BuildingChunkBackend, BuildingChunkIndex, BuildingChunkManifest, StoredBuildingChunk } from './urbanBuildingChunkStore';
import type { DerivedBackend, DerivedManifest, DerivedChunk, DerivedOrigin } from './urbanBuildingDerivedCache';
import type { ColdOverviewBackend, StoredColdOverview } from './urbanColdOverviewCache';
type DerivedScene = { sceneId: string; cacheId: string; state: 'staging' | 'committed'; chunks: number; manifest?: DerivedManifest };

interface SceneRecord { sceneId: string; state: 'staging' | 'committed'; chunks: number; manifest?: BuildingChunkManifest }
type StoredChunk = StoredBuildingChunk & { sceneId: string };
type StoredIndex = BuildingChunkIndex & { sceneId: string; spatialKeys: string[] };
const SPATIAL = (sceneId: string, tile: string) => `${sceneId}\0${tile}`;

export async function createIndexedDbBuildingChunkBackend(name = 'magna-urban-building-chunks-v1'): Promise<BuildingChunkBackend & { parents: ParentChunkBackend; close(): void }> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable for retained building chunks.');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 4); let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('scenes')) {
        db.createObjectStore('scenes', { keyPath: 'sceneId' });
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('chunks', { keyPath: ['sceneId', 'index'] }).createIndex('scene', 'sceneId');
        const buildings = db.createObjectStore('buildings', { keyPath: ['sceneId', 'id'] });
        buildings.createIndex('scene', 'sceneId'); buildings.createIndex('tiles', 'spatialKeys', { multiEntry: true });
      }
      if (!db.objectStoreNames.contains('derivedScenes')) {
        db.createObjectStore('derivedScenes', { keyPath: 'sceneId' });
        for (const [name, last] of [['derivedChunks', 'index'], ['derivedOrigins', 'id']]) {
          const store = db.createObjectStore(name, { keyPath: ['sceneId', 'cacheId', last] });
          store.createIndex('scene', 'sceneId'); store.createIndex('cache', 'cacheKey');
        }
      }
      upgradeParentChunkStores(db);
      if (!db.objectStoreNames.contains('coldOverviews')) db.createObjectStore('coldOverviews', { keyPath: ['sceneId', 'key'] });
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
  const cacheKey = (sceneId: string, cacheId: string) => `${sceneId}\0${cacheId}`;
  const clearDerived = (tx: IDBTransaction, index: 'scene' | 'cache', key: string) => {
    for (const name of ['derivedChunks', 'derivedOrigins']) {
      const request = tx.objectStore(name).index(index).openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    }
  };
  const derived: DerivedBackend = {
    begin(sceneId, cacheId) { return transaction(['derivedScenes', 'derivedChunks', 'derivedOrigins'], 'readwrite', (tx, done) => {
      clearDerived(tx, 'scene', sceneId);
      tx.objectStore('derivedScenes').put({ sceneId, cacheId, state: 'staging', chunks: 0 } satisfies DerivedScene); done(undefined);
    }); },
    append(sceneId, cacheId, chunk, origins) { return transaction(['derivedScenes', 'derivedChunks', 'derivedOrigins'], 'readwrite', (tx, done, fail) => {
      const request = tx.objectStore('derivedScenes').get(sceneId);
      request.onsuccess = () => { try {
        const state = request.result as DerivedScene | undefined;
        if (!state || state.cacheId !== cacheId || state.state !== 'staging' || state.chunks !== chunk.index) throw new Error('Derived cache generation changed.');
        const key = cacheKey(sceneId, cacheId);
        tx.objectStore('derivedChunks').add({ ...chunk, sceneId, cacheId, cacheKey: key });
        for (const origin of origins) tx.objectStore('derivedOrigins').add({ ...origin, sceneId, cacheId, cacheKey: key });
        tx.objectStore('derivedScenes').put({ ...state, chunks: state.chunks + 1 }); done(undefined);
      } catch (error) { fail(error); } };
    }); },
    commit(manifest, options) { return transaction(['scenes', 'derivedScenes'], 'readwrite', (tx, done, fail) => {
      const native = tx.objectStore('scenes').get(manifest.sceneId), cache = tx.objectStore('derivedScenes').get(manifest.sceneId); let received = 0;
      const ready = () => { if (++received !== 2) return; try {
        const parent = native.result as SceneRecord | undefined, state = cache.result as DerivedScene | undefined;
        if (parent?.state !== 'committed' || parent.manifest?.fingerprint !== manifest.parentFingerprint
          || parent.manifest.sourceFingerprint !== manifest.sourceFingerprint || state?.state !== 'staging'
          || state.cacheId !== manifest.cacheId || state.chunks !== manifest.chunks.length) throw new Error('Derived cache has no matching committed parent/generation.');
        tx.objectStore('derivedScenes').put({ ...state, state: 'committed', manifest }); done(undefined);
      } catch (error) { fail(error); } };
      native.onsuccess = ready; cache.onsuccess = ready;
    }, options?.signal); },
    async manifest(sceneId) { const value = await get<DerivedScene>('derivedScenes', sceneId); return value?.state === 'committed' ? value.manifest : undefined; },
    async chunk(sceneId, cacheId, index) {
      const value = await get<DerivedChunk & { sceneId: string; cacheId: string; cacheKey: string }>('derivedChunks', [sceneId, cacheId, index]);
      if (!value) return undefined; const { sceneId: _scene, cacheId: _cache, cacheKey: _key, ...chunk } = value; return chunk;
    },
    async origin(sceneId, cacheId, id) {
      const value = await get<DerivedOrigin & { sceneId: string; cacheId: string; cacheKey: string }>('derivedOrigins', [sceneId, cacheId, id]);
      if (!value) return undefined; const { sceneId: _scene, cacheId: _cache, cacheKey: _key, ...origin } = value; return origin;
    },
    discard(sceneId, cacheId) { return transaction(['derivedScenes', 'derivedChunks', 'derivedOrigins'], 'readwrite', (tx, done, fail) => {
      const request = tx.objectStore('derivedScenes').get(sceneId);
      request.onsuccess = () => {
        const state = request.result as DerivedScene | undefined;
        if (state?.cacheId === cacheId && state.state === 'committed') { fail(new Error('Cannot discard a committed derivative.')); return; }
        clearDerived(tx, 'cache', cacheKey(sceneId, cacheId));
        if (state?.cacheId === cacheId) tx.objectStore('derivedScenes').delete(sceneId); done(undefined);
      };
    }); },
  };
  const overview: ColdOverviewBackend = {
    read(sceneId, key) { return get<StoredColdOverview>('coldOverviews', [sceneId, key]); },
    commit(value, options) { return transaction(['scenes', 'derivedScenes', 'coldOverviews'], 'readwrite', (tx, done, fail) => {
      const native = tx.objectStore('scenes').get(value.sceneId), cache = tx.objectStore('derivedScenes').get(value.sceneId); let ready = 0;
      const received = () => { if (++ready !== 2) return; try {
        const n = native.result as SceneRecord | undefined, d = cache.result as DerivedScene | undefined;
        if (n?.state !== 'committed' || n.manifest?.fingerprint !== value.parentFingerprint || n.manifest.sourceFingerprint !== value.sourceFingerprint
          || d?.state !== 'committed' || d.manifest?.fingerprint !== value.derivedFingerprint || d.manifest.parentFingerprint !== value.parentFingerprint
          || d.manifest.sourceFingerprint !== value.sourceFingerprint)
          throw new Error('Overview native/derived parent changed.');
        tx.objectStore('coldOverviews').put(value); done(undefined);
      } catch (e) { fail(e); } };
      native.onsuccess = received; cache.onsuccess = received;
    }, options?.signal); },
  };
  const backend: BuildingChunkBackend & { parents: ParentChunkBackend; close(): void } = {
    overview,
    derived,
    parents: createParentChunkIndexedDbAdapter(db),
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
          meta.put({ key: 'active', sceneId: manifest.sceneId, format: 'urban-building-chunks-1' }); done(undefined);
        } catch (reason) { fail(reason); }
      };
      stage.onsuccess = received; active.onsuccess = received;
    }, options?.signal); },
    async active() { const pointer = await get<{ sceneId: string; format?: string }>('meta', 'active');
      if (pointer?.format && pointer.format !== 'urban-building-chunks-1') throw new Error('Active city contains native parent archives; use the parent scene reader.');
      return pointer ? backend.manifest(pointer.sceneId) : undefined; },
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
