import { describe, expect, it } from 'vitest';
import type { Decor } from '../src/ui/decor';
import type { TerrainProvider } from '../src/surface/provider';
import { createSurfaceLiveSession, createSurfaceLiveBinarySession } from '../src/ui/surfaceLiveSession';
import { decodeSurfaceBinary } from '../src/surface/binary';
import type { SurfaceWorkerPacket } from '../src/surface/workerProtocol';
import { registrationFieldFingerprint, type SurfaceRegistrationBinding } from '../src/surface/registrationBinding';
import { exportSurfacePacket } from '../src/surface/adapters/export';
import { magnaSurfacePresentation } from '../src/surface/presentation';

function fixture(): Decor {
  const n = 8, height = new Float32Array(n * n).fill(100);
  return { meta: { format: 'magna-decor', version: 1, id: 'retained-source', label: 'transport test', tags: {}, seed: '42',
    width: 80, query: 'climate=temperate', created: '2026-10-23', settlements: [], roads: null, roadConfig: null, waterSvg: '',
    stats: { land: 1, minHeight: 100, maxHeight: 100, riverKm: 0, roadKm: 0 } },
    raster: { n, width: 80, height, water: new Uint8Array(n * n), waterLevel: height.slice(), riverWidth: new Float32Array(n * n), riverIds: new Int32Array(n * n) } } as Decor;
}
function provider(): TerrainProvider & { registrationBinding: SurfaceRegistrationBinding } {
  const d = fixture(), field = registrationFieldFingerprint({ width: d.raster.width, n: d.raster.n, data: d.raster.height });
  return { id: 'registered-source', registrationBinding: { expectedSourceId: 'registered-source:42:content-id', providerId: 'registered-source', registrationId: 'mock-registration',
    sourceVersion: 'refinement-1', fieldFingerprint: field, width: 80, n: 8, interpolation: 'cell-centred-cubic-bspline-controls',
    canonicalFieldFingerprint: field, canonicalWidth: 80, canonicalN: 8, canonicalDerivation: 'identity' }, async request(request) {
    const width = Math.round((request.bounds.maxX - request.bounds.minX) / request.spacingM);
    return { width, height: width, spacingM: request.spacingM, originX: request.bounds.minX + request.spacingM / 2,
      originZ: request.bounds.minZ + request.spacingM / 2, heights: new Float32Array(width * width).fill(101),
      source: { id: 'registered-source:42:content-id', version: 'refinement-1', sourceLOD: -2, sourceLODKnown: true,
        nativeSpacingM: .25, provenance: 'explicit mocked transport test; not real source evidence' } };
  } };
}
describe('Live context handoff', () => {
  it('changes mapper presentation without regenerating the environment, occupation or population', async () => {
    let style = 'parchment';
    const session = createSurfaceLiveBinarySession(fixture(), undefined, provider(), () => true, { execution: 'synchronous-node', presentation: () => magnaSurfacePresentation(`style=${style}`) });
    const signal = new AbortController().signal, region = { x: 20, y: 20, extent: 40, resolution: 16 };
    const first = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session(region, signal)));
    style = 'blueprint';
    const next = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session({ ...region, knownContextId: first.world.canonicalContextRef!.id, knownSceneContextId: first.source.sceneContextId as string }, signal)));
    expect(next.presentation?.mapStyle).toBe('blueprint'); expect(next.world.versions).toEqual(first.world.versions);
    expect(next.source.compilation).toEqual({ canonicalBuildCount: 1 }); expect(next.urban).toBeUndefined();
    expect(next.world.canonicalContext).toBeUndefined(); session.dispose();
  });
  it('carries the original source hydrology in live and offline packets independently of physical wet cells', async () => {
    const d = fixture(); d.raster.riverIds[2] = 55; d.raster.riverWidth[2] = 7;
    const session = createSurfaceLiveBinarySession(d, undefined, provider(), () => true, { execution: 'synchronous-node' });
    const first = decodeSurfaceBinary<any>(new Uint8Array(await session({ x: 20, y: 20, extent: 40, resolution: 16 }, new AbortController().signal)));
    const offline = exportSurfacePacket(d, undefined, { encoding: 'binary' });
    expect(first.source.water).toStrictEqual(offline.source.water);
    expect(first.source.water.riverIds[2]).toBe(55); expect(first.source.water.originConvention).toBe('first-sample-centre');
    expect(first.source.water.originX).toBe(5); expect(first.source.water.cornerX).toBe(0);
    session.dispose();
  });
  it('exposes explicit Node binary fallback with the same context handshake as the browser worker', async () => {
    const session = createSurfaceLiveBinarySession(fixture(), undefined, provider(), () => true, { execution: 'synchronous-node' });
    expect(session.execution).toBe('synchronous-node');
    const signal = new AbortController().signal;
    const first = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session({ x: 20, y: 20, extent: 40, resolution: 16 }, signal)));
    expect(first.world.canonicalContext).toBeDefined();
    const second = decodeSurfaceBinary<SurfaceWorkerPacket>(new Uint8Array(await session({ x: 20, y: 20, extent: 40, resolution: 32, knownContextId: first.world.canonicalContextRef!.id, knownSceneContextId: first.source.sceneContextId as string }, signal)));
    expect(second.world.canonicalContext).toBeUndefined(); expect(second.world.canonicalContextRef).toEqual(first.world.canonicalContextRef);
    expect(first.urban).toBeDefined(); expect(second.urban).toBeUndefined();
    expect(second.source.meta).toBeUndefined(); expect(second.source.sceneContextId).toBe(first.source.sceneContextId);
    session.dispose();
    await expect(session({ x: 20, y: 20, extent: 40, resolution: 16 }, signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('delivers the canonical context once, then preserves its reference on finer source replies', async () => {
    const source = fixture(), original = source.raster.height.slice(), controller = new AbortController();
    const session = createSurfaceLiveSession(source, undefined, provider(), () => true);
    const first = await session({ x: 20, y: 20, extent: 40, resolution: 16 }, controller.signal);
    expect(first.world.canonicalContext).toBeDefined(); expect(first.world.terrain.source.sourceLOD).toBe(-2);
    expect(first.terrainParents?.[0].terrain.source.id).toBe(first.world.terrain.source.id);
    expect(first.terrainParents?.[0].terrain.source.sourceLODKnown).toBe(false);
    const knownContextId = first.world.canonicalContextRef!.id;
    const second = await session({ x: 20, y: 20, extent: 40, resolution: 32, knownContextId }, controller.signal);
    expect(second.world.canonicalContext).toBeUndefined();
    expect(second.terrainParents).toBeUndefined();
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
