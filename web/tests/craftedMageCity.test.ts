import { describe, expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { OverviewVolume } from '../src/render/urbanBuildingGeometry';
import { baseVolume } from '../src/render/city3d/volume';
import { RoofBuilder } from '../src/render/city3d/roofGeometry';
import { OPENING, slots } from '../src/render/city3d/materials';
import { craftedMageCity } from '../src/render/craftedMageCity';

function dwelling(id: string, landmark = false, doorway = false) {
  const ring = Array.from({ length: 16 }, (_, i) => ({ x: 3 * Math.cos((i * Math.PI) / 8), y: 3 * Math.sin((i * Math.PI) / 8) }));
  const footprint = [{ outer: ring, holes: [] }],
    mesh = new RoofBuilder();
  if (doorway)
    mesh.face(
      [
        { x: 2.97, y: 0.12, z: 11.02 },
        { x: 2.79, y: 1.02, z: 11.02 },
        { x: 2.79, y: 1.02, z: 13.12 },
        { x: 2.97, y: 0.12, z: 13.12 },
      ],
      OPENING,
    );
  const v: OverviewVolume = baseVolume(id, footprint, 11, 17, 7, slots('stone', 'tile'), mesh.mesh(), 'RF-GABLE', { footprint, z_min_m: 10, z_max_m: 11 });
  v.displayRoofForm = 'cone';
  return { id, culture: { culture: 'wizard-city' }, programme: { landmark }, entrance: { x: 3.1, y: 0.6 }, volumes: [v] } as unknown as PlacedBuilding;
}

describe('crafted wizard skyline', () => {
  it('converts most everyday towers into lower studios with human-size entrances', () => {
    const buildings = Array.from({ length: 80 }, (_, i) => dwelling('tower-' + i));
    const rooms = buildings
      .map(craftedMageCity)
      .map(b => b.volumes[0] as OverviewVolume)
      .filter(v => v.displayRoofForm === 'dome');
    expect(rooms.length).toBeGreaterThan(50);
    expect(rooms.length).toBeLessThan(79);
    for (const v of rooms) {
      expect(v.wall_height_m).toBeLessThan(5);
      expect(v.footprint[0].outer).toHaveLength(8);
      expect(v.levels[0].height_m).toBeCloseTo(v.wall_height_m, 7);
      const mesh = v.roof_mesh,
        door = mesh.faces.find(f => f.material === OPENING)!;
      const [a, b, c] = door.vertices.map(i => mesh.vertices[i]);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.85);
      expect(c.z - a.z).toBeGreaterThan(2);
      expect(Math.max(...mesh.vertices.map(p => p.z))).toBeCloseTo(v.z_m + v.wall_height_m + v.roof_height_m, 6);
    }
    expect(buildings.every(b => b.volumes[0].wall_height_m === 17)).toBe(true);
  });
  it('retains landmarks and existing entrance geometry in both crown variants', () => {
    const materials = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const source = dwelling('observatory-' + i, true, true);
      const result = craftedMageCity(source),
        v = result.volumes[0] as OverviewVolume;
      expect(craftedMageCity(result)).toBe(result);
      expect(v.displayRoofForm).toBe('cone');
      expect(v.wall_height_m).toBe(17);
      expect(v.roof_mesh.vertices.slice(-4)).toEqual(source.volumes[0].roof_mesh.vertices);
      materials.add(String(v.roof_mesh.faces.length));
    }
    expect(materials.size).toBeGreaterThan(1);
  });
});
