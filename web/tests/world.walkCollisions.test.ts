import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Surface } from '../../rust/bridge/housesContract';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { silhouetteBuilding } from '../src/render/city3d/silhouette';
import type { Building3dVisual } from '../src/render/urbanBuildingGeometry';
import { WALK_EYE_HEIGHT } from '../src/render/world/camera';
import { TerrainHeights } from '../src/render/world/heights';
import { moveFreeEye } from '../src/render/world/navigation';
import { Terrain3dCollisions, WALK_RADIUS } from '../src/render/world/terrain3dCollisions';
import { createViewerNavigation } from '../src/ui/viewerNavigation';

const footprint: Surface = [
  {
    outer: [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ],
    holes: [],
  },
];
const house = silhouetteBuilding(
  { id: 'house', recipe_id: 'silhouette', ground_z_m: 20, footprint, roof_footprint: footprint, volumes: [], circulation: [], entrance: footprint[0].outer[0], useful_area_m2: 0, domestic_units: 1, culture: { culture: 'european-organic' } } as unknown as PlacedBuilding,
  () => 20,
);
const relief = new TerrainHeights(new Float32Array(4).fill(20), 2, 1000, 0, 3);

describe('single camera walk collisions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stops wheel/touch strides, slides on held keys and lets the same eye fly through a house', () => {
    const collisions = new Terrain3dCollisions({ buildings: [house] }, relief, relief.exaggeration);
    const nav = createViewerNavigation(
      () => true,
      () => {},
    );
    nav.resize(800, 600);
    nav.setRelief(() => relief);
    const index = vi.fn(() => collisions);
    nav.setWalkCollisions(index);
    nav.setView({ cx: 95, cy: 104, scale: 4, pitch: 1, yaw: Math.PI / 2 });
    nav.setNavigation('walk');
    nav.stride(1, 0, 0.5);
    expect(nav.camera.cx).toBeCloseTo(100 - WALK_RADIUS, 4);
    expect(nav.camera.eye).toBeCloseTo(60 + WALK_EYE_HEIGHT);
    // A diagonal held key retains the tangent along the facade.
    nav.setView({ ...nav.camera, yaw: 0 });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    nav.hold({ code: 'KeyD' } as KeyboardEvent);
    nav.hold({ code: 'KeyS' } as KeyboardEvent);
    nav.step(50);
    expect(nav.camera.cx).toBeCloseTo(100 - WALK_RADIUS, 4);
    expect(nav.camera.cy).toBeGreaterThan(104.4);
    nav.releaseAll();
    const reads = index.mock.calls.length;
    nav.setNavigation('fly');
    nav.setView({ ...nav.camera, yaw: Math.PI / 2, pitch: Math.PI / 2 });
    nav.stride(1, 0, 0.1);
    expect(nav.camera.cx).toBeGreaterThan(105);
    expect(index).toHaveBeenCalledTimes(reads);
  });

  it('recovers on entering walk inside a house and reads a replacement town index', () => {
    let collisions: Terrain3dCollisions | undefined = new Terrain3dCollisions({ buildings: [house] }, relief, relief.exaggeration);
    const nav = createViewerNavigation(
      () => true,
      () => {},
    );
    nav.setRelief(() => relief);
    nav.setWalkCollisions(() => collisions);
    nav.setView({ cx: 101, cy: 105, scale: 4, pitch: 1, yaw: Math.PI / 2 });
    nav.setNavigation('walk');
    expect(nav.camera.cx).toBeCloseTo(100 - WALK_RADIUS, 4);
    collisions = undefined;
    nav.stride(1, 0, 0.5);
    expect(nav.camera.cx).toBeCloseTo(106 - WALK_RADIUS, 4);
  });

  it('seats fortification solids on exaggerated terrain while keeping an elevated gate lintel passable', () => {
    const solid = (low: number): Building3dVisual => ({ ...house, id: 'city3d-wall:gate', recipe_id: 'city3d-wall', walkSolids: [{ footprint, z_min_m: low, z_max_m: 30 }] });
    const view = { cx: 95, cy: 105, scale: 4, pitch: Math.PI / 2, yaw: Math.PI / 2, eye: 60 + WALK_EYE_HEIGHT };
    const gate = new Terrain3dCollisions({ buildings: [solid(24)] }, relief, relief.exaggeration);
    expect(moveFreeEye(view, 'walk', 1, 0, 0, 1, false, relief, gate).cx).toBeCloseTo(107);
    const wall = new Terrain3dCollisions({ buildings: [solid(19)] }, relief, relief.exaggeration);
    expect(moveFreeEye(view, 'walk', 1, 0, 0, 1, false, relief, wall).cx).toBeCloseTo(100 - WALK_RADIUS, 4);
    const out: [number, number] = [0, 0];
    expect(wall.move(95, 105, 12, 0, undefined, 1, out)).toBe(out);
  });
});
