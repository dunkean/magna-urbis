import { describe, expect, it } from 'vitest';
import { groundShapeRegionSteps, groundShapeSteps, type GroundShape } from '../src/render/world/groundShape';
import { UrbanGroundCuts } from '../src/ui/urbanGroundCuts';
import type { GroundShapeLot } from '../src/ui/urbanGroundShape';
import { forestOccupation, forestOccupationRegion, withOccupationShapes, withOccupationShapesRegion } from '../src/ui/forestOccupation';
import type { LandUseLayer } from '../src/gen/types';

const rect = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];
const slope = (x: number): number => 50 + 0.2 * x;
const lot = (x: number, y: number): GroundShapeLot => ({ ring: rect(x, y, 24, 24), pads: [{ ring: rect(x + 6, y + 6, 12, 10), seat: slope(x + 6) + 0.6, low: slope(x + 6), high: slope(x + 18), shaped: true }] });
const run = <T>(steps: Generator<void, T>): T => {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

describe('local edit regions', () => {
  it('shapes the ground again only inside the region, as a whole shaping would', () => {
    const kept = [lot(100, 100), lot(600, 600)],
      before = run(groundShapeSteps(1024, [{ lots: [...kept, lot(300, 300)] }], new UrbanGroundCuts(), slope))!,
      after = [...kept, lot(330, 310)],
      whole = run(groundShapeSteps(1024, [{ lots: after }], new UrbanGroundCuts(), slope))!,
      region = run(groundShapeRegionSteps(before, [{ x0: 270, y0: 270, x1: 390, y1: 370 }], 1024, [{ lots: after }], new UrbanGroundCuts(), slope)) as GroundShape;
    for (let y = 0; y < 1024; y += 7) for (let x = 0; x < 1024; x += 7) expect(region.drawnAt(x, y)).toBeCloseTo(whole.drawnAt(x, y), 6);
    // The blocks away from the edit are the previous ones.
    expect(region.drawn[before.index[0]]).toBe(before.drawn[before.index[0]]);
    expect(region.base).toBe(before);
  });

  it('rasterises the occupation and merges the buildings again only inside the region, as a whole raster would', () => {
    const landuse: LandUseLayer = { areas: [{ kind: 'field', poly: rect(0, 0, 800, 800) } as LandUseLayer['areas'][number]], reserve: [rect(200, 200, 300, 300)], farmsteads: [] };
    const way = (x: number) => ({ path: [{ x, y: 210 }, { x, y: 490 }], half: 3 });
    const previous = forestOccupation(landuse, 512, 2, [way(300)])!,
      edit = [{ x0: 280, y0: 200, x1: 420, y1: 500 }],
      whole = forestOccupation(landuse, 512, 2, [way(400)])!,
      region = forestOccupationRegion(previous, landuse, edit, [way(400)], [], 512, 2)!;
    expect(Buffer.compare(region.rgba, whole.rgba)).toBe(0);
    expect(region.key).toBe(whole.key);
    const house = (x: number) => [{ outer: rect(x, 300, 12, 10), holes: [] }],
      merged = withOccupationShapes(previous, house(310)),
      wholeMerge = withOccupationShapes(whole, house(390)),
      regionMerge = withOccupationShapesRegion(merged, whole, house(390), edit)!;
    expect(Buffer.compare(regionMerge.rgba, wholeMerge.rgba)).toBe(0);
    // The texels outside the dirty rectangles are the previous ones: a renderer holding the previous uploads only those.
    for (const [next, base] of [
      [region, previous],
      [regionMerge, merged],
    ] as const) {
      expect(next.dirty?.base).toBe(base.key);
      const inside = new Uint8Array(next.n * next.n);
      for (const r of next.dirty!.rects) for (let j = r.y; j < r.y + r.height; j++) inside.fill(1, j * next.n + r.x, j * next.n + r.x + r.width);
      let outsideChanged = 0;
      for (let i = 0; i < inside.length; i++) if (!inside[i] && next.rgba.subarray(i * 4, i * 4 + 4).some((v, c) => v !== base.rgba[i * 4 + c])) outsideChanged++;
      expect(outsideChanged).toBe(0);
    }
  });
});
