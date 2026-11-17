import { describe, expect, it } from 'vitest';
import { localFacts, localFactsHtml, type LocalFactsInput } from '../../src/v2/localFacts';

const box = (x: number, size = 10) => ({ outer: [{ x, y: 0 }, { x: x + size, y: 0 }, { x: x + size, y: size }, { x, y: size }], holes: [] });
function fixture(): LocalFactsInput {
  return {
    settlement: { key: 'main', population: 100, culture: 'european-organic', archetype: 'plain' },
    urban: { footprint: [box(0, 40).outer], footprintH: [box(0, 40)], culture: 'european-organic', population: 100, morphology: 'organic',
      quarters: [0, 1].map(i => ({ nativeId: String(i), poly: box(i * 20), phase: i, zone: 'village' })),
      blocks: [box(0).outer, box(20).outer],
      parcels: [0, 1].map(i => ({ nativeId: `p${i}`, poly: box(i * 20).outer, block: i, use: 'plot' })), buildings: [],
    },
    native: { stage: 'buildings', backend: 'rust-native-cpu', warnings: ['City warning <unsafe>'], lastBuildingRequests: 2,
      layouts: [{ culture: 'european-organic', quarters: [0, 1].map(i => ({ shape: box(i * 20), phase: i })),
        phases: [{ culture: 'first' }, { culture: 'second' }], blocks: [0, 1].map(i => ({ quarter: i, shape: box(i * 20) })), warnings: [] }],
      partitions: [{ parcels: [0, 1].map(i => ({ id: `p${i}`, block: i, shape: box(i * 20), use: 'plot' })), warnings: [],
        programme: { demands: [{ unit: 'domesticUnits', requested: 20, deficit: 19, provenance: ['profile:5 persons/domesticUnit'] }], warnings: [],
          allocations: [{ parcelId: 'p0', unit: 'domesticUnits', households: 1, capacity: 1 }, { parcelId: 'p1', unit: 'usefulAreaM2', households: 0, capacity: 200 }] } }],
      scene: { buildings: [{ id: 'home', parcel_id: 'p0', function: 'domestic', footprint: [box(0, 4)] },
        { id: 'hall', parcel_id: 'p1', function: 'collective', footprint: [box(20, 5)] }],
        refusals: [{ id: 'refused', parcel_id: 'p1', code: 'shape', message: 'Cannot fit <house>' }], open_spaces: [{ parcel_id: 'p1' }] },
    },
  } as unknown as LocalFactsInput;
}

describe('local facts from retained generation', () => {
  it('counts a civic building separately from residential buildings and households', () => {
    expect(localFacts(fixture())).toMatchObject({ buildings: 2, residentialBuildings: 1, households: 1,
      householdSize: 5, parcels: 2, blocks: 2, quarters: 2, footprint: 41, footprintComponents: 2, requestedHouseholds: 20 });
  });
  it('limits a quarter to its own cadastral parcels, buildings and refusals', () => {
    const input = fixture(); input.selection = { kind: 'quarter', index: 0 };
    expect(localFacts(input)).toMatchObject({ buildings: 1, residentialBuildings: 1, households: 1, parcels: 1, blocks: 1,
      area: 100, footprint: 16, culture: 'first', refusals: [], openSpaces: 0, requestedHouseholds: undefined });
    input.selection.index = 1;
    expect(localFacts(input)).toMatchObject({ buildings: 1, residentialBuildings: 0, households: 0, culture: 'second', openSpaces: 1 });
    expect(localFacts(input).refusals).toHaveLength(1);
  });
  it('does not expose cached downstream counts before those stages are applied', () => {
    const input = fixture(); input.native!.stage = 'layout';
    expect(localFacts(input)).toMatchObject({ buildings: undefined, parcels: undefined, households: undefined, footprint: undefined, refusals: undefined });
  });
  it('keeps parcels visible when their full native partition is held by the engine', () => {
    const input = fixture(); input.native!.partitions = [];
    expect(localFacts(input)).toMatchObject({ parcels: 2, households: undefined, uses: ['plot', 'plot'] });
  });
  it('escapes engine messages and retains their full text in the report', () => {
    const html = localFactsHtml(fixture());
    expect(html).toContain('City warning &lt;unsafe&gt;');
    expect(html).toContain('Cannot fit &lt;house&gt;');
    expect(html).not.toContain('<unsafe>');
  });
  it('shows missing generation as unavailable instead of a fictitious zero', () => {
    expect(localFacts({ settlement: fixture().settlement })).toMatchObject({ buildings: undefined, blocks: undefined, parcels: undefined, area: undefined });
  });
});
