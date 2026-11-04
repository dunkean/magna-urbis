import { expect, it } from 'vitest';
import { silhouetteScene, type CityPlacementRequest } from '../src/ui/urbanSilhouettes';
import { city3dScene } from '../src/render/city3dMeshes';
import { buildCityBuildings } from '../src/render/cityCanvas';
import { funeraryLandFill, lotRoleChoices } from '../src/render/cityRoles';

it('retains low grave geometry on open cemetery land in the plan and 3D', () => {
  const shape = { outer: [{ x: 0, y: 0 }, { x: 1.35, y: 0 }, { x: 1.35, y: 2.3 }, { x: 0, y: 2.3 }], holes: [] };
  const request = { id: 'grave', parcel_id: 'cemetery', function: 'open_space', culture: { culture: 'necropolis', pack: 'AF-NILE' },
    preview: [shape], buildable: [shape], accesses: [], terrain: { ground_z_m: 0 },
    programme: { role: 'open.necropolis', households: 0, massing: [{ floors: 1, eave_m: 0.45, rise_m: 0, roof: 'flat', ridges: [], wall: 'stone', cover: 'stone', openings: 'none' }] } } as unknown as CityPlacementRequest;
  const batch = silhouetteScene([request]);
  expect(batch.open_spaces).toHaveLength(0);
  expect(batch.buildings).toHaveLength(1);
  expect(buildCityBuildings(batch).items[0].surface).toEqual([shape]);
  const volume = city3dScene(batch).buildings[0].volumes[0];
  expect(volume.wall_height_m).toBe(0.45);
  expect(volume.roof_height_m).toBe(0);
  expect(volume.roof_mesh.faces.every(f => !f.material.includes('opening'))).toBe(true);
  expect(funeraryLandFill('open.necropolis')).toBeDefined();
  expect(funeraryLandFill('open.garden')).toBeUndefined();
  expect(lotRoleChoices('necropolis').some(c => c.role === 'funerary.mausoleum.ruin')).toBe(true);
});

it('draws a ruin piece as a roofless pale stub without openings', () => {
  const stub = { outer: [{ x: 0, y: 0 }, { x: 2.4, y: 0 }, { x: 2.4, y: 0.6 }, { x: 0, y: 0.6 }], holes: [] };
  const request = { id: 'ruin', parcel_id: 'lot', function: 'domestic', culture: { culture: 'european-organic', pack: 'EUR-MED' },
    preview: [stub], buildable: [stub], accesses: [], terrain: { ground_z_m: 0 },
    programme: { role: 'dwelling.house.ruin', households: 0, massing: [{ floors: 1, eave_m: 1.6, rise_m: 0, roof: 'flat', ridges: [], wall: 'stone', cover: 'ruin', tone: 0.4, openings: 'none' }] } } as unknown as CityPlacementRequest;
  const volume = city3dScene(silhouetteScene([request])).buildings[0].volumes[0];
  expect(volume.wall_height_m).toBe(1.6);
  expect(volume.roof_height_m).toBe(0);
  expect(volume.roof_mesh.faces.every(f => !f.material.includes('opening'))).toBe(true);
  // The broken top is lighter than an intact stone roof.
  const luma = (h: string) => { const v = parseInt(h.slice(-6), 16); return (v >> 16) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11; };
  expect(luma(volume.materials.cladding)).toBeGreaterThan(150);
});
