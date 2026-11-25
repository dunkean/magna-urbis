import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { RoofBuilder } from '../src/render/city3d/roofGeometry';
import { baseVolume } from '../src/render/city3d/volume';
import { eachBuildingTriangle, type OverviewVolume } from '../src/render/urbanBuildingGeometry';
import { craftedRoofRoom } from '../src/render/craftedRoofRoom';
import { buildingBounds } from '../src/render/world/buildingsMesh';

function dwelling(flat: boolean): PlacedBuilding {
  const outer = [
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 7 },
      { x: 0, y: 7 },
    ],
    footprint = [{ outer, holes: [] }];
  const slots = { cladding: 'city3d:cover:slate', coating: 'city3d:wall:plaster', base: 'stone', frame: 'wood', roof_frame: 'wood', infill: 'plaster' };
  const roof = new RoofBuilder();
  roof.face(
    outer.map(p => ({ ...p, z: 6 + (flat ? 0 : p.y * 0.62) })),
    slots.cladding,
  );
  const v: OverviewVolume = baseVolume('house-main', footprint, 0, 6, flat ? 0 : 4.34, slots, roof.mesh(), 'roof', { footprint, z_min_m: 0, z_max_m: 0 });
  v.displayRoofForm = flat ? 'flat' : 'shed';
  if (!flat) v.overview_roof_faces = [0, 1];
  return { id: 'test-house', function: 'domestic', culture: { culture: flat ? 'modernist-functionalist' : 'european-organic' }, footprint, roof_footprint: footprint, volumes: [v], structural_features: [], ground_z_m: 0 } as unknown as PlacedBuilding;
}
function withRoom(flat: boolean) {
  for (let k = 0; k < 20; k++) {
    const house = dwelling(flat);
    house.id += '-' + k;
    const room = craftedRoofRoom(house);
    if (room) return { house, room };
  }
  throw Error('No suitable house received an addition');
}

describe('inhabited roof volumes', () => {
  it.each([false, true])('fits a room to its roof plane and emits it only in the close detailed mesh (flat=%s)', flat => {
    const { house, room } = withRoom(flat);
    const verts = room.mesh.vertices;
    if (flat) {
      expect(buildingBounds(house)[5]).toBe(6);
      expect(buildingBounds(house, true)[5]).toBeCloseTo(Math.max(...verts.map(p => p.z)));
    }
    for (const p of verts) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(14);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(7);
    }
    expect(Math.max(...verts.map(p => p.z - (flat ? 6 : 6 + p.y * 0.62)))).toBeGreaterThan(1.8);
    if (!flat) {
      const cover = room.mesh.faces.filter(f => f.material === room.volume.materials.cladding);
      expect(cover).toHaveLength(2);
      for (const f of cover) expect(f.vertices.filter(i => Math.abs(verts[i].z - 6 - verts[i].y * 0.62) < 0.0001)).toHaveLength(2);
    }
    for (const [crafted, overview, expected] of [
      [false, false, false],
      [true, true, false],
      [true, false, true],
    ] as const) {
      let glass = false;
      eachBuildingTriangle(
        house,
        t => {
          glass ||= t.material === 'city3d:detail:glazing@51686c';
        },
        overview,
        undefined,
        0,
        false,
        crafted,
      );
      expect(glass).toBe(expected);
    }
    expect(craftedRoofRoom(house)).toBe(room);
  });
  it('keeps a courtyard, an occupied upper roof and a non-domestic site clear', () => {
    const { house } = withRoom(true);
    const occupied = { ...house, volumes: [...house.volumes, { ...house.volumes[0], role: 'minor', z_m: 6 }] };
    expect(craftedRoofRoom(occupied)).toBeNull();
    const withCourt = dwelling(true);
    withCourt.id = house.id;
    withCourt.volumes[0].footprint[0].holes.push([
      { x: 0.2, y: 0.2 },
      { x: 13.8, y: 0.2 },
      { x: 13.8, y: 6.8 },
      { x: 0.2, y: 6.8 },
    ]);
    expect(craftedRoofRoom(withCourt)).toBeNull();
    expect(craftedRoofRoom({ ...house, function: 'warehouse' })).toBeNull();
  });
});
