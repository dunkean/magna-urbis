import { expect, it, vi } from 'vitest';
import frozen from './fixtures/programme-outcome-c1358.json';
import expected from './fixtures/programme-outcome-c1358-expected.json';
import type { PlacementBatch, PlacedBuilding, PlanProgrammeOutcome } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import { retainedProgrammeOutcome, programmeOutcomeRows, PROGRAMME_OUTCOME_SCOPE } from '../src/render/programmeOutcome';
import { projectNativeBuilding } from '../src/ui/urbanBuildingProjection';
import { describeUrbanBuilding } from '../src/render/buildingInspection';
import { beginUrbanBuildingStage, openUrbanBuildingChunks } from '../src/ui/urbanBuildingChunkStore';
import { ColdTestBackend } from './helpers/urbanBuildingColdTestBackend';
vi.mock('../src/ui/methodNotes', () => ({ openMethodNote: vi.fn() }));
vi.mock('../src/ui/benchHistory', () => ({ openBench: vi.fn() }));
vi.mock('../src/ui/cityShapeEditor', () => ({ ensureEditStyles: vi.fn() }));
import { urbanBuildingPanelProgrammeOutcomeHtml, urbanBuildingPanelCapacity } from '../src/ui/urbanBuildingsPanel';
import { renderCityInspector, type CityInspectorHooks } from '../src/ui/cityInspector';
import type { CityScene } from '../src/render/cityCanvas';

const old = frozen.retained_building as unknown as PlacedBuilding;
// Offline expected scalar fixture, not a compiled Rust/admission result. Root
// separately replays native planning before promoting production Rust.
const report = expected.programme_outcome as PlanProgrammeOutcome;
const selected = (): PlacedBuilding => ({ ...structuredClone(old), programme_outcome: structuredClone(report) });
const state = (building: PlacedBuilding) => ({ seed: 'same', visible: true,
  appearance: { style: 'cartographic' as const, diagnostic: 'none' as const },
  scene: { schema_version: '1' as const, generator_version: 'architectural-plans-2', buildings: [building], refusals: [], open_spaces: [] } });

it('displays C1358 native report scalars without crediting requested households or useful-area proxies', () => {
  const building = selected(), before = structuredClone(building), info = describeUrbanBuilding(building), html = urbanBuildingPanelProgrammeOutcomeHtml(building);
  expect(info.programmeOutcome).toEqual(report); expect(info.capacity).toEqual({ status: 'unknown', domesticUnits: null, usefulAreaM2: null });
  expect(html).toContain('617.90 m²'); expect(html).toContain('4.06 m²'); expect(html).toContain('613.84 m² / 0.00 m²');
  expect(html).toContain('Déficit hors tolérance de ±10 % d’emprise'); expect(html).toContain('<dd>3</dd>');
  expect(html).toContain('Ménages logés</dt><dd>Inconnus (capacité non évaluée)'); expect(html).toContain(PROGRAMME_OUTCOME_SCOPE);
  expect(urbanBuildingPanelCapacity(state(building), building)).toBe('capacité non évaluée'); expect(building).toEqual(before);
});

it('keeps old, absent and null reports unknown without deriving target from programme wishes, nominal values or DTOs', () => {
  const building = structuredClone(old) as PlacedBuilding & { programme?: { households: number; built_area_m2: number } };
  building.programme = { households: 999, built_area_m2: 2000 }; building.domestic_units = 999;
  expect(describeUrbanBuilding(building).programmeOutcome).toBeNull(); expect(projectNativeBuilding(building)).not.toHaveProperty('programme_outcome');
  const html = urbanBuildingPanelProgrammeOutcomeHtml(building);
  expect(html).toContain('Inconnue (rapport natif absent ou non reconnu)'); expect(html).not.toContain('2000'); expect(html).not.toContain('999');
  expect(html).toContain('Ménages logés</dt><dd>Inconnus');
  building.programme_outcome = null; expect(retainedProgrammeOutcome(building.programme_outcome)).toBeNull();
});

it('retains inclusive footprint tolerance and exact gaps inside it without calling the whole programme satisfied', () => {
  for (const [actual, attainment] of [[90, 'within_tolerance'], [110, 'within_tolerance'], [89, 'deficit'], [111, 'excess']] as const) {
    const value: PlanProgrammeOutcome = { ...report, body_footprint: { requested_m2: 100, actual_m2: actual, tolerance_fraction: .1,
      attainment, deficit_m2: Math.max(0, 100 - actual), excess_m2: Math.max(0, actual - 100) } };
    const normalized = retainedProgrammeOutcome(value); expect(normalized?.body_footprint).toEqual(value.body_footprint);
    const rows = programmeOutcomeRows(value); expect(rows.find(([label]) => label === 'Ménages logés')?.[1]).toBe('Inconnus (capacité non évaluée)');
    expect(rows.find(([label]) => label === 'Portée du bilan')?.[1]).toBe(PROGRAMME_OUTCOME_SCOPE);
    expect(rows.find(([label]) => label === 'Déficit / excès d’emprise')?.[1]).toBe(`${Math.max(0, 100 - actual).toFixed(2)} m² / ${Math.max(0, actual - 100).toFixed(2)} m²`);
  }
});

it('shows no requested target as unrequested, preserving actual final report and unknown household capacity', () => {
  const value: PlanProgrammeOutcome = { ...report, body_footprint: { requested_m2: null, actual_m2: 4.060225002401684, tolerance_fraction: .1,
    attainment: 'not_requested', deficit_m2: null, excess_m2: null }, households: { requested: null, housed: null, capacity_status: 'unknown' } };
  expect(retainedProgrammeOutcome(value)).toEqual(value); const rows = programmeOutcomeRows(value);
  expect(rows[0][1]).toBe('Non demandée'); expect(rows[1][1]).toBe('4.06 m²'); expect(rows[2][1]).toContain('Non applicable');
  expect(rows[4][1]).toBe('Non renseignés'); expect(rows[5][1]).toBe('Inconnus (capacité non évaluée)');
});

it('rejects unknown versions, invalid numbers, inconsistent reports and any claim to housed capacity', () => {
  const invalid = [undefined, null, {}, { ...report, version: 'future' },
    { ...report, body_footprint: { ...report.body_footprint, actual_m2: NaN } },
    { ...report, body_footprint: { ...report.body_footprint, requested_m2: 0 } },
    { ...report, body_footprint: { ...report.body_footprint, tolerance_fraction: .2 } },
    { ...report, body_footprint: { ...report.body_footprint, deficit_m2: 0 } },
    { ...report, body_footprint: { ...report.body_footprint, attainment: 'within_tolerance' } },
    { ...report, households: { ...report.households, housed: 3 } },
    { ...report, households: { ...report.households, capacity_status: 'known' } },
    { ...report, households: { ...report.households, requested: Infinity } }];
  for (const value of invalid) { expect(retainedProgrammeOutcome(value)).toBeNull(); expect(programmeOutcomeRows(value)[5][1]).toContain('Inconnus'); }
});

it('copies immutable scalar metadata into cold projection without reading archives, interiors, meshes or retaining unknown parent fields', () => {
  const building = selected(), value = building.programme_outcome!; let parentReads = 0;
  Object.defineProperty(value, 'parentPlacementBatch', { enumerable: true, get() { parentReads++; throw new Error('Parent graph must not be read.'); } });
  Object.defineProperty(building, 'resolved', { get() { throw new Error('Archive must not be read.'); } });
  for (const volume of building.volumes) for (const name of ['levels', 'roof_mesh']) Object.defineProperty(volume, name, { get() { throw new Error('Interior/mesh must not be read.'); } });
  const dto = projectNativeBuilding(building); expect(dto.programme_outcome).toEqual(report);
  // Vitest's .not.toBe(object) still deep-compares unequal objects to choose a
  // diagnostic suggestion. Compare the identity boolean, never the trapped input.
  expect(Object.is(dto.programme_outcome, value)).toBe(false);
  expect(Object.is(dto.programme_outcome?.body_footprint, value.body_footprint)).toBe(false);
  expect(Object.is(dto.programme_outcome?.households, value.households)).toBe(false);
  expect(parentReads).toBe(0);
  expect(Object.isFrozen(dto.programme_outcome)).toBe(true); expect(Object.isFrozen(dto.programme_outcome?.body_footprint)).toBe(true);
  expect(Object.isFrozen(dto.programme_outcome?.households)).toBe(true); expect(Object.hasOwn(dto.programme_outcome!, 'parentPlacementBatch')).toBe(false);
  value.body_footprint.requested_m2 = 1; expect(dto.programme_outcome?.body_footprint.requested_m2).toBe(617.9);
  for (const name of ['resolved', 'volumes', 'levels', 'roof_mesh', 'plan_archives', 'parentPlacementBatch']) expect(Object.hasOwn(dto, name)).toBe(false);
});

it('preserves optional metadata through actual archive/store/selection/projection while old archives stay unmodified', async () => {
  const building = selected(), batch: PlacementBatch = { schema_version: '1', generator_version: 'architectural-plans-2', buildings: [building], refusals: [], open_spaces: [] };
  const archived = await archivePlanBatch(batch), backend = new ColdTestBackend();
  const stage = await beginUrbanBuildingStage(backend, { sceneId: 'outcome-test', sourceFingerprint: frozen.source_input_sha256, totalRequests: 1 });
  await stage.append(archived, { start: 0, completed: 1, total: 1 }); await stage.commit();
  const reader = await openUrbanBuildingChunks(backend, 'outcome-test'), read = await reader.readBuilding(building.id);
  expect(read?.building.programme_outcome).toEqual(report); expect(read?.scene.buildings).toHaveLength(1);
  expect(projectNativeBuilding(read!.building).programme_outcome).toEqual(report);
  expect(await resolveArchivedPlan(read!.building, read!.scene)).toEqual(old.resolved);
  expect(old).not.toHaveProperty('programme_outcome');
});

it('uses the report in the real city inspector HTML while independently retaining unknown plan capacity', () => {
  // Rendering sink only: DOM bindings are deliberately not a browser test.
  const host = { innerHTML: '', querySelectorAll: () => [] } as unknown as HTMLElement;
  const hooks: CityInspectorHooks = { edits: () => ({ quarters: {}, parcels: {}, buildings: {} }), cultures: {}, tissues: {},
    houseLocked: () => 'Lecture seule', styles: () => undefined, loadStyles: async () => undefined,
    editQuarter() {}, editLot() {}, editHouse: async () => undefined, editShape() {}, structuralLocked: () => 'Lecture seule', warnings: () => [], echoed: () => undefined };
  renderCityInspector(host, { built: selected() }, { layouts: [] } as unknown as CityScene, hooks);
  expect(host.innerHTML).toContain('617.90 m²'); expect(host.innerHTML).toContain('613.84 m²');
  expect(host.innerHTML).toContain('Ménages logés</dt><dd>Inconnus (capacité non évaluée)');
  expect(host.innerHTML).toContain('inconnue (plan sans intérieur)'); expect(host.innerHTML).toContain(PROGRAMME_OUTCOME_SCOPE);
});
