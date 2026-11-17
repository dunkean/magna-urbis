import { describe, expect, it } from 'vitest';
import { filledSymbolicZones, paintZones, resampleZones, sampleZone } from '../../src/v2/symbolicMap';
import { symbolicMapMessages } from '../../src/v2/symbolicMapMessages';
import { translate } from '../../src/v2/i18n';
import { parseTerrainZones } from '../../../rust/bridge/terrainZones';
import { defaultSettings } from '../../src/v2/settings';
import { effectiveTerrainSettings } from '../../src/v2/terrainSettings';
import { terrainCacheKey } from '../../src/v2/engine';
import { terrainStageValidityKeys } from '../../src/v2/stageValidity';
import { cultureEnvironment } from '../../src/v2/environmentCultures';

describe('symbolic zone painting', () => {
  it('translates the symbolic controls in the additional interface languages',()=>{for(const row of symbolicMapMessages)for(const lang of ['es','pt','zh','ar','ru','ja'] as const)expect(translate(row[0],lang)).not.toBe(row[0]);});
  it('fully replaces the brush core and erases back to plain', () => {
    const weights = resampleZones();
    paintZones(weights, .5, .5, .2, .6, 1, 3);
    const cell = (64 * 128 + 64) * 5;
    expect(Array.from(weights.slice(cell, cell + 5))).toEqual([0, 0, 0, 255, 0]);
    paintZones(weights, .5, .5, .2, .6, 1, 0);
    expect(Array.from(weights.slice(cell, cell + 5))).toEqual([255, 0, 0, 0, 0]);
    paintZones(weights, .5, .5, .2, .6, 1, -1);
    expect(Array.from(weights.slice(cell, cell + 5))).toEqual([0, 0, 0, 0, 0]);
  });
  it('uses the probe carrier with an explicit plain partition without changing the recipe', () => {
    const settings = defaultSettings();
    settings.terrain = { relief: 'volcano', environment: 'mountains', mountainMix: .9,
      zones: { version: 1, resolution: 8, weights: Array(8 * 8 * 5).fill(0) } };
    const keys = terrainStageValidityKeys(settings), cache = terrainCacheKey(settings);
    const raw = settings.terrain.zones!, effective = effectiveTerrainSettings(settings, 6000);
    expect(effective).toMatchObject({ relief: 'hills', environment: 'flat', mountainMix: 0 });
    expect(effective.zones!.weights.every((w, i) => w === (i % 5 === 1 ? 255 : 0))).toBe(true);
    expect(raw.weights.every(w => w === 0)).toBe(true);
    expect(cultureEnvironment(settings).relief).toBe('flat');
    settings.terrain.relief = 'mountains';
    expect(terrainStageValidityKeys(settings)).toEqual(keys);
    expect(terrainCacheKey(settings)).toBe(cache);
    settings.terrain.zones!.weights[3] = 255;
    expect(effectiveTerrainSettings(settings, 6000).relief).toBe('hills');
    expect(effectiveTerrainSettings(settings, 6000).zones!.weights.slice(0, 5)).toEqual([0, 0, 0, 255, 0]);
    expect(settings.terrain.zones).toBe(raw);
    expect(settings.terrain.relief).toBe('mountains');
    delete settings.terrain.zones;
    expect(effectiveTerrainSettings(settings, 6000)).toMatchObject({ relief: 'mountains', environment: 'mountains', mountainMix: .9 });
  });
  it('fills only the unpainted share, retaining sea, soft mountains and existing plain', () => {
    const zones = { version: 1 as const, resolution: 8, weights: Array(8 * 8 * 5).fill(0) };
    zones.weights.splice(0, 15, 30, 20, 40, 70, 10, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255);
    const before = [...zones.weights], filled = filledSymbolicZones(zones);
    expect(filled.weights.slice(0, 15)).toEqual([30, 105, 40, 70, 10, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255]);
    expect(filled.weights.slice(15, 20)).toEqual([0, 255, 0, 0, 0]);
    expect(zones.weights).toEqual(before);
    expect(() => parseTerrainZones(filled)).not.toThrow();
    expect(filledSymbolicZones(filled)).toEqual(filled);
    // Filling before interpolation keeps the entire partition painted, including borders.
    const total = Array.from({ length: 5 }, (_, k) => sampleZone(filled, .125, .125, k)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(255);
  });
  it('blends soft edges and strength while preserving valid five-channel weights', () => {
    const weights = resampleZones();
    for (let k = 0; k < 5; k++) paintZones(weights, .5, .5, .3, .8, .4, k);
    const cell = (64 * 128 + 64) * 5;
    expect(weights[cell]).toBeGreaterThan(0);expect(weights[cell + 4]).toBeGreaterThan(weights[cell]);
    expect(weights[(64 * 128 + 98) * 5 + 4]).toBeLessThan(weights[cell + 4]);
    expect(() => parseTerrainZones({ version: 1, resolution: 128, weights: Array.from(weights) })).not.toThrow();
    expect(weights[0]).toBe(0);
  });
  it('resamples cell-centred maps without inventing excess weight or mutating the input', () => {
    const zones = { version: 1 as const, resolution: 8, weights: Array.from({ length: 8 * 8 * 5 }, (_, i) => i % 5 === 1 ? 255 : 0) };
    expect(sampleZone(zones, 0, 0, 1)).toBe(255);
    const weights = resampleZones(zones);
    expect(weights.length).toBe(128 * 128 * 5);
    expect(weights.every((w, i) => w === (i % 5 === 1 ? 255 : 0))).toBe(true);
    weights[1] = 0;expect(zones.weights[1]).toBe(255);
    const copy = resampleZones({ ...zones, resolution: 128, weights: Array.from(resampleZones(zones)) });
    copy[1] = 0;expect(zones.weights[1]).toBe(255);
  });
});
