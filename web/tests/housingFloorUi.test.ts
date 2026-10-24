import { expect, it, vi } from 'vitest';
import actual from './fixtures/housing-floor-java-ui-native.json';
import oldFixture from './fixtures/programme-outcome-c1358.json';
import type { HousingFloorOutcome, PlacementBatch, PlacedBuilding, PlanProgrammeOutcome } from '../../rust/bridge/urbanArchitecture';
import { archivePlanBatch } from '../../rust/bridge/compactPlanArchive';
import { retainedProgrammeOutcome, retainedHousingFloorOutcome, programmeOutcomeRows } from '../src/render/programmeOutcome';
import { retainedBodyInventory, retainedBodyInventoryRows } from '../src/render/retainedBuildingInventory';
import { projectNativeBuilding } from '../src/ui/urbanBuildingProjection';
import { beginUrbanBuildingStage, exportUrbanBuildingChunks, importUrbanBuildingChunks, openUrbanBuildingChunks } from '../src/ui/urbanBuildingChunkStore';
import { openDerivedCache, DERIVED_VISUAL_VERSION } from '../src/ui/urbanBuildingDerivedCache';
import { repairColdDerivedCache } from '../src/ui/urbanColdDerivedRepair';
import { openColdVisualSource } from '../src/ui/urbanColdVisualWindow';
import { DerivedTestBackend } from './helpers/urbanDerivedTestBackend';
vi.mock('../src/ui/methodNotes', () => ({ openMethodNote: vi.fn() }));
vi.mock('../src/ui/benchHistory', () => ({ openBench: vi.fn() }));
vi.mock('../src/ui/cityShapeEditor', () => ({ ensureEditStyles: vi.fn() }));
import { urbanBuildingPanelProgrammeOutcomeHtml } from '../src/ui/urbanBuildingsPanel';
import { renderCityInspector, type CityInspectorHooks } from '../src/ui/cityInspector';
import type { CityScene } from '../src/render/cityCanvas';

const buildings = actual.buildings as unknown as PlacedBuilding[];
const selected = (i = 0) => structuredClone(buildings[i]);
const floor = (b: PlacedBuilding) => b.programme_outcome!.housing_floor!;
const rows = (b: PlacedBuilding) => Object.fromEntries(programmeOutcomeRows(b.programme_outcome));
const hooks: CityInspectorHooks = { edits: () => ({ quarters: {}, parcels: {}, buildings: {} }), cultures: {}, tissues: {},
  houseLocked: () => 'Lecture seule', styles: () => undefined, loadStyles: async () => undefined,
  editQuarter() {}, editLot() {}, editHouse: async () => undefined, editShape() {}, structuralLocked: () => 'Lecture seule', warnings: () => [], echoed: () => undefined };

it('keeps the actually measured Java housing report and immutable recorded model in real UI consumers', () => {
  for (const b of buildings) {
    const before = JSON.stringify(b), report = b.programme_outcome!, value = floor(b);
    const retained = retainedProgrammeOutcome(report)!;
    expect(retained).toEqual(report);
    expect(Object.is(retained.housing_floor, value)).toBe(false);
    expect(Object.is(retained.housing_floor?.need_model, value.need_model)).toBe(false);
    expect(Object.isFrozen(retained.housing_floor?.need_model.model)).toBe(true);
    const visible = rows(b);
    expect(visible['Surface brute mesurée (niveaux des corps)']).toBe(`${value.gross_floor_m2!.toFixed(2)} m²`);
    expect(visible['Besoin utile indicatif (modèle)']).toBe(`${value.requested_useful_m2.toFixed(2)} m²`);
    expect(visible['Provenance / calibration du modèle']).toContain('generic-compatibility-defaults');
    expect(visible['Provenance / calibration du modèle']).toContain('modèle de jeu non calibré culturellement');
    expect(visible['Richesse / facteur / besoin unitaire appliqués']).toContain(String(value.need_model.model.wealth_factor));
    expect(visible['Hypothèses enregistrées du modèle']).toContain('4.5 personnes/ménage (hypothèse)');
    expect(visible['Capacité résidentielle certifiée']).toContain('Inconnue');
    const panel = urbanBuildingPanelProgrammeOutcomeHtml(b);
    expect(panel).toContain(value.need_model.version); expect(panel).toContain(value.version);
    expect(panel).toContain('Surface brute mesurée'); expect(panel).toContain('Niveaux enregistrés par corps');
    const host = { innerHTML: '', querySelectorAll: () => [] } as unknown as HTMLElement;
    renderCityInspector(host, { built: b }, { layouts: [] } as unknown as CityScene, hooks);
    expect(host.innerHTML).toContain('Besoin utile indicatif'); expect(host.innerHTML).toContain(value.gross_floor_m2!.toFixed(2));
    expect(host.innerHTML).toContain('Grammaire native résolue'); expect(host.innerHTML).toContain('non exposée dans le bilan natif');
    expect(JSON.stringify(b)).toBe(before);
  }
});

it('does not infer housing models or composition for old imports from current controls, catalogue or legacy area scalars', () => {
  const old = structuredClone(oldFixture.retained_building) as unknown as PlacedBuilding & { programme?: unknown };
  old.programme = { composition: 'compound', households: 999, housing_floor_need: floor(buildings[0]).need_model };
  old.useful_area_m2 = 999999; old.domestic_units = 999;
  expect(retainedProgrammeOutcome(old.programme_outcome)).toBeNull();
  expect(rows(old)['Besoin utile indicatif (modèle)']).toBe('Inconnu');
  expect(urbanBuildingPanelProgrammeOutcomeHtml(old)).not.toContain('999');
  expect(retainedBodyInventoryRows(old)[0][1]).toContain('non archivée');
  // A changed current/source-side preference is deliberately not a retained
  // requested/resolved composition contract for an old native plan.
  expect(retainedBodyInventoryRows(old)[0][1]).not.toContain('compound');
  expect(projectNativeBuilding(old)).not.toHaveProperty('programme_outcome');
});

it('retains housing data even when footprint target was unrequested, and keeps malformed housing independently unknown', () => {
  const b = selected(), good = b.programme_outcome!;
  const withoutTarget: PlanProgrammeOutcome = { ...good, body_footprint: { requested_m2: null, actual_m2: good.body_footprint.actual_m2,
    tolerance_fraction: .1, attainment: 'not_requested', deficit_m2: null, excess_m2: null } };
  expect(retainedProgrammeOutcome(withoutTarget)?.housing_floor).toEqual(good.housing_floor);
  const value = floor(b);
  const bad: unknown[] = [null, {}, { ...value, version: 'future' }, { ...value, gross_floor_m2: NaN },
    { ...value, useful_shortfall_lower_bound_m2: 0 }, { ...value, actual_useful_m2: 100 },
    { ...value, functional_certification: 'certified' }, { ...value, requested_useful_m2: 0 },
    { ...value, need_model: { ...value.need_model, version: 'future-model' } },
    { ...value, need_model: { ...value.need_model, model: { ...value.need_model.model, wealth: 2 } } },
    { ...value, need_model: { ...value.need_model, model: { ...value.need_model.model, persons_per_household: Infinity } } },
    { ...value, need_model: { ...value.need_model, model: { ...value.need_model.model, effective_floor_m2_per_household: 5 } } },
    { ...value, requested_useful_m2: 1e308, need_model: { ...value.need_model, requested_m2: 1e308, allocated_households: 4,
      model: { ...value.need_model.model, floor_m2_per_household: 1e308, effective_floor_m2_per_household: 1e308 } } }];
  for (const housing of bad) {
    expect(retainedHousingFloorOutcome(housing)).toBeNull();
    const retained = retainedProgrammeOutcome({ ...good, housing_floor: housing });
    expect(retained?.body_footprint).toEqual(good.body_footprint);
    expect(retained).not.toHaveProperty('housing_floor');
    expect(Object.fromEntries(programmeOutcomeRows({ ...good, housing_floor: housing }))['Surface brute mesurée (niveaux des corps)']).toBe('Inconnue');
  }
});

it('preserves unknown inventories and never turns sufficient gross or a rounded tiny shortfall into capacity', () => {
  const b = selected(), value = floor(b);
  const unknown: HousingFloorOutcome = { ...value, gross_floor_m2: null, inventory_status: 'unknown', inventory_limitation: 'Original retained reason',
    necessary_area_status: 'unknown', useful_shortfall_lower_bound_m2: null };
  expect(retainedHousingFloorOutcome(unknown)).toEqual(unknown);
  b.programme_outcome!.housing_floor = unknown;
  expect(rows(b)['Inventaire et périmètre du bilan utile/brut']).toContain('Original retained reason');
  const enough: HousingFloorOutcome = { ...value, gross_floor_m2: value.requested_useful_m2 + 10,
    necessary_area_status: 'not_disproved_by_gross', useful_shortfall_lower_bound_m2: 0 };
  b.programme_outcome!.housing_floor = enough;
  expect(rows(b)['Comparaison utile indicatif / brut']).toContain('capacité toujours inconnue');
  const gross = value.requested_useful_m2 - .0001;
  b.programme_outcome!.housing_floor = { ...value, gross_floor_m2: gross,
    useful_shortfall_lower_bound_m2: value.requested_useful_m2 - gross };
  expect(rows(b)['Manque minimal selon le modèle (niveaux des corps)']).toBe('<0.01 m²');
  expect(rows(b)['Comparaison utile indicatif / brut']).toContain('Manque démontré selon le modèle');
});

it('whitelists housing scalars without parent traversal, archive decode or global levels/mesh reads', () => {
  const b = selected(), value = floor(b), fail = () => { throw new Error('Unrequested native graph read'); };
  for (const object of [value, value.need_model, value.need_model.model]) Object.defineProperty(object, 'parent', { enumerable: true, get: fail });
  Object.defineProperty(b, 'resolved', { get: fail });
  for (const volume of b.volumes) for (const key of ['levels', 'roof_mesh']) Object.defineProperty(volume, key, { get: fail });
  const projected = projectNativeBuilding(b);
  expect(projected.programme_outcome?.housing_floor?.gross_floor_m2).toBe(value.gross_floor_m2);
  expect(projected.programme_outcome?.housing_floor).not.toHaveProperty('parent');
  expect(projected.programme_outcome?.housing_floor?.need_model.model).not.toHaveProperty('parent');
  expect(projected).not.toHaveProperty('volumes'); expect(projected).not.toHaveProperty('resolved');
});

it('shows only the selected actual member roles and level counts without deducing a native grammar or occupants', () => {
  const b = selected(), fail = () => { throw new Error('No source, catalogue or geometry inference'); };
  Object.defineProperty(b, 'resolved', { get: fail });
  for (const v of b.volumes) for (const key of ['footprint', 'roof_mesh']) Object.defineProperty(v, key, { get: fail });
  const inventory = retainedBodyInventory(b)!;
  expect(inventory).toEqual([{ role: 'dwelling', levels: 1 }]);
  expect(Object.isFrozen(inventory[0])).toBe(true);
  const visible = Object.fromEntries(retainedBodyInventoryRows(b));
  expect(visible['Inventaire des corps retenus']).toContain('dwelling ×1');
  expect(visible['Grammaire native résolue (plan conservé)']).toContain('Inconnue');
  expect(retainedBodyInventory({ simplification: 'architectural_plan', volumes: [] })).toBeNull();
  expect(retainedBodyInventory({ simplification: 'architectural_plan', volumes: [{ role: 'future-role', levels: [] }] })).toEqual([{ role: 'future-role', levels: null }]);
});

async function makeCity() {
  const backend = new DerivedTestBackend(), stage = await beginUrbanBuildingStage(backend, {
    sceneId: 'housing-ui', sourceFingerprint: actual.source_fingerprint, totalRequests: buildings.length });
  for (let i = 0; i < buildings.length; i++) {
    const chunk: PlacementBatch = { schema_version: '1', generator_version: actual.generator_version, buildings: [selected(i)],
      refusals: [], open_spaces: [], materials: actual.materials as PlacementBatch['materials'] };
    await stage.append(await archivePlanBatch(chunk), { start: i, completed: i + 1, total: buildings.length });
  }
  const manifest = await stage.commit(), state = { store: { format: manifest.format, sceneId: manifest.sceneId,
    fingerprint: manifest.fingerprint, sourceFingerprint: manifest.sourceFingerprint },
    counts: { schema_version: manifest.schema_version, generator_version: manifest.generator_version,
      buildings: manifest.buildings, refusals: manifest.refusals, open_spaces: manifest.openSpaces } };
  return { backend, manifest, state };
}
async function frames(backend: DerivedTestBackend, id: string) {
  const result: Uint8Array[] = []; for await (const part of exportUrbanBuildingChunks(backend, id)) result.push(part); return result;
}

it('preserves the full actual housing report through archive, cold selection, derived cache, native export and import', async () => {
  const c = await makeCity(), bytes = await frames(c.backend, c.manifest.sceneId), cache = await openDerivedCache(c.backend, c.manifest);
  expect(cache.manifest.version).toBe('urban-derived-visual-2');
  for (let i = 0; i < buildings.length; i++) {
    expect((await cache.chunk(i)).projection.buildings[0].programme_outcome).toEqual(buildings[i].programme_outcome);
  }
  const reader = await openUrbanBuildingChunks(c.backend, c.manifest.sceneId);
  expect((await reader.readBuilding(buildings[0].id))!.building.programme_outcome).toEqual(buildings[0].programme_outcome);
  const importedBackend = new DerivedTestBackend();
  const imported = await importUrbanBuildingChunks(importedBackend, (async function* () { yield* bytes; })(), { sceneId: 'housing-import' });
  const copied = await frames(importedBackend, imported.sceneId);
  expect(copied.slice(1)).toEqual(bytes.slice(1)); // Only manifest sceneId changes.
  const native = await openUrbanBuildingChunks(importedBackend, imported.sceneId);
  expect((await native.readBuilding(buildings[1].id))!.building.programme_outcome).toEqual(buildings[1].programme_outcome);
  const importedCache = await openDerivedCache(importedBackend, imported);
  expect((await importedCache.chunk(1)).projection.buildings[0].programme_outcome?.housing_floor).toEqual(floor(buildings[1]));
  expect(await frames(c.backend, c.manifest.sceneId)).toEqual(bytes);
});

it('rejects V1 and missing derived versions, then repairs serial authenticated children without a global scene or native regeneration', async () => {
  for (const version of ['urban-derived-visual-1', undefined]) {
    const c = await makeCity(), before = await frames(c.backend, c.manifest.sceneId), cache = c.backend.caches.get(c.manifest.sceneId)!;
    const metadata = cache.manifest! as unknown as Record<string, unknown>;
    if (version) metadata.version = version; else delete metadata.version;
    // Keep all other hash checks coherent: version support itself is the miss.
    const { fingerprint: _old, ...content } = metadata;
    metadata.fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content))))]
      .map(n => n.toString(16).padStart(2, '0')).join('');
    c.backend.reads = [];
    await expect(openDerivedCache(c.backend, c.manifest)).rejects.toThrow('Missing/stale');
    await expect(openColdVisualSource(c.backend, c.manifest.sceneId)).rejects.toThrow('Missing/stale');
    expect(c.backend.reads).toEqual([]);
    const progress: number[] = [];
    const result = await repairColdDerivedCache(c.backend, c.state, { yieldControl: async () => {}, progress: p => progress.push(p.completed) });
    expect(c.backend.reads).toEqual([0, 1]);
    expect(result).toMatchObject({ chunks: 2, maxRetainedNativeChunks: 1, maxParsedRecords: 1, origins: 'unknown' });
    expect(progress.at(-1)).toBe(2);
    const repaired = await openDerivedCache(c.backend, c.manifest);
    expect(repaired.manifest.version).toBe(DERIVED_VISUAL_VERSION);
    for (let i = 0; i < buildings.length; i++) expect((await repaired.chunk(i)).projection.buildings[0].programme_outcome?.housing_floor).toEqual(floor(buildings[i]));
    c.backend.reads = []; await openColdVisualSource(c.backend, c.manifest.sceneId);
    expect(c.backend.reads).toEqual([]);
    expect(await frames(c.backend, c.manifest.sceneId)).toEqual(before);
  }
});


it('binds a retained housing model to the same parent households, preserving footprint when absent or mismatched', () => {
  const native = selected().programme_outcome!;
  expect(native.households.requested).toBe(3);
  expect(native.housing_floor!.need_model.allocated_households).toBe(3);
  expect(retainedProgrammeOutcome(native)?.housing_floor).toEqual(native.housing_floor);
  // The housing block is coherent alone, but belongs to four households while
  // the actual parent still records three (the root-reported import bug).
  const need4 = { ...native.housing_floor!.need_model, allocated_households: 4,
    requested_m2: 4 * native.housing_floor!.need_model.model.effective_floor_m2_per_household };
  const housing4 = { ...native.housing_floor!, need_model: need4, requested_useful_m2: need4.requested_m2,
    useful_shortfall_lower_bound_m2: need4.requested_m2 - native.housing_floor!.gross_floor_m2! };
  expect(retainedHousingFloorOutcome(housing4)).not.toBeNull();
  const wrongModel = retainedProgrammeOutcome({ ...native, housing_floor: housing4 });
  expect(wrongModel?.body_footprint).toEqual(native.body_footprint);
  expect(wrongModel).not.toHaveProperty('housing_floor');
  for (const parent of [{ ...native.households, requested: 4 }, { ...native.households, requested: null },
    { housed: null, capacity_status: 'unknown' }, null, undefined]) {
    const result = retainedProgrammeOutcome({ ...native, households: parent });
    expect(result?.body_footprint).toEqual(native.body_footprint);
    expect(result).not.toHaveProperty('housing_floor');
    expect(Object.fromEntries(programmeOutcomeRows({ ...native, households: parent }))['Besoin utile indicatif (modèle)']).toBe('Inconnu');
  }
});

it('retains the existing native fractional-household display-rounding contract without replacing recorded values', () => {
  // Exact existing native validator witness (433-test validated Houses suite):
  // housing_floor_need_validation_accepts_f64_roundtrip_and_old_display_rounding,
  // households=2.35, allocated=2.345, wealth=.25. This is a scalar contract
  // witness, not a new native admission or a culturally calibrated household.
  const parent = selected().programme_outcome!, allocated = 2.345, factor = .7 + .8 * .25;
  const need = { ...parent.housing_floor!.need_model, allocated_households: allocated,
    requested_m2: allocated * 60 * factor,
    model: { ...parent.housing_floor!.need_model.model, wealth: .25, wealth_factor: factor,
      floor_m2_per_household: 60, effective_floor_m2_per_household: 60 * factor } };
  const gross = parent.housing_floor!.gross_floor_m2!;
  const housing: HousingFloorOutcome = { ...parent.housing_floor!, need_model: need,
    requested_useful_m2: need.requested_m2, useful_shortfall_lower_bound_m2: need.requested_m2 - gross };
  const value = { ...parent, households: { ...parent.households, requested: 2.35 }, housing_floor: housing };
  const result = retainedProgrammeOutcome(value)!;
  expect(result.households.requested).toBe(2.35);
  expect(result.housing_floor?.need_model.allocated_households).toBe(2.345);
  expect(result.housing_floor).toEqual(housing);
  const adjacent = (value: number, delta: bigint) => {
    const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
    view.setBigUint64(0, view.getBigUint64(0) + delta); return view.getFloat64(0);
  };
  // Same native test mutates allocated down one ULP and factor up one ULP,
  // keeping the transmitted requested/effective quantities exactly unchanged.
  const roundtripNeed = { ...need, allocated_households: adjacent(allocated, -1n),
    model: { ...need.model, wealth_factor: adjacent(factor, 1n) } };
  expect(2.35 - roundtripNeed.allocated_households).toBeGreaterThan(.005);
  const roundtripHousing = { ...housing, need_model: roundtripNeed };
  const roundtrip = retainedProgrammeOutcome({ ...value, housing_floor: roundtripHousing })!;
  expect(roundtrip.housing_floor).toEqual(roundtripHousing);
  expect(roundtrip.households.requested).toBe(2.35);
  expect(roundtrip.housing_floor!.need_model.allocated_households).toBe(roundtripNeed.allocated_households);
  // Same rounding cell, but clearly outside its original half-cent bound.
  const mismatch = retainedProgrammeOutcome({ ...value, households: { ...value.households, requested: 2.36 } });
  expect(mismatch?.body_footprint).toEqual(parent.body_footprint);
  expect(mismatch).not.toHaveProperty('housing_floor');
  // A non-grid parent is NOT authorized by the legacy 0.01 display rule.
  expect(retainedProgrammeOutcome({ ...value, households: { ...value.households, requested: 2.349 } })).not.toHaveProperty('housing_floor');
});
