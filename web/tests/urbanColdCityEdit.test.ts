import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import siteFixture from './fixtures/urban-cold-sites-c.json';
import type { PlacementBatch, PlacementBatchRequest, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, isArchivedPlan, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, iterateUrbanBuildingChunkRecords, iterateUrbanBuildingChunks, openUrbanBuildingChunks, type BuildingChunkManifest } from '../src/ui/urbanBuildingChunkStore';
import { openColdCitySession, type ColdCityState } from '../src/ui/urbanColdCitySession';
import { coldArchitectureEditBounds, editColdCityBuilding } from '../src/ui/urbanColdCityEdit';
import { ColdTestBackend, deferred } from './helpers/urbanBuildingColdTestBackend';

const native = vi.hoisted(() => ({ generate: vi.fn(async () => { throw new Error('Unexpected real generator path in CPU tests'); }) }));
vi.mock('../../rust/bridge/architecture', () => ({ planUrbanBuildings: native.generate }));
const raw = fixture.chunks.map(chunk => chunk.delta as unknown as PlacementBatch);
const site = siteFixture.chunks[0].requests[0] as unknown as PlacementRequest;
let chunks: PlacementBatch[], approved: PlacementBatch;
beforeAll(async () => {
  chunks = await Promise.all(raw.map(archivePlanBatch));
  const replacement = structuredClone(raw[0].buildings[0]); replacement.diagnostics.push('CPU edit response fixture');
  // Admission is injected. These are real C geometry/opaque plans, not a claim
  // that a native process accepted a new pose or that its capacity was realized.
  approved = await archivePlanBatch({ ...raw[0], buildings: [replacement], refusals: [], open_spaces: [] });
});
afterEach(() => { expect(native.generate).not.toHaveBeenCalled(); vi.restoreAllMocks(); });
function descriptor(manifest: BuildingChunkManifest): ColdCityState {
  return { store: { format: manifest.format, sceneId: manifest.sceneId, fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
    counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version, buildings: manifest.buildings,
      refusals: manifest.refusals, open_spaces: manifest.openSpaces }, cityKey: 'C' };
}
async function commit(backend: ColdTestBackend, id: string, values = chunks) {
  const stage = await beginUrbanBuildingStage(backend, { sceneId: id, sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < values.length; i++) await stage.append(values[i], fixture.chunks[i].progress); return stage.commit();
}
async function setup(values = chunks) {
  const backend = new ColdTestBackend(), manifest = await commit(backend, 'old', values), state = descriptor(manifest);
  const session = await openColdCitySession(backend, state);
  const original = structuredClone(site), edited = structuredClone(original), generate = vi.fn(async (_input: PlacementBatchRequest) => structuredClone(approved));
  return { backend, manifest, state, session, original, edited, generate, sourceFingerprint: 'b'.repeat(64) };
}
async function records(backend: ColdTestBackend, id: string) {
  const result = []; for await (const record of iterateUrbanBuildingChunkRecords(backend, id)) result.push(record); return result;
}

it('replaces one native record/archive in order and copies every other authenticated stored payload exactly', async () => {
  const input = await setup(), old = structuredClone(input.backend.stages.get('old')!.chunks), oldGraph = JSON.stringify(input.session.projection);
  const original = JSON.stringify(input.original), edited = JSON.stringify(input.edited), beforeState = structuredClone(input.state);
  const result = await editColdCityBuilding(input); expect(result.applied).toBe(true);
  if (!result.applied) throw new Error(result.message);
  expect(input.generate).toHaveBeenCalledTimes(1); expect(input.generate.mock.calls[0][0].requests).toHaveLength(1);
  expect(input.generate.mock.calls[0][0].requests[0].id).toBe(site.id);
  expect(result.state.cityKey).toBe('C'); expect(result.state.counts).toEqual(input.state.counts); expect(result.state.store.sceneId).not.toBe('old');
  expect(result.state.store.sourceFingerprint).toBe(input.sourceFingerprint);
  expect(result.replacement.buildings.map(b => b.id)).toEqual([site.id]);
  expect(result.replacement.metrics).toMatchObject({ buildings: 1, refusals: 0, openSpaces: 0 });
  expect(result.replacement.buildings[0].footprint).toEqual(raw[0].buildings[0].footprint);
  for (const forbidden of ['resolved', 'plan_archives', 'volumes', 'structural_features', 'parentPlacementBatch', 'meshes', 'levels']) {
    expect(Object.hasOwn(result.replacement, forbidden)).toBe(false); expect(Object.hasOwn(result.replacement.buildings[0], forbidden)).toBe(false);
  }
  const nextStored = input.backend.stages.get(result.state.store.sceneId)!.chunks;
  expect(nextStored[1]).toEqual(old[1]); expect(nextStored[2]).toEqual(old[2]); expect(nextStored[0].sha256).not.toBe(old[0].sha256);
  const next = await records(input.backend, result.state.store.sceneId);
  expect(next.flatMap(r => r.delta.buildings.map(b => b.id))).toEqual(chunks.flatMap(chunk => chunk.buildings.map(b => b.id)));
  expect(next[0].delta.buildings[1]).toEqual(chunks[0].buildings[1]); expect(next[0].delta.refusals).toEqual(chunks[0].refusals);
  expect(next[0].delta.buildings[0].diagnostics).toContain('CPU edit response fixture');
  const beforeRef = chunks[0].buildings[0].resolved, afterRef = next[0].delta.buildings[0].resolved;
  expect(isArchivedPlan(beforeRef) && isArchivedPlan(afterRef) && afterRef.archive_id !== beforeRef.archive_id).toBe(true);
  expect(await resolveArchivedPlan(next[0].delta.buildings[0], next[0].delta)).toEqual(raw[0].buildings[0].resolved);
  expect(input.backend.stages.get('old')!.chunks).toEqual(old); expect(JSON.stringify(input.session.projection)).toBe(oldGraph);
  expect(input.state).toEqual(beforeState); expect(JSON.stringify(input.original)).toBe(original); expect(JSON.stringify(input.edited)).toBe(edited);
  input.session.dispose();
});

it('uses the exact admission AABB including roof domain and access half-width', () => {
  const rect = (x: number, y: number, w: number, h: number) => [{ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] }];
  const request: PlacementRequest = { ...site, cadastral: rect(10, 10, 4, 4), buildable: rect(8, 9, 5, 5), roof_domain: rect(20, 20, 10, 10),
    reserves: rect(-1000, -1000, 1, 1), accesses: [{ id: 'access', kind: 'public', width_m: 8, segment: [{ x: 100, y: -20 }, { x: 120, y: -5 }] }] };
  expect(coldArchitectureEditBounds(request)).toEqual([8, -24, 124, 30]);
  expect(() => coldArchitectureEditBounds({ ...request, accesses: [{ ...request.accesses[0], width_m: Infinity }] })).toThrow('non finies');
});

it('retains the native material table even for IDs absent from simplified display geometry', async () => {
  const input = await setup(), response = structuredClone(approved);
  const material = { ...response.materials![0], id: 'retained-plan-material-not-in-display-slots' };
  response.materials!.push(material); input.generate.mockResolvedValue(response);
  const result = await editColdCityBuilding(input); expect(result.applied).toBe(true); if (!result.applied) throw new Error(result.message);
  const reader = await openUrbanBuildingChunks(input.backend, result.state.store.sceneId), selected = await reader.readBuilding(site.id);
  expect(selected?.scene.materials).toContainEqual(material); expect(selected?.scene.buildings).toHaveLength(1); input.session.dispose();
});

it('loads actual collision neighbours beyond the cadastre and strips only the selected old occupation', async () => {
  const input = await setup(), neighbour = chunks[1].buildings[0], selected = chunks[0].buildings[0];
  // Exercise roof/access bounds with real C neighbour geometry. Native admission
  // remains stubbed; no successful new rights/pose is claimed by this fixture.
  input.edited.roof_domain = structuredClone(neighbour.footprint);
  input.edited.neighbors = [
    { id: 'external-formal', footprint: structuredClone(chunks[2].buildings[0].footprint), height_m: 1 },
    { id: selected.id, footprint: structuredClone(selected.footprint), height_m: 1 },
    { id: `${selected.id}/occupation/0`, footprint: structuredClone(selected.footprint), height_m: 1 },
  ];
  const projection = JSON.stringify(input.session.projection), original = JSON.stringify(input.original), edited = JSON.stringify(input.edited);
  const read = vi.spyOn(input.session, 'readVisible'), settings = { floors: 2 };
  input.generate.mockImplementation(async payload => {
    expect(payload.settings).toEqual(settings); expect(payload.requests).toHaveLength(1);
    const neighbors = payload.requests[0].neighbors;
    expect(neighbors.some(n => n.id === `${neighbour.id}/occupation/0` && JSON.stringify(n.footprint) === JSON.stringify(neighbour.footprint))).toBe(true);
    expect(neighbors.some(n => n.id === 'external-formal')).toBe(true);
    expect(neighbors.some(n => n.id === selected.id || n.id.startsWith(`${selected.id}/occupation/`))).toBe(false);
    neighbors[0].footprint[0].outer[0].x = -999; payload.requests[0].seed = 'provider mutated its own copy'; payload.settings!.floors = 99;
    return structuredClone(approved);
  });
  const result = await editColdCityBuilding({ ...input, settings }); expect(result.applied).toBe(true);
  expect(read.mock.calls[0][0]).toEqual(coldArchitectureEditBounds(input.edited)); expect(settings.floors).toBe(2);
  expect(JSON.stringify(input.session.projection)).toBe(projection); expect(JSON.stringify(input.original)).toBe(original); expect(JSON.stringify(input.edited)).toBe(edited);
  input.session.dispose();
});

it('fails closed for a truncated neighbourhood before generation or staging', async () => {
  const input = await setup(), before = structuredClone(input.backend.stages.get('old')!.chunks), begin = vi.spyOn(input.backend, 'begin');
  const result = await editColdCityBuilding({ ...input, limits: { maxBytes: 1 } });
  expect(result).toMatchObject({ applied: false, message: expect.stringContaining('voisinage') });
  expect(input.generate).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled(); expect(input.backend.activeId).toBe('old');
  expect(input.backend.stages.get('old')!.chunks).toEqual(before); input.session.dispose();
});

it('enforces the whole target manifest generator even when the bounded subset has no outside building', async () => {
  const input = await setup(), neighbourhood = await input.session.readVisible(coldArchitectureEditBounds(input.edited), { maxTiles: 256, maxCandidates: 2048, maxBuildings: 512, maxChunks: 16, maxBytes: 16 * 1024 * 1024 });
  expect(neighbourhood.buildings.map(r => r.building.id)).toEqual([site.id]);
  const begin = vi.spyOn(input.backend, 'begin'); input.generate.mockResolvedValue({ ...approved, generator_version: 'future-generator-not-the-city' });
  const result = await editColdCityBuilding(input);
  expect(result).toMatchObject({ applied: false, message: expect.stringContaining('générateur') }); expect(begin).not.toHaveBeenCalled();
  expect(input.backend.activeId).toBe('old'); input.session.dispose();
});

it('allows an authenticated inactive city but rejects a concurrent global pointer change at CAS', async () => {
  const input = await setup(); await commit(input.backend, 'other-city');
  const edited = await editColdCityBuilding(input); expect(edited.applied).toBe(true); expect(await input.backend.manifest('other-city')).toBeDefined(); input.session.dispose();
  const stale = await setup();
  stale.generate.mockImplementation(async () => { await commit(stale.backend, 'concurrent'); return structuredClone(approved); });
  const result = await editColdCityBuilding(stale);
  expect(result).toMatchObject({ applied: false, message: expect.stringContaining('Generation changed') });
  expect(stale.backend.activeId).toBe('concurrent'); expect(stale.backend.stages.size).toBe(2); stale.session.dispose();
});

it('rejects stale target descriptors, mismatched sites and untranslated offsets without native generation', async () => {
  for (const mode of ['descriptor', 'site', 'offset', 'disposed'] as const) {
    const input = await setup();
    if (mode === 'descriptor') input.backend.stages.get('old')!.manifest!.fingerprint = 'c'.repeat(64);
    if (mode === 'site') input.original.parcel_id = input.edited.parcel_id = 'a different original parcel';
    if (mode === 'offset') input.session.state.offset = { x: 1, y: 0 };
    if (mode === 'disposed') input.session.dispose();
    const begin = vi.spyOn(input.backend, 'begin'), result = await editColdCityBuilding(input);
    expect(result.applied).toBe(false); expect(input.generate).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled(); expect(input.backend.activeId).toBe('old');
    if (mode === 'offset') expect(!result.applied && result.message).toContain('translatées'); input.session.dispose();
  }
});

it('preserves the old generation on native refusals, exceptions, quota and commit failures', async () => {
  for (const mode of ['refusal', 'native', 'quota', 'commit'] as const) {
    const input = await setup(), before = structuredClone(input.backend.stages.get('old')!.chunks);
    if (mode === 'refusal') input.generate.mockResolvedValue({ ...approved, buildings: [], refusals: [{ ...chunks[0].refusals[0], id: site.id, parcel_id: site.parcel_id }] });
    if (mode === 'native') input.generate.mockRejectedValue(new Error('native unavailable'));
    if (mode === 'quota') input.backend.failAppend = true; if (mode === 'commit') input.backend.failCommit = true;
    const result = await editColdCityBuilding(input); expect(result.applied).toBe(false);
    expect(input.backend.activeId).toBe('old'); expect(input.backend.stages.size).toBe(1); expect(input.backend.stages.get('old')!.chunks).toEqual(before); input.session.dispose();
  }
});

it('checks cancellation after native response and aborts an active commit when an explicit signal fires', async () => {
  const input = await setup(); let cancelled = false;
  input.generate.mockImplementation(async () => { cancelled = true; return structuredClone(approved); });
  const begin = vi.spyOn(input.backend, 'begin'), result = await editColdCityBuilding({ ...input, cancelled: () => cancelled });
  expect(result.applied).toBe(false); expect(begin).not.toHaveBeenCalled(); expect(input.backend.activeId).toBe('old'); input.session.dispose();
  const committing = await setup(), gate = { started: deferred(), release: deferred() }; committing.backend.commitGate = gate;
  const signal = new AbortController(), work = editColdCityBuilding({ ...committing, signal: signal.signal });
  await gate.started.promise; signal.abort(new DOMException('edit replaced', 'AbortError'));
  expect((await work).applied).toBe(false); expect(committing.backend.activeId).toBe('old'); expect(committing.backend.stages.size).toBe(1);
  gate.release.resolve(); committing.session.dispose();
});

it('rejects shared material redefinitions and authenticated source corruption before committing', async () => {
  const input = await setup(), changed = structuredClone(approved), id = changed.buildings[0].volumes[0].materials.frame;
  const material = changed.materials!.find(value => value.id === id)!; expect(material).toBeDefined(); material.label += ' incompatible';
  input.generate.mockResolvedValue(changed);
  const result = await editColdCityBuilding(input); expect(result).toMatchObject({ applied: false, message: expect.stringContaining('matière partagée') });
  expect(input.backend.activeId).toBe('old'); expect(input.backend.stages.size).toBe(1); input.session.dispose();
  const corrupt = await setup(); corrupt.backend.stages.get('old')!.chunks[2].json += ' ';
  const failed = await editColdCityBuilding(corrupt); expect(failed).toMatchObject({ applied: false, message: expect.stringContaining('integrity') });
  expect(corrupt.backend.activeId).toBe('old'); expect(corrupt.backend.stages.size).toBe(1); corrupt.session.dispose();
});

it('preserves an unchanged chunk signed-zero payload and authenticates traversal without a second reader API', async () => {
  const variant = chunks.map(chunk => structuredClone(chunk)); variant[1].buildings[0].useful_area_m2 = -0;
  const input = await setup(variant), old = structuredClone(input.backend.stages.get('old')!.chunks[1]); expect(old.negativeZeros.length).toBeGreaterThan(0);
  const result = await editColdCityBuilding(input); expect(result.applied).toBe(true); if (!result.applied) throw new Error(result.message);
  expect(input.backend.stages.get(result.state.store.sceneId)!.chunks[1]).toEqual(old);
  const copied = await records(input.backend, result.state.store.sceneId); expect(Object.is(copied[1].delta.buildings[0].useful_area_m2, -0)).toBe(true);
  const legacy = []; for await (const delta of iterateUrbanBuildingChunks(input.backend, result.state.store.sceneId)) legacy.push(delta);
  expect(legacy).toEqual(copied.map(record => record.delta));
  const reads = input.backend.reads.length;
  await expect(iterateUrbanBuildingChunkRecords(input.backend, 'old', { maxChunkBytes: 1 }).next()).rejects.toThrow('budget');
  await expect(iterateUrbanBuildingChunkRecords(input.backend, 'old', { cancelled: () => true }).next()).rejects.toMatchObject({ name: 'AbortError' });
  expect(input.backend.reads).toHaveLength(reads);
  const fresh = await openUrbanBuildingChunks(input.backend, result.state.store.sceneId);
  expect((await fresh.readBuilding(site.id))?.scene.buildings).toHaveLength(1); input.session.dispose();
});
