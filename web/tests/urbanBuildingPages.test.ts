import { afterEach, expect, it, vi } from 'vitest';
import type { PlacementBatch, PlacementBatchRequest, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import type { UrbanSourceHandle } from '../../rust/bridge/urbanSource';
import type { ArchitectureBatchHeader, ArchitectureRequestSource, ArchitectureStreamOptions } from '../../rust/bridge/architectureBatch';
import { streamArchitectureBatches, streamArchitectureSource } from '../../rust/bridge/architectureBatch';
import { beginUrbanBuildingPages, URBAN_BUILDING_PAGE_BYTES } from '../../rust/bridge/urbanBuildingPages';
import type { UrbanSceneRequest, UrbanSceneResponse, UrbanSceneWorkerMessage } from '../src/ui/urbanSceneProtocol';

const harness = vi.hoisted(() => ({ engine: vi.fn(), place: vi.fn(), streamPages: vi.fn(), streamPlans: vi.fn(), plan: vi.fn() }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: harness.engine }));
vi.mock('../../rust/bridge/architecture', () => ({ streamUrbanBuildingSource: harness.streamPages, streamUrbanBuildingPlans: harness.streamPlans,
  planUrbanBuildings: harness.plan, placeUrbanBuildings: harness.place }));
const runtime = { profile: 'local' as const, server: 'http://local.test:8811' };
const source: UrbanSourceHandle = { version: 1, session: 'session', terrainRevision: 'terrain', layoutsRevision: 'layout', partitionsRevision: 'parcel' };
const site = (id: number): PlacementRequest => ({ id: String(id), parcel_id: `parcel-${id}`, seed: `seed-${id}`, function: 'domestic',
  cadastral: [{ outer: [{ x: id, y: 0 }, { x: id + 1, y: 0 }, { x: id + 1, y: 1 }, { x: id, y: 1 }], holes: [] }],
  buildable: [{ outer: [{ x: id, y: 0 }, { x: id + 1, y: 0 }, { x: id + 1, y: 1 }, { x: id, y: 1 }], holes: [] }],
  accesses: [], terrain: { ground_z_m: 0 }, culture: { culture: 'norse', pack: 'EUR-NOR', mode: 'inspired', borrowing: null },
  neighbors: [], config: { recipe: 'original', overrides: {} } } as unknown as PlacementRequest);
const empty = (): PlacementBatch => ({ schema_version: '1', generator_version: 'page-test', buildings: [], refusals: [], open_spaces: [] });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const flush = () => new Promise<void>(done => setImmediate(done));
afterEach(() => vi.unstubAllGlobals());

it('bounds native pages, keeps handle identity, whitelists inputs and retries a short remaining budget without fetching at one byte', async () => {
  const original = site(0), wire: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/status')) return json({ service: 'magna-urbis-local', capabilities: ['urban.building-site-pages'] });
    const body = JSON.parse(String(options?.body)); wire.push(body);
    if (body.kind === 'buildingSitesBegin') return json({ ok: true, data: { sourceId: 'index', total: 1 } });
    const cost = bytes([original]);
    return json({ placementRequests: body.maxBytes < cost ? [] : [original], offset: 0, next: body.maxBytes < cost ? 0 : 1,
      total: 1, ...(body.maxBytes < cost ? { requiredBytes: cost } : {}) });
  });
  vi.stubGlobal('fetch', fetcher);
  const mutableSource = { ...source, raster: 'must not travel' };
  const pages = (await beginUrbanBuildingPages({ source: mutableSource, seed: 'same', keys: [], architectureCulture: 'norse',
    ...{ layouts: ['must not travel'], partitions: [], raster: 'must not travel' } }, runtime))!;
  expect(pages.total).toBe(1);
  expect(wire[0]).toEqual({ kind: 'buildingSitesBegin', source, seed: 'same', keys: [], architectureCulture: 'norse' });
  mutableSource.partitionsRevision = 'changed-after-begin';
  expect(await pages.read(0, 1, 1)).toEqual([]); expect(wire).toHaveLength(1);
  expect(await pages.read(0, 1, bytes([original]) - 1)).toEqual([]);
  expect(await pages.read(0, 1, bytes([original]))).toEqual([original]);
  expect(wire.slice(1).every(request => JSON.stringify(request.source) === JSON.stringify(source))).toBe(true);
  expect(wire[2]).toEqual({ kind: 'buildingSitesPage', source, sourceId: 'index', offset: 0, limit: 1, maxBytes: bytes([original]) });
  expect(pages.timing.pages).toBe(2); expect(pages.timing.readMs).toBeGreaterThanOrEqual(0);
  const before = wire.length;
  for (const args of [[-1, 1, 10], [2, 1, 10], [0, 65, 10], [0, 1, 0], [0, 1, URBAN_BUILDING_PAGE_BYTES + 1]]) {
    await expect(pages.read(args[0], args[1], args[2])).rejects.toThrow('page bounds');
  }
  expect(wire).toHaveLength(before);
});

it('falls back only for a missing capability and rejects stale, drifting, oversized and non-progressing page replies', async () => {
  let advertised = false, body: unknown = { sourceId: 'index', total: 1 }, postCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/status')) return json({ service: 'magna-urbis-local', capabilities: advertised ? ['urban.building-site-pages'] : [] });
    postCount++; return json(body);
  }));
  const input = { source, seed: 'same' };
  expect(await beginUrbanBuildingPages(input, runtime)).toBeUndefined(); expect(postCount).toBe(0);
  advertised = true;
  body = { ok: false, error: 'stale retained source' };
  await expect(beginUrbanBuildingPages(input, runtime)).rejects.toThrow('stale retained source'); expect(postCount).toBe(1);
  body = { sourceId: 'index', total: 1 };
  const pages = (await beginUrbanBuildingPages(input, runtime))!;
  const valid = { placementRequests: [site(0)], offset: 0, next: 1, total: 1 };
  for (const invalid of [{ ...valid, offset: 1 }, { ...valid, next: 0 }, { ...valid, total: 2 },
    { ...valid, placementRequests: [site(0), site(0)] }, { placementRequests: [], offset: 0, next: 0, total: 1 }]) {
    body = invalid; await expect(pages.read(0, 1, 4096)).rejects.toThrow();
  }
  body = valid; await expect(pages.read(0, 1, bytes([site(0)]) - 1)).rejects.toThrow('byte budget');
  body = { placementRequests: [], offset: 0, next: 0, total: 1, requiredBytes: URBAN_BUILDING_PAGE_BYTES + 1 };
  await expect(pages.read(0, 1, URBAN_BUILDING_PAGE_BYTES)).rejects.toThrow('transport budget');
  body = { error: 'page index replaced' }; await expect(pages.read(0, 1, 4096)).rejects.toThrow('page index replaced');
});

it('requires both cold capabilities before native Begin while retaining legacy pagination behavior', async () => {
  let capabilities: string[] = []; const wire: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/status')) return json({ service: 'magna-urbis-local', capabilities });
    wire.push(JSON.parse(String(options?.body))); return json({ sourceId: 'strict-pages', total: 0 });
  }));
  for (const missing of [[], ['urban.building-site-pages'], ['urban.building-site-read']]) {
    capabilities = missing;
    await expect(beginUrbanBuildingPages({ source, seed: 'strict' }, runtime, { requireSiteRead: true })).rejects.toThrow('full-site fallback is forbidden');
    expect(wire).toEqual([]);
  }
  capabilities = []; expect(await beginUrbanBuildingPages({ source, seed: 'legacy' }, runtime)).toBeUndefined();
  capabilities = ['urban.building-site-pages']; const legacy = await beginUrbanBuildingPages({ source, seed: 'legacy' }, runtime);
  expect(legacy?.siteQuery).toBeUndefined(); expect(wire).toHaveLength(1);
  capabilities = ['urban.building-site-pages', 'urban.building-site-read'];
  const strict = await beginUrbanBuildingPages({ source, seed: 'strict' }, runtime, { requireSiteRead: true });
  expect(strict?.siteQuery).toMatchObject({ source, seed: 'strict' }); expect(wire).toHaveLength(2);
});

it('streams pages through the actual worker with original edits, ACK backpressure, cancellation and legacy-only capability fallback', async () => {
  const requests = Array.from({ length: 65 }, (_, id) => site(id));
  const messages: UrbanSceneResponse[] = [], calls: Record<string, unknown>[] = [];
  let capability = true, lightweight = false, staleBegin = false, index = 0;
  const scope = { onmessage: undefined as ((event: MessageEvent<UrbanSceneWorkerMessage>) => void) | undefined,
    postMessage(message: UrbanSceneResponse) { messages.push(structuredClone(message)); } };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/status')) return json({ service: 'magna-urbis-local', capabilities: capability ? ['urban.building-site-pages', ...(lightweight ? ['urban.building-site-read'] : [])] : [] });
    const body = JSON.parse(String(options?.body)); calls.push(body);
    if (body.kind === 'buildingSitesBegin') return staleBegin ? json({ error: 'stale retained source' }, 409) : json({ sourceId: `index-${++index}`, total: requests.length });
    if (body.kind !== 'buildingSitesPage') throw new Error('Unexpected native route in paged test');
    const page = requests.slice(body.offset, body.offset + body.limit);
    return json({ placementRequests: page, offset: body.offset, next: body.offset + page.length, total: requests.length });
  }));
  const nativePlan = vi.fn(async (input: PlacementBatchRequest): Promise<PlacementBatch> => ({ ...empty(),
    open_spaces: input.requests.map(request => ({ id: request.id, parcel_id: request.parcel_id, surface: request.cadastral })) }));
  harness.streamPages.mockImplementation((input: ArchitectureBatchHeader, source: ArchitectureRequestSource, _runtime, options: ArchitectureStreamOptions) =>
    streamArchitectureSource(input, source, nativePlan, options));
  harness.streamPlans.mockImplementation((input: PlacementBatchRequest, _runtime, options: ArchitectureStreamOptions) =>
    streamArchitectureBatches(input, nativePlan, options));
  const legacyRun = vi.fn().mockResolvedValue({ placementRequests: [requests[0]] });
  harness.engine.mockResolvedValue({ run: legacyRun });
  await import('../src/ui/urbanSceneWorker');
  const send = (data: UrbanSceneWorkerMessage) => scope.onmessage!({ data } as MessageEvent<UrbanSceneWorkerMessage>);
  const input = { seed: 'same', runtime, source, keys: ['city'], mode: 'detailed' as const, progressive: true,
    settings: { culture: 'norse' }, buildingOverrides: { '0': { recipe: 'edited', variant: 'variant' }, '64': { recipe: 'edited-last', variant: 'variant' } } };
  send({ ...input, id: 1 });
  await vi.waitFor(() => expect(messages.find(message => message.id === 1 && message.batch)?.batch?.progress.completed).toBe(64));
  expect(messages.find(message => message.batch)?.batch?.requests[0].config?.recipe).toBe('original');
  expect(nativePlan.mock.calls[0][0].requests[0].config?.recipe).toBe('edited');
  expect(calls.filter(call => call.kind === 'buildingSitesPage')).toHaveLength(1);
  await flush(); expect(nativePlan).toHaveBeenCalledTimes(1); expect(messages.some(message => message.complete)).toBe(false);
  send({ ack: { id: 1, completed: 64 } });
  await vi.waitFor(() => expect(messages.find(message => message.batch?.progress.start === 64)?.batch?.requests[0].config?.recipe).toBe('original'));
  expect(nativePlan.mock.calls[1][0].requests[0].config?.recipe).toBe('edited-last');
  send({ ack: { id: 1, completed: 65 } });
  await vi.waitFor(() => expect(messages.find(message => message.id === 1 && message.complete)?.complete?.open_spaces).toBe(65));
  const completion = messages.find(message => message.id === 1 && message.complete)!;
  expect(completion).not.toHaveProperty('scene'); expect(completion).not.toHaveProperty('requests');
  expect(completion.timing?.paged).toBe(true);
  expect(completion.timing!.sites).toBeCloseTo(completion.timing!.sitesPrepare! + completion.timing!.sitesRead!, 8);
  expect(completion.timing!.placement).toBeGreaterThanOrEqual(0); expect(harness.engine).not.toHaveBeenCalled();
  expect(calls.every(call => !('raster' in call || 'layouts' in call || 'partitions' in call))).toBe(true);

  send({ ...input, id: 2 });
  await vi.waitFor(() => expect(messages.some(message => message.id === 2 && message.batch)).toBe(true));
  const readsBeforeCancel = calls.filter(call => call.kind === 'buildingSitesPage').length;
  send({ cancel: 2 }); await flush();
  expect(calls.filter(call => call.kind === 'buildingSitesPage')).toHaveLength(readsBeforeCancel);
  expect(messages.some(message => message.id === 2 && (message.complete || message.error))).toBe(false);

  capability = false; send({ ...input, id: 3 });
  await vi.waitFor(() => expect(messages.some(message => message.id === 3 && message.batch)).toBe(true));
  expect(legacyRun).toHaveBeenCalledTimes(1); expect(harness.streamPlans).toHaveBeenCalledTimes(1);
  send({ ack: { id: 3, completed: 1 } });
  await vi.waitFor(() => expect(messages.some(message => message.id === 3 && message.complete)).toBe(true));
  capability = true; staleBegin = true; send({ ...input, id: 4 });
  await vi.waitFor(() => expect(messages.find(message => message.id === 4)?.error).toContain('stale retained source'));
  expect(legacyRun).toHaveBeenCalledTimes(1); expect(harness.streamPlans).toHaveBeenCalledTimes(1);
  expect(harness.streamPages).toHaveBeenCalledTimes(2);
  // A capable server sends only original previews to main; overrides still go
  // to the native planner and ACK keeps the next page bounded as before.
  staleBegin = false; lightweight = true; send({ ...input, id: 5, requireProjectedSiteStream: true });
  await vi.waitFor(() => expect(messages.some(message => message.id === 5 && message.batch)).toBe(true));
  const projected = messages.find(message => message.id === 5 && message.batch)!.batch!;
  expect(projected.requests).toEqual([]); expect(projected.sites).toHaveLength(64);
  expect(projected.sites![0]).toMatchObject({ id: '0', offset: 0, surface: requests[0].buildable });
  expect(projected.sites![0]).not.toHaveProperty('config'); expect(projected.sites![0]).not.toHaveProperty('cadastral');
  expect(nativePlan.mock.calls.at(-1)![0].requests[0].config?.recipe).toBe('edited');
  const pageCount = calls.filter(call => call.kind === 'buildingSitesPage').length;
  await flush(); expect(calls.filter(call => call.kind === 'buildingSitesPage')).toHaveLength(pageCount);
  send({ ack: { id: 5, completed: 64 } });
  await vi.waitFor(() => expect(messages.some(message => message.id === 5 && message.batch?.progress.start === 64)).toBe(true));
  expect(nativePlan.mock.calls.at(-1)![0].requests[0].config?.recipe).toBe('edited-last');
  send({ ack: { id: 5, completed: 65 } });
  await vi.waitFor(() => expect(messages.some(message => message.id === 5 && message.complete)).toBe(true));
  expect(messages.find(message => message.id === 5 && message.complete)?.siteQuery).toEqual({ source, keys: ['city'], seed: 'same', architectureCulture: 'norse' });
});

it('rejects missing cold capabilities and malformed flagged worker messages without full-site or house calls', async () => {
  vi.resetModules(); Object.values(harness).forEach(mock => mock.mockClear());
  const messages: UrbanSceneResponse[] = [], wire: Record<string, unknown>[] = []; let capabilities: string[] = [];
  const scope = { onmessage: undefined as ((event: MessageEvent<UrbanSceneWorkerMessage>) => void) | undefined,
    postMessage(message: UrbanSceneResponse) { messages.push(message); } };
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/status')) return json({ service: 'magna-urbis-local', capabilities });
    wire.push(JSON.parse(String(options?.body))); throw new Error('Cold guard made an unexpected native Begin/read.');
  });
  vi.stubGlobal('self', scope); vi.stubGlobal('fetch', fetcher);
  await import('../src/ui/urbanSceneWorker');
  const base = { id: 0, seed: 'strict', source, runtime, keys: ['city'], mode: 'compact' as const,
    progressive: true, requireProjectedSiteStream: true as const };
  const invalid: UrbanSceneRequest[] = [
    { ...base, id: 1, source: undefined, layouts: [], partitions: [] },
    { ...base, id: 2, runtime: { ...runtime, profile: 'web' } },
    { ...base, id: 3, mode: 'silhouette' }, { ...base, id: 4, mode: undefined },
    { ...base, id: 5, progressive: false }, { ...base, id: 6, progressive: undefined },
    { ...base, id: 7, requireProjectedSiteStream: false } as unknown as UrbanSceneRequest,
  ];
  for (const request of invalid) {
    scope.onmessage!({ data: request } as MessageEvent<UrbanSceneWorkerMessage>);
    await vi.waitFor(() => expect(messages.find(message => message.id === request.id)?.error).toContain('Projected site streams require'));
  }
  expect(fetcher).not.toHaveBeenCalled();
  for (const [i, missing] of [[], ['urban.building-site-pages'], ['urban.building-site-read']].entries()) {
    capabilities = missing; const id = i + 8;
    scope.onmessage!({ data: { ...base, id } } as MessageEvent<UrbanSceneWorkerMessage>);
    await vi.waitFor(() => expect(messages.find(message => message.id === id)?.error).toContain('full-site fallback is forbidden'));
  }
  expect(fetcher).toHaveBeenCalledTimes(3); expect(wire).toEqual([]);
  expect(messages.every(message => !message.scene && !message.batch && !message.complete)).toBe(true);
  for (const mock of Object.values(harness)) expect(mock).not.toHaveBeenCalled();
});
