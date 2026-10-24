import { beforeAll, expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, exportUrbanBuildingChunks, type BuildingChunkBackend, type ChunkBounds } from '../src/ui/urbanBuildingChunkStore';
import { openDerivedCache } from '../src/ui/urbanBuildingDerivedCache';
import { repairColdDerivedCache } from '../src/ui/urbanColdDerivedRepair';
import { projectNativeBuildingChunk } from '../src/ui/urbanBuildingProjection';
import { openColdCityViewport } from '../src/ui/urbanColdCityViewport';
import { createColdViewportSlot } from '../src/ui/urbanColdViewportSlot';
import { OverviewTestBackend } from './helpers/urbanOverviewTestBackend';
import { deferred } from './helpers/urbanBuildingColdTestBackend';
import { SvgOverviewRaster } from './helpers/urbanSvgOverviewRaster';

let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(fixture.chunks.map(c => archivePlanBatch(c.delta as unknown as PlacementBatch))); });
async function city(nativeOnly = true) {
  const backend = new OverviewTestBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: 'repair-C', sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  const m = await stage.commit(); if (nativeOnly) backend.caches.clear(); backend.reads = []; backend.derivedReads = [];
  return { backend, state: { store: { format: m.format, sceneId: m.sceneId, fingerprint: m.fingerprint, sourceFingerprint: m.sourceFingerprint },
    counts: { schema_version: m.schema_version, generator_version: m.generator_version, buildings: m.buildings, refusals: m.refusals, open_spaces: m.openSpaces } } };
}
const opts = { resolution: 64, rasterFactory: (p: number) => new SvgOverviewRaster(p), yieldControl: async () => {},
  decodeContour: async (p: { pixels: number }) => ({ source: {} as CanvasImageSource, width: p.pixels, height: p.pixels, close() {} }) };
async function settle(view: Awaited<ReturnType<typeof openColdCityViewport>>) {
  if (['ready', 'failed'].includes(view.stats.overviewStatus)) return;
  await new Promise<void>(resolve => { const off = view.subscribe(() => { if (['ready', 'failed'].includes(view.stats.overviewStatus)) { off(); resolve(); } }); });
}
async function frames(backend: BuildingChunkBackend, id: string) { const result = []; for await (const b of exportUrbanBuildingChunks(backend, id)) result.push(b); return result; }
const whole: ChunkBounds = [7000, 8000, 10000, 12000];
it('migrates an actual native-only store through A2 serial child writes; exact source fields/export bytes survive and near2D becomes available', async () => {
  const c = await city(), before = await frames(c.backend, c.state.store.sceneId); c.backend.reads = [];
  await expect(openColdCityViewport(c.backend, c.state, opts)).rejects.toThrow('derived cache');
  const progress: { completed: number; chunks: number }[] = [];
  let active = 0, maxActive = 0; const read = c.backend.chunk.bind(c.backend);
  c.backend.chunk = async (...args) => { active++; maxActive = Math.max(maxActive, active); try { return await read(...args); } finally { active--; } };
  const report = await repairColdDerivedCache(c.backend, c.state, { yieldControl: async () => {}, progress: p => progress.push({ completed: p.completed, chunks: p.chunks }) });
  expect(c.backend.reads).toEqual([0, 1, 2]); expect(maxActive).toBe(1); expect(report).toMatchObject({ chunks: 3, maxRetainedNativeChunks: 1, maxParsedRecords: 3, origins: 'unknown' });
  expect(progress.at(-1)).toEqual({ completed: 9, chunks: 3 });
  const reader = await openDerivedCache(c.backend, (await c.backend.manifest(c.state.store.sceneId))!); let i = 0;
  for await (const child of reader.chunks()) expect(child.projection).toEqual(projectNativeBuildingChunk(chunks[i++]));
  c.backend.reads = [];
  const view = await openColdCityViewport(c.backend, c.state, { ...opts, limits: { maxTiles: 256 } });
  expect((await view.update(whole)).buildings).toHaveLength(6); await settle(view); expect(view.stats.overviewStatus).toBe('ready');
  expect(c.backend.reads).toEqual([]); expect(view.originBinding).toBe('unbound'); view.dispose();
  expect(await frames(c.backend, c.state.store.sceneId)).toEqual(before);
});
it('repairs corrupt existing derived data by recomputing only authenticated A2 children, never native architecture', async () => {
  const c = await city(false), cache = c.backend.caches.get(c.state.store.sceneId)!; cache.chunks.get(1)!.json += ' ';
  const before = await frames(c.backend, c.state.store.sceneId); c.backend.reads = [];
  await repairColdDerivedCache(c.backend, c.state, { yieldControl: async () => {} });
  expect(c.backend.reads).toEqual([0, 1, 2]); const reader = await openDerivedCache(c.backend, (await c.backend.manifest(c.state.store.sceneId))!);
  expect((await reader.chunk(1)).projection).toEqual(projectNativeBuildingChunk(chunks[1]));
  expect(await frames(c.backend, c.state.store.sceneId)).toEqual(before);
});
it('reports unsupported/quota at begin/append/commit without touching native bytes, and retry reopens a readable derived store', async () => {
  for (const failure of ['begin', 'append', 'commit'] as const) {
    const c = await city(), before = await frames(c.backend, c.state.store.sceneId); c.backend.derivedFail = failure;
    await expect(repairColdDerivedCache(c.backend, c.state, { yieldControl: async () => {} })).rejects.toThrow('Cache quota');
    expect(await frames(c.backend, c.state.store.sceneId)).toEqual(before); c.backend.derivedFail = undefined;
    await repairColdDerivedCache(c.backend, c.state, { yieldControl: async () => {} });
    expect((await openDerivedCache(c.backend, (await c.backend.manifest(c.state.store.sceneId))!)).manifest.buildings).toBe(6);
  }
  const c = await city(); (c.backend as BuildingChunkBackend).derived = undefined;
  await expect(repairColdDerivedCache(c.backend, c.state)).rejects.toThrow('Stockage dérivé indisponible'); expect(c.backend.reads).toEqual([]);
});
it('cancels a blocked native read before parsing/append or fetching the next parent; no partial cache publication or archive change', async () => {
  const c = await city(), before = await frames(c.backend, c.state.store.sceneId); c.backend.reads = [];
  const entered = deferred(), release = deferred(), abort = new AbortController(); c.backend.block = { index: 0, started: entered, release };
  const progress: unknown[] = [], job = repairColdDerivedCache(c.backend, c.state, { signal: abort.signal, progress: p => progress.push(p) });
  const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise; abort.abort(); release.resolve(); await rejected;
  expect(c.backend.reads).toEqual([0]); expect(progress).toEqual([]); expect(c.backend.caches.get(c.state.store.sceneId)?.manifest).toBeUndefined();
  expect(await frames(c.backend, c.state.store.sceneId)).toEqual(before);
});
it('stops on source replacement or a parent-chunk budget rather than continuing a hidden full-city repair', async () => {
  const c = await city(); let current = true;
  await expect(repairColdDerivedCache(c.backend, c.state, { current: () => current, yieldControl: async () => {},
    progress: p => { if (p.phase === 'persisting') current = false; } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(c.backend.reads).toEqual([0]); expect(c.backend.caches.get(c.state.store.sceneId)?.manifest).toBeUndefined();
  const other = await city(); await expect(repairColdDerivedCache(other.backend, other.state, { maxNativeChunkBytes: 1 })).rejects.toThrow('budget');
  expect(other.backend.reads).toEqual([]);
});
it('real viewport slot aborts and drains a replaced blocked open before starting the latest import; obsolete source never reads children', async () => {
  const c = await city(false), entered = deferred(), release = deferred(), manifest = c.backend.manifest.bind(c.backend); let first = true;
  c.backend.manifest = async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return manifest(...args); };
  const signals: AbortSignal[] = [], slot = createColdViewportSlot((s: typeof c.state & { offset?: { x: number; y: number } }) => JSON.stringify(s),
    async (state, signal) => { signals.push(signal); return openColdCityViewport(c.backend, state, { ...opts, signal }); });
  const old = slot.ensure(c.state), rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
  const latest = slot.ensure({ ...c.state, offset: { x: 50, y: 0 } }); expect(signals[0].aborted).toBe(true); expect(signals).toHaveLength(1);
  release.resolve(); await rejected; const view = await latest; expect(signals).toHaveLength(2); expect(view.state.offset!.x).toBe(50);
  expect(signals[1].aborted).toBe(false); await settle(view); slot.clear(); expect(c.backend.reads).toEqual([]);
});
it('reuses a completed view without aborting its open signal; queued obsolete openings never start', async () => {
  const entered = deferred(), release = deferred(), signals = new Map<string, AbortSignal>(), closed: string[] = [];
  const slot = createColdViewportSlot((key: string) => key, async (key, signal) => { signals.set(key, signal);
    if (key === 'blocked') { entered.resolve(); await release.promise; }
    signal.throwIfAborted(); return { key, dispose() { closed.push(key); } }; });
  const a = await slot.ensure('A'); const b = slot.ensure('blocked'), bRejected = expect(b).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
  const queued = slot.ensure('never-started'), qRejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  expect(await slot.ensure('A')).toBe(a); expect(signals.get('A')!.aborted).toBe(false); expect(signals.get('blocked')!.aborted).toBe(true);
  release.resolve(); await Promise.all([bRejected, qRejected]); expect(signals.has('never-started')).toBe(false); expect(closed).toEqual([]); slot.clear(); expect(closed).toEqual(['A']);
});
it('point refinement restores the same camera window/detailed demand and keeps one authenticated selected base under the existing budgets', async () => {
  const c = await city(false), view = await openColdCityViewport(c.backend, c.state, { ...opts, limits: { maxTiles: 256, maxCandidates: 1 } }); await settle(view);
  // Force a capped broad frame, then refine a point. Raise no search/operator budget.
  await view.update(whole); const p = chunks[2].buildings[0].roof_footprint[0].outer[0];
  expect(view.pick(p).status).toBe('pending');
  const result = await view.pickAt(p); expect(result).toMatchObject({ status: 'exact', building: { id: chunks[2].buildings[0].id } });
  expect(view.snapshot!.viewport).toEqual(whole); expect(view.selected(chunks[2].buildings[0].id)).toBe(result.status === 'exact' ? result.building : undefined);
  view.ensureViewport(whole); expect(view.snapshot!.viewport).toEqual(whole);
  let strokes = 0;
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, drawImage() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() { strokes++; },
    strokeStyle: '', lineWidth: 1, lineJoin: '' } as unknown as CanvasRenderingContext2D;
  const frame = view.draw(ctx, { viewport: { minX: whole[0], minY: whole[1], maxX: whole[2], maxY: whole[3] }, metresPerPixel: .25,
    appearance: { style: 'cartographic', diagnostic: 'none' }, painted: false, selectedId: chunks[2].buildings[0].id }, true);
  expect(frame.coverage).toBe('complete-native-contours'); expect(strokes).toBe(1); expect(view.snapshot!.viewport).toEqual(whole);
  expect(view.selected(chunks[2].buildings[0].id)).toBe(result.status === 'exact' ? result.building : undefined);
  expect(view.stats.residentBuildings).toBeLessThanOrEqual(2048); expect(view.stats.encodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  view.dispose();
});
