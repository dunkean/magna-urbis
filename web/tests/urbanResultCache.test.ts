import { describe, expect, it } from 'vitest';
import { planEviction, urbanCacheKey } from '../../rust/bridge/urbanResultCache';

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
    const entries = [{ key: 'a', bytes: 40, time: 3 }, { key: 'b', bytes: 40, time: 1 }, { key: 'c', bytes: 40, time: 2 }];
    expect(planEviction(entries, 10, 100)).toEqual(['b']);
    expect(planEviction(entries, 10, 200)).toEqual([]);
    expect(planEviction(entries, 50, 100)).toEqual(['b', 'c']);
  });
});
