import { describe, expect, it } from 'vitest';
import { riverInstances, RIVER_INSTANCE_FLOATS } from '../src/ui/terrain/riverProfiles';
import { riverSegmentsInBox } from '../src/render/riverCapsules';

const segment = (x0: number, y0: number, x1: number, y1: number, width: number): number[] => [x0, y0, x1, y1, width, width, 1, 2, 3];

describe('riverSegmentsInBox', () => {
  it('keeps only the capsules that touch the town box, whole', () => {
    const rivers = new Float32Array([
      ...segment(0, 0, 100, 0, 20), // crosses the box
      ...segment(5000, 5000, 5100, 5000, 20), // far away
      ...segment(-30, 50, -15, 50, 40), // outside by its axis, inside by its half width (20 m)
      ...segment(-60, 50, -45, 50, 20), // outside even with its half width
    ]);
    const kept = riverSegmentsInBox(rivers, { minX: 0, minY: -10, maxX: 200, maxY: 100 });
    expect(kept.length).toBe(18);
    expect([...kept.subarray(0, 9)]).toEqual(segment(0, 0, 100, 0, 20));
    expect([...kept.subarray(9, 18)]).toEqual(segment(-30, 50, -15, 50, 40));
  });

  it('scales with the river network, not the clip: a 200k segment map culls in a few ms', () => {
    const n = 200_000,
      rivers = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) rivers.set(segment(i * 10, 0, i * 10 + 10, 0, 8), i * 9);
    const kept = riverSegmentsInBox(rivers, { minX: 1000, minY: -50, maxX: 2000, maxY: 50 });
    expect(kept.length / 9).toBeLessThan(110);
  });
});

it('puts the shallow side inside the turn, matches both ends at joins and restarts at a disconnected reach', () => {
  const course = (y: number, running = 1): Float32Array => new Float32Array([0, 0, 20, 0, 12, 12, running, 1, 0, 20, 0, 40, y, 12, 12, running, 1, 0, 150, 30, 160, 30, 12, 12, running, 1, 0]);
  const left = riverInstances(course(9), true), right = riverInstances(course(-9), true);
  const stride = RIVER_INSTANCE_FLOATS;
  const bed = riverInstances(course(9, 0), true);
  expect(bed[10]).toBe(left[10]);
  expect(bed[stride + 11]).toBe(20);
  expect(left[10]).toBeGreaterThan(0);
  expect(right[10]).toBe(-left[10]);
  expect(left[stride + 9]).toBe(left[10]);
  expect(left[stride + 11]).toBe(20);
  expect([...left.slice(2 * stride + 9)]).toEqual([0, 0, 0]);
  expect([...left.slice(0, 9)]).toEqual([...course(9).slice(0, 9)]);
});
