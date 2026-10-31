import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { generateTerrain, planRegion, generateTown, generateTowns } from '../src/v2/engine';
import { TerrainCache } from '../src/v2/cache';
import { cityStageValidityKeys, settlementStageValidityKeys } from '../src/v2/stageValidity';
import type { World } from '../src/gen/types';

const native = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('../src/v2/rustUrban', () => ({ generateRustTown: native.build }));
beforeEach(() => { native.build.mockReset(); });

async function fixture() {
  const settings = defaultSettings();
  settings.generation = 'procedural';
  settings.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
  settings.extent = 2400; settings.settlementCount = 1;
  Object.assign(settings.options, { population: 80, size: 'hamlet', coast: 'none', river: 'none', relief: 'flat', walls: 'none', castle: 'no',
    importedHeight: { w: 8, h: 8, rgba: new Uint8Array(0), elevations: new Float32Array(64).fill(20) } });
  const terrain = await generateTerrain(settings, undefined, new TerrainCache());
  const region = await planRegion(terrain, settings);
  const world = await generateTown(region, settings, 'main');
  for (const [i, key] of ['east', 'west'].entries()) world.settlements!.push({ ...structuredClone(world.settlements![0]), key, main: false, center: { x: 400 + i * 1400, y: 400 }, urban: structuredClone(world.urban) });
  settings.urban = { backend: 'rust' };
  native.build.mockImplementation(async (source: World, _settings, key, _progress, stage) => ({
    urban: { ...structuredClone(source.urban!), buildings: stage === 'layout' ? [] : structuredClone(source.urban!.buildings) },
    snapshot: { stage, marker: key }, stats: { [`v2.urbanStage:${key}`]: stage ?? 'buildings' },
  }));
  return { settings, world };
}

describe('Cities batch scope', () => {
  it('runs an explicit stage for a deduplicated subset and preserves all other cities and regional geometry', async () => {
    const { settings, world } = await fixture();
    const original = structuredClone(world);
    settings.urban!.local = { east: { houses: { floors: 3 } } };
    const next = await generateTowns(world, settings, undefined, ['east', 'east'], 'layout');
    expect(native.build).toHaveBeenCalledTimes(1);
    expect(native.build.mock.calls[0].slice(1)).toEqual([settings, 'east', undefined, 'layout']);
    expect(next.settlements!.find(place => place.key === 'east')!.urban!.buildings).toHaveLength(0);
    expect(next.urban).toEqual(world.urban);
    expect(next.settlements!.find(place => place.key === 'west')!.urban).toEqual(world.settlements!.find(place => place.key === 'west')!.urban);
    expect(next.roads).toEqual(world.roads); expect(next.terrain.height.data).toBe(world.terrain.height.data);
    expect(world).toEqual(original);
  });
  it('applies the chosen stage to every city when no subset is provided', async () => {
    const { settings, world } = await fixture();
    const next = await generateTowns(world, settings, undefined, undefined, 'parcels');
    expect(native.build.mock.calls.map(call => [call[2], call[4]])).toEqual([['main', 'parcels'], ['east', 'parcels'], ['west', 'parcels']]);
    expect(next.stats['v2.urbanStage:west']).toBe('parcels');
  });
  it('rejects an empty or obsolete subset before any city is modified', async () => {
    const { settings, world } = await fixture();
    await expect(generateTowns(world, settings, undefined, [])).rejects.toThrow('Select at least one');
    await expect(generateTowns(world, settings, undefined, ['east', 'missing'])).rejects.toThrow('Unknown settlement');
    expect(native.build).not.toHaveBeenCalled();
  });
  it('invalidates only downstream products for a house or cadastral recipe change and tracks the target set', async () => {
    const { settings, world } = await fixture(), scope = JSON.stringify(['selection', ['east']]);
    const before = cityStageValidityKeys(settings, world, scope);
    settings.urban!.houses = { floors: 3 };
    const houses = cityStageValidityKeys(settings, world, scope);
    expect(houses.get('city-quarters')).toBe(before.get('city-quarters'));
    expect(houses.get('city-parcels')).toBe(before.get('city-parcels'));
    expect(houses.get('city-houses')).not.toBe(before.get('city-houses'));
    settings.urban!.parcels = { density: .7 };
    const parcels = cityStageValidityKeys(settings, world, scope);
    expect(parcels.get('city-roads')).toBe(houses.get('city-roads'));
    expect(parcels.get('city-parcels')).not.toBe(houses.get('city-parcels'));
    expect(cityStageValidityKeys(settings, world, JSON.stringify(['all', ['main', 'east', 'west']])).get('city-roads')).not.toBe(parcels.get('city-roads'));
  });
  it('keeps placement valid when only regional roads change', () => {
    const settings = defaultSettings(), before = settlementStageValidityKeys(settings, 'terrain');
    settings.region = { roads: { maxGrade: .15 } };
    const changed = settlementStageValidityKeys(settings, 'terrain');
    expect(changed.get('settle-sites')).toBe(before.get('settle-sites'));
    expect(changed.get('settle-roads')).not.toBe(before.get('settle-roads'));
  });
});
