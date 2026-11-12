import { describe, expect, it } from 'vitest';
import { headwaterGeometry, isHeadwater, taperSpringBank, type HeadwaterContext, type HeadwaterLine } from '../src/render/riverHeadwaters';

const line = (xs: number[], area0: number, y = 5000): HeadwaterLine => ({
  points: xs.flatMap(x => [x, y]), area: xs.map((_, i) => area0 * (1 + i)), level: xs.map(() => 10), kind: xs.map(() => 0),
});
const ctx = (rivers: HeadwaterLine[]): HeadwaterContext => ({ rivers, hydro: { width: 10000, n: 100, sea: new Uint8Array(10000) }, lake: new Uint8Array(10000) });

describe('river headwaters', () => {
  it('tapers retained spring caps while preserving downstream banks and cropped inflows', () => {
    const d = 'M1000,1010L1300,1010L2000,1010L2000,990L1300,990L1000,990Z';
    const tapered = taperSpringBank(d, [{ x: 1000, y: 1000 }]);
    expect(tapered.startsWith('M1000.00,1000.00')).toBe(true);
    expect(tapered.endsWith('L1000.00,1000.00Z')).toBe(true);
    expect(tapered).toContain('L2000.00,1010.00L2000.00,990.00');
    expect(taperSpringBank(d, [{ x: 900, y: 1000 }])).toBe(d);
    expect(taperSpringBank(tapered, [{ x: 1000, y: 1000 }])).toBe(tapered);
  });
  it('tapers a source from zero width to the retained width, smoothly', () => {
    const l = line([2000, 2300, 2600, 3200, 4000], 1e6), g = headwaterGeometry(l, [24, 24, 24, 26, 30]);
    expect(g.widths[0]).toBeCloseTo(0, 6);                   // no disc of the full width at the source
    expect(g.reach).toBeCloseTo(900, 6);                      // min(0.6 * length, clamp(40 * 24, 220, 900))
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
