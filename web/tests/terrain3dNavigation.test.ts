import { describe, expect, it } from 'vitest';
import { groundNavigationScale, walkDisplacement, flightDisplacement, navigationFogDistance, WALK_SPEED, FLIGHT_SPEED } from '../src/ui/terrain3dNavigation';

describe('ground-level camera navigation', () => {
  it('keeps first-person scenery clear at distance, independently from the orbit zoom', () => {
    const fog = (metres: number, distance: number) => Math.min(.62, 1 - Math.exp(-Math.pow(metres / distance, 2) * .11));
    for (const navigation of ['walk', 'fly'] as const) for (const width of [1000, 6000, 40000]) {
      const distance = navigationFogDistance(navigation, 20, width);
      expect(fog(500, distance)).toBeLessThan(.002);
      expect(fog(width, distance)).toBeLessThan(.03);
      expect(navigationFogDistance(navigation, 2000, width)).toBe(distance);
    }
    expect(fog(500, navigationFogDistance('walk', 20, 1000))).toBeLessThan(fog(500, 100) / 100);
    expect(navigationFogDistance('orbit', 20, 1000)).toBe(100);
    expect(navigationFogDistance('orbit', 1200, 1000)).toBe(2400);
    expect(navigationFogDistance(undefined, 1200, 1000)).toBe(2400);
  });
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
    expect(WALK_SPEED).toBe(12);
    const second = walkDisplacement(.5, 1, 1, 1, false);
    const frame = walkDisplacement(.5, 1, 1, 1 / 60, false);
    expect(frame[0] * 60).toBeCloseTo(second[0]);
    expect(frame[1] * 60).toBeCloseTo(second[1]);
    expect(Math.hypot(...walkDisplacement(0, 1, 0, 1, true))).toBe(WALK_SPEED * 3);
    expect(walkDisplacement(0, 0, 0, 1, false)).toEqual([0, -0]);
  });

  it('flies along the view direction and also moves vertically, at a normalized metric speed', () => {
    for (const yaw of [0, .7, Math.PI / 2]) for (const pitch of [-1, 0, 1]) {
      expect(Math.hypot(...flightDisplacement(yaw, pitch, 1, 0, 0, 1, false))).toBeCloseTo(FLIGHT_SPEED);
      expect(Math.hypot(...flightDisplacement(yaw, pitch, 1, 1, 1, 1, false))).toBeCloseTo(FLIGHT_SPEED);
    }
    expect(flightDisplacement(0, 0, 0, 0, 1, 1, false)).toEqual([0, -0, FLIGHT_SPEED]);
    expect(flightDisplacement(0, 0, 0, 0, -1, 1, false)[2]).toBe(-FLIGHT_SPEED);
    expect(flightDisplacement(0, -.5, 1, 0, 0, 1, false)[2]).toBeGreaterThan(0);
    const frame = flightDisplacement(.4, -.5, 1, 1, 1, 1 / 60, false);
    const second = flightDisplacement(.4, -.5, 1, 1, 1, 1, false);
    frame.forEach((value, i) => expect(value * 60).toBeCloseTo(second[i]));
    expect(Math.hypot(...flightDisplacement(0, 0, 1, 0, 0, 1, true))).toBe(FLIGHT_SPEED * 4);
  });
});
