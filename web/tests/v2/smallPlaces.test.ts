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
function harness(limit = 500, batchSize = 1) {
  let world = region();
  const built: string[] = [], waiting: { key: string; keys: readonly string[]; release: () => void }[] = [];
  let allowed = true;
  const queue = new SmallPlaceQueue({
    batchSize,
    base: (): SmallPlaceBase | undefined => allowed ? { world, limit, backend: 'native', recipe: 'r' } : undefined,
    focus: () => undefined,
    build: (from, keys) => new Promise<World>(resolve => waiting.push({ key: keys[0], keys, release: () => {
      resolve({ ...from, settlements: from.settlements!.map(p => keys.includes(p.key) ? { ...p, urban: {} as Settlement['urban'], detail: 'eager' } : p) });
    } })),
    apply: result => { world = result; built.push(...result.settlements!.filter(p => p.urban && !built.includes(p.key)).map(p => p.key)); },
    idle: () => Promise.resolve(),
  });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  return { queue, built, waiting, tick, setWorld: (next: World) => { world = next; }, getWorld: () => world, block: (value: boolean) => { allowed = !value; } };
}

describe('background build of small places', () => {
  it('isolates a failed batch so one invalid place does not discard its neighbours', async () => {
    let world=region();const requests:string[][]=[];
    const queue=new SmallPlaceQueue({
      base:()=>({world,limit:500,backend:'native',recipe:'r'}),focus:()=>undefined,idle:()=>Promise.resolve(),
      build:async(from,keys)=>{
        requests.push([...keys]);
        if(keys.includes('farm')) throw new Error('invalid farm');
        return {...from,settlements:from.settlements!.map(p=>keys.includes(p.key)?{...p,urban:{} as Settlement['urban']}:p)};
      },
      apply:result=>{world=result;},
    });
    queue.start();await queue.settled();
    expect(requests).toEqual([['near','farm','mid','far'],['near'],['farm'],['mid'],['far']]);
    expect(world.settlements!.filter(p=>p.urban).map(p=>p.key).sort()).toEqual(['far','mid','near']);
  });
  it('builds a bounded group through one request and applies the world once', async () => {
    const h = harness(500, 8);
    h.queue.start(); await h.tick();
    expect(h.waiting).toHaveLength(1);
    expect(h.waiting[0].keys).toEqual(['near', 'farm', 'mid', 'far']);
    h.waiting.shift()!.release(); await h.queue.settled();
    expect(h.built.sort()).toEqual(['far', 'farm', 'mid', 'near']);
  });

  it('drops the whole batch when cancelled, then retries it on the current map', async () => {
    const h = harness(500, 8);
    h.queue.start(); await h.tick();
    const stop = h.queue.stop(); h.setWorld(region());
    h.waiting.shift()!.release(); await stop; await h.queue.settled();
    expect(h.built).toEqual([]);
    h.queue.start(); await h.tick();
    expect(h.waiting[0].keys).toEqual(['near', 'farm', 'mid', 'far']);
    h.waiting.shift()!.release(); await h.queue.settled();
  });
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
