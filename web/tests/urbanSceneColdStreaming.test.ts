import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import siteFixture from './fixtures/urban-cold-sites-c.json';
import type { PlacementBatch, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { beginUrbanBuildingStage, openUrbanBuildingChunks } from '../src/ui/urbanBuildingChunkStore';
import { projectUrbanSite } from '../src/ui/urbanSiteStore';
import type { UrbanSceneResponse, UrbanSceneWorkerMessage } from '../src/ui/urbanSceneProtocol';
import { ColdTestBackend, deferred } from './helpers/urbanBuildingColdTestBackend';
import { DerivedTestBackend } from './helpers/urbanDerivedTestBackend';
import { openColdCitySession } from '../src/ui/urbanColdCitySession';

interface FakeWorker { messages: UrbanSceneWorkerMessage[]; onmessage?: (event: MessageEvent<UrbanSceneResponse>) => void;
  onerror?: (event: ErrorEvent) => void; terminate(): void }
const harness = vi.hoisted(() => ({ workers: [] as FakeWorker[], engine: vi.fn(), accumulator: vi.fn() }));
vi.mock('../src/ui/urbanSceneWorker?worker&inline', () => ({ default: class {
  messages: UrbanSceneWorkerMessage[] = []; onmessage?: FakeWorker['onmessage']; onerror?: FakeWorker['onerror'];
  constructor() { harness.workers.push(this); } postMessage(message: UrbanSceneWorkerMessage) { this.messages.push(message); } terminate() {}
} }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: harness.engine }));
vi.mock('../src/ui/urbanSceneProgress', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/ui/urbanSceneProgress')>(); harness.accumulator.mockImplementation(actual.createUrbanSceneAccumulator);
  return { ...actual, createUrbanSceneAccumulator: harness.accumulator };
});
import { createUrbanSceneClient, type UrbanColdSceneInput, type UrbanColdSceneResponse } from '../src/ui/urbanScene';

const input: UrbanColdSceneInput = { mode: 'detailed', seed: 'cold-test', keys: ['city'], runtime: { profile: 'local', server: 'http://test.local' },
  source: { version: 1, session: 'source-session', terrainRevision: 'terrain', layoutsRevision: 'layouts', partitionsRevision: 'parcels' } };
let chunks: PlacementBatch[];
const raw = fixture.chunks.map(chunk => chunk.delta as unknown as PlacementBatch);
const requests = siteFixture.chunks.map(chunk => chunk.requests as unknown as PlacementRequest[]);
beforeAll(async () => { chunks = await Promise.all(raw.map(archivePlanBatch)); });
beforeEach(() => { harness.workers.length = 0; harness.engine.mockClear(); harness.accumulator.mockClear(); });
const emit = (worker: FakeWorker, response: UrbanSceneResponse) => worker.onmessage?.({ data: response } as MessageEvent<UrbanSceneResponse>);
const query = (value = input) => ({ source: value.source, keys: value.keys, seed: value.seed, architectureCulture: value.settings?.culture });
const completion = () => ({ schema_version: '1' as const, generator_version: chunks[0].generator_version, buildings: 6, refusals: 3, open_spaces: 0 });
async function workerStarted(id: number) {
  await vi.waitFor(() => expect(harness.workers.some(worker => worker.messages.some(message => 'seed' in message && message.id === id))).toBe(true));
  return harness.workers.find(worker => worker.messages.some(message => 'seed' in message && message.id === id))!;
}
async function append(worker: FakeWorker, id: number, index: number) {
  const progress = fixture.chunks[index].progress;
  emit(worker, { id, batch: { delta: chunks[index], progress, requests: [], sites: requests[index].map((request, i) => projectUrbanSite(request, progress.start + i)) } });
  await vi.waitFor(() => expect(worker.messages).toContainEqual({ ack: { id, completed: progress.completed } }));
}
async function allChunks(worker: FakeWorker, id = 1) { for (let i = 0; i < chunks.length; i++) await append(worker, id, i); }
async function previous(backend: ColdTestBackend) {
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'previous', sourceFingerprint: fixture.cliSha256, totalRequests: 9 });
  for (let i = 0; i < chunks.length; i++) await stage.append(chunks[i], fixture.chunks[i].progress); return stage.commit();
}
function hasNoNativeGraph(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(['resolved', 'plan_archives', 'volumes', 'roof_mesh', 'terrain', 'neighbors', 'cadastral', 'buildable', 'parent'].includes(key)).toBe(false);
    hasNoNativeGraph(child);
  }
}

it('persists before projection/ACK, avoids the native accumulator and returns an explicitly cold descriptor only after verified completion', async () => {
  const backend = new ColdTestBackend(); await previous(backend);
  const gate = { started: deferred(), release: deferred() }; backend.appendGate = gate;
  const callbackStarted = deferred(), callbackRelease = deferred(); let first = true;
  const onProjection = vi.fn(async projection => { hasNoNativeGraph(projection); if (first) { first = false; callbackStarted.resolve(); await callbackRelease.promise; } });
  const client = createUrbanSceneClient();
  const runtimeExtra = { ...input, raster: { heavy: raw }, layouts: [raw], partitions: [raw], scene: chunks, requireProjectedSiteStream: false,
    source: { ...input.source, parent: raw }, runtime: { ...input.runtime, parent: raw } };
  const result = client.runCold(runtimeExtra, { backend, sourceFingerprint: fixture.cliSha256, sceneId: 'next', onProjection });
  const worker = await workerStarted(1), message = worker.messages[0];
  for (const field of ['raster', 'layouts', 'partitions', 'scene']) expect(message).not.toHaveProperty(field);
  expect(message).toMatchObject({ id: 1, progressive: true, requireProjectedSiteStream: true, source: input.source });
  expect('source' in message && message.source).not.toHaveProperty('parent'); expect('runtime' in message && message.runtime).not.toHaveProperty('parent');
  const progress = fixture.chunks[0].progress;
  emit(worker, { id: 1, batch: { delta: chunks[0], progress, requests: [], sites: requests[0].map(projectUrbanSite) } });
  await gate.started.promise; expect(onProjection).not.toHaveBeenCalled(); expect((await backend.active())?.sceneId).toBe('previous');
  expect(worker.messages.some(message => 'ack' in message)).toBe(false);
  gate.release.resolve(); await callbackStarted.promise;
  expect(backend.stages.get('next')!.chunks).toHaveLength(1); expect(worker.messages.some(message => 'ack' in message)).toBe(false);
  callbackRelease.resolve(); await vi.waitFor(() => expect(worker.messages).toContainEqual({ ack: { id: 1, completed: 3 } }));
  await append(worker, 1, 1); await append(worker, 1, 2);
  expect((await backend.active())?.sceneId).toBe('previous'); emit(worker, { id: 1, complete: completion(), siteQuery: query() });
  const completed = await result;
  expect(completed).toMatchObject({ kind: 'cold-native-scene', store: { sceneId: 'next' }, counts: completion(), siteData: { kind: 'native-sites' } });
  for (const field of ['scene', 'requests', 'partitions']) expect(completed).not.toHaveProperty(field);
  if (completed.siteData.kind !== 'native-sites') throw new Error('Missing native site projections');
  expect(completed.siteData.visuals).toHaveLength(9); hasNoNativeGraph(completed.siteData.visuals);
  expect(harness.accumulator).not.toHaveBeenCalled(); expect(harness.engine).not.toHaveBeenCalled();
  expect((await backend.active())?.sceneId).toBe('next'); expect(await backend.manifest('previous')).toBeDefined();
  const reader = await openUrbanBuildingChunks(backend, completed.store.sceneId), selected = (await reader.readBuilding(chunks[0].buildings[0].id))!;
  expect(await resolveArchivedPlan(selected.building, selected.scene)).toEqual(raw[0].buildings[0].resolved); client.dispose();
});

it('can omit all site projections without retaining original constraints or pretending edit-site access is available', async () => {
  const backend = new ColdTestBackend(), client = createUrbanSceneClient();
  const result = client.runCold(input, { backend, sourceFingerprint: fixture.cliSha256, retainSites: false });
  const worker = await workerStarted(1); await allChunks(worker); emit(worker, { id: 1, complete: completion(), siteQuery: query() });
  const completed = await result; expect(completed.siteData).toEqual({ kind: 'not-retained', count: 9 });
  expect(completed).not.toHaveProperty('requests'); expect(completed).not.toHaveProperty('scene'); expect(harness.accumulator).not.toHaveBeenCalled(); client.dispose();
});

it('rejects old original-request or collected-scene workers explicitly, preserving the previous committed generation', async () => {
  for (const mode of ['requests', 'collected'] as const) {
    const backend = new ColdTestBackend(); await previous(backend); const client = createUrbanSceneClient();
    const result = client.runCold(input, { backend, sceneId: 'unsupported', sourceFingerprint: fixture.cliSha256 });
    const rejected = expect(result).rejects.toThrow(mode === 'requests' ? 'projected sites' : 'collected native scene');
    const worker = await workerStarted(1);
    emit(worker, mode === 'requests' ? { id: 1, batch: { delta: chunks[0], progress: fixture.chunks[0].progress, requests: requests[0] } } : { id: 1, scene: chunks[0] });
    await rejected; expect(worker.messages.some(message => 'ack' in message)).toBe(false);
    expect((await backend.active())?.sceneId).toBe('previous'); expect(backend.stages.has('unsupported')).toBe(false); client.dispose();
    harness.workers.length = 0;
  }
  expect(harness.engine).not.toHaveBeenCalled(); expect(harness.accumulator).not.toHaveBeenCalled();
});

it('rejects mismatched source descriptors and completion counts before changing the active pointer', async () => {
  for (const mode of ['source', 'counts'] as const) {
    const backend = new ColdTestBackend(); await previous(backend); const commit = vi.spyOn(backend, 'commit'), client = createUrbanSceneClient();
    const result = client.runCold(input, { backend, sceneId: 'bad-final', sourceFingerprint: fixture.cliSha256 });
    const rejected = expect(result).rejects.toThrow(mode === 'source' ? 'source identity' : 'completion');
    const worker = await workerStarted(1); await allChunks(worker);
    emit(worker, { id: 1, complete: mode === 'counts' ? { ...completion(), buildings: 5 } : completion(),
      siteQuery: mode === 'source' ? { ...query(), source: { ...input.source, terrainRevision: 'different' } } : query() });
    await rejected; expect(commit).not.toHaveBeenCalled(); expect((await backend.active())?.sceneId).toBe('previous');
    expect(backend.stages.has('bad-final')).toBe(false); client.dispose(); harness.workers.length = 0;
  }
});

it('rejects quota/projection errors with no ACK and removes staged chunks without changing the previous scene', async () => {
  for (const mode of ['quota', 'projection'] as const) {
    const backend = new ColdTestBackend(); await previous(backend); backend.failAppend = mode === 'quota';
    const client = createUrbanSceneClient(), onProjection = vi.fn(() => { throw new Error('projection failed'); });
    const result = client.runCold(input, { backend, sceneId: 'failure', sourceFingerprint: fixture.cliSha256, onProjection });
    const rejected = expect(result).rejects.toThrow(mode === 'quota' ? 'Quota' : 'projection failed');
    const worker = await workerStarted(1);
    emit(worker, { id: 1, batch: { delta: chunks[0], progress: fixture.chunks[0].progress, requests: [], sites: requests[0].map(projectUrbanSite) } });
    await rejected; expect(worker.messages.some(message => 'ack' in message)).toBe(false);
    expect((await backend.active())?.sceneId).toBe('previous'); expect(backend.stages.has('failure')).toBe(false);
    if (mode === 'quota') expect(onProjection).not.toHaveBeenCalled(); client.dispose(); harness.workers.length = 0;
  }
});

it('drains a superseded append before dispatching only the latest replacement and never ACKs its stale chunk', async () => {
  const backend = new ColdTestBackend(); await previous(backend); const client = createUrbanSceneClient();
  const gate = { started: deferred(), release: deferred() }; backend.appendGate = gate;
  const first = client.runCold(input, { backend, sceneId: 'abandoned', sourceFingerprint: fixture.cliSha256 });
  const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' }); const worker = await workerStarted(1);
  emit(worker, { id: 1, batch: { delta: chunks[0], progress: fixture.chunks[0].progress, requests: [], sites: requests[0].map(projectUrbanSite) } });
  await gate.started.promise;
  const obsolete = client.runCold(input, { backend, sceneId: 'obsolete', sourceFingerprint: fixture.cliSha256 });
  const obsoleteRejected = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' });
  const newestInput = { ...input, seed: 'latest' }, newest = client.runCold(newestInput, { backend, sceneId: 'latest', sourceFingerprint: fixture.cliSha256 });
  await Promise.resolve(); expect(worker.messages.filter(message => 'seed' in message)).toHaveLength(1);
  gate.release.resolve(); await Promise.all([firstRejected, obsoleteRejected]); await workerStarted(3);
  expect(worker.messages.filter(message => 'seed' in message).map(message => message.id)).toEqual([1, 3]);
  expect(worker.messages).not.toContainEqual({ ack: { id: 1, completed: 3 } });
  expect(backend.stages.has('abandoned')).toBe(false); expect(backend.stages.has('obsolete')).toBe(false);
  emit(worker, { id: 1, complete: completion(), siteQuery: query() }); expect((await backend.active())?.sceneId).toBe('previous');
  await allChunks(worker, 3); emit(worker, { id: 3, complete: completion(), siteQuery: query(newestInput) });
  expect((await newest).store.sceneId).toBe('latest'); client.dispose();
});

it('cancels an active commit transaction, removes staging and leaves the old pointer intact', async () => {
  const backend = new ColdTestBackend(); await previous(backend); const client = createUrbanSceneClient();
  const gate = { started: deferred(), release: deferred() }; backend.commitGate = gate;
  const result = client.runCold(input, { backend, sceneId: 'cancelled-commit', sourceFingerprint: fixture.cliSha256 });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' }); const worker = await workerStarted(1); await allChunks(worker);
  emit(worker, { id: 1, complete: completion(), siteQuery: query() }); await gate.started.promise;
  expect((await backend.active())?.sceneId).toBe('previous'); client.invalidate(); await rejected;
  expect((await backend.active())?.sceneId).toBe('previous'); expect(backend.stages.has('cancelled-commit')).toBe(false);
  gate.release.resolve(); await Promise.resolve(); expect((await backend.active())?.sceneId).toBe('previous'); client.dispose();
});

it('suppresses a stale result after the commit has already become durable without promising to undo that commit', async () => {
  const backend = new ColdTestBackend(); await previous(backend); const durable = deferred(), release = deferred();
  const commit = backend.commit.bind(backend);
  backend.commit = async (manifest, expected, options) => { await commit(manifest, expected, options); durable.resolve(); await release.promise; };
  const client = createUrbanSceneClient(), result = client.runCold(input, { backend, sceneId: 'already-durable', sourceFingerprint: fixture.cliSha256 });
  let published = false; const observed = result.then(() => { published = true; }); const rejected = expect(observed).rejects.toMatchObject({ name: 'AbortError' });
  const worker = await workerStarted(1); await allChunks(worker); emit(worker, { id: 1, complete: completion(), siteQuery: query() });
  await durable.promise; expect((await backend.active())?.sceneId).toBe('already-durable'); client.invalidate(); release.resolve(); await rejected;
  expect(published).toBe(false); expect(await backend.manifest('previous')).toBeDefined();
  expect((await backend.active())?.sceneId).toBe('already-durable'); client.dispose();
});

it('rejects premature/overlapping finalization and a failed commit rather than publishing a partial scene', async () => {
  for (const mode of ['early', 'overlap', 'commit'] as const) {
    const backend = new ColdTestBackend(); await previous(backend); const client = createUrbanSceneClient();
    const gate = { started: deferred(), release: deferred() }; if (mode === 'overlap') backend.appendGate = gate;
    const result = client.runCold(input, { backend, sceneId: 'partial', sourceFingerprint: fixture.cliSha256 });
    const rejected = expect(result).rejects.toThrow(mode === 'early' ? 'Incomplete' : mode === 'overlap' ? 'Overlapping' : 'Commit failed');
    const worker = await workerStarted(1);
    if (mode === 'overlap') {
      emit(worker, { id: 1, batch: { delta: chunks[0], progress: fixture.chunks[0].progress, requests: [], sites: requests[0].map(projectUrbanSite) } });
      await gate.started.promise; emit(worker, { id: 1, complete: completion(), siteQuery: query() }); gate.release.resolve();
    } else {
      if (mode === 'commit') { await allChunks(worker); backend.failCommit = true; }
      emit(worker, { id: 1, complete: completion(), siteQuery: query() });
    }
    await rejected; expect((await backend.active())?.sceneId).toBe('previous'); expect(backend.stages.has('partial')).toBe(false);
    if (mode === 'overlap') expect(worker.messages.some(message => 'ack' in message)).toBe(false);
    client.dispose(); harness.workers.length = 0;
  }
});

it('releases an abandoned projection wait on dispose and rejects worker crashes without a full-site fallback', async () => {
  for (const mode of ['dispose', 'crash'] as const) {
    const backend = new ColdTestBackend(); await previous(backend); const client = createUrbanSceneClient(), started = deferred(), never = deferred();
    const result = client.runCold(input, { backend, sceneId: 'abandoned-callback', sourceFingerprint: fixture.cliSha256,
      onProjection: () => { started.resolve(); return never.promise; } });
    const rejected = mode === 'dispose' ? expect(result).rejects.toMatchObject({ name: 'AbortError' }) : expect(result).rejects.toThrow('worker crashed');
    const worker = await workerStarted(1);
    emit(worker, { id: 1, batch: { delta: chunks[0], progress: fixture.chunks[0].progress, requests: [], sites: requests[0].map(projectUrbanSite) } });
    await started.promise;
    if (mode === 'dispose') client.dispose(); else worker.onerror?.({ message: 'worker crashed', preventDefault() {} } as ErrorEvent);
    await rejected; expect(worker.messages.some(message => 'ack' in message)).toBe(false); expect((await backend.active())?.sceneId).toBe('previous');
    expect(backend.stages.has('abandoned-callback')).toBe(false); expect(harness.engine).not.toHaveBeenCalled(); client.dispose(); harness.workers.length = 0;
  }
});

it('handles native empty metadata chunks and rejects invalid cold inputs without superseding a valid pending run', async () => {
  const backend = new ColdTestBackend(), client = createUrbanSceneClient();
  const result = client.runCold(input, { backend, sourceFingerprint: fixture.cliSha256 }); const worker = await workerStarted(1);
  await expect(client.runCold(input, { backend, sourceFingerprint: 'invalid' })).rejects.toThrow('fingerprint');
  expect(worker.messages.filter(message => 'seed' in message)).toHaveLength(1);
  const empty = { ...chunks[0], buildings: [], refusals: [], open_spaces: [], plan_archives: {} };
  emit(worker, { id: 1, batch: { delta: empty, requests: [], sites: [], progress: { start: 0, completed: 0, total: 0 } } });
  await vi.waitFor(() => expect(worker.messages).toContainEqual({ ack: { id: 1, completed: 0 } }));
  emit(worker, { id: 1, complete: { schema_version: '1', generator_version: empty.generator_version, buildings: 0, refusals: 0, open_spaces: 0 }, siteQuery: query() });
  const completed: UrbanColdSceneResponse = await result; expect(completed.counts.buildings).toBe(0);
  expect((await backend.active())?.chunks).toHaveLength(1);
  // @ts-expect-error Explicit cold result has no fake native PlacementBatch.
  const notAScene: PlacementBatch = completed; void notAScene;
  client.dispose();
});

it('writes authenticated visuals and actual ordered site origins before ACK and restores them without native archive reads', async () => {
  const backend = new DerivedTestBackend(), client = createUrbanSceneClient();
  const result = client.runCold(input, { backend, sceneId: 'derived-stream', sourceFingerprint: fixture.cliSha256 });
  const worker = await workerStarted(1);
  for (let i = 0; i < chunks.length; i++) {
    await append(worker, 1, i); const cache = backend.caches.get('derived-stream')!;
    expect(cache.chunks.size).toBe(i + 1); expect(cache.origins.size).toBe(fixture.chunks[i].progress.completed);
    expect(cache.manifest).toBeUndefined();
  }
  emit(worker, { id: 1, complete: completion(), siteQuery: query() }); const response = await result;
  expect(backend.caches.get('derived-stream')!.manifest).toMatchObject({ origins: 'complete', parentFingerprint: response.store.fingerprint });
  backend.reads = []; const session = await openColdCitySession(backend, { store: response.store, counts: response.counts, cityKey: 'city' });
  expect(backend.reads).toEqual([]); expect(session.siteVisuals).toHaveLength(9); expect(session.originBinding).toBe('unbound');
  session.dispose(); client.dispose();
});

it('keeps the normal cold stream/ACK/native commit when only derivative quota fails', async () => {
  const backend = new DerivedTestBackend(); backend.derivedFail = 'append'; const client = createUrbanSceneClient();
  const result = client.runCold(input, { backend, sceneId: 'quota-cache-only', sourceFingerprint: fixture.cliSha256 });
  const worker = await workerStarted(1); await allChunks(worker); emit(worker, { id: 1, complete: completion(), siteQuery: query() });
  const response = await result; expect(response.counts).toMatchObject({ buildings: 6, refusals: 3 }); expect(backend.activeId).toBe('quota-cache-only');
  expect(backend.caches.get('quota-cache-only')).toBeUndefined(); client.dispose();
});
