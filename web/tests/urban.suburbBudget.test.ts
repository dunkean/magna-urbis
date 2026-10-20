import { expect, it } from 'vitest';
import { Rng } from '../src/gen/core/rng';
import type { Polygon } from '../src/gen/core/geom';
import { area } from '../src/gen/geo/poly';
import { mpArea, tryDifference, tryIntersection } from '../src/gen/geo/bool';
import { buildPlot, MIN_BW, shapeOf } from '../src/gen/urban/buildings';
import { MORPHOLOGIES } from '../src/gen/urban/morphology';
import type { Plot } from '../src/gen/urban/plots';

it('keeps a habitable street-front house and an actual yard on a shallow suburb lot', () => {
  const poly: Polygon = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 8 }, { x: 0, y: 8 }];
  const front: Plot['front'] = [poly[0], poly[1]], nrm = { x: 0, y: 1 };
  const plot: Plot = { poly, front, nrm, block: 0, zone: 'faubourg',
    sideA: { p: front[0], d: nrm }, sideB: { p: front[1], d: nrm },
    sideFronts: [], rank: 1, depth: 8, wide: false, run: 0, order: 0 };
  const result = buildPlot(plot, 0.5, MORPHOLOGIES['european-organic'], new Rng('suburb-yard'));
  const roofs = result.filter((b) => b.kind !== 'garden');
  expect(roofs.some((b) => b.kind === 'house')).toBe(true);
  expect(roofs.reduce((sum, b) => sum + area(b.poly), 0) / area(poly)).toBeLessThanOrEqual(0.6);
  for (const b of roofs) {
    expect(shapeOf(b.poly).w).toBeGreaterThanOrEqual(MIN_BW);
    const outside = tryDifference(b.poly, poly);
    expect(outside.failed).toBe(false);
    expect(mpArea(outside.pieces)).toBeLessThanOrEqual(1e-6);
    for (const garden of result.filter((b) => b.kind === 'garden')) {
      const hit = tryIntersection(b.poly, garden.poly);
      expect(hit.failed).toBe(false);
      expect(mpArea(hit.pieces)).toBeLessThanOrEqual(1e-6);
    }
  }
  const yard = tryDifference(poly, ...roofs.map((b) => b.poly));
  expect(yard.failed).toBe(false);
  expect(mpArea(yard.pieces)).toBeGreaterThan(0.35 * area(poly));
});
