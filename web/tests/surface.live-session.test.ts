import { describe, expect, it } from 'vitest';
import type { Decor } from '../src/ui/decor';
import type { TerrainProvider } from '../src/surface/provider';
import { createSurfaceLiveSession } from '../src/ui/surfaceLiveSession';

function fixture(): Decor {
  const n = 8, height = new Float32Array(n * n).fill(100);
  return { meta: { format: 'magna-decor', version: 1, id: 'retained-source', label: 'transport test', tags: {}, seed: '42',
    width: 80, query: 'climate=temperate', created: '2026-10-23', settlements: [], roads: null, roadConfig: null, waterSvg: '',
    stats: { land: 1, minHeight: 100, maxHeight: 100, riverKm: 0, roadKm: 0 } },
    raster: { n, width: 80, height, water: new Uint8Array(n * n), waterLevel: height.slice(), riverWidth: new Float32Array(n * n), riverIds: new Int32Array(n * n) } } as Decor;
}
function provider(): TerrainProvider {
  return { id: 'registered-source', async request(request) {
    const width = Math.round((request.bounds.maxX - request.bounds.minX) / request.spacingM);
    return { width, height: width, spacingM: request.spacingM, originX: request.bounds.minX + request.spacingM / 2,
      originZ: request.bounds.minZ + request.spacingM / 2, heights: new Float32Array(width * width).fill(101),
      source: { id: 'registered-source:42:content-id', version: 'refinement-1', sourceLOD: -2, sourceLODKnown: true,
        nativeSpacingM: .25, provenance: 'explicit mocked transport test; not real source evidence' } };
  } };
}
describe('Live context handoff', () => {
  it('delivers the canonical context once, then preserves its reference on finer source replies', async () => {
    const source = fixture(), original = source.raster.height.slice(), controller = new AbortController();
    const session = createSurfaceLiveSession(source, undefined, provider(), () => true);
    const first = await session({ x: 20, y: 20, extent: 40, resolution: 16 }, controller.signal);
    expect(first.world.canonicalContext).toBeDefined(); expect(first.world.terrain.source.sourceLOD).toBe(-2);
    const knownContextId = first.world.canonicalContextRef!.id;
    const second = await session({ x: 20, y: 20, extent: 40, resolution: 32, knownContextId }, controller.signal);
    expect(second.world.canonicalContext).toBeUndefined();
    expect(second.world.canonicalContextRef).toEqual(first.world.canonicalContextRef);
    expect(second.world.versions.environment).toBe(first.world.versions.environment);
    expect(second.world.versions.population).toBe(first.world.versions.population);
    expect(second.world.terrain.spacingM).toBe(1.25);
    expect(source.raster.height).toEqual(original);
  });
  it('rejects stale worlds, pre-cancelled requests and unsupported bounds', async () => {
    const source = fixture(), controller = new AbortController();
    const stale = createSurfaceLiveSession(source, undefined, provider(), () => false);
    await expect(stale({ x: 20, y: 20, extent: 40, resolution: 16 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const session = createSurfaceLiveSession(source, undefined, provider(), () => true);
    await expect(session({ x: -1, y: 20, extent: 40, resolution: 16 }, controller.signal)).rejects.toThrow(/outside/);
    controller.abort();
    await expect(session({ x: 20, y: 20, extent: 40, resolution: 16 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
