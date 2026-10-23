import { beforeAll, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import {
  beginUrbanBuildingStage, exportUrbanBuildingChunks, importUrbanBuildingChunks, openUrbanBuildingChunks,
  type BuildingChunkBackend, type BuildingChunkIndex, type BuildingChunkManifest, type StoredBuildingChunk,
} from '../src/ui/urbanBuildingChunkStore';
import { createIndexedDbBuildingChunkBackend } from '../src/ui/urbanBuildingChunkIndexedDb';

/** Atomic in-memory backend models the contract, not IndexedDB/browser behavior. */
class MemoryBackend implements BuildingChunkBackend {
  stages = new Map<string, { chunks: StoredBuildingChunk[]; entries: Map<string, BuildingChunkIndex>; manifest?: BuildingChunkManifest }>();
  activeId: string | null = null;
  failAppend = false; failCommit = false; reads: number[] = [];
  pauseAppend?: Promise<void>;
  async begin(id: string) { if (this.stages.has(id)) throw new Error('Duplicate stage.'); this.stages.set(id, { chunks: [], entries: new Map() }); }
  async append(id: string, chunk: StoredBuildingChunk, entries: BuildingChunkIndex[]) {
    await this.pauseAppend;
    if (this.failAppend) throw new Error('QuotaExceededError');
    const stage = this.stages.get(id)!;
    if (stage.manifest || chunk.index !== stage.chunks.length) throw new Error('Invalid stage sequence.');
    const ids = new Set<string>();
    for (const entry of entries) { if (ids.has(entry.id) || stage.entries.has(entry.id)) throw new Error('Duplicate building.'); ids.add(entry.id); }
    // Validation finishes before changing either table, matching a DB transaction.
    stage.chunks.push(structuredClone(chunk)); for (const entry of entries) stage.entries.set(entry.id, structuredClone(entry));
  }
  async commit(manifest: BuildingChunkManifest, expected: string | null) {
    if (this.failCommit) throw new Error('Commit failed.');
    const stage = this.stages.get(manifest.sceneId)!;
    if (this.activeId !== expected || stage.manifest || stage.chunks.length !== manifest.chunks.length) throw new Error('Active generation changed.');
    stage.manifest = structuredClone(manifest); this.activeId = manifest.sceneId;
  }
  async active() { return this.activeId ? this.manifest(this.activeId) : undefined; }
  async manifest(id: string) { const value = this.stages.get(id)?.manifest; return value && structuredClone(value); }
  async chunk(id: string, index: number) { this.reads.push(index); const value = this.stages.get(id)?.chunks[index]; return value && structuredClone(value); }
  async building(id: string, building: string) { const value = this.stages.get(id)?.entries.get(building); return value && structuredClone(value); }
  async tile(id: string, tile: string, limit: number) {
    const values = [...this.stages.get(id)!.entries.values()].filter(entry => entry.tiles.includes(tile));
    return { entries: structuredClone(values.slice(0, limit)), truncated: values.length > limit };
  }
  async discard(id: string) { if (this.stages.get(id)?.manifest) throw new Error('Committed stage.'); this.stages.delete(id); }
}
const sourceFingerprint = fixture.cliSha256;
const raw = fixture.chunks.map(chunk => chunk.delta as unknown as PlacementBatch);
let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(raw.map(archivePlanBatch)); });
async function staged(backend: MemoryBackend, id: string) {
  const stage = await beginUrbanBuildingStage(backend, { sceneId: id, sourceFingerprint, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  return stage;
}
async function committed(backend: MemoryBackend, id = 'city') { const stage = await staged(backend, id); return stage.commit(); }
async function collect(source: AsyncIterable<Uint8Array>) { const result: Uint8Array[] = []; for await (const part of source) result.push(part); return result; }
async function* stream(parts: Uint8Array[]) { for (const part of parts) yield part; }
const limits = { maxTiles: 4096, maxCandidates: 1000, maxBuildings: 20, maxChunks: 3, maxBytes: 4 * 1024 * 1024 };
function extent(backend: MemoryBackend, id: string): [number, number, number, number] {
  const entries = [...backend.stages.get(id)!.entries.values()];
  return [Math.min(...entries.map(e => e.bounds[0])), Math.min(...entries.map(e => e.bounds[1])),
    Math.max(...entries.map(e => e.bounds[2])), Math.max(...entries.map(e => e.bounds[3]))];
}

it('stages exact real C archived chunks before ACK and switches the active scene only on complete commit', async () => {
  const backend = new MemoryBackend(); await committed(backend, 'old');
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'next', sourceFingerprint, totalRequests: 9 });
  let release!: () => void; backend.pauseAppend = new Promise<void>(resolve => { release = resolve; });
  let acknowledged = false;
  const appending = stage.append(chunks[0], fixture.chunks[0].progress).then(() => { acknowledged = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(acknowledged).toBe(false); expect(stage.progress.completed).toBe(0); expect((await backend.active())?.sceneId).toBe('old');
  release(); await appending; backend.pauseAppend = undefined;
  expect(acknowledged).toBe(true); expect(stage.progress.completed).toBe(3);
  await expect(stage.commit()).rejects.toThrow('Incomplete');
  for (let i = 1; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress);
  expect(await backend.manifest('next')).toBeUndefined();
  const manifest = await stage.commit(); expect((await backend.active())?.sceneId).toBe('next');
  expect(manifest).toMatchObject({ buildings: 6, refusals: 3, openSpaces: 0, totalRequests: 9 });
  expect(backend.stages.get('next')!.chunks).toHaveLength(3);
  const reader = await openUrbanBuildingChunks(backend);
  for (let i = 0; i < chunks.length; i++) {
    const loaded = (await reader.readBuilding(chunks[i].buildings[0].id))!;
    expect(loaded.building).toEqual(chunks[i].buildings[0]);
    expect(loaded.scene.buildings).toEqual([loaded.building]); expect(loaded.scene.materials).toEqual(chunks[i].materials);
    expect(Object.keys(loaded.scene.plan_archives!)).toHaveLength(1);
    expect(await resolveArchivedPlan(loaded.building, loaded.scene)).toEqual(raw[i].buildings[0].resolved);
    expect(() => { loaded.building.footprint[0].outer[0].x += 1; }).toThrow();
  }
});

it('evicts and rereads exact contexts while a selected chunk stays pinned under both cache budgets', async () => {
  const backend = new MemoryBackend(), manifest = await committed(backend);
  const budget = [...manifest.chunks].sort((a, b) => b.bytes - a.bytes).slice(0, 2).reduce((n, c) => n + c.bytes, 0);
  const reader = await openUrbanBuildingChunks(backend, 'city', { maxCachedChunks: 2, maxCacheBytes: budget });
  const selected = await reader.pinBuilding(chunks[0].buildings[0].id);
  await reader.readBuilding(chunks[1].buildings[0].id); await reader.readBuilding(chunks[2].buildings[0].id);
  expect(reader.stats.indices).toEqual([0, 2]); expect(reader.stats.bytes).toBeLessThanOrEqual(budget);
  expect(await reader.readBuilding(chunks[0].buildings[0].id)).toEqual(selected); expect(backend.reads).toEqual([0, 1, 2]);
  await reader.readBuilding(chunks[1].buildings[0].id); expect(backend.reads).toEqual([0, 1, 2, 1]);
  expect(reader.stats.indices).toEqual([0, 1]);
  expect(await reader.readBuilding('absent')).toBeUndefined();
  const tiny = await openUrbanBuildingChunks(backend, 'city', { maxCachedChunks: 1, maxCacheBytes: 1 });
  await expect(tiny.pinBuilding(chunks[0].buildings[0].id)).rejects.toThrow('budget');
  const priorReads = backend.reads.length;
  await expect(tiny.readBuilding(chunks[0].buildings[0].id)).rejects.toThrow('budget');
  expect(backend.reads).toHaveLength(priorReads); expect(tiny.stats.bytes).toBe(0);
  const oversizedVisible = await tiny.readVisible(extent(backend, 'city'), limits);
  expect(oversizedVisible.buildings).toEqual([]); expect(oversizedVisible.truncated).toBe(true);
});

it('bounds spatial reads, deduplicates tile intersections and loads a page once even when it cannot enter the pinned cache', async () => {
  const backend = new MemoryBackend(); await committed(backend);
  const entries = [...backend.stages.get('city')!.entries.values()];
  // Model a straddling index record without changing any retained geometry.
  const entry = entries[0]; entry.tiles.push(...entries[1].tiles.filter(tile => !entry.tiles.includes(tile)));
  const tileRead = vi.spyOn(backend, 'tile');
  const reader = await openUrbanBuildingChunks(backend, 'city', { maxCachedChunks: 1 });
  await reader.pinBuilding(chunks[0].buildings[0].id); backend.reads = [];
  const result = await reader.readVisible(extent(backend, 'city'), limits);
  expect(result.truncated).toBe(false); expect(result.buildings).toHaveLength(6);
  expect(new Set(result.buildings.map(read => read.building.id)).size).toBe(6);
  expect(backend.reads).toEqual([1, 2]); expect(result.chunkIndices).toEqual([0, 1, 2]);
  expect(reader.stats.indices).toEqual([0]);
  const capped = await reader.readVisible(extent(backend, 'city'), { ...limits, maxChunks: 1 });
  expect(capped.truncated).toBe(true); expect(capped.chunkIndices).toHaveLength(1); expect(capped.buildings).toHaveLength(2);
  const bytes = await reader.readVisible(extent(backend, 'city'), { ...limits, maxBytes: 1 });
  expect(bytes.buildings).toEqual([]); expect(bytes.truncated).toBe(true);
  const candidates = await reader.readVisible(extent(backend, 'city'), { ...limits, maxCandidates: 1 });
  expect(candidates.candidatesRead).toBeLessThanOrEqual(1); expect(candidates.truncated).toBe(true);
  const tiles = await reader.readVisible(extent(backend, 'city'), { ...limits, maxTiles: 1 });
  expect(tiles.truncated).toBe(true);
  tileRead.mockClear();
  await reader.readVisible(extent(backend, 'city'), { ...limits, maxTiles: 2 }); expect(tileRead).toHaveBeenCalledTimes(2);
  await expect(reader.readVisible(extent(backend, 'city'), {} as typeof limits)).rejects.toThrow('budgets');
});

it('rejects overlapping append/read calls before starting more hashing or storage work', async () => {
  const backend = new MemoryBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: 'serial', sourceFingerprint, totalRequests: 3 });
  const work = stage.append(chunks[0], { start: 0, completed: 3, total: 3 });
  await expect(stage.append(chunks[0], { start: 0, completed: 3, total: 3 })).rejects.toThrow('busy');
  await work; await stage.commit();
  const reader = await openUrbanBuildingChunks(backend), first = reader.readBuilding(chunks[0].buildings[0].id);
  await expect(reader.readBuilding(chunks[0].buildings[1].id)).rejects.toThrow('already active'); await first;
});

it('indexes real structural features and supports the native empty metadata chunk without fabricating a building', async () => {
  const backend = new MemoryBackend(); await committed(backend);
  for (let i = 0; i < chunks.length; i++) {
    const building = chunks[i].buildings[1], entry = (await backend.building('city', building.id))!;
    expect(building.structural_features.length).toBeGreaterThan(0);
    for (const feature of building.structural_features) for (const point of [...feature.surface.flatMap(shape => [...shape.outer, ...shape.holes.flat()]), ...feature.vertices3d]) {
      expect(point.x).toBeGreaterThanOrEqual(entry.bounds[0]); expect(point.x).toBeLessThanOrEqual(entry.bounds[2]);
      expect(point.y).toBeGreaterThanOrEqual(entry.bounds[1]); expect(point.y).toBeLessThanOrEqual(entry.bounds[3]);
    }
  }
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'empty', sourceFingerprint, totalRequests: 0 });
  await expect(stage.commit()).rejects.toThrow('Incomplete');
  await stage.append({ ...chunks[0], buildings: [], refusals: [], open_spaces: [], plan_archives: {} }, { start: 0, completed: 0, total: 0 });
  const manifest = await stage.commit(); expect(manifest.buildings).toBe(0); expect(manifest.chunks).toHaveLength(1);
  expect(manifest.generator_version).toBe(chunks[0].generator_version);
  const target = new MemoryBackend(); await importUrbanBuildingChunks(target, exportUrbanBuildingChunks(backend, 'empty'), { sceneId: 'empty-cold' });
  expect((await target.active())?.fingerprint).toBe(manifest.fingerprint);
});

it('streams every exact chunk and restores a cold independent scene across arbitrary UTF-8 boundaries', async () => {
  const backend = new MemoryBackend(), original = await committed(backend);
  const parts = await collect(exportUrbanBuildingChunks(backend, 'city'));
  expect(parts).toHaveLength(5);
  const target = new MemoryBackend();
  async function* fragmented() { for (const part of parts) for (let offset = 0; offset < part.length; offset += 31) yield part.subarray(offset, offset + 31); }
  const imported = await importUrbanBuildingChunks(target, fragmented(), { sceneId: 'import' });
  expect(imported.fingerprint).toBe(original.fingerprint); expect(imported.chunks).toEqual(original.chunks);
  expect(target.stages.get('import')!.chunks).toEqual(backend.stages.get('city')!.chunks);
  const reader = await openUrbanBuildingChunks(target);
  const loaded = (await reader.readBuilding(chunks[2].buildings[1].id))!;
  expect(await resolveArchivedPlan(loaded.building, loaded.scene)).toEqual(raw[2].buildings[1].resolved);
});

it('preserves signed zero and exact IEEE doubles through storage and streaming without changing the source', async () => {
  const delta = structuredClone(chunks[0]); delta.buildings[0].ground_z_m = -0;
  delta.buildings[0].entrance.x = 5.5600000000000005;
  const backend = new MemoryBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: 'zero', sourceFingerprint, totalRequests: 3 });
  await stage.append(delta, { start: 0, completed: 3, total: 3 }); await stage.commit();
  const target = new MemoryBackend(); await importUrbanBuildingChunks(target, exportUrbanBuildingChunks(backend, 'zero'), { sceneId: 'zero-import' });
  const reader = await openUrbanBuildingChunks(target), loaded = (await reader.readBuilding(delta.buildings[0].id))!;
  expect(Object.is(loaded.building.ground_z_m, -0)).toBe(true); expect(loaded.building).toEqual(delta.buildings[0]);
  expect(loaded.scene.buildings).toEqual([delta.buildings[0]]);
  expect(Object.is(delta.buildings[0].ground_z_m, -0)).toBe(true);
});

it('rejects quota, failed commit, stale generations, duplicate IDs, missing archives and invalid prefixes without publishing', async () => {
  const backend = new MemoryBackend(); await committed(backend, 'old');
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'quota', sourceFingerprint, totalRequests: 3 }); backend.failAppend = true;
  await expect(stage.append(chunks[0], { start: 0, completed: 3, total: 3 })).rejects.toThrow('Quota');
  expect(stage.progress.completed).toBe(0); await expect(stage.commit()).rejects.toThrow(); await stage.abort(); backend.failAppend = false;
  const next = await staged(backend, 'commit-fail'); backend.failCommit = true; await expect(next.commit()).rejects.toThrow('Commit failed'); backend.failCommit = false;
  expect((await backend.active())?.sceneId).toBe('old'); await next.abort();
  const stale = await staged(backend, 'stale'); await committed(backend, 'newer'); await expect(stale.commit()).rejects.toThrow('generation');
  expect((await backend.active())?.sceneId).toBe('newer');
  const duplicate = await beginUrbanBuildingStage(backend, { sceneId: 'duplicate', sourceFingerprint, totalRequests: 6 });
  await duplicate.append(chunks[0], { start: 0, completed: 3, total: 6 });
  await expect(duplicate.append(chunks[0], { start: 3, completed: 6, total: 6 })).rejects.toThrow('Duplicate');
  expect(backend.stages.get('duplicate')!.chunks).toHaveLength(1);
  const missing = await beginUrbanBuildingStage(backend, { sceneId: 'missing', sourceFingerprint, totalRequests: 3 });
  await expect(missing.append({ ...chunks[0], plan_archives: {} }, { start: 0, completed: 3, total: 3 })).rejects.toThrow('Missing');
  const invalid = await beginUrbanBuildingStage(backend, { sceneId: 'invalid', sourceFingerprint, totalRequests: 9 });
  await expect(invalid.append(chunks[0], { start: 3, completed: 6, total: 9 })).rejects.toThrow('Noncontiguous');
  const unarchived = await beginUrbanBuildingStage(backend, { sceneId: 'unarchived', sourceFingerprint, totalRequests: 3 });
  await expect(unarchived.append(raw[0], { start: 0, completed: 3, total: 3 })).rejects.toThrow('already archived');
  const wrongCompletion = await staged(backend, 'wrong-completion');
  await expect(wrongCompletion.commit({ completion: { schema_version: '1', generator_version: chunks[0].generator_version,
    buildings: 5, refusals: 3, open_spaces: 0 } })).rejects.toThrow('completion');
  expect((await backend.active())?.sceneId).toBe('newer');
});

it('leaves the old scene active on corrupt, truncated, trailing, reordered and commit-failed imports', async () => {
  const source = new MemoryBackend(); await committed(source);
  const parts = await collect(exportUrbanBuildingChunks(source, 'city'));
  const target = new MemoryBackend(); await committed(target, 'old');
  const bad = structuredClone(parts), frame = JSON.parse(new TextDecoder().decode(bad[1]));
  frame.chunk.json = frame.chunk.json.replace('domestic', 'mixed'); bad[1] = new TextEncoder().encode(JSON.stringify(frame) + '\n');
  const variants = [bad, parts.slice(0, -1), [...parts, parts[0]], [parts[0], parts[2], parts[1], ...parts.slice(3)]];
  for (let i = 0; i < variants.length; i++) {
    await expect(importUrbanBuildingChunks(target, stream(variants[i]), { sceneId: `bad-${i}` })).rejects.toThrow();
    expect((await target.active())?.sceneId).toBe('old'); expect(target.stages.has(`bad-${i}`)).toBe(false);
  }
  target.failCommit = true;
  await expect(importUrbanBuildingChunks(target, stream(parts), { sceneId: 'failed-commit' })).rejects.toThrow('Commit failed');
  expect((await target.active())?.sceneId).toBe('old'); expect(target.stages.has('failed-commit')).toBe(false);
});

it('checks payload integrity again on cache miss and exposes unsupported IndexedDB explicitly', async () => {
  const backend = new MemoryBackend(); await committed(backend);
  const reader = await openUrbanBuildingChunks(backend);
  backend.stages.get('city')!.chunks[0].json += ' ';
  await expect(reader.readBuilding(chunks[0].buildings[0].id)).rejects.toThrow('integrity');
  expect(reader.stats.chunks).toBe(0);
  expect(typeof indexedDB).toBe('undefined'); await expect(createIndexedDbBuildingChunkBackend()).rejects.toThrow('unavailable');
  vi.restoreAllMocks();
});
