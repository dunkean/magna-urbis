import { beforeAll, describe, expect, it, vi } from 'vitest';
import { firstPendingGeneration, runRemainingGeneration, type FullGenerationAction } from '../src/v2/fullGeneration';
import { generateTerrain, planRegion, generateTowns } from '../src/v2/engine';
import { defaultSettings } from '../src/v2/settings';
import { TerrainCache } from '../src/v2/cache';
import { regionSpec } from '../src/v2/regionSettings';
import { parseProject, serializeProject } from '../src/v2/project';
import type { World } from '../src/gen/types';
import type { V2TownStage } from '../src/v2/contracts';
import { recordGenerationValidity } from '../src/v2/stageValidity';

const recipe = defaultSettings();
recipe.generation = 'procedural';
recipe.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
recipe.extent = 1200; recipe.settlementCount = 1;
recipe.region = { placement: { mode: 'list', list: [regionSpec('main', 80)] } };
Object.assign(recipe.options, { population: 80, size: 'hamlet', coast: 'none', river: 'none', relief: 'flat', walls: 'none', castle: 'no',
  importedHeight: { w: 8, h: 8, rgba: new Uint8Array(0), elevations: new Float32Array(64).fill(20) } });
let terrain: World, region: World, complete: World;
beforeAll(async () => {
  terrain = await generateTerrain(recipe, undefined, new TerrainCache());
  region = await planRegion(terrain, recipe);
  complete = await generateTowns(region, recipe);
});

function controls(source: World = complete) {
  const settings = structuredClone(recipe);
  let world = structuredClone(source);
  return {
    settings: () => settings, world: () => world,
    targets: () => undefined as string[] | undefined,
    redraw: vi.fn(async () => {}),
    generate: vi.fn(async (action: FullGenerationAction, keys?: string[], through?: V2TownStage) => {
      if (action === 'terrain') world = await generateTerrain(settings, undefined, new TerrainCache());
      else if (action === 'region') world = await planRegion(world, settings);
      else if (action === 'towns') world = await generateTowns(world, settings, undefined, keys, through);
      else throw new Error('Unexpected roads action for the classic engine');
      return true;
    }),
  };
}

describe('full generation uses product validity from any tab', () => {
  it('regenerates changed terrain before placement when clicked from Settlements (expert JSON)', async () => {
    const api = controls();
    const edited = JSON.parse(JSON.stringify({ ...api.settings(), options: { ...api.settings().options, importedHeight: undefined } }));
    Object.assign(api.settings(), edited, { options: { ...edited.options, importedHeight: recipe.options.importedHeight, seaLevel: 5 } });
    expect(firstPendingGeneration(api.settings(), api.world())?.family).toBe('region');
    expect(await runRemainingGeneration('settlements', api)).toBe(true);
    expect(api.generate.mock.calls).toEqual([['terrain'], ['region'], ['towns', ['main'], 'buildings']]);
    expect(firstPendingGeneration(api.settings(), api.world())).toBeUndefined();
  });

  it('starts from settlements when only placement settings change and reuses terrain', async () => {
    const api = controls(), height = api.world().terrain.height.data;
    api.settings().options.population = 100;
    expect(firstPendingGeneration(api.settings(), api.world())?.id).toBe('settle-sites');
    await runRemainingGeneration('cities', api);
    expect(api.generate.mock.calls).toEqual([['region'], ['towns', ['main'], 'buildings']]);
    expect(api.world().terrain.height.data).toBe(height);
  });

  it.each(['region', 'settlements', 'cities', 'map'] as const)('runs only missing cities from %s', async family => {
    const api = controls(region), height = api.world().terrain.height.data;
    await runRemainingGeneration(family, api);
    expect(api.generate.mock.calls).toEqual([['towns', ['main'], 'buildings']]);
    expect(api.world().terrain.height.data).toBe(height);
  });

  it('runs missing placement and cities after terrain, then does nothing when everything is current', async () => {
    const api = controls(terrain);
    await runRemainingGeneration('map', api);
    expect(api.generate.mock.calls).toEqual([['region'], ['towns', ['main'], 'buildings']]);
    api.generate.mockClear(); api.redraw.mockClear();
    expect(await runRemainingGeneration('settlements', api)).toBe(true);
    expect(api.generate).not.toHaveBeenCalled(); expect(api.redraw).not.toHaveBeenCalled();
  });

  it('retains completion fingerprints across project save/reopen', () => {
    // The Classic engine of this recipe is a local-profile choice: the web profile reopens it on Rust (WebGPU/CPU only).
    vi.stubGlobal('window', { location: { hostname: 'localhost', protocol: 'http:', search: '?profile=local' } });
    let restored: ReturnType<typeof parseProject>;
    try { restored = parseProject(serializeProject(recipe, complete)); } finally { vi.unstubAllGlobals(); }
    expect(firstPendingGeneration(restored.settings, restored.world)).toBeUndefined();
    restored.settings.urban = { houses: { floors: 3 } };
    expect(firstPendingGeneration(restored.settings, restored.world)?.id).toBe('city-buildings');
  });

  it('rebuilds cities removed by a placement-only run with an unchanged recipe', async () => {
    const api = controls(await planRegion(complete, recipe));
    expect(api.world().urban).toBeUndefined();
    await runRemainingGeneration('settlements', api);
    expect(api.generate.mock.calls).toEqual([['towns', ['main'], 'buildings']]);
  });

  it('completes a partial city even when the recipe was configured to stop early', async () => {
    const api = controls(region);
    api.settings().urban = { through: 'layout' };
    recordGenerationValidity(api.world(), api.settings(), 'town', 'main', 'layout');
    expect(firstPendingGeneration(api.settings(), api.world())?.id).toBe('city-parcels');
    await runRemainingGeneration('map', api);
    expect(api.generate.mock.calls).toEqual([['towns', ['main'], 'buildings']]);
  });

  it('does not continue after failure or cancellation', async () => {
    const api = controls(terrain); api.generate.mockResolvedValue(false);
    expect(await runRemainingGeneration('settlements', api)).toBe(false);
    expect(api.generate.mock.calls).toEqual([['region']]);
    expect(api.redraw).not.toHaveBeenCalled();
  });

  it('does not turn an empty explicit selection into all cities', async () => {
    const api = { ...controls(region), targets: () => [] };
    await runRemainingGeneration('cities', api);
    expect(api.generate).not.toHaveBeenCalled();
  });
});
