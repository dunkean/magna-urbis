import { describe, expect, it } from 'vitest';
import { UrbanGroundCuts } from '../src/ui/urbanGroundCuts';

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ outer: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [] });

describe('town moats dug into the 3D ground', () => {
  // A moat band 10 m wide (y 100..110) cut by a 6 m causeway at x 200..206, with a gate whose street runs south across it.
  const ditch = [{ kind: 'wet', height_m: 3, shape: rect(0, 100, 200, 110) }, { kind: 'wet', height_m: 3, shape: rect(206, 100, 400, 110) }];
  const gatehouses = [{ kind: 'tower', passage: [{ x: 203, y: 80 }, { x: 203, y: 95 }], passage_width_m: 6 }];
  const cuts = new UrbanGroundCuts([{ ditch, gatehouses }]);

  it('lowers the ground inside the moat by its depth, with sloped banks, and nowhere else', () => {
    expect(cuts.lower(100, 105, 10)).toBeCloseTo(7, 5);
    expect(cuts.lower(100, 100.5, 10)).toBeGreaterThan(7.2);
    expect(cuts.lower(100, 100.5, 10)).toBeLessThan(10);
    expect(cuts.lower(100, 90, 10)).toBe(10);
    expect(cuts.lower(100, 120, 10)).toBe(10);
  });

  it('digs on under the gate street, so the bridge spans one continuous ditch', () => {
    expect(cuts.lower(203, 105, 10)).toBeCloseTo(7, 1);
    expect(cuts.lower(203, 90, 10)).toBe(10);
  });

  it('digs nothing without moats', () => {
    expect(new UrbanGroundCuts([{}]).lower(100, 105, 10)).toBe(10);
  });
});
