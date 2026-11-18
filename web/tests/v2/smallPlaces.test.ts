import { describe, expect, it } from 'vitest';
import type { Settlement, World } from '../../src/gen/types';
import { SmallPlaceQueue, boundedSmallPlaceRun, nextSmallPlace, type SmallPlaceBase } from '../../src/v2/smallPlaces';
import type { V2Settings } from '../../src/v2/contracts';

const place = (key: string, x: number, population: number, detail: Settlement['detail'] = 'lazy'): Settlement =>
  ({ key, index: 0, main: detail === 'main', cls: 'village', population, culture: 'european-organic', center: { x, y: 0 }, radius: 50, archetype: 'plain', extent: [], region: [], detail }) as unknown as Settlement;
const region = (): World =>
  ({ seed: 's', mapSize: 6000, stats: {}, urban: {} as World['urban'], settlements: [place('main', 0, 2500, 'main'), place('far', 3000, 200), place('near', 500, 150), place('big', 300, 1200), place('farm', 900, 6, 'farmstead'), place('mid', 1500, 450)] }) as unknown as World;

/** Stubbed urban build: builds the place on a copy of the world, resolved when the test releases it. */
function harness(limit = 500, batchSize = 1) {
  let world = region();
  const built: string[] = [],
    waiting: { key: string; keys: readonly string[]; release: () => void }[] = [];
  let allowed = true;
  const queue = new SmallPlaceQueue({
    batchSize,
    base: (): SmallPlaceBase | undefined => (allowed ? { world, limit, backend: 'native', recipe: 'r' } : undefined),
    focus: () => undefined,
    build: (from, keys) =>
      new Promise<World>(resolve =>
        waiting.push({
          key: keys[0],
          keys,
          release: () => {
            resolve({ ...from, settlements: from.settlements!.map(p => (keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'], detail: 'eager' } : p)) });
          },
        }),
      ),
    apply: result => {
      world = result;
      built.push(...result.settlements!.filter(p => p.urban && !built.includes(p.key)).map(p => p.key));
    },
    idle: () => Promise.resolve(),
  });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  return {
    queue,
    built,
    waiting,
    tick,
    setWorld: (next: World) => {
      world = next;
    },
    getWorld: () => world,
    block: (value: boolean) => {
      allowed = !value;
    },
  };
}

describe('background build of small places', () => {
  it('defers a farm beside an unbuilt city and still builds independent villages within the budget', async () => {
    const settings = { local: {}, options: { sprawl: 1 }, urban: { backend: 'native' } } as unknown as V2Settings;
    let world: World = { ...region(), settlements: [place('main', 0, 2500, 'main'), { ...place('large-city', 2000, 25000), radius: 2000 }, place('farm', 2200, 8, 'farmstead'), place('village-a', 14000, 500), place('village-b', 26000, 200)] };
    const requests: string[][] = [];
    const queue = new SmallPlaceQueue({
      canonicalOrder: true,
      base: () => ({ world, limit: 500, backend: 'native', recipe: 'r' }),
      focus: () => undefined,
      idle: () => Promise.resolve(),
      canBuild: (from, keys) => boundedSmallPlaceRun(from, settings, keys, 500),
      build: async (from, keys) => {
        requests.push([...keys]);
        return { ...from, settlements: from.settlements!.map(p => (keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'] } : p)) };
      },
      apply: result => {
        world = result;
      },
    });
    expect(boundedSmallPlaceRun(world, settings, ['farm'], 500)).toBe(false);
    queue.start();
    await queue.settled();
    expect(requests).toEqual([['village-a', 'village-b']]);
    expect(world.settlements!.find(p => p.key === 'large-city')!.urban).toBeUndefined();
    expect(world.settlements!.find(p => p.key === 'farm')!.urban).toBeUndefined();
  });
  it('retries a deferred farm after its eligible larger neighbour is built', async () => {
    const settings = { local: {}, options: { sprawl: 1 }, urban: { backend: 'native' } } as unknown as V2Settings;
    let world: World = { ...region(), settlements: [place('main', 10000, 2500, 'main'), place('village', 1000, 300), place('farm', 1100, 8, 'farmstead')] };
    const requests: string[][] = [];
    const queue = new SmallPlaceQueue({
      base: () => ({ world, limit: 500, backend: 'native', recipe: 'r' }),
      focus: () => ({ x: 1100, y: 0 }),
      idle: () => Promise.resolve(),
      canBuild: (from, keys) => boundedSmallPlaceRun(from, settings, keys, 500),
      build: async (from, keys) => {
        requests.push([...keys]);
        return { ...from, settlements: from.settlements!.map(p => (keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'] } : p)) };
      },
      apply: result => {
        world = result;
      },
    });
    queue.start();
    await queue.settled();
    expect(requests).toEqual([['village'], ['farm']]);
  });
  it('rechecks a blocked-only pass after a manual dependency build with the same recipe', async () => {
    const settings = { local: {}, options: { sprawl: 1 }, urban: { backend: 'native' } } as unknown as V2Settings;
    let world: World = { ...region(), settlements: [place('main', 10000, 2500, 'main'), { ...place('large-city', 1000, 25000), radius: 2000 }, place('farm', 1100, 8, 'farmstead')] };
    const requests: string[][] = [];
    const queue = new SmallPlaceQueue({
      base: () => ({ world, limit: 500, backend: 'native', recipe: 'unchanged' }),
      focus: () => undefined,
      idle: () => Promise.resolve(),
      canBuild: (from, keys) => boundedSmallPlaceRun(from, settings, keys, 500),
      build: async (from, keys) => {
        requests.push([...keys]);
        return { ...from, settlements: from.settlements!.map(p => (keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'] } : p)) };
      },
      apply: result => {
        world = result;
      },
    });
    queue.start();
    await queue.settled();
    expect(requests).toEqual([]);
    world = { ...world, settlements: world.settlements!.map(p => (p.key === 'large-city' ? { ...p, urban: {} as Settlement['urban'] } : p)) };
    queue.start();
    await queue.settled();
    expect(requests).toEqual([['farm']]);
  });
  it('preflights the full requested run against both count and population limits', () => {
    const settings = { local: {}, options: { sprawl: 1 }, urban: { backend: 'native' } } as unknown as V2Settings;
    const world: World = { ...region(), settlements: Array.from({ length: 33 }, (_, i) => place(`village-${i}`, i * 10000, 500)) };
    const keys = world.settlements!.map(p => p.key);
    expect(boundedSmallPlaceRun(world, settings, keys.slice(0, 16), 500)).toBe(true);
    expect(boundedSmallPlaceRun(world, settings, keys.slice(0, 17), 500)).toBe(false);
    expect(boundedSmallPlaceRun(world, settings, keys, 500)).toBe(false);
  });
  it('amortizes 64 tiny farms in two bounded batches and releases sessions only after the pass', async () => {
    let world: World = { ...region(), settlements: [place('main', 0, 2500, 'main'), ...Array.from({ length: 64 }, (_, i) => place(`farm-${i}`, i * 10, 8, 'farmstead'))] };
    const batches: string[][] = [],
      events: string[] = [];
    const queue = new SmallPlaceQueue({
      base: () => ({ world, limit: 500, backend: 'native', recipe: 'farms' }),
      focus: () => undefined,
      idle: () => Promise.resolve(),
      build: async (from, keys) => {
        events.push('build');
        batches.push([...keys]);
        return { ...from, settlements: from.settlements!.map(p => (keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'] } : p)) };
      },
      apply: result => {
        world = result;
      },
      release: () => {
        events.push('release');
      },
    });
    queue.start();
    await queue.settled();
    expect(batches.map(b => b.length)).toEqual([32, 32]);
    expect(events).toEqual(['build', 'build', 'release']);
    expect(world.settlements!.filter(p => p.urban)).toHaveLength(64);
  });
  it('bounds villages by total population as well as place count', async () => {
    let world: World = { ...region(), settlements: [place('main', 0, 2500, 'main'), ...Array.from({ length: 20 }, (_, i) => place(`village-${i}`, i * 10, 500))] };
    const batches: number[] = [];
    const queue = new SmallPlaceQueue({
      base: () => ({ world, limit: 500, backend: 'native', recipe: 'villages' }),
      focus: () => undefined,
      idle: () => Promise.resolve(),
      build: async (from, keys) => {
        batches.push(keys.length);
        return { ...from, settlements: from.settlements!.map(p => (keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'] } : p)) };
      },
      apply: result => {
        world = result;
      },
    });
    queue.start();
    await queue.settled();
    expect(batches).toEqual([16, 4]);
  });
  it('waits for an in-flight native job before releasing its sessions on cancellation', async () => {
    let finish!: () => void,
      releases = 0,
      applied = 0;
    const world = region(),
      queue = new SmallPlaceQueue({
        base: () => ({ world, limit: 500, backend: 'native', recipe: 'r' }),
        focus: () => undefined,
        idle: () => Promise.resolve(),
        build: () =>
          new Promise(resolve => {
            finish = () => resolve(world);
          }),
        apply: () => {
          applied++;
        },
        release: () => {
          releases++;
        },
      });
    queue.start();
    await new Promise(resolve => setTimeout(resolve, 0));
    const stop = queue.stop();
    expect(releases).toBe(0);
    finish();
    await stop;
    await queue.settled();
    expect(releases).toBe(1);
    expect(applied).toBe(0);
  });
  it('isolates a failed batch so one invalid place does not discard its neighbours', async () => {
    let world = region();
    const requests: string[][] = [];
    const queue = new SmallPlaceQueue({
      base: () => ({ world, limit: 500, backend: 'native', recipe: 'r' }),
      focus: () => undefined,
      idle: () => Promise.resolve(),
      build: async (from, keys) => {
        requests.push([...keys]);
        if (keys.includes('farm')) throw new Error('invalid farm');
        return { ...from, settlements: from.settlements!.map(p => (keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'] } : p)) };
      },
      apply: result => {
        world = result;
      },
    });
    queue.start();
    await queue.settled();
    expect(requests).toEqual([['near', 'farm', 'mid', 'far'], ['near'], ['farm'], ['mid'], ['far']]);
    expect(
      world
        .settlements!.filter(p => p.urban)
        .map(p => p.key)
        .sort(),
    ).toEqual(['far', 'mid', 'near']);
  });
  it('builds a bounded group through one request and applies the world once', async () => {
    const h = harness(500, 8);
    h.queue.start();
    await h.tick();
    expect(h.waiting).toHaveLength(1);
    expect(h.waiting[0].keys).toEqual(['near', 'farm', 'mid', 'far']);
    h.waiting.shift()!.release();
    await h.queue.settled();
    expect(h.built.sort()).toEqual(['far', 'farm', 'mid', 'near']);
  });

  it('drops the whole batch when cancelled, then retries it on the current map', async () => {
    const h = harness(500, 8);
    h.queue.start();
    await h.tick();
    const stop = h.queue.stop();
    h.setWorld(region());
    h.waiting.shift()!.release();
    await stop;
    await h.queue.settled();
    expect(h.built).toEqual([]);
    h.queue.start();
    await h.tick();
    expect(h.waiting[0].keys).toEqual(['near', 'farm', 'mid', 'far']);
    h.waiting.shift()!.release();
    await h.queue.settled();
  });
  it('orders by distance to the main town and keeps the population limit', () => {
    const world = region();
    const order: string[] = [];
    const skip = new Set<string>();
    for (let key = nextSmallPlace(world, 500, 'native', undefined, skip); key; key = nextSmallPlace(world, 500, 'native', undefined, skip)) {
      order.push(key);
      skip.add(key);
    }
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
    await h.tick();
    await h.tick();
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
