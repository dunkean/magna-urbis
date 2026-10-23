import { afterEach, expect, it, vi } from 'vitest';
import { createIndexedDbBuildingChunkBackend } from '../src/ui/urbanBuildingChunkIndexedDb';
import type { BuildingChunkManifest } from '../src/ui/urbanBuildingChunkStore';
import { deferred } from './helpers/urbanBuildingColdTestBackend';

/** Transaction double exercises the actual adapter and AbortSignal listener
 * lifetime, not browser IndexedDB scheduling/durability/quota. */
function database() {
  const records = { scenes: new Map<string, unknown>([['new', { sceneId: 'new', state: 'staging', chunks: 1 }]]),
    meta: new Map<string, unknown>([['active', { key: 'active', sceneId: 'old' }]]) };
  class Transaction {
    oncomplete?: () => void; onabort?: () => void; onerror?: () => void;
    error: DOMException | null = null; aborted = false; finished = false; aborts = 0;
    writes: { store: 'scenes' | 'meta'; key: string; value: unknown }[] = [];
    ready = deferred();
    objectStore(store: 'scenes' | 'meta') {
      return {
        get: (key: string) => {
          const request = { result: structuredClone(records[store].get(key)), onsuccess: undefined as (() => void) | undefined };
          queueMicrotask(() => { if (!this.aborted) request.onsuccess?.(); }); return request;
        },
        put: (value: { sceneId?: string; key?: string }) => {
          if (this.aborted || this.finished) throw new Error('Inactive transaction');
          this.writes.push({ store, key: store === 'scenes' ? value.sceneId! : value.key!, value: structuredClone(value) });
          if (store === 'meta') this.ready.resolve();
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
