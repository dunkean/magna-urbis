import { describe, expect, it } from 'vitest';
import { CITY3D_RETAINING_PLINTH_M, city3dScene, footprintTerrain, silhouetteBuilding } from '../src/render/city3dMeshes';
import type { MassingPiece } from '../src/render/cityMassing';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const square = (cx: number, size: number) => ({ outer: [{ x: cx - size, y: -size }, { x: cx + size, y: -size }, { x: cx + size, y: size }, { x: cx - size, y: size }], holes: [] as { x: number; y: number }[][] });
const flat = (height: number): MassingPiece => ({ floors: 1, eave_m: height, rise_m: 0, roof: 'flat', ridges: [], cover: 'stone', wall: 'stone', openings: 'none' });
/** A 30 m vertical cliff along x = 0 (rising over 1 m). */
const cliff = (x: number): number => 30 * Math.max(0, Math.min(1, x));

describe('buildings on cliffs', () => {
  it('reaches the lowest terrain under the footprint and stands against the face', () => {
    const footprint = [square(0, 6)];
    const source = { id: 'house', parcel_id: 'p', recipe_id: 'silhouette', ground_z_m: 0, footprint, roof_footprint: footprint,
      culture: { culture: 'european-organic' }, function: 'domestic', volumes: [], programme: { massing: [flat(6)] } } as unknown as PlacedBuilding;
    const b = silhouetteBuilding(source, cliff);
    expect(b.ground_z_m).toBe(CITY3D_RETAINING_PLINTH_M);
    expect(b.volumes[0].foundation.z_min_m).toBeLessThanOrEqual(0);
    // A gully between the corners is still sampled: the footing reaches its floor.
    const gully = (x: number): number => Math.abs(x - 40) < 1.5 ? 0 : 10;
    expect(footprintTerrain([square(40, 7)], gully)?.low).toBe(0);
    expect(silhouetteBuilding({ ...source, footprint: [square(40, 7)] }, gully).volumes[0].foundation.z_min_m).toBeLessThanOrEqual(0);
  });

  it('anchors activity massing buildings on their own terrain, not the site centre height', () => {
    const footprint = [square(0, 5)];
    const activity = { id: 'activity:x/0', parcel_id: 'activity:x', recipe_id: 'activity:watermill', variant_id: 'mill', ground_z_m: 80,
      culture: { culture: 'european-organic', pack: '', mode: 'historical_inspired', borrowing: null }, function: 'workshop',
      footprint, roof_footprint: footprint, transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 },
      volumes: [{ id: 'v', footprint, levels: [], z_m: 80, wall_height_m: 4, roof_height_m: 0, roof_system: 'FLAT', materials: {},
        roof_mesh: { vertices: [{ x: -5, y: -5, z: 84 }, { x: 5, y: -5, z: 84 }, { x: 5, y: 5, z: 84 }], faces: [{ vertices: [0, 1, 2], normal: [0, 0, 1], material: 'activity:stone', kind: 'roof' }] },
        foundation: { footprint, z_min_m: 80, z_max_m: 80 } }],
      programme: { massing: [flat(4)] } } as unknown as PlacedBuilding;
    const scene = city3dScene({ schema_version: '1', generator_version: 'activity-sites-1', buildings: [activity], refusals: [], open_spaces: [] }, { heightAt: cliff });
    const b = scene.buildings[0];
    expect(scene.kinds.silhouette).toBe(1);
    expect(b.ground_z_m).toBe(CITY3D_RETAINING_PLINTH_M);
    expect(Math.min(...b.volumes.map(v => v.foundation?.z_min_m ?? Infinity))).toBeLessThanOrEqual(0);
  });
});
