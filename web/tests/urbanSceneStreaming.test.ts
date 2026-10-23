import { expect, it, vi } from 'vitest';
import type { PlacementBatch, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import type { SettlementRaster } from '../../rust/bridge/settlements';
import type { ArchitectureBatchOptions } from '../../rust/bridge/architectureBatch';
import type { UrbanSceneResponse, UrbanSceneWorkerMessage } from '../src/ui/urbanSceneProtocol';

interface FakeWorker {
  messages: UrbanSceneWorkerMessage[];
  onmessage?: (event: MessageEvent<UrbanSceneResponse>) => void;
  onerror?: (event: ErrorEvent) => void;
  terminate(): void;
}
const harness = vi.hoisted(() => ({ workers: [] as FakeWorker[], engine: vi.fn(), plan: vi.fn(), streamPlan: vi.fn(), place: vi.fn() }));
vi.mock('../src/ui/urbanSceneWorker?worker&inline', () => ({ default: class {
  messages: UrbanSceneWorkerMessage[] = [];
  onmessage?: FakeWorker['onmessage']; onerror?: FakeWorker['onerror'];
  constructor() { harness.workers.push(this); }
  postMessage(message: UrbanSceneWorkerMessage) { this.messages.push(message); }
  terminate() {}
} }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: harness.engine }));
vi.mock('../../rust/bridge/architecture', () => ({ planUrbanBuildings: harness.plan, streamUrbanBuildingPlans: harness.streamPlan, placeUrbanBuildings: harness.place }));

import { createUrbanSceneClient } from '../src/ui/urbanScene';
import { usesCompactPlans } from '../src/ui/urbanSceneProtocol';
import { urbanSceneCompletion } from '../src/ui/urbanSceneProgress';
import type { UrbanSiteVisual } from '../src/ui/urbanSiteStore';

const empty = (): PlacementBatch => ({ schema_version: '1', generator_version: 'stream-test', buildings: [], refusals: [], open_spaces: [] });
const input = { layouts: [], partitions: [], seed: 'test', raster: {} as SettlementRaster, mode: 'detailed' as const };
const emit = (worker: FakeWorker, response: UrbanSceneResponse) => worker.onmessage?.({ data: response } as MessageEvent<UrbanSceneResponse>);
const batch = (id: number): UrbanSceneResponse => ({ id, batch: { delta: empty(), requests: [], progress: { start: 0, completed: 0, total: 0 } } });

it('retains projections instead of request constraints on the capability-gated stream', async () => {
  const client = createUrbanSceneClient(), result = client.run(input, undefined, () => {}), worker = harness.workers.at(-1)!;
  const sites = [{ id: 'a', offset: 0 }, { id: 'b', offset: 1 }] as UrbanSiteVisual[];
  for (let start = 0; start < sites.length; start++) {
    emit(worker, { id: 1, batch: { delta: empty(), requests: [], sites: [sites[start]], progress: { start, completed: start + 1, total: 2 } } });
    await vi.waitFor(() => expect(worker.messages).toContainEqual({ ack: { id: 1, completed: start + 1 } }));
  }
  const siteQuery = { source: { version: 1 as const, session: 's', terrainRevision: 't', layoutsRevision: 'l', partitionsRevision: 'p' }, seed: 'seed' };
  emit(worker, { id: 1, complete: urbanSceneCompletion(empty()), siteQuery });
  const completed = await result;
  expect(completed.requests).toBeUndefined(); expect(completed.sites).toEqual(sites); expect(completed.siteQuery).toBe(siteQuery);
  client.dispose();
});

it('assembles original sites in chunk order without a final whole-city request transfer', async () => {
  const client = createUrbanSceneClient();
  const result = client.run(input, undefined, () => {}), worker = harness.workers.at(-1)!;
  const requests = [{ id: 'first', parcel_id: 'p1' }, { id: 'second', parcel_id: 'p2' }] as PlacementRequest[];
  for (let start = 0; start < requests.length; start++) {
    emit(worker, { id: 1, batch: { delta: empty(), requests: [requests[start]],
      progress: { start, completed: start + 1, total: requests.length } } });
    await vi.waitFor(() => expect(worker.messages).toContainEqual({ ack: { id: 1, completed: start + 1 } }));
  }
  emit(worker, { id: 1, complete: urbanSceneCompletion(empty()) });
  const completed = await result;
  expect(completed.requests).toEqual(requests);
  expect(completed.requests![0]).toBe(requests[0]);
  client.dispose();

  const invalid = createUrbanSceneClient();
  const failed = invalid.run(input, undefined, () => {}), last = harness.workers.at(-1)!;
  const rejected = expect(failed).rejects.toThrow('Invalid architecture request chunk');
  emit(last, { id: 1, batch: { delta: empty(), requests: [], progress: { start: 0, completed: 1, total: 1 } } });
  await rejected;
  expect(last.messages).not.toContainEqual({ ack: { id: 1, completed: 1 } });
  invalid.dispose();
});

it('awaits partial consumers, completes with the same scene, cancels ACK waits and keeps explicit City modes compact', async () => {
  harness.workers.length = 0;
  expect(usesCompactPlans({ mode: 'detailed' })).toBe(true);
  expect(usesCompactPlans({ mode: 'compact' })).toBe(true);
  expect(usesCompactPlans({})).toBe(false);
  const client = createUrbanSceneClient();
  let release!: () => void, accumulated: PlacementBatch | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = client.run(input, undefined, async (_delta, _progress, scene) => { accumulated = scene; await gate; });
  const worker = harness.workers[0];
  expect(worker.messages[0]).toMatchObject({ mode: 'detailed', progressive: true });
  emit(worker, batch(1));
  expect(accumulated).toBeDefined();
  expect(worker.messages.some(message => 'ack' in message)).toBe(false);
  release(); await vi.waitFor(() => expect(worker.messages).toContainEqual({ ack: { id: 1, completed: 0 } }));
  emit(worker, { id: 1, complete: urbanSceneCompletion(empty()) });
  expect((await first).scene).toBe(accumulated);

  let releaseStale!: () => void;
  const staleGate = new Promise<void>(resolve => { releaseStale = resolve; });
  const stale = client.run(input, undefined, () => staleGate);
  const staleRejected = expect(stale).rejects.toMatchObject({ name: 'AbortError' });
  emit(worker, batch(2)); client.invalidate(); await staleRejected;
  releaseStale(); await Promise.resolve(); await Promise.resolve();
  expect(worker.messages).not.toContainEqual({ ack: { id: 2, completed: 0 } });
  const legacy = client.run({ ...input, mode: undefined });
  expect(worker.messages.at(-1)).toMatchObject({ id: 4, progressive: false });
  emit(worker, { id: 2, complete: urbanSceneCompletion(empty()) });
  emit(worker, { id: 4, scene: empty() }); await legacy;

  const failed = client.run(input, undefined, () => { throw new Error('consumer failed'); });
  const failedResult = expect(failed).rejects.toThrow('consumer failed');
  emit(worker, batch(5)); await failedResult;
  expect(worker.messages).toContainEqual({ cancel: 5 });
  expect(worker.messages).not.toContainEqual({ ack: { id: 5, completed: 0 } });
  const crashed = client.run(input, undefined, () => {});
  const crashedResult = expect(crashed).rejects.toThrow('worker crashed');
  emit(worker, batch(6)); await Promise.resolve();
  worker.onerror?.({ message: 'worker crashed', preventDefault() {} } as ErrorEvent);
  await crashedResult; expect(harness.engine).not.toHaveBeenCalled();
  client.dispose();

  // Exercise the actual worker message handler with a native-call stub: a
  // cancelled ACK wait must unblock the next run, even before the first ACK.
  const messages: UrbanSceneResponse[] = [];
  const workerScope = { onmessage: undefined as ((event: MessageEvent<UrbanSceneWorkerMessage>) => void) | undefined,
    postMessage(response: UrbanSceneResponse) { messages.push(response); } };
  vi.stubGlobal('self', workerScope);
  const originalSite = { id: 'original-site', config: { recipe: 'original' } } as PlacementRequest;
  harness.engine.mockResolvedValue({ run: vi.fn().mockResolvedValue({ placementRequests: [originalSite], partitions: [] }) });
  harness.streamPlan.mockImplementation(async (_input, _runtime, options) => {
    await options.onBatch?.(empty(), { start: 0, completed: 1, total: 1 }, [originalSite]);
    if (options.cancelled()) throw new DOMException('cancelled', 'AbortError');
    return urbanSceneCompletion(empty());
  });
  harness.place.mockResolvedValue(empty());
  try {
    await import('../src/ui/urbanSceneWorker');
    const send = (data: UrbanSceneWorkerMessage) => workerScope.onmessage?.({ data } as MessageEvent<UrbanSceneWorkerMessage>);
    send({ ...input, id: 101, progressive: true, buildingOverrides: { 'original-site': { recipe: 'edited', variant: 'default' } } });
    await vi.waitFor(() => expect(messages.some(message => message.id === 101 && message.batch)).toBe(true));
    expect(messages.find(message => message.id === 101 && message.batch)?.batch?.requests).toEqual([originalSite]);
    expect(harness.streamPlan.mock.calls[0][0].requests[0].config.recipe).toBe('edited');
    expect(messages.some(message => message.complete)).toBe(false);
    send({ cancel: 101 }); send({ ...input, id: 102, progressive: true });
    await vi.waitFor(() => expect(messages.some(message => message.id === 102 && message.batch)).toBe(true));
    send({ ack: { id: 101, completed: 1 } });
    await Promise.resolve(); expect(messages.some(message => message.complete)).toBe(false);
    send({ ack: { id: 102, completed: 1 } });
    await vi.waitFor(() => expect(messages.some(message => message.id === 102 && message.complete)).toBe(true));
    expect(messages.find(message => message.complete)?.scene).toBeUndefined();
    expect(messages.find(message => message.complete)?.requests).toBeUndefined();
    expect(messages.some(message => message.id === 101 && (message.complete || message.error))).toBe(false);
    expect(harness.streamPlan).toHaveBeenCalledTimes(2); expect(harness.plan).not.toHaveBeenCalled(); expect(harness.place).not.toHaveBeenCalled();
    // Non-progressive compact callers still receive the ordinary full scene.
    harness.plan.mockResolvedValue(empty());
    send({ ...input, id: 103 });
    await vi.waitFor(() => expect(messages.some(message => message.id === 103 && message.scene)).toBe(true));
    expect(harness.plan).toHaveBeenCalledTimes(1);
    send({ ...input, mode: undefined, id: 104 });
    await vi.waitFor(() => expect(messages.some(message => message.id === 104 && message.scene)).toBe(true));
    expect(harness.place).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }

  // No worker: replacement is latest-only, but a dispatched native promise
  // keeps the physical slot until it drains. Each pending run owns its raster.
  harness.plan.mockReset(); harness.place.mockClear();
  const sites = vi.fn().mockResolvedValue({ placementRequests: [] });
  harness.engine.mockResolvedValue({ run: sites });
  let releaseNative!: () => void, rejectConsumer!: (error: Error) => void;
  const nativeGate = new Promise<void>(resolve => { releaseNative = resolve; });
  const abandonedConsumer = new Promise<void>((_resolve, reject) => { rejectConsumer = reject; });
  let physical = 0, peakPhysical = 0, dispatches = 0;
  harness.plan.mockImplementation(async (_input, _runtime, options: ArchitectureBatchOptions) => {
    physical++; peakPhysical = Math.max(peakPhysical, physical);
    const dispatch = ++dispatches;
    try { if (dispatch === 1) await nativeGate; }
    finally { physical--; }
    if (options.cancelled?.()) throw new DOMException('cancelled', 'AbortError');
    await options.onBatch?.(empty(), { start: 0, completed: 0, total: 0 }, []);
    if (options.cancelled?.()) throw new DOMException('cancelled', 'AbortError');
    return empty();
  });
  const fallback = createUrbanSceneClient();
  const firstRaster = { ...input.raster }, lastRaster = { ...input.raster };
  const active = fallback.run({ ...input, seed: 'active', raster: firstRaster });
  const activeRejected = expect(active).rejects.toMatchObject({ name: 'AbortError' });
  harness.workers.at(-1)!.onerror?.({ message: 'worker unavailable', preventDefault() {} } as ErrorEvent);
  await vi.waitFor(() => expect(dispatches).toBe(1));
  const obsoleteOne = fallback.run({ ...input, seed: 'obsolete-one', raster: { ...input.raster } });
  const obsoleteOneRejected = expect(obsoleteOne).rejects.toMatchObject({ name: 'AbortError' });
  const obsoleteTwo = fallback.run({ ...input, seed: 'obsolete-two', raster: { ...input.raster } });
  const obsoleteTwoRejected = expect(obsoleteTwo).rejects.toMatchObject({ name: 'AbortError' });
  const consumeLatest = vi.fn(() => abandonedConsumer);
  const latest = fallback.run({ ...input, seed: 'latest', raster: lastRaster }, undefined, consumeLatest);
  const latestRejected = expect(latest).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.all([activeRejected, obsoleteOneRejected, obsoleteTwoRejected]);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(dispatches).toBe(1); expect(physical).toBe(1); expect(sites).toHaveBeenCalledTimes(1);
  releaseNative();
  await vi.waitFor(() => expect(consumeLatest).toHaveBeenCalledTimes(1));
  expect(dispatches).toBe(2); expect(peakPhysical).toBe(1);
  expect(sites.mock.calls.map(([request]) => request.seed)).toEqual(['active', 'latest']);
  expect(sites.mock.calls[0][0].raster).toBe(firstRaster);
  expect(sites.mock.calls[1][0].raster).toBe(lastRaster);

  // The latest native call is finished, but its consumer never resolves. A new
  // request must release this stale UI wait rather than deadlocking the queue.
  const afterConsumer = fallback.run({ ...input, seed: 'after-consumer' });
  await latestRejected;
  await vi.waitFor(() => expect(dispatches).toBe(3));
  expect((await afterConsumer).scene).toEqual(empty());
  expect(sites.mock.calls.map(([request]) => request.seed)).toEqual(['active', 'latest', 'after-consumer']);
  expect(peakPhysical).toBe(1); expect(harness.place).not.toHaveBeenCalled();
  rejectConsumer(new Error('late obsolete consumer rejection'));
  await Promise.resolve();
  fallback.dispose();
});
