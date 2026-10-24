import { beforeAll, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import { resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage } from '../src/ui/urbanBuildingChunkStore';
import { openDerivedCache } from '../src/ui/urbanBuildingDerivedCache';
import { loadColdOverview, type OverviewRasterFactory, type ContourPreview } from '../src/ui/urbanColdOverviewCache';
import { openColdVisualWindow } from '../src/ui/urbanColdVisualWindow';
import { openColdArchitecturalWindow } from '../src/ui/urbanColdWindowLod';
import { SvgOverviewRaster } from './helpers/urbanSvgOverviewRaster';
import { OverviewTestBackend } from './helpers/urbanOverviewTestBackend';
import { deferred } from './helpers/urbanBuildingColdTestBackend';
import { buildingPaint } from '../src/render/urbanBuildingStyle';
import { projectNativeBuildingChunk } from '../src/ui/urbanBuildingProjection';
import { translateBuilding } from '../src/ui/urbanSnapshot';

let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(fixture.chunks.map(c => archivePlanBatch(c.delta as unknown as PlacementBatch))); });
async function city() {
  const backend = new OverviewTestBackend(), stage = await beginUrbanBuildingStage(backend,
    { sceneId: 'overview-C', sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  const parent = await stage.commit(); backend.reads = []; return { backend, parent, reader: await openDerivedCache(backend, parent) };
}
function painter() {
  let lastSvg = '', png: Uint8Array = new Uint8Array(), disposed = 0, flushes = 0;
  const factory: OverviewRasterFactory = pixels => {
    const host = new SvgOverviewRaster(pixels);
    return { context: host.context, flush: () => host.flush(), png: async () => { png = await host.png(); lastSvg = host.lastSvg; flushes = host.flushes; return png; },
      dispose() { disposed++; host.dispose(); } };
  };
  return { factory, get svg() { return lastSvg; }, get png() { return png; }, get disposed() { return disposed; }, get flushes() { return flushes; } };
}
const sum = (c: Uint32Array) => c.reduce((a, b) => a + b, 0);
it('persists full actual-C overview; warm opening authenticates parent+child and rereads ZERO derived/native chunks', async () => {
  const c = await city(), p = painter();
  const first = await loadColdOverview(c.backend, c.reader, { resolution: 64, requireContour: true, rasterFactory: p.factory });
  expect(first.cacheStatus).toBe('built'); expect(first.contour!.png.length).toBeGreaterThan(32); expect(sum(first.overview.counts)).toBe(6);
  expect(p.disposed).toBe(1); expect(p.flushes).toBe(3); expect(c.backend.derivedReads).toEqual([0, 1, 2, 0, 1, 2]);
  c.backend.derivedReads = [];
  const warm = await loadColdOverview(c.backend, await openDerivedCache(c.backend, c.parent), { resolution: 64, requireContour: true,
    rasterFactory: () => { throw new Error('Warm cache must not repaint'); } });
  expect(warm.cacheStatus).toBe('hit'); expect(warm.contour!.png).toEqual(first.contour!.png); expect(warm.overview).toEqual(first.overview);
  expect(c.backend.derivedReads).toEqual([]); expect(c.backend.reads).toEqual([]); expect(c.backend.overviewCommits).toBe(1);
});
it('makes diagnostic-window warm restore use the persisted buffer instead of two complete scans', async () => {
  const c = await city(), a = await openColdVisualWindow(c.backend, c.parent.sceneId, { overviewResolution: 8 }); a.dispose();
  c.backend.derivedReads = [];
  const b = await openColdVisualWindow(c.backend, c.parent.sceneId, { overviewResolution: 8 });
  expect(b.overviewCacheStatus).toBe('hit'); expect(sum(b.overview.counts)).toBe(6); expect(c.backend.derivedReads).toEqual([]); expect(c.backend.reads).toEqual([]); b.dispose();
});
it('treats missing/corrupt/partial/stale counts, PNG or painter provenance as a bounded child rebuild, preserving native bytes', async () => {
  for (const fault of ['missing', 'counts', 'png', 'partial', 'parent', 'derived', 'style', 'extent']) {
    const c = await city(), p = painter();
    await loadColdOverview(c.backend, c.reader, { resolution: 16, requireContour: true, rasterFactory: p.factory });
    const [key, record] = [...c.backend.overviews][0];
    if (fault === 'missing') c.backend.overviews.clear();
    if (fault === 'counts') record.countsLE[0] ^= 1;
    if (fault === 'png') record.contour!.png[32] ^= 1;
    if (fault === 'partial') record.countsLE = record.countsLE.slice(4);
    if (fault === 'parent') record.parentFingerprint = '0'.repeat(64);
    if (fault === 'derived') record.derivedFingerprint = '0'.repeat(64);
    if (fault === 'style') record.contour!.painter = 'future-painter' as never;
    if (fault === 'extent') record.contour!.bounds[0] = Infinity;
    c.backend.derivedReads = [];
    const rebuilt = await loadColdOverview(c.backend, c.reader, { resolution: 16, requireContour: true, rasterFactory: p.factory });
    expect(rebuilt.cacheStatus, fault).toBe('built'); expect(sum(rebuilt.overview.counts)).toBe(6); expect(c.backend.derivedReads).toHaveLength(6);
    expect(c.backend.overviews.get(key)!.parentFingerprint).toBe(c.parent.fingerprint);
    expect(c.backend.stages.get(c.parent.sceneId)!.manifest).toEqual(c.parent); expect(c.backend.reads).toEqual([]);
  }
});
it('keeps the complete real image usable on quota/read failure; cancellation never commits a prefix or loses native data', async () => {
  for (const fault of ['read', 'commit'] as const) {
    const c = await city(), p = painter(); c.backend.failOverview = fault;
    const result = await loadColdOverview(c.backend, c.reader, { resolution: 16, requireContour: true, rasterFactory: p.factory });
    expect(result.cacheStatus).toBe(fault === 'commit' ? 'built-uncached' : 'built'); expect(sum(result.overview.counts)).toBe(6);
    expect(result.contour).toBeDefined(); expect(c.backend.reads).toEqual([]);
  }
  const c = await city(), signal = new AbortController(), entered = deferred(), release = deferred(); let disposed = 0;
  const job = loadColdOverview(c.backend, c.reader, { resolution: 16, requireContour: true, signal: signal.signal,
    rasterFactory: pixels => { const h = new SvgOverviewRaster(pixels); return { context: h.context,
      flush: async () => { entered.resolve(); await release.promise; await h.flush(); }, png: () => h.png(), dispose() { disposed++; h.dispose(); } }; } });
  const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise; signal.abort(); release.resolve(); await rejected;
  expect(disposed).toBe(1); expect(c.backend.overviews.size).toBe(0); expect(c.backend.reads).toEqual([]);
});
it('compares both parents at commit after concurrent replacement; stale paint cannot replace the current cache', async () => {
  const c = await city(), p = painter(), gate = { entered: deferred(), release: deferred() }; c.backend.overviewGate = gate;
  const job = loadColdOverview(c.backend, c.reader, { resolution: 16, requireContour: true, rasterFactory: p.factory });
  await gate.entered.promise; c.backend.caches.get(c.parent.sceneId)!.manifest!.fingerprint = 'f'.repeat(64); gate.release.resolve();
  const result = await job; expect(result.cacheStatus).toBe('built-uncached'); expect(result.cacheReason).toContain('parent changed');
  expect(c.backend.overviews.size).toBe(0); expect(c.backend.reads).toEqual([]);
});
it('renders a true roof hole transparently with shared painter commands (synthetic operator fixture, not native admission)', async () => {
  const c = await city(), backend = new OverviewTestBackend(), source = chunks[0].buildings[0];
  const ring = (a: number, b: number) => [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];
  const roof = [{ outer: ring(0, 20), holes: [ring(5, 15)] }];
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'hole', sourceFingerprint: fixture.cliSha256, totalRequests: 1 });
  await stage.append({ ...chunks[0], buildings: [{ ...source, footprint: roof, roof_footprint: roof }], refusals: [], open_spaces: [] }, { total: 1, start: 0, completed: 1 });
  const parent = await stage.commit(), p = painter();
  const result = await loadColdOverview(backend, await openDerivedCache(backend, parent), { resolution: 64, requireContour: true, rasterFactory: p.factory });
  const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image width="64" height="64" href="data:image/png;base64,${Buffer.from(result.contour!.png).toString('base64')}"/></svg>`).render();
  const pixels = image.pixels, alpha = (x: number, y: number) => pixels[(y * 64 + x) * 4 + 3];
  expect(alpha(32, 32)).toBe(0); expect(alpha(8, 8)).toBeGreaterThan(0); expect(p.svg).toContain('fill-rule="nonzero"');
  expect(sum(result.overview.counts)).toBe(1); expect(c.backend.reads).toEqual([]);
});
it('architectural consumer draws complete real contours with offsets, exposes exact selection only near, and never substitutes density on style mismatch', async () => {
  const c = await city(), p = painter(); let closed = 0, imageArgs: unknown[] = [];
  const decode = async (v: ContourPreview) => ({ source: {} as CanvasImageSource, width: v.pixels, height: v.pixels, close() { closed++; } });
  const facade = await openColdArchitecturalWindow(c.backend, c.parent.sceneId, { overviewResolution: 64, rasterFactory: p.factory,
    decodeContour: decode, offset: { x: 100, y: -50 }, limits: { maxTiles: 1 } });
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, drawImage(...args: unknown[]) { imageArgs = args; } } as unknown as CanvasRenderingContext2D;
  const draw = { viewport: { minX: 0, minY: 0, maxX: 20000, maxY: 20000 }, metresPerPixel: 30, appearance: { style: 'cartographic', diagnostic: 'none' } as const, painted: false };
  expect(facade.draw(ctx, draw).coverage).toBe('complete-native-contours'); expect(imageArgs.slice(5)).toEqual([facade.contourPreview!.bounds[0], facade.contourPreview!.bounds[1],
    facade.contourPreview!.bounds[2] - facade.contourPreview!.bounds[0], facade.contourPreview!.bounds[3] - facade.contourPreview!.bounds[1]]);
  expect(facade.pick({ x: 9000, y: 10000 })).toEqual({ status: 'pending' });
  expect(facade.draw(ctx, { ...draw, appearance: { style: 'silhouette', diagnostic: 'none' } }).coverage).toBe('architectural-preview-pending');
  expect(facade.stats.decodedContourBytes).toBe(64 * 64 * 4); facade.dispose(); expect(closed).toBe(1); expect(facade.stats.decodedContourBytes).toBe(0);
  c.backend.derivedReads = [];
  const warm = await openColdArchitecturalWindow(c.backend, c.parent.sceneId, { overviewResolution: 64, decodeContour: decode });
  expect(warm.overviewCacheStatus).toBe('hit'); expect(c.backend.derivedReads).toEqual([]);
  const actual = chunks[0].buildings[0], points = actual.roof_footprint.flatMap(s => s.outer);
  const near = await warm.update([Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y))]);
  expect(near.complete).toBe(true); const picked = warm.pick(points[0]); expect(picked.status).toBe('exact');
  if (picked.status === 'exact') { expect(picked.building!.id).toBe(actual.id); expect(warm.selected(actual.id)!.recipe_id).toBe(actual.recipe_id); }
  expect(c.backend.reads).toEqual([]);
  const inspected = await warm.inspect(actual.id);
  expect(inspected.base).toBe(warm.selected(actual.id)); expect(inspected.building).toEqual(actual); expect(inspected.originBinding).toBe('unbound');
  expect(inspected.scene.buildings).toHaveLength(1); expect(c.backend.reads).toEqual([0]);
  expect(await resolveArchivedPlan(inspected.building, inspected.scene)).toEqual(await resolveArchivedPlan(actual, chunks[0]));
  await warm.update([0, 0, 1, 1]); expect(warm.stats.nativeInspection.chunks).toBe(0);
  await expect(warm.inspect(actual.id)).rejects.toThrow('pending/unavailable'); expect(c.backend.reads).toEqual([0]); warm.dispose();
});
it('requires a real raster backend for architectural coverage; a density-only cache cannot masquerade as native contours', async () => {
  const c = await city(); await loadColdOverview(c.backend, c.reader, { resolution: 16 }); c.backend.derivedReads = [];
  // Node test host has no browser OffscreenCanvas. A missing backend must be explicit.
  await expect(loadColdOverview(c.backend, c.reader, { resolution: 16, requireContour: true })).rejects.toThrow('raster backend unavailable');
  expect(c.backend.derivedReads).toEqual([]); expect(c.backend.reads).toEqual([]);
});

it('preserves native record/material order across overlapping roofs rather than regrouping the whole city by colour (synthetic painter contract)', async () => {
  const backend = new OverviewTestBackend(), source = chunks[0].buildings[0];
  const roof = [{ outer: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], holes: [] }];
  const a = { ...source, id: 'first', parcel_id: 'first-parcel', footprint: roof, roof_footprint: roof,
    volumes: source.volumes.map(v => ({ ...v, materials: { ...v.materials, cladding: 'MAT-TILE-CLAY' } })) };
  const b = { ...a, id: 'second', parcel_id: 'second-parcel', volumes: a.volumes.map(v => ({ ...v, materials: { ...v.materials, cladding: 'MAT-THATCH' } })) };
  const delta = { ...chunks[0], buildings: [a, b], refusals: [], open_spaces: [] };
  const projected = projectNativeBuildingChunk(delta), colors = projected.buildings.map(v => buildingPaint(v.materials, v.function, v.height_m,
    { style: 'cartographic', diagnostic: 'none' }, undefined, { materials: projected.materials ?? [] }).roof);
  expect(colors[0]).not.toBe(colors[1]);
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'order', sourceFingerprint: fixture.cliSha256, totalRequests: 2 });
  await stage.append(delta, { total: 2, start: 0, completed: 2 }); const parent = await stage.commit(), p = painter();
  await loadColdOverview(backend, await openDerivedCache(backend, parent), { resolution: 64, requireContour: true, rasterFactory: p.factory });
  expect(p.svg.indexOf(`fill="${colors[0]}"`)).toBeGreaterThanOrEqual(0);
  expect(p.svg.indexOf(`fill="${colors[1]}"`)).toBeGreaterThan(p.svg.indexOf(`fill="${colors[0]}"`));
});

it('rejects oversized resolution or a lying PNG dimension before publication, never committing a bounded-looking header for a huge image', async () => {
  const c = await city();
  await expect(loadColdOverview(c.backend, c.reader, { resolution: 2048, requireContour: true })).rejects.toThrow('resolution');
  expect(c.backend.derivedReads).toEqual([]);
  await expect(loadColdOverview(c.backend, c.reader, { resolution: 16, requireContour: true, rasterFactory: pixels => {
    const h = new SvgOverviewRaster(pixels); return { context: h.context, flush: () => h.flush(), png: async () => {
      const png = (await h.png()).slice(); new DataView(png.buffer).setUint32(16, 1000000, false); return png;
    }, dispose: () => h.dispose() };
  } })).rejects.toThrow('bounded PNG');
  expect(c.backend.overviews.size).toBe(0); expect(c.backend.reads).toEqual([]);
});

it('invalidates an in-flight native inspection when selection changes and preserves real native offsets on a fresh selection', async () => {
  const c = await city(), p = painter(), offset = { x: 100, y: -50 }, actual = chunks[0].buildings[0];
  const facade = await openColdArchitecturalWindow(c.backend, c.parent.sceneId, { overviewResolution: 16, rasterFactory: p.factory, offset,
    decodeContour: async v => ({ source: {} as CanvasImageSource, width: v.pixels, height: v.pixels, close() {} }) });
  const points = actual.roof_footprint.flatMap(s => s.outer), near: [number, number, number, number] = [Math.min(...points.map(p => p.x)) + offset.x,
    Math.min(...points.map(p => p.y)) + offset.y, Math.max(...points.map(p => p.x)) + offset.x, Math.max(...points.map(p => p.y)) + offset.y];
  await facade.update(near); const started = deferred(), release = deferred(); c.backend.block = { index: 0, started, release };
  const inspection = facade.inspect(actual.id), rejected = expect(inspection).rejects.toMatchObject({ name: 'AbortError' });
  await started.promise; await facade.update([0, 0, 1, 1]); release.resolve(); await rejected;
  expect(facade.stats.nativeInspection.chunks).toBe(0); expect(facade.selected(actual.id)).toBeUndefined();
  await facade.update(near); const fresh = await facade.inspect(actual.id);
  expect(fresh.building).toEqual(translateBuilding(actual, offset.x, offset.y)); expect(fresh.parentFingerprint).toBe(c.parent.fingerprint);
  expect(fresh.scene.plan_archives).toEqual((await facade.inspect(actual.id)).scene.plan_archives); expect(facade.stats.nativeInspection.chunks).toBe(1);
  expect(c.backend.reads).toEqual([0, 0]); facade.dispose(); expect(facade.stats.nativeInspection.chunks).toBe(0);
});
