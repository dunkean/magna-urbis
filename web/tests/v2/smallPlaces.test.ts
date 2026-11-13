import { describe, expect, it } from 'vitest';
import type { Settlement, World } from '../../src/gen/types';
import { SmallPlaceQueue, nextSmallPlace, type SmallPlaceBase } from '../../src/v2/smallPlaces';

const place = (key: string, x: number, population: number, detail: Settlement['detail'] = 'lazy'): Settlement =>
  ({ key, index: 0, main: detail === 'main', cls: 'village', population, culture: 'european-organic', center: { x, y: 0 }, radius: 50,
    archetype: 'plain', extent: [], region: [], detail } as unknown as Settlement);
const region = (): World => ({ seed: 's', mapSize: 6000, stats: {}, urban: {} as World['urban'], settlements: [
  place('main', 0, 2500, 'main'), place('far', 3000, 200), place('near', 500, 150), place('big', 300, 1200),
  place('farm', 900, 6, 'farmstead'), place('mid', 1500, 450),
] } as unknown as World);

/** Stubbed urban build: builds the place on a copy of the world, resolved when the test releases it. */
function harness(limit = 500) {
  let world = region();
  const built: string[] = [], waiting: { key: string; release: () => void }[] = [];
  let allowed = true;
  const queue = new SmallPlaceQueue({
    base: (): SmallPlaceBase | undefined => allowed ? { world, limit, backend: 'native', recipe: 'r' } : undefined,
    focus: () => undefined,
    build: (from, key) => new Promise<World>(resolve => waiting.push({ key, release: () => {
      resolve({ ...from, settlements: from.settlements!.map(p => p.key === key ? { ...p, urban: {} as Settlement['urban'], detail: 'eager' } : p) });
    } })),
    apply: result => { world = result; built.push(...result.settlements!.filter(p => p.urban && !built.includes(p.key)).map(p => p.key)); },
    idle: () => Promise.resolve(),
  });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  return { queue, built, waiting, tick, setWorld: (next: World) => { world = next; }, getWorld: () => world, block: (value: boolean) => { allowed = !value; } };
}

describe('background build of small places', () => {
  it('orders by distance to the main town and keeps the population limit', () => {
    const world = region();
    const order: string[] = [];
    const skip = new Set<string>();
    for (let key = nextSmallPlace(world, 500, 'native', undefined, skip); key; key = nextSmallPlace(world, 500, 'native', undefined, skip)) { order.push(key); skip.add(key); }
    expect(order).toEqual(['near', 'farm', 'mid', 'far']);
    expect(nextSmallPlace(world, 0, 'native', undefined)).toBeUndefined();
    // The classic TypeScript backend never builds farmsteads.
    expect(nextSmallPlace(world, 500, 'typescript', { x: 900, y: 0 })).toBe('near');
  });

  it('builds one place at a time, then stops when nothing is left', async () => {
    const h = harness();
    h.queue.start();
    for (const expected of ['near', 'farm', 'mid', 'far']) {
      await h.tick();
      expect(h.waiting.map(w => w.key)).toEqual([expected]);
      h.waiting.shift()!.release();
      await h.tick();
    }
    await h.queue.settled();
    expect(h.built).toEqual(['near', 'farm', 'mid', 'far']);
    expect(h.getWorld().settlements!.find(p => p.key === 'big')!.urban).toBeUndefined();
  });

  it('a targeted place jumps the queue', async () => {
    const h = harness();
    h.queue.start();
    await h.tick();
    h.queue.prioritize('far');
    h.waiting.shift()!.release(); // near, already in flight
    await h.tick(); await h.tick();
    expect(h.waiting.map(w => w.key)).toEqual(['far']);
  });

  it('a new run cancels the pass and drops the late result', async () => {
    const h = harness();
    h.queue.start();
    await h.tick();
    const fresh = region();
    const stopped = h.queue.stop();
    h.setWorld(fresh); // the user's run replaced the map
    h.waiting.shift()!.release();
    await stopped;
    await h.tick();
    expect(h.built).toEqual([]);
    expect(h.waiting).toEqual([]);
    expect(h.getWorld()).toBe(fresh);
    // Started again on the new map, it resumes from the nearest place.
    h.queue.start();
    await h.tick();
    expect(h.waiting.map(w => w.key)).toEqual(['near']);
  });

  it('does not run while the host refuses (stale recipe, preview, busy)', async () => {
    const h = harness();
    h.block(true);
    h.queue.start();
    await h.tick();
    expect(h.waiting).toEqual([]);
    await h.queue.settled();
  });
});
