import { describe, expect, it } from 'vitest';
import { createReliefSources, reliefTab } from '../../src/v2/reliefSources';
import { defaultSettings } from '../../src/v2/settings';
import { terrainStageValidityKeys } from '../../src/v2/stageValidity';
import { effectiveTerrainSettings } from '../../src/v2/terrainSettings';
import type { V2Settings, V2TerrainSettings } from '../../src/v2/contracts';

const zones: NonNullable<V2TerrainSettings['zones']> = { version: 1, resolution: 8, weights: Array.from({ length: 8 * 8 * 5 }, (_, i) => i % 5 === 3 ? 255 : 0) };
const sketch: NonNullable<V2TerrainSettings['sketch']> = { version: 1, resolution: 8, processing: 'surface', heights: Array(64).fill(120) };
const image: NonNullable<V2Settings['options']['importedHeight']> = { w: 1, h: 1, rgba: new Uint8ClampedArray([80, 80, 80, 255]) };
function setup() {
  const settings = defaultSettings();
  const sources = createReliefSources(() => settings, () => settings.terrain?.coastMask ?? 0);
  return { settings, sources, enter: () => sources.select(sources.method()) };
}

describe('Heightmap source methods', () => {
  it('defaults to load and remembers an empty symbolic choice across source tabs', () => {
    const { sources, enter, settings } = setup();
    expect(sources.current()).toBe('procedural');
    expect(sources.method()).toBe('heightmap');
    enter(); expect(sources.current()).toBe('heightmap');
    sources.select('symbolic');
    expect(effectiveTerrainSettings(settings, 6000).relief).toBe('hills');
    expect(reliefTab(sources.current())).toBe('heightmap');
    sources.select('neural'); expect(sources.current()).toBe('neural');
    enter(); expect(sources.current()).toBe('symbolic');
    expect(settings.runtime?.source).toBe('procedural');
  });

  it('follows recipe inputs before an empty session selection, with zones taking priority', () => {
    const { settings, sources } = setup();
    sources.select('symbolic');
    delete settings.terrain!.zones;
    settings.options.importedHeight = image;
    expect(sources.current()).toBe('heightmap');
    settings.terrain!.zones = zones;
    expect(sources.current()).toBe('symbolic');
    delete settings.terrain!.zones;
    expect(sources.method()).toBe('heightmap');
  });

  for (const input of ['sketch', 'image'] as const) it(`restores painted zones and the loaded ${input} across methods and tabs`, () => {
    const { settings, sources, enter } = setup();
    settings.terrain = { coastMask: 4 };
    if (input === 'sketch') settings.terrain.sketch = sketch;
    else settings.options.importedHeight = image;
    expect(sources.current()).toBe('heightmap');
    sources.select('symbolic');
    expect(settings.terrain.sketch).toBeUndefined();
    expect(settings.options.importedHeight).toBeUndefined();
    settings.terrain.zones = zones; sources.changed('symbolic');
    sources.select('heightmap');
    expect(settings.terrain.zones).toBeUndefined();
    expect(input === 'sketch' ? settings.terrain.sketch : settings.options.importedHeight).toBe(input === 'sketch' ? sketch : image);
    sources.select('procedural'); enter();
    expect(sources.current()).toBe('heightmap');
    sources.select('symbolic');
    expect(settings.terrain.zones).toBe(zones);
    sources.select('neural'); enter();
    expect(settings.terrain.zones).toBe(zones);
    expect(settings.runtime?.source).toBe('procedural');
  });

  it('keeps the inactive painted map when an import replaces the active recipe input', () => {
    const { settings, sources } = setup();
    settings.terrain = { zones };
    sources.current();
    delete settings.terrain.zones; settings.terrain.sketch = sketch; sources.changed('import');
    expect(sources.current()).toBe('heightmap');
    sources.select('symbolic'); expect(settings.terrain.zones).toBe(zones);
    sources.select('heightmap'); expect(settings.terrain.sketch).toBe(sketch);
  });

  it('keeps symbolic selected after clearing zones and preserves the loaded input', () => {
    const { settings, sources } = setup();
    settings.options.importedHeight = image; sources.current();
    sources.select('symbolic'); settings.terrain!.zones = zones; sources.changed('symbolic');
    settings.terrain!.zones = { ...zones, weights: zones.weights.map(() => 0) }; sources.changed('symbolic');
    expect(sources.current()).toBe('symbolic');
    sources.select('heightmap'); expect(settings.options.importedHeight).toBe(image);
    sources.select('symbolic'); expect(settings.terrain!.zones!.weights.every(weight => weight === 0)).toBe(true);
    expect(effectiveTerrainSettings(settings, 6000).relief).toBe('hills');
  });

  it('restores separate coast masks and keeps island presets out of symbolic generation', () => {
    const { settings, sources } = setup();
    settings.terrain = { coastMask: 255 };
    sources.select('symbolic'); expect(settings.terrain.coastMask).toBe(0);
    settings.terrain.coastMask = 5;
    sources.select('heightmap'); expect(settings.terrain.coastMask).toBe(0);
    settings.terrain.coastMask = 16;
    sources.select('symbolic'); expect(settings.terrain.coastMask).toBe(5);
    sources.select('heightmap'); expect(settings.terrain.coastMask).toBe(16);
    sources.select('procedural'); expect(settings.terrain.coastMask).toBe(255);
  });

  it('restores the selected neural engine and clears old relief modifications on a source change', () => {
    const { settings, sources } = setup();
    settings.runtime!.source = 'neural-python';
    sources.select('symbolic'); expect(settings.runtime!.source).toBe('procedural');
    settings.terrain!.modification = { version: 1, resolution: 8, width: 2000, delta: Array(64).fill(1) };
    sources.select('neural'); expect(settings.runtime!.source).toBe('neural-python');
    expect(settings.terrain!.modification).toBeUndefined();
  });

  it('restores the symbolic generation validity keys with the same painted input', () => {
    const { settings, sources } = setup();
    settings.terrain = { zones, coastMask: 4 };
    sources.current();
    const before = terrainStageValidityKeys(settings);
    sources.select('heightmap');
    expect(terrainStageValidityKeys(settings).get('relief-source')).not.toBe(before.get('relief-source'));
    sources.select('symbolic');
    expect(terrainStageValidityKeys(settings)).toEqual(before);
  });
});
