import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cityReachedPopulation, populationShortfallText, populationText } from '../src/render/cityPopulation';
import type { UrbanProgramme } from '../../rust/bridge/urban';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';

const programme = { demands: [{ id: 'd', unit: 'domesticUnits', requested: 100, provenance: ['profile:5 persons/domesticUnit'] }],
  allocations: [1, 2, 3, 4].map(i => ({ parcelId: `p${i}`, demandId: 'd', unit: 'domesticUnits', function: 'domestic', households: i === 4 ? 40 : 20, capacity: 0 })) } as unknown as UrbanProgramme;
const scene = (ids: string[]) => ({ buildings: ids.map(id => ({ parcel_id: id, function: 'domestic' })) }) as unknown as PlacementBatch;

describe('reached population', () => {
  it('keeps the target before any building exists', () => {
    expect(cityReachedPopulation(500, [programme], undefined)).toBeUndefined();
    expect(populationText(500, undefined)).toBe('500 inh.');
  });
  it('counts the households of built parcels and reports the shortfall', () => {
    const r = cityReachedPopulation(500, [programme], scene(['p1', 'p2', 'p3']))!;
    expect(r).toMatchObject({ reached: 300, shortfallHouseholds: 40, shortfall: 200 });
    expect(populationText(500, r)).toBe('300 inh. (target 500)');
    expect(populationText(500, r, { t: x => x.replace('inh.', 'hab.').replace('target', 'cible') })).toBe('300 hab. (cible 500)');
    expect(populationShortfallText(r)).toContain('40 households');
  });
  it('shows only the reached number when equal, without a shortfall line', () => {
    const r = cityReachedPopulation(500, [programme], scene(['p1', 'p2', 'p3', 'p4']))!;
    expect(populationText(500, r)).toBe('500 inh.');
    expect(populationShortfallText(r)).toBe('');
  });
  it('is shared by the V2 and City Bench', () => {
    for (const file of ['src/v2/main.ts', 'src/ui/urbanCitySummary.ts']) expect(readFileSync(file, 'utf8')).toContain('cityReachedPopulation');
  });
});
