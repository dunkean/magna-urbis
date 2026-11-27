/** Browser (WASM profile) IndexedDB cache of urban results. Every access is
 * best effort: a failure simply behaves as a cache miss. */
// Civic water sites and shanties now apply scoped roof/storey overrides too.
export const URBAN_CACHE_VERSION = 2;
export const URBAN_CACHE_MAX_BYTES = 300 * 1024 * 1024;
const DB_NAME = 'magna-urbis-urban-cache',
  STORE = 'results',
  META = 'metadata';

export interface UrbanCacheEntryMeta {
  key: string;
  bytes: number;
  time: number;
}

/** Request fields that never influence the result. */
const IGNORED = new Set(['id', 'runtime', 'source']);

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of a byte-exact serialisation. Typed arrays are hashed by content. */
export async function sha256(parts: (string | ArrayBufferView)[]): Promise<string> {
  const encoder = new TextEncoder(),
    chunks = parts.map(p => (typeof p === 'string' ? encoder.encode(p) : new Uint8Array(p.buffer, p.byteOffset, p.byteLength)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return hex(await crypto.subtle.digest('SHA-256', out));
}

/** Digest of any JSON-like value, typed arrays hashed by their bytes. */
export function digestValue(value: unknown): Promise<string> {
  const binary: ArrayBufferView[] = [];
  const json = JSON.stringify(value, (_key, v) => {
    if (ArrayBuffer.isView(v)) {
      binary.push(v);
      return `#bin:${binary.length - 1}:${v.constructor.name}:${v.byteLength}`;
    }
    return v;
  });
  return sha256([json ?? 'null', ...binary]);
}

/** Key = digest of everything the result depends on, including the digests
 * of the raster and any layouts the request refers to indirectly. */
export async function urbanCacheKey(request: Record<string, unknown>, context: { engine: string; terrain?: string; retainedLayouts?: string }): Promise<string> {
  const input: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(request)) if (!IGNORED.has(name) && name !== 'layoutsId' && value !== undefined) input[name] = value;
  return digestValue({ v: URBAN_CACHE_VERSION, engine: context.engine, terrain: context.terrain ?? null, layouts: context.retainedLayouts ?? null, input });
}

/** Least recently used keys to drop so `entries` (plus `incoming` bytes) fit. */
export function planEviction(entries: UrbanCacheEntryMeta[], incoming: number, maxBytes = URBAN_CACHE_MAX_BYTES): string[] {
  let total = incoming + entries.reduce((n, e) => n + e.bytes, 0);
  const drop: string[] = [];
  for (const entry of [...entries].sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : 1))) {
    if (total <= maxBytes) break;
    drop.push(entry.key);
    total -= entry.bytes;
  }
  return drop;
}

interface StoredEntry {
  key: string;
  bytes: number;
  value: unknown;
}
let dbPromise: Promise<IDBDatabase | undefined> | undefined;
function openDb(): Promise<IDBDatabase | undefined> {
  dbPromise ??= new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(undefined);
      const open = indexedDB.open(DB_NAME, 2);
      open.onupgradeneeded = () => {
        try {
          const db = open.result;
          if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
          db.createObjectStore(STORE, { keyPath: 'key' });
          db.createObjectStore(META, { keyPath: 'key' });
        } catch {
          open.transaction?.abort();
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      open.onerror = open.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return dbPromise;
}
export async function readUrbanCache<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    if (!db) return undefined;
    return await new Promise<T | undefined>(resolve => {
      const tx = db.transaction([STORE, META], 'readwrite');
      const get = tx.objectStore(STORE).get(key);
      get.onsuccess = () => {
        const entry = get.result as StoredEntry | undefined;
        if (entry) {
          // Touch in the same transaction so eviction cannot race the update.
          try {
            tx.objectStore(META).put({ key, bytes: entry.bytes, time: Date.now() } satisfies UrbanCacheEntryMeta);
          } catch {
            /* ignore */
          }
        }
        resolve(entry?.value as T | undefined);
      };
      get.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

/** Stored size of a value: binary members (a parcel pack) by their byte length, the rest as JSON. */
export function cacheValueBytes(value: unknown): number {
  let binary = 0;
  const json = JSON.stringify(value, (_key, v) => {
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
      binary += (v as ArrayBuffer | ArrayBufferView).byteLength;
      return null;
    }
    return v;
  });
  return binary + new TextEncoder().encode(json ?? 'null').byteLength;
}

/** `knownBytes`: size of the value when the caller already knows it (Rust texts,
 * pack byte lengths), sparing a JSON.stringify of megabytes of geometry. */
export async function writeUrbanCache(key: string, value: unknown, knownBytes?: number): Promise<void> {
  await tryWriteUrbanCache(key, value, knownBytes);
}

export async function tryWriteUrbanCache(key: string, value: unknown, knownBytes?: number): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    const bytes = knownBytes ?? cacheValueBytes(value);
    if (bytes > URBAN_CACHE_MAX_BYTES / 2) return false;
    return await new Promise<boolean>(resolve => {
      const tx = db.transaction([STORE, META], 'readwrite');
      const store = tx.objectStore(STORE),
        meta = tx.objectStore(META);
      const all = meta.getAll();
      tx.oncomplete = () => resolve(true);
      tx.onabort = tx.onerror = () => resolve(false);
      all.onsuccess = () => {
        try {
          const entries = all.result as UrbanCacheEntryMeta[];
          for (const old of planEviction(
            entries.filter(e => e.key !== key),
            bytes,
          )) {
            store.delete(old);
            meta.delete(old);
          }
          store.put({ key, bytes, value } satisfies StoredEntry);
          meta.put({ key, bytes, time: Date.now() } satisfies UrbanCacheEntryMeta);
        } catch {
          tx.abort();
        }
      };
    });
  } catch {
    return false;
  }
}
