import { beforeAll, expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import siteFixture from './fixtures/urban-cold-sites-c.json';
import actualProgramme from './fixtures/derived-cache-actual-programme-report.json';
import type { PlacementBatch, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, exportUrbanBuildingChunks, importUrbanBuildingChunks } from '../src/ui/urbanBuildingChunkStore';
import { openColdCitySession, createColdProjectionAccumulator } from '../src/ui/urbanColdCitySession';
import { projectNativeBuildingChunk } from '../src/ui/urbanBuildingProjection';
import { projectUrbanSite, createNativeSiteStore, createUnboundSiteStore } from '../src/ui/urbanSiteStore';
import { beginDerivedWrite, openDerivedCache } from '../src/ui/urbanBuildingDerivedCache';
import { DerivedTestBackend } from './helpers/urbanDerivedTestBackend';
import { ColdTestBackend } from './helpers/urbanBuildingColdTestBackend';

let chunks: PlacementBatch[];
const requests = siteFixture.chunks.map(chunk => chunk.requests as unknown as PlacementRequest[]);
const siteChunks = () => requests.map((rs, index) => rs.map((r, i) => projectUrbanSite(r, fixture.chunks[index].progress.start + i)));
beforeAll(async () => { chunks = await Promise.all(fixture.chunks.map(chunk => archivePlanBatch(chunk.delta as unknown as PlacementBatch))); });
async function city(backend = new DerivedTestBackend(), withSites = true, id = 'derived-city') {
  const stage = await beginUrbanBuildingStage(backend, { sceneId: id, sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  const projection = createColdProjectionAccumulator(), sites = siteChunks();
  for (let i = 0; i < chunks.length; i++) { await stage.append(chunks[i], fixture.chunks[i].progress, withSites ? sites[i] : undefined); projection.append(projectNativeBuildingChunk(chunks[i])); }
  const manifest = await stage.commit();
  const state = { store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
    counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version, buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces }, cityKey: 'city' };
  return { backend, stage, manifest, state, projection: projection.scene, sites: sites.flat() };
}
async function exported(backend: ColdTestBackend, id: string) { const frames = []; for await (const bytes of exportUrbanBuildingChunks(backend, id)) frames.push(bytes); return frames; }

it('restores all six actual C visuals/refusals/sites without reading native archives; one selected detail still reads its exact context', async () => {
  const c = await city(), nativeBefore = await exported(c.backend, c.manifest.sceneId); c.backend.reads = [];
  const session = await openColdCitySession(c.backend, c.state);
  try {
    expect(session.stats).toMatchObject({ derivedStatus: 'hit', origins: 'complete', nativeCache: { chunks: 0 } });
    expect(c.backend.reads).toEqual([]); expect(c.backend.derivedReads).toEqual([0, 1, 2]);
    expect(session.projection).toEqual(c.projection); expect(session.siteVisuals).toEqual(c.sites); expect(session.originBinding).toBe('unbound');
    const selected = await session.read(chunks[1].buildings[0].id);
    expect(c.backend.reads).toEqual([1]); expect(selected!.building).toEqual(chunks[1].buildings[0]);
    expect(await resolveArchivedPlan(selected!.building, selected!.scene)).toEqual(await resolveArchivedPlan(chunks[1].buildings[0], chunks[1]));
    expect(await exported(c.backend, c.manifest.sceneId)).toEqual(nativeBefore);
  } finally { session.dispose(); }
});

it('indexes real site offsets across refusals and never treats cached metadata as a current native constraint capability', async () => {
  const c = await city(), session = await openColdCitySession(c.backend, c.state), id = chunks[1].buildings[0].id;
  try {
    const origin = await session.readOrigin(id); expect(origin).toMatchObject({ offset: 3, chunkIndex: 1, siteRecord: 0 });
    const raw = c.backend.stages.get(c.manifest.sceneId)!.entries.get(id)!; expect(raw.recordIndex).toBe(0); expect(origin!.offset).not.toBe(raw.recordIndex);
    const unbound = createUnboundSiteStore(session.siteVisuals!); expect(unbound.matchesRuntime({ profile: 'local', server: 'http://restarted-server' })).toBe(false);
    await expect(unbound.read(id)).rejects.toThrow('Origine native actuelle'); unbound.dispose();
    const reads: number[] = [], currentQuery = { source: { version: 1 as const, session: 'CURRENT-QUERY-ONLY', terrainRevision: 'current-t', layoutsRevision: 'current-l', partitionsRevision: 'current-p' }, seed: 'current' };
    const bound = createNativeSiteStore(c.sites, currentQuery, { profile: 'local', server: 'http://current-only' }, {
      originLookup: selected => session.readOrigin(selected), read: async (_q, _r, offset, expectedId) => { reads.push(offset); const r = requests.flat()[offset]; expect(r.id).toBe(expectedId); return r; } });
    expect(await bound.read(id)).toEqual(requests[1][0]); expect(reads).toEqual([3]); bound.dispose();
    const stored = JSON.stringify([...c.backend.caches.values()].map(cache => ({ manifest: cache.manifest, chunks: [...cache.chunks.values()] })));
    expect(stored).not.toContain('CURRENT-QUERY-ONLY'); expect(stored).not.toContain('http://current-only');
  } finally { session.dispose(); }
});

it('treats corrupted/missing/stale derivatives as misses and rebuilds serial native chunks without changing the parent', async () => {
  for (const fault of ['payload', 'missing', 'parent', 'version']) {
    const c = await city(), original = await exported(c.backend, c.manifest.sceneId), cache = c.backend.caches.get(c.manifest.sceneId)!;
    if (fault === 'payload') cache.chunks.get(1)!.json += ' ';
    if (fault === 'missing') cache.chunks.delete(1);
    if (fault === 'parent') cache.manifest!.parentFingerprint = '0'.repeat(64);
    if (fault === 'version') (cache.manifest! as { version: string }).version = 'future-cache';
    c.backend.reads = []; const session = await openColdCitySession(c.backend, c.state);
    expect(c.backend.reads).toEqual([0, 1, 2]); expect(session.projection).toEqual(c.projection);
    expect(session.stats).toMatchObject({ derivedStatus: 'rebuilt', origins: 'unknown' }); expect(await session.readOrigin(chunks[0].buildings[0].id)).toBeUndefined();
    session.dispose(); expect(await exported(c.backend, c.manifest.sceneId)).toEqual(original);
    c.backend.reads = []; const again = await openColdCitySession(c.backend, c.state); expect(c.backend.reads).toEqual([]); again.dispose();
  }
});

it('keeps native commit/restore valid through cache quota at begin, append and commit', async () => {
  for (const phase of ['begin', 'append', 'commit'] as const) {
    const backend = new DerivedTestBackend(); backend.derivedFail = phase; const c = await city(backend);
    expect(backend.activeId).toBe(c.manifest.sceneId); expect(backend.stages.get(c.manifest.sceneId)!.manifest).toEqual(c.manifest);
    const session = await openColdCitySession(backend, c.state); expect(session.projection).toEqual(c.projection);
    expect(session.stats.derivedStatus).toBe('rebuilt-uncached'); session.dispose();
  }
});

it('supports old backends/stores and keeps native import/export exact independently of derivatives', async () => {
  const c = await city(), bytes = await exported(c.backend, c.manifest.sceneId), old = new ColdTestBackend();
  // Import API receives exactly the native export, no sidecar/query/visual data.
  const imported = await importUrbanBuildingChunks(old, (async function* () { yield* bytes; })(), { sceneId: 'old-import' });
  const restored = await openColdCitySession(old, { ...c.state, store: { ...c.state.store, sceneId: imported.sceneId, fingerprint: imported.fingerprint } });
  expect(restored.projection).toEqual(c.projection); expect(restored.stats.origins).toBe('unknown'); restored.dispose();
  const copied = await exported(old, imported.sceneId);
  expect(copied.slice(1)).toEqual(bytes.slice(1));
  const first = (value: Uint8Array) => JSON.parse(new TextDecoder().decode(value));
  expect(first(copied[0])).toEqual({ ...first(bytes[0]), manifest: { ...first(bytes[0]).manifest, sceneId: imported.sceneId } });
  const current = new DerivedTestBackend();
  const cachedImport = await importUrbanBuildingChunks(current, (async function* () { yield* bytes; })(), { sceneId: 'cached-import' });
  current.reads = [];
  const cached = await openColdCitySession(current, { ...c.state, store: { ...c.state.store, sceneId: cachedImport.sceneId, fingerprint: cachedImport.fingerprint } });
  expect(current.reads).toEqual([]); expect(cached.projection).toEqual(c.projection); expect(cached.stats.origins).toBe('unknown'); cached.dispose();
});

it('preserves negative zero, exact world offsets and child aliasing in a cached visual', async () => {
  const c = await city(), cache = await openDerivedCache(c.backend, c.manifest), first = await cache.chunks().next(); expect(first.done).toBe(false);
  // Synthetic CODEC perturbation only, not a native/admission result. It never
  // rewrites the native archive; the other tests prove actual C geometry parity.
  const writer = await beginDerivedWrite(c.backend, c.manifest.sceneId, c.manifest.sourceFingerprint, 9);
  for (let i = 0; i < chunks.length; i++) {
    const scene = structuredClone(projectNativeBuildingChunk(chunks[i]));
    if (i === 0) scene.buildings[0].footprint[0].outer[0].x = -0;
    await writer!.append(scene, c.manifest.chunks[i], c.sites.slice(i * 3, i * 3 + 3));
  }
  await writer!.commit(c.manifest); const raw = await openColdCitySession(c.backend, c.state);
  expect(Object.is(raw.projection.buildings[0].footprint[0].outer[0].x, -0)).toBe(true); raw.dispose();
  const moved = await openColdCitySession(c.backend, { ...c.state, offset: { x: -321.25, y: 87.5 } });
  expect(moved.siteVisuals![0].surface[0].outer[0].x).toBe(c.sites[0].surface[0].outer[0].x - 321.25);
  const b = moved.projection.buildings[1]; expect(b.ground_constraints[0].footprint).toBe(b.footprint); moved.dispose();
});

it('rejects a corrupted origin index while a live original query can safely keep its known exact site offset', async () => {
  const c = await city(), session = await openColdCitySession(c.backend, c.state), id = chunks[1].buildings[0].id;
  c.backend.caches.get(c.manifest.sceneId)!.origins.get(id)!.offset = 0;
  await expect(session.readOrigin(id)).rejects.toThrow('association changed');
  const offsets: number[] = [];
  const bound = createNativeSiteStore(c.sites, { source: { version: 1, session: 'LIVE', terrainRevision: 't', layoutsRevision: 'l', partitionsRevision: 'p' }, seed: 'live' },
    { profile: 'local', server: 'http://live' }, { originLookup: selected => session.readOrigin(selected),
      read: async (_q, _r, offset) => { offsets.push(offset); return requests.flat()[offset]; } });
  expect(await bound.read(id)).toEqual(requests[1][0]); expect(offsets).toEqual([3]); bound.dispose(); session.dispose();
});

it('does not publish a derivative before native CAS or let a stale cache writer overwrite a replacement', async () => {
  const c = await city(), stage = await beginUrbanBuildingStage(c.backend, { sceneId: 'losing', sourceFingerprint: fixture.cliSha256, totalRequests: 9, expectedActive: 'wrong' });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress, c.sites.slice(i * 3, i * 3 + 3));
  await expect(stage.commit()).rejects.toThrow('Generation changed'); expect(c.backend.caches.get('losing')!.manifest).toBeUndefined(); await stage.abort();
  expect(c.backend.activeId).toBe(c.manifest.sceneId);
  const first = await beginDerivedWrite(c.backend, c.manifest.sceneId, c.manifest.sourceFingerprint, 9);
  await beginDerivedWrite(c.backend, c.manifest.sceneId, c.manifest.sourceFingerprint, 9);
  const newEpoch = c.backend.caches.get(c.manifest.sceneId)!.cacheId;
  await expect(first!.append(projectNativeBuildingChunk(chunks[0]), c.manifest.chunks[0], c.sites.slice(0, 3))).rejects.toThrow('generation changed');
  await first!.abort(); expect(c.backend.caches.get(c.manifest.sceneId)!.cacheId).toBe(newEpoch);
});

it('cancels cache restore without publishing partial cartography or mutating native storage', async () => {
  const c = await city(); let cancelled = false; const original = c.backend.derived.chunk;
  c.backend.derived.chunk = async (...args) => { const value = await original(...args); cancelled = true; return value; };
  await expect(openColdCitySession(c.backend, c.state, { cancelled: () => cancelled })).rejects.toMatchObject({ name: 'AbortError' });
  expect(c.backend.reads).toEqual([]); expect(c.backend.activeId).toBe(c.manifest.sceneId);
});

it('round-trips the actually compiled C1358 programme report, without substituting offline expected scalars or hosted capacity', async () => {
  const delta = await archivePlanBatch({ schema_version: '1', generator_version: actualProgramme.generator_version,
    buildings: [actualProgramme.building], refusals: [], open_spaces: [], materials: actualProgramme.materials } as unknown as PlacementBatch);
  const backend = new DerivedTestBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: 'real-report', sourceFingerprint: actualProgramme.source_sha256, totalRequests: 1 });
  await stage.append(delta, { start: 0, completed: 1, total: 1 }); const manifest = await stage.commit(); backend.reads = [];
  const session = await openColdCitySession(backend, { store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
    counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version, buildings: 1, refusals: 0, open_spaces: 0 }, cityKey: 'city' });
  expect(backend.reads).toEqual([]);
  expect(session.projection.buildings[0].programme_outcome).toEqual(actualProgramme.building.programme_outcome);
  expect(session.projection.buildings[0].programme_outcome!.households.housed).toBeNull();
  const selected = await session.read(delta.buildings[0].id); expect(selected!.building.programme_outcome).toEqual(actualProgramme.building.programme_outcome);
  session.dispose();
});
