import { describe, expect, it } from 'vitest';
import type { V2Settings } from '../../src/v2/contracts';
import type { World } from '../../src/gen/types';
import { defaultSettings } from '../../src/v2/settings';
import { applySceneClock, DEFAULT_SCENE } from '../../src/v2/sceneClock';
import { getLanguage } from '../../src/v2/i18n';
import { markAllStagesStale, resetSettings } from '../../src/v2/settingsReset';
import { regionalPopulation } from '../../src/v2/regionalPopulation';

const fresh = (): V2Settings => { const s = defaultSettings(); applySceneClock(s, DEFAULT_SCENE); return s; };

describe('settings reset', () => {
  it('restores the fresh-page defaults and keeps the runtime choice and the interface language', () => {
    const language = getLanguage();
    const edited = fresh();
    edited.options.seed = 'edited'; edited.options.culture = 'roman'; edited.extent = 12000; edited.settlementCount = 7;
    edited.local = { main: { population: 9000 } };
    edited.region = { placement: { mode: 'counts' } } as V2Settings['region'];
    edited.urban = { backend: 'native', local: { main: {} }, buildings: { 'main/1': {} as never } };
    edited.naming = { places: { main: 'Renamed' }, labels: {} };
    edited.appearance = { style: 'atlas' };
    edited.generation = 'neural';
    edited.runtime = { compute: 'gpu', backend: 'native', source: 'neural-python', localServer: 'http://127.0.0.1:8791', pythonServer: 'http://127.0.0.1:8793' };
    edited.terrain = { ...edited.terrain, baseModel: 'base-x', relief: 'mountains' } as V2Settings['terrain'];

    const next = resetSettings(edited);
    const expected = fresh();
    expected.generation = 'neural';
    expected.runtime = { ...edited.runtime! };
    expected.urban = { backend: 'native' };
    expected.terrain = { ...expected.terrain, baseModel: 'base-x' } as V2Settings['terrain'];
    expect(next).toEqual(expected);
    expect(next.runtime).not.toBe(edited.runtime);
    expect(getLanguage()).toBe(language);
  });

  it('drops the chosen settlement counts, population and density: the automatic list applies again', () => {
    const edited = fresh();
    edited.local = { main: { population: 4000 } };
    edited.region = { demography: { population: 0, density: 3, counts: { city: 0, town: 5, village: 0, hamlet: 0, farmstead: 0 }, isolatedCount: 9, followCulture: false },
      placement: { mode: 'counts', counts: { village: 4 } } } as V2Settings['region'];
    const next = resetSettings(edited);
    expect(next.region?.demography).toBeUndefined();
    expect(next.region?.placement).toBeUndefined();
    expect(next.local).toEqual({});
    expect(regionalPopulation(next)).toEqual(regionalPopulation(fresh()));
  });

  it('marks every built stage stale', () => {
    const world = { stats: { 'v2.valid:terrain': 'a', 'v2.valid:city-roads:main': 'b', 'v2.culture:main': 'roman' } } as unknown as World;
    markAllStagesStale(world, undefined, world);
    expect(world.stats).toEqual({ 'v2.culture:main': 'roman' });
  });
});
