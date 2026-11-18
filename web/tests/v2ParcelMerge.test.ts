import { describe, expect, it } from 'vitest';
import { mergedOutline } from '../src/v2/parcelMerge';
import { polygonArea } from '../src/v2/urbanEditOptions';

const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  outer: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
});
describe('parcel merge outline', () => {
  it('unites lots that share a side, or sit a few decimetres apart, into one polygon covering both', () => {
    expect(polygonArea(mergedOutline(rect(0, 0, 10, 20), rect(10, 0, 18, 20))!)).toBeCloseTo(360);
    const gap = mergedOutline(rect(0, 0, 10, 20), rect(10.3, 0, 18, 20))!;
    expect(gap.holes ?? []).toHaveLength(0);
    expect(polygonArea(gap)).toBeGreaterThanOrEqual(10 * 20 + 7.7 * 20 - 1e-6);
    const three = mergedOutline(gap, rect(18, 0, 25, 20))!;
    expect(polygonArea(three)).toBeGreaterThan(polygonArea(gap));
  });
  it('refuses lots that do not touch', () => {
    expect(mergedOutline(rect(0, 0, 10, 20), rect(14, 0, 20, 20))).toBeUndefined();
  });
});
