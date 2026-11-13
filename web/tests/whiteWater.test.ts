import { expect, it } from 'vitest';
import { buildWhiteWater, FALL, MOUTH_CALM, type WhiteWaterCourse } from '../src/render/whiteWater';

/** A straight 2 km course along x, a vertex every 20 m, 12 m wide, with the given level profile. */
function course(level: (s: number) => number, mouth = false, id = 7): WhiteWaterCourse {
  const points: number[] = [], levels: number[] = [], width: number[] = [];
  for (let s = 0; s <= 2000; s += 20) { points.push(s, 500); levels.push(level(s)); width.push(12); }
  return { id, points, level: levels, width, mouth };
}
const kinds = (m: ReturnType<typeof buildWhiteWater>, kind: number): number => m.kind.filter(k => k === kind).length;

it('draws no white water on a flat course', () => {
  const m = buildWhiteWater([course(() => 100)]);
  expect(m.count).toBe(0);
});

it('draws streaks on a steep course, deterministically, and no fall without a knickpoint', () => {
  const steep = course(s => 300 - .05 * s), m = buildWhiteWater([steep]);
  expect(m.count).toBeGreaterThan(100);
  expect(m.falls).toBe(0);
  expect(kinds(m, FALL)).toBe(0);
  expect(buildWhiteWater([steep]).xy).toEqual(m.xy);
});

it('draws a waterfall at a knickpoint', () => {
  // A gentle reach with 10 m lost over 10 m of channel at 1000 m.
  const m = buildWhiteWater([course(s => 200 - .003 * s - 10 * Math.max(0, Math.min(1, (s - 1000) / 10)))]);
  expect(m.falls).toBe(1);
  expect(kinds(m, FALL)).toBeGreaterThan(5);
});

it('keeps calm water over the last 250 m before a sea mouth', () => {
  const m = buildWhiteWater([course(s => 300 - .05 * s, true)]);
  expect(m.count).toBeGreaterThan(0);
  let last = 0;
  for (let i = 0; i < m.count; i++) for (let p = m.start[i]; p < m.start[i] + m.points[i]; p++) last = Math.max(last, m.xy[2 * p]);
  expect(last).toBeLessThan(2000 - MOUTH_CALM + 10);
});
