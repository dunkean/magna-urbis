import { afterEach, expect, it, vi } from 'vitest';
import { createIndexedDbBuildingChunkBackend } from '../src/ui/urbanBuildingChunkIndexedDb';
import type { BuildingChunkManifest } from '../src/ui/urbanBuildingChunkStore';
import type { DerivedManifest } from '../src/ui/urbanBuildingDerivedCache';
import type { StoredColdOverview } from '../src/ui/urbanColdOverviewCache';
import { deferred } from './helpers/urbanBuildingColdTestBackend';

/** Transaction double exercises the actual adapter and AbortSignal listener
 * lifetime, not browser IndexedDB scheduling/durability/quota. */
function database() {
  const records = { scenes: new Map<string, unknown>([['new', { sceneId: 'new', state: 'staging', chunks: 1 }]]),
    meta: new Map<string, unknown>([['active', { key: 'active', sceneId: 'old' }]]),
    derivedScenes: new Map<string, unknown>([['new', { sceneId: 'new', cacheId: 'cache-new', state: 'staging', chunks: 1 }]]),
    coldOverviews: new Map<string, unknown>() };
  class Transaction {
    oncomplete?: () => void; onabort?: () => void; onerror?: () => void;
    error: DOMException | null = null; aborted = false; finished = false; aborts = 0;
    writes: { store: keyof typeof records; key: string; value: unknown }[] = [];
    ready = deferred();
    objectStore(store: keyof typeof records) {
      return {
        get: (key: string | string[]) => {
          const request = { result: structuredClone(records[store].get(Array.isArray(key) ? JSON.stringify(key) : key)), onsuccess: undefined as (() => void) | undefined };
          queueMicrotask(() => { if (!this.aborted) request.onsuccess?.(); }); return request;
        },
        put: (value: { sceneId?: string; key?: string }) => {
          if (this.aborted || this.finished) throw new Error('Inactive transaction');
          this.writes.push({ store, key: store === 'meta' ? value.key! : store === 'coldOverviews' ? JSON.stringify([value.sceneId, value.key]) : value.sceneId!, value: structuredClone(value) });
          if (store === 'meta' || store === 'derivedScenes' || store === 'coldOverviews') this.ready.resolve();
        },
      };
    }
    abort() {
      if (this.finished || this.aborted) throw new DOMException('Inactive transaction', 'InvalidStateError');
      this.aborts++; this.aborted = true; this.writes = []; this.error = new DOMException('Transaction aborted', 'AbortError');
      queueMicrotask(() => this.onabort?.());
    }
    finish() {
      if (this.aborted) throw new Error('Cannot finish aborted transaction'); this.finished = true;
      for (const write of this.writes) records[write.store].set(write.key, write.value);
      queueMicrotask(() => this.oncomplete?.());
    }
  }
  let latest: Transaction | undefined;
  const db = { close: vi.fn(), onversionchange: undefined,
    transaction: vi.fn(() => { latest = new Transaction(); return latest; }) };
  const request = { result: db, onsuccess: undefined as (() => void) | undefined, onblocked: undefined as (() => void) | undefined };
  const factory = { open: vi.fn(() => { queueMicrotask(() => request.onsuccess?.()); return request; }) };
  vi.stubGlobal('indexedDB', factory);
  return { db, request, records, get tx() { return latest!; }, active: () => (records.meta.get('active') as { sceneId: string }).sceneId };
}
const manifest: BuildingChunkManifest = { format: 'urban-building-chunks-1', sceneId: 'new', sourceFingerprint: '1'.repeat(64), schema_version: '1',
  generator_version: 'native-metadata-test', totalRequests: 0, buildings: 0, refusals: 0, openSpaces: 0,
  chunks: [{ index: 0, sha256: '2'.repeat(64), bytes: 1, progress: { start: 0, completed: 0, total: 0 }, buildings: 0, refusals: 0, openSpaces: 0 }], fingerprint: '3'.repeat(64) };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('rejects a pre-aborted commit before opening a transaction or installing a listener', async () => {
  const db = database(), backend = await createIndexedDbBuildingChunkBackend(), signal = new AbortController();
  const add = vi.spyOn(signal.signal, 'addEventListener'), remove = vi.spyOn(signal.signal, 'removeEventListener');
  const reason = new DOMException('Superseded', 'AbortError'); signal.abort(reason);
  await expect(backend.commit(manifest, 'old', { signal: signal.signal })).rejects.toBe(reason);
  expect(db.db.transaction).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  expect(db.active()).toBe('old'); backend.close();
});

it('aborts active atomic writes, keeps the old pointer and removes the signal listener on abort', async () => {
  const db = database(), backend = await createIndexedDbBuildingChunkBackend(), signal = new AbortController();
  const add = vi.spyOn(signal.signal, 'addEventListener'), remove = vi.spyOn(signal.signal, 'removeEventListener');
  const committing = backend.commit(manifest, 'old', { signal: signal.signal });
  const rejected = expect(committing).rejects.toMatchObject({ name: 'AbortError' }); await db.tx.ready.promise;
  expect(db.active()).toBe('old'); expect(db.tx.writes).toHaveLength(2); signal.abort(new DOMException('Cancelled', 'AbortError')); await rejected;
  expect(db.tx.aborts).toBe(1); expect(db.tx.writes).toEqual([]); expect(db.active()).toBe('old');
  expect(db.records.scenes.get('new')).toMatchObject({ state: 'staging' }); expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]); backend.close();
});

it('removes the listener on completion and does not pretend a later abort rolls back durable data', async () => {
  const db = database(), backend = await createIndexedDbBuildingChunkBackend(), signal = new AbortController();
  const remove = vi.spyOn(signal.signal, 'removeEventListener');
  const committing = backend.commit(manifest, 'old', { signal: signal.signal }); await db.tx.ready.promise; db.tx.finish(); await committing;
  expect(db.active()).toBe('new'); expect(remove).toHaveBeenCalledTimes(1); signal.abort();
  expect(db.tx.aborts).toBe(0); expect(db.active()).toBe('new'); backend.close();
});

it('allows oncomplete to settle truthfully if abort arrives after the transaction has finished', async () => {
  const db = database(), backend = await createIndexedDbBuildingChunkBackend(), signal = new AbortController();
  const remove = vi.spyOn(signal.signal, 'removeEventListener');
  const committing = backend.commit(manifest, 'old', { signal: signal.signal }); await db.tx.ready.promise;
  db.tx.finish(); signal.abort(); await committing;
  expect(db.active()).toBe('new'); expect(db.tx.aborts).toBe(0); expect(remove).toHaveBeenCalledTimes(1); backend.close();
});

it('cleans listeners when compare-and-swap rejects without writing the new active generation', async () => {
  const db = database(), backend = await createIndexedDbBuildingChunkBackend(), signal = new AbortController();
  const remove = vi.spyOn(signal.signal, 'removeEventListener');
  await expect(backend.commit(manifest, 'wrong', { signal: signal.signal })).rejects.toThrow('generation changed');
  expect(db.active()).toBe('old'); expect(db.tx.aborts).toBe(1); expect(remove).toHaveBeenCalledTimes(1); backend.close();
});

it('closes a late successful open after onblocked has already rejected the opening promise', async () => {
  const db = database(), opening = createIndexedDbBuildingChunkBackend(); db.request.onblocked?.();
  await expect(opening).rejects.toThrow('blocked'); await Promise.resolve(); expect(db.db.close).toHaveBeenCalledTimes(1);
});

const derivedManifest: DerivedManifest = { version: 'urban-derived-visual-2', sceneId: 'new', cacheId: 'cache-new', parentFingerprint: manifest.fingerprint,
  sourceFingerprint: manifest.sourceFingerprint, totalRequests: 0, buildings: 0, refusals: 0, openSpaces: 0, origins: 'unknown', fingerprint: '4'.repeat(64),
  chunks: [{ index: 0, nativeSha256: manifest.chunks[0].sha256, progress: manifest.chunks[0].progress, sha256: '5'.repeat(64), bytes: 1 }] };

it('atomically requires the committed native parent and matching cache generation before publishing a derivative', async () => {
  for (const mode of ['staging-parent', 'stale-cache', 'valid']) {
    const db = database(), backend = await createIndexedDbBuildingChunkBackend();
    if (mode !== 'staging-parent') db.records.scenes.set('new', { sceneId: 'new', state: 'committed', chunks: 1, manifest });
    const candidate = mode === 'stale-cache' ? { ...derivedManifest, cacheId: 'abandoned' } : derivedManifest;
    const work = backend.derived!.commit(candidate);
    if (mode === 'valid') { await db.tx.ready.promise; db.tx.finish(); await work; expect(db.records.derivedScenes.get('new')).toMatchObject({ state: 'committed', manifest: candidate }); }
    else { await expect(work).rejects.toThrow('matching committed parent/generation'); expect(db.tx.writes).toEqual([]); }
    expect(db.active()).toBe('old'); backend.close();
  }
});

it('aborts only the derivative transaction on cancellation after the native parent is already durable', async () => {
  const db = database(), backend = await createIndexedDbBuildingChunkBackend(), signal = new AbortController();
  db.records.scenes.set('new', { sceneId: 'new', state: 'committed', chunks: 1, manifest });
  const work = backend.derived!.commit(derivedManifest, { signal: signal.signal }); const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await db.tx.ready.promise; signal.abort(); await rejected;
  expect(db.records.scenes.get('new')).toMatchObject({ state: 'committed', manifest });
  expect(db.records.derivedScenes.get('new')).toMatchObject({ state: 'staging' }); expect(db.active()).toBe('old'); backend.close();
});

it('upgrades v1 by adding derivative/overview stores without changing native stores and closes on versionchange', async () => {
  const names = new Set(['scenes', 'meta', 'chunks', 'buildings']), added: string[] = [];
  const db = { objectStoreNames: { contains: (name: string) => names.has(name) }, close: vi.fn(), onversionchange: undefined as (() => void) | undefined,
    createObjectStore: vi.fn((name: string) => { added.push(name); names.add(name); return { createIndex: vi.fn() }; }) };
  const request = { result: db, onupgradeneeded: undefined as (() => void) | undefined, onsuccess: undefined as (() => void) | undefined };
  const open = vi.fn(() => { queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; });
  vi.stubGlobal('indexedDB', { open }); const backend = await createIndexedDbBuildingChunkBackend('old-native-store');
  expect(open).toHaveBeenCalledWith('old-native-store', 4); expect(added).toEqual(['derivedScenes', 'derivedChunks', 'derivedOrigins', 'parentVisualChunks', 'parentScenes', 'parentChunks', 'parentIndex', 'memberIndex', 'coldOverviews']);
  expect([...names]).toEqual(['scenes', 'meta', 'chunks', 'buildings', ...added]); db.onversionchange?.(); expect(db.close).toHaveBeenCalledTimes(1); backend.close();
});

const overviewValue: StoredColdOverview = { version: 'native-contour-overview-1', sceneId: 'new', key: 'test-overview', parentFingerprint: manifest.fingerprint,
  derivedFingerprint: derivedManifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint, buildings: 0, resolution: 1, bounds: [0, 0, 0, 0],
  countsLE: new Uint8Array(4), fingerprint: '6'.repeat(64) };
it('publishes overview atomically only for BOTH committed current parent fingerprints', async () => {
  for (const mode of ['native-staging', 'derived-stale', 'valid']) {
    const db = database(), backend = await createIndexedDbBuildingChunkBackend();
    if (mode !== 'native-staging') db.records.scenes.set('new', { sceneId: 'new', state: 'committed', chunks: 1, manifest });
    db.records.derivedScenes.set('new', { sceneId: 'new', state: 'committed', chunks: 1, manifest: mode === 'derived-stale' ? { ...derivedManifest, fingerprint: 'f'.repeat(64) } : derivedManifest });
    const work = backend.overview!.commit(overviewValue);
    if (mode === 'valid') {
      await db.tx.ready.promise; expect(db.records.coldOverviews.size).toBe(0); db.tx.finish(); await work;
      expect(db.records.coldOverviews.get(JSON.stringify(['new', 'test-overview']))).toEqual(overviewValue);
    } else { await expect(work).rejects.toThrow('parent changed'); expect(db.tx.writes).toEqual([]); expect(db.records.coldOverviews.size).toBe(0); }
    expect(db.active()).toBe('old'); backend.close();
  }
});
it('aborts overview publication without changing native/derived parents or exposing partial pixels', async () => {
  const db = database(), backend = await createIndexedDbBuildingChunkBackend(), signal = new AbortController();
  db.records.scenes.set('new', { sceneId: 'new', state: 'committed', chunks: 1, manifest });
  db.records.derivedScenes.set('new', { sceneId: 'new', state: 'committed', chunks: 1, manifest: derivedManifest });
  const work = backend.overview!.commit(overviewValue, { signal: signal.signal }), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await db.tx.ready.promise; signal.abort(); await rejected;
  expect(db.records.coldOverviews.size).toBe(0); expect(db.records.scenes.get('new')).toMatchObject({ manifest });
  expect(db.records.derivedScenes.get('new')).toMatchObject({ manifest: derivedManifest }); backend.close();
});
it('upgrades v2 additively with overview and parent stores; existing native and A2 stores remain readable', async () => {
  const names = new Set(['scenes', 'meta', 'chunks', 'buildings', 'derivedScenes', 'derivedChunks', 'derivedOrigins']);
  const create = vi.fn((name: string) => { names.add(name); return { createIndex: vi.fn() }; });
  const db = { objectStoreNames: { contains: (name: string) => names.has(name) }, createObjectStore: create, close: vi.fn(), onversionchange: undefined };
  const request = { result: db, onupgradeneeded: undefined as (() => void) | undefined, onsuccess: undefined as (() => void) | undefined };
  vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } });
  const backend = await createIndexedDbBuildingChunkBackend(); expect(create).toHaveBeenCalledTimes(6);
  expect(create).toHaveBeenCalledWith('coldOverviews', { keyPath: ['sceneId', 'key'] }); expect(names.size).toBe(13); backend.close();
});
