import type { ParentVisualChunk } from './urbanParentVisualCache';
/** Version4 additive stores in the SAME database and SAME active pointer as
 * legacy Singles. Transactions resolve only after durable completion. */
import { PARENT_SCENE_FORMAT, type ParentChunkBackend, type ParentSceneManifest, type StoredParentChunk,
  type ParentSourceIndex, type ParentMemberIndex, type ParentActiveReference } from './urbanParentChunkStore';
interface Stage { sceneId: string; state: 'staging' | 'committed'; chunks: number; manifest?: ParentSceneManifest }
type Source = StoredParentChunk & { sceneId: string };
type Parent = ParentSourceIndex & { sceneId: string; spatialKeys: string[] };
type Member = ParentMemberIndex & { sceneId: string; spatialKeys: string[] };
const spatial = (sceneId: string, tile: string) => `${sceneId}\0${tile}`;
export function upgradeParentChunkStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('parentVisualChunks')) db.createObjectStore('parentVisualChunks', { keyPath: ['sceneId', 'index'] }).createIndex('scene', 'sceneId');
  if (db.objectStoreNames.contains('parentScenes')) return;
  db.createObjectStore('parentScenes', { keyPath: 'sceneId' });
  db.createObjectStore('parentChunks', { keyPath: ['sceneId', 'index'] }).createIndex('scene', 'sceneId');
  for (const name of ['parentIndex', 'memberIndex']) {
    const store = db.createObjectStore(name, { keyPath: ['sceneId', 'id'] });
    store.createIndex('scene', 'sceneId'); store.createIndex('tiles', 'spatialKeys', { multiEntry: true });
  }
}
export function createParentChunkIndexedDbAdapter(db: IDBDatabase): ParentChunkBackend {
  function transaction<T>(names: string[], mode: IDBTransactionMode,
    action: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted(); const tx = db.transaction(names, mode); let value: T, error: unknown;
      const fail = (e: unknown) => { error = e; try { tx.abort(); } catch { /* completed transaction cannot be rewound */ } };
      const aborted = () => fail(signal?.reason ?? new DOMException('Parent transaction cancelled', 'AbortError'));
      const cleanup = () => signal?.removeEventListener('abort', aborted);
      signal?.addEventListener('abort', aborted, { once: true });
      tx.oncomplete = () => { cleanup(); resolve(value); }; tx.onabort = () => { cleanup(); reject(error ?? tx.error); };
      tx.onerror = () => { error ??= tx.error; };
      try { action(tx, v => { value = v; }, fail); } catch (e) { fail(e); }
    });
  }
  const get = <T>(name: string, key: IDBValidKey): Promise<T | undefined> => transaction([name], 'readonly', (tx, done) => {
    const request = tx.objectStore(name).get(key); request.onsuccess = () => done(request.result as T | undefined);
  });
  function strip<T extends Parent | Member>(entry: T): Omit<T, 'sceneId' | 'spatialKeys'> {
    const { sceneId: _id, spatialKeys: _keys, ...rest } = entry; return rest;
  }
  const api: ParentChunkBackend = {
    begin(sceneId) { return transaction(['parentScenes'], 'readwrite', (tx, done) => {
      tx.objectStore('parentScenes').add({ sceneId, state: 'staging', chunks: 0 } satisfies Stage); done(undefined);
    }); },
    append(sceneId, chunk, parents, members, visual) { return transaction(['parentScenes', 'parentChunks', 'parentIndex', 'memberIndex', 'parentVisualChunks'], 'readwrite', (tx, done, fail) => {
      const req = tx.objectStore('parentScenes').get(sceneId); req.onsuccess = () => { try {
        const stage = req.result as Stage | undefined;
        if (!stage || stage.state !== 'staging' || stage.chunks !== chunk.index) throw new Error('Parent source stage sequence changed.');
        if (parents.length !== chunk.counts.admitted_parents || members.length !== chunk.counts.physical_members) throw new Error('Parent index count mismatch.');
        tx.objectStore('parentChunks').add({ ...chunk, sceneId } satisfies Source);
        if (visual) {
          if (visual.index !== chunk.index || visual.sourceSha256 !== chunk.sha256) throw new Error('Parent child cache/source identity mismatch.');
          tx.objectStore('parentVisualChunks').add({ ...visual, sceneId });
        }
        for (const p of parents) tx.objectStore('parentIndex').add({ ...p, sceneId, spatialKeys: p.tiles.map(t => spatial(sceneId, t)) } satisfies Parent);
        for (const m of members) tx.objectStore('memberIndex').add({ ...m, sceneId, spatialKeys: m.tiles.map(t => spatial(sceneId, t)) } satisfies Member);
        tx.objectStore('parentScenes').put({ ...stage, chunks: stage.chunks + 1 }); done(undefined);
      } catch (e) { fail(e); } };
    }); },
    commit(manifest, expectedActive, options) { return transaction(['parentScenes', 'meta'], 'readwrite', (tx, done, fail) => {
      const stage = tx.objectStore('parentScenes').get(manifest.sceneId), pointer = tx.objectStore('meta').get('active'); let received = 0;
      const ready = () => { if (++received !== 2) return; try {
        const record = stage.result as Stage | undefined, active = pointer.result as ParentActiveReference | undefined;
        if (!record || record.state !== 'staging' || record.chunks !== manifest.chunks.length) throw new Error('Incomplete native parent stage.');
        const actual = active ? { sceneId: active.sceneId, format: active.format ?? 'urban-building-chunks-1' } : null;
        if ((actual?.sceneId ?? null) !== (expectedActive?.sceneId ?? null) || (actual?.format ?? null) !== (expectedActive?.format ?? null)) throw new Error('Active native generation changed.');
        tx.objectStore('parentScenes').put({ ...record, state: 'committed', manifest } satisfies Stage);
        tx.objectStore('meta').put({ key: 'active', sceneId: manifest.sceneId, format: PARENT_SCENE_FORMAT }); done(undefined);
      } catch (e) { fail(e); } };
      stage.onsuccess = ready; pointer.onsuccess = ready;
    }, options?.signal); },
    async visualChunk(sceneId, index) { const value = await get<ParentVisualChunk & { sceneId: string }>('parentVisualChunks', [sceneId, index]);
      if (!value) return; const { sceneId: _scene, ...chunk } = value; return chunk; },
    putVisual(sceneId, chunk) { return transaction(['parentChunks', 'parentVisualChunks'], 'readwrite', (tx, done, fail) => {
      // Read ONE immutable source chunk, never clone the complete manifest on
      // every repair write (which would be quadratic in the city chunk count).
      const req = tx.objectStore('parentChunks').get([sceneId, chunk.index]); req.onsuccess = () => {
        if ((req.result as Source | undefined)?.sha256 !== chunk.sourceSha256) { fail(new Error('Native parent source changed during visual repair.')); return; }
        tx.objectStore('parentVisualChunks').put({ ...chunk, sceneId }); done(undefined);
      };
    }); },
    parentTile(sceneId, tile, limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 4096) return Promise.reject(new Error('Invalid parent context tile budget.'));
      return transaction(['parentIndex'], 'readonly', (tx, done) => { const req = tx.objectStore('parentIndex').index('tiles').getAll(IDBKeyRange.only(spatial(sceneId, tile)), limit);
        req.onsuccess = () => done({ entries: (req.result as Parent[]).map(strip), truncated: req.result.length === limit }); });
    },
    async activeReference() { const p = await get<ParentActiveReference>('meta', 'active'); return p ? { sceneId: p.sceneId, format: p.format ?? 'urban-building-chunks-1' } : undefined; },
    async manifest(sceneId) { const stage = await get<Stage>('parentScenes', sceneId); return stage?.state === 'committed' ? stage.manifest : undefined; },
    async chunk(sceneId, index) { const value = await get<Source>('parentChunks', [sceneId, index]); if (!value) return; const { sceneId: _scene, ...chunk } = value; return chunk; },
    async parent(sceneId, id) { const p = await get<Parent>('parentIndex', [sceneId, id]); return p && strip(p); },
    async member(sceneId, id) { const m = await get<Member>('memberIndex', [sceneId, id]); return m && strip(m); },
    tile(sceneId, tile, limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 4096) return Promise.reject(new Error('Invalid parent tile budget.'));
      return transaction(['memberIndex'], 'readonly', (tx, done) => {
        const req = tx.objectStore('memberIndex').index('tiles').getAll(IDBKeyRange.only(spatial(sceneId, tile)), limit);
        req.onsuccess = () => done({ entries: (req.result as Member[]).map(strip), truncated: req.result.length === limit });
      });
    },
    discard(sceneId) { return transaction(['parentScenes', 'parentChunks', 'parentIndex', 'memberIndex', 'parentVisualChunks'], 'readwrite', (tx, done, fail) => {
      const req = tx.objectStore('parentScenes').get(sceneId); req.onsuccess = () => {
        if (req.result?.state === 'committed') { fail(new Error('Cannot discard committed native parent scene.')); return; }
        tx.objectStore('parentScenes').delete(sceneId);
        for (const name of ['parentChunks', 'parentIndex', 'memberIndex', 'parentVisualChunks']) {
          const cursor = tx.objectStore(name).index('scene').openCursor(IDBKeyRange.only(sceneId)); cursor.onsuccess = () => {
            const c = cursor.result; if (c) { c.delete(); c.continue(); }
          };
        } done(undefined);
      };
    }); },
  }; return api;
}
