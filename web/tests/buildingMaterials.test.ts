import { describe, expect, it } from 'vitest';
import { MATERIALS, coverLayer, wallLayer, streetLayer, placeLayer } from '../src/render/buildingMaterials';
import { CITY3D_MATERIALS } from '../src/render/city3dMeshes';
import { ROOF_COVERS, WALL_COLORS } from '../src/render/cityGlStyle';

describe('building materials manifest', () => {
  it('maps every massing cover, wall and road role to a layer', () => {
    for (const c of Object.keys(ROOF_COVERS)) expect(coverLayer(c), c).toBeGreaterThanOrEqual(0);
    for (const w of Object.keys(WALL_COLORS)) expect(wallLayer(w), w).toBeGreaterThanOrEqual(0);
    for (const r of ['bridge', 'causeway', 'ford', 'quay', 'stairs', 'market', 'collective', 'private', 'street']) for (const rank of [1, 2, 3]) expect(streetLayer(r, rank)).toBeGreaterThanOrEqual(0);
    expect(placeLayer()).toBeGreaterThanOrEqual(0);
    for (const group of [MATERIALS.cover, MATERIALS.wall, MATERIALS.road]) for (const i of Object.values(group)) expect(MATERIALS.layers[i]).toBeTruthy();
    expect(MATERIALS.layers.every(l => l.extent_m > 0)).toBe(true);
  });
  it('registers a layered 3D display material for every cover and wall', () => {
    const ids = new Set(CITY3D_MATERIALS.map(m => m.id));
    for (const c of Object.keys(ROOF_COVERS)) expect(ids.has(`city3d:cover:${c}`), c).toBe(true);
    for (const w of Object.keys(WALL_COLORS)) expect(ids.has(`city3d:wall:${w}`), w).toBe(true);
  });
});
