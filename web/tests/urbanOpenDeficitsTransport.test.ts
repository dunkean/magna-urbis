import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import raw from './fixtures/open-deficit-roman04-bridge-native.json';
import type { Partition, UrbanRequest } from '../../rust/bridge/urban';
import type { PlacementBatch, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import type { ArchitectureBatchOptions } from '../../rust/bridge/architectureBatch';
import type { UrbanSceneRequest, UrbanSceneResponse, UrbanSceneWorkerMessage } from '../src/ui/urbanSceneProtocol';
const h = vi.hoisted(() => ({ engine: vi.fn(), place: vi.fn(), worker: vi.fn(), stream: vi.fn(), prepare: vi.fn() }));
vi.mock('../src/ui/urbanSceneWorker?worker&inline', () => ({ default: class { constructor() { h.worker(); throw new Error('Test forces existing fallback'); } } }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: h.engine }));
vi.mock('../../rust/bridge/architecture', () => ({ placeUrbanBuildings: h.place, planUrbanBuildings: vi.fn(), streamUrbanBuildingPlans: h.stream }));
vi.mock('../../rust/bridge/urbanOpenDeficits', async importOriginal => {
  const actual = await importOriginal<typeof import('../../rust/bridge/urbanOpenDeficits')>();
  h.prepare.mockImplementation(actual.prepareUrbanOpenDeficits);
  return { ...actual, prepareUrbanOpenDeficits: h.prepare };
});
function fixture(): { partitions: Partition[]; requests: PlacementRequest[]; scene: PlacementBatch } { return JSON.parse(JSON.stringify(raw)); }
function request(partitions: Partition[]): UrbanSceneRequest {
  return { id: 1, layouts: [], partitions, seed: 'transport-only-not-native-generation', runtime: { profile: 'local', server: 'http://transport.test' },
    raster: { width: 1, n: 1, height: new Float32Array(1), water: new Uint8Array(1), waterLevel: new Float32Array(1),
      riverWidth: new Float32Array(1), riverIds: new Int32Array(1) } };
}
beforeEach(() => { h.engine.mockReset(); h.place.mockReset(); h.worker.mockReset(); h.prepare.mockClear(); h.stream.mockReset(); h.stream.mockImplementation(() => { throw new Error('Unexpected compact stream in eager-deficit test'); }); });
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const f = fixture(), calls: UrbanRequest[] = [];
  h.engine.mockResolvedValue({ run: async (input: UrbanRequest) => {
    calls.push(input);
    return input.kind === 'buildingSites' ? { placementRequests: f.requests } : { partitions: f.partitions };
  } });
  h.place.mockImplementation(async (input: { requests: PlacementRequest[] }, _runtime: unknown, options?: ArchitectureBatchOptions) => {
    if (options?.onBatch) for (const [offset, request] of input.requests.entries()) {
      const delta = { ...f.scene, open_spaces: f.scene.open_spaces.filter(space => space.id === request.id) };
      await options.onBatch(delta, { start: offset, completed: offset + 1, total: 2 }, [request]);
    }
    return f.scene;
  });
  return { ...f, calls };
}
it('the actual main-thread fallback carries the three real-source declarations before builtCapacity AND before publishing a progressive chunk', async () => {
  const f = setup(), { createUrbanSceneClient } = await import('../src/ui/urbanScene'), client = createUrbanSceneClient();
  const chunks: PlacementBatch[] = [], input = request(f.partitions);
  try {
    const response = await client.run(input, undefined, delta => { chunks.push(delta); });
    expect(h.worker).toHaveBeenCalledOnce(); expect(h.place).toHaveBeenCalledOnce();
    expect(chunks).toHaveLength(2); expect(chunks.flatMap(chunk => chunk.open_spaces).every(s => s.deficit?.version === 'architectural-deficit-1')).toBe(true);
    expect(h.prepare).toHaveBeenCalledOnce();
    const balance = f.calls.find(call => call.kind === 'builtCapacity')!;
    expect(balance.scene!.open_spaces).toEqual(chunks.flatMap(chunk => chunk.open_spaces));
    expect(response.scene!.open_spaces).toEqual(chunks.flatMap(chunk => chunk.open_spaces));
    expect(f.scene.open_spaces.every(s => s.deficit === undefined)).toBe(true);
  } finally { client.dispose(); }
});
it('the actual worker path attaches declarations before its ACK boundary and reconciliation', async () => {
  vi.resetModules(); const f = setup(), messages: UrbanSceneResponse[] = [];
  const workerSelf: { onmessage?: (event: MessageEvent<UrbanSceneWorkerMessage>) => void; postMessage(value: UrbanSceneResponse): void } = {
    postMessage(value) { messages.push(value); },
  };
  vi.stubGlobal('self', workerSelf);
  await import('../src/ui/urbanSceneWorker');
  const input = { ...request(f.partitions), progressive: true };
  workerSelf.onmessage!({ data: input } as MessageEvent<UrbanSceneWorkerMessage>);
  await vi.waitFor(() => { expect(messages.filter(message => message.error)).toEqual([]); expect(messages.some(message => message.batch)).toBe(true); });
  const batch = messages.find(message => message.batch)!.batch!;
  expect(batch.delta.open_spaces.every(s => s.deficit?.version === 'architectural-deficit-1')).toBe(true);
  expect(f.calls.some(call => call.kind === 'builtCapacity')).toBe(false);
  expect(h.prepare).toHaveBeenCalledOnce();
  workerSelf.onmessage!({ data: { ack: { id: 1, completed: 1 } } } as MessageEvent<UrbanSceneWorkerMessage>);
  await vi.waitFor(() => { expect(messages.filter(message => message.error)).toEqual([]); expect(messages.filter(message => message.batch)).toHaveLength(2); });
  const second = messages.filter(message => message.batch)[1].batch!;
  expect(second.delta.open_spaces.every(s => s.deficit?.version === 'architectural-deficit-1')).toBe(true);
  expect(f.calls.some(call => call.kind === 'builtCapacity')).toBe(false); expect(h.prepare).toHaveBeenCalledOnce();
  workerSelf.onmessage!({ data: { ack: { id: 1, completed: 2 } } } as MessageEvent<UrbanSceneWorkerMessage>);
  await vi.waitFor(() => expect(messages.some(message => message.complete)).toBe(true));
  expect(messages.some(message => message.error)).toBe(false); expect(h.stream).not.toHaveBeenCalled();
  expect(f.calls.find(call => call.kind === 'builtCapacity')!.scene!.open_spaces).toEqual(messages.flatMap(message => message.batch?.delta.open_spaces ?? []));
  expect(h.prepare).toHaveBeenCalledOnce();
});
it('a missing real request rejects before capacity call and before any progressive outcome is published', async () => {
  const f = setup(); f.requests[0].programme!.deficit = undefined;
  const { createUrbanSceneClient } = await import('../src/ui/urbanScene'), client = createUrbanSceneClient(), chunks: PlacementBatch[] = [];
  try {
    await expect(client.run(request(f.partitions), undefined, delta => { chunks.push(delta); })).rejects.toThrow('Déficit architectural');
    expect(chunks).toHaveLength(0); expect(f.calls.some(call => call.kind === 'builtCapacity')).toBe(false);
  } finally { client.dispose(); }
});
