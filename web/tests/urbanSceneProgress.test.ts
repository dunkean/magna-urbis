import { expect, it } from 'vitest';
import { createUrbanSceneAccumulator, urbanSceneCompletion } from '../src/ui/urbanSceneProgress';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const batch = (id: string): PlacementBatch => ({ schema_version: '1', generator_version: 'progress-test',
  buildings: [{ id, parcel_id: id, simplification: 'architectural_plan', footprint: [], roof_footprint: [], courtyards: [], circulation: [], volumes: [],
    resolved: { format: 'compact-plan-1', seed: id } } as unknown as PlacedBuilding],
  materials: [{ id: 'stone', label: 'Stone', roles: [], pattern: 'stone', origin: 'test', source_ref: null }],
  refusals: [], open_spaces: [],
});

it('accumulates transferred archived chunks in place and completes without receiving the scene again', async () => {
  const first = structuredClone(await archivePlanBatch(batch('a')));
  const second = structuredClone(await archivePlanBatch(batch('b')));
  second.refusals.push({ id: 'c', parcel_id: 'c', code: 'fit', message: 'No fit', attempts: 1 });
  second.open_spaces.push({ id: 'd', parcel_id: 'd', surface: [] });
  const accumulator = createUrbanSceneAccumulator();
  const scene = accumulator.append(first, { start: 0, completed: 1, total: 4 });
  const buildings = scene.buildings, materials = scene.materials;
  expect(scene.buildings[0]).toBe(first.buildings[0]);
  expect(await resolveArchivedPlan(scene.buildings[0])).toEqual({ format: 'compact-plan-1', seed: 'a' });
  expect(() => accumulator.complete(urbanSceneCompletion(scene))).toThrow('Incomplete');
  expect(accumulator.append(second, { start: 1, completed: 4, total: 4 })).toBe(scene);
  expect(scene.buildings).toBe(buildings); expect(scene.materials).toBe(materials);
  expect(scene.materials).toHaveLength(1);
  expect(scene.buildings.map(building => building.id)).toEqual(['a', 'b']);
  expect(first.buildings).toHaveLength(1); expect(first.plan_archives).not.toBe(scene.plan_archives);
  expect(Object.keys(first.plan_archives!)).toHaveLength(1);
  expect(Object.keys(scene.plan_archives!)).toHaveLength(2);
  expect(await resolveArchivedPlan(scene.buildings[1])).toEqual({ format: 'compact-plan-1', seed: 'b' });
  expect(accumulator.complete(urbanSceneCompletion(scene))).toBe(scene);
  expect(() => accumulator.append(second, { start: 1, completed: 4, total: 4 })).toThrow('repeated');
  expect(scene.buildings).toHaveLength(2);
  const empty = createUrbanSceneAccumulator();
  const emptyScene = empty.append({ ...batch('unused'), buildings: [] }, { start: 0, completed: 0, total: 0 });
  expect(empty.complete(urbanSceneCompletion(emptyScene))).toBe(emptyScene);
});
