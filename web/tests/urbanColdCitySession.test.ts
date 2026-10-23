import { beforeAll, expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { beginUrbanBuildingStage, iterateUrbanBuildingChunks } from '../src/ui/urbanBuildingChunkStore';
import { projectNativeBuildingChunk } from '../src/ui/urbanBuildingProjection';
import { createColdProjectionAccumulator, openColdCitySession, type ColdCityState } from '../src/ui/urbanColdCitySession';
import { coldCityFingerprint } from '../src/ui/urbanColdCityFingerprint';
import { ColdTestBackend, deferred } from './helpers/urbanBuildingColdTestBackend';

let chunks: PlacementBatch[];
beforeAll(async () => { chunks = await Promise.all(fixture.chunks.map(chunk => archivePlanBatch(chunk.delta as unknown as PlacementBatch))); });
async function city() {
  const backend = new ColdTestBackend(), stage = await beginUrbanBuildingStage(backend, { sceneId: 'session', sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  const projection = createColdProjectionAccumulator();
  for (let i = 0; i < chunks.length; i++) { await stage.append(chunks[i], fixture.chunks[i].progress); projection.append(projectNativeBuildingChunk(chunks[i])); }
  const manifest = await stage.commit();
  const state: ColdCityState = { store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
    counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version, buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces }, cityKey: 'city' };
  return { backend, state, projection: projection.scene };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

it('restores complete actual cartography one native chunk at a time and reads one real selected context', async () => {
  const { backend, state } = await city(), session = await openColdCitySession(backend, state);
  try {
    expect(backend.reads).toEqual([0, 1, 2]); expect(session.projection.buildings).toHaveLength(6);
    expect(session.projection.metrics).toMatchObject({ buildings: 6, refusals: 3 });
    for (const visual of session.projection.buildings) { expect('resolved' in visual).toBe(false); expect('volumes' in visual).toBe(false); }
    expect(session.stats.nativeCache.chunks).toBe(0);
    const selected = await session.read(session.projection.buildings[0].id, 'selection');
    expect(selected!.scene.buildings).toEqual([selected!.building]); expect(selected!.building).toEqual(chunks[0].buildings[0]);
    expect(await resolveArchivedPlan(selected!.building, selected!.scene)).toEqual(await resolveArchivedPlan(chunks[0].buildings[0], chunks[0]));
  } finally { session.dispose(); await flush(); }
});

it('translates visual/occupation/ground and selected world geometry while preserving the exact local archive', async () => {
  const { backend, state, projection } = await city(), offset = { x: -321.25, y: 87.5 };
  const session = await openColdCitySession(backend, { ...state, offset }, { projection });
  try {
    const old = projection.buildings[0], moved = session.projection.buildings[0];
    expect(moved.footprint[0].outer[0]).toEqual({ x: old.footprint[0].outer[0].x + offset.x, y: old.footprint[0].outer[0].y + offset.y });
    expect(moved.ground_constraints[0].footprint).toBe(moved.footprint);
    expect(moved.ground_constraints[0].height_m).toBe(old.ground_constraints[0].height_m);
    const selected = await session.read(old.id), native = chunks[0].buildings[0];
    expect(selected!.building.transform.origin).toEqual({ x: native.transform.origin.x + offset.x, y: native.transform.origin.y + offset.y });
    expect(selected!.building.footprint).toEqual(moved.footprint);
    expect(await resolveArchivedPlan(selected!.building, selected!.scene)).toEqual(await resolveArchivedPlan(native, chunks[0]));
    expect(projection.buildings[0]).toBe(old); expect(state).not.toHaveProperty('offset');
  } finally { session.dispose(); await flush(); }
});

it('serializes physical native reads and keeps only the latest pending selection', async () => {
  const { backend, state, projection } = await city(), session = await openColdCitySession(backend, state, { projection });
  const gate = { index: 0, started: deferred(), release: deferred() }; backend.block = gate;
  try {
    const first = session.read(chunks[0].buildings[0].id); await gate.started.promise;
    const stale = session.read(chunks[1].buildings[0].id, 'selection'), staleCheck = expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    const latest = session.read(chunks[2].buildings[0].id, 'selection');
    await staleCheck; expect(session.stats).toMatchObject({ activeReads: 1, queuedReads: 1 }); expect(backend.reads).toEqual([0]);
    gate.release.resolve(); await first; expect((await latest)!.building.id).toBe(chunks[2].buildings[0].id); await flush();
    expect(backend.reads).toEqual([0, 2]); expect(session.stats.activeReads).toBe(0);
  } finally { gate.release.resolve(); session.dispose(); await flush(); }
});

it('disposes queued reads immediately, drains the active read and clears its cache afterwards', async () => {
  const { backend, state, projection } = await city(), session = await openColdCitySession(backend, state, { projection });
  const gate = { index: 0, started: deferred(), release: deferred() }; backend.block = gate;
  const active = session.read(chunks[0].buildings[0].id), activeCheck = expect(active).rejects.toMatchObject({ name: 'AbortError' }); await gate.started.promise;
  const queued = session.read(chunks[2].buildings[0].id, 'selection'), queuedCheck = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  session.dispose(); await queuedCheck; expect(session.stats.activeReads).toBe(1);
  gate.release.resolve(); await activeCheck; await flush();
  expect(backend.reads).toEqual([0]); expect(session.stats).toMatchObject({ activeReads: 0, queuedReads: 0, nativeCache: { chunks: 0 } });
});

it('does not let the panel selection supersede the inspector read for the same click', async () => {
  const { backend, state, projection } = await city(), session = await openColdCitySession(backend, state, { projection });
  const gate = { index: 0, started: deferred(), release: deferred() }; backend.block = gate;
  try {
    const detail = session.read(chunks[0].buildings[0].id); await gate.started.promise;
    const inspector = session.read(chunks[1].buildings[0].id, 'inspector');
    const panel = session.read(chunks[1].buildings[0].id, 'selection');
    expect(session.stats.queuedReads).toBe(2); gate.release.resolve();
    await detail; expect((await inspector)!.building.id).toBe(chunks[1].buildings[0].id);
    expect((await panel)!.building.id).toBe(chunks[1].buildings[0].id); await flush();
    expect(backend.reads).toEqual([0, 1]);
  } finally { gate.release.resolve(); session.dispose(); await flush(); }
});

it('rejects changed counts and corrupted native traversal without replacing the committed generation', async () => {
  const { backend, state, projection } = await city();
  await expect(openColdCitySession(backend, { ...state, counts: { ...state.counts, buildings: 99 } }, { projection })).rejects.toThrow('identity or counts');
  backend.stages.get('session')!.chunks[0].json += ' ';
  const read = async () => { for await (const _chunk of iterateUrbanBuildingChunks(backend, 'session')) throw new Error('Corrupt chunk must not be yielded'); };
  await expect(read()).rejects.toThrow(); expect(backend.activeId).toBe('session');
});

it('fingerprints actual terrain/geometry settings independently of object identity and changes for a modified terrain sample', async () => {
  const raster = { width: 40, n: 2, height: new Float32Array([1, 2, 3, 4]), water: new Uint8Array(4), waterLevel: new Float32Array(4), riverWidth: new Float32Array(4), riverIds: new Int32Array(4) };
  const input = { layouts: [], partitions: [], raster, seed: 'source', settings: { parcel_fit: true } };
  const first = await coldCityFingerprint(input); expect(await coldCityFingerprint(structuredClone(input))).toBe(first);
  raster.height[0] += .25; expect(await coldCityFingerprint(input)).not.toBe(first);
  const waterOnly = { ...input, raster: { ...raster, geometry: { land: [], water: [[[{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 4 }]]] } } };
  expect(await coldCityFingerprint(waterOnly)).not.toBe(await coldCityFingerprint(input));
});
