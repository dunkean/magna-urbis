import { describe, expect, it } from 'vitest';
import type { ForestOccupation } from '../../rust/bridge/terrainForest';
import type { LandUseLayer } from '../src/gen/types';
import { forestOccupation, withOccupationShapes } from '../src/ui/forestOccupation';
import { fortificationClearings, forestClearingDistance, ForestClearingRoom } from '../src/render/forestClearance';
import { buildNearTrees, TREE_STRIDE } from '../src/ui/terrain3dTrees';
import { OccupationPreparation } from '../src/ui/occupationPreparation';
import { packOccupationLanduse } from '../src/ui/occupationLanduse';

const rect = (x: number, y: number, w: number, h = w) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const ditch = {
  outer: [
    { x: 40, y: 30 },
    { x: 160, y: 90 },
    { x: 160, y: 110 },
    { x: 40, y: 50 },
  ],
  holes: [],
};
const landuse: LandUseLayer = { areas: [{ kind: 'forest', poly: rect(0, 0, 200) }], reserve: [rect(20, 20, 160)], ways: [], farmsteads: [] };
const alphaDistance = (o: ForestOccupation, x: number, y: number): number => {
  const gx = ((x - o.x) / o.width) * o.n - 0.5,
    gy = ((y - o.y) / o.width) * o.n - 0.5;
  const i = Math.floor(gx),
    j = Math.floor(gy),
    fx = gx - i,
    fy = gy - j;
  let alpha = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) alpha += o.rgba[((j + dy) * o.n + i + dx) * 4 + 3] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
  return (((128 - alpha) / 16) * o.width) / o.n;
};

describe('defensive forest clearing', () => {
  it('collects wet and dry ditches and glacis, excluding other outworks', () => {
    const glacis = { outer: rect(100, 100, 30), holes: [] };
    const shapes = fortificationClearings([
      {
        enclosures: [
          {
            path: [],
            kind: 'wall',
            gates: [],
            ditch: [
              { kind: 'dry', height_m: 3, shape: ditch },
              { kind: 'wet', height_m: 2, shape: ditch },
            ],
            outworks: [
              { kind: 'glacis', height_m: 0, shape: glacis },
              { kind: 'ravelin', height_m: 4, shape: glacis },
            ],
          },
        ],
      },
    ]);
    expect(shapes).toEqual([ditch, ditch, glacis]);
  });

  it.each([64, 192])('follows an oblique polygon edge through a reserve at resolution %i, also after a building merge', maxN => {
    const original = forestOccupation(landuse, maxN, 1, [], [ditch])!;
    const merged = withOccupationShapes(original, [{ outer: rect(10, 10, 6), holes: [] }]);
    for (const o of [original, merged])
      for (let x = 65; x < 140; x += 3.1) {
        // Lower bank is y = x/2 + 10; these sub-texel samples must stay on its correct side.
        const edge = x / 2 + 10;
        expect(alphaDistance(o, x, edge + 0.7)).toBeGreaterThan(0);
        expect(alphaDistance(o, x, edge - 0.7)).toBeLessThan(0);
      }
    expect(merged.clearings).toBe(original.clearings);
  });

  it('preserves holes and excludes crown overhang even on a sub-texel strip', () => {
    const ring = { outer: rect(0, 0, 100), holes: [rect(20, 20, 60)] };
    const room = new ForestClearingRoom([ring, { outer: rect(150, 0, 0.2, 100) }]);
    expect(room.keeps(50, 50, 10)).toBe(true);
    expect(room.keeps(25, 50, 6)).toBe(false);
    expect(room.keeps(10, 50)).toBe(false);
    expect(room.keeps(150.1, 50)).toBe(false);
    expect(room.keeps(149, 50, 2)).toBe(false);
    expect(room.keeps(140, 50, 2)).toBe(true);
  });

  it('retains clearing geometry and alpha through worker preparation', () => {
    const preparation = new OccupationPreparation();
    preparation.register(1, packOccupationLanduse(landuse));
    const worker = preparation.occupation(1, 2, [], [ditch])!;
    const direct = forestOccupation(landuse, undefined, undefined, [], [ditch])!;
    expect(worker.rgba).toEqual(direct.rgba);
    expect(worker.clearings).toEqual([ditch]);
    expect(alphaDistance(worker, 90, 60)).toBeGreaterThan(0);
  });

  it('removes modelled crowns from the ditch while retaining class 7 trees elsewhere', () => {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) rgba.set([220, 150, 40, 255], i * 4);
    const base = forestOccupation(landuse, 128, 1)!;
    const inputs = { field: { n: 8, rgba, x: 0, y: 0, width: 200, key: 'moat' }, occupation: base, seed: 7, climate: { temperature: 12, precipitation: 900 }, renderV2: 1, zone: 1, season: 0.5, water: () => 0, height: () => 20 };
    const view = { x: 100, y: 100, forwardX: 0, forwardY: 1 };
    const before = buildNearTrees(inputs, view);
    // Leave all raster classes unchanged: the exact invariant must work independently of nearest class texels.
    const after = buildNearTrees({ ...inputs, occupation: { ...base, clearings: [ditch] } }, view);
    expect(before.length).toBeGreaterThan(after.length);
    expect(after.length).toBeGreaterThan(0);
    for (let i = 0; i < after.length; i += TREE_STRIDE) expect(forestClearingDistance(ditch, after[i], after[i + 1])).toBeLessThan(-after[i + 3]);
  });
});
