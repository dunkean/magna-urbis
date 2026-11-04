import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { migrateUrbanSeeds, rerollUrbanSeeds, setUrbanSeed, streetSeedConfig, urbanSeed, URBAN_SEED_STAGES } from '../src/v2/urbanSeeds';
import { defaultLayoutConfig } from '../../rust/bridge/urbanConfig';
import type { Layout } from '../../rust/bridge/urban';
import { seedRoot } from '../../rust/bridge/generationSeed';
import { cityStageValidityKeys, settlementStageValidityKeys, terrainStageValidityKeys } from '../src/v2/stageValidity';
import { parseProject, serializeProject, validateSettings } from '../src/v2/project';

describe('independent city draws', () => {
  it('migrates earlier local choices into the general seed without changing their results or priority', () => {
    const settings = defaultSettings();
    settings.urban = { seed: 'legacy-global', local: { east: { seed: 'east-base', seeds: { houses: 'east-houses' } } } };
    settings.local.west = { seed: 'lower-priority-local' };
    const before = ['east', 'west'].map(key => URBAN_SEED_STAGES.map(stage => urbanSeed(settings, key, stage)));
    migrateUrbanSeeds(settings);
    expect(settings.urban.seed).toBeUndefined(); expect(settings.urban.local!.east.seeds).toBeUndefined(); expect(settings.local.west.seed).toBeUndefined();
    const fresh = defaultSettings(); fresh.options.seed = settings.options.seed;
    expect(['east', 'west'].map(key => URBAN_SEED_STAGES.map(stage => urbanSeed(fresh, key, stage)))).toEqual(before);
    const encoded = settings.options.seed; migrateUrbanSeeds(settings); expect(settings.options.seed).toBe(encoded);
  });
  it('inherits the historical draw until a global or local city seed is explicitly chosen', () => {
    const settings = defaultSettings();
    expect(urbanSeed(settings, 'east')).toBe(settings.options.seed);
    settings.local.east = { seed: 'historical-place-seed' };
    expect(urbanSeed(settings, 'east')).toBe('historical-place-seed');
    settings.urban = { seed: 'all-cities' };
    expect(urbanSeed(settings, 'east')).toBe('all-cities');
    settings.urban.local = { east: { seed: 'east-only' } };
    expect(urbanSeed(settings, 'east')).toBe('east-only');
    expect(urbanSeed(settings, 'west')).toBe('all-cities');
  });

  it('rerolls only the selected cities, preserves their controls and persists a reproducible combination', () => {
    const settings = defaultSettings(), upstream = structuredClone(settings);
    settings.urban = { seed: 'base', local: { east: { layout: { density: 1.4 } }, west: { seed: 'keep-west' } } };
    const scope = JSON.stringify(['selection', ['east']]), otherScope = JSON.stringify(['selection', ['west']]);
    const terrain = terrainStageValidityKeys(settings), sites = settlementStageValidityKeys(settings, 'terrain');
    const city = cityStageValidityKeys(settings, undefined, scope), west = cityStageValidityKeys(settings, undefined, otherScope);
    rerollUrbanSeeds(settings, ['east', 'south', 'east'], 'streets');
    const first = urbanSeed(settings, 'east', 'streets');
    expect(first).not.toBe('base'); expect(urbanSeed(settings, 'south', 'streets')).not.toBe(first);
    expect(urbanSeed(settings, 'west')).toBe('keep-west');
    expect(settings.urban.local!.east.layout).toEqual({ density: 1.4 });
    expect({ ...settings.options, seed: seedRoot(settings.options.seed) }).toEqual(upstream.options); expect(settings.local).toEqual(upstream.local);
    expect(terrainStageValidityKeys(settings)).toEqual(terrain);
    expect(settlementStageValidityKeys(settings, 'terrain')).toEqual(sites);
    expect(cityStageValidityKeys(settings, undefined, scope).get('city-roads')).not.toBe(city.get('city-roads'));
    expect(cityStageValidityKeys(settings, undefined, scope).get('city-composition')).toBe(city.get('city-composition'));
    expect(urbanSeed(settings, 'east', 'composition')).toBe('base');
    expect(urbanSeed(settings, 'east', 'houses')).toBe('base');
    expect(cityStageValidityKeys(settings, undefined, otherScope)).toEqual(west);
    const restored = parseProject(serializeProject(settings)).settings;
    expect(restored.urban).toEqual(settings.urban);
    expect(urbanSeed(restored, 'east', 'streets')).toBe(first);
    rerollUrbanSeeds(settings, ['east'], 'streets'); expect(urbanSeed(settings, 'east', 'streets')).not.toBe(first);
  });

  it('does nothing for an empty selection and rejects invalid imported city seeds', () => {
    const settings = defaultSettings(), before = structuredClone(settings);
    rerollUrbanSeeds(settings, [], 'streets'); expect(settings).toEqual(before);
    for (const seed of [2, {}, 'x'.repeat(1001)]) {
      expect(() => validateSettings({ ...settings, urban: { seed } })).toThrow('Graine urbaine');
      expect(() => validateSettings({ ...settings, urban: { local: { east: { seed } } } })).toThrow('Graine urbaine');
      expect(() => validateSettings({ ...settings, urban: { local: { east: { seeds: { streets: seed } } } } })).toThrow('Graine urbaine');
    }
    expect(() => validateSettings({ ...settings, urban: { seeds: { unknown: 'oops' } } })).toThrow('Graines des étapes');
  });

  it('keeps every earlier step valid when one stage seed changes, and hides redundant local storage', () => {
    const settings = defaultSettings(), scope = JSON.stringify(['selection', ['east']]);
    const rows = ['city-composition', 'city-roads', 'city-parcels', 'city-programme', 'city-buildings', 'city-houses'];
    for (const [index, stage] of URBAN_SEED_STAGES.entries()) {
      const before = cityStageValidityKeys(settings, undefined, scope);
      setUrbanSeed(settings, 'east', stage, `${stage}-test`);
      const after = cityStageValidityKeys(settings, undefined, scope);
      for (const row of rows.slice(0, index)) expect(after.get(row), `${stage}/${row}`).toBe(before.get(row));
      expect(after.get(rows[index])).not.toBe(before.get(rows[index]));
      setUrbanSeed(settings, 'east', stage, seedRoot(settings.options.seed));
      expect(settings.urban?.local?.east.seeds?.[stage]).toBeUndefined();
    }
  });

  it('rerolls interior cuts through native quarter salts without changing composition controls or explicit quarter edits', () => {
    const config = defaultLayoutConfig(); config.overrides = { quarters: { '0': { wealth: .8, salt: 12 }, '1': { deleted: true } } };
    const before = structuredClone(config), composition = [{ quarters: [{}, {}, {}] }] as Layout[];
    const a = streetSeedConfig(config, composition, 'a'), b = streetSeedConfig(config, composition, 'b');
    expect(config).toEqual(before); expect(a.footprint).toBe(config.footprint);
    expect(a.overrides!.quarters!['0'].wealth).toBe(.8); expect(a.overrides!.quarters!['1'].deleted).toBe(true);
    expect(a.overrides!.quarters!['0'].salt).not.toBe(b.overrides!.quarters!['0'].salt);
    expect(streetSeedConfig(config, composition, 'a')).toEqual(a);
  });
});
