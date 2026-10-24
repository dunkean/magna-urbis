import { beforeAll, expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, type ChunkBounds } from '../src/ui/urbanBuildingChunkStore';
import { openDerivedCache } from '../src/ui/urbanBuildingDerivedCache';
import { projectNativeBuildingChunk } from '../src/ui/urbanBuildingProjection';
import { translateColdProjection } from '../src/ui/urbanColdCitySession';
import { buildColdOverview } from '../src/ui/urbanColdOverview';
import { openColdVisualWindow } from '../src/ui/urbanColdVisualWindow';
import { openColdWindowLod } from '../src/ui/urbanColdWindowLod';
import { UrbanBuildingLodRenderer } from '../src/render/urbanBuildingLod';
import { DerivedTestBackend } from './helpers/urbanDerivedTestBackend';
import { deferred } from './helpers/urbanBuildingColdTestBackend';

let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(fixture.chunks.map(c => archivePlanBatch(c.delta as unknown as PlacementBatch))); });
async function city() {
  const backend = new DerivedTestBackend();
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'B1-actual-C', sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  const manifest = await stage.commit(); backend.reads = []; backend.derivedReads = [];
  return { backend, manifest, visuals: chunks.flatMap(c => projectNativeBuildingChunk(c).buildings) };
}
const full: ChunkBounds = [7000, 8000, 10000, 12000];
const near = (surface: Surface, extra = 0): ChunkBounds => {
  const points = surface.flatMap(s => s.outer);
  return [Math.min(...points.map(p => p.x)) - extra, Math.min(...points.map(p => p.y)) - extra,
    Math.max(...points.map(p => p.x)) + extra, Math.max(...points.map(p => p.y)) + extra];
};
const sum = (a: Uint32Array) => a.reduce((n, v) => n + v, 0);

it('streams every actual C accepted plan into complete overview, with source bindings and zero parent archive reads', async () => {
  const c = await city(), window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { overviewResolution: 16, limits: { maxTiles: 256 } });
  expect(window.overview.kind).toBe('accepted-plan-anchor-density-1');
  expect(window.overview.parentFingerprint).toBe(c.manifest.fingerprint);
  expect(sum(window.overview.counts)).toBe(6); expect(window.overview.buildings).toBe(6);
  expect(window.overview.counts.byteLength).toBe(16 * 16 * 4);
  expect(c.backend.derivedReads).toEqual([0, 1, 2, 0, 1, 2]); expect(c.backend.reads).toEqual([]);
  const result = await window.request(full);
  expect(result.complete).toBe(true); expect(result.buildings).toEqual(c.visuals);
  expect(result.parentFingerprint).toBe(c.manifest.fingerprint); expect(result.derivedFingerprint).toBe(window.overview.derivedFingerprint);
  expect(new Set(result.buildings.map(b => b.id)).size).toBe(6);
  for (const b of result.buildings) expect(Object.keys(b).filter(k => ['resolved', 'volumes', 'plan_archives', 'structural_features'].includes(k))).toEqual([]);
  expect(window.originBinding).toBe('unbound'); expect(c.backend.reads).toEqual([]); window.dispose();
});

it('keeps full overview when tiles, candidates, exact-record, chunk, byte or vertex budget caps detail; never picks false empty', async () => {
  for (const limits of [{ maxTiles: 1 }, { maxCandidates: 1 }, { maxBuildings: 1 }, { maxChunks: 1 }, { maxEncodedBytes: 1 }, { maxVertices: 1 }]) {
    const c = await city(), window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { overviewResolution: 8, limits: { maxTiles: 256, ...limits } });
    const result = await window.request(full);
    expect(result.complete, JSON.stringify(limits)).toBe(false); expect(window.pick({ x: 9000, y: 10000 })).toEqual({ status: 'pending' });
    expect(sum(window.overview.counts)).toBe(6); expect(window.stats.residentChunkCache).toBe(0);
    expect(window.stats.encodedBytes).toBeLessThanOrEqual(limits.maxEncodedBytes ?? 8 * 1024 * 1024);
    expect(window.stats.residentVertices).toBeLessThanOrEqual(limits.maxVertices ?? 200000);
    expect(c.backend.reads).toEqual([]); window.dispose();
  }
});

it('uses the renderer exact roof/hole picking predicate and original ordering; coarse aggregate never substitutes a hit', async () => {
  const c = await city(), window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { overviewResolution: 8, limits: { maxTiles: 256 } });
  const result = await window.request(full), renderer = new UrbanBuildingLodRenderer({ buildings: result.buildings, materials: result.materials });
  for (const b of result.buildings) for (const shape of b.roof_footprint) for (const p of shape.outer) {
    const picked = window.pick(p); expect(picked.status).toBe('exact');
    if (picked.status === 'exact') expect(picked.building?.id).toBe(renderer.pick(p)?.id);
  }
  expect(window.pick({ x: -1, y: -1 })).toEqual({ status: 'pending' });
  expect(window.pick({ x: 7001, y: 8001 })).toEqual({ status: 'exact' }); window.dispose();
});

it('offsets all exact child surfaces, ridges, entrance and overview consistently, retaining native source and IDs', async () => {
  const c = await city(), offset = { x: -20000.125, y: 456.75 };
  const window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { offset, overviewResolution: 8, limits: { maxTiles: 256 } });
  const world: ChunkBounds = [full[0] + offset.x, full[1] + offset.y, full[2] + offset.x, full[3] + offset.y];
  const result = await window.request(world);
  const expected = chunks.flatMap(c => translateColdProjection(projectNativeBuildingChunk(c), offset.x, offset.y).buildings);
  expect(result.complete).toBe(true); expect(result.buildings).toEqual(expected); expect(result.viewport).toEqual(world);
  expect(result.parentFingerprint).toBe(c.manifest.fingerprint); expect(c.backend.reads).toEqual([]);
  const plain = await buildColdOverview(await openDerivedCache(c.backend, c.manifest), { resolution: 8 });
  expect(window.overview.counts).toEqual(plain.counts);
  expect(window.overview.bounds).toEqual([plain.bounds[0] + offset.x, plain.bounds[1] + offset.y, plain.bounds[2] + offset.x, plain.bounds[3] + offset.y]); window.dispose();
});

it('retires exact selection and every old resident index across 100 pans; no hidden parsed sibling/native cache', async () => {
  const c = await city(), window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { overviewResolution: 8 });
  let largestRecords = 0, largestVertices = 0;
  for (let i = 0; i < 100; i++) {
    const b = c.visuals[i % c.visuals.length], result = await window.request(near(b.roof_footprint, 1));
    expect(result.complete).toBe(true); expect(window.selected(b.id)).toBe(result.buildings.find(v => v.id === b.id));
    largestRecords = Math.max(largestRecords, window.stats.residentBuildings); largestVertices = Math.max(largestVertices, window.stats.residentVertices);
    expect(window.stats).toMatchObject({ residentChunkCache: 0, activeReads: 0, queuedRequests: 0 });
    expect(window.stats.residentBuildings).toBe(result.buildings.length);
  }
  expect(largestRecords).toBeLessThanOrEqual(2); expect(largestVertices).toBeLessThanOrEqual(200000);
  const lastId = window.snapshot!.buildings[0].id;
  await window.request([0, 0, 1, 1]); expect(window.selected(lastId)).toBeUndefined(); expect(window.stats.residentBuildings).toBe(0);
  expect(c.backend.reads).toEqual([]); window.dispose(); expect(window.snapshot).toBeUndefined();
});

it('serializes IO, drops the stale active result and all but latest queued camera before decode/publication', async () => {
  const c = await city(), window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { overviewResolution: 8 });
  const original = c.backend.derived.chunk, entered = deferred(), release = deferred(); let reads = 0, live = 0, peak = 0;
  c.backend.derived.chunk = async (...args) => {
    live++; peak = Math.max(peak, live); try { if (++reads === 1) { entered.resolve(); await release.promise; } return await original(...args); } finally { live--; }
  };
  const a = window.request(near(c.visuals[0].roof_footprint)); const aRejected = expect(a).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise;
  const b = window.request(near(c.visuals[2].roof_footprint)); const bRejected = expect(b).rejects.toMatchObject({ name: 'AbortError' });
  const d = window.request(near(c.visuals[4].roof_footprint));
  expect(window.pick(c.visuals[0].entrance!)).toEqual({ status: 'pending' });
  expect(window.stats).toMatchObject({ activeReads: 1, queuedRequests: 1, residentBuildings: 0 }); release.resolve();
  await Promise.all([aRejected, bRejected]); const result = await d;
  expect(result.buildings.some(v => v.id === c.visuals[4].id)).toBe(true); expect(peak).toBe(1); expect(reads).toBe(2);
  expect(c.backend.reads).toEqual([]); window.dispose();
});

it('does not publish a read finishing after caller abort/dispose and leaves a complete overview available', async () => {
  for (const mode of ['abort', 'dispose']) {
    const c = await city(), window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { overviewResolution: 8 });
    const original = c.backend.derived.chunk, entered = deferred(), release = deferred();
    c.backend.derived.chunk = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
    const signal = new AbortController(), pending = window.request(near(c.visuals[0].roof_footprint), signal.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
    if (mode === 'abort') signal.abort(); else window.dispose(); release.resolve(); await rejected;
    expect(window.snapshot).toBeUndefined(); expect(window.stats.residentBuildings).toBe(0); expect(sum(window.overview.counts)).toBe(6);
    expect(c.backend.reads).toEqual([]); window.dispose();
  }
});

it('rejects missing/corrupt derivative and mismatched durable identities as pending failure, never native loss or a false empty city', async () => {
  for (const mode of ['missing', 'corrupt', 'index']) {
    const c = await city();
    if (mode === 'missing') { c.backend.caches.clear(); await expect(openColdVisualWindow(c.backend, c.manifest.sceneId)).rejects.toThrow(); }
    else {
      const window = await openColdVisualWindow(c.backend, c.manifest.sceneId, { overviewResolution: 8, limits: { maxTiles: 256 } });
      if (mode === 'corrupt') c.backend.caches.get(c.manifest.sceneId)!.chunks.get(0)!.json += ' ';
      else {
        const tile = c.backend.tile.bind(c.backend); c.backend.tile = async (...args) => {
          const r = await tile(...args); return { ...r, entries: r.entries.map(e => ({ ...e, id: `foreign/${e.id}` })) };
        };
      }
      await expect(window.request(full)).rejects.toThrow(); expect(window.snapshot).toBeUndefined();
      expect(window.pick({ x: 9000, y: 10000 })).toEqual({ status: 'pending' }); expect(sum(window.overview.counts)).toBe(6); window.dispose();
    }
    expect(c.backend.reads).toEqual([]); expect(await c.backend.manifest(c.manifest.sceneId)).toEqual(c.manifest);
  }
});

it('validates single-chunk indices and cancellation without reading native or any derivative payload', async () => {
  const c = await city(), reader = await openDerivedCache(c.backend, c.manifest), controller = new AbortController(); controller.abort();
  await expect(reader.chunk(-1)).rejects.toThrow('index'); await expect(reader.chunk(3)).rejects.toThrow('index');
  await expect(reader.chunk(0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(c.backend.reads).toEqual([]); expect(c.backend.derivedReads).toEqual([]);
});

it('keeps explicit holes and selects an overhanging roof from the adjacent durable tile without duplicate IDs (synthetic geometry operator test)', async () => {
  const backend = new DerivedTestBackend(), delta = structuredClone(chunks[0]);
  // Synthetic geometry/cache contract only, not a newly native-admitted house.
  const ring = (a: number, b: number, c: number, d: number) => [{ x: a, y: b }, { x: c, y: b }, { x: c, y: d }, { x: a, y: d }];
  const roof = [{ outer: ring(250, 0, 270, 20), holes: [ring(255, 5, 265, 15)] }];
  const building = { ...delta.buildings[0], footprint: roof, roof_footprint: roof, entrance: { x: 250, y: 10 } };
  delta.buildings = [building]; delta.refusals = []; delta.open_spaces = [];
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'B1-synthetic-hole', sourceFingerprint: fixture.cliSha256, totalRequests: 1 });
  await stage.append(delta, { start: 0, completed: 1, total: 1 }); const manifest = await stage.commit(); backend.reads = [];
  const window = await openColdVisualWindow(backend, manifest.sceneId, { overviewResolution: 8 });
  const result = await window.request([249, -1, 271, 21]); expect(result.complete).toBe(true); expect(result.buildings.map(b => b.id)).toEqual([building.id]);
  expect(window.pick({ x: 260, y: 10 })).toEqual({ status: 'exact' });
  expect(window.pick({ x: 268, y: 10 })).toMatchObject({ status: 'exact', building: { id: building.id } });
  const next = await window.request([266, 9, 269, 11]); expect(next.complete).toBe(true); expect(next.buildings[0].roof_footprint).toEqual(roof);
  expect(window.pick({ x: 268, y: 10 })).toMatchObject({ status: 'exact', building: { id: building.id } });
  expect(sum(window.overview.counts)).toBe(1); expect(backend.reads).toEqual([]); window.dispose();
});

it('consumer replaces renderer state and draws full-city density while capped/loading instead of a prefix of exact houses', async () => {
  const c = await city(), facade = await openColdWindowLod(c.backend, c.manifest.sceneId, { overviewResolution: 8, limits: { maxTiles: 1 } });
  let fills = 0;
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() { fills++; }, fillStyle: '' } as unknown as CanvasRenderingContext2D;
  const options = { viewport: { minX: full[0], minY: full[1], maxX: full[2], maxY: full[3] }, metresPerPixel: 10,
    appearance: { style: 'cartographic', diagnostic: 'none' } as const };
  const before = facade.draw(ctx, options); expect(before.coverage).toBe('complete-plan-density'); expect(fills).toBeGreaterThan(0);
  await facade.update(full); const after = facade.draw(ctx, options);
  expect(after.coverage).toBe('complete-plan-density'); expect(after.totalBuildings).toBe(6);
  expect(sum(facade.overview.counts)).toBe(6); expect(facade.pick({ x: 9000, y: 10000 })).toEqual({ status: 'pending' });
  expect(c.backend.reads).toEqual([]); facade.dispose(); expect(facade.stats.residentBuildings).toBe(0);
});

it('consumer publishes exact near selection, then evicts it on the next empty window (no global renderer map)', async () => {
  const c = await city(), facade = await openColdWindowLod(c.backend, c.manifest.sceneId, { overviewResolution: 8 });
  const b = c.visuals[0], result = await facade.update(near(b.roof_footprint));
  expect(result.complete).toBe(true); expect(facade.selected(b.id)).toBe(result.buildings[0]);
  const point = b.roof_footprint[0].outer[0]; expect(facade.pick(point)).toMatchObject({ status: 'exact', building: { id: b.id } });
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {},
    translate() {}, fillStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', strokeStyle: '' } as unknown as CanvasRenderingContext2D;
  const draw = (box: ChunkBounds) => facade.draw(ctx, { viewport: { minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] },
    metresPerPixel: 100, appearance: { style: 'silhouette', diagnostic: 'none' }, painted: false });
  const nativeDraw = draw(near(b.roof_footprint)); expect(nativeDraw.coverage).toBe('exact');
  if (nativeDraw.coverage === 'exact') expect(nativeDraw.metrics.totalBuildings).toBe(result.buildings.length);
  await facade.update([0, 0, 1, 1]); expect(facade.selected(b.id)).toBeUndefined();
  const emptyDraw = draw([0, 0, 1, 1]); expect(emptyDraw.coverage).toBe('exact');
  if (emptyDraw.coverage === 'exact') expect(emptyDraw.metrics.totalBuildings).toBe(0);
  expect(facade.stats).toMatchObject({ residentBuildings: 0, residentChunkCache: 0 }); facade.dispose();
});
