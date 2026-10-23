import { describe, expect, it } from 'vitest';
import { compileSurfaceWorld, deserializeSurfaceWorld, retargetSurfaceWorld, sampleSurface, serializeSurfaceWorld } from '../src/surface/compiler';
import { dominantMaterialPair, packMaterialMean, SURFACE_MATERIALS, unpackMaterialMean } from '../src/surface/materials';
import type { SurfaceSample, TerrainGrid } from '../src/surface/model';

function terrain(width = 17, height = 17, spacingM = 20): TerrainGrid {
  return { width, height, originX: 0, originZ: 0, spacingM,
    heights: Float32Array.from({ length: width * height }, (_, i) => 60 + Math.sin(i % width / 3) * 25 + Math.floor(i / width) * 2),
    source: { id: 'test-source', version: 'same-generation', sourceLOD: 2, nativeSpacingM: spacingM } };
}
function world() { return compileSurfaceWorld({ seed: 91, terrain: terrain(), climate: { version: 'wet', meanAnnualTempC: 12, annualPrecipMm: 1500, elevationCorrected: true } }); }
function color(s: SurfaceSample): number[] { return s.material.colorLinear.map((v, c) => v * (1 - s.materialBlend) + s.materialSecondary.colorLinear[c] * s.materialBlend); }

describe('compact material composition', () => {
  it('stores exactly two material ids and normalized blend, with a compact independent mean', () => {
    const w = world(), n = w.terrain.heights.length;
    expect(w.fields.materialSecondary).toBeInstanceOf(Uint16Array);
    expect(w.fields.materialBlend).toBeInstanceOf(Float32Array);
    expect(w.fields.materialMeanColor).toBeInstanceOf(Uint32Array);
    expect(w.fields.materialSecondary.byteLength + w.fields.materialBlend.byteLength + w.fields.materialMeanColor.byteLength).toBe(n * 10);
    expect(Array.from(w.fields.materialBlend).some(v => v > .1)).toBe(true);
    const ids = new Set([...w.fields.material, ...w.fields.materialSecondary]);
    expect(ids.has(18)).toBe(true);
    for (let i = 0; i < n; i++) {
      expect(w.fields.materialBlend[i]).toBeGreaterThanOrEqual(0);
      expect(w.fields.materialBlend[i]).toBeLessThanOrEqual(.5);
      expect(w.fields.material[i]).toBeLessThan(w.materials.length);
      expect(w.fields.materialSecondary[i]).toBeLessThan(w.materials.length);
      expect(w.fields.sand[i] + w.fields.silt[i] + w.fields.clay[i]).toBeCloseTo(1, 6);
    }
  });

  it('crosses a categorical frontier continuously and conserves its linear mean under reduction', () => {
    const w = compileSurfaceWorld({ seed: 1, terrain: terrain(3, 3, 20) });
    for (let i = 0; i < 9; i++) {
      const id = i % 3 === 0 ? 0 : 13;
      w.fields.material[i] = w.fields.materialSecondary[i] = id;
      w.fields.materialBlend[i] = 0;
      w.fields.materialMeanColor[i] = packMaterialMean(w.materials[id].colorLinear);
    }
    const left = color(sampleSurface(w, 10 - .0001, 20)), right = color(sampleSurface(w, 10 + .0001, 20));
    for (let c = 0; c < 3; c++) expect(Math.abs(left[c] - right[c])).toBeLessThan(.00001);
    const average = [0, 0, 0];
    for (let k = 0; k < 100; k++) {
      const sample = sampleSurface(w, (k + .5) / 100 * 20, 20);
      const actual = color(sample), expected = w.materials[0].colorLinear.map((v, c) => v * (1 - (k + .5) / 100) + w.materials[13].colorLinear[c] * (k + .5) / 100);
      for (let c = 0; c < 3; c++) { expect(actual[c]).toBeCloseTo(expected[c], 7); average[c] += sample.materialMeanColorLinear[c] / 100; }
    }
    const endpoint0 = unpackMaterialMean(w.fields.materialMeanColor[0]), endpoint1 = unpackMaterialMean(w.fields.materialMeanColor[1]);
    for (let c = 0; c < 3; c++) expect(average[c]).toBeCloseTo((endpoint0[c] + endpoint1[c]) / 2, 7);
  });

  it('keeps palette and mean exact at fixed coordinates across refinements, with bounded projected mean error at three-material junctions', () => {
    const w = world();
    for (let i = 0; i < w.terrain.heights.length; i++) {
      const id = [0, 13, 18][i % 3];
      w.fields.material[i] = w.fields.materialSecondary[i] = id; w.fields.materialBlend[i] = 0;
      w.fields.materialMeanColor[i] = packMaterialMean(w.materials[id].colorLinear);
    }
    const fine = retargetSurfaceWorld(w, terrain(65, 65, 5));
    for (const [x, z] of [[9.999, 12.3], [10.001, 12.3], [23.45, 34.56], [111.2, 207.8]]) {
      const a = sampleSurface(w, x, z), b = sampleSurface(fine, x, z);
      expect(b.material.id).toBe(a.material.id); expect(b.materialSecondary.id).toBe(a.materialSecondary.id);
      expect(b.materialBlend).toBe(a.materialBlend); expect(b.materialMeanColorLinear).toEqual(a.materialMeanColorLinear);
    }
    for (let i = 0; i < fine.terrain.heights.length; i += 7) {
      const expected = sampleSurface(w, i % 65 * 5, Math.floor(i / 65) * 5).materialMeanColorLinear;
      const projected = unpackMaterialMean(fine.fields.materialMeanColor[i]);
      for (let c = 0; c < 3; c++) expect(Math.abs(expected[c] - projected[c])).toBeLessThan(.0045);
    }
  });

  it('keeps seasonal snow as an overlay without replacing ground pairs or organic fractions', () => {
    const t = terrain(), climate = { version: 'c', meanAnnualTempC: 9, annualPrecipMm: 1000 };
    const summer = compileSurfaceWorld({ seed: 1, terrain: t, climate, state: { version: 'summer', dayOfYear: 200 } });
    const winter = compileSurfaceWorld({ seed: 1, terrain: t, climate, state: { version: 'winter', dayOfYear: 10, snowWaterEquivalentM: .5 } });
    expect(winter.fields.material).toEqual(summer.fields.material);
    expect(winter.fields.materialSecondary).toEqual(summer.fields.materialSecondary);
    expect(winter.fields.materialBlend).toEqual(summer.fields.materialBlend);
    expect(winter.fields.materialMeanColor).toEqual(summer.fields.materialMeanColor);
    expect(winter.fields.organic).toEqual(summer.fields.organic);
    expect(winter.fields.snow.some(v => v > .5)).toBe(true);
    expect(winter.fields.material.includes(14)).toBe(false);
  });

  it('validates new packets and reads legacy single-material packets with an explicit zero secondary fraction', () => {
    const w = world(), raw = JSON.parse(serializeSurfaceWorld(w));
    const restored = deserializeSurfaceWorld(JSON.stringify(raw));
    expect(restored.fields.materialSecondary).toEqual(w.fields.materialSecondary);
    expect(restored.fields.materialBlend).toEqual(w.fields.materialBlend);
    expect(restored.fields.materialMeanColor).toEqual(w.fields.materialMeanColor);
    raw.fields.materialBlend[3] = 1.1;
    expect(() => deserializeSurfaceWorld(JSON.stringify(raw))).toThrow(/composition/);
    delete raw.fields.materialSecondary; delete raw.fields.materialBlend; delete raw.fields.materialMeanColor;
    const legacy = deserializeSurfaceWorld(JSON.stringify(raw));
    expect(legacy.fields.materialSecondary).toEqual(legacy.fields.material);
    expect(legacy.fields.materialBlend.every(v => v === 0)).toBe(true);
    expect(dominantMaterialPair([[4, .2], [1, .6], [4, .2]])).toEqual({ primary: 1, secondary: 4, blend: .4 });
    expect(SURFACE_MATERIALS[18].id).toBe('forest-litter');
  });
});
