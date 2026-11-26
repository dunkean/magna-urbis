import { describe, expect, it } from 'vitest';
import { CityGlPacker, triangulatePolygons } from '../src/render/cityGlBuild';
import { assembleTriangulation, polygonHashes, reusePlan } from '../src/render/city/gl/triangulationCache';

const square = (x: number, y: number, s: number, hole = false) => ({
  outer: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
  holes: hole
    ? [
        [
          { x: x + s / 4, y: y + s / 4 },
          { x: x + s / 4, y: y + (3 * s) / 4 },
          { x: x + (3 * s) / 4, y: y + (3 * s) / 4 },
          { x: x + (3 * s) / 4, y: y + s / 4 },
        ],
      ]
    : [],
});
const pack = (shapes: ReturnType<typeof square>[]) => {
  const packer = new CityGlPacker({ x: 0, y: 0 });
  shapes.forEach((shape, i) => packer.add(shape, i));
  return packer.done();
};

describe('triangulation reuse across packings', () => {
  it('triangulates only the changed polygons and matches a full triangulation', () => {
    const before = pack([square(0, 0, 10), square(20, 0, 10, true), square(40, 0, 10)]);
    const held = { polygons: before, result: triangulatePolygons(before), hashes: polygonHashes(before) };
    // An edit: the first square kept, the second moved, a new one inserted, the last one kept.
    const after = pack([square(0, 0, 10), square(21, 0, 10, true), square(60, 0, 5), square(40, 0, 10)]);
    const plan = reusePlan(held, after, polygonHashes(after));
    expect(Array.from(plan.from)).toEqual([0, -1, -1, 2]);
    expect(plan.missingCount).toBe(2);
    const assembled = assembleTriangulation(held, after, plan.from, plan.missing, triangulatePolygons(plan.missing));
    expect(assembled).toEqual(triangulatePolygons(after));
  });
});
