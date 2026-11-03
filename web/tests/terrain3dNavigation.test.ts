import { describe, expect, it } from 'vitest';
import { groundNavigationScale, walkDisplacement, WALK_SPEED } from '../src/ui/terrain3dNavigation';

describe('ground-level camera navigation', () => {
  it('slows controls near the terrain even when the orbit target is distant', () => {
    expect(groundNavigationScale(1000, 800)).toBe(1);
    expect(groundNavigationScale(1000, 2)).toBeLessThan(.2);
    expect(groundNavigationScale(5, 5)).toBeLessThan(.25);
    expect(groundNavigationScale(1000, .01)).toBeGreaterThan(0);
  });

  it('walks at the same metric speed at every heading and normalizes diagonals', () => {
    for (const yaw of [0, .7, Math.PI / 2, Math.PI]) {
      expect(Math.hypot(...walkDisplacement(yaw, 1, 0, 1, false))).toBeCloseTo(WALK_SPEED);
      expect(Math.hypot(...walkDisplacement(yaw, 1, 1, 1, false))).toBeCloseTo(WALK_SPEED);
    }
    expect(walkDisplacement(0, 1, 0, 1, false)).toEqual([0, -WALK_SPEED]);
    const right = walkDisplacement(0, 0, 1, 1, false);
    expect(right[0]).toBe(WALK_SPEED); expect(right[1]).toBeCloseTo(0);
  });

  it('has frame-rate independent movement and a bounded fast walking speed', () => {
    const second = walkDisplacement(.5, 1, 1, 1, false);
    const frame = walkDisplacement(.5, 1, 1, 1 / 60, false);
    expect(frame[0] * 60).toBeCloseTo(second[0]);
    expect(frame[1] * 60).toBeCloseTo(second[1]);
    expect(Math.hypot(...walkDisplacement(0, 1, 0, 1, true))).toBe(WALK_SPEED * 3);
    expect(walkDisplacement(0, 0, 0, 1, false)).toEqual([0, -0]);
  });
});
