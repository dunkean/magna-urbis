import { describe, expect, it } from 'vitest';
import { parseWatabouUrl } from '../../src/v2/externalCity/watabou';
import { decodeCityCode, cityCodeUrl } from '../../src/v2/cityCode';
import { regionalPopulation } from '../../src/v2/regionalPopulation';

// Shaped like Azgaar FMG's createWatabouCityLinks output.
const MFCG = 'https://watabou.github.io/city-generator/?name=Ostrava&population=5400&size=24&seed=1234560007&river=1&coast=1' + '&farms=1&citadel=1&urban_castle=0&hub=1&plaza=1&greens=1&temple=1&walls=1&shantytown=0&style=natural&sea=0.5';
const VILLAGE = 'https://watabou.github.io/village-generator/?pop=80&name=Brook&seed=987650012&width=400&height=195&style=snow' + '&tags=confluence,dead%20end,uncultivated,no%20square,palisade,sparse';

describe('watabou URLs', () => {
  it('reads an MFCG link', () => {
    expect(parseWatabouUrl(`  ${MFCG.slice(0, 60)}\n${MFCG.slice(60)}&preview=1 `)).toEqual({
      source: 'watabou-city',
      seed: 'mfcg-1234560007',
      name: 'Ostrava',
      population: 5400,
      river: 'river',
      coast: 'N',
      walls: true,
      citadel: true,
      urbanCastle: false,
      plaza: true,
      temple: true,
      shantytown: false,
      farms: true,
      roads: 4,
    });
  });
  it('approximates the population from the size', () => {
    const hints = parseWatabouUrl('https://watabou.github.io/city/?seed=7&size=24&coast=1&sea=1.5')!;
    expect(hints.coast).toBe('S');
    expect(hints.population).toBeGreaterThan(4000);
    expect(hints.population).toBeLessThan(8000);
  });
  it('reads a village link with tags', () => {
    expect(parseWatabouUrl(VILLAGE)).toEqual({ source: 'watabou-village', seed: 'village-987650012', name: 'Brook', population: 80, river: 'major', coast: 'none', roads: 1, walls: true, palisade: true, plaza: false, sprawl: 1.5, farms: false, biome: 'tundra' });
  });
  it('rejects other links', () => {
    expect(parseWatabouUrl('https://example.com/city-generator/?seed=1')).toBeNull();
    expect(parseWatabouUrl('https://watabou.github.io/dwellings/?seed=1')).toBeNull();
    expect(parseWatabouUrl('MU3.abc')).toBeNull();
  });
  it('decodes an MFCG link, directly or as a share link, into valid settings', () => {
    for (const input of [MFCG, cityCodeUrl(MFCG, 'https://example.org/v2.html')]) {
      const { settings, mods } = decodeCityCode(input);
      expect(mods).toEqual([]);
      expect(settings.options).toMatchObject({ seed: 'mfcg-1234560007', population: 5400, size: 'town', river: 'river', coast: 'N', walls: 'single', castle: 'yes', cathedral: 'yes', shantytowns: 'none', roads: 4, palace: 'auto' });
      expect(settings.naming?.places?.main).toBe('Ostrava');
      expect(settings.runtime?.autoBackend).toBe(true);
      // Only the imported town, with its population, on a map sized for it.
      expect(settings.extent).toBe(4000);
      expect(settings.region?.placement?.list).toEqual([expect.objectContaining({ key: 'main', name: 'Ostrava', population: 5400 })]);
      expect(regionalPopulation(settings).places.map(p => p.population)).toEqual([5400]);
    }
  });
});
