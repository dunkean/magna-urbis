import { expect, it, vi } from 'vitest';
import type { Layout, Partition, UrbanRequest } from '../../rust/bridge/urban';
import type { SettlementRaster } from '../../rust/bridge/settlements';
import type { UrbanSourceHandle } from '../../rust/bridge/urbanSource';
import type { UrbanSceneRequest, UrbanSceneResponse, UrbanSceneWorkerMessage } from '../src/ui/urbanSceneProtocol';

interface FakeWorker { messages: UrbanSceneWorkerMessage[]; onmessage?: (event: MessageEvent<UrbanSceneResponse>) => void; terminate(): void }
const harness = vi.hoisted(() => ({ workers: [] as FakeWorker[], engine: vi.fn() }));
vi.mock('../src/ui/urbanSceneWorker?worker&inline', () => ({ default: class {
  messages: UrbanSceneWorkerMessage[] = [];
  onmessage?: FakeWorker['onmessage'];
  constructor() { harness.workers.push(this); }
  postMessage(message: UrbanSceneWorkerMessage) { this.messages.push(structuredClone(message)); }
  terminate() {}
} }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: harness.engine }));

import { createUrbanSceneClient } from '../src/ui/urbanScene';
import { RASTER_MISSING } from '../src/ui/urbanSceneProtocol';
import { createUrbanSourceBinding } from '../src/ui/urbanSourceBinding';

const runtime = { profile: 'local' as const, server: 'http://127.0.0.1:8810' };
const source: UrbanSourceHandle = { version: 1, session: 'urban-worker', terrainRevision: 't1', layoutsRevision: 'l2', partitionsRevision: 'p3' };
const empty = () => ({ schema_version: '1' as const, generator_version: 'native-test', buildings: [], refusals: [], open_spaces: [] });
const emit = (worker: FakeWorker, response: UrbanSceneResponse) => worker.onmessage?.({ data: response } as MessageEvent<UrbanSceneResponse>);

it('clones only source metadata into the worker and never resends geometry on a source error', async () => {
  const client = createUrbanSceneClient();
  // A real structured clone would reject these retained geometry sentinels.
  const layouts = [{ key: 'city', uncloneable() {} }] as unknown as Layout[];
  const partitions = [{ key: 'city', uncloneable() {} }] as unknown as Partition[];
  const raster = { uncloneable() {} } as unknown as SettlementRaster;
  const result = client.run({ layouts, partitions, raster, source, keys: ['city'], runtime, seed: 'same', mode: 'compact' });
  const failed = expect(result).rejects.toThrow(RASTER_MISSING), worker = harness.workers.at(-1)!;
  expect(worker.messages[0]).toMatchObject({ id: 1, source, keys: ['city'], runtime });
  for (const field of ['layouts', 'partitions', 'raster']) expect(worker.messages[0]).not.toHaveProperty(field);
  await expect(client.run({ source, keys: ['city', 'city'], runtime, seed: 'bad', mode: 'compact' })).rejects.toThrow('Invalid retained urban city keys');
  expect(worker.messages).toHaveLength(1); // Invalid input must not orphan the valid pending run.
  emit(worker, { id: 1, error: RASTER_MISSING });
  await failed;
  expect(worker.messages.filter(message => 'seed' in message)).toHaveLength(1);
  expect(harness.engine).not.toHaveBeenCalled();

  const legacy = client.run({ layouts: [], partitions: [], raster: {} as SettlementRaster, runtime, seed: 'legacy', mode: 'compact' });
  expect(worker.messages.at(-1)).toMatchObject({ id: 2, layouts: [], partitions: [], raster: {} });
  expect(worker.messages.at(-1)).not.toHaveProperty('source');
  emit(worker, { id: 2, scene: empty() }); await legacy;
  client.dispose();
});

it('reads building sites by handle without terrain, preserves legacy geometry and reports stale sources without retry', async () => {
  const run = vi.fn<(request: UrbanRequest) => Promise<Record<string, unknown>>>().mockResolvedValue({ placementRequests: [] });
  harness.engine.mockResolvedValue({ run });
  const messages: UrbanSceneResponse[] = [];
  const scope = { onmessage: undefined as ((event: MessageEvent<UrbanSceneWorkerMessage>) => void) | undefined,
    postMessage(message: UrbanSceneResponse) { messages.push(message); } };
  vi.stubGlobal('self', scope);
  try {
    await import('../src/ui/urbanSceneWorker');
    const send = (request: UrbanSceneRequest) => scope.onmessage?.({ data: request } as MessageEvent<UrbanSceneWorkerMessage>);
    send({ id: 1, seed: 'same', runtime, source, keys: ['city'], mode: 'silhouette' });
    await vi.waitFor(() => expect(messages.some(message => message.id === 1 && message.scene)).toBe(true));
    expect(run.mock.calls[0][0]).toMatchObject({ kind: 'buildingSites', source, keys: ['city'] });
    for (const field of ['layouts', 'partitions', 'raster']) expect(run.mock.calls[0][0]).not.toHaveProperty(field);

    const raster = {} as SettlementRaster, layouts = [{ key: 'old' }] as Layout[], partitions = [{ key: 'old' }] as Partition[];
    send({ id: 2, seed: 'legacy', runtime, raster, layouts, partitions, mode: 'silhouette' });
    await vi.waitFor(() => expect(messages.some(message => message.id === 2 && message.scene)).toBe(true));
    expect(run.mock.calls[1][0]).toMatchObject({ raster, layouts, partitions });
    expect(run.mock.calls[1][0]).not.toHaveProperty('source');

    run.mockResolvedValueOnce({ error: 'stale retained urban source' });
    send({ id: 3, seed: 'same', runtime, source, keys: ['city'], mode: 'silhouette' });
    await vi.waitFor(() => expect(messages.find(message => message.id === 3)?.error).toContain('source urbaine retenue impossible'));
    expect(messages.find(message => message.id === 3)?.error).toContain('stale retained urban source');
    expect(run).toHaveBeenCalledTimes(3);
  } finally { vi.unstubAllGlobals(); }
});

it('binds exact applied references and runtime, preserves native subset order and invalidates restored or changed data', () => {
  const binding = createUrbanSourceBinding();
  const layouts = [{ key: 'b' }, { key: 'a' }] as Layout[], partitions = [{ key: 'a' }, { key: 'b' }] as Partition[], terrain = {};
  const input = { layouts, partitions, terrain, runtime, keys: ['a', 'b'] };
  const bind = () => binding.bind({ ...input, source, nativeLayouts: layouts.slice(), nativePartitions: partitions.slice() });
  bind(); expect(binding.select(input)).toEqual({ source, keys: ['b', 'a'] });
  expect(binding.select({ ...input, keys: ['a'] })).toEqual({ source, keys: ['a'] });
  expect(binding.select({ ...input, keys: ['missing'] })).toBeUndefined();
  expect(binding.select({ ...input, layouts: layouts.slice() })).toBeUndefined();
  expect(binding.select({ ...input, partitions: partitions.slice() })).toBeUndefined();
  expect(binding.select({ ...input, terrain: {} })).toBeUndefined();
  expect(binding.select({ ...input, runtime: { ...runtime, server: 'http://127.0.0.1:9999' } })).toBeUndefined();
  expect(binding.select({ ...input, runtime: { ...runtime, profile: 'web' } })).toBeUndefined();
  partitions[0] = { key: 'a' } as Partition;
  expect(binding.select(input)).toBeUndefined();
  bind(); binding.clear(); expect(binding.select(input)).toBeUndefined();
  binding.bind({ ...input, nativeLayouts: layouts, nativePartitions: partitions });
  expect(binding.select(input)).toBeUndefined(); // Older local runtimes/WASM provide no handle.
});
