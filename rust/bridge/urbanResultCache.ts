/** Browser (WASM profile) IndexedDB cache of urban results. Every access is
 * best effort: a failure simply behaves as a cache miss. */
export const URBAN_CACHE_VERSION = 1;
export const URBAN_CACHE_MAX_BYTES = 300 * 1024 * 1024;
const DB_NAME = 'magna-urbis-urban-cache', STORE = 'results';

export interface UrbanCacheEntryMeta { key: string; bytes: number; time: number }

/** Request fields that never influence the result. */
const IGNORED = new Set(['id', 'runtime', 'source']);

function hex(buffer: ArrayBuffer): string { return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join(''); }

/** SHA-256 of a byte-exact serialisation. Typed arrays are hashed by content. */
export async function sha256(parts: (string | ArrayBufferView)[]): Promise<string> {
  const encoder = new TextEncoder(), chunks = parts.map(p => typeof p === 'string' ? encoder.encode(p) : new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0)); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return hex(await crypto.subtle.digest('SHA-256', out));
}

/** Digest of any JSON-like value, typed arrays hashed by their bytes. */
export function digestValue(value: unknown): Promise<string> {
  const binary: ArrayBufferView[] = [];
  const json = JSON.stringify(value, (_key, v) => {
    if (ArrayBuffer.isView(v)) { binary.push(v); return `#bin:${binary.length - 1}:${v.constructor.name}:${v.byteLength}`; }
    return v;
  });
  return sha256([json ?? 'null', ...binary]);
}

/** Key = digest of everything the result depends on. `retained` is the exact
 * layouts JSON (or raster digest) the request refers to indirectly. */
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
    drop.push(entry.key); total -= entry.bytes;
  }
  return drop;
}

interface StoredEntry { key: string; time: number; bytes: number; value: unknown }
let dbPromise: Promise<IDBDatabase | undefined> | undefined;
function openDb(): Promise<IDBDatabase | undefined> {
  dbPromise ??= new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(undefined);
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => { try { open.result.createObjectStore(STORE, { keyPath: 'key' }); } catch { /* ignore */ } };
      open.onsuccess = () => resolve(open.result);
      open.onerror = open.onblocked = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
  return dbPromise;
}
function wrap<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise(resolve => { request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(undefined); });
}

export async function readUrbanCache<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb(); if (!db) return undefined;
    const entry = await wrap<StoredEntry | undefined>(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
    if (!entry) return undefined;
    // Touch for LRU; failure is irrelevant.
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...entry, time: Date.now() }); } catch { /* ignore */ }
    return entry.value as T;
  } catch { return undefined; }
}

/** `knownBytes`: size of the value's JSON when the caller already has its text
 * (Rust output), sparing a JSON.stringify of megabytes of geometry. */
export async function writeUrbanCache(key: string, value: unknown, knownBytes?: number): Promise<void> {
  try {
    const db = await openDb(); if (!db) return;
    const bytes = knownBytes ?? new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > URBAN_CACHE_MAX_BYTES / 2) return;
    const all = (await wrap<StoredEntry[]>(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) ?? [];
    const drop = planEviction(all.filter(e => e.key !== key).map(({ key, bytes, time }) => ({ key, bytes, time })), bytes);
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    for (const old of drop) store.delete(old);
    store.put({ key, time: Date.now(), bytes, value } satisfies StoredEntry);
  } catch { /* cache is optional */ }
}
