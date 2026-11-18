import { describe, expect, it } from 'vitest';
import { createRegionCache } from '../src/render/live/regionCache';

interface Entry {
  id: string;
  bytes: number;
}
const make = (budget: number, count: number) => {
  const released: string[] = [];
  const cache = createRegionCache<Entry>(
    budget,
    count,
    e => e.bytes,
    e => released.push(e.id),
  );
  return { cache, released };
};

describe('live region cache', () => {
  it('evicts the least recently used beyond the byte budget and the count', () => {
    const { cache, released } = make(100, 3);
    cache.put({ id: 'a', bytes: 40 });
    cache.put({ id: 'b', bytes: 40 });
    cache.put({ id: 'c', bytes: 40 });
    expect(released).toEqual(['a']);
    expect(cache.bytes).toBe(80);
    cache.put({ id: 'd', bytes: 1 });
    cache.put({ id: 'e', bytes: 1 });
    expect(released).toEqual(['a', 'b']);
    expect(cache.size).toBe(3);
  });

  it('takes the most recently used entry that fits, without releasing it', () => {
    const { cache, released } = make(1000, 8);
    cache.put({ id: 'x1', bytes: 10 });
    cache.put({ id: 'y', bytes: 10 });
    cache.put({ id: 'x2', bytes: 10 });
    expect(cache.take(e => e.id.startsWith('x'))?.id).toBe('x2');
    expect(cache.take(e => e.id === 'z')).toBeUndefined();
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(20);
    expect(released).toEqual([]);
  });

  it('drops and clears, releasing only when asked', () => {
    const { cache, released } = make(1000, 8);
    for (const id of ['a', 'b', 'c']) cache.put({ id, bytes: 5 });
    cache.drop(e => e.id === 'b');
    expect(released).toEqual(['b']);
    cache.clear(false);
    expect(released).toEqual(['b']);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
