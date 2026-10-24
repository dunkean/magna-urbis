import { afterEach, expect, it, vi } from 'vitest';
import javaRequest from './fixtures/native-parent-java-core-request.json';
import type { NativeParentSessionApi } from '../../rust/bridge/nativeParentSessionContract';
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
