import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { regionalPopulation } from '../src/v2/regionalPopulation';
import { editRegionalPopulation } from '../src/v2/regionalPopulationEdits';
import { encodeCityCode, decodeCityCode } from '../src/v2/cityCode';

describe('regional population controls', () => {
  it('pins only the class being edited instead of freezing every displayed count', () => {
    const s=defaultSettings();s.extent=40000;
    editRegionalPopulation(s,'village',3);
    expect(s.region?.demography?.counts).toEqual({village:3});
    editRegionalPopulation(s,'hamlet',0);
    expect(s.region?.demography?.counts).toEqual({village:3,hamlet:0});
    editRegionalPopulation(s,'village',undefined);
    expect(s.region?.demography?.counts).toEqual({hamlet:0});
  });
  it('recomputes distribution and density when population replaces old fixed counts', () => {
    const s=defaultSettings();s.extent=40000;s.options.culture='european-organic';
    s.terrain!.climate='temperate';s.terrain!.relief='flat';
    s.region={demography:{density:2,counts:{city:0,town:0,village:100,hamlet:55,farmstead:150},isolatedCount:300,followCulture:false},placement:{mode:'counts',counts:{village:100}}};
    editRegionalPopulation(s,'population',10000);
    const small=regionalPopulation(s);
    expect(s.region.demography).toEqual({population:10000,followCulture:false});
    expect(s.region.placement?.counts).toBeUndefined();
    expect(small.places).toHaveLength(5);expect(small.density).toBe(10000/1600);
    editRegionalPopulation(s,'population',100000);
    const large=regionalPopulation(s);
    expect(large.counts).not.toEqual(small.counts);
    expect(large.allocatedPopulation).toBe(100000);expect(large.density).toBe(100000/1600);
    expect(large.isolatedCount).toBe(10);
    expect(regionalPopulation(decodeCityCode(encodeCityCode(s)).settings)).toEqual(large);
  });
  it('uses the most recently edited density instead of keeping the previous explicit population', () => {
    const s=defaultSettings();s.extent=10000;
    editRegionalPopulation(s,'population',100000);
    editRegionalPopulation(s,'density',100);
    expect(s.region?.demography?.population).toBeUndefined();
    expect(regionalPopulation(s).population).toBe(10000);
    editRegionalPopulation(s,'population',20000);
    expect(s.region?.demography?.density).toBeUndefined();
    expect(regionalPopulation(s).density).toBe(200);
  });
  it('returns a manual list to automatic distribution and lets isolated density control its count', () => {
    const s=defaultSettings();s.region={placement:{list:[{key:'main',name:'Pinned',population:100,culture:'elven',siteType:'auto',sitePrefs:{}}]},demography:{isolatedCount:99}};
    editRegionalPopulation(s,'population',5000);
    expect(s.region.placement).toEqual({mode:'auto'});
    editRegionalPopulation(s,'isolatedCount',99);
    editRegionalPopulation(s,'isolatedDensity',0);
    expect(s.region.demography?.isolatedCount).toBeUndefined();
    expect(regionalPopulation(s).isolatedCount).toBe(0);
  });
});
