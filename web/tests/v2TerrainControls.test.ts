import { describe, expect, it } from 'vitest';
import { allTerrainFields, coastDirections, terrainControlMessages, toggleCoastDirection } from '../src/v2/terrainControlSchema';
import { readSettingPath, writeSettingPath } from '../src/v2/parameterForm';
import { effectiveTerrainSettings, migrateTerrainClimate, defaultTerrainSettings, DEFAULT_HYDROLOGY, DEFAULT_NEURAL_TUNING, validateTerrainSettings } from '../src/v2/terrainSettings';
import { DEFAULT_FRACTAL_DETAIL } from '../../rust/bridge/terrainAdjust';

describe('V2 climate zones', () => {
  const settings = (biome: string, terrain: object = {}) => ({ options: { seed: 's', biome, coast: 'none', river: 'none', relief: 'hills' }, terrain } as never);
  it('derives the zone from the biome, honours an explicit zone and migrates legacy names', () => {
    expect(effectiveTerrainSettings(settings('desert'), 5000).climateZone).toBe('desert');
    const wet = effectiveTerrainSettings(settings('forest', { climate: 'wetland' }), 5000);
    expect(wet.climateZone).toBe('wetland'); expect(wet.climate).toBe('oceanic'); expect(wet.climateValues!.precipitation).toBe(750);
    const legacy = { climate: 'arid' }; migrateTerrainClimate(legacy); expect(legacy.climate).toBe('desert');
    expect(() => validateTerrainSettings({ climate: 'cold', islandMode: 'peninsula' })).not.toThrow();
    expect(() => validateTerrainSettings({ climate: 'moist' })).toThrow();
  });
});
describe('V2 Terrainbench control parity', () => {
  const paths = new Set(allTerrainFields.map(field => field.path));
  it('exposes every hydrology, neural tuning and fractal core setting as an editable field', () => {
    for (const key of Object.keys(DEFAULT_HYDROLOGY)) expect(paths.has(`terrain.hydrology.${key}`), key).toBe(true);
    for (const key of Object.keys(DEFAULT_NEURAL_TUNING)) {
      if (key === 'histogram') for (let i = 0; i < 5; i++) expect(paths.has(`terrain.neuralTuning.histogram.${i}`)).toBe(true);
      else expect(paths.has(`terrain.neuralTuning.${key}`), key).toBe(true);
    }
    for (const key of Object.keys(DEFAULT_FRACTAL_DETAIL)) expect(paths.has(`terrain.detailNoise.${key}`), key).toBe(true);
    expect(allTerrainFields.filter(field => field.path.startsWith('terrain.erosionTuning.'))).toHaveLength(17);
    expect(paths.size).toBe(allTerrainFields.length);
  });
  it('accepts the complete numeric range exposed by the form without silently clamping recipes', () => {
    for (const field of allTerrainFields) {
      if (field.type !== 'number' || !field.path.startsWith('terrain.')) continue;
      for (const bound of [field.min, field.max]) {
        if (bound === undefined) continue;
        const settings = { terrain: defaultTerrainSettings() };
        writeSettingPath(settings, field.path, field.fromInput ? field.fromInput(bound) : bound);
        expect(() => validateTerrainSettings(settings.terrain), `${field.path} = ${bound}`).not.toThrow();
      }
    }
  });
  it('keeps all eight coastline directions independent, including diagonals', () => {
    let mask = 0;
    for (const direction of coastDirections) mask = toggleCoastDirection(mask, direction);
    expect(mask).toBe(255);
    mask = toggleCoastDirection(mask, 'NE'); expect(mask).toBe(253);
    mask = toggleCoastDirection(mask, 'SW'); expect(mask).toBe(221);
    expect(toggleCoastDirection(0, 'S')).toBe(16);
  });
  it('writes nested histogram arrays and removes optional overrides for inherited defaults', () => {
    const recipe = {};
    writeSettingPath(recipe, 'terrain.neuralTuning.histogram.0', 1);
    writeSettingPath(recipe, 'terrain.neuralTuning.histogram.1', 1.5);
    expect(readSettingPath(recipe, 'terrain.neuralTuning.histogram')).toEqual([1, 1.5]);
    writeSettingPath(recipe, 'terrain.erosionTuning.surfaceIterations', 0);
    expect(readSettingPath(recipe, 'terrain.erosionTuning.surfaceIterations')).toBe(0);
    writeSettingPath(recipe, 'terrain.erosionTuning.surfaceIterations', undefined);
    expect(readSettingPath(recipe, 'terrain.erosionTuning.surfaceIterations')).toBeUndefined();
    writeSettingPath(recipe, 'same.same.same', false);
    expect(readSettingPath(recipe, 'same.same.same')).toBe(false);
  });
  it('converts visible lake and forest percentages back to the core’s fractions', () => {
    const field = allTerrainFields.find(field => field.path === 'terrain.hydrology.lakeCoverage')!;
    expect(field.toInput?.(.05)).toBe(5); expect(field.fromInput?.(5)).toBe(.05);
    const forest = allTerrainFields.find(field => field.path === 'terrain.forest.clearings')!;
    expect(forest.toInput?.(.45)).toBe(45); expect(forest.fromInput?.(45)).toBe(.45);
  });
  it('provides French copy for every visible label, option and explanation', () => {
    for (const field of allTerrainFields) for (const text of [field.label, field.help, ...(field.options?.map(option => option.label) ?? [])]) {
      if (text) expect(terrainControlMessages[text]?.fr, text).toBeTruthy();
    }
  });
});
