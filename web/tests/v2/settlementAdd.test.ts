import { describe, expect, it } from 'vitest';
import type { World, Settlement } from '../../src/gen/types';
import { defaultSettings } from '../../src/v2/settings';
import { acceptPlacementEdit, addSettlement, discardCustomSettlements, insertSettlement, keepMovedSettlement } from '../../src/v2/settlementAdd';
import { effectiveRegion } from '../../src/v2/regionSettings';
import { regionalPopulation } from '../../src/v2/regionalPopulation';
import { editRegionalPopulation } from '../../src/v2/regionalPopulationEdits';
import { regionKey } from '../../src/v2/regionKeys';
import { parseProject, serializeProject } from '../../src/v2/project';

const town = (key: string, x: number, population: number, main = false): Settlement => ({ key, main, center: { x, y: 500 }, population, culture: 'european-organic', archetype: 'plain', radius: 50, extent: [], region: [] }) as unknown as Settlement;
const world = { mapSize: 4000, stats: {}, settlements: [town('main', 1000, 2000, true), town('village-0', 3000, 300)] } as unknown as World;
const settingsFor = () => {
  const settings = defaultSettings();
  settings.extent = 4000;
  return settings;
};

describe('Custom settlements', () => {
  it('adds a fixed place to the automatic plan, saved with the project', () => {
    const settings = settingsFor(),
      automatic = regionalPopulation(settings);
    const key = addSettlement(settings, world, { population: 750, culture: 'medina', position: { x: 2000, y: 9000 } });
    expect(key).toBe('place-3');
    expect(settings.region?.placement?.list).toBeUndefined();
    const restored = parseProject(serializeProject(settings)).settings;
    expect(effectiveRegion(restored).placement.list.find(s => s.key === key)).toMatchObject({ population: 750, culture: 'medina', position: { x: 2000, y: 3999.99 } });
    expect(regionalPopulation(restored).population).toBe(automatic.population + 750);
    expect(addSettlement(settings, world, { population: 20, culture: 'medina', position: { x: 10, y: 10 } })).toBe('place-4');
  });
  it('keeps custom places through count and population edits, the automatic places sharing the rest', () => {
    const settings = settingsFor();
    addSettlement(settings, world, { population: 750, culture: 'medina', position: { x: 2000, y: 2000 } });
    editRegionalPopulation(settings, 'village', 3);
    expect(regionalPopulation(settings).places.some(p => p.key === 'place-3')).toBe(true);
    editRegionalPopulation(settings, 'population', 5000);
    const plan = regionalPopulation(settings);
    expect(plan.places.find(p => p.key === 'place-3')?.population).toBe(750);
    expect(plan.allocatedPopulation).toBe(5000);
    expect(discardCustomSettlements(settings)).toBe(1);
    expect(regionalPopulation(settings).places.some(p => p.key === 'place-3')).toBe(false);
  });
  it('a moved place replaces its automatic slot', () => {
    const settings = settingsFor();
    keepMovedSettlement(settings, world.settlements![1], { x: 3500, y: 3500 });
    const places = effectiveRegion(settings).placement.list.filter(p => p.key === 'village-0');
    if (regionalPopulation({ ...settings, region: {} }).places.some(p => p.key === 'village-0')) expect(places).toHaveLength(1);
    expect(places[0].position).toEqual({ x: 3500, y: 3500 });
  });
  it('joins the displayed world without replacing the other places', () => {
    const settings = settingsFor();
    const key = addSettlement(settings, world, { population: 750, culture: 'medina', position: { x: 2000, y: 2000 } });
    const next = acceptPlacementEdit(insertSettlement(world, settings, key), settings, true);
    expect(next.settlements!.slice(0, 2)).toEqual(world.settlements);
    expect(next.settlements![2]).toMatchObject({ key, population: 750, culture: 'medina', center: { x: 2000, y: 2000 }, fixed: true });
    expect(next.stats['v2.planKey']).toBe(regionKey(settings));
  });
});
