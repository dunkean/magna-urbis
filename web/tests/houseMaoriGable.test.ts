import { expect, it } from 'vitest';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { facadeDoor } from '../src/render/city3d/features';
import { OPENING } from '../src/render/city3d/materials';
import { RoofBuilder } from '../src/render/city3d/roofGeometry';
import { baseVolume } from '../src/render/city3d/volume';
import { detailedHouseFront } from '../src/render/houseFronts';
import type { OverviewVolume } from '../src/render/urbanBuildingGeometry';

function whare(angle: number, inset: number): PlacedBuilding {
  const at = (s: number, d: number, z = 0) => ({ x: 83 + s * Math.cos(angle) - d * Math.sin(angle), y: 17 + s * Math.sin(angle) + d * Math.cos(angle), z });
  const ring = [at(0, 0), at(6, 0), at(6, 10), at(0, 10)];
  const footprint = [{ outer: ring, holes: [] }];
  const m = { coating: 'city3d:wall:wood', cladding: 'city3d:cover:thatch', frame: 'wood', roof_frame: 'wood', base: 'stone', infill: 'wood' };
  const roof = new RoofBuilder();
  const ridge0 = at(3, inset, 4.8), ridge1 = at(3, 10 - inset, 4.8);
  roof.face([at(0, 0, 2.2), ridge0, ridge1, at(0, 10, 2.2)], m.cladding);
  roof.face([ridge0, at(6, 0, 2.2), at(6, 10, 2.2), ridge1], m.cladding);
  facadeDoor(roof, ring[0], ring[1], 1, 4.1, 5.05, 0.02, 1.67, 0.04, OPENING);
  const v: OverviewVolume = baseVolume('whare', footprint, 0, 2.2, 2.6, m, roof.mesh(), 'RF-GABLE', { footprint, z_min_m: 0, z_max_m: 0 });
  v.overview_roof_faces = [0, 2];
  v.displayRoofForm = 'gable';
  return { id: 'whare', function: 'domestic', culture: { culture: 'maori-pa' }, entrance: at(4.6, -2), footprint, roof_footprint: footprint, volumes: [v], courtyards: [] } as unknown as PlacedBuilding;
}

it('extends a ridge to the gable and keeps an existing off-centre door as the only door leaf', () => {
  for (const angle of [0, 0.64, 2.35]) {
    const front = detailedHouseFront(whare(angle, 0.12));
    expect(front?.frame.hasGableDoor).toBe(true);
    expect(front?.frame.nx).toBeCloseTo(Math.sin(angle));
    expect(front?.frame.ny).toBeCloseTo(-Math.cos(angle));
    expect(front?.frame.height).toBeCloseTo(4.8);
    expect(front?.mesh.faces.some(f => f.material === 'city3d:detail:door@4e3d31')).toBe(false);
  }
});

it('omits the gable porch when the ridge ends well inside the walls', () => {
  expect(detailedHouseFront(whare(0.37, 1.9))).toBeNull();
});
