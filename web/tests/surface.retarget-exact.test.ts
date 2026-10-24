import { describe, expect, it } from 'vitest';
import { compileSurfaceWorld, sampleSurface } from '../src/surface/compiler';
import { dominantMaterialPair, unpackMaterialMean } from '../src/surface/materials';
import { surfaceLayerInput } from './fixtures/surfaceLayerInput';

describe('bit-exact material sampling reduction', () => {
  it('decodes every stored sRGB8 value exactly as the scalar transfer function', () => {
    for (let byte = 0; byte < 256; byte++) {
      const s = byte / 255, expected = s <= .04045 ? s / 12.92 : Math.pow((s + .055) / 1.055, 2.4);
      for (const decoded of unpackMaterialMean(byte | byte << 8 | byte << 16)) expect(Object.is(decoded, expected)).toBe(true);
    }
    expect(unpackMaterialMean(-1)).toEqual([1, 1, 1]);
    expect(unpackMaterialMean(NaN)).toEqual([0, 0, 0]);
  });

  it('matches the unchanged generic reducer at contacts, ties, duplicate ids and opacity boundaries', () => {
    const input = surfaceLayerInput();
    input.terrain = { ...input.terrain, width: 2, height: 2, heights: new Float32Array(4).fill(100) };
    delete input.geology; delete input.hydrology; delete input.occupation;
    const world = compileSurfaceWorld(input), f = world.fields;
    let seed = 391;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let scenario = 0; scenario < 400; scenario++) {
      const fx = scenario % 4 === 0 ? 0 : scenario % 4 === 1 ? .5 : random(), fz = scenario % 7 === 0 ? 1 : random();
      const weights = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
      for (let i = 0; i < 4; i++) {
        const primary = Math.floor(random() * 5), secondary = scenario % 3 === 0 ? primary : Math.floor(random() * 5);
        const blend = scenario % 2 ? random() : .5;
        const mean = Math.floor(random() * 0x1000000);
        f.material[i] = f.groundMaterial![i] = f.lowCoverMaterial![i] = primary;
        f.materialSecondary[i] = f.groundMaterialSecondary![i] = f.lowCoverMaterialSecondary![i] = secondary;
        f.materialBlend[i] = f.groundMaterialBlend![i] = f.lowCoverMaterialBlend![i] = blend;
        f.materialMeanColor[i] = f.groundMaterialMeanColor![i] = f.lowCoverMaterialMeanColor![i] = mean;
        f.lowCoverOpacity![i] = scenario % 5 === 0 ? 0 : i % 2 ? 1 : random();
      }
      const sample = sampleSurface(world, fx * 32, fz * 32);
      for (const layer of ['legacy', 'ground', 'lowCover'] as const) {
        const coverage = layer === 'lowCover' ? weights.map((w, i) => w * f.lowCoverOpacity![i]) : weights;
        const sum = coverage.reduce((s, w) => s + w, 0), entries: Array<[number, number]> = [], mean = [0, 0, 0];
        for (let i = 0; i < 4; i++) {
          const w = layer === 'lowCover' ? coverage[i] / sum : weights[i];
          entries.push([f.material[i], w * (1 - f.materialBlend[i])], [f.materialSecondary[i], w * f.materialBlend[i]]);
          const color = unpackMaterialMean(f.materialMeanColor[i]);
          for (let channel = 0; channel < 3; channel++) mean[channel] += color[channel] * w;
        }
        const expected = layer === 'lowCover' && sum === 0 ? { primary: f.material[0], secondary: f.material[0], blend: 0 } : dominantMaterialPair(entries);
        const actual = layer === 'legacy' ? { material: sample.material, materialSecondary: sample.materialSecondary, materialBlend: sample.materialBlend, meanColorLinear: sample.materialMeanColorLinear } : layer === 'ground' ? sample.surfaceLayers.ground! : sample.surfaceLayers.lowCover!;
        expect(actual.material).toBe(world.materials[expected.primary]);
        expect(actual.materialSecondary).toBe(world.materials[expected.secondary]);
        expect(Object.is(actual.materialBlend, expected.blend)).toBe(true);
        expect(actual.meanColorLinear).toEqual(layer === 'lowCover' && sum === 0 ? [0, 0, 0] : mean);
      }
    }
  });
});
