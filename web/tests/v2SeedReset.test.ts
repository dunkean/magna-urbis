import { beforeAll, describe, expect, it, vi } from 'vitest';
import { firstPendingGeneration, runRemainingGeneration, type FullGenerationAction } from '../src/v2/fullGeneration';
import { generateTerrain, planRegion, generateTowns } from '../src/v2/engine';
import { defaultSettings } from '../src/v2/settings';
import { TerrainCache } from '../src/v2/cache';
import { regionSpec } from '../src/v2/regionSettings';
import { regionalPopulation } from '../src/v2/regionalPopulation';
import { regionalParentKey, resetRegionalChildren } from '../src/v2/generationEdits';
import { rerollSeed } from '../../rust/bridge/generationSeed';
import type { World } from '../src/gen/types';
import type { V2Settings, V2TownStage } from '../src/v2/contracts';

const recipe = defaultSettings();
recipe.generation = 'procedural';
recipe.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
recipe.extent = 1200; recipe.settlementCount = 0;
recipe.region = { demography: { population: 400 } };
Object.assign(recipe.options, { seed: 'seed-a', coast: 'none', river: 'none', relief: 'flat', walls: 'none', castle: 'no',
  importedHeight: { w: 8, h: 8, rgba: new Uint8Array(0), elevations: new Float32Array(64).fill(20) } });
let complete: World;
beforeAll(async () => {
  complete = await generateTowns(await planRegion(await generateTerrain(recipe, undefined, new TerrainCache()), recipe), recipe);
  // Per-place products of an earlier run under another seed (towns built by the native engine, a refused house, a planned size).
  Object.assign(complete.stats, { 'v2.urbanStage:village-9': 'layout', 'v2.urbanRefusals:village-9': 3, 'v2.population:village-9': 777, 'settlements.warning': 'old seed' });
});

function controls(source: World) {
  const settings = structuredClone(recipe);
  let world = structuredClone(source);
  const cancelled = new Set<FullGenerationAction>();
  return {
    settings: () => settings, world: () => world, cancelled,
    targets: () => undefined as string[] | undefined,
    redraw: vi.fn(async () => {}),
    generate: vi.fn(async (action: FullGenerationAction, keys?: string[], through?: V2TownStage) => {
      // A cancelled run returns false and leaves the previous map in place (main.ts generate).
      if (cancelled.delete(action)) return false;
      if (action === 'terrain') world = await generateTerrain(settings, undefined, new TerrainCache());
      else if (action === 'region') world = await planRegion(world, settings);
      else if (action === 'towns') world = await generateTowns(world, settings, undefined, keys, through);
      else throw new Error('Unexpected roads action for the classic engine');
      return true;
    }),
  };
}
/** The page's seed edit: touchRecipe resets the regional children with the previous parent key. */
function changeSeed(settings: V2Settings, seed: string): void {
  const previous = regionalParentKey(settings);
  settings.options.seed = seed;
  resetRegionalChildren(settings, [], previous);
}
function expectFreshPlacement(settings: V2Settings, world: World): void {
  const planned = new Map(regionalPopulation(settings).places.map(place => [place.key, place.population]));
  expect(world.settlements?.map(place => [place.key, place.population])).toEqual([...planned]);
  for (const place of world.settlements ?? []) expect(world.stats['v2.population:' + place.key]).toBe(place.population);
  for (const name of ['v2.urbanStage:village-9', 'v2.urbanRefusals:village-9', 'v2.population:village-9']) expect(world.stats[name]).toBeUndefined();
  expect(world.stats['settlements.warning']).not.toBe('old seed');
  expect(firstPendingGeneration(settings, world)).toBeUndefined();
}

describe('a seed change resets every downstream product', () => {
  it('recomputes placement and planned sizes after a cancelled placement and a new seed', async () => {
    const api = controls(complete);
    api.settings().region!.demography!.population = 500;
    api.cancelled.add('region');
    expect(await runRemainingGeneration('settlements', api)).toBe(false);
    expect(api.world().settlements?.map(p => p.population)).toEqual(complete.settlements?.map(p => p.population));
    changeSeed(api.settings(), 'seed-b');
    api.generate.mockClear();
    expect(await runRemainingGeneration('settlements', api)).toBe(true);
    expect(api.generate.mock.calls.map(call => call[0])).toEqual(['terrain', 'region', 'towns']);
    expectFreshPlacement(api.settings(), api.world());
  });

  it('a placement seed change drops the frozen list and the previous places, without cancellation', async () => {
    const api = controls(complete), settings = api.settings();
    // Moving a town freezes the whole automatic draw into a list (main.ts town mover).
    settings.region!.placement = { mode: 'list', list: complete.settlements!.map(place => ({ ...regionSpec(place.key, 31), position: { ...place.center } })) };
    changeSeed(settings, rerollSeed(settings.options.seed, ['settle-sites', 'city/*/default']));
    expect(settings.region!.placement!.list).toBeUndefined();
    expect(firstPendingGeneration(settings, api.world())?.id).toBe('settle-sites');
    await runRemainingGeneration('cities', api);
    expect(api.generate.mock.calls.map(call => call[0])).toEqual(['region', 'towns']);
    expect(api.world().settlements?.some(place => place.population === 31)).toBe(false);
    expectFreshPlacement(settings, api.world());
  });

  it('keeps the values the user typed: counts, population and a hand-built list', () => {
    const settings = structuredClone(recipe);
    settings.region = { demography: { population: 900, counts: { hamlet: 2 } } };
    changeSeed(settings, 'seed-c');
    expect(settings.region.demography).toEqual({ population: 900, counts: { hamlet: 2 } });
    expect(regionalPopulation(settings).counts.hamlet).toBe(2);
    const list = [regionSpec('main', 300), regionSpec('place-2', 40)];
    settings.region.placement = { mode: 'list', list: structuredClone(list) };
    changeSeed(settings, 'seed-d');
    expect(settings.region.placement).toEqual({ mode: 'list', list });
  });
});
