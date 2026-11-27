import { describe, expect, it } from 'vitest';
import { CULTURES, cultureEra } from '../src/gen/options';
import { contributorCultures } from '../src/gen/contributorCultures';
import { CLIMATE_ZONES } from '../../rust/bridge/terrainClimate';
import { TERRAIN_RELIEFS } from '../src/v2/terrainSettings';
import { CULTURE_HABITATS, MEDIEVAL_CULTURES, cultureEnvironment, plausibleCultures, randomCulture } from '../src/v2/environmentCultures';
import { defaultSettings } from '../src/v2/settings';
import { UNDERDARK_CULTURES } from '../src/v2/underdarkCultures';
import { resolveToponymProfile } from '../src/gen/names/profiles';
import { generateToponymRecord } from '../src/gen/names/toponyms';

describe('pre-modern environmental culture selection', () => {
  it('assigns every automatically selected pre-modern culture a valid, distinctive niche', () => {
    expect([...Object.keys(CULTURE_HABITATS), ...UNDERDARK_CULTURES].sort()).toEqual([...MEDIEVAL_CULTURES].sort());
    const explicitCultures = new Set(contributorCultures.map(entry => entry.id));
    expect(MEDIEVAL_CULTURES).toEqual(CULTURES.filter(id => !cultureEra(id) && !explicitCultures.has(id)));
    for (const habitat of Object.values(CULTURE_HABITATS)) {
      expect(habitat.climates.length).toBeLessThanOrEqual(3);
      for (const climate of habitat.climates) expect(CLIMATE_ZONES).toContain(climate);
      for (const relief of habitat.reliefs) expect(TERRAIN_RELIEFS).toContain(relief);
    }
  });
  it('has real candidates for every selectable climate/relief, with and without a coast', () => {
    const settings = defaultSettings();
    for (const climate of CLIMATE_ZONES)
      for (const relief of TERRAIN_RELIEFS)
        for (const coastMask of [0, 255]) {
          settings.terrain = { climate, relief, coastMask };
          const pool = plausibleCultures(settings);
          expect(pool.length, `${climate}/${relief}/${coastMask}`).toBeGreaterThan(0);
          expect(new Set(pool).size).toBe(pool.length);
          expect(pool.every(id => !cultureEra(id) && !UNDERDARK_CULTURES.includes(id))).toBe(true);
        }
  });
  it('keeps polar, desert, tropical, mountain and maritime caricatures separate', () => {
    const settings = defaultSettings();
    settings.terrain = { climate: 'desert', relief: 'canyon', coastMask: 0 };
    expect(plausibleCultures(settings)).toEqual(expect.arrayContaining(['ksar-oasis', 'hadhrami-tower', 'native-pueblo']));
    expect(plausibleCultures(settings)).not.toContain('halfling');
    settings.terrain = { climate: 'arctic', relief: 'flat', coastMask: 0 };
    expect(plausibleCultures(settings)).toEqual(['siberian-camp']);
    settings.terrain.coastMask = 255;
    expect(plausibleCultures(settings)).toContain('inuit-camp');
    settings.terrain = { climate: 'tropical', relief: 'volcano' };
    expect(plausibleCultures(settings)).toEqual(['javanese-courts']);
    settings.terrain = { climate: 'alpine', relief: 'high-mountains' };
    expect(plausibleCultures(settings)).toContain('dwarven');
    expect(plausibleCultures(settings)).not.toContain('medina');
    settings.terrain = { climate: 'mediterranean', relief: 'flat', coastMask: 255 };
    expect(plausibleCultures(settings)).toContain('venetian-lagoon');
    settings.terrain.procedural = { enabled: { coasts: false } };
    expect(plausibleCultures(settings)).not.toContain('venetian-lagoon');
  });
  it('draws only Underdark peoples underground and all pre-modern cultures with follow unchecked', () => {
    const settings = defaultSettings();
    settings.options.biome = 'underdark';
    expect(plausibleCultures(settings)).toEqual(UNDERDARK_CULTURES);
    for (let i = 0; i < UNDERDARK_CULTURES.length; i++) {
      expect(randomCulture(settings, true, () => (i + 0.5) / UNDERDARK_CULTURES.length)).toBe(UNDERDARK_CULTURES[i]);
    }
    for (let i = 0; i < MEDIEVAL_CULTURES.length; i++) {
      expect(randomCulture(settings, false, () => (i + 0.5) / MEDIEVAL_CULTURES.length)).toBe(MEDIEVAL_CULTURES[i]);
    }
    expect(randomCulture(settings, true, () => 0, UNDERDARK_CULTURES[0])).toBe(UNDERDARK_CULTURES[1]);
    settings.options.biome = 'temperate';
    settings.terrain = { climate: 'tropical', relief: 'volcano' };
    expect(randomCulture(settings, true, () => 0, 'javanese-courts')).toBe('javanese-courts');
  });
  it('resolves the same climate as the controls, including legacy biome fallbacks', () => {
    const settings = defaultSettings();
    settings.options.biome = 'forest';
    expect(cultureEnvironment(settings).climate).toBe('continental');
    settings.terrain!.climate = 'oceanic';
    expect(cultureEnvironment(settings).climate).toBe('temperate');
    settings.options.biome = 'tundra';
    delete settings.terrain!.climate;
    expect(cultureEnvironment(settings).climate).toBe('arctic');
  });
  it('feeds the selected culture through the existing automatic toponym profile', () => {
    const settings = defaultSettings();
    settings.terrain = { climate: 'desert', relief: 'canyon' };
    for (const culture of [...plausibleCultures(settings), ...UNDERDARK_CULTURES]) {
      const name = generateToponymRecord({ seed: 'environment-test', culture, language: 'auto', kind: 'town', key: 'main' });
      expect(name.profile).toBe(resolveToponymProfile(culture).id);
      expect(name.cultural.length).toBeGreaterThan(0);
    }
  });
});
