import { describe, expect, it } from 'vitest';
import { CityGlPacker, triangulatePolygons } from '../src/render/cityGlBuild';
import { concatPolygons, samePlanPage, splitPlanSteps, splitTriangulation } from '../src/render/city/gl/pages';
import type { CityScene } from '../src/render/city/model/contract';

const square = (x: number, y: number, s: number) => ({
  outer: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
  holes: [],
});
const run = <T>(steps: Generator<void, T>): T => {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
};
const scene = (blocks: ReturnType<typeof square>[]): CityScene => ({ layouts: [], blocks: blocks.map((shape, i) => ({ shape, layout: 0, kind: 'house', id: `b${i}` })), parcels: [], streets: [], walls: [], districts: [], landmarks: [], footprint: [], quays: [], extent: { minX: 0, minY: 0, maxX: 5000, maxY: 100 } }) as unknown as CityScene;

describe('GPU town pages', () => {
  it('splits by page and keeps only the pages whose elements are the same', () => {
    const a = [square(10, 10, 20), square(100, 10, 20), square(3000, 10, 20)];
    const before = run(splitPlanSteps(scene(a)));
    expect(before.size).toBe(2);
    // An edit of the far block: the near page holds merged copies of the same elements.
    const edited = run(splitPlanSteps(scene([a[0], a[1], square(3000, 10, 25)])));
    const near = [...before.keys()][0],
      far = [...before.keys()][1];
    expect(samePlanPage(before.get(near)!, edited.get(near)!)).toBe(true);
    expect(samePlanPage(before.get(far)!, edited.get(far)!)).toBe(false);
  });
  it('triangulates several pages in one run and gives each its own triangulation back', () => {
    const pack = (shapes: ReturnType<typeof square>[]) => {
      const packer = new CityGlPacker({ x: 0, y: 0 });
      shapes.forEach((shape, i) => packer.add(shape, i));
      return packer.done();
    };
    const list = [pack([square(0, 0, 10), square(20, 0, 10)]), pack([square(50, 0, 5)])];
    const parts = splitTriangulation(triangulatePolygons(concatPolygons(list)), list);
    expect(parts).toEqual(list.map(p => triangulatePolygons(p)));
  });
});
