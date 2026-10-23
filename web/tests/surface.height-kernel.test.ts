import { describe, expect, it } from 'vitest';
import { sampleTerrainHeight } from '../src/surface/heightSampling';
import { sampleRegistrationBSpline } from '../src/surface/registrationBinding';
import { compileSurfaceWorld, retargetSurfaceWorld, sampleSurface } from '../src/surface/compiler';
import type { TerrainGrid } from '../src/surface/model';
const data = Float32Array.from({ length: 64 }, (_, i) => i % 8 * 3 + Math.floor(i / 8) ** 2 + (i === 27 ? 40 : 0));
const terrain: TerrainGrid = { width: 8, height: 8, originX: 5, originZ: 5, spacingM: 10, heights: data, source: { id: 'kernel', version: '1', nativeSpacingM: 10, sourceLOD: 0 } };
describe('source height reconstruction', () => {
  it('matches the actual registration cubic kernel, including clamped edge controls', () => {
    const t = { ...terrain, reconstruction: 'cubic-bspline-controls' as const };
    for (const x of [-10, 0, 5, 17, 35, 75, 80, 90]) for (const z of [0, 5, 31, 75, 80])
      expect(sampleTerrainHeight(t, x, z)).toBeCloseTo(sampleRegistrationBSpline({ width: 80, n: 8, data }, x, z), 10);
    expect(sampleTerrainHeight(t, 35, 35)).not.toBe(data[27]);
    expect(sampleTerrainHeight(terrain, 35, 35)).toBe(data[27]);
  });
  it('keeps raw controls unchanged and evaluates support height with the declared kernel', () => {
    const world = compileSurfaceWorld({ seed: 1, terrain }), original = data.slice();
    const target = retargetSurfaceWorld(world, { ...terrain, reconstruction: 'cubic-bspline-controls' });
    expect(sampleSurface(target, 35, 35).heightM).toBeCloseTo(sampleRegistrationBSpline({ width: 80, n: 8, data }, 35, 35), 10);
    expect(data).toEqual(original);
    expect(() => compileSurfaceWorld({ seed: 1, terrain: target.terrain })).toThrow(/physical samples/);
  });
});
