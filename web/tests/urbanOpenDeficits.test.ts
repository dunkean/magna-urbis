import { expect, it } from 'vitest';
import raw from './fixtures/open-deficit-roman04-bridge-native.json';
import type { Partition } from '../../rust/bridge/urban';
import type { PlacementBatch, PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { carryUrbanOpenDeficits } from '../../rust/bridge/urbanOpenDeficits';
import { urbanBuildingPanelOpenDeficitsHtml } from '../src/ui/urbanBuildingsPanel';
// Trusted bounded native fixture rows, not a DTO converted into a native plan.
function fixture(): { partitions: Partition[]; requests: PlacementRequest[]; scene: PlacementBatch } { return JSON.parse(JSON.stringify(raw)); }
const snapshot = (value: unknown) => JSON.stringify(value);
it('joins the two real roman04 declarations while preserving geometry, demands, counters and caller inputs', () => {
  const { partitions, requests, scene } = fixture(), before = [partitions, requests, scene].map(snapshot);
  const carried = carryUrbanOpenDeficits(partitions, scene, requests);
  expect(carried).not.toBe(scene); expect(carried.buildings).toBe(scene.buildings); expect(carried.refusals).toBe(scene.refusals);
  expect(carried.open_spaces).toHaveLength(2);
  for (const [index, space] of carried.open_spaces.entries()) {
    expect(space.surface).toBe(scene.open_spaces[index].surface);
    const request = requests.find(value => value.id === space.id)!;
    const allocation = partitions[0].programme!.allocations.find(value => value.parcelId === space.parcel_id)!;
    expect(space.deficit).toEqual({ version: 'architectural-deficit-1', request_id: request.id, demand_id: allocation.demandId,
      original_function: allocation.function, role: allocation.role, cause: request.programme!.deficit!.cause,
      households: allocation.households, message: request.programme!.deficit!.message });
  }
  expect([partitions, requests, scene].map(snapshot)).toEqual(before);
  expect(carryUrbanOpenDeficits(partitions, carried, requests)).toBe(carried);
  expect(carried.open_spaces.map(value => value.deficit!.original_function).sort()).toEqual(['collective', 'warehouse']);
});
it('does not reconstruct a declaration from allocations, a preview, missing metadata or a mismatched identity', () => {
  const { partitions, requests, scene } = fixture();
  expect(() => carryUrbanOpenDeficits(partitions, scene, [])).toThrow();
  for (const mutate of [
    (r: PlacementRequest) => { r.function = 'warehouse'; },
    (r: PlacementRequest) => { r.programme!.deficit = undefined; },
    (r: PlacementRequest) => { r.programme!.role = 'other'; },
    (r: PlacementRequest) => { r.id += '/wrong'; },
    (r: PlacementRequest) => { r.programme!.deficit!.households += 1; },
    (r: PlacementRequest) => { r.programme!.deficit!.message = ''; },
  ]) {
    const changed = structuredClone(requests); mutate(changed[0]);
    expect(() => carryUrbanOpenDeficits(partitions, scene, changed)).toThrow();
  }
  const withoutProof = structuredClone(partitions); delete withoutProof[0].programme!.allocations[0].households;
  expect(() => carryUrbanOpenDeficits(withoutProof, scene, requests)).toThrow();
  const withoutRole = structuredClone(partitions); delete withoutRole[0].programme!.demands[0].role;
  expect(() => carryUrbanOpenDeficits(withoutRole, scene, requests)).toThrow();
});
it('requires the actual missing-source declaration and rejects altered stored markers atomically', () => {
  const { partitions, requests, scene } = fixture(), source = requests.find(r => r.programme?.deficit?.cause === 'source_absente')!;
  const changed = structuredClone(requests), altered = changed.find(r => r.id === source.id)!;
  altered.programme!.source_coverage!.functional_footing_tested = true;
  expect(() => carryUrbanOpenDeficits(partitions, scene, changed)).toThrow('couverture');
  const carried = carryUrbanOpenDeficits(partitions, scene, requests), before = snapshot(carried);
  const forged = structuredClone(carried); forged.open_spaces[1].deficit!.message += ' forged';
  expect(() => carryUrbanOpenDeficits(partitions, forged, requests)).toThrow('marqueur');
  expect(snapshot(carried)).toBe(before);
});
it('leaves old intended market/common outcomes unchanged and does not add fake deficits to them', () => {
  for (const fn of ['market', 'common']) {
    const { partitions, scene } = fixture();
    for (const a of partitions[0].programme!.allocations) a.function = fn;
    expect(carryUrbanOpenDeficits(partitions, scene, [])).toBe(scene);
  }
});
it('survives exact JSON export/import with the explicit marker and shows declarations without capacity/population conversion', () => {
  const { partitions, requests, scene } = fixture(), carried = carryUrbanOpenDeficits(partitions, scene, requests);
  const restored: PlacementBatch = JSON.parse(JSON.stringify(carried));
  expect(carryUrbanOpenDeficits(partitions, restored, requests)).toBe(restored);
  const html = urbanBuildingPanelOpenDeficitsHtml({ seed: '', visible: true, appearance: { style: 'silhouette', diagnostic: 'none' }, scene: restored });
  expect(html).toContain('storage.horreum'); expect(html).toContain('worship.temple'); expect(html).toContain('déclaration');
  expect(html).toContain('aucune capacité'); expect(html).not.toContain('ménages logés');
});
