import { expect, it } from 'vitest';
import type { UrbanProgramme } from '../../rust/bridge/urban';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { programmeBalanceEvidence } from '../src/ui/urbanProgrammeEvidence';

const programme = (builtCapacity = 0): UrbanProgramme => ({
  demands: [{ id: 'homes', function: 'domestic', unit: 'domesticUnits', requested: 5, parcelCapacity: 5,
    builtCapacity, openCapacity: 0, deficit: 5 - builtCapacity }],
  allocations: [{ parcelId: 'parcel', demandId: 'homes', function: 'domestic' }],
} as UrbanProgramme);
const building = (): PlacedBuilding => ({ id: 'house', parcel_id: 'parcel', function: 'domestic',
  useful_area_m2: 45, domestic_units: 1, simplification: 'recipe_volumes' } as PlacedBuilding);
const scene = (buildings: PlacedBuilding[] = [building()]): PlacementBatch => ({ schema_version: '1',
  generator_version: 'houses-3', buildings, refusals: [], open_spaces: [] });

it('distinguishes an uncomputed zero, a coherent zero after refusal and a positive eager balance', () => {
  const p = programme();
  expect(programmeBalanceEvidence()(p)).toBe('not_calculated');
  expect(programmeBalanceEvidence(scene())(p)).toBe('unverified'); // Unreconciled programme beside an accepted house.
  expect(programmeBalanceEvidence(scene())(programme(1))).toBe('scene_consistent');
  const refused = scene([]); refused.refusals = [{ id: 'house', parcel_id: 'parcel', code: 'placement_refused', message: 'site', attempts: 1 }];
  expect(programmeBalanceEvidence(refused)(p)).toBe('scene_consistent');
  expect(programmeBalanceEvidence(scene([]))(p)).toBe('unverified'); // Missing result is not a refusal.
  expect(programmeBalanceEvidence()(programme(1))).toBe('unverified'); // History without its scene.
});

it('compact scenes remain uncomputed even when exterior/native objects exist, and replacement never retains evidence', () => {
  const eager = scene(), p = programme(1);
  expect(programmeBalanceEvidence(eager)(p)).toBe('scene_consistent');
  const compact = { ...eager, generator_version: 'architectural-plans-2' }; // Native-looking exterior cached in a compact scene.
  expect(programmeBalanceEvidence(compact)(p)).toBe('not_calculated');
  const mixedMarker = scene([{ ...building(), cartographic: { height_m: 4, ridges: [], validation: 'plan_only' } }]);
  expect(programmeBalanceEvidence(mixedMarker)(p)).toBe('not_calculated');
  expect(programmeBalanceEvidence()(p)).toBe('unverified');
  expect(programmeBalanceEvidence(eager)(p)).toBe('scene_consistent'); // Restore the actual matching scene.
  const checker = programmeBalanceEvidence(eager);
  expect(checker(programme())).toBe('unverified'); // updateProgrammes before/after replaceScene cannot bless stale totals.
  expect(checker(p)).toBe('scene_consistent');
});

it('checks matching identities and finite totals rather than native labels or refusal prose', () => {
  const p = programme(1);
  expect(programmeBalanceEvidence(scene([{ ...building(), parcel_id: 'different' }]))(p)).toBe('unverified');
  expect(programmeBalanceEvidence(scene([building(), building()]))(p)).toBe('unverified');
  expect(programmeBalanceEvidence(scene([{ ...building(), domestic_units: NaN }]))(p)).toBe('unverified');
  expect(programmeBalanceEvidence({ ...scene(), generator_version: 'unknown-native' })(p)).toBe('unverified');
  const changed = programme(1); changed.demands[0].deficit = 0;
  expect(programmeBalanceEvidence(scene())(changed)).toBe('unverified');
});
