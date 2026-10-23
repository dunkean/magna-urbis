import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layout } from '../../rust/bridge/urban';
import type { SettlementRaster } from '../../rust/bridge/settlements';

const native = vi.hoisted(() => ({ quarters: vi.fn(), parcels: vi.fn(), free: vi.fn(), geometry: vi.fn() }));
vi.mock('../../rust/pkg/wasm/magna_urbis_wasm.js', () => ({
  default: vi.fn(),
  SettlementTerrain: class {
    free = native.free;
    urban_quarters = native.quarters;
    urban_parcels = native.parcels;
    set_urban_geometry = native.geometry;
  },
}));
import { createUrbanEngine } from '../../rust/bridge/urban';

const raster = (): SettlementRaster => ({ width: 100, n: 2, height: new Float32Array(4), water: new Uint8Array(4),
  waterLevel: new Float32Array(4), riverWidth: new Float32Array(4), riverIds: new Int32Array(4) });
const layout: Layout = { key: 'town', culture: 'european-organic', center: { x: 1.2345678901234567, y: 0 },
  quarters: [], streets: [], blocks: [], warnings: [] };
async function setup() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) }));
  native.quarters.mockReturnValue(JSON.stringify([layout]));
  native.parcels.mockReturnValue('[]');
  const engine = await createUrbanEngine();
  await engine.run({ id: 1, kind: 'quarters', seed: '42', raster: raster() });
  return engine;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('urban worker retained quarter boundary', () => {
  it('reads another worker native source without a private raster upload or a silent stale-source fallback', async () => {
    const runtime = { profile: 'local' as const, server: 'http://127.0.0.1:8810' };
    const source = { version: 1 as const, session: '', terrainRevision: 'terrain-token', layoutsRevision: 'layout-token', partitionsRevision: 'parcel-token' };
    const fetch = vi.fn().mockImplementation(async (_url, options) => {
      const input = JSON.parse(options.body);
      if (input.kind === 'parcels') { source.session = input.session; return new Response(JSON.stringify({ id: input.id, partitions: [], urbanSource: source })); }
      if (input.source.partitionsRevision === 'stale') return new Response(JSON.stringify({ error: '[urban_source_stale] changed' }), { status: 400 });
      return new Response(JSON.stringify({ id: input.id, placementRequests: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const urbanOwner = await createUrbanEngine(runtime), houseReader = await createUrbanEngine(runtime);
    const response = await urbanOwner.run({ id: 1, seed: 'city', kind: 'parcels', layoutsId: 9, runtime });
    expect(response.urbanSource).toEqual(source);
    expect((await houseReader.run({ id: 2, seed: 'houses', kind: 'buildingSites', source: response.urbanSource, keys: ['town'], runtime })).error).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    const read = JSON.parse(fetch.mock.calls[1][1].body);
    expect(read).toMatchObject({ source, session: source.session, keys: ['town'] });
    expect(read.raster).toBeUndefined(); expect(read.layouts).toBeUndefined(); expect(read.partitions).toBeUndefined();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${runtime.server}/urban`, `${runtime.server}/urban`]);
    expect((await houseReader.run({ id: 3, seed: 'houses', kind: 'buildingSites', source: { ...source, partitionsRevision: 'stale' }, runtime })).error).toContain('urban_source_stale');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await houseReader.run({ id: 4, seed: 'houses', kind: 'buildingSites', source, raster: raster(), runtime })).error).toContain('without uploaded geometry');
    expect((await houseReader.run({ id: 5, seed: 'houses', kind: 'buildingSites', source, runtime: { ...runtime, profile: 'web' } })).error).toContain('local source');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reuses exactly the old JS-number JSON boundary for every parcel edit', async () => {
    const engine = await setup();
    const explicit = await engine.run({ id: 2, kind: 'parcels', seed: 'parcels', layouts: [layout] });
    const original = native.parcels.mock.calls.at(-1);
    const retained = await engine.run({ id: 3, kind: 'parcels', seed: 'parcels', layoutsId: 1 });
    expect(retained.partitions).toEqual(explicit.partitions);
    expect(native.parcels.mock.calls.at(-1)).toEqual(original);
    await engine.run({ id: 4, kind: 'parcels', seed: 'another-seed', layoutsId: 1 });
    expect(native.parcels.mock.calls.at(-1)?.slice(0, 2)).toEqual(['another-seed', original?.[1]]);
  });

  it('rejects stale revisions after new quarters or a terrain replacement', async () => {
    const engine = await setup();
    await engine.run({ id: 5, kind: 'quarters', seed: 'new' });
    expect((await engine.run({ id: 6, kind: 'parcels', seed: '42', layoutsId: 1 })).error).toBeDefined();
    expect(native.parcels).not.toHaveBeenCalled();
    expect((await engine.run({ id: 7, kind: 'parcels', seed: '42', layoutsId: 5, raster: raster() })).error).toBeDefined();
    expect(native.parcels).not.toHaveBeenCalled();
    expect(native.free).toHaveBeenCalledOnce();
  });

  it('accepts explicit imported/fallback layouts without a matching revision', async () => {
    const engine = await setup();
    const imported = [{ ...layout, key: 'imported' }];
    const response = await engine.run({ id: 8, kind: 'parcels', seed: '42', layouts: imported, layoutsId: 999, raster: raster() });
    expect(response.error).toBeUndefined();
    expect(native.parcels.mock.calls.at(-1)?.[1]).toBe(JSON.stringify(imported));
    expect(imported[0].key).toBe('imported');
  });

  it('cannot reuse the previous layout after a failed quarter generation', async () => {
    const engine = await setup();
    native.quarters.mockImplementationOnce(() => { throw new Error('invalid config'); });
    expect((await engine.run({ id: 9, kind: 'quarters', seed: '42' })).error).toContain('invalid config');
    expect((await engine.run({ id: 10, kind: 'parcels', seed: '42', layoutsId: 1 })).error).toBeDefined();
    expect(native.parcels).not.toHaveBeenCalled();
  });

  it('frees an incompletely initialized terrain and accepts a clean retry', async () => {
    const engine = await setup();
    native.geometry.mockImplementationOnce(() => { throw new Error('invalid geography'); });
    const input = { ...raster(), geometry: { land: [], water: [], rivers: [] } } as SettlementRaster;
    expect((await engine.run({ id: 11, kind: 'quarters', seed: '42', raster: input })).error).toContain('invalid geography');
    expect(native.free).toHaveBeenCalledTimes(2);
    expect((await engine.run({ id: 12, kind: 'parcels', seed: '42', layouts: [layout] })).error).toContain('terrain');
    expect(native.parcels).not.toHaveBeenCalled();
    expect((await engine.run({ id: 13, kind: 'quarters', seed: '42', raster: raster() })).layouts).toEqual([layout]);
  });
});
