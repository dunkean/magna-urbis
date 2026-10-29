import type { TerrainLayer } from '../gen/types';

/** Bump when terrain semantics change: saved worlds remain importable, cached computations expire. */
export const V2_ENGINE_VERSION = 'mu-v2-bench-terrain-2026-10-28.3';
export interface TerrainStore {
  get(key: string): Promise<TerrainLayer | undefined>;
  put(key: string, value: TerrainLayer): Promise<void>;
  clear(): Promise<void>;
}

/** Structured clone in IndexedDB preserves typed arrays and their exact scalar values. */
export class IndexedTerrainStore implements TerrainStore {
  private db?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB indisponible'));
    return this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      let abandoned = false;
      const request = indexedDB.open('magna-urbis-v2', 2);
      request.onupgradeneeded = () => {
        const store = request.result.objectStoreNames.contains('terrain') ? request.transaction!.objectStore('terrain') : request.result.createObjectStore('terrain', { keyPath: 'key' });
        if (!store.indexNames.contains('saved')) store.createIndex('saved', 'saved');
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.db = undefined; };
        resolve(db);
      };
      request.onerror = () => { abandoned = true; reject(request.error); };
      request.onblocked = () => { abandoned = true; reject(new Error('Le cache est utilisé par un ancien onglet.')); };
    }).catch(error => { this.db = undefined; throw error; });
  }
  async get(key: string): Promise<TerrainLayer | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('terrain').objectStore('terrain').get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }
  async put(key: string, value: TerrainLayer): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('terrain', 'readwrite');
      const store = transaction.objectStore('terrain');
      store.put({ key, value, saved: Date.now() });
      // Bound disk use to the three newest terrains. Every entry is a complete retained hydrology.
      // Read index keys and timestamps only. getAll() cloned every complete raster back
      // into JS merely to decide which entry to evict, including the newly written one.
      const entries: { key: IDBValidKey; saved: number }[] = [];
      const request = store.index('saved').openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { entries.push({ key: cursor.primaryKey, saved: Number(cursor.key) }); cursor.continue(); }
        else {
          // Index order is timestamp then primary key ascending; stable sorting keeps
          // the previous getAll()/sort eviction order when timestamps are tied.
          entries.sort((a, b) => b.saved - a.saved);
          for (let index = 3; index < entries.length; index++) store.delete(entries[index].key);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Écriture du cache interrompue.'));
    });
  }
  async clear(): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('terrain', 'readwrite');
      transaction.objectStore('terrain').clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

/** Two-entry in-memory LRU; all boundaries clone so a later urban stage cannot corrupt a cached map. */
export class TerrainCache {
  private memory = new Map<string, TerrainLayer>();
  constructor(private store: TerrainStore = new IndexedTerrainStore()) {}
  private retain(key: string, terrain: TerrainLayer): void {
    this.memory.delete(key);
    this.memory.set(key, structuredClone(terrain));
    if (this.memory.size > 2) this.memory.delete(this.memory.keys().next().value!);
  }
  async get(key: string): Promise<{ terrain: TerrainLayer; source: 'memory' | 'disk' } | undefined> {
    const memory = this.memory.get(key);
    if (memory) {
      this.memory.delete(key); this.memory.set(key, memory);
      return { terrain: structuredClone(memory), source: 'memory' };
    }
    try {
      const terrain = await this.store.get(key);
      if (terrain) { this.retain(key, terrain); return { terrain, source: 'disk' }; }
    } catch { /* Private browsing, quota, unavailable storage: generation remains usable. */ }
    return undefined;
  }
  async put(key: string, terrain: TerrainLayer): Promise<boolean> {
    this.retain(key, terrain);
    try { await this.store.put(key, terrain); return true; } catch { return false; }
  }
  async clear(): Promise<void> {
    this.memory.clear();
    try { await this.store.clear(); } catch { /* No persistent cache to clear. */ }
  }
}

export const terrainCache = new TerrainCache();
