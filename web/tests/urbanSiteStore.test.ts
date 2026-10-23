import { afterEach, expect, it, vi } from 'vitest';
import { createNativeSiteStore, projectUrbanSite } from '../src/ui/urbanSiteStore';
import { siteVisualScene } from '../src/ui/urbanSilhouettes';
import { createCityComparison } from '../src/ui/cityComparison';
import { styledRequest, floorsFor } from '../src/ui/cityEdits';
import { editArchitectureScene } from '../../rust/bridge/architectureEdits';
import { readUrbanBuildingSite, type UrbanBuildingSiteQuery } from '../../rust/bridge/urbanBuildingSite';
import type { PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';

const runtime = { profile: 'local' as const, server: 'http://native.test:8813' };
const query = (): UrbanBuildingSiteQuery => ({ source: { version: 1, session: 'session', terrainRevision: 'terrain', layoutsRevision: 'layouts', partitionsRevision: 'parcels' },
  keys: ['city'], seed: 'original', architectureCulture: 'bastide' });
const surface: Surface = [{ outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  holes: [[{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }]] }];
const site = (id = 'a'): PlacementRequest & { preview: Surface } => ({ id, parcel_id: `parcel-${id}`, seed: 'site-seed', function: 'domestic',
  culture: { culture: 'bastide', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
  cadastral: surface, buildable: surface, preview: surface, reserves: [], party_boundaries: [], neighbors: [],
  terrain: { origin: { x: 0, y: 0 }, ground_z_m: 2, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 },
  accesses: [{ id: 'access', kind: 'public', width_m: 2, segment: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }],
  config: { recipe: 'original', overrides: { floors: 3 } } } as unknown as PlacementRequest & { preview: Surface });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

it('projects only exact city preview data and preserves holes, access, programme and open-space fallback', () => {
  const original = site(); original.programme = { landmark: true, households: 4 };
  for (const key of ['cadastral', 'reserves', 'roof_domain', 'config', 'neighbors']) Object.defineProperty(original, key, { get() { throw new Error(`Heavy field read: ${key}`); } });
  const projected = projectUrbanSite(original, 7);
  expect(projected.surface).toBe(surface); expect(projected.surface[0].holes).toBe(surface[0].holes);
  expect(projected).toMatchObject({ offset: 7, preview: true, entrance: { x: 1, y: 0 }, ground_z_m: 2, programme: { landmark: true } });
  expect(Object.keys(projected).sort()).toEqual(['access_id', 'culture', 'entrance', 'function', 'ground_z_m', 'id', 'offset', 'parcel_id', 'preview', 'programme', 'surface'].sort());
  const rendered = siteVisualScene([projected]).buildings[0];
  expect(rendered.footprint).toBe(surface); expect(rendered.useful_area_m2).toBe(99); expect(rendered.diagnostics).toEqual(['silhouette:preview']);
  const open = { ...site('open'), function: 'open_space' as const, preview: [], placement_hint: [{ outer: [{ x: 100, y: 100 }], holes: [] }] };
  expect(siteVisualScene([projectUrbanSite(open, 0)]).open_spaces[0].surface).toBe(open.buildable);
});

it('reads an old descriptor without begin/sourceId, validates identity/budgets and propagates stale errors', async () => {
  const input = query(), requests: Record<string, unknown>[] = []; let reply: unknown = { placementRequest: site(), offset: 0, total: 1 };
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => { requests.push(JSON.parse(options.body)); return json(reply); }));
  expect((await readUrbanBuildingSite(input, runtime, 0, 'a', 1)).config?.recipe).toBe('original');
  expect(requests[0]).toEqual({ kind: 'buildingSite', ...query(), offset: 0, expectedId: 'a', maxBytes: 24 * 1024 * 1024 });
  // A newer pagination descriptor does not participate in this old scene's read.
  const other = { ...query(), seed: 'new-page-query' };
  await readUrbanBuildingSite(other, runtime, 0, 'a', 1);
  await readUrbanBuildingSite(input, runtime, 0, 'a', 1);
  expect(requests.map(r => r.seed)).toEqual(['original', 'new-page-query', 'original']);
  expect(requests.every(r => r.kind === 'buildingSite' && !('sourceId' in r) && !('layouts' in r) && !('raster' in r))).toBe(true);
  for (const wrong of [{ placementRequest: site('other'), offset: 0, total: 1 }, { placementRequest: site(), offset: 1, total: 1 }, { placementRequest: site(), offset: 0, total: 2 }]) {
    reply = wrong; await expect(readUrbanBuildingSite(input, runtime, 0, 'a', 1)).rejects.toThrow('identity');
  }
  reply = { placementRequest: site(), offset: 0, total: 1 };
  await expect(readUrbanBuildingSite(input, runtime, 0, 'a', 1, 2)).rejects.toThrow('budget');
  reply = { error: '[urban_source_stale]' };
  await expect(readUrbanBuildingSite(input, runtime, 0, 'a', 1)).rejects.toThrow('urban_source_stale');
  expect(requests.every(r => r.kind === 'buildingSite')).toBe(true);
});

it('bounds the selected-site LRU, coalesces reads, snapshots the descriptor and discards reads after invalidation', async () => {
  const originals = [site('a'), site('b'), site('c')], input = query(), sent: UrbanBuildingSiteQuery[] = [];
  const read = vi.fn(async (descriptor, _runtime, offset) => { sent.push(descriptor); return originals[offset]; });
  const store = createNativeSiteStore(originals.map(projectUrbanSite), input, runtime, { read, maxEntries: 1, maxBytes: 4096 });
  input.seed = 'mutated'; input.keys!.push('other'); input.source.partitionsRevision = 'mutated';
  const [a, same] = await Promise.all([store.read('a'), store.read('a')]); expect(a).toBe(same); expect(read).toHaveBeenCalledTimes(1);
  expect(sent[0]).toEqual(query()); expect(store.matchesRuntime({ ...runtime, server: `${runtime.server}/` })).toBe(true);
  expect(store.matchesRuntime({ ...runtime, server: 'http://another.test' })).toBe(false);
  await store.read('b'); expect(store.stats.cached).toBe(1); expect(store.stats.bytes).toBeLessThanOrEqual(4096);
  await store.read('a'); expect(read).toHaveBeenCalledTimes(3);
  let release!: (value: PlacementRequest) => void;
  const blocked = createNativeSiteStore(originals.map(projectUrbanSite), query(), runtime, { read: () => new Promise(done => { release = done; }) });
  const pending = blocked.read('c'); await Promise.resolve(); expect(blocked.stats.inFlight).toBe(1);
  blocked.dispose(); expect(blocked.stats.inFlight).toBe(1); expect(blocked.has('c')).toBe(false);
  release(originals[2]); await expect(pending).rejects.toThrow('périmé'); expect(blocked.stats).toMatchObject({ cached: 0, bytes: 0, inFlight: 0 });
  const tiny = createNativeSiteStore(originals.map(projectUrbanSite), query(), runtime, { read, maxBytes: 1 });
  await tiny.read('a'); expect(tiny.stats.cached).toBe(0);
});

it('keeps original config and the committed store usable after a refused scoped edit', async () => {
  const original = site(), store = createNativeSiteStore([projectUrbanSite(original, 0)], query(), runtime, { read: async () => original });
  const previous = siteVisualScene(store.visuals), fetched = await store.read('a');
  const edit = { recipe: 'chosen', variant: 'stone', floors: floorsFor(fetched, [1, 2]) };
  const edited = styledRequest(fetched, edit);
  expect(edited.config).toMatchObject({ recipe: 'chosen', overrides: { variant: 'stone', floors: 2 } });
  const result = await editArchitectureScene(previous, [edited], async () => ({ schema_version: '1', generator_version: previous.generator_version,
    buildings: [], open_spaces: [], refusals: [{ id: 'a', parcel_id: 'parcel-a', code: 'no_fit', message: 'No fit', attempts: 1 }] }));
  expect(result.applied).toBe(false); expect(result.scene).toBe(previous); expect(store.has('a')).toBe(true);
  expect(await store.read('a')).toBe(original); expect(original.config).toMatchObject({ recipe: 'original', overrides: { floors: 3 } });
});

it('compares the retained preview and plans with no site read, and refuses a changed scene even with identical IDs', () => {
  const read = vi.fn(async () => { throw new Error('Unexpected read during comparison'); });
  const store = createNativeSiteStore([projectUrbanSite(site(), 0)], query(), runtime, { read });
  const state = { layouts: [], partitions: [], scene: siteVisualScene(store.visuals), requests: store.visuals };
  const comparison = createCityComparison({ current: () => ({ ...state }), silhouette: sites => siteVisualScene(sites as typeof store.visuals), repaint() {} });
  const identity = comparison.api.begin().identity;
  for (const mode of [{ renderView: 'parcels', architecture: 'compact' }, { renderView: 'buildings', architecture: 'silhouette' }, { renderView: 'buildings', architecture: 'compact' }] as const) {
    expect(comparison.api.show(mode).identity).toEqual(identity);
  }
  expect(comparison.state()!.silhouette.buildings[0].footprint).toBe(surface);
  expect(read).not.toHaveBeenCalled();
  state.scene = { ...state.scene };
  expect(() => comparison.api.show({ renderView: 'buildings', architecture: 'compact' })).toThrow('modifiées');
  expect(read).not.toHaveBeenCalled();
});
