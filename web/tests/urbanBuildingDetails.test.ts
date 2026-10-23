import { expect, it, vi } from 'vitest';
import reference from '../../rust/fixtures/houses/batch-reference.json';
import type { HouseBatch, Point, Surface } from '../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { UrbanBuildingDetailController, nativeExteriorDetail } from '../src/render/urbanBuildingDetails';
import { UrbanBuildingLodRenderer } from '../src/render/urbanBuildingLod';
import { projectNativeBuildingRecords } from '../src/ui/urbanBuildingProjection';

const native = reference as unknown as HouseBatch, unit = native.units[0];
function plan(id: string, x = 1000, orientation = 37): PlacedBuilding {
  const c = Math.cos(orientation * Math.PI / 180), s = Math.sin(orientation * Math.PI / 180);
  const map = (p: Point) => ({ x: x + p.x * c - p.y * s, y: 1000 + p.x * s + p.y * c });
  const surface = (value: Surface): Surface => value.map(p => ({ outer: p.outer.map(map), holes: p.holes.map(h => h.map(map)) }));
  const footprint = surface(unit.partition.occupied), ground = 120;
  return { id, parcel_id: `parcel-${id}`, function: 'domestic', culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
    recipe_id: unit.recipe_id, variant_id: unit.variant_id, transform: { origin: { x, y: 1000 }, orientation_deg: orientation }, ground_z_m: ground,
    footprint, roof_footprint: footprint, courtyards: surface(unit.partition.courtyards), circulation: [], entrance: map({ x: 0, y: 0 }), access_id: 'front',
    volumes: unit.bodies.map(body => ({ ...body, footprint: surface(body.footprint), z_m: ground, wall_height_m: 3, roof_height_m: 3,
      levels: body.levels.map(level => ({ ...level, footprint: surface(level.footprint), z_m: ground + level.z_m })), materials: body.levels[0].materials,
      foundation: { footprint: surface(body.footprint), z_min_m: ground, z_max_m: ground }, roof_mesh: { vertices: [], faces: [], edges: [], groups: [] } })) as ArchitectureVolume[],
    useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'architectural_plan', diagnostics: [], resolved: { retained: true },
    cartographic: { height_m: 6, ridges: [], validation: 'plan_only' } };
}
const batch = (buildings: PlacedBuilding[]): PlacementBatch => ({ schema_version: '1', generator_version: 'detail-test', buildings, refusals: [], open_spaces: [] });
const result = (building: PlacedBuilding): HouseBatch => ({ ...native, units: [{ ...unit, transform: building.transform }] });
const flush = () => new Promise<void>(done => setImmediate(done));

it('maps the exact native exterior into world coordinates without changing the retained city plan', () => {
  const source = plan('chosen'), output = result(source), detail = nativeExteriorDetail(source, output);
  expect(detail.building.footprint).toBe(source.footprint); expect(detail.building.roof_footprint).toBe(source.roof_footprint);
  expect(detail.building.resolved).toBe(source.resolved); expect(source.volumes[0].roof_mesh.vertices).toHaveLength(0);
  expect(detail.building.simplification).toBe('architectural_plan'); expect(detail.building.domestic_units).toBe(0);
  expect(detail.building.cartographic).toBeUndefined();
  const p = unit.roofs.vertices[0], q = detail.building.volumes[0].roof_mesh.vertices[0];
  const angle = 37 * Math.PI / 180;
  expect(q.x).toBeCloseTo(1000 + p.x * Math.cos(angle) - p.y * Math.sin(angle), 9);
  expect(q.y).toBeCloseTo(1000 + p.x * Math.sin(angle) + p.y * Math.cos(angle), 9); expect(q.z).toBe(120 + p.z);
  const [nx, ny, nz] = unit.roofs.faces[0].normal, normal = detail.building.volumes[0].roof_mesh.faces[0].normal;
  expect(normal[0]).toBeCloseTo(nx * Math.cos(angle) - ny * Math.sin(angle), 9);
  expect(normal[1]).toBeCloseTo(nx * Math.sin(angle) + ny * Math.cos(angle), 9); expect(normal[2]).toBe(nz);
  expect(detail.geometryBytes).toBeGreaterThan(detail.vertices * 64);
  const renderer = new UrbanBuildingLodRenderer(batch([source]), { raster: false });
  renderer.setDetail(source.id, detail.building);
  expect(renderer.getBuilding(source.id)).toBe(source);
  expect(renderer.query({ minX: 990, minY: 990, maxX: 1030, maxY: 1030 }, .1).visible[0].building).toBe(source);
  renderer.setDetail(source.id, undefined); expect(renderer.getBuilding(source.id)).toBe(source);
  expect(() => nativeExteriorDetail(source, { ...output, units: [{ ...output.units[0], transform: { ...source.transform, orientation_deg: 38 } }] })).toThrow('transform');
});

it('bounds physical native work through scene changes, advances past a full queue and preserves refused plans/cache budgets', async () => {
  const old = batch([plan('old-a'), plan('old-b', 1012)]), next = batch([plan('new-a'), plan('new-b', 1012), plan('new-c', 1024), plan('new-d', 1036)]);
  const renderer = new UrbanBuildingLodRenderer(old, { raster: false });
  let queries = 0; const query = renderer.query.bind(renderer); renderer.query = (...args) => { queries++; return query(...args); };
  const jobs: { building: PlacedBuilding; resolve(value: HouseBatch): void; reject(reason: Error): void }[] = [];
  const entryBytes = nativeExteriorDetail(next.buildings[0], result(next.buildings[0])).geometryBytes;
  const controller = new UrbanBuildingDetailController({ scene: old, renderer, maxQueued: 2, maxCachedBuildings: 4, maxCacheBytes: entryBytes * 2 + 1,
    realize: (building, options) => { expect(options.interiors).toBe(false); expect(options.scene.buildings).toContain(building);
      return new Promise((resolve, reject) => jobs.push({ building, resolve, reject })); } });
  const viewport = { minX: 990, minY: 990, maxX: 1060, maxY: 1030 };
  try {
    controller.update({ viewport, metresPerPixel: 10 }); await flush(); expect(jobs).toHaveLength(0); expect(queries).toBe(0);
    controller.update({ viewport, metresPerPixel: .05, selectedId: 'old-b' }); await flush();
    expect(jobs).toHaveLength(2); expect(jobs[0].building.id).toBe('old-b');
    renderer.replaceScene(next); controller.replaceScene(next);
    controller.update({ viewport, metresPerPixel: .05, selectedId: 'new-c' }); await flush();
    expect(jobs).toHaveLength(2); expect(controller.stats).toMatchObject({ queued: 2, inFlight: 2, globalInFlight: 2, cached: 0 });
    // Stale fetches are not aborted/free slots early. Only a real reply admits a new job.
    jobs[0].resolve(result(jobs[0].building)); await flush(); expect(jobs).toHaveLength(3); expect(jobs[2].building.id).toBe('new-c');
    jobs[1].reject(new Error('Old scene refusal')); await flush(); expect(jobs).toHaveLength(4); expect(controller.stats.refused).toBe(0);
    for (let i = 2; i < 6; i++) {
      const job = jobs[i]; expect(job).toBeDefined();
      if (job.building.id === 'new-b') job.reject(new Error('Native roof admission refused'));
      else job.resolve(result(job.building));
      await flush(); expect(controller.stats.globalInFlight).toBeLessThanOrEqual(2);
    }
    expect(jobs).toHaveLength(6); // All 4 desired plans got a turn despite maxQueued=2.
    expect(controller.stats).toMatchObject({ inFlight: 0, queued: 0, cached: 2, refused: 1, responsesDiscarded: 2 });
    expect(controller.stats.cacheBytes).toBeLessThanOrEqual(entryBytes * 2 + 1);
    expect(controller.status('new-c').state).toBe('ready');
    expect(controller.status('new-b')).toEqual({ state: 'refused', message: 'Native roof admission refused' });
    expect(renderer.getBuilding('new-b')).toBe(next.buildings[1]);
    controller.update({ viewport, metresPerPixel: .05, selectedId: 'new-c' }); await flush(); expect(jobs).toHaveLength(6);
    const distant = plan('appended-far', 5000);
    renderer.appendScene(batch([distant]));
    controller.appendScene({ ...next, buildings: [...next.buildings, distant] });
    controller.update({ viewport, metresPerPixel: .05, selectedId: 'new-c' }); await flush();
    expect(jobs).toHaveLength(6); // Unrelated arriving chunks do not retry an evicted detail.
    expect(controller.status('new-c').state).toBe('ready');
    expect(next.buildings.every(building => building.volumes[0].roof_mesh.vertices.length === 0)).toBe(true);
  } finally { controller.dispose(); }
});

it('suspends queued detail demand synchronously, drains physical calls and resumes cached geometry without realization', async () => {
  const scene = batch([plan('cached'), plan('running-a', 1012), plan('running-b', 1024), plan('queued', 1036)]);
  const renderer = new UrbanBuildingLodRenderer(scene, { raster: false }), overlays = vi.spyOn(renderer, 'setDetail');
  const changed = vi.fn(), jobs: { building: PlacedBuilding; resolve(value: HouseBatch): void }[] = [];
  const controller = new UrbanBuildingDetailController({ scene, renderer, onChange: changed,
    realize: building => new Promise(resolve => jobs.push({ building, resolve })) });
  const viewport = { minX: 990, minY: 990, maxX: 1060, maxY: 1030 };
  const selectedView = { viewport, metresPerPixel: 10, selectedId: 'cached' };
  try {
    controller.update(selectedView); await flush();
    jobs[0].resolve(result(jobs[0].building)); await flush();
    const cached = controller.getDetail('cached'), bytes = controller.stats.cacheBytes;
    expect(cached).toBeDefined(); expect(bytes).toBeGreaterThan(0);
    controller.update({ ...selectedView, metresPerPixel: .05 }); await flush();
    expect(jobs).toHaveLength(3);
    expect(controller.stats).toMatchObject({ inFlight: 2, globalInFlight: 2, queued: 1, cached: 1 });

    controller.suspend();
    expect(controller.stats).toMatchObject({ inFlight: 2, globalInFlight: 2, queued: 0, cached: 1, cacheBytes: bytes });
    expect(overlays).toHaveBeenLastCalledWith('cached', undefined);
    await flush();
    const notifications = changed.mock.calls.length;
    controller.suspend(); controller.suspend(); await flush();
    expect(changed).toHaveBeenCalledTimes(notifications); // No subscriber/repaint loop.
    jobs[1].resolve(result(jobs[1].building)); await flush();
    expect(controller.stats).toMatchObject({ inFlight: 1, globalInFlight: 1, queued: 0, cached: 1, responsesDiscarded: 1 });
    expect(jobs).toHaveLength(3); // The queued fourth house must not refill the freed slot.
    jobs[2].resolve(result(jobs[2].building)); await flush();
    expect(controller.stats).toMatchObject({ inFlight: 0, globalInFlight: 0, cached: 1, cacheBytes: bytes, responsesDiscarded: 2 });
    expect(controller.getDetail('cached')).toBe(cached);
    controller.update(selectedView); await flush();
    expect(jobs).toHaveLength(3); // Returning to the original view reuses its exact cached exterior.
    expect(overlays).toHaveBeenLastCalledWith('cached', cached);
    expect(renderer.getBuilding('cached')).toBe(scene.buildings[0]);

    // A reserved callback can also be stopped before its dispatch microtask.
    controller.update({ ...selectedView, metresPerPixel: .05 });
    controller.suspend(); await flush();
    expect(jobs).toHaveLength(3); expect(controller.stats.globalInFlight).toBe(0);
  } finally {
    controller.dispose();
    for (const job of jobs) job.resolve(result(job.building));
    await flush();
  }
});

it('loads only demanded native plans for a visual-only index and keeps picking on that index', async () => {
  const source = batch([plan('cold'), plan('offscreen', 5000)]), visual = projectNativeBuildingRecords(source.buildings);
  const renderer = new UrbanBuildingLodRenderer(visual, { raster: false });
  const loaded = structuredClone(source.buildings[0]), context = batch([loaded]);
  const load = vi.fn(async () => ({ building: loaded, scene: context }));
  const realize = vi.fn(async (building: PlacedBuilding, options: { scene: { buildings: unknown[] } }) => {
    expect(building).toBe(loaded); expect(options.scene).toBe(context);
    expect('resolved' in building).toBe(true); return result(building);
  });
  const controller = new UrbanBuildingDetailController({ renderer, load, canRealize: () => true, realize });
  try {
    const view = { viewport: { minX: 990, minY: 990, maxX: 1040, maxY: 1040 }, metresPerPixel: 10 };
    controller.update(view); await flush(); expect(load).not.toHaveBeenCalled();
    controller.update({ ...view, selectedId: 'cold' }); await flush();
    expect(load).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledWith(visual.buildings[0]); expect(realize).toHaveBeenCalledTimes(1);
    const detail = controller.getDetail('cold'); expect(detail).toBeDefined();
    expect(detail!.footprint).toBe(visual.buildings[0].footprint);
    expect(detail!.roof_footprint).toBe(visual.buildings[0].roof_footprint);
    expect(detail!.volumes[0].roof_mesh.vertices.length).toBeGreaterThan(0);
    expect(renderer.getBuilding('cold')).toBe(visual.buildings[0]);
    expect(controller.status('cold').state).toBe('ready');
    expect('resolved' in renderer.getBuilding('cold')!).toBe(false);
    // A bounded viewport refresh reparses the same cold generation. Keep its
    // exterior, rebind only identical contours, and leave picking visual-only.
    const refreshed = projectNativeBuildingRecords([structuredClone(source.buildings[0])]);
    renderer.replaceScene(refreshed); controller.refreshProjection();
    controller.update({ ...view, selectedId: 'cold' }); await flush();
    expect(controller.getDetail('cold')!.footprint).toBe(refreshed.buildings[0].footprint);
    expect(realize).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
    renderer.replaceScene({ buildings: [{ ...refreshed.buildings[0], ground_z_m: refreshed.buildings[0].ground_z_m + 1 }] });
    controller.refreshProjection(); expect(controller.getDetail('cold')).toBeUndefined();
    renderer.replaceScene(projectNativeBuildingRecords([])); controller.refreshProjection();
    expect(controller.getDetail('cold')).toBeUndefined(); expect(controller.stats.cached).toBe(0);
    expect(() => controller.appendScene(source)).toThrow('cold');
    expect(() => controller.replaceScene(source)).toThrow('replaceSource');
  } finally { controller.dispose(); await flush(); }
});

it('rejects missing or different cold plans before any native work or overlay installation', async () => {
  const source = batch([plan('changed'), plan('missing', 1012)]), visual = projectNativeBuildingRecords(source.buildings);
  const renderer = new UrbanBuildingLodRenderer(visual, { raster: false }), overlay = vi.spyOn(renderer, 'setDetail');
  const changed = structuredClone(source.buildings[0]); changed.footprint[0].outer[0].x += .0000001;
  const realize = vi.fn(async (building: PlacedBuilding) => result(building));
  const controller = new UrbanBuildingDetailController({ renderer, canRealize: () => true,
    load: async building => building.id === 'missing' ? undefined : { building: changed, scene: batch([changed]) }, realize });
  try {
    controller.update({ viewport: { minX: 990, minY: 990, maxX: 1060, maxY: 1040 }, metresPerPixel: .05 }); await flush();
    expect(realize).not.toHaveBeenCalled(); expect(overlay).not.toHaveBeenCalled();
    expect(controller.status('changed')).toMatchObject({ state: 'refused', message: expect.stringContaining('indexed building visual') });
    expect(controller.status('missing')).toMatchObject({ state: 'refused', message: expect.stringContaining('unavailable') });
  } finally { controller.dispose(); await flush(); }
});

it('drains a stale cold read before using the new generation loader and rejects stale native replies', async () => {
  const first = plan('same-id'), next = plan('same-id', 1010);
  const renderer = new UrbanBuildingLodRenderer(projectNativeBuildingRecords([first]), { raster: false });
  let finishRead!: (value: { building: PlacedBuilding; scene: PlacementBatch }) => void;
  const oldLoad = vi.fn(() => new Promise<{ building: PlacedBuilding; scene: PlacementBatch }>(resolve => { finishRead = resolve; }));
  let finishNative!: (value: HouseBatch) => void;
  const realize = vi.fn((_building: PlacedBuilding) => new Promise<HouseBatch>(resolve => { finishNative = resolve; }));
  const nextLoad = vi.fn(async () => ({ building: next, scene: batch([next]) }));
  const controller = new UrbanBuildingDetailController({ renderer, load: oldLoad, canRealize: () => true, realize, maxConcurrency: 1 });
  const view = { viewport: { minX: 990, minY: 990, maxX: 1060, maxY: 1040 }, metresPerPixel: 10, selectedId: 'same-id' };
  try {
    controller.update(view); await flush(); expect(oldLoad).toHaveBeenCalledTimes(1);
    renderer.replaceScene(projectNativeBuildingRecords([next]));
    controller.replaceSource({ renderer, load: nextLoad, canRealize: () => true });
    controller.update(view); await flush(); expect(nextLoad).not.toHaveBeenCalled();
    finishRead({ building: first, scene: batch([first]) }); await flush();
    expect(nextLoad).toHaveBeenCalledTimes(1); expect(realize).toHaveBeenCalledTimes(1);
    expect(realize.mock.calls[0][0]).toBe(next);
    controller.suspend(); finishNative(result(next)); await flush();
    expect(controller.getDetail('same-id')).toBeUndefined();
    expect(controller.stats).toMatchObject({ inFlight: 0, globalInFlight: 0, responsesDiscarded: 2 });
  } finally { controller.dispose(); await flush(); }
});

it('rejects native completion between a viewport index replacement and its next update without poisoning the cache', async () => {
  const building = plan('between-frames'), renderer = new UrbanBuildingLodRenderer(projectNativeBuildingRecords([building]), { raster: false });
  let finish!: (value: HouseBatch) => void;
  const controller = new UrbanBuildingDetailController({ renderer, load: async () => ({ building, scene: batch([building]) }), canRealize: () => true,
    realize: () => new Promise<HouseBatch>(resolve => { finish = resolve; }) });
  const view = { viewport: { minX: 990, minY: 990, maxX: 1060, maxY: 1040 }, metresPerPixel: 10, selectedId: building.id };
  try {
    controller.update(view); await flush();
    renderer.replaceScene(projectNativeBuildingRecords([structuredClone(building)]));
    // Even before refreshProjection/update, the old index identity is stale.
    finish(result(building)); await flush();
    expect(controller.stats).toMatchObject({ cached: 0, cacheBytes: 0, refused: 0, responsesDiscarded: 1 });
    controller.refreshProjection(); expect(() => controller.update(view)).not.toThrow(); await flush();
    finish(result(building)); await flush();
    expect(controller.status(building.id).state).toBe('ready');
    expect(controller.getDetail(building.id)!.footprint).toBe(renderer.getBuilding(building.id)!.footprint);
  } finally { controller.dispose(); await flush(); }
});

it('charges the whole retained compressed chunk to a cold detail budget before native dispatch', async () => {
  const building = plan('archive-budget'), id = `plan-archive-${'a'.repeat(64)}`, archive = 'x'.repeat(2048);
  building.resolved = { format: 'compact-plan-archive-1', archive_id: id, index: 0 };
  const scene = { ...batch([building]), plan_archives: { [id]: archive } };
  const encodedBytes = 2 * (JSON.stringify(building).length + archive.length);
  const renderer = new UrbanBuildingLodRenderer(projectNativeBuildingRecords([building]), { raster: false });
  const realize = vi.fn(async () => result(building));
  const controller = new UrbanBuildingDetailController({ renderer, load: async () => ({ building, scene }), canRealize: () => true,
    realize, maxCacheBytes: encodedBytes - 1 });
  try {
    controller.update({ viewport: { minX: 990, minY: 990, maxX: 1060, maxY: 1040 }, metresPerPixel: 10, selectedId: building.id }); await flush();
    expect(realize).not.toHaveBeenCalled(); expect(controller.stats.cached).toBe(0);
    expect(controller.status(building.id)).toMatchObject({ state: 'refused', message: expect.stringContaining('Retained native plan exceeds') });
  } finally { controller.dispose(); await flush(); }
});
