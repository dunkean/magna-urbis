import { expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';
import { assemblyNeighborParts } from '../src/ui/nativeAssemblyNeighbors';
// Synthetic spatial-contract records only. These are NOT native admission,
// archive, source or physical construction witnesses.
const box = (x: number, y = 0): Surface => [{ outer: [{ x, y }, { x: x + 2, y }, { x: x + 2, y: y + 2 }, { x, y: y + 2 }], holes: [] }];
function spatialRecord(id: string, footprint = box(0)): PlacedBuilding {
  return { id, parcel_id: 'parcel/' + id, function: 'domestic',
    culture: { culture: 'test', pack: 'test', mode: 'historical_inspired', borrowing: null },
    recipe_id: 'spatial-test', variant_id: 'default', transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 }, ground_z_m: 0,
    footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: { x: 0, y: 0 }, access_id: 'public',
    volumes: [], useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'architectural_plan', diagnostics: [],
    resolved: { format: 'synthetic-spatial-contract-not-native' } };
}
it('excludes only the exact parent identity and preserves separate real-source part references in retained order', () => {
  const parent = spatialRecord('parent'), neighbor = spatialRecord('other'); neighbor.circulation = box(3);
  const value = assemblyNeighborParts([parent, neighbor], 'parent', [-1, -1, 8, 8]);
  expect(value.neighbors).toBe(1); expect(value.occupied_parts).toHaveLength(2);
  expect(value.occupied_parts[0]).toBe(neighbor.footprint); expect(value.occupied_parts[1]).toBe(neighbor.circulation);
  expect(value.occupied_roof_parts).toEqual([neighbor.roof_footprint]);
  expect(value.occupied_roof_parts[0]).toBe(neighbor.roof_footprint);
});
it('includes a neighbor whose roof alone enters the entire attempt rights envelope', () => {
  const neighbor = spatialRecord('outside-body', box(100)); neighbor.roof_footprint = box(1);
  const value = assemblyNeighborParts([neighbor], 'parent', [0, 0, 6, 6]);
  expect(value.neighbors).toBe(1); expect(value.occupied_parts[0]).toBe(neighbor.footprint);
  expect(value.occupied_roof_parts[0]).toBe(neighbor.roof_footprint);
});
it('includes circulation outside the visible roof window; a viewport is not the native query envelope', () => {
  const neighbor = spatialRecord('off-camera', box(100)); neighbor.circulation = box(4);
  const value = assemblyNeighborParts([neighbor], 'parent', [0, 0, 10, 10]);
  expect(value.neighbors).toBe(1); expect(value.occupied_parts[1]).toBe(neighbor.circulation);
});
it('rejects incomplete-budget scans, duplicate IDs and display silhouettes instead of omitting neighbors', () => {
  const a = spatialRecord('a'), b = spatialRecord('b');
  expect(() => assemblyNeighborParts([a, b], 'parent', [0, 0, 6, 6], { scanned: 1, matched: 2 })).toThrow('budget');
  expect(() => assemblyNeighborParts([a, b], 'parent', [0, 0, 6, 6], { scanned: 2, matched: 1 })).toThrow('budget');
  expect(() => assemblyNeighborParts([a, a], 'parent', [0, 0, 6, 6])).toThrow('dupliquée');
  expect(() => assemblyNeighborParts([{ ...a, simplification: 'recipe_volumes' }], 'parent', [0, 0, 6, 6])).toThrow('aperçu');
});
