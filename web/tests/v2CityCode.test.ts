import { describe, expect, it } from 'vitest';
import { encodeCityCode, decodeCityCode, cityCodeUrl } from '../src/v2/cityCode';
import { encodeCompact } from '../src/ui/recipeCodec';
import { defaultSettings, adaptedExtent } from '../src/v2/settings';
import { effectiveTerrainSettings, defaultTerrainSettings } from '../src/v2/terrainSettings';
import { effectiveRegion, regionSpec } from '../src/v2/regionSettings';
import { urbanEffectiveValues } from '../src/v2/urbanControls';
import { urbanSeed, rerollUrbanSeeds } from '../src/v2/urbanSeeds';
import { rerollSeed, seedRoot, stepSeed } from '../../rust/bridge/generationSeed';
import defaults from '../src/v2/cityCodeDefaults.json';
import type { V2Settings } from '../src/v2/contracts';

const terrain = (s: V2Settings) => effectiveTerrainSettings(s, adaptedExtent(s));
const restored = (s: V2Settings) => decodeCityCode(encodeCityCode(s)).settings;
const base = () => { const s = defaultSettings(); s.options.seed = '42'; return s; };

describe('V2 compact generation codes', () => {
  it('encodes the five essential choices in fewer than 25 characters', () => {
    const settings = base(), code = encodeCityCode(settings);
    expect(code).toMatch(/^MU3\.[\w-]+$/); expect(code.length).toBeLessThan(25);
    expect(decodeCityCode(code)).toEqual({ settings, mods: [] });
    const chosen = base(); chosen.options.biome = 'tundra'; chosen.options.culture = 'japanese-jokamachi';
    chosen.terrain!.relief = 'high-mountains'; chosen.extent = 12000;
    const decoded = restored(chosen);
    expect(encodeCityCode(chosen).length).toBeLessThan(32);
    expect(decoded).toEqual(chosen);
    expect(terrain(decoded)).toEqual(terrain(chosen));
    expect(effectiveRegion(decoded)).toEqual(effectiveRegion(chosen));
    expect(urbanEffectiveValues(decoded)).toEqual(urbanEffectiveValues(chosen));
  });
  it.each(['042', '-0', 'a seed with spaces', 'café 🗺️', 'MU3.literal'])('preserves the literal seed %s', seed => {
    const settings = base(); settings.options.seed = seed;
    expect(restored(settings).options.seed).toBe(seed);
  });
  it('stores advanced changes and local edits while keeping the input untouched', () => {
    const settings = base(); settings.options.population = 17300; settings.options.walls = 'none';
    settings.terrain!.hydrology = { engine: 'vector', density: 0, enabled: false, balance: false };
    settings.terrain!.erosion = 0;
    settings.region = { roads: null, placement: { mode: 'list', list: [{ ...regionSpec('east', 400), position: { x: 102.123456789, y: 205.54321 } }] } };
    settings.local.east = { culture: 'dwarven', population: 150 };
    settings.urban = { layout: { density: 1.25 }, local: { east: { parcels: { density: 0 } } } };
    settings.naming = { title: 'Vallée des rêves', places: { east: 'Le gué' } };
    const before = structuredClone(settings), mods = [{ settlement: 'main', target: 'house/1', patch: { height: 7.25, deleted: false } }];
    const code = encodeCityCode(settings, mods), decoded = decodeCityCode(code);
    expect(code.length).toBeGreaterThan(encodeCityCode(base()).length);
    expect(decoded).toEqual({ settings, mods });
    expect(settings).toEqual(before);
  });
  it('omits materialised terrain, region and cultural defaults instead of serialising every control', () => {
    const settings = base(); settings.options.culture = 'roman-core';
    const short = encodeCityCode(settings);
    settings.terrain = { ...defaultTerrainSettings(), ...settings.terrain, hydrology: { ...terrain(settings).hydrology } };
    settings.region = effectiveRegion(settings);
    settings.urban = urbanEffectiveValues(settings);
    expect(encodeCityCode(settings)).toBe(short);
    const decoded = restored(settings);
    expect(terrain(decoded)).toEqual(terrain(settings));
    expect(effectiveRegion(decoded)).toEqual(effectiveRegion(settings));
    expect(urbanEffectiveValues(decoded)).toEqual(urbanEffectiveValues(settings));
  });
  it('keeps selected morphology presets and compares their parameters with the selected culture', () => {
    const settings = base(); settings.urban = { layout: { culture: 'roman-core' } };
    const short = encodeCityCode(settings), values = urbanEffectiveValues(settings);
    settings.urban.layout = values.layout as NonNullable<V2Settings['urban']>['layout'];
    const decoded = restored(settings);
    expect(encodeCityCode(settings)).toBe(short);
    expect(urbanEffectiveValues(decoded)).toEqual(values);
    expect(decoded.urban!.layout!.culture).toBe('roman-core');
  });
  it('keeps climate and procedural preset selections while omitting their inherited controls', () => {
    const settings = base(); settings.terrain!.climate = 'mediterranean';
    settings.terrain!.procedural = { preset: 'compact', biome: true };
    settings.terrain!.climateValues = { ...terrain(settings).climateValues };
    settings.terrain!.phasor = { quality: 'balanced', intensity: 1 };
    const decoded = restored(settings);
    expect(decoded.terrain!.climate).toBe('mediterranean'); expect(decoded.terrain!.procedural!.preset).toBe('compact');
    expect(decoded.terrain).not.toHaveProperty('climateValues'); expect(decoded.terrain).not.toHaveProperty('phasor');
    expect(terrain(decoded)).toEqual(terrain(settings));
  });
  it('keeps inherited defaults distinct from omitted historical settings and supports automatic extents', () => {
    const settings = base(); delete settings.terrain; settings.extent = 'auto'; delete settings.options.biome;
    const decoded = restored(settings);
    expect(decoded).toEqual(settings); expect(terrain(decoded)).toEqual(terrain(settings));
    expect(terrain(decoded).hydrology!.engine).toBe('rust');
    const withUndefined = base(); withUndefined.options.center = undefined;
    expect(encodeCityCode(withUndefined)).toBe(encodeCityCode(base()));
  });
  it('carries independent rerolls as compact differences rather than a base64 seed inside a base64 recipe', () => {
    const settings = base(); settings.options.seed = rerollSeed(settings.options.seed, ['relief-noise', 'water-rivers']);
    rerollUrbanSeeds(settings, ['east'], 'houses');
    settings.urban = { seed: 'legacy-city-draw' };
    const decoded = restored(settings);
    expect(seedRoot(decoded.options.seed)).toBe('42');
    expect(stepSeed(decoded.options.seed, 'relief-noise')).toBe(stepSeed(settings.options.seed, 'relief-noise'));
    expect(urbanSeed(decoded, 'east', 'houses')).toBe(urbanSeed(settings, 'east', 'houses'));
    expect(urbanSeed(decoded, 'west', 'streets')).toBe('legacy-city-draw');
    expect(encodeCityCode(decoded)).toBe(encodeCityCode(settings));
  });
  it('uses the same code for native and browser Rust, without carrying machine endpoints', () => {
    const settings = base(); settings.runtime!.backend = 'native'; settings.runtime!.localServer = 'http://127.0.0.1:8791';
    settings.runtime!.pythonServer = 'http://127.0.0.1:8793'; settings.urban = { backend: 'native' };
    expect(encodeCityCode(settings)).toBe(encodeCityCode(base()));
    expect(restored(settings).runtime).not.toHaveProperty('localServer');
  });
  it('accepts copied links and line-wrapped codes', () => {
    const settings = base(), code = encodeCityCode(settings), link = cityCodeUrl(code, 'https://example.test/v2.html?lang=fr#old');
    expect(new URL(link).search).toBe('?lang=fr'); expect(new URL(link).hash).toBe('#city=' + code);
    expect(decodeCityCode(link).settings).toEqual(settings);
    expect(decodeCityCode(' \n' + code.slice(0, 10) + '\n' + code.slice(10) + ' ').settings).toEqual(settings);
  });
  it('rejects damaged or invalid codes, unsafe overrides and unshareable raster data', () => {
    const code = encodeCityCode(base());
    for (let i = 4; i < code.length; i++) expect(() => decodeCityCode(code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1))).toThrow();
    expect(() => decodeCityCode(code + 'AAAA')).toThrow();
    const schema = ['', 0, defaults.settings.extent, defaults.settings, {}, []];
    for (const values of [[42, -1, 6000], [42, 32767, 6000], [42, 0, 1], [42, 0, 6000, {options:null}],
      [42, 0, 6000, defaults.settings, { invalid: {} }], [42, 0, 6000, defaults.settings, {}, [{}], 'extra']]) {
      expect(() => decodeCityCode(encodeCompact(values, schema, 'MU3.'))).toThrow();
    }
    const forbidden = JSON.parse('[{"constructor":{"polluted":true}}]');
    expect(() => encodeCityCode(base(), forbidden)).toThrow();
    expect(() => encodeCityCode(base(), [{ raster: new Float32Array([1, 2]) }])).toThrow('projet complet');
    const settings = base(); settings.options.importedHeight = { w: 1, h: 1, rgba: new Uint8Array(4) };
    expect(() => encodeCityCode(settings)).toThrow('heightmap');
  });
});
