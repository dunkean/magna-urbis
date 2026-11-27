import { describe, expect, it } from 'vitest';
import type { MoatCrossing, MoatRun } from '../../rust/bridge/urban';
import { UrbanGroundCuts } from '../src/ui/urbanGroundCuts';

/** A straight run along x, stations every 10 m, inner lip at `yIn`, outer lip at `yOut`. */
const straight = (x0: number, x1: number, yIn: number, yOut: number, rim: number, bed: number, ends: MoatRun['ends'] = ['work', 'work']): MoatRun => {
  const xs = Array.from({ length: Math.round((x1 - x0) / 10) + 1 }, (_, i) => x0 + 10 * i);
  return { inner: xs.map(x => ({ x, y: yIn })), outer: xs.map(x => ({ x, y: yOut })), rim: xs.map(() => rim), bed: xs.map(() => bed), ends, reaches: [{ from: 0, to: xs.length - 1, supply: 'dry' }] };
};
const circuit = (run: MoatRun, form = 'earth', crossings: MoatCrossing[] = []) => ({ moat: { form, depth_m: 3, runs: [run], crossings } });

describe('town moats dug into the 3D ground from their stations', () => {
  it('digs the full depth at mid width, nothing at the lips, and nothing outside', () => {
    const cuts = new UrbanGroundCuts([circuit(straight(0, 400, 100, 110, 10, 7))]);
    expect(cuts.lower(105, 105, 10)).toBeCloseTo(7, 6);
    expect(cuts.lower(105, 100, 10)).toBeCloseTo(10, 6);
    expect(cuts.lower(105, 100.5, 10)).toBeGreaterThan(7.2);
    expect(cuts.lower(105, 100.5, 10)).toBeLessThan(10);
    expect(cuts.lower(105, 90, 10)).toBe(10);
    expect(cuts.lower(105, 120, 10)).toBe(10);
  });

  it('keeps a level bottom on a cross slope, at the engine bed carried onto the ground, each bank up to its own lip', () => {
    // The ground rises 2 m from the inner to the outer lip; the engine's frame lies 10 m lower than the renderer's.
    const ground = (p: { x: number; y: number }): number => 10 + 0.1 * (p.y - 100),
      cuts = new UrbanGroundCuts([circuit(straight(0, 400, 100, 120, 0, -3))], ground),
      at = (x: number, y: number): number => cuts.lower(x, y, ground({ x, y }));
    expect(at(105, 108)).toBeCloseTo(7, 6);
    expect(at(105, 112)).toBeCloseTo(7, 6);
    expect(at(105, 100)).toBeCloseTo(10, 6);
    expect(at(105, 120)).toBeCloseTo(12, 6);
    expect(at(105, 117)).toBeGreaterThan(at(105, 103));
  });

  it('tapers an open run that ends on a slope, and digs a work end to full depth', () => {
    const cuts = new UrbanGroundCuts([circuit(straight(0, 400, 100, 110, 10, 7, ['slope', 'work']))]);
    expect(cuts.lower(1, 105, 10)).toBeGreaterThan(9.9);
    expect(cuts.lower(30, 105, 10)).toBeCloseTo(7, 6);
    expect(cuts.lower(399, 105, 10)).toBeCloseTo(7, 6);
  });

  it('fills the ditch across a causeway and digs it on under a bridge', () => {
    const across = (x: number, kind: string): MoatCrossing => ({ run: 0, path: [{ x, y: 90 }, { x, y: 113 }], half_width_m: 3, kind }),
      cuts = new UrbanGroundCuts([circuit(straight(0, 400, 100, 110, 10, 7), 'earth', [across(200, 'causeway'), across(300, 'bridge')])]);
    expect(cuts.lower(200, 105, 10)).toBe(10);
    expect(cuts.lower(202.5, 105, 10)).toBe(10);
    expect(cuts.lower(204, 105, 10)).toBeLessThan(10);
    expect(cuts.lower(206, 105, 10)).toBeCloseTo(7, 6);
    expect(cuts.lower(300, 105, 10)).toBeCloseTo(7, 6);
  });

  it('raises the outer bank of the form beyond the outer lip only', () => {
    // fossa: a bank 3 m wide and 0.9 m high.
    const cuts = new UrbanGroundCuts([circuit(straight(0, 400, 100, 110, 10, 7), 'fossa')]);
    expect(cuts.lower(105, 111.5, 10)).toBeCloseTo(10.9, 6);
    expect(cuts.lower(105, 114, 10)).toBe(10);
    expect(cuts.lower(105, 98.5, 10)).toBe(10);
  });

  it('digs a detached trench around its island and schedules its terrain nodes', () => {
    const square = (r: number) => [
        { x: -r, y: -r },
        { x: r, y: -r },
        { x: r, y: r },
        { x: -r, y: r },
      ],
      shape = { outer: square(20), holes: [square(10)] },
      cuts = new UrbanGroundCuts([{ ditch: [{ kind: 'dry', shape, height_m: 3 }] }]);
    expect(cuts.lower(15, 0, 10)).toBeCloseTo(7);
    expect(cuts.lower(0, 0, 10)).toBe(10);
    expect(cuts.lower(21, 0, 10)).toBe(10);
    expect([...cuts.nodes(5)].flat()).toContainEqual([3, 0]);
  });

  it('digs nothing for a circuit without runs', () => {
    const cuts = new UrbanGroundCuts([{ moat: { form: 'earth', runs: [] } }, {}]);
    expect(cuts.empty).toBe(true);
    expect(cuts.lower(105, 105, 10)).toBe(10);
    expect([...cuts.nodes(2)]).toEqual([]);
  });
});
