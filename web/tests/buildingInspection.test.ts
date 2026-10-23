import { expect, it } from 'vitest';
import type { BuildingStyleEntry, BuildingStyleIndex } from '../../rust/bridge/buildingStyles';
import type { MaterialSlots, Surface } from '../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { describeUrbanBuilding, inspectBuilding } from '../src/render/buildingInspection';

it('inspects oriented net geometry without meshes, distinguishes unknown capacity and keeps exact source evidence', () => {
  const transform = { origin: { x: 8020, y: 12050 }, orientation_deg: 37 };
  const angle = transform.orientation_deg * Math.PI / 180;
  const ring = (x: number, y: number, w: number, d: number) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]].map(([x, y]) => ({
    x: transform.origin.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: transform.origin.y + x * Math.sin(angle) + y * Math.cos(angle),
  }));
  // Same orientation for both rings deliberately tests semantic holes, not winding.
  const hole = ring(4, 2, 2, 2), footprint: Surface = [{ outer: ring(0, 0, 10, 6), holes: [hole] }];
  const materials: MaterialSlots = { frame: 'wood-oak', infill: 'lime', coating: 'lime', cladding: 'tile', base: 'stone', roof_frame: 'wood-oak' };
  const building = {
    id: 'b', parcel_id: 'p', recipe_id: 'test-recipe', variant_id: 'court', function: 'domestic',
    culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
    transform, ground_z_m: 100, footprint, roof_footprint: [{ outer: ring(-1, -1, 12, 8), holes: [hole] }],
    courtyards: [{ outer: hole, holes: [] }], circulation: [], entrance: ring(0, 0, 1, 1)[0], access_id: 'front',
    volumes: [{ id: 'v', footprint, materials, z_m: 101, wall_height_m: 6, roof_height_m: 2, roof_system: 'RF-HIP',
      levels: [{ index: 0, footprint, z_m: 101, height_m: 3 }, { index: 1, footprint, z_m: 104, height_m: 3, materials: { ...materials, coating: 'ochre' } }],
      get roof_mesh() { throw new Error('Inspection must not read a roof mesh.'); } }],
    structural_features: [], simplification: 'architectural_plan', diagnostics: ['Native warning retained.'],
    cartographic: { height_m: 8.5, ridges: [], validation: 'plan_only' }, useful_area_m2: 112, domestic_units: 0,
    programme: { role: 'dwelling.court', households: 7 },
    get resolved() { throw new Error('Inspection must not decode retained plans.'); },
  } as unknown as PlacedBuilding;
  const compact = inspectBuilding(building);
  expect(compact.validation).toBe('plan_only');
  expect(compact.geometry.footprintAreaM2).toBeCloseTo(56, 7);
  expect(compact.geometry.roofAreaM2).toBeCloseTo(92, 7);
  expect(compact.geometry.perimeterM).toBeCloseTo(40, 7);
  expect(compact.geometry.courtyardAreaM2).toBeCloseTo(4, 7);
  expect(compact.geometry.widthM).toBeCloseTo(10, 7); expect(compact.geometry.depthM).toBeCloseTo(6, 7);
  expect(compact.geometry).toMatchObject({ bodies: 1, floors: 2, heightM: 8.5 });
  expect(compact.capacity).toEqual({ status: 'unknown', domesticUnits: null, usefulAreaM2: null });
  expect(compact.programme?.households).toBe(7); // Planning wish never becomes native capacity.
  expect(compact.materials.ids).toEqual(['lime', 'ochre', 'stone', 'tile', 'wood-oak']);
  expect(compact.materials.bySlot.coating).toEqual(['lime', 'ochre']);
  expect(compact.style).toBeNull(); expect(compact.label).toBeNull();
  expect(compact.diagnostics).toEqual(building.diagnostics);

  const entry = { id: 'test-recipe::court', recipe_id: 'test-recipe', variant_id: 'court', label: 'Authored label', variant_label: 'Authored court',
    profile: 'exact-source-profile', temporal: { eras: ['source-era'], from_year: 1200, to_year: 1500, late_only: false, tradition_long: false },
    confidence: { recipe: 'source-confidence' }, sources: [{ path: 'atlas/source.md', line: 21 }] } as BuildingStyleEntry;
  const index: BuildingStyleIndex = { schema_version: 'building-styles-1', catalogue_version: 'test', generator_version: 'test', sources: [], entries: [entry], facets: {} };
  expect(describeUrbanBuilding(building, index).style).toBe(entry);
  expect(describeUrbanBuilding(building, index).label).toBe('Authored label');

  building.simplification = 'recipe_volumes'; delete building.cartographic;
  const native = inspectBuilding(building, index);
  expect(native.validation).toBe('native'); expect(native.geometry.heightM).toBe(9);
  expect(native.capacity).toEqual({ status: 'native', domesticUnits: 0, usefulAreaM2: 112 });
  building.recipe_id = 'silhouette'; building.variant_id = 'silhouette'; building.volumes = []; building.diagnostics = ['silhouette:preview'];
  const preview = inspectBuilding(building, index);
  expect(preview.validation).toBe('preview'); expect(preview.geometry.floors).toBeNull(); expect(preview.geometry.heightM).toBeNull();
  expect(preview.capacity.domesticUnits).toBeNull(); expect(preview.style).toBeNull();
});
