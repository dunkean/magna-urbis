import { expect, it } from 'vitest';
import { historicFronts } from '../src/render/houseHistoricFronts';
import { buildHouseFront } from '../src/render/houseFrontKit';
import { craftedArchitecture } from '../src/render/craftedArchitecture';
import { RoofBuilder } from '../src/render/city3d/roofGeometry';
import { baseVolume } from '../src/render/city3d/volume';
import { OPENING, slots } from '../src/render/city3d/materials';

for (const id of ['byzantine-greek', 'venetian-lagoon', 'sahel', 'swahili-stone-town']) {
  it(`keeps the native door and every native light clear in ${id}`, () => {
    for (const width of [1.47, 2.8, 5.9]) for (const height of [2.44, 5.7]) {
      const doorWidth = 1.09, doorHeight = 2.23;
      const windows = [{ x: -1.71, bottom: .89, top: 2.11, width: .92 }, { x: 1.01, bottom: 1.17, top: 2.27, width: .8 },
                       { x: -.13, bottom: 3.05, top: 4.5, width: 1.19 }];
      const frame = { x: 0, y: 0, z: 0, nx: 0, ny: 1 };
      const opts = { width, depth: .75, height, doorWidth, doorHeight, windows, seed: 42, floor: 0, wall: 'wall', cover: 'cover' };
      const mesh = buildHouseFront(frame, opts, historicFronts[id]);
      expect(mesh.faces.length).toBeGreaterThan(0);
      for (const f of mesh.faces) {
        const vertices = f.vertices.map(i => mesh.vertices[i]), xs = vertices.map(p => p.x), zs = vertices.map(p => p.z);
        for (const a of [{ x: 0, bottom: 0, top: doorHeight, width: doorWidth }, ...windows]) {
          const left = Math.max(Math.min(...xs), a.x - a.width / 2), right = Math.min(Math.max(...xs), a.x + a.width / 2);
          const lo = Math.max(Math.min(...zs), a.bottom), hi = Math.min(Math.max(...zs), a.top);
          expect(right - left > .001 && hi - lo > .001).toBe(false);
        }
      }
    }
  });
}

it('fits window hoods far from the entrance and below upstairs openings on two seeded lots', () => {
  for (const [id, culture] of [['lot-158', 'venetian-lagoon'], ['lot-731', 'byzantine-greek']]) {
    const mesh = new RoofBuilder(), windows = [7, 9.2, 11.4, 13.6, 15.8, 18.0, 20.2];
    function opening(x: number, z: number, ht: number) {
      mesh.face([{x,y:-.04,z},{x:x+1,y:-.04,z},{x:x+1,y:-.04,z:z+ht},{x,y:-.04,z:z+ht}], OPENING);
    }
    opening(1, .02, 2.1);
    for (const x of windows) opening(x, .8, 1.2);
    opening(7, 2.19, 1.11); // Too close to the downstairs head to fit its arch.
    const footprint = [{outer:[{x:0,y:0},{x:23,y:0},{x:23,y:4},{x:0,y:4}],holes:[]}];
    const v = baseVolume(id, footprint, 0, 3.45, 0, slots('stone','tile'), mesh.mesh(), 'RF-GABLE', {footprint,z_min_m:0,z_max_m:0});
    const fitted = new Set<number>();
    craftedArchitecture(v, culture, triangle => {
      if (!/istrian-hood|brick-arch/.test(triangle.material ?? '')) return;
      const cx = triangle.points.reduce((s,p)=>s+p[0]/3,0);
      const x = windows.find(x=>cx>=x-.2 && cx<=x+1.2)!;
      expect(x).toBeGreaterThan(8);
      expect(triangle.points.every(p=>p[2]>=2 && p[2]<=3.45)).toBe(true);
      fitted.add(x);
    });
    expect(fitted.size).toBe(4);
  }
});
