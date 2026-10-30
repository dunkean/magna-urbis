import { expect, it } from 'vitest';
import { defaultProgrammeContext } from '../../rust/bridge/urbanConfig';
import type { UrbanProgramme } from '../../rust/bridge/urban';
import { citySummaryHtml, citySupport } from '../src/ui/urbanCitySummary';
import { programmeTokenRows, PROGRAMME_TOKEN_SUGGESTIONS } from '../src/ui/urbanProgrammeTokens';

const programme = (): UrbanProgramme => ({
  version: 1, population: 600, context: { ...defaultProgrammeContext(), functions: { port: 1, capital: .5 } },
  cultures: [{ culture: 'european-organic', family: 'f', functionalProfile: 'p', architectureFamily: 'a', architecturePack: 'pack-eu', coverage: 'c', borrowing: '', admissibility: {} as never }],
  demands: [
    { id: 'k/demand/domestic', function: 'domestic', unit: 'domesticUnits', requested: 100, targetArea: 0, targetFrontage: 4, provenance: ['population:600; profile:5 persons/domesticUnit'], requires: [], parcelCapacity: 80, builtCapacity: 0, deficit: 100, reasons: [] },
    { id: 'k/demand/warehouse', function: 'warehouse', unit: 'usefulAreaM2', requested: 1200, targetArea: 1200, targetFrontage: 9, provenance: [], requires: ['navigableAccess'], parcelCapacity: 0, builtCapacity: 0, deficit: 1200, reasons: [] },
  ],
  reservations: [], allocations: [], adjacency: [], environment: [{ block: 0, slope: 0, wet: false, waterfront: true }, { block: 1, slope: 0, wet: false, waterfront: false }],
  reconciliationPasses: 0, warnings: ['Fonction portuaire demandée sans rive navigable mesurée'], housingCapacity: 90, navigableFrontage: false,
});

it('summarises requested, resolved and supported without crediting unknown housing', () => {
  const p = programme();
  const support = citySupport(p);
  expect(support).toMatchObject({ need: 100, land: 90, parcels: 80, known: undefined, deficit: 100, size: 5 });
  const html = citySummaryHtml({ population: 600, programme: p, layout: { archetype: 'market-town', culture: 'european-organic', warnings: [],
    phases: [{ culture: 'european-organic', kind: 'k', zone: 'core', recipe: 'r1', population: 600, targetArea: 0, shapes: [] }] } });
  for (const key of ['population', 'intent', 'functions', 'form', 'grammar', 'cultures', 'phases', 'footprint', 'site', 'substitutions', 'need', 'land', 'buildings', 'housed', 'deficit'])
    expect(html, key).toContain(`data-summary="${key}"`);
  expect(html).toContain('pack-eu');
  expect(html).toContain('1/2');
  expect(html).toContain('rive navigable mesurée');
});

it('suggests only consumed tokens, keeps unknown ones without effect and applies the first recognised lore entry', () => {
  expect(PROGRAMME_TOKEN_SUGGESTIONS.resources).not.toContain('grain');
  expect(programmeTokenRows('resources', ['grain', 'ore']).map(r => r.status)).toEqual(['unknown', 'applied']);
  expect(programmeTokenRows('lore', ['dragons', 'palace', 'temple']).map(r => r.status)).toEqual(['unknown', 'applied', 'ignored']);
});
