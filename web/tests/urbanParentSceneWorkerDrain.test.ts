import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeParentSessionApi, PlanParentSessionRequest, CloseParentSessionRequest, CloseParentSessionReply } from '../../rust/bridge/nativeParentSessionContract';
import type { PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import type { UrbanSceneResponse, UrbanSceneWorkerMessage } from '../src/ui/urbanSceneProtocol';
const h = vi.hoisted(() => ({ apis: [] as NativeParentSessionApi[], rows: [] as PlacementRequest[], instances: [] as {
  onmessage?: (event: MessageEvent<UrbanSceneResponse>) => void; onerror?: (event: ErrorEvent) => void;
  messages: UrbanSceneWorkerMessage[]; responses: UrbanSceneResponse[]; terminate: ReturnType<typeof vi.fn>;
}[], core: vi.fn(), pages: vi.fn() }));
vi.mock('../../rust/bridge/architecture', () => ({ nativeParentSessionApi: () => {
  const api = h.apis.shift(); if (!api) throw new Error('No declared native session protocol mock'); return api;
} }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: h.core }));
vi.mock('../../rust/bridge/urbanBuildingPages', () => ({ URBAN_BUILDING_PAGE_LIMIT: 64, beginUrbanBuildingPages: h.pages }));
// Instrumented browser transport loads the ACTUAL worker module and producer.
// Only Worker scheduling, Core page transport and native API are doubles. This
// is not a browser/native computation proof. All finally/ACK code is real.
vi.mock('../src/ui/urbanSceneWorker?worker&inline', () => ({ default: class {
  onmessage?: (event: MessageEvent<UrbanSceneResponse>) => void; onerror?: (event: ErrorEvent) => void;
  messages: UrbanSceneWorkerMessage[] = []; responses: UrbanSceneResponse[] = []; terminate = vi.fn();
  private loaded: Promise<void>; private scope: { onmessage?: (event: MessageEvent<UrbanSceneWorkerMessage>) => void; postMessage(value: UrbanSceneResponse): void };
  constructor() {
    const owner = this;
    this.scope = { postMessage(value) { owner.responses.push(value); queueMicrotask(() => owner.onmessage?.({ data: value } as MessageEvent<UrbanSceneResponse>)); } };
    vi.stubGlobal('self', this.scope); h.instances.push(this);
    this.loaded = import('../src/ui/urbanSceneWorker').then(() => {});
  }
  postMessage(value: UrbanSceneWorkerMessage) { this.messages.push(value);
    void this.loaded.then(() => this.scope.onmessage?.({ data: value } as MessageEvent<UrbanSceneWorkerMessage>)); }
} }));
import { MemoryParents, sessionApi, mixed, identity } from './support/urbanParentSessionProtocol';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function input() { return { mode: 'compact' as const, seed: 'protocol-worker', parentSession: identity,
  source: { version: 1 as const, session: 'core-live', terrainRevision: 't1', layoutsRevision: 'l1', partitionsRevision: 'p1' },
  runtime: { profile: 'local' as const, server: 'http://worker-session-protocol-mock.test' }, keys: ['city'] }; }
beforeEach(() => {
  vi.resetModules(); h.apis = []; h.instances = []; const { sites } = mixed(); h.rows = sites;
  h.core.mockImplementation(async () => { throw new Error('Forbidden full Core path'); });
  h.pages.mockImplementation(async () => ({ total: h.rows.length, timing: { prepareMs: 0, readMs: 0, pages: 0 },
    read: async (offset: number, limit: number) => h.rows.slice(offset, offset + limit) }));
  vi.stubGlobal('Worker', class {}); // actual inline constructor is instrumented above.
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('dispose waits ACTUAL worker plan drain AND native release finally before terminate, even on stale epoch', async () => {
  const { createUrbanParentSceneClient } = await import('../src/ui/urbanParentScene');
  const { records } = mixed(), api = sessionApi(records), planGate = deferred(), releaseGate = deferred();
  const plan = api.plan, release = api.release;
  api.plan = vi.fn(async (request: PlanParentSessionRequest) => { await planGate.promise; return plan(request); });
  api.release = vi.fn(async (request: CloseParentSessionRequest): Promise<CloseParentSessionReply> => { await releaseGate.promise; return release(request); }); h.apis.push(api);
  const backend = new MemoryParents(), client = createUrbanParentSceneClient();
  const running = client.run(input(), { backend, sceneId: 'closing', sourceFingerprint: identity.fingerprint });
  const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(api.plan).toHaveBeenCalledOnce()); const instance = h.instances[0];
  let disposed = false; const closing = client.dispose().then(() => { disposed = true; });
  await vi.waitFor(() => expect(instance.messages.some(m => 'cancel' in m)).toBe(true));
  expect(instance.terminate).not.toHaveBeenCalled(); expect(disposed).toBe(false); expect(api.release).not.toHaveBeenCalled();
  planGate.resolve(); await vi.waitFor(() => expect(api.release).toHaveBeenCalledOnce());
  expect(instance.terminate).not.toHaveBeenCalled(); expect(disposed).toBe(false);
  releaseGate.resolve(); await closing; await rejected;
  expect(instance.responses.some(r => r.parentDrained?.state === 'settled')).toBe(true);
  expect(instance.terminate).toHaveBeenCalledOnce(); expect(backend.active?.sceneId).toBe('previous-city'); expect(backend.stages.has('closing')).toBe(false);
});
it('replacement cannot dispatch next run until the old ACTUAL worker finally has settled native release', async () => {
  const { createUrbanParentSceneClient } = await import('../src/ui/urbanParentScene');
  const { records } = mixed(), firstApi = sessionApi(records), secondApi = sessionApi(records), planGate = deferred(), releaseGate = deferred();
  const plan = firstApi.plan, release = firstApi.release;
  firstApi.plan = vi.fn(async (request: PlanParentSessionRequest) => { await planGate.promise; return plan(request); });
  firstApi.release = vi.fn(async (request: CloseParentSessionRequest): Promise<CloseParentSessionReply> => { await releaseGate.promise; return release(request); }); h.apis.push(firstApi, secondApi);
  const backend = new MemoryParents(), client = createUrbanParentSceneClient();
  const first = client.run(input(), { backend, sceneId: 'old', sourceFingerprint: identity.fingerprint }); const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(firstApi.plan).toHaveBeenCalledOnce());
  const second = client.run({ ...input(), seed: 'second-protocol-worker' }, { backend, sceneId: 'new', sourceFingerprint: identity.fingerprint });
  const instance = h.instances[0]; await vi.waitFor(() => expect(instance.messages.some(m => 'cancel' in m)).toBe(true));
  expect(instance.messages.filter(m => 'id' in m)).toHaveLength(1); expect(secondApi.begin).not.toHaveBeenCalled();
  planGate.resolve(); await vi.waitFor(() => expect(firstApi.release).toHaveBeenCalledOnce());
  expect(instance.messages.filter(m => 'id' in m)).toHaveLength(1); expect(secondApi.begin).not.toHaveBeenCalled();
  releaseGate.resolve(); await rejected; const result = await second;
  expect(result.counts).toMatchObject({ admitted_parents: 2, physical_members: 3 }); expect(backend.active?.sceneId).toBe('new');
  expect(backend.stages.has('old')).toBe(false); expect(secondApi.begin).toHaveBeenCalledOnce();
  await client.dispose(); expect(instance.terminate).toHaveBeenCalledOnce();
});

it('ACTUAL worker durable ACK/native ACK/release never waits for RAF and completion cancels old visual callback', async () => {
  let serial = 0; const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const { createUrbanParentSceneClient } = await import('../src/ui/urbanParentScene');
  const { records } = mixed(), api = sessionApi(records), gate = deferred(), release = api.release, visual = vi.fn();
  api.release = vi.fn(async (request: CloseParentSessionRequest) => { await gate.promise; return release(request); }); h.apis.push(api);
  const backend = new MemoryParents(), client = createUrbanParentSceneClient();
  const work = client.run(input(), { backend, sceneId: 'worker-no-raf', sourceFingerprint: identity.fingerprint, onBatch: visual });
  await vi.waitFor(() => expect(api.release).toHaveBeenCalledOnce());
  expect(backend.stages.get('worker-no-raf')!.parents.size).toBe(2); expect(backend.active?.sceneId).toBe('previous-city');
  expect(h.instances[0].messages.filter(m => 'parentAck' in m)).toHaveLength(1); expect(api.ack).toHaveBeenCalledOnce();
  expect(visual).not.toHaveBeenCalled(); expect(frames.size).toBe(1); gate.resolve();
  const result = await work; expect(result.generation.status).toBe('completed-and-released'); expect(frames.size).toBe(0);
  for (const callback of frames.values()) callback(0); expect(visual).not.toHaveBeenCalled(); await client.dispose();
});
