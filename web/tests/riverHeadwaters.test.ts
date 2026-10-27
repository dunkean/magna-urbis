import { describe, expect, it } from 'vitest';
import { headwaterGeometry, isHeadwater, type HeadwaterContext, type HeadwaterLine } from '../src/render/riverHeadwaters';

const line = (xs: number[], area0: number, y = 5000): HeadwaterLine => ({
  points: xs.flatMap(x => [x, y]), area: xs.map((_, i) => area0 * (1 + i)), level: xs.map(() => 10), kind: xs.map(() => 0),
});
const ctx = (rivers: HeadwaterLine[]): HeadwaterContext => ({ rivers, hydro: { width: 10000, n: 100, sea: new Uint8Array(10000) }, lake: new Uint8Array(10000) });

describe('river headwaters (blended)', () => {
  it('tapers a source from 0.6 m to the retained width, smoothly', () => {
    const l = line([2000, 2300, 2600, 3200, 4000], 1e6), g = headwaterGeometry(l, [24, 24, 24, 26, 30]);
    expect(g.widths[0]).toBeCloseTo(0.6, 6);                 // no disc of the full width at the source
    expect(g.reach).toBeCloseTo(240, 6);                      // min(0.6 * length, clamp(10 * 24, 100, 420))
    expect(g.points.length / 2).toBeGreaterThan(5);           // first segments subdivided
    for (let i = 1; i < g.widths.length; i++) expect(g.widths[i]).toBeGreaterThanOrEqual(g.widths[i - 1] - 1e-9);
    expect(g.widths[g.widths.length - 1]).toBeCloseTo(30, 6); // downstream width untouched
    expect(g.kind.length).toBe(g.widths.length);
  });
  it('keeps genuine headwaters only', () => {
    const own = line([2000, 3000], 1e6), threshold = 1e6;
    expect(isHeadwater(own, ctx([own]), threshold)).toBe(true);
    expect(isHeadwater(line([100, 900], 1e6), ctx([]), threshold)).toBe(false);          // map-edge inflow
    expect(isHeadwater(line([2000, 3000], 3e6), ctx([]), threshold)).toBe(false);        // area > 2x threshold
    const trunk = line([1500, 2000, 2500], 1e6, 5000);
    expect(isHeadwater(line([2000, 3000], 1e6, 5020), ctx([trunk]), threshold)).toBe(false); // starts on another line
  });
});
