import { describe, expect, it } from 'vitest';
import { city3dScene, CITY3D_LEVEL_M } from '../src/render/city3dMeshes';
import { buildingRoof, type MassingPiece } from '../src/render/cityMassing';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../rust/bridge/housesContract';

const rect = (x: number, y: number, w: number, h: number): Surface => [{ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] }];
function silhouette(id: string, footprint: Surface, programme: object, ground = 10): PlacedBuilding {
  return { id, parcel_id: id, function: 'domestic', culture: { culture: 'x', pack: 'x', mode: 'inspired', borrowing: null }, recipe_id: 'silhouette', variant_id: 'silhouette',
    transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 }, ground_z_m: ground, footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: footprint[0].outer[0],
    access_id: '', volumes: [], useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null, programme } as unknown as PlacedBuilding;
}

describe('city 3D silhouettes', () => {
  it('extrudes floors × 3 m walls, a gable roof cap and a foundation down to the terrain', () => {
    const footprint = rect(0, 0, 12, 6), batch: PlacementBatch = { schema_version: '1', generator_version: 'silhouette', buildings: [silhouette('a', footprint, { role: 'dwelling.house', wealth: 0.5 })], refusals: [], open_spaces: [] };
    // Sloped ground: 9 m on the west side, 11 m on the east side.
    const scene = city3dScene(batch, { heightAt: x => 9 + x / 6 });
    const b = scene.buildings[0], v = b.volumes[0];
    expect(scene.kinds.silhouette).toBe(1);
    expect(v.wall_height_m % CITY3D_LEVEL_M).toBe(0);
    expect(v.wall_height_m).toBeGreaterThanOrEqual(2 * CITY3D_LEVEL_M);
    expect(v.foundation.z_min_m).toBeLessThanOrEqual(9 - 0.3 + 1e-9);
    const eave = v.z_m + v.wall_height_m, top = eave + v.roof_height_m;
    expect(v.roof_height_m).toBeGreaterThan(1);
    let wallTop = -Infinity, roofTop = -Infinity, roofLow = Infinity, roofArea = 0;
    eachBuildingTriangle(b, t => {
      const zs = t.points.map(p => p[2]);
      if (t.surface === 'roof') {
        roofTop = Math.max(roofTop, ...zs); roofLow = Math.min(roofLow, ...zs);
        const [a, c, d] = t.points, u = [c[0] - a[0], c[1] - a[1]], w = [d[0] - a[0], d[1] - a[1]];
        roofArea += Math.abs(u[0] * w[1] - u[1] * w[0]) / 2;
      } else if (zs.every(z => z >= v.z_m - 1e-9)) wallTop = Math.max(wallTop, ...zs);
    });
    expect(wallTop).toBeCloseTo(eave, 6);
    expect(roofTop).toBeCloseTo(top, 6);
    expect(roofLow).toBeCloseTo(eave, 6);
    // The roof projection closes the footprint: no gap between walls and roof.
    expect(roofArea).toBeCloseTo(72, 4);
  });

  it('keeps courts open and passes native buildings through unchanged', () => {
    const court: Surface = [{ outer: rect(0, 0, 20, 20)[0].outer, holes: [rect(6, 6, 8, 8)[0].outer.slice().reverse()] }];
    const native = { ...silhouette('n', rect(30, 0, 5, 5), {}), recipe_id: 'native', volumes: [{ roof_mesh: { vertices: [{ x: 30, y: 0, z: 1 }, { x: 35, y: 0, z: 1 }, { x: 30, y: 5, z: 2 }], faces: [{ vertices: [0, 1, 2], normal: [0, 0, 1], material: 'm', kind: 'pan' }] } }] } as unknown as PlacedBuilding;
    const scene = city3dScene({ schema_version: '1', generator_version: 'x', buildings: [silhouette('c', court, { role: 'dwelling.courtyard' }), native], refusals: [], open_spaces: [] });
    expect(scene.buildings[1]).toBe(native);
    expect(scene.kinds).toEqual({ silhouette: 1, compact: 0, detailed: 1 });
    const crown = scene.buildings[0].volumes[0].roof_mesh.faces.filter(f => f.kind === 'slab');
    expect(crown.length).toBeGreaterThan(0);
    // No crown triangle covers the court centre (10, 10).
    const mesh = scene.buildings[0].volumes[0].roof_mesh;
    for (const face of crown) {
      const [a, b, c] = face.vertices.map(i => mesh.vertices[i]), s = (p: typeof a, q: typeof a) => (q.x - p.x) * (10 - p.y) - (q.y - p.y) * (10 - p.x);
      const d = [s(a, b), s(b, c), s(c, a)];
      expect(d.every(x => x > 0) || d.every(x => x < 0)).toBe(false);
    }
  });
  it('raises city massing with the same roof faces as the 2D map', () => {
    const footprint = rect(0, 0, 12, 6), massing = [{ floors: 2, eave_m: 6, rise_m: 3, roof: 'hip', ridges: [[3, 3, 9, 3]], cover: 'slate', wall: 'brick' }];
    const batch: PlacementBatch = { schema_version: '1', generator_version: 'silhouette', buildings: [silhouette('m', footprint, { role: 'dwelling.house', massing })], refusals: [], open_spaces: [] };
    const roof = city3dScene(batch).buildings[0].volumes[0].roof_mesh, plan = buildingRoof(footprint, massing as MassingPiece[]);
    // Facade details share this mesh; compare only the cover faces to the plan.
    expect(roof.faces.filter(f => f.material.startsWith('city3d:cover:')).map(f => f.vertices.map(i => [roof.vertices[i].x, roof.vertices[i].y, roof.vertices[i].z - 10])))
      .toEqual(plan.map(f => f.points.map(p => [p.x, p.y, p.z])));
    expect(roof.faces.filter(f => f.material.startsWith('city3d:cover:')).every(f => /@[0-9a-f]{6}$/.test(f.material))).toBe(true);
  });
});
