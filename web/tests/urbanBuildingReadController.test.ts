import { beforeAll, expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, openUrbanBuildingChunks, type ChunkBounds } from '../src/ui/urbanBuildingChunkStore';
import { UrbanBuildingReadController, type NativeBuildingReader, type NativeBuildingReadError, type NativeBuildingViewSnapshot } from '../src/ui/urbanBuildingReadController';
import { ColdTestBackend, deferred } from './helpers/urbanBuildingColdTestBackend';

const raw = fixture.chunks.map(chunk => chunk.delta as unknown as PlacementBatch);
let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(raw.map(archivePlanBatch)); });
const limits = { maxTiles: 4096, maxCandidates: 1000, maxBuildings: 20, maxChunks: 3, maxBytes: 4 * 1024 * 1024 };
function extent(buildings: PlacementBatch['buildings']): ChunkBounds {
  const points = buildings.flatMap(b => [...b.footprint, ...b.roof_footprint].flatMap(shape => [...shape.outer, ...shape.holes.flat()]));
  return [Math.min(...points.map(p => p.x)) - 1, Math.min(...points.map(p => p.y)) - 1,
    Math.max(...points.map(p => p.x)) + 1, Math.max(...points.map(p => p.y)) + 1];
}
async function source(id: string, physical = { active: 0, max: 0 }) {
  const backend = new ColdTestBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: id, sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  await stage.commit();
  const actual = await openUrbanBuildingChunks(backend); let localActive = 0, clears = 0;
  const track = async <T>(fn: () => Promise<T>): Promise<T> => {
    localActive++; physical.active++; physical.max = Math.max(physical.max, physical.active);
    try { return await fn(); } finally { localActive--; physical.active--; }
  };
  const reader: NativeBuildingReader = { manifest: actual.manifest,
    readBuilding: id => track(() => actual.readBuilding(id)), pinBuilding: id => track(() => actual.pinBuilding(id)),
    readVisible: (bounds, limits) => track(() => actual.readVisible(bounds, limits)),
    clearCache() { expect(localActive).toBe(0); clears++; actual.clearCache(); },
  };
  return { backend, reader, actual, physical, get clears() { return clears; } };
}
function forbidNative(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(['resolved', 'plan_archives', 'volumes', 'roof_mesh', 'levels', 'parent'].includes(key)).toBe(false); forbidNative(child);
  }
}

it('publishes bounded lightweight native records and one independently resolvable selected building', async () => {
  const input = await source('city'), published: NativeBuildingViewSnapshot[] = [], errors: NativeBuildingReadError[] = [];
  const id = chunks[0].buildings[0].id;
  const controller = new UrbanBuildingReadController({ reader: input.reader, viewport: extent(chunks.flatMap(chunk => chunk.buildings)),
    limits: { ...limits, maxBuildings: 1 }, selectedId: id, onPublish: value => published.push(value), onError: error => errors.push(error) });
  await controller.whenIdle(); const snapshot = published[0];
  expect(errors).toEqual([]); expect(snapshot.scene.buildings).toHaveLength(1); expect(snapshot.read.truncated).toBe(true);
  expect(snapshot.totals).toEqual({ buildings: 6, refusals: 3, openSpaces: 0, totalRequests: 9 });
  expect(snapshot.scene.metrics.scope).toBe('provided-records'); forbidNative(snapshot.scene);
  expect(snapshot.read.encodedBytes).toBeLessThanOrEqual(limits.maxBytes); expect(input.physical.max).toBe(1);
  expect(snapshot.selection.state).toBe('ready');
  if (snapshot.selection.state !== 'ready') throw new Error('Selection missing');
  expect(snapshot.selection.value.scene.buildings).toHaveLength(1);
  expect(await resolveArchivedPlan(snapshot.selection.value.building, snapshot.selection.value.scene)).toEqual(raw[0].buildings[0].resolved);
  expect(input.actual.stats.pinnedChunk).toBe(0);
  controller.dispose(); expect(input.actual.stats.bytes).toBe(0); expect(controller.state.published).toBeUndefined();
});

it('coalesces a burst to the latest viewport/selection and discards a full read that becomes stale', async () => {
  const input = await source('burst'), published: NativeBuildingViewSnapshot[] = [], errors: NativeBuildingReadError[] = [];
  const blocked = { index: 0, started: deferred(), release: deferred() }; input.backend.block = blocked;
  const controller = new UrbanBuildingReadController({ reader: input.reader, viewport: extent(chunks[0].buildings), limits,
    onPublish: value => published.push(value), onError: error => errors.push(error) });
  await blocked.started.promise;
  const latest = extent(chunks[2].buildings), selected = chunks[2].buildings[1].id;
  controller.setViewport([0, 0, 1, 1]); controller.setViewport(latest); controller.select(selected);
  expect(controller.state.activeReads).toBe(1); expect(published).toEqual([]);
  blocked.release.resolve(); await controller.whenIdle();
  expect(errors).toEqual([]); expect(published).toHaveLength(1); expect(published[0].viewport).toEqual(latest);
  expect(published[0].selection).toMatchObject({ state: 'ready', id: selected }); expect(controller.state.discarded).toBe(1);
  expect(input.physical.max).toBe(1); expect(input.actual.stats.pinnedChunk).toBe(2);
  expect(input.backend.reads.filter(index => index === 1)).toEqual([]);
  forbidNative(published[0].scene); controller.dispose();
});

it('never publishes an obsolete generation, releases abandoned readers and preserves the previous scene until activation', async () => {
  const physical = { active: 0, max: 0 }, first = await source('first', physical), next = await source('obsolete', physical), latest = await source('latest', physical);
  const published: NativeBuildingViewSnapshot[] = [], blocked = { index: 0, started: deferred(), release: deferred() };
  const controller = new UrbanBuildingReadController({ reader: first.reader, viewport: extent(chunks[0].buildings), limits, onPublish: value => published.push(value) });
  await controller.whenIdle(); next.backend.block = blocked; controller.setGeneration(next.reader); await blocked.started.promise;
  expect(controller.state.published?.sceneId).toBe('first'); controller.setGeneration(latest.reader);
  blocked.release.resolve(); await controller.whenIdle();
  expect(published.map(value => value.sceneId)).toEqual(['first', 'latest']);
  expect(next.clears).toBe(1); expect(first.clears).toBe(1); expect(next.actual.stats.bytes).toBe(0);
  expect(physical.max).toBe(1); controller.dispose();
});

it('rolls back a failed candidate generation and keeps the old selected native page valid', async () => {
  const physical = { active: 0, max: 0 }, old = await source('old', physical), failed = await source('failed', physical);
  const published: NativeBuildingViewSnapshot[] = [], errors: NativeBuildingReadError[] = [], id = chunks[0].buildings[0].id;
  const controller = new UrbanBuildingReadController({ reader: old.reader, viewport: extent(chunks[0].buildings), limits, selectedId: id,
    onPublish: value => published.push(value), onError: value => errors.push(value) });
  await controller.whenIdle(); failed.backend.failRead = true; controller.setGeneration(failed.reader); await controller.whenIdle();
  expect(errors).toHaveLength(1); expect(errors[0]).toMatchObject({ rolledBack: true }); expect(errors[0].generation.startsWith('failed/')).toBe(true);
  expect(published.every(value => value.sceneId === 'old')).toBe(true); expect(controller.state.requestedGeneration?.startsWith('old/')).toBe(true);
  expect(controller.state.published?.selection).toMatchObject({ state: 'ready', id }); expect(old.actual.stats.pinnedChunk).toBe(0);
  expect(old.clears).toBe(0); expect(failed.clears).toBe(1); expect(physical.max).toBe(1); controller.dispose();
});

it('reports missing selection explicitly and reconciles pin ownership after selection changes during a read', async () => {
  const input = await source('selection'), published: NativeBuildingViewSnapshot[] = [];
  const controller = new UrbanBuildingReadController({ reader: input.reader, viewport: extent(chunks[0].buildings), limits,
    selectedId: chunks[0].buildings[0].id, onPublish: value => published.push(value) });
  await controller.whenIdle(); controller.select('absent'); await controller.whenIdle();
  expect(published.at(-1)?.selection).toEqual({ state: 'missing', id: 'absent' }); expect(input.actual.stats.pinnedChunk).toBeUndefined();
  const blocked = { index: 1, started: deferred(), release: deferred() }; input.backend.block = blocked;
  const stale = chunks[1].buildings[0].id, selected = chunks[2].buildings[0].id;
  controller.select(stale); await blocked.started.promise; controller.select(selected); blocked.release.resolve(); await controller.whenIdle();
  expect(published.at(-1)?.selection).toMatchObject({ state: 'ready', id: selected }); expect(input.actual.stats.pinnedChunk).toBe(2);
  expect(published.some(value => value.selection.state === 'ready' && value.selection.id === stale)).toBe(false);
  controller.select(); await controller.whenIdle(); expect(published.at(-1)?.selection).toEqual({ state: 'none' });
  expect(input.actual.stats.pinnedChunk).toBeUndefined(); expect(input.physical.max).toBe(1); controller.dispose();
});

it('drains a physical read on disposal without publication, premature cache clearing or concurrent work', async () => {
  const input = await source('disposed'), blocked = { index: 0, started: deferred(), release: deferred() }, published: NativeBuildingViewSnapshot[] = [];
  input.backend.block = blocked;
  const controller = new UrbanBuildingReadController({ reader: input.reader, viewport: extent(chunks[0].buildings), limits, onPublish: value => published.push(value) });
  await blocked.started.promise; controller.dispose(); expect(controller.state.activeReads).toBe(1); expect(input.clears).toBe(0);
  expect(() => controller.setViewport([0, 0, 1, 1])).toThrow('disposed');
  blocked.release.resolve(); await controller.whenIdle(); expect(published).toEqual([]); expect(input.clears).toBe(1);
  expect(input.actual.stats.bytes).toBe(0); expect(controller.state.activeReads).toBe(0); expect(controller.state.loading).toBe(false);
});

it('keeps the previous valid frame on read errors and rejects invalid viewport/limits before queuing work', async () => {
  const input = await source('errors'), errors: NativeBuildingReadError[] = [], published: NativeBuildingViewSnapshot[] = [];
  const controller = new UrbanBuildingReadController({ reader: input.reader, viewport: extent(chunks[0].buildings), limits,
    onPublish: value => published.push(value), onError: value => errors.push(value) });
  await controller.whenIdle(); const old = controller.state.published;
  expect(() => controller.setViewport([1, 0, 0, 1])).toThrow('viewport'); expect(controller.state.published).toBe(old);
  input.backend.failRead = true; controller.setViewport(extent(chunks[2].buildings)); await controller.whenIdle();
  expect(errors).toHaveLength(1); expect(errors[0].rolledBack).toBe(false); expect(controller.state.published).toBe(old);
  expect(() => new UrbanBuildingReadController({ reader: input.reader, viewport: [0, 0, 1, 1], limits: { ...limits, maxBytes: 0 }, onPublish() {} })).toThrow('limits');
  expect(published).toHaveLength(1); controller.dispose();
});

it('deduplicates unchanged camera/selection updates from host paint callbacks and retries only explicitly', async () => {
  const input = await source('stable'), published: NativeBuildingViewSnapshot[] = [], bounds = extent(chunks[0].buildings);
  const controller = new UrbanBuildingReadController({ reader: input.reader, viewport: bounds, limits, onPublish: value => {
    published.push(value); controller.setViewport([...value.viewport]); controller.select();
  } });
  await controller.whenIdle(); expect(published).toHaveLength(1);
  controller.setViewport([...bounds]); await controller.whenIdle(); expect(published).toHaveLength(1);
  controller.refresh(); await controller.whenIdle(); expect(published).toHaveLength(2); expect(input.physical.max).toBe(1);
  controller.dispose();
});

it('publishes a truncated empty projection when the viewport byte budget cannot admit any chunk', async () => {
  const input = await source('budget'), published: NativeBuildingViewSnapshot[] = [];
  const controller = new UrbanBuildingReadController({ reader: input.reader, viewport: extent(chunks.flatMap(chunk => chunk.buildings)),
    limits: { ...limits, maxBytes: 1 }, onPublish: value => published.push(value) });
  await controller.whenIdle(); expect(published).toHaveLength(1);
  expect(published[0].scene.buildings).toEqual([]); expect(published[0].read).toMatchObject({ truncated: true, encodedBytes: 0, chunkIndices: [] });
  expect(published[0].totals.buildings).toBe(6); expect(input.backend.reads).toEqual([]);
  expect(input.actual.stats.bytes).toBe(0); controller.dispose();
});
