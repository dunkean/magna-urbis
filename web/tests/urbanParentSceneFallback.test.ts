import { afterEach, expect, it, vi } from 'vitest';
import javaRequest from './fixtures/native-parent-java-core-request.json';
import type { NativeParentSessionApi, CloseParentSessionRequest } from '../../rust/bridge/nativeParentSessionContract';
import type { PlacementRequest } from '../../rust/bridge/urbanArchitecture';
const h = vi.hoisted(() => ({ api: undefined as NativeParentSessionApi | undefined, rows: [] as PlacementRequest[], core: vi.fn(), pages: vi.fn() }));
vi.mock('../../rust/bridge/architecture', () => ({ nativeParentSessionApi: () => { if (!h.api) throw new Error('Missing declared session TRANSPORT MOCK'); return h.api; } }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: h.core }));
vi.mock('../../rust/bridge/urbanBuildingPages', () => ({ URBAN_BUILDING_PAGE_LIMIT: 64, beginUrbanBuildingPages: h.pages }));
vi.mock('../src/ui/urbanSceneWorker?worker&inline', () => ({ default: class { constructor() { throw new Error('Fallback test must not construct worker'); } } }));
import { createUrbanParentSceneClient } from '../src/ui/urbanParentScene';
import { MemoryParents, sessionApi, mixed, identity } from './support/urbanParentSessionProtocol';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('REAL fallback client -> shared producer -> paged Core boundary -> native session -> same durable store/CAS', async () => {
  const { records, sites } = mixed(); h.rows = sites; h.api = sessionApi(records);
  h.core.mockImplementation(async () => { throw new Error('Forbidden full-city Core path in retained fallback'); });
  h.pages.mockImplementation(async () => ({ total: h.rows.length, timing: { prepareMs: 0, readMs: 0, pages: 0 },
    read: async (offset: number, limit: number) => h.rows.slice(offset, offset + limit) }));
  const backend = new MemoryParents(), client = createUrbanParentSceneClient(), progress = vi.fn();
  const result = await client.run({ mode: 'compact', seed: 'test', parentSession: identity,
    source: { version: 1, session: 'core-live-handle', terrainRevision: 'terrain1', layoutsRevision: 'layouts1', partitionsRevision: 'parcels1' },
    runtime: { profile: 'local', server: 'http://source-session-protocol-mock.test' }, keys: ['city'] },
    { backend, sourceFingerprint: identity.fingerprint, sceneId: 'fallback-city', forceFallback: true, progress });
  expect(h.core).not.toHaveBeenCalled(); expect(h.pages).toHaveBeenCalledOnce();
  expect(result.kind).toBe('cold-native-parent-scene'); expect(result.counts).toMatchObject({ requests: 4, admitted_parents: 2, physical_members: 3 });
  expect(backend.stages.get('fallback-city')!.parents.size).toBe(2); expect(backend.stages.get('fallback-city')!.members.size).toBe(3);
  expect(backend.active?.sceneId).toBe('fallback-city'); expect(h.api.ack).toHaveBeenCalledOnce(); expect(h.api.release).toHaveBeenCalledOnce();
  expect(progress).toHaveBeenLastCalledWith(4, 4); await client.dispose();
});
it('real fallback source error cannot silently call legacy construction or publish partial parent source', async () => {
  const { records, sites } = mixed(); h.rows = sites; h.api = sessionApi(records);
  h.core.mockImplementation(async () => { throw new Error('Forbidden full Core fallback'); }); h.pages.mockRejectedValue(new Error('source revision changed'));
  const backend = new MemoryParents(), client = createUrbanParentSceneClient();
  await expect(client.run({ mode: 'compact', seed: 'test', parentSession: identity,
    source: { version: 1, session: 'core-live-handle', terrainRevision: 'terrain1', layoutsRevision: 'layouts1', partitionsRevision: 'parcels1' },
    runtime: { profile: 'local', server: 'http://source-session-protocol-mock.test' } },
    { backend, sourceFingerprint: identity.fingerprint, forceFallback: true })).rejects.toThrow('source revision changed');
  expect(h.core).not.toHaveBeenCalled(); expect(h.api.begin).not.toHaveBeenCalled(); expect(backend.active?.sceneId).toBe('previous-city'); await client.dispose();
});

it.each(['retained-need', 'legacy-unknown', 'edited-config'] as const)('shared real fallback producer preserves exact Core programme %s', async kind => {
  const request: PlacementRequest = JSON.parse(JSON.stringify(javaRequest));
  if (kind === 'legacy-unknown' && request.programme) delete request.programme.housing_floor_need;
  const before = structuredClone(request.programme); h.rows = [request]; h.api = sessionApi([]);
  h.pages.mockImplementation(async () => ({ total: 1, timing: { prepareMs: 0, readMs: 0, pages: 0 },
    read: async (offset: number, limit: number) => h.rows.slice(offset, offset + limit) }));
  const backend = new MemoryParents(), client = createUrbanParentSceneClient();
  await client.run({ mode: 'compact', seed: 'exact-model', parentSession: identity,
    source: { version: 1, session: 'core-model-protocol-mock', terrainRevision: 't', layoutsRevision: 'l', partitionsRevision: 'p' },
    runtime: { profile: 'local', server: 'http://protocol-mock.test' },
    ...(kind === 'edited-config' ? { buildingOverrides: { [request.id]: { recipe: request.config?.recipe ?? '', variant: 'default', floors: 2 } } } : {}) },
    { backend, sourceFingerprint: identity.fingerprint, forceFallback: true });
  const actual = vi.mocked(h.api.plan).mock.calls[0][0].requests[0];
  expect(actual.programme).toEqual(before); expect(request.programme).toEqual(before);
  if (kind === 'legacy-unknown') expect(actual.programme).not.toHaveProperty('housing_floor_need');
  else expect(actual.programme?.housing_floor_need?.requested_m2).toBe(333.12);
  if (kind === 'edited-config') { if (request.config) { expect(actual.config?.overrides?.floors).toBe(2); expect(actual.config).not.toBe(request.config); } else expect(actual.config).toBeUndefined(); }
  await client.dispose();
});

function frameQueue() {
  let serial = 0; const jobs = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++serial; jobs.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => jobs.delete(id));
  return { jobs, flush() { const callbacks = [...jobs.values()]; jobs.clear(); for (const callback of callbacks) callback(0); } };
}
function parentInput() { return { mode: 'compact' as const, seed: 'raf-protocol', parentSession: identity,
  source: { version: 1 as const, session: 'core-live', terrainRevision: 't1', layoutsRevision: 'l1', partitionsRevision: 'p1' },
  runtime: { profile: 'local' as const, server: 'http://raf-protocol-mock.test' }, keys: ['city'] }; }
function pausedRelease(rows: number) {
  const { sites } = mixed(); h.rows = Array.from({ length: rows }, (_, i) => ({ ...structuredClone(sites[sites.length - 1]), id: `open-${i}`, parcel_id: `parcel-${i}` }));
  const api = sessionApi([]), release = api.release; let finish!: () => void;
  const gate = new Promise<void>(r => { finish = r; }); api.release = vi.fn(async (request: CloseParentSessionRequest) => { await gate; return release(request); }); h.api = api;
  h.pages.mockImplementation(async () => ({ total: h.rows.length, timing: { prepareMs: 0, readMs: 0, pages: 0 },
    read: async (offset: number, limit: number) => h.rows.slice(offset, offset + limit) }));
  return { api, finish };
}
it('ACTUAL fallback persists/ACKs every batch with zero frame flush; one preview has cumulative counts and no raw transport copy', async () => {
  const raf = frameQueue(), { api, finish } = pausedRelease(130), onBatch = vi.fn(), onAcknowledged = vi.fn();
  const backend = new MemoryParents(), client = createUrbanParentSceneClient();
  const work = client.run(parentInput(), { backend, sourceFingerprint: identity.fingerprint, sceneId: 'raf-batches', forceFallback: true, onBatch, onAcknowledged });
  await vi.waitFor(() => expect(api.release).toHaveBeenCalledOnce());
  expect(api.ack).toHaveBeenCalledTimes(3); expect(onBatch).not.toHaveBeenCalled(); expect(onAcknowledged).not.toHaveBeenCalled(); expect(raf.jobs.size).toBe(1);
  expect(backend.stages.get('raf-batches')!.chunks.reduce((n, c) => n + c.counts.requests, 0)).toBe(130);
  expect(backend.active?.sceneId).toBe('previous-city'); raf.flush();
  await vi.waitFor(() => expect(onAcknowledged).toHaveBeenCalledOnce()); expect(onBatch).toHaveBeenCalledOnce();
  const [batch, message, cumulative] = onBatch.mock.calls[0];
  expect(batch.counts.requests).toBe(2); expect(message.progress.completed).toBe(130); expect(cumulative).toMatchObject({ requests: 130, open_spaces: 130 });
  expect(message).not.toHaveProperty('batch_json'); expect(message).not.toHaveProperty('sites');
  expect(onAcknowledged.mock.calls[0][0].reply.completed).toBe(130);
  finish(); const result = await work; expect(result.counts.requests).toBe(130); expect(result.counts.open_spaces).toBe(130); await client.dispose();
});
it('ACTUAL fallback commit/release can finish before first RAF; queued provisional UI is discarded', async () => {
  const raf = frameQueue(), { api, finish } = pausedRelease(65), onBatch = vi.fn(), backend = new MemoryParents(), client = createUrbanParentSceneClient();
  const work = client.run(parentInput(), { backend, sourceFingerprint: identity.fingerprint, sceneId: 'complete-no-raf', forceFallback: true, onBatch });
  await vi.waitFor(() => expect(api.release).toHaveBeenCalledOnce()); expect(api.ack).toHaveBeenCalledTimes(2); expect(backend.active?.sceneId).toBe('previous-city');
  finish(); const result = await work; expect(result.generation.status).toBe('completed-and-released'); expect(backend.active?.sceneId).toBe('complete-no-raf');
  expect(raf.jobs.size).toBe(0); raf.flush(); expect(onBatch).not.toHaveBeenCalled(); await client.dispose();
});
it('ACTUAL fallback cancellation while RAF paused drops preview and keeps previous active source', async () => {
  const raf = frameQueue(), { api, finish } = pausedRelease(65), onBatch = vi.fn(), backend = new MemoryParents(), client = createUrbanParentSceneClient(), abort = new AbortController();
  const work = client.run(parentInput(), { backend, sourceFingerprint: identity.fingerprint, sceneId: 'cancel-no-raf', forceFallback: true, onBatch, signal: abort.signal });
  const failed = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(api.release).toHaveBeenCalledOnce()); abort.abort(new DOMException('replaced source', 'AbortError')); finish(); await failed;
  expect(raf.jobs.size).toBe(0); raf.flush(); expect(onBatch).not.toHaveBeenCalled(); expect(backend.active?.sceneId).toBe('previous-city'); expect(backend.stages.has('cancel-no-raf')).toBe(false); await client.dispose();
});
