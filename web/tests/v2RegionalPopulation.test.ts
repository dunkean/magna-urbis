import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { regionalPopulation, chooseIsolatedSites, automaticSettlementLimits, automaticIsolatedLimit } from '../src/v2/regionalPopulation';
import { effectiveRegion, validateRegionSettings } from '../src/v2/regionSettings';
import { encodeCityCode, decodeCityCode } from '../src/v2/cityCode';
import { rerollSettlement, urbanSeed, URBAN_SEED_STAGES } from '../src/v2/urbanSeeds';
import { stepSeed } from '../../rust/bridge/generationSeed';
import { resetRegionalChildren, resetUrbanChildren } from '../src/v2/generationEdits';

function region(culture = 'european-organic', climate = 'temperate', relief = 'flat') {
  const s = defaultSettings();
  s.extent = 40000;
  s.options.seed = '42';
  s.options.culture = culture;
  s.terrain!.climate = climate as NonNullable<typeof s.terrain>['climate'];
  s.terrain!.relief = relief as NonNullable<typeof s.terrain>['relief'];
  return s;
}
describe('regional population and distribution', () => {
  it('caps automatic 40 km settlements at 20,000 while keeping a rural hierarchy', () => {
    for (const culture of ['european-organic', 'american-grid']) {
      const s = region(culture),
        before = structuredClone(s),
        p = regionalPopulation(s);
      expect(p.places.every(place => place.population <= 20000)).toBe(true);
      expect(p.counts.village).toBeGreaterThan(0);
      expect(p.counts.hamlet).toBeGreaterThan(0);
      expect(p.counts.farmstead).toBeGreaterThan(0);
      expect(p.allocatedPopulation).toBe(p.population);
      expect(p.unallocated).toBe(0);
      expect(effectiveRegion(s).placement.list).toEqual(p.places);
      expect(s).toEqual(before);
      expect(regionalPopulation(decodeCityCode(encodeCityCode(s)).settings)).toEqual(p);
    }
  });
  it('resizes the automatic places for a typed population without changing their number', () => {
    for (const culture of ['european-organic', 'elven', 'halfling']) {
      const automatic = regionalPopulation(region(culture));
      const s = region(culture);
      s.region = { demography: { population: 10000 } };
      const plan = regionalPopulation(s);
      expect(plan.places).toHaveLength(automatic.places.length);
      expect(plan.places.length).toBeLessThanOrEqual(30);
      expect(plan.allocatedPopulation).toBe(10000);
      expect(regionalPopulation(decodeCityCode(encodeCityCode(s)).settings)).toEqual(plan);
      s.region.demography!.counts = { farmstead: 150, hamlet: 55 };
      expect(regionalPopulation(s).counts).toMatchObject({ farmstead: 150, hamlet: 55 });
    }
  });
  it('grows a larger settlement instead of bypassing rural limits for a small-place culture', () => {
    const s = region('inuit-camp');
    s.region = { demography: { population: 10000 } };
    const plan = regionalPopulation(s);
    expect(plan.allocatedPopulation).toBe(10000);
    expect(plan.places.length).toBeLessThanOrEqual(5);
    expect(Math.max(...plan.places.map(p => p.population))).toBeGreaterThan(9000);
  });
  it('bounds every automatic class by map surface and densifies larger settlements', () => {
    const s = region();
    s.extent = 10000;
    s.region = { demography: { population: 100000 } };
    const small = regionalPopulation(s),
      limits = automaticSettlementLimits(100, 100000);
    expect(small.counts.village).toBeLessThanOrEqual(2);
    expect(small.counts.hamlet).toBeLessThanOrEqual(1);
    expect(small.counts.farmstead).toBeLessThanOrEqual(1);
    expect(small.isolatedCount).toBeLessThanOrEqual(2);
    expect(small.allocatedPopulation).toBe(100000);
    s.region.demography!.population = 1000000;
    const dense = regionalPopulation(s);
    expect(dense.counts).toEqual(small.counts);
    expect(Math.max(...dense.places.map(p => p.population))).toBeGreaterThan(Math.max(...small.places.map(p => p.population)) * 5);
    expect(dense.allocatedPopulation).toBe(1000000);
    expect(dense.isolatedCount).toBeLessThanOrEqual(automaticIsolatedLimit(100));
    for (const id of Object.keys(limits) as (keyof typeof limits)[]) expect(dense.counts[id]).toBeLessThanOrEqual(limits[id]);
  });
  it('never lifts the small-place or isolated ceilings on a very large populated region', () => {
    const s = region();
    s.extent = 100000;
    s.region = { demography: { population: 100000000, isolatedDensity: 10 } };
    const p = regionalPopulation(s);
    expect(p.counts).toMatchObject({ village: 10, hamlet: 6, farmstead: 4 });
    expect(p.places.length).toBeLessThanOrEqual(60);
    expect(p.isolatedCount).toBeLessThanOrEqual(16);
    expect(p.allocatedPopulation).toBe(100000000);
    expect(Math.max(...p.places.map(s => s.population))).toBeGreaterThan(1000000);
    expect(regionalPopulation(decodeCityCode(encodeCityCode(s)).settings)).toEqual(p);
  });
  it('reports a population that cannot fit a surface ceiling instead of making more places', () => {
    const s = region();
    s.extent = 2400;
    s.region = { demography: { population: 100000000 } };
    const p = regionalPopulation(s);
    expect(p.counts).toEqual({ city: 1, town: 1, village: 1, hamlet: 1, farmstead: 1 });
    expect(p.unallocated).toBeGreaterThan(0);
    expect(p.allocatedPopulation + p.unallocated).toBe(p.population);
    expect(p.places.every(s => s.population <= 5000000)).toBe(true);
    s.region.demography!.counts = { city: 0, town: 0, village: 0, hamlet: 0, farmstead: 0 };
    expect(regionalPopulation(s).places).toEqual([]);
    expect(regionalPopulation(s).unallocated).toBe(100000000);
  });
  it('scales with area, environmental carrying density and culture instead of a principal settlement', () => {
    const s = region(),
      plain = regionalPopulation(s);
    s.extent = 10000;
    const ten = regionalPopulation(s);
    s.extent = 5000;
    expect(regionalPopulation(s).population).toBe(Math.round(ten.population / 4));
    const arctic = regionalPopulation(region('inuit-camp', 'arctic', 'high-mountains'));
    expect(arctic.population).toBeLessThan(plain.population / 50);
    expect(Math.max(0, ...arctic.places.map(p => p.population))).toBeLessThanOrEqual(120);
    expect(arctic.counts.city + arctic.counts.town + arctic.counts.village).toBe(0);
    const modern = regionalPopulation(region('american-grid'));
    expect(modern.population).toBeGreaterThan(plain.population);
    expect(Math.max(...modern.places.map(p => p.population))).toBeLessThanOrEqual(20000);
    expect(plain.allocatedPopulation).toBe(plain.population);
    expect(modern.allocatedPopulation).toBe(modern.population);
  });
  it('sends exactly the regional population as a list, with no extra mandatory town', () => {
    const s = region(),
      before = structuredClone(s),
      p = regionalPopulation(s),
      native = effectiveRegion(s).placement;
    expect(native.mode).toBe('list');
    expect(native.list).toHaveLength(p.places.length);
    expect(native.list.reduce((n, p) => n + p.population, 0)).toBe(p.population);
    expect(native.main.population).not.toBe(2500);
    expect(s).toEqual(before);
    expect(() => validateRegionSettings({ placement: native })).not.toThrow();
  });
  it('does not default isolated buildings to zero and honors an explicit zero', () => {
    const s = defaultSettings();
    expect(regionalPopulation(s).isolatedCount).toBeGreaterThan(0);
    s.region = { demography: { isolatedDensity: 0 } };
    expect(regionalPopulation(s).isolatedCount).toBe(0);
    s.region.demography = { isolatedCount: 7 };
    expect(regionalPopulation(s).isolatedCount).toBe(7);
    const sites = [
      { id: 'mill', residents: 0 },
      { id: 'quarry', residents: 0 },
      { id: 'farm', residents: 8 },
    ];
    expect(chooseIsolatedSites(sites, 0, '42')).toEqual([]);
    expect(
      chooseIsolatedSites(sites, 2, '42')
        .map(s => s.id)
        .sort(),
    ).toEqual(['mill', 'quarry']);
  });
  it('preserves each manual override, redistributes the budget and reports incompatible choices', () => {
    const s = region();
    s.region = { demography: { population: 5000, counts: { city: 0, town: 1 }, followCulture: false } };
    const p = regionalPopulation(s);
    expect(p.counts.town).toBe(1);
    expect(p.allocatedPopulation).toBe(5000);
    s.local.main = { population: 2300 };
    expect(regionalPopulation(s).places[0].population).toBe(2300);
    // The only town is fixed at 2,300; the automatic places keep their number and hold the rest.
    const fixed = regionalPopulation(s);
    expect(fixed.allocatedPopulation).toBe(5000);
    expect(fixed.allocatedPopulation + fixed.unallocated).toBe(5000);
    delete s.local.main;
    s.region.demography!.counts = { city: 1 };
    expect(regionalPopulation(s).unallocated).toBeLessThan(0);
    expect(() => validateRegionSettings({ demography: { population: -1 } })).toThrow();
    expect(() => validateRegionSettings({ demography: { counts: { village: 800, hamlet: 800 } } })).toThrow();
    expect(() => validateRegionSettings({ autoBuildPopulation: 5000 })).not.toThrow();
    expect(() => validateRegionSettings({ autoBuildPopulation: 8001 })).toThrow('Automatic small-place population');
  });
  it('keeps a few places on a harsh map, scaled by area, below a temperate one', () => {
    const alpine = (extent: number, culture = 'european-organic', climate = 'alpine', relief = 'high-mountains') => {
      const s = region(culture, climate, relief);
      s.extent = extent;
      return s;
    };
    const ten = regionalPopulation(alpine(10000));
    expect(ten.population).toBeGreaterThanOrEqual(300);
    expect(ten.population).toBeLessThanOrEqual(600);
    expect(ten.counts.village).toBeGreaterThanOrEqual(1);
    expect(ten.counts.hamlet + ten.counts.farmstead).toBeGreaterThanOrEqual(2);
    expect(ten.allocatedPopulation).toBe(ten.population);
    for (const [climate, relief] of [
      ['arctic', 'flat'],
      ['desert', 'canyon'],
      ['alpine', 'mountains'],
    ]) {
      const harsh = regionalPopulation(alpine(10000, 'european-organic', climate, relief));
      expect(harsh.population).toBeGreaterThanOrEqual(300);
      expect(harsh.counts.village).toBeGreaterThanOrEqual(1);
    }
    const small = regionalPopulation(alpine(2400));
    expect(small.counts.hamlet).toBeGreaterThanOrEqual(1);
    expect(small.population).toBeLessThan(300);
    const large = regionalPopulation(alpine(40000));
    expect(large.counts.town).toBeGreaterThanOrEqual(1);
    expect(large.counts.village).toBeGreaterThanOrEqual(3);
    expect(regionalPopulation(alpine(100000)).counts.town).toBeGreaterThanOrEqual(3);
    // Temperate stays the realistic estimate, well above the floor.
    for (const relief of ['flat', 'mountains']) {
      const temperate = regionalPopulation(alpine(10000, 'european-organic', 'temperate', relief));
      expect(temperate.population).toBe(Math.round(100 * 75 * temperate.environmentFactor));
      expect(temperate.population).toBeGreaterThan(ten.population);
    }
    expect(regionalPopulation(alpine(40000, 'european-organic', 'temperate', 'flat')).population).toBeGreaterThan(large.population * 10);
  });
  it('never applies the floor to a population, density or count the user chose', () => {
    const s = region('european-organic', 'alpine', 'high-mountains');
    s.extent = 10000;
    s.region = { demography: { population: 5 } };
    expect(regionalPopulation(s).population).toBe(5);
    s.region = { demography: { density: 0.05 } };
    expect(regionalPopulation(s).population).toBe(5);
    s.region = { demography: { counts: { village: 0, hamlet: 0, farmstead: 0 } } };
    expect(regionalPopulation(s).places).toEqual([]);
    expect(regionalPopulation(s).population).toBe(0);
  });
  it('derives the population from the places: adding a town adds its inhabitants', () => {
    const s = region('european-organic', 'alpine', 'high-mountains');
    s.extent = 10000;
    const before = regionalPopulation(s);
    s.region = { demography: { counts: { town: 1 } } };
    const after = regionalPopulation(s);
    expect(after.population).toBe(before.population + before.classSizes.town);
    expect(after.places).toHaveLength(before.places.length + 1);
    expect({ ...after.counts, town: 0 }).toEqual(before.counts);
    expect(after.allocatedPopulation).toBe(after.population);
  });
  it('allows a completely empty region and restores automatic choices after removing overrides', () => {
    const s = region();
    s.region = { demography: { density: 0 } };
    expect(regionalPopulation(s).places).toEqual([]);
    expect(effectiveRegion(s).placement.list).toEqual([]);
    delete s.region.demography!.density;
    expect(regionalPopulation(s).population).toBeGreaterThan(0);
  });
  it('reconstructs automatic inhabitants from MU3 without embedding the generated settlement list', () => {
    const s = region('american-grid'),
      code = encodeCityCode(s),
      restored = decodeCityCode(code).settings;
    expect(code).toMatch(/^MU3\./);
    expect(code.length).toBeLessThan(200);
    expect(regionalPopulation(restored)).toEqual(regionalPopulation(s));
    expect(restored.region?.placement?.list).toBeUndefined();
    s.region = { demography: { population: 555555, counts: { city: 2 }, isolatedDensity: 0.4, isolatedCount: 8, followCulture: false } };
    const chosen = decodeCityCode(encodeCityCode(s)).settings;
    expect(chosen.region?.demography).toEqual(s.region.demography);
    expect(regionalPopulation(chosen)).toEqual(regionalPopulation(s));
  });
  it('rerolls every stage of one settlement while preserving population, terrain and its neighbours', () => {
    const s = region(),
      population = regionalPopulation(s),
      seeds = URBAN_SEED_STAGES.map(stage => urbanSeed(s, 'main', stage)),
      neighbour = URBAN_SEED_STAGES.map(stage => urbanSeed(s, 'village-0', stage)),
      terrainSeed = stepSeed(s.options.seed, 'relief-noise');
    rerollSettlement(s, 'main');
    URBAN_SEED_STAGES.forEach((stage, i) => {
      expect(urbanSeed(s, 'main', stage)).not.toBe(seeds[i]);
      expect(urbanSeed(s, 'village-0', stage)).toBe(neighbour[i]);
    });
    expect(regionalPopulation(s)).toEqual(population);
    expect(stepSeed(s.options.seed, 'relief-noise')).toBe(terrainSeed);
    expect(regionalPopulation(decodeCityCode(encodeCityCode(s)).settings)).toEqual(population);
  });
  it('replaces lower-level cultural and building edits when a regional parent changes', () => {
    const s = region();
    s.local.main = { culture: 'medina', population: 5000 };
    s.urban = { layout: { culture: 'medina' }, local: { main: { layout: { culture: 'medina' }, parcels: { density: 2 } } }, buildings: { 'main/house': { culture: 'medina' } } };
    rerollSettlement(s, 'main');
    const terrain = stepSeed(s.options.seed, 'relief-noise');
    const mods = resetRegionalChildren(s, [{ type: 'building', settlement: 'main' }, { type: 'other' }]);
    expect(s.local).toEqual({});
    expect(s.urban?.local).toBeUndefined();
    expect(s.urban?.layout).toBeUndefined();
    expect(s.urban?.buildings).toBeUndefined();
    expect(mods).toEqual([{ type: 'other' }]);
    expect(stepSeed(s.options.seed, 'relief-noise')).toBe(terrain);
  });
  it('replaces block, parcel and building overrides when changing the parent parcel layout', () => {
    const s = region();
    s.urban = { local: { main: { parcels: { overrides: { blocks: { 'block:a': { density: 2 } }, parcels: { lot: { role: 'temple' } } } } }, east: { parcels: { density: 2 } } }, buildings: { 'main/house': { culture: 'medina' } } };
    resetUrbanChildren(s, { kind: 'settlement', key: 'main' }, 'parcels.operator');
    expect(s.urban.local!.main.parcels!.overrides).toEqual({});
    expect(s.urban.local!.east.parcels!.density).toBe(2);
    expect(s.urban.buildings!['main/house']).toBeUndefined();
  });
  it('resets only a chosen settlement’s descendants, retaining its current culture and its neighbours', () => {
    const s = region();
    s.local.main = { culture: 'medina' };
    s.urban = { local: { main: { layout: { culture: 'medina', overrides: { quarters: { '1': { density: 2 } } } }, parcels: { density: 2 } }, east: { layout: { culture: 'chinese' } } }, buildings: { 'main/house': { culture: 'medina' }, 'east/house': { culture: 'chinese' } } };
    resetUrbanChildren(s, { kind: 'settlement', key: 'main' }, 'layout.tissue');
    expect(s.local.main.culture).toBe('medina');
    expect(s.urban.local!.main.layout!.culture).toBe('medina');
    expect(s.urban.local!.main.parcels).toBeUndefined();
    expect(s.urban.local!.main.layout!.overrides?.quarters).toBeUndefined();
    expect(s.urban.local!.east.layout!.culture).toBe('chinese');
    expect(s.urban.buildings!['east/house']).toBeDefined();
    expect(s.urban.buildings!['main/house']).toBeUndefined();
  });
});
