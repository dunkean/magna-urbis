import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeOptions } from '../src/gen/options';
import { generateRustTown, releaseUrbanLanes, townCompositionFingerprint } from '../src/v2/rustUrban';
import type { World } from '../src/gen/types';
import type { V2Settings } from '../src/v2/contracts';

const native = vi.hoisted(() => ({ create: vi.fn(), run: vi.fn(), release: vi.fn() }));
vi.mock('../../rust/bridge/urban', () => ({
  createUrbanEngine: async () => {
    native.create();
    return { run: native.run, release: native.release };
  },
}));
vi.mock('../src/ui/urbanLanduseData', () => ({ prewarmUrbanLanduse: () => undefined }));
afterEach(async () => {
  await releaseUrbanLanes();
  vi.clearAllMocks();
});

describe('bounded native urban sessions across background batches', () => {
  it('serializes the shared road network once without changing any composition key bytes', () => {
    let reads = 0;
    const roads = [
      {
        get path() {
          reads++;
          return [
            { x: 12, y: 4 },
            { x: 15, y: 7 },
          ];
        },
        widths: [4, 4],
        rank: 2,
        role: 'regional',
      },
    ];
    const before = [undefined, 'terrain', 'town', { b: 2, a: 1 }],
      after = ['neighbour-claim'];
    const expected = JSON.stringify([...before, roads, ...after], (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map(key => [key, value[key]]),
          )
        : value,
    );
    reads = 0;
    for (let i = 0; i < 10; i++) expect(townCompositionFingerprint(before, roads, after)).toBe(expected);
    expect(reads).toBe(1);
    expect(townCompositionFingerprint([], [], [])).toBe('[[]]');
    const replaced = [{ ...roads[0], rank: 1 }];
    expect(townCompositionFingerprint(before, replaced, after)).not.toBe(expected);
  });
  it('prepares one raster per lane across batches, then releases every session before a new pass', async () => {
    const options = makeOptions({ seed: 'warm-lane-rasters', culture: 'european-organic', population: 10 });
    const settings = { options, extent: 6000, local: {}, urban: { backend: 'native' }, runtime: { backend: 'native', localServer: 'http://127.0.0.1:8791' } } as V2Settings;
    const heights = new Float32Array(16).fill(10);
    const world = {
      seed: options.seed,
      options,
      mapSize: 6000,
      terrain: { height: { w: 4, h: 4, cell: 1500, data: heights }, water: new Uint8Array(16), filled: heights, seaLevel: 0, coastline: [], lakes: [], rivers: [] },
      settlements: Array.from({ length: 12 }, (_, i) => ({ key: `farm-${i}`, population: 10, culture: options.culture, center: { x: 100 + (i % 4) * 1500, y: 100 + Math.floor(i / 4) * 1500 }, radius: 20 })),
      stats: { 'v2.terrainKey': 'same-retained-ground' },
    } as unknown as World;
    native.run.mockImplementation(async request => ({ layouts: request.sites.map((site: { key: string; center: { x: number; y: number } }) => ({ key: site.key, center: site.center, culture: options.culture, quarters: [], blocks: [], streets: [], warnings: [] })) }));
    const batch = async (start: number) => {
      for (let lane = 0; lane < 4; lane++) await generateRustTown(world, settings, `farm-${start + lane}`, undefined, 'layout', lane, []);
    };
    await batch(0);
    await batch(4);
    expect(native.create).toHaveBeenCalledTimes(4);
    expect(native.run.mock.calls.filter(([r]) => r.raster)).toHaveLength(4);
    expect(native.run).toHaveBeenCalledTimes(8);
    expect(native.release).not.toHaveBeenCalled();
    await releaseUrbanLanes();
    expect(native.release).toHaveBeenCalledTimes(4);
    await batch(8);
    expect(native.create).toHaveBeenCalledTimes(8);
    expect(native.run.mock.calls.filter(([r]) => r.raster)).toHaveLength(8);
  });
});
