import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeOptions } from '../src/gen/options';
import { generateRustTown, rustSettlementRaster } from '../src/v2/rustUrban';
import type { World } from '../src/gen/types';
import type { V2Settings } from '../src/v2/contracts';
import type { PlacementBatch, PlacementBatchRequest, PlacedBuilding, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import type { Partition } from '../../rust/bridge/urban';
import deficitFixture from './fixtures/open-deficit-roman04-bridge-native.json';
import { showCityStageOutput } from '../src/v2/cityStageOutput';
import { nativeCitiesOf, nativeCityRecords } from '../src/v2/nativeProducts';

const native = vi.hoisted(() => ({ run: vi.fn(), plan: vi.fn() }));
vi.mock('../../rust/bridge/urban', () => ({ createUrbanEngine: async () => ({ run: native.run }) }));
vi.mock('../../rust/bridge/architecture', () => ({ planUrbanBuildings: native.plan }));
const square = (x = 0) => ({ outer: [{ x, y: 0 }, { x: x + 8, y: 0 }, { x: x + 8, y: 8 }, { x, y: 8 }], holes: [] });
function building(parcel: string, floors: number): PlacedBuilding {
  return { id: `building-${parcel}`, parcel_id: parcel, function: 'domestic', culture: { culture: 'roman-core', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null }, recipe_id: 'EUR-MED-B01', variant_id: 'default', transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 }, ground_z_m: 0,
    footprint: [square()], roof_footprint: [square()], courtyards: [], circulation: [], entrance: { x: 0, y: 0 }, access_id: 'front',
    volumes: [{ id: 'body', z_m: 0, wall_height_m: floors * 3, roof_height_m: 2, roof_system: 'RF-GABLE', levels: Array.from({ length: floors }, () => ({})), materials: { infill: 'stone' } }],
    useful_area_m2: 64, domestic_units: 1, structural_features: [], simplification: 'architectural_plan', diagnostics: [], resolved: { archive_id: 'native-retained-plan' } } as unknown as PlacedBuilding;
}
function fixture() {
  const options = makeOptions({ seed: 'COW-native-retention', culture: 'roman-core', population: 50, coast: 'none', river: 'none' });
  const settings: V2Settings = { options, extent: 100, settlementCount: 1, local: {}, generation: 'procedural', urban: { backend: 'rust' } };
  const heights = new Float32Array(4), world = { seed: options.seed, options, mapSize: 100, terrain: { height: { w: 2, h: 2, cell: 50, data: heights }, water: new Uint8Array(4), filled: heights, seaLevel: 0, coastline: [], lakes: [], rivers: [] },
    settlements: [{ key: 'main', center: { x: 50, y: 50 }, population: 50, radius: 20, culture: 'roman-core' }], stats: { 'v2.terrainKey': options.seed } } as unknown as World;
  return { settings, world };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
beforeEach(() => {
  native.run.mockReset().mockImplementation(async request => {
    if (request.kind === 'quarters') return { layouts: [{ key: 'main', culture: 'roman-core', center: { x: 0, y: 0 }, quarters: [{ shape: square(), phase: 0 }], blocks: [], streets: [], warnings: [] }] };
    if (request.kind === 'parcels') return { partitions: [{ key: 'main', parcels: [], warnings: [] }] };
    if (request.kind === 'programme' || request.kind === 'builtCapacity') return { partitions: request.partitions.map((partition: object) => ({ ...partition, programme: { demands: [], builtBalance: request.kind === 'builtCapacity' ? { exactScene: true } : undefined } })) };
    if (request.kind === 'buildingSites') return { placementRequests: ['p0', 'p1'].map((parcel, i) => ({ id: `${parcel}/request`, parcel_id: parcel, seed: parcel, culture: { pack: 'EUR-MED', mode: 'historical_inspired' }, cadastral: [square(i * 20)], neighbors: [] })) };
    throw new Error(`Unexpected native request ${request.kind}`);
  });
  native.plan.mockReset().mockImplementation(async (batch: PlacementBatchRequest): Promise<PlacementBatch> => ({ schema_version: '1', generator_version: 'architectural-plans-2', buildings: batch.requests.map(request => building(request.parcel_id, batch.settings?.floors ?? request.config?.overrides.floors ?? 1)), refusals: [], open_spaces: [], plan_archives: { 'native-retained-plan': 'exact-retained-native-archive' } }));
});
describe('immutable retained native stages', () => {
  it('shows the chosen city stage as layers without discarding native downstream products', async () => {
    const { world, settings } = fixture(), first = await generateRustTown(world, settings, 'main');
    const layout = first.snapshot.layouts[0];
    layout.streets = [0, 2].map(rank => ({ rank, role: 'street', path: [{ x: 1, y: 1 }, { x: 7, y: 7 }], widths: [3, 3] }));
    layout.blocks = [{ shape: square(), quarter: 0, kind: 'block', zone: 'core', axis: { x: 1, y: 0 } }];
    world.debug = { v2RustCities: { main: freeze(first.snapshot) } };
    world.settlements![0].main = true;
    const source = structuredClone(world);
    const composition = showCityStageOutput(world, 'city-composition', ['main']);
    const streets = showCityStageOutput(world, 'city-roads', ['main']);
    const blocks = showCityStageOutput(world, 'city-quarters', ['main']);
    expect(composition.urban!.streets).toHaveLength(1); expect(composition.urban!.blocks).toHaveLength(0);
    expect(streets.urban!.streets).toHaveLength(2); expect(streets.urban!.blocks).toHaveLength(0);
    expect(blocks.urban!.blocks).toHaveLength(1);
    expect(nativeCitiesOf(composition)[0].layouts[0].blocks).toHaveLength(0);
    expect(nativeCitiesOf(composition)[0].layouts[0].streets).toHaveLength(1);
    expect(nativeCitiesOf(streets)[0].partitions).toBeUndefined();
    expect(nativeCitiesOf(blocks)[0].layouts[0].blocks).toHaveLength(1);
    expect(nativeCityRecords(composition)!.main.scene).toBe(first.snapshot.scene);
    expect(first.snapshot.scene!.buildings).toHaveLength(2); expect(world).toEqual(source);
  });
  it('rerolls internal streets with native quarter salts while retaining the exact composition snapshot and seed', async () => {
    const { world, settings } = fixture(), first = await generateRustTown(world, settings, 'main');
    world.debug = { v2RustCities: { main: freeze(first.snapshot) } };
    native.run.mockClear();
    settings.urban!.local = { main: { seeds: { streets: 'streets-only' } } };
    const next = await generateRustTown(world, settings, 'main');
    expect(next.snapshot.compositionLayouts).toBe(first.snapshot.compositionLayouts);
    expect(next.snapshot.compositionKey).toBe(first.snapshot.compositionKey);
    expect(next.snapshot.layoutKey).not.toBe(first.snapshot.layoutKey);
    const redraw = native.run.mock.calls[0][0];
    expect(redraw.kind).toBe('quarters'); expect(redraw.seed).toBe(settings.options.seed);
    expect(redraw.layoutConfig.overrides.quarters['0'].salt).toBeGreaterThan(0);
    expect(native.run.mock.calls.filter(([r]) => r.kind === 'quarters')).toHaveLength(1);
  });
  it.each(['parcels', 'programme', 'buildings', 'houses'] as const)('rerolls %s without touching earlier retained stages', async stage => {
    const { world, settings } = fixture(), first = await generateRustTown(world, settings, 'main');
    world.debug = { v2RustCities: { main: freeze(first.snapshot) } };
    native.run.mockClear(); native.plan.mockClear();
    settings.urban!.local = { main: { seeds: { [stage]: `${stage}-only` } } };
    const next = await generateRustTown(world, settings, 'main');
    expect(next.snapshot.layouts).toBe(first.snapshot.layouts);
    const kinds = native.run.mock.calls.map(([r]) => r.kind);
    expect(kinds).not.toContain('quarters');
    if (stage !== 'parcels') { expect(kinds).not.toContain('parcels'); expect(next.snapshot.cadastralPartitions).toBe(first.snapshot.cadastralPartitions); }
    if (stage === 'buildings' || stage === 'houses') { expect(kinds).not.toContain('programme'); expect(next.snapshot.programmePartitions).toBe(first.snapshot.programmePartitions); }
    if (stage === 'houses') {
      expect(kinds).not.toContain('buildingSites'); expect(next.snapshot.requests).toBe(first.snapshot.requests);
      expect(native.plan.mock.calls[0][0].requests.every((r: PlacementRequest) => r.seed.startsWith('houses-only/'))).toBe(true);
    } else expect(native.run.mock.calls.find(([r]) => r.kind === (stage === 'buildings' ? 'buildingSites' : stage))![0].seed).toBe(`${stage}-only`);
  });
  it('restarts the native urban chain with the city seed and reuses the exact regional inputs', async () => {
    const { world, settings } = fixture();
    world.roads = [{ path: [{ x: 0, y: 50 }, { x: 100, y: 50 }], width: 4, kind: 'major' }];
    const original = structuredClone(world), first = await generateRustTown(world, settings, 'main');
    world.debug = { v2RustCities: { main: freeze(first.snapshot) } };
    native.run.mockClear(); native.plan.mockClear();
    settings.urban!.local = { main: { seed: 'try-another-street-layout' } };
    const next = await generateRustTown(world, settings, 'main');
    expect(next.snapshot.layoutKey).not.toBe(first.snapshot.layoutKey);
    expect(native.run.mock.calls.map(([request]) => request.kind)).toEqual(['quarters', 'parcels', 'programme', 'buildingSites', 'builtCapacity']);
    expect(native.run.mock.calls.every(([request]) => request.seed === 'try-another-street-layout')).toBe(true);
    const request = native.run.mock.calls[0][0];
    expect(request.roads[0].path).toEqual(original.roads![0].path);
    expect(request.sites[0].center).toEqual(original.settlements![0].center);
    expect(world.terrain).toEqual(original.terrain); expect(world.roads).toEqual(original.roads);
    world.debug.v2RustCities = { main: freeze(next.snapshot) };
    const calls = native.run.mock.calls.length;
    const again = await generateRustTown(world, settings, 'main');
    expect(again.snapshot.layouts).toBe(next.snapshot.layouts); expect(native.run).toHaveBeenCalledTimes(calls);
  });
  it('retains heavy scene/geometry/archives by identity on a cache hit without mutating the previous snapshot', async () => {
    const { world, settings } = fixture(), first = await generateRustTown(world, settings, 'main');
    const previous = freeze(first.snapshot), bytes = JSON.stringify(previous);
    world.debug = { v2RustCities: { main: previous } };
    const calls = native.run.mock.calls.length, plans = native.plan.mock.calls.length;
    const hit = await generateRustTown(world, settings, 'main');
    expect(hit.snapshot).not.toBe(previous); expect(hit.snapshot.scene).toBe(previous.scene); expect(hit.snapshot.layouts).toBe(previous.layouts);
    expect(hit.snapshot.partitions).toBe(previous.partitions); expect(hit.snapshot.requests).toBe(previous.requests);
    expect(hit.snapshot.lastBuildingRequests).toBe(0); expect(JSON.stringify(previous)).toBe(bytes);
    expect(native.run).toHaveBeenCalledTimes(calls); expect(native.plan).toHaveBeenCalledTimes(plans);
  });
  it('edits one house with copy-on-write baseline bookkeeping and leaves frozen neighbours and earlier stages exact', async () => {
    const { world, settings } = fixture(), first = await generateRustTown(world, settings, 'main');
    const previous = freeze(first.snapshot), bytes = JSON.stringify(previous); world.debug = { v2RustCities: { main: previous } };
    settings.urban!.buildings = { 'main/p0/request': { overrides: { floors: 2 } } as never };
    const next = await generateRustTown(world, settings, 'main');
    expect(next.snapshot.layouts).toBe(previous.layouts); expect(next.snapshot.requests).toBe(previous.requests);
    expect(next.snapshot.houseBaseline!.originals).not.toBe(previous.houseBaseline!.originals);
    expect(next.snapshot.scene!.buildings.find(b => b.parcel_id === 'p1')).toBe(previous.scene!.buildings.find(b => b.parcel_id === 'p1'));
    expect(next.snapshot.scene!.buildings.find(b => b.parcel_id === 'p0')!.volumes[0].levels).toHaveLength(2);
    expect(next.snapshot.lastBuildingRequests).toBe(1); expect(JSON.stringify(previous)).toBe(bytes);
    expect(next.snapshot.partitions![0].parcels).toBe(previous.partitions![0].parcels);
  });
  it('hides downstream display at an earlier stop and preserves retained products; failures cannot mutate the previous snapshot', async () => {
    const { world, settings } = fixture(), first = await generateRustTown(world, settings, 'main');
    const previous = freeze(first.snapshot), bytes = JSON.stringify(previous); world.debug = { v2RustCities: { main: previous } };
    const stopped = await generateRustTown(world, settings, 'main', undefined, 'layout');
    expect(stopped.urban.buildings).toHaveLength(0); expect(stopped.snapshot.scene).toBe(previous.scene); expect(previous.stage).toBe('buildings');
    settings.urban!.parcels = { density: .7 }; native.run.mockResolvedValueOnce({ error: 'Native stage refused' });
    await expect(generateRustTown(world, settings, 'main')).rejects.toThrow('Native stage refused');
    expect(JSON.stringify(previous)).toBe(bytes);
  });
  it('shares exact physical rasters across copied river-name headers and invalidates for changed physical input', () => {
    const { world } = fixture(), first = rustSettlementRaster(world);
    expect(rustSettlementRaster({ ...world, terrain: { ...world.terrain, rivers: [...world.terrain.rivers] } })).toBe(first);
    const sea = { ...world, terrain: { ...world.terrain, water: new Uint8Array([1, 0, 0, 0]), seaLevel: 6 } };
    const changed = rustSettlementRaster(sea); expect(changed).not.toBe(first); expect(changed.waterLevel[0]).toBe(6);
  });
  it('sends built capacity a scene whose deficit open spaces carry their actual Core declaration', async () => {
    // Real native roman04 rows: two non-market parcels whose Core request is an
    // open_space deficit declaration and whose Houses outcome is an open space.
    const { partitions, requests, scene } = JSON.parse(JSON.stringify(deficitFixture)) as { partitions: Partition[]; requests: PlacementRequest[]; scene: PlacementBatch };
    const run = native.run.getMockImplementation()!;
    native.run.mockImplementation(async request => {
      if (request.kind === 'parcels') return { partitions };
      if (request.kind === 'programme') return { partitions: request.partitions };
      if (request.kind === 'buildingSites') return { placementRequests: requests };
      if (request.kind === 'builtCapacity') {
        // Mirror of the Rust reconcile_built rule (programme.rs): an open space
        // on a non market/common allocation must carry its architectural deficit.
        const applied = new Map(request.partitions.flatMap((p: Partition) => p.programme!.allocations.map(a => [a.parcelId, a])));
        for (const space of (request.scene as PlacementBatch).open_spaces) {
          const allocation = applied.get(space.parcel_id) as { function: string } | undefined;
          if (allocation && !['market', 'common'].includes(allocation.function) && !space.deficit) return { error: 'Open space does not match an applied open function' };
        }
      }
      return run(request);
    });
    native.plan.mockImplementation(async () => structuredClone(scene));
    const { world, settings } = fixture(), town = await generateRustTown(world, settings, 'main');
    const sent = native.run.mock.calls.map(call => call[0]).find(request => request.kind === 'builtCapacity')!;
    expect(sent.scene).toBe(town.snapshot.scene);
    expect(town.snapshot.scene!.open_spaces.map(space => space.deficit?.request_id)).toEqual(scene.open_spaces.map(space => space.id));
  });
  it('does not alias editable input patches into retained house provenance', async () => {
    const { world, settings } = fixture();
    settings.urban!.buildings = { 'main/p0/request': { overrides: { floors: 2 } } as never };
    const first = await generateRustTown(world, settings, 'main'), previous = freeze(first.snapshot), bytes = JSON.stringify(previous);
    settings.urban!.buildings!['main/p0/request'].overrides!.floors = 3;
    expect(previous.houseOverrides!['p0/request'].overrides!.floors).toBe(2);
    world.debug = { v2RustCities: { main: previous } }; const next = await generateRustTown(world, settings, 'main');
    expect(next.snapshot.scene!.buildings.find(b => b.parcel_id === 'p0')!.volumes[0].levels).toHaveLength(3);
    expect(JSON.stringify(previous)).toBe(bytes);
  });
});
