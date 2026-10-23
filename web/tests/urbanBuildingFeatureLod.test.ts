import { expect, it, vi } from 'vitest';
import reference from '../../rust/fixtures/houses/batch-reference.json';
import type { Feature, HouseBatch, Surface } from '../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { buildingFeatureLod, buildingFeatureMetresPerPixel, retainBuildingFeature, type BuildingFeatureLod } from '../src/render/urbanBuildingFeatureLod';
import { eachBuildingTriangle, type BuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { UrbanBuildingPass } from '../src/ui/urbanBuilding3d';

const unit = (reference as unknown as HouseBatch).units[0];
const rect = (width = 1, depth = 1, x = 0): Surface => [{ outer: [{ x, y: 0 }, { x: x + width, y: 0 }, { x: x + width, y: depth }, { x, y: depth }], holes: [] }];
const feature = (kind: Feature['kind'] = 'post', width = 1, depth = 1, height = 1, x = 0): Feature => ({
  id: `${kind}-${x}`, kind, surface: rect(width, depth, x), z_m: 0, height_m: height, material: 'test', vertices3d: [], roof: null,
});
function plan(features: Feature[], x = 0): PlacedBuilding {
  return {
    id: `lod-${x}`, parcel_id: `parcel-${x}`, function: 'domestic',
    culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null },
    recipe_id: unit.recipe_id, variant_id: unit.variant_id, transform: { origin: { x, y: 0 }, orientation_deg: 0 },
    ground_z_m: 0, footprint: rect(1, 1, x), roof_footprint: [], courtyards: [], circulation: [], entrance: { x, y: 0 }, access_id: 'front',
    // Keep a real material contract, but make the feature the only drawable geometry.
    volumes: [{ ...unit.bodies[0], footprint: [], levels: [], z_m: 0, wall_height_m: 0, roof_height_m: 0,
      materials: unit.bodies[0].levels[0].materials, foundation: { footprint: [], z_min_m: 0, z_max_m: 0 },
      roof_mesh: { vertices: [], faces: [], edges: [], groups: [] } }] as ArchitectureVolume[],
    useful_area_m2: 0, domestic_units: 0, structural_features: features, structural_foundations: [],
    simplification: 'architectural_plan', diagnostics: [], resolved: { physicalFeatures: features },
    cartographic: { height_m: 3, ridges: [], validation: 'plan_only' },
  };
}
const batch = (buildings: PlacedBuilding[]): PlacementBatch => ({ schema_version: '1', generator_version: 'feature-lod-test', buildings, refusals: [], open_spaces: [] });
const triangles = (building: PlacedBuilding, overview: boolean, lod?: BuildingFeatureLod): BuildingTriangle[] => {
  const result: BuildingTriangle[] = []; eachBuildingTriangle(building, triangle => result.push(triangle), overview, lod); return result;
};
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
interface Sector { featureLodEligible: boolean; cached?: { overview: boolean; featureLod?: BuildingFeatureLod; batches: { count: number }[] } }
interface Internals { sectors: Sector[]; prepare(sector: Sector, overview: boolean, lod?: BuildingFeatureLod): void }
function mockGl() {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy({}, { get(_target, name) {
    if (!methods.has(name)) methods.set(name,
      name === 'getShaderParameter' || name === 'getProgramParameter' ? vi.fn(() => true)
        : String(name).startsWith('create') ? vi.fn(() => ({})) : vi.fn());
    return methods.get(name);
  } }) as WebGL2RenderingContext;
}
const matrix = new Float32Array(16); matrix[0] = matrix[5] = matrix[10] = matrix[11] = 1; matrix[15] = 1000;
const frame = (focal: number) => ({ matrix, cameraX: 0, cameraY: 0, targetHeight: 0, exaggeration: 1, focal, distance: 1000 });

it('keeps near and no-context triangle sequences and physical source features unchanged', () => {
  const building = deepFreeze(plan([feature()])), physical = JSON.stringify(building);
  const near = triangles(building, false), overview = triangles(building, true);
  expect(near).toHaveLength(10); expect(overview).toEqual(near);
  expect(triangles(building, false, buildingFeatureLod(1000, 1))).toEqual(near);
  expect(triangles(building, true, buildingFeatureLod(Number.NaN, 1))).toEqual(overview);
  expect(triangles(building, true, buildingFeatureLod(2, 1))).toEqual([]);
  expect(building.structural_features).toHaveLength(1);
  expect(JSON.stringify(building)).toBe(physical);
});

it('omits only small optional pieces, retaining large pieces, walls, stairs, roofs and invalid bounds', () => {
  const lod = buildingFeatureLod(2, 1)!;
  for (const kind of ['post', 'frame', 'portal_lintel'] as const) {
    expect(triangles(plan([feature(kind, .2, .2, .2)]), true, lod)).toEqual([]);
    expect(triangles(plan([feature(kind, .2, .2, 30)]), true, lod)).toHaveLength(10);
    expect(triangles(plan([feature(kind, 30, .2, .1)]), true, lod)).toHaveLength(10);
    expect(retainBuildingFeature(feature(kind, .2, .2, 3), true, buildingFeatureLod(2, 3))).toBe(true);
  }
  for (const kind of ['enclosure', 'retaining', 'stair', 'party_wall'] as const)
    expect(triangles(plan([feature(kind)]), true, buildingFeatureLod(1000, 1))).toHaveLength(10);
  const roof = { ...feature(), roof: { owner_body_id: 'body' } as NonNullable<Feature['roof']> };
  expect(retainBuildingFeature(roof, true, lod)).toBe(true);
  expect(retainBuildingFeature({ ...feature(), kind: 'future_kind' as Feature['kind'] }, true, lod)).toBe(true);
  expect(retainBuildingFeature({ ...feature(), height_m: Number.NaN }, true, lod)).toBe(true);
  expect(retainBuildingFeature({ ...feature(), vertices3d: [{ x: Number.NaN, y: 0, z: 0 }] }, true, lod)).toBe(true);
  for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(buildingFeatureLod(scale, 1)).toBeUndefined();
});

it('protects an off-axis feature whose true projected diagonal exceeds the omission threshold', () => {
  const projection = new Float32Array(16); projection[0] = projection[5] = projection[10] = projection[11] = 1;
  const centre = [801.6, 0, 1002], radius = 1.9995, focal = 500;
  const a = [800.0386528155, 0, 1003.2490777476], b = [803.1613471845, 0, 1000.7509222524];
  const diagonal = Math.hypot(...a.map((v, i) => v - b[i]));
  const projectedPixels = focal * Math.abs(a[0] / a[2] - b[0] / b[2]);
  expect(diagonal).toBeCloseTo(3.999, 9); expect(projectedPixels).toBeGreaterThan(2.55);
  const mpp = buildingFeatureMetresPerPixel(projection, centre, radius, focal)!;
  expect(diagonal / mpp).toBeGreaterThanOrEqual(projectedPixels);
  const piece = feature('post', 3.999, 0, 0);
  // An axial estimate near 2m/px would incorrectly omit this piece.
  expect(retainBuildingFeature(piece, true, buildingFeatureLod(2, 1))).toBe(false);
  expect(retainBuildingFeature(piece, true, buildingFeatureLod(mpp, 1))).toBe(true);
  expect(buildingFeatureMetresPerPixel(projection, [0, 0, 1], 2, focal)).toBeUndefined();
});

it('keeps ineligible sector caches across zoom octaves and refreshes eligibility on replacement', () => {
  const pass = new UrbanBuildingPass(mockGl()), state = pass as unknown as Internals;
  const plain = plan([]), wall = plan([feature('enclosure')]), post = plan([feature()]);
  const prepare = vi.spyOn(state, 'prepare');
  try {
    for (const building of [plain, wall]) {
      pass.setScene(batch([building]), { style: 'cartographic', diagnostic: 'none' }); prepare.mockClear();
      pass.draw(frame(4000)); const cached = state.sectors[0].cached;
      expect(state.sectors[0].featureLodEligible).toBe(false);
      pass.draw(frame(250)); expect(prepare).toHaveBeenCalledTimes(1); expect(state.sectors[0].cached).toBe(cached);
    }
    pass.replaceBuildings([post]); expect(state.sectors[0].featureLodEligible).toBe(true);
    pass.draw(frame(250)); expect(prepare).toHaveBeenCalledTimes(2);
    expect(pass.pick([.5, .5, 2], [0, 0, -1]).id).toBeUndefined();
    pass.replaceBuildings([wall]); expect(state.sectors[0].featureLodEligible).toBe(false);
    pass.draw(frame(250)); pass.draw(frame(4000)); expect(prepare).toHaveBeenCalledTimes(3);
    expect(pass.pick([.5, .5, 2], [0, 0, -1]).id).toBe(wall.id);
  } finally { pass.dispose(); }
});

it('picks the geometry drawn from the cached LOD, including a rebuild deferred by the frame budget', () => {
  const pass = new UrbanBuildingPass(mockGl()), state = pass as unknown as Internals;
  const first = plan([feature()]), second = plan([feature('post', 1, 1, 1, 300)], 300);
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0), prepare = vi.spyOn(state, 'prepare');
  try {
    pass.setScene(batch([first, second]), { style: 'cartographic', diagnostic: 'none' });
    pass.draw(frame(4000)); expect(prepare).toHaveBeenCalledTimes(2);
    const retained = state.sectors[1].cached;
    expect(retained?.batches.reduce((n, b) => n + b.count, 0)).toBe(30);
    expect(pass.pick([300.5, .5, 2], [0, 0, -1]).id).toBe(second.id);
    pass.draw(frame(3900)); expect(prepare).toHaveBeenCalledTimes(2);
    clock.mockReturnValueOnce(0).mockReturnValue(10);
    expect(pass.draw(frame(250))).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(state.sectors[0].cached?.batches).toEqual([]);
    expect(pass.pick([.5, .5, 2], [0, 0, -1]).id).toBeUndefined();
    expect(state.sectors[1].cached).toBe(retained);
    expect(pass.pick([300.5, .5, 2], [0, 0, -1]).id).toBe(second.id);
    expect(pass.draw(frame(250))).toBe(false); expect(prepare).toHaveBeenCalledTimes(4);
    expect(state.sectors[1].cached?.batches).toEqual([]);
    expect(pass.pick([300.5, .5, 2], [0, 0, -1]).id).toBeUndefined();
    pass.draw(frame(20000)); expect(state.sectors[0].cached?.overview).toBe(false);
    expect(pass.pick([.5, .5, 2], [0, 0, -1]).id).toBe(first.id);
  } finally { clock.mockRestore(); pass.dispose(); }
});
