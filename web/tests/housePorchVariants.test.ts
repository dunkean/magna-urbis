import { describe, expect, it } from 'vitest';
import catalogue from '../../rust/crates/core/src/urban/catalogue.json';
import { hash } from '../src/render/city3d/massing';
import { buildHouseFront, type FrontDesign } from '../src/render/houseFrontKit';
import { cultureHouseFronts } from '../src/render/houseFronts';
import { mushroomGrower } from '../src/render/houseModernFronts';

const frame = { x: 0, y: 0, z: 0, nx: 0, ny: 1 };
const bay = { width: 5.2, depth: 1.85, height: 3.65, doorHeight: 2.12, doorWidth: 1.06, floor: 0, wall: 'city3d:wall:stone', cover: 'city3d:cover:tile', windows: [{ x: -1.97, width: 0.65, bottom: 0.98, top: 2.02 }] };
const southAsian = new Set(['dravidian-temple', 'indian-temple', 'rajput-fort', 'south-asian-metropolis']);

/** Compare only the addition at a fixed socket. Ignore colour, overall dimensions and vertex ordering. */
function geometry(draw: FrontDesign, seed: number) {
  const mesh = buildHouseFront(frame, { ...bay, seed }, draw);
  const points = mesh.vertices.map(p => [p.x, p.y, p.z]);
  const min = [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))),
    size = min.map((m, i) => Math.max(...points.map(p => p[i])) - m || 1);
  return mesh.faces
    .map(f =>
      f.vertices
        .map(k => points[k].map((v, i) => Math.round(((v - min[i]) / size[i]) * 80)).join(','))
        .sort()
        .join('/'),
    )
    .sort()
    .join(';');
}
describe('procedural domestic porches', () => {
  it('covers every catalogue entrance with a regional or South Asian construction', () => {
    expect([...Object.keys(cultureHouseFronts), ...southAsian].sort()).toEqual(Object.keys(catalogue.cultures).sort());
  });
  it('reproduces the same entrance and varies its geometry on the same facade', () => {
    for (const [culture, draw] of Object.entries({ ...cultureHouseFronts, 'fungal-farm': mushroomGrower })) {
      const signatures = new Set<string>();
      for (let i = 0; i < 48 && signatures.size < 3; i++) {
        const seed = hash('porch/block-028/lot-' + i),
          result = geometry(draw, seed);
        if (i === 0) expect(geometry(draw, seed), culture).toBe(result);
        if (result) signatures.add(result);
      }
      expect(signatures.size, culture).toBeGreaterThanOrEqual(3);
    }
  });
});
