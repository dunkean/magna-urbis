import { describe, expect, it } from 'vitest';
import { groundShapeSteps, SHAPE_BLOCK, SQUEEZE_SIDE, SQUEEZE_STEP, type GroundShape } from '../src/render/world/groundShape';
import { TerrainHeights } from '../src/render/world/heights';
import { patchLevels, shapedPatchLevels } from '../src/render/world/patches';
import { UrbanGroundCuts } from '../src/ui/urbanGroundCuts';
import { ROAD_SQUEEZE, RoadSqueeze, squeezePush } from '../src/render/steepRoads';
import type { GroundShapeLot } from '../src/ui/urbanGroundShape';

const rect = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];
// A 20 % slope rising to the east.
const slope = (x: number): number => 50 + 0.2 * x;
const shapeOf = (lots: GroundShapeLot[], cuts = new UrbanGroundCuts()): GroundShape | undefined => {
  const steps = groundShapeSteps(1024, [lots], cuts, slope);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};
const lot = (x: number, y: number): GroundShapeLot => ({ ring: rect(x, y, 24, 24), pads: [{ ring: rect(x + 6, y + 6, 12, 10), seat: slope(x + 6) + 0.6, low: slope(x + 6), high: slope(x + 18), shaped: true }] });

describe('shaped ground of the tilted map', () => {
  it('levels a hillside lot, leaves the rest alone, and has no step across a block edge', () => {
    const shape = shapeOf([lot(SHAPE_BLOCK - 12, 100)])!;
    const ground = (x: number, y: number): number => slope(x) + shape.groundAt(x, y);
    expect(ground(SHAPE_BLOCK + 4, 112)).toBeCloseTo(ground(SHAPE_BLOCK - 4, 112), 0.5);
    expect(shape.groundAt(600, 600)).toBe(0);
    expect(shape.groundAt(SHAPE_BLOCK - 1e-6, 108)).toBeCloseTo(shape.groundAt(SHAPE_BLOCK, 108), 4);
    expect(shapeOf([])).toBeUndefined();
  });

  it('digs a moat in the drawn ground only', () => {
    const shape = shapeOf([], new UrbanGroundCuts([{ ditch: [{ kind: 'dry', height_m: 3, shape: { outer: rect(300, 300, 200, 20), holes: [] } }] }]))!;
    expect(shape.drawnAt(400, 310)).toBeLessThan(-2.5);
    expect(shape.groundAt(400, 310)).toBe(0);
    expect(shape.drawnAt(400, 340)).toBe(0);
    expect(shape.low).toBeLessThan(-2.5);
  });

  it('squeezes the picture across a road on a steep slope, not along it, and moves no ground', () => {
    // An 80 % slope rising to the east: a road along the contour and one straight up the slope.
    const cliff = (x: number): number => 50 + 0.8 * x,
      road = (path: { x: number; y: number }[]) => ({ path, widths: path.map(() => 6) }),
      roads = [
        road([
          { x: 500, y: 100 },
          { x: 500, y: 250 },
          { x: 500, y: 400 },
        ]),
        road([
          { x: 100, y: 700 },
          { x: 250, y: 700 },
          { x: 400, y: 700 },
        ]),
      ],
      squeeze = new RoadSqueeze(roads, cliff),
      field = new Float32Array(4),
      k = Math.hypot(1, 0.8),
      // Plan distance from the centreline of the picture shown at the plan distance d east of the road.
      shown = (d: number): number => (squeeze.at(500 + d, 250, field) ? d + squeezePush(field[0], field[1], field[2], field[3], 1) : d);
    // The road's edge (3 m of picture) lies at 3 / k in plan, 3 m on the surface; the squeeze is linear across the road.
    expect(shown(3 / k)).toBeCloseTo(3, 6);
    expect(shown(1)).toBeCloseTo(k, 6);
    // Beyond the bank the picture is in its place, and never folds on the way.
    const reach = 3 + ROAD_SQUEEZE.margin + ROAD_SQUEEZE.bank;
    expect(shown(reach - 0.01)).toBeCloseTo(reach - 0.01, 1);
    expect(squeeze.at(500 + reach + 1, 250, field)).toBe(false);
    for (let d = 0; d < reach; d += 0.5) expect(shown(d + 0.5)).toBeGreaterThan(shown(d));
    // Flat in the top view (no rise), and none for the road that climbs the slope.
    squeeze.at(502, 250, field);
    expect(squeezePush(field[0], field[1], field[2], field[3], 0)).toBe(0);
    expect(squeeze.at(250, 702, field)).toBe(false);
    // The tilted map holds the field on its blocks; the ground stays natural.
    const steps = groundShapeSteps(1024, [[]], new UrbanGroundCuts(), cliff, roads);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const shape = step.value!,
      nodes = shape.squeeze[shape.index[1]]!,
      node = ((248 / SQUEEZE_STEP) * SQUEEZE_SIDE + (504 - SHAPE_BLOCK) / SQUEEZE_STEP) * 4;
    expect(shape.squeezed).toBe(true);
    expect([...nodes.subarray(node, node + 4)]).toEqual([4, 0, expect.closeTo(0.8, 5), 3 + ROAD_SQUEEZE.margin]);
    expect(shape.groundAt(500, 250)).toBe(0);
    expect(shape.low).toBe(0);
  });

  it('is read by the relief, exaggerated with it', () => {
    const heights = new TerrainHeights(new Float32Array(16).fill(20), 4, 1024, 0, 2),
      natural = heights.heightAt(400, 310);
    heights.shape = shapeOf([], new UrbanGroundCuts([{ ditch: [{ kind: 'dry', height_m: 3, shape: { outer: rect(300, 300, 200, 20), holes: [] } }] }]));
    expect(heights.heightAt(400, 310)).toBeCloseTo(natural + 2 * heights.shape!.drawnAt(400, 310), 6);
    expect(heights.groundAt(400, 310)).toBe(natural);
    expect(heights.naturalAt(400, 310)).toBe(natural);
    // Cells of a few metres near the eye, whatever the height grid.
    const levels = shapedPatchLevels(patchLevels(2048), 40000);
    expect(40000 / 2 ** levels / 32).toBeLessThanOrEqual(3.5);
  });
});
