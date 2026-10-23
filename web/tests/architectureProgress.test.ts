import { expect, it } from 'vitest';
import { placeArchitectureBatches } from '../../rust/bridge/architectureBatch';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch, PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const surface = () => [{ outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], holes: [] }];
const request = (id: number) => ({ id: String(id), parcel_id: String(id), seed: `progress/${id}`, cadastral: surface(), neighbors: [] } as unknown as PlacementRequest);
const native = (requests: PlacementRequest[]): PlacementBatch => ({
  schema_version: '1', generator_version: 'progress-test', refusals: [], open_spaces: [],
  buildings: requests.map(request => ({
    id: request.id, parcel_id: request.parcel_id, footprint: surface(), roof_footprint: surface(),
    courtyards: [], circulation: [], structural_features: [], volumes: [], ground_z_m: 0,
    simplification: 'architectural_plan', resolved: { format: 'compact-plan-1', seed: request.seed },
  } as unknown as PlacedBuilding)),
});

it('publishes independent archived chunks once after retries, awaits consumers and cancels before final commit', async () => {
  const requests = Array.from({ length: 65 }, (_, index) => request(index));
  const published: string[] = [], ranges: number[][] = [], archiveIds: string[] = [];
  let retryCount = 0, consuming = false;
  const result = await placeArchitectureBatches({ schema_version: '1', requests }, async input => {
    expect(consuming).toBe(false);
    if (input.requests.length > 32) { retryCount++; throw new Error('[output_budget]'); }
    // Changing a published snapshot must never change subsequent native inputs.
    expect(input.requests.every(request => request.neighbors.every(neighbor => neighbor.footprint[0].outer[0].x === 0))).toBe(true);
    return archivePlanBatch(native(input.requests));
  }, {
    async onBatch(delta, progress) {
      consuming = true;
      published.push(...delta.buildings.map(building => building.id));
      ranges.push([progress.start, progress.completed, progress.total]);
      expect(delta.buildings.length).toBeLessThanOrEqual(32);
      expect(Object.keys(delta.plan_archives!)).toHaveLength(1);
      archiveIds.push(...Object.keys(delta.plan_archives!));
      expect(await resolveArchivedPlan(delta.buildings[0])).toEqual({ format: 'compact-plan-1', seed: `progress/${delta.buildings[0].id}` });
      delta.buildings[0].footprint[0].outer[0].x = 999;
      delete delta.plan_archives![archiveIds.at(-1)!];
      await new Promise(resolve => setTimeout(resolve, 0));
      consuming = false;
    },
  });
  expect(retryCount).toBe(2);
  expect(published).toEqual(requests.map(request => request.id));
  expect(ranges).toEqual([[0, 32, 65], [32, 48, 65], [48, 65, 65]]);
  expect(result.buildings.map(building => building.id)).toEqual(published);
  expect(result.buildings.every(building => building.footprint[0].outer[0].x === 0)).toBe(true);
  expect(Object.keys(result.plan_archives!)).toEqual(archiveIds);

  // Cancellation during the final consumer callback still prevents final commit.
  let cancelled = false, calls = 0, chunks = 0;
  await expect(placeArchitectureBatches({ schema_version: '1', requests: [request(0)] }, async input => {
    calls++; return archivePlanBatch(native(input.requests));
  }, { cancelled: () => cancelled, onBatch: async () => { chunks++; await Promise.resolve(); cancelled = true; } }))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect([calls, chunks]).toEqual([1, 1]);

  // A result already superseded while native work ran is never published.
  cancelled = false; chunks = 0;
  await expect(placeArchitectureBatches({ schema_version: '1', requests: [request(0)] }, async input => {
    cancelled = true; return archivePlanBatch(native(input.requests));
  }, { cancelled: () => cancelled, onBatch: () => { chunks++; } }))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(chunks).toBe(0);
});
