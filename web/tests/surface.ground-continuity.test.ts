import { describe, it, expect } from 'vitest';
import { compileSurfaceWorld } from '../src/surface/compiler';
import { organicSoilFraction, SURFACE_MATERIALS, unpackMaterialMean } from '../src/surface/materials';
import type { SurfaceCompileInput } from '../src/surface/model';

function transect(variable: 'moisture' | 'slope'): SurfaceCompileInput {
  const width = 129,
    height = 3,
    spacingM = 10,
    xHeights = new Float32Array(width);
  for (let x = 1; x < width; x++) xHeights[x] = xHeights[x - 1] + Math.tan(variable === 'slope' ? 0.04 + (0.16 * x) / (width - 1) : 0.1) * spacingM;
  return {
    seed: 42,
    terrain: { width, height, spacingM, originX: 0, originZ: 0, heights: Float32Array.from({ length: width * height }, (_, i) => 100 + xHeights[i % width]), source: { id: 'authored-continuous-transect', version: 'same-source', sourceLOD: 0, nativeSpacingM: spacingM } },
    climate: { version: 'declared-physical-rain', meanAnnualTempC: 14, annualPrecipMm: 2200, elevationCorrected: true, precipitationMm: Float32Array.from({ length: width * height }, (_, i) => (variable === 'moisture' ? 800 + (1600 * (i % width)) / (width - 1) : 2200)) },
  };
}
describe('continuous mineral/humus appearance on the ground layer', () => {
  it('uses an append-only brown ground recipe without changing the old wetland or vegetation palette', () => {
    expect(SURFACE_MATERIALS[9].id).toBe('wetland-organic');
    expect(SURFACE_MATERIALS[9].colorLinear).toEqual([0.075, 0.085, 0.033]);
    expect(SURFACE_MATERIALS[13].id).toBe('vegetation-litter');
    expect(SURFACE_MATERIALS[13].colorLinear).toEqual([0.12, 0.17, 0.045]);
    const humus = SURFACE_MATERIALS[19];
    expect(humus.id).toBe('organic-soil');
    expect(humus.surfaceRole).toBe('ground');
    expect(humus.colorLinear[0]).toBeGreaterThan(humus.colorLinear[1]);
    expect(humus.colorLinear[1]).toBeGreaterThan(humus.colorLinear[2]);
  });
  it('is continuous and bounded in physical fractions/radian slopes, including the old sharp thresholds', () => {
    expect(organicSoilFraction(0.9, 0, 0)).toBe(0);
    expect(organicSoilFraction(0.9, 0.3, 0.2)).toBe(0);
    expect(organicSoilFraction(0.6, 0, 0.2)).toBe(0);
    for (let i = 0; i <= 1000; i++) {
      const m = i / 1000;
      expect(organicSoilFraction(m, 0.1, 0.2)).toBeGreaterThanOrEqual(0);
      expect(organicSoilFraction(m, 0.1, 0.2)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(organicSoilFraction(0.8 - 1e-6, 0.1, 0.2) - organicSoilFraction(0.8 + 1e-6, 0.1, 0.2))).toBeLessThan(2e-5);
    expect(Math.abs(organicSoilFraction(0.9, 0.12 - 1e-6, 0.2) - organicSoilFraction(0.9, 0.12 + 1e-6, 0.2))).toBeLessThan(4e-5);
    expect(() => organicSoilFraction(0.9, 8, 0.2)).toThrow(/radians/);
    expect(() => organicSoilFraction(NaN, 0.1, 0.2)).toThrow();
  });
  it.each(['moisture', 'slope'] as const)('crosses the old %s boundary on an actual compiled transect without a colour jump', variable => {
    const world = compileSurfaceWorld(transect(variable)),
      f = world.fields,
      width = world.terrain.width;
    const observed = variable === 'moisture' ? f.moisture : f.slope,
      threshold = variable === 'moisture' ? 0.8 : 0.12;
    expect(Math.min(...observed)).toBeLessThan(threshold);
    expect(Math.max(...observed)).toBeGreaterThan(threshold);
    let maxJump = 0;
    for (let x = 1; x < width; x++) {
      const a = unpackMaterialMean(f.groundMaterialMeanColor![width + x - 1]),
        b = unpackMaterialMean(f.groundMaterialMeanColor![width + x]);
      for (let c = 0; c < 3; c++) maxJump = Math.max(maxJump, Math.abs(a[c] - b[c]));
    }
    expect(maxJump).toBeLessThan(0.02);
    expect([...f.groundMaterial!, ...f.groundMaterialSecondary!].some(id => world.materials[id].id === 'organic-soil')).toBe(true);
    expect([...f.groundMaterial!, ...f.groundMaterialSecondary!].some(id => world.materials[id].id === 'wetland-organic')).toBe(false);
  });
});
