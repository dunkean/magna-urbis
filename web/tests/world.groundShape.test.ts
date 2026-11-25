import { describe, expect, it } from 'vitest';
import { groundShapeSteps, SHAPE_BLOCK, type GroundShape } from '../src/render/world/groundShape';
import { TerrainHeights } from '../src/render/world/heights';
import { patchLevels, shapedPatchLevels } from '../src/render/world/patches';
import { UrbanGroundCuts } from '../src/ui/urbanGroundCuts';
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
