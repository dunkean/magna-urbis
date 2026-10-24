import { beforeAll, expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import siteFixture from './fixtures/urban-cold-sites-c.json';
import type { PlacementBatch, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, exportUrbanBuildingChunks, importUrbanBuildingChunks, type ChunkBounds } from '../src/ui/urbanBuildingChunkStore';
import { openColdCityViewport, type ColdCityViewport } from '../src/ui/urbanColdCityViewport';
import { createColdStreamWindow } from '../src/ui/urbanColdStreamWindow';
import { projectNativeBuildingChunk } from '../src/ui/urbanBuildingProjection';
import { createUrbanBuildingPanelState } from '../src/ui/urbanBuildingsPanel';
import { createNativeSiteStore, createUnboundSiteStore, projectUrbanSite } from '../src/ui/urbanSiteStore';
import { SvgOverviewRaster } from './helpers/urbanSvgOverviewRaster';
import { OverviewTestBackend } from './helpers/urbanOverviewTestBackend';
import { deferred } from './helpers/urbanBuildingColdTestBackend';

let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(fixture.chunks.map(c => archivePlanBatch(c.delta as unknown as PlacementBatch))); });
async function city() {
  const backend = new OverviewTestBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: 'B4-C', sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  const sites = siteFixture.chunks.map((c, index) => c.requests.map((r, i) => projectUrbanSite(r as unknown as PlacementRequest, fixture.chunks[index].progress.start + i)));
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress, sites[i]);
  const m = await stage.commit(); backend.reads = [];
  return { backend, sites: sites.flat(), state: { store: { format: m.format, sceneId: m.sceneId, fingerprint: m.fingerprint, sourceFingerprint: m.sourceFingerprint },
    counts: { schema_version: m.schema_version, generator_version: m.generator_version, buildings: m.buildings, refusals: m.refusals, open_spaces: m.openSpaces } } };
}
const rasterFactory = (pixels: number) => new SvgOverviewRaster(pixels);
const decodeContour = async (p: { pixels: number }) => ({ source: {} as CanvasImageSource, width: p.pixels, height: p.pixels, close() {} });
const options = { resolution: 64, rasterFactory, decodeContour, yieldControl: async () => {} };
const ctx = () => ({ save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {},
  translate() {}, drawImage() {}, arc() {}, fillStyle: '', strokeStyle: '', lineCap: '', lineJoin: '', lineWidth: 1 } as unknown as CanvasRenderingContext2D);
const near = (index: number): ChunkBounds => { const points = chunks[Math.floor(index / 2)].buildings[index % 2].roof_footprint.flatMap(s => s.outer);
  return [Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y))]; };
const draw = (v: ColdCityViewport, box: ChunkBounds) => v.draw(ctx(), { viewport: { minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] },
  metresPerPixel: 10, appearance: { style: 'cartographic', diagnostic: 'none' }, painted: false });
async function settled(view: ColdCityViewport) {
  if (['ready', 'failed'].includes(view.stats.overviewStatus)) return;
  await new Promise<void>(resolve => { const off = view.subscribe(() => { if (['ready', 'failed'].includes(view.stats.overviewStatus)) { off(); resolve(); } }); });
}
it('opens metadata and real near picking while the first global overview read remains blocked (no98second blank gate)', async () => {
  const c = await city(), original = c.backend.derived.chunk, entered = deferred(), release = deferred(); let first = true;
  c.backend.derived.chunk = async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return original(...args); };
  const view = await openColdCityViewport(c.backend, c.state, options); await entered.promise;
  expect(view.stats.overviewStatus).not.toBe('ready'); expect(view.totals).toEqual({ buildings: 6, refusals: 3, openSpaces: 0 });
  const close = await view.update(near(2)); expect(close.complete).toBe(true); expect(draw(view, near(2)).coverage).toBe('exact');
  const point = chunks[1].buildings[0].roof_footprint[0].outer[0]; expect(view.pick(point)).toMatchObject({ status: 'exact', building: { id: chunks[1].buildings[0].id } });
  expect(view.statusText).toContain('partielle'); expect(c.backend.reads).toEqual([]);
  release.resolve(); await settled(view); expect(view.stats.overviewStatus).toBe('ready'); expect(view.totals.buildings).toBe(6); view.dispose();
});
it('labels capped ink partial before rebuild and complete native contours afterwards; point refinement never concludes false empty', async () => {
  const c = await city(), original = c.backend.derived.chunk, entered = deferred(), release = deferred(); let first = true;
  c.backend.derived.chunk = async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return original(...args); };
  const view = await openColdCityViewport(c.backend, c.state, { ...options, limits: { maxTiles: 256, maxBuildings: 1 } }); await entered.promise;
  const box: ChunkBounds = [7000, 8000, 10000, 12000]; expect((await view.update(box)).complete).toBe(false);
  const initial = draw(view, box); expect(initial.complete).toBe(false); expect(initial.coverage).toBe('partial-native-contours');
  const point = chunks[2].buildings[0].roof_footprint[0].outer[0]; expect(view.pick(point).status).toBe('pending');
  expect(await view.pickAt(point)).toMatchObject({ status: 'exact', building: { id: chunks[2].buildings[0].id } });
  release.resolve(); await settled(view); expect(draw(view, box)).toMatchObject({ complete: true, coverage: 'complete-native-contours' });
  expect(view.stats.residentBuildings).toBeLessThanOrEqual(1); expect(c.backend.reads).toEqual([]); view.dispose();
});
it('warms restored architectural cache without a global child scan and uses manifest totals throughout100pans', async () => {
  const c = await city(), first = await openColdCityViewport(c.backend, c.state, options); await settled(first); first.dispose(); c.backend.derivedReads = [];
  const view = await openColdCityViewport(c.backend, c.state, options); await settled(view);
  expect(view.stats.cacheStatus).toBe('hit'); expect(c.backend.derivedReads).toEqual([]);
  for (let i = 0; i < 100; i++) { await view.update(near(i % 6)); expect(view.totals.buildings).toBe(6); expect(view.stats.residentBuildings).toBeLessThanOrEqual(2); }
  expect(c.backend.reads).toEqual([]); view.dispose(); expect(view.stats.residentBuildings).toBe(0);
});
it('actual selected-building panel reads one exact archived context by ID without constructing a full session or granting editing', async () => {
  const c = await city(), view = await openColdCityViewport(c.backend, c.state, options);
  const panel = createUrbanBuildingPanelState({ seed: 'B4', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, cold: c.state },
    { readColdBuilding: (_state, id) => view.read(id, 'selection') });
  const actual = chunks[1].buildings[0]; panel.select(actual.id); await panel.whenSelectionIdle(); expect(panel.selection.status).toBe('ready');
  let opened = false; await panel.openSelected(async (b, scene) => { opened = true; expect(b).toEqual(actual);
    expect(await resolveArchivedPlan(b, scene!)).toEqual(await resolveArchivedPlan(actual, chunks[1])); });
  expect(opened).toBe(true); expect(c.backend.reads).toEqual([1]); expect(view.originBinding).toBe('unbound');
  await settled(view); view.dispose();
});
it('preserves exact native exports/imports/snapshot fields while viewport cache and explicit inspection change only disposable children', async () => {
  const c = await city(); async function bytes() { const chunks = []; for await (const b of exportUrbanBuildingChunks(c.backend, c.state.store.sceneId)) chunks.push(b); return chunks; }
  const before = await bytes(), snapshot = JSON.stringify(c.state), view = await openColdCityViewport(c.backend, c.state, options); await settled(view);
  await view.read(chunks[0].buildings[0].id); view.dispose(); expect(await bytes()).toEqual(before); expect(JSON.stringify(c.state)).toBe(snapshot);
  const imported = new OverviewTestBackend(); async function* frames() { for (const b of before) yield b; }
  const restored = await importUrbanBuildingChunks(imported, frames(), { sceneId: 'B4-import' });
  expect(restored.fingerprint).toBe(c.state.store.fingerprint); expect(restored.buildings).toBe(6);
});
it('keeps real fresh-site query editing capability separate from cached unbound metadata; no retainSites:false shortcut', async () => {
  const c = await city(), view = await openColdCityViewport(c.backend, c.state, options), id = chunks[1].buildings[0].id;
  const unbound = createUnboundSiteStore(c.sites); expect(unbound.matchesRuntime({ profile: 'local', server: 'http://old' })).toBe(false);
  await expect(unbound.read(id)).rejects.toThrow('Origine native actuelle');
  const query = { source: { version: 1 as const, session: 'CURRENT-SERVER-INCARNATION', terrainRevision: 't', layoutsRevision: 'l', partitionsRevision: 'p' }, seed: 'B4' };
  let reads = 0; const live = createNativeSiteStore(c.sites, query, { profile: 'local', server: 'http://current' }, { originLookup: value => view.readOrigin(value),
    read: async (_q, _r, offset, expected) => { reads++; const request = siteFixture.chunks.flatMap(c => c.requests)[offset] as unknown as PlacementRequest; expect(request.id).toBe(expected); return request; } });
  expect((await live.read(id)).id).toBe(id); expect(reads).toBe(1); expect(live.matchesRuntime({ profile: 'local', server: 'http://current' })).toBe(true);
  live.dispose(); unbound.dispose(); await settled(view); view.dispose();
});
it('drains bounded native reads but rejects stale inspector bases and ignores overview publication after disposal', async () => {
  const c = await city(), view = await openColdCityViewport(c.backend, c.state, options); await view.update(near(0));
  const base = view.selected(chunks[0].buildings[0].id)!; const started = deferred(), release = deferred(); c.backend.block = { index: 0, started, release };
  const read = view.read(base.id, 'inspector', base), rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' }); await started.promise;
  await view.update(near(2)); release.resolve(); await rejected; await settled(view); view.dispose();
  expect(view.stats.nativeReads.chunks).toBe(0); expect(view.stats.residentBuildings).toBe(0);
});
it('captures immutable offset/state and serves original native inspection in that same world frame', async () => {
  const c = await city(), offset = { x: -100.25, y: 300.125 }, state = { ...c.state, offset };
  const view = await openColdCityViewport(c.backend, state, options); offset.x = 999;
  const box = near(0), shifted: ChunkBounds = [box[0] - 100.25, box[1] + 300.125, box[2] - 100.25, box[3] + 300.125];
  expect((await view.update(shifted)).complete).toBe(true); const actual = chunks[0].buildings[0];
  const read = await view.read(actual.id); expect(read!.building.entrance.x).toBe(actual.entrance.x - 100.25); expect(view.state.offset!.x).toBe(-100.25);
  await settled(view); view.dispose();
});
it('worker stream preview bounds resident geometry/materials and camera replacement without masquerading as completed city', () => {
  const window = createColdStreamWindow(), box: ChunkBounds = [7000, 8000, 10000, 12000];
  for (const native of chunks) window.append(projectNativeBuildingChunk(native), box);
  expect(window.stats.records).toBe(6); expect(window.stats.complete).toBe(false); expect(window.stats.encodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  const cleared = window.append(projectNativeBuildingChunk(chunks[2]), [0, 0, 1, 1]); expect(cleared.buildings).toHaveLength(0); expect(window.stats.records).toBe(0);
  const source = projectNativeBuildingChunk(chunks[0]);
  for (let i = 0; i < 5000; i += 64) window.append({ ...source, buildings: Array.from({ length: Math.min(64, 5000 - i) }, (_, j) => ({ ...source.buildings[0], id: `display-only-${i + j}` })) }, box);
  expect(window.stats.records).toBeGreaterThan(0); expect(window.stats.records).toBeLessThan(5000); expect(window.stats.records).toBeLessThanOrEqual(2048);
  expect(window.stats.vertices).toBeLessThanOrEqual(200000); expect(window.stats.encodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
});

it('latest camera wins while pending frames use the current world clip over a complete georeferenced overview, never the old camera background', async () => {
  const c = await city(), view = await openColdCityViewport(c.backend, c.state, options); await settled(view); c.backend.derivedReads = [];
  const original = c.backend.derived.chunk, entered = deferred(), release = deferred(); let first = true;
  c.backend.derived.chunk = async (...args) => { if (first) { first = false; entered.resolve(); await release.promise; } return original(...args); };
  view.ensureViewport(near(0)); await entered.promise; view.ensureViewport(near(2)); view.ensureViewport(near(4));
  const target = near(4), rects: unknown[][] = [], images: unknown[][] = [], sink = ctx();
  sink.rect = (...args: number[]) => { rects.push(args); }; sink.drawImage = ((...args: unknown[]) => { images.push(args); }) as typeof sink.drawImage;
  const pending = view.draw(sink, { viewport: { minX: target[0], minY: target[1], maxX: target[2], maxY: target[3] }, metresPerPixel: 10,
    appearance: { style: 'cartographic', diagnostic: 'none' }, painted: false });
  expect(pending.coverage).toBe('complete-native-contours'); expect(rects).toContainEqual([target[0], target[1], target[2] - target[0], target[3] - target[1]]);
  expect(images).toHaveLength(1); expect(view.pick(chunks[0].buildings[0].roof_footprint[0].outer[0]).status).toBe('pending');
  const ready = new Promise<void>(resolve => { const off = view.subscribe(() => { if (view.selected(chunks[2].buildings[0].id)) { off(); resolve(); } }); });
  release.resolve(); await ready; expect(c.backend.derivedReads).toEqual([0, 2]); expect(c.backend.reads).toEqual([]); view.dispose();
});

it('overview failures and quota never block exact near display or publish a false complete/empty city', async () => {
  for (const mode of ['factory', 'quota']) {
    const c = await city(); if (mode === 'quota') c.backend.failOverview = 'commit';
    const view = await openColdCityViewport(c.backend, c.state, { ...options, rasterFactory: mode === 'factory' ? () => { throw new Error('Raster unavailable'); } : rasterFactory });
    await view.update(near(0)); expect(draw(view, near(0)).coverage).toBe('exact'); await settled(view);
    expect(view.stats.overviewStatus).toBe(mode === 'factory' ? 'failed' : 'ready');
    expect(view.totals.buildings).toBe(6); expect(c.backend.reads).toEqual([]); view.dispose();
  }
});

it('rebuilds and authenticates true-painter diagnostic/Render variants instead of silently substituting density or the wrong default style', async () => {
  const c = await city(), view = await openColdCityViewport(c.backend, c.state, options); await settled(view);
  const box: ChunkBounds = [7000, 8000, 10000, 12000];
  for (const variant of [{ diagnostic: 'uses' as const, painted: false }, { diagnostic: 'height' as const, painted: false },
    { diagnostic: 'access' as const, painted: false }, { diagnostic: 'none' as const, painted: true }]) {
    const args = { viewport: { minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] }, metresPerPixel: 10,
      appearance: { style: 'cartographic' as const, diagnostic: variant.diagnostic }, painted: variant.painted };
    const pending = view.draw(ctx(), args); expect(pending.complete).toBe(false); await settled(view);
    expect(view.stats.overviewStatus).toBe('ready'); expect(view.draw(ctx(), args).coverage).toBe('complete-native-contours');
  }
  expect(c.backend.overviews.size).toBe(5); expect(c.backend.reads).toEqual([]); view.dispose();
});
