import { describe, expect, it, vi } from 'vitest';
import { createInfiniteRefinementProvider } from '../src/surface/adapters/infiniteRefinement';
import { assertCanonicalRegistrationField, assertRefinementTerrainRegion, assertSurfaceRegistrationBinding, compareRefinementParent,
  registrationFieldFingerprint, sampleRegistrationBilinear, sampleRegistrationBSpline, type RegistrationField } from '../src/surface/registrationBinding';
import { createSurfaceBenchRevisionReader } from '../src/ui/surfaceBenchRevision';
import type { TerrainGrid } from '../src/surface/model';

function field(): RegistrationField { return { width: 160, n: 16, data: Float32Array.from({ length: 256 }, (_, i) => 50 + Math.sin(i % 16 / 3) * 30 + Math.floor(i / 16) ** 2 * .7 - (i % 16) * Math.floor(i / 16) * .2) }; }
const registration = (id = 'one') => ({ id, version: 'source-v1', minMpp: 1, nativeMpp: 10, retainedSourceCell: 10, decoderUsed: true });
function reply(body: any, id = body.id): Response {
  return new Response(new Float32Array(body.resolution ** 2).fill(75).buffer, { headers: { 'X-Neural-Meta': JSON.stringify({ id, version: 'source-v1',
    x: body.x, y: body.y, width: body.width, n: body.resolution, sourceCell: 1, lod: -4, decoderUsed: true }) } });
}
const request = (signal?: AbortSignal) => ({ bounds: { minX: 20, minZ: 20, maxX: 100, maxZ: 100 }, spacingM: 5, worldVersion: 'world', signal });

describe('exact registered source lineage', () => {
  it('fingerprints only the exact view bytes and verifies identity or documented canonical centre reduction', async () => {
    const f = field(), calls: any[] = [];
    const provider = await createInfiniteRefinementProvider('http://source', f, { seed: '47' }, (async (_url, options) => { calls.push(JSON.parse(String(options?.body))); return Response.json(registration()); }) as typeof fetch);
    const initial = provider.bindCanonicalField(f);
    expect(initial.expectedSourceId).toBe('infinite:47:one'); expect(initial.fieldFingerprint).toBe(registrationFieldFingerprint(f));
    expect(initial.canonicalDerivation).toBe('identity');
    const posted = Buffer.from(calls[0].heights, 'base64'); expect(posted).toEqual(Buffer.from(f.data.buffer));
    const canonical = { width: f.width, n: 8, data: Float32Array.from({ length: 64 }, (_, i) => sampleRegistrationBilinear(f, (i % 8 + .5) * 20, (Math.floor(i / 8) + .5) * 20)) };
    const reduced = provider.bindCanonicalField(canonical);
    expect(reduced.canonicalDerivation).toBe('bilinear-control-grid-at-centres'); expect(reduced.canonicalN).toBe(8);
    expect(() => assertSurfaceRegistrationBinding(reduced, canonical)).not.toThrow();
    const corrupt = { ...canonical, data: canonical.data.slice() }; corrupt.data[0]++;
    expect(() => assertSurfaceRegistrationBinding(reduced, corrupt)).toThrow(/fingerprint/);
    expect(() => provider.bindCanonicalField(corrupt)).toThrow(/centre-sampled/);
    f.data[0]++;
    expect(provider.registrationBinding.fieldFingerprint).toBe(initial.fieldFingerprint);
    expect(() => provider.bindCanonicalField(f)).toThrow(/exact registered field/);
    provider.dispose();
  });

  it('rejects transposed canonical fields, shifted source grids and tile identity/version mismatches', async () => {
    const f = field(), transposed = { ...f, data: Float32Array.from({ length: 256 }, (_, i) => f.data[(i % 16) * 16 + Math.floor(i / 16)]) };
    expect(() => assertCanonicalRegistrationField(f, transposed)).toThrow(/exact registered/);
    const grid: TerrainGrid = { width: 8, height: 8, spacingM: 10, originX: 25, originZ: 25, heights: new Float32Array(64), source: { id: 'x', version: 'v', sourceLOD: -3, nativeSpacingM: 1 } };
    expect(() => assertRefinementTerrainRegion(grid, request().bounds)).not.toThrow();
    expect(() => assertRefinementTerrainRegion({ ...grid, originX: 20 }, request().bounds)).toThrow(/footprint/);
    const provider = await createInfiniteRefinementProvider('http://source', f, { seed: '47' }, (async (url, options) => String(url).endsWith('/register') ? Response.json(registration()) : reply(JSON.parse(String(options?.body)), 'foreign-field')) as typeof fetch);
    await expect(provider.request(request())).rejects.toThrow(/metadata/); provider.dispose();
  });

  it('measures B-spline smoothing separately and detects correlation loss for a transposed source', () => {
    const f = field(), grid: TerrainGrid = { width: 32, height: 32, originX: 21.25, originZ: 71.25, spacingM: 2.5,
      heights: new Float32Array(1024), source: { id: 'x', version: 'v', sourceLOD: -3, nativeSpacingM: 1 } };
    grid.heights = Float32Array.from({ length: 1024 }, (_, i) => sampleRegistrationBSpline(f, grid.originX + i % 32 * 2.5, grid.originZ + Math.floor(i / 32) * 2.5));
    const comparison = compareRefinementParent(f, grid);
    expect(comparison.parentCorrelation).toBeGreaterThan(.99);
    expect(comparison.parentCorrelation!).toBeGreaterThan(comparison.transposedParentCorrelation! + .1);
    expect(comparison.controlSmoothingMaxAbsM).toBeGreaterThan(.01);
    expect(comparison.maxAbsDeltaM).toBeGreaterThan(.01);
    expect(comparison.refinementResidualMaxAbsM).toBeLessThan(.0001);
  });
});

describe('shared cancellable registration refresh', () => {
  it('shares a refresh, keeps it alive for remaining callers, and publishes the current binding after re-registration', async () => {
    let registrations = 0, resolveRefresh!: (value: Response) => void, refreshSignal: AbortSignal | undefined;
    const provider = await createInfiniteRefinementProvider('http://source', field(), { seed: '47' }, (async (url, options) => {
      if (String(url).endsWith('/register')) {
        registrations++;
        if (registrations === 1) return Response.json(registration());
        refreshSignal = options?.signal as AbortSignal;
        return await new Promise<Response>(resolve => { resolveRefresh = resolve; });
      }
      const body = JSON.parse(String(options?.body));
      return body.id === 'one' ? new Response('Refinement source expired or unknown', { status: 400 }) : reply(body);
    }) as typeof fetch);
    const a = new AbortController(), b = new AbortController();
    const first = provider.request(request(a.signal)).catch(error => error), second = provider.request(request(b.signal));
    await vi.waitFor(() => expect(registrations).toBe(2)); a.abort();
    expect(await first).toMatchObject({ name: 'AbortError' }); expect(refreshSignal!.aborted).toBe(false);
    resolveRefresh(Response.json(registration('two')));
    expect((await second).source.id).toBe('infinite:47:two'); expect(registrations).toBe(2);
    expect(provider.id).toBe('infinite-refinement:47:two'); expect(provider.registrationBinding.expectedSourceId).toBe('infinite:47:two'); provider.dispose();
  });

  it('aborts registration transport when its final caller cancels and a later request can retry cleanly', async () => {
    let registrations = 0, refreshSignal: AbortSignal | undefined;
    const provider = await createInfiniteRefinementProvider('http://source', field(), { seed: '47' }, (async (url, options) => {
      if (String(url).endsWith('/register')) {
        registrations++; if (registrations === 1) return Response.json(registration());
        if (registrations > 2) return Response.json(registration('three'));
        refreshSignal = options?.signal as AbortSignal;
        return await new Promise<Response>((_resolve, reject) => refreshSignal!.addEventListener('abort', () => reject(new DOMException('transport aborted', 'AbortError')), { once: true }));
      }
      const body = JSON.parse(String(options?.body)); return body.id === 'one' ? new Response('Refinement source expired or unknown', { status: 400 }) : reply(body);
    }) as typeof fetch);
    const a = new AbortController(), b = new AbortController();
    const first = provider.request(request(a.signal)).catch(error => error), second = provider.request(request(b.signal)).catch(error => error);
    await vi.waitFor(() => expect(registrations).toBe(2)); a.abort(); b.abort();
    expect(await first).toMatchObject({ name: 'AbortError' }); expect(await second).toMatchObject({ name: 'AbortError' }); expect(refreshSignal!.aborted).toBe(true);
    expect((await provider.request(request())).source.id).toBe('infinite:47:three'); expect(registrations).toBe(3); provider.dispose();
  });

  it('does not re-register a delayed expired response after that same deterministic source id was already refreshed', async () => {
    let registrations = 0, tiles = 0; const pending: Array<(response: Response) => void> = [];
    const provider = await createInfiniteRefinementProvider('http://source', field(), { seed: '47' }, (async (url, options) => {
      if (String(url).endsWith('/register')) { registrations++; return Response.json(registration()); }
      const body = JSON.parse(String(options?.body)); tiles++;
      if (tiles <= 2) return await new Promise<Response>(resolve => pending.push(resolve));
      return reply(body);
    }) as typeof fetch);
    const first = provider.request(request()), second = provider.request(request());
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0](new Response('Refinement source expired or unknown', { status: 400 })); await first;
    pending[1](new Response('Refinement source expired or unknown', { status: 400 })); await second;
    expect(registrations).toBe(2); provider.dispose();
  });

  it('pre-cancelled initialization performs no registration', async () => {
    const controller = new AbortController(); controller.abort(); const transport = vi.fn();
    await expect(createInfiniteRefinementProvider('http://source', field(), { seed: '47', signal: controller.signal }, transport as typeof fetch)).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('settlement/climate live cache epochs', () => {
  it('invalidates roads, placement, climate and workshop changes without camera/style invalidation', () => {
    const read = createSurfaceBenchRevisionReader(), terrain = {}, settings = {}, context = {}, scene = {}, layouts = {};
    let snapshot = { query: 'climate=temperate&forestDensity=.4&view=1,2,3&style=parchment', workshop: '{}', draft: '{}', stage: 'settlements', terrain, settings, context, scene, layouts };
    const initial = read(snapshot);
    expect(read({ ...snapshot, query: 'view=100,200,3&style=satellite&forestDensity=.4&climate=temperate' })).toBe(initial);
    snapshot = { ...snapshot, context: {} }; const roadsChanged = read(snapshot); expect(roadsChanged.sourceEpoch).not.toBe(initial.sourceEpoch);
    snapshot = { ...snapshot, query: 'climate=cold&forestDensity=.4' }; const climate = read(snapshot); expect(climate.sourceEpoch).not.toBe(roadsChanged.sourceEpoch);
    snapshot = { ...snapshot, workshop: '{"population":40000}' }; const city = read(snapshot); expect(city.sceneEpoch).not.toBe(climate.sceneEpoch);
    expect(read(snapshot)).toBe(city);
  });
});
