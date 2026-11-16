import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { regionalPopulation, chooseIsolatedSites } from '../src/v2/regionalPopulation';
import { effectiveRegion, validateRegionSettings } from '../src/v2/regionSettings';
import { encodeCityCode, decodeCityCode } from '../src/v2/cityCode';
import { rerollSettlement, urbanSeed, URBAN_SEED_STAGES } from '../src/v2/urbanSeeds';
import { stepSeed } from '../../rust/bridge/generationSeed';
import { resetRegionalChildren, resetUrbanChildren } from '../src/v2/generationEdits';

function region(culture='european-organic',climate='temperate',relief='flat') {
  const s=defaultSettings();s.extent=40000;s.options.seed='42';s.options.culture=culture;
  s.terrain!.climate=climate as NonNullable<typeof s.terrain>['climate'];s.terrain!.relief=relief as NonNullable<typeof s.terrain>['relief'];return s;
}
describe('regional population and distribution',()=>{
  it('scales with area, environmental carrying density and culture instead of a principal settlement',()=>{
    const s=region(),plain=regionalPopulation(s);s.extent=20000;
    expect(regionalPopulation(s).population).toBe(plain.population/4);
    const arctic=regionalPopulation(region('inuit-camp','arctic','high-mountains'));
    expect(arctic.population).toBeLessThan(20);expect(Math.max(0,...arctic.places.map(p=>p.population))).toBeLessThanOrEqual(120);
    expect(arctic.counts.city+arctic.counts.town+arctic.counts.village).toBe(0);
    const modern=regionalPopulation(region('american-grid'));
    expect(modern.population).toBeGreaterThan(plain.population*10);expect(Math.max(...modern.places.map(p=>p.population))).toBeGreaterThan(100000);
    expect(plain.allocatedPopulation).toBe(plain.population);expect(modern.allocatedPopulation).toBe(modern.population);
  });
  it('sends exactly the regional population as a list, with no extra mandatory town',()=>{
    const s=region(),before=structuredClone(s),p=regionalPopulation(s),native=effectiveRegion(s).placement;
    expect(native.mode).toBe('list');expect(native.list).toHaveLength(p.places.length);
    expect(native.list.reduce((n,p)=>n+p.population,0)).toBe(p.population);
    expect(native.main.population).not.toBe(2500);expect(s).toEqual(before);
    expect(()=>validateRegionSettings({placement:native})).not.toThrow();
  });
  it('does not default isolated buildings to zero and honors an explicit zero',()=>{
    const s=defaultSettings();expect(regionalPopulation(s).isolatedCount).toBeGreaterThan(0);
    s.region={demography:{isolatedDensity:0}};expect(regionalPopulation(s).isolatedCount).toBe(0);
    s.region.demography={isolatedCount:7};expect(regionalPopulation(s).isolatedCount).toBe(7);
    const sites=[{id:'mill',residents:0},{id:'quarry',residents:0},{id:'farm',residents:8}];
    expect(chooseIsolatedSites(sites,0,'42')).toEqual([]);
    expect(chooseIsolatedSites(sites,2,'42').map(s=>s.id).sort()).toEqual(['mill','quarry']);
  });
  it('preserves each manual override, redistributes the budget and reports incompatible choices',()=>{
    const s=region();s.region={demography:{population:5000,counts:{city:0,town:1},followCulture:false}};
    const p=regionalPopulation(s);expect(p.counts.town).toBe(1);expect(p.allocatedPopulation).toBe(5000);
    s.local.main={population:2300};expect(regionalPopulation(s).places[0].population).toBe(2300);
    expect(regionalPopulation(s).allocatedPopulation).toBe(5000);
    delete s.local.main;s.region.demography!.counts={city:1};expect(regionalPopulation(s).unallocated).toBeLessThan(0);
    expect(()=>validateRegionSettings({demography:{population:-1}})).toThrow();
    expect(()=>validateRegionSettings({demography:{counts:{village:800,hamlet:800}}})).toThrow();
  });
  it('allows a completely empty region and restores automatic choices after removing overrides',()=>{
    const s=region();s.region={demography:{density:0}};
    expect(regionalPopulation(s).places).toEqual([]);expect(effectiveRegion(s).placement.list).toEqual([]);
    delete s.region.demography!.density;expect(regionalPopulation(s).population).toBeGreaterThan(0);
  });
  it('reconstructs automatic inhabitants from MU3 without embedding the generated settlement list',()=>{
    const s=region('american-grid'),code=encodeCityCode(s),restored=decodeCityCode(code).settings;
    expect(code).toMatch(/^MU3\./);expect(code.length).toBeLessThan(200);
    expect(regionalPopulation(restored)).toEqual(regionalPopulation(s));
    expect(restored.region?.placement?.list).toBeUndefined();
    s.region={demography:{population:555555,counts:{city:2},isolatedDensity:.4,isolatedCount:8,followCulture:false}};
    const chosen=decodeCityCode(encodeCityCode(s)).settings;
    expect(chosen.region?.demography).toEqual(s.region.demography);expect(regionalPopulation(chosen)).toEqual(regionalPopulation(s));
  });
  it('rerolls every stage of one settlement while preserving population, terrain and its neighbours',()=>{
    const s=region(),population=regionalPopulation(s),seeds=URBAN_SEED_STAGES.map(stage=>urbanSeed(s,'main',stage)),neighbour=URBAN_SEED_STAGES.map(stage=>urbanSeed(s,'village-0',stage)),terrainSeed=stepSeed(s.options.seed,'relief-noise');
    rerollSettlement(s,'main');
    URBAN_SEED_STAGES.forEach((stage,i)=>{expect(urbanSeed(s,'main',stage)).not.toBe(seeds[i]);expect(urbanSeed(s,'village-0',stage)).toBe(neighbour[i]);});
    expect(regionalPopulation(s)).toEqual(population);expect(stepSeed(s.options.seed,'relief-noise')).toBe(terrainSeed);
    expect(regionalPopulation(decodeCityCode(encodeCityCode(s)).settings)).toEqual(population);
  });
  it('replaces lower-level cultural and building edits when a regional parent changes',()=>{
    const s=region();s.local.main={culture:'medina',population:5000};s.urban={layout:{culture:'medina'},local:{main:{layout:{culture:'medina'},parcels:{density:2}}},buildings:{'main/house':{culture:'medina'}}};
    rerollSettlement(s,'main');const terrain=stepSeed(s.options.seed,'relief-noise');
    const mods=resetRegionalChildren(s,[{type:'building',settlement:'main'},{type:'other'}]);
    expect(s.local).toEqual({});expect(s.urban?.local).toBeUndefined();expect(s.urban?.layout).toBeUndefined();expect(s.urban?.buildings).toBeUndefined();
    expect(mods).toEqual([{type:'other'}]);expect(stepSeed(s.options.seed,'relief-noise')).toBe(terrain);
  });
  it('resets only a chosen settlement’s descendants, retaining its current culture and its neighbours',()=>{
    const s=region();s.local.main={culture:'medina'};s.urban={local:{main:{layout:{culture:'medina',overrides:{quarters:{'1':{density:2}}}},parcels:{density:2}},east:{layout:{culture:'chinese'}}},buildings:{'main/house':{culture:'medina'},'east/house':{culture:'chinese'}}};
    resetUrbanChildren(s,{kind:'settlement',key:'main'},'layout.tissue');
    expect(s.local.main.culture).toBe('medina');expect(s.urban.local!.main.layout!.culture).toBe('medina');expect(s.urban.local!.main.parcels).toBeUndefined();expect(s.urban.local!.main.layout!.overrides?.quarters).toBeUndefined();
    expect(s.urban.local!.east.layout!.culture).toBe('chinese');expect(s.urban.buildings!['east/house']).toBeDefined();expect(s.urban.buildings!['main/house']).toBeUndefined();
  });
});
