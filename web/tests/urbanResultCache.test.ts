import { describe, expect, it, vi } from 'vitest';
import { planEviction, readUrbanCache, urbanCacheKey, URBAN_CACHE_MAX_BYTES, writeUrbanCache } from '../../rust/bridge/urbanResultCache';

describe('urban result cache', () => {
  const ctx = { engine: '1', terrain: 'abc' };
  it('keys ignore id/runtime and track content, typed arrays and engine', async () => {
    const a = await urbanCacheKey({ id: 1, seed: 's', kind: 'quarters', runtime: { profile: 'x' }, raster: { water: new Float32Array([1, 2]) } }, ctx);
    const b = await urbanCacheKey({ id: 9, seed: 's', kind: 'quarters', raster: { water: new Float32Array([1, 2]) } }, ctx);
    expect(a).toBe(b);
    expect(await urbanCacheKey({ id: 1, seed: 's', kind: 'quarters', raster: { water: new Float32Array([1, 3]) } }, ctx)).not.toBe(a);
    expect(await urbanCacheKey({ id: 1, seed: 't', kind: 'quarters', raster: { water: new Float32Array([1, 2]) } }, ctx)).not.toBe(a);
    expect(await urbanCacheKey({ id: 1, seed: 's', kind: 'quarters', raster: { water: new Float32Array([1, 2]) } }, { ...ctx, engine: '2' })).not.toBe(a);
  });
  it('evicts least recently used entries until the budget fits', () => {
    const entries = [
      { key: 'a', bytes: 40, time: 3 },
      { key: 'b', bytes: 40, time: 1 },
      { key: 'c', bytes: 40, time: 2 },
    ];
    expect(planEviction(entries, 10, 100)).toEqual(['b']);
    expect(planEviction(entries, 10, 200)).toEqual([]);
    expect(planEviction(entries, 50, 100)).toEqual(['b', 'c']);
  });
  it('scans and touches only metadata and evicts from both stores', async () => {
    type Row = { key: string; bytes: number; value?: unknown; time?: number };
    const stores = new Map<string, Map<string, Row>>([['results', new Map([['old', { key: 'old', bytes: 1, time: 0, value: 'old layout' }]])]]);
    const getAll = vi.fn((name: string) => [...stores.get(name)!.values()]);
    const put = vi.fn((name: string, row: Row) => stores.get(name)!.set(row.key, row));
    const transaction = vi.fn((scope: string[]) => {
      const tx = {
        oncomplete: undefined as (() => void) | undefined,
        objectStore(name: string) {
          if (!scope.includes(name)) throw new Error(`Store outside transaction: ${name}`);
          return { get: (key: string) => request(stores.get(name)!.get(key)), getAll: () => request(getAll(name)), put: (row: Row) => put(name, row), delete: (key: string) => stores.get(name)!.delete(key) };
        },
      };
      function request<T>(result: T) {
        const req = { result, onsuccess: undefined as (() => void) | undefined };
        queueMicrotask(() => {
          req.onsuccess?.();
          tx.oncomplete?.();
        });
        return req;
      }
      return tx;
    });
    const db = { objectStoreNames: { contains: (name: string) => stores.has(name) }, deleteObjectStore: (name: string) => stores.delete(name), createObjectStore: (name: string) => stores.set(name, new Map()), transaction };
    const open = vi.fn(() => {
      const req = { result: db, onupgradeneeded: undefined as (() => void) | undefined, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    });
    vi.stubGlobal('indexedDB', { open });
    const clock = vi.spyOn(Date, 'now');
    const bytes = URBAN_CACHE_MAX_BYTES / 2;
    try {
      clock.mockReturnValue(1);
      await writeUrbanCache('a', 'layout a', bytes);
      expect(open).toHaveBeenCalledWith('magna-urbis-urban-cache', 2);
      expect(stores.get('results')!.has('old')).toBe(false);

      clock.mockReturnValue(2);
      await writeUrbanCache('b', 'layout b', bytes);
      expect(put).toHaveBeenLastCalledWith('metadata', { key: 'b', bytes, time: 2 });

      put.mockClear();
      clock.mockReturnValue(3);
      expect(await readUrbanCache('a')).toBe('layout a');
      expect(put.mock.calls).toEqual([['metadata', { key: 'a', bytes, time: 3 }]]);

      clock.mockReturnValue(4);
      await writeUrbanCache('c', 'layout c', bytes);
      expect(getAll.mock.calls).toEqual([['metadata'], ['metadata'], ['metadata']]);
      expect([...stores.get('results')!.keys()]).toEqual(['a', 'c']);
      expect([...stores.get('metadata')!.keys()]).toEqual(['a', 'c']);
      expect(transaction.mock.calls).toEqual(Array.from({ length: 4 }, () => [['results', 'metadata'], 'readwrite']));
    } finally {
      clock.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
