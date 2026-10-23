import { describe, expect, it, vi } from 'vitest';
import { editArchitectureScene } from '../../rust/bridge/architectureEdits';
import { archivePlanBatch, resolveArchivedPlan } from '../../rust/bridge/compactPlanArchive';
import type { HouseMaterial } from '../../rust/bridge/housesContract';
import { HOUSE_GENERATOR } from '../../rust/bridge/housesContract';
import { ARCHITECTURE_PLAN_GENERATOR } from '../../rust/bridge/urbanArchitecture';
import type { PlacementBatch, PlacementRequest, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const surface = (x: number, width = 10) => [{ outer: [{ x, y: 0 }, { x: x + width, y: 0 }, { x: x + width, y: 10 }, { x, y: 10 }], holes: [] }];
const culture = { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired' as const, borrowing: null };
const request = (id: string, x = 0): PlacementRequest => ({
  id, parcel_id: `parcel/${id}`, seed: `seed/${id}`, cadastral: surface(x), buildable: surface(x), reserves: [],
  accesses: [], party_boundaries: [], neighbors: [], culture, function: 'domestic',
  terrain: { origin: { x, y: 0 }, ground_z_m: 0, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 },
});
const building = (id: string, x = 0): PlacedBuilding => ({
  id, parcel_id: `parcel/${id}`, function: 'domestic', culture, recipe_id: 'EUR-MED-B02', variant_id: 'default',
  transform: { origin: { x, y: 0 }, orientation_deg: 0 }, ground_z_m: 0,
  footprint: surface(x), roof_footprint: surface(x), courtyards: [], circulation: [], entrance: { x, y: 0 }, access_id: 'front',
  volumes: [], useful_area_m2: 100, domestic_units: 0, structural_features: [], simplification: 'architectural_plan', diagnostics: [],
  resolved: { format: 'compact-plan-1', generator_version: HOUSE_GENERATOR, seed: `seed/${id}` },
});
const batch = (buildings: PlacedBuilding[] = []): PlacementBatch => ({ schema_version: '1', generator_version: ARCHITECTURE_PLAN_GENERATOR, buildings, refusals: [], open_spaces: [] });
const material = (id: string): HouseMaterial => ({ id, label: id, roles: ['frame'], pattern: 'wood', origin: 'source', source_ref: null });

describe('transactional selected native architecture edits', () => {
  it('keeps the exact previous scene on refusals, missing output or callback failure', async () => {
    const previous = batch([building('a'), building('b', 10)]), requests = [request('a'), request('b', 10)];
    const before = structuredClone({ previous, requests });
    const nativeRefusal = { id: 'b', parcel_id: 'parcel/b', code: 'no_fit', message: 'No compatible plan.', attempts: 4 };
    const failed = await editArchitectureScene(previous, requests, async input => {
      input.requests[0].cadastral[0].outer[0].x = 999;
      return { ...batch([building('a')]), refusals: [nativeRefusal] };
    });
    expect(failed).toEqual({ scene: previous, applied: false, changedIds: [], refusals: [nativeRefusal] });
    expect(failed.scene).toBe(previous);
    const missing = await editArchitectureScene(previous, requests, async () => batch([building('a')]));
    expect(missing.scene).toBe(previous);
    expect(missing.refusals).toMatchObject([{ id: 'b', code: 'edit_missing_result' }]);
    await expect(editArchitectureScene(previous, requests, async input => {
      input.requests[0].seed = 'mutated'; throw new Error('Native unavailable');
    })).rejects.toThrow('Native unavailable');
    expect({ previous, requests }).toEqual(before);
  });

  it('indexes real nearby occupation once, omits old targets and preserves distant identities', async () => {
    const target = building('target'), neighbor = building('near', 9), distant = building('distant', 10_000);
    neighbor.courtyards = surface(8); neighbor.circulation = surface(7);
    neighbor.structural_features = [{ id: 'fence', kind: 'fence', surface: surface(6), z_m: 0, height_m: 2, material: 'wood', vertices3d: [] }];
    neighbor.structural_foundations = [{ footprint: surface(5), z_min_m: -1, z_max_m: 0 }];
    const previous = batch([target, neighbor, distant]), input = request('target');
    input.neighbors = [
      { id: 'external', footprint: surface(100), height_m: 1 },
      { id: 'target', footprint: target.footprint, height_m: 1 },
      { id: 'target/occupation/0', footprint: target.footprint, height_m: 1 },
    ];
    const before = structuredClone({ previous, input }), replacement = building('target', 1);
    const settings = { floors: 2 };
    const result = await editArchitectureScene(previous, [input], async received => {
      expect(received.settings).toEqual(settings);
      const neighbors = received.requests[0].neighbors;
      expect(neighbors.map(value => value.id)).toEqual(['external', 'near/occupation/0', 'near/occupation/1', 'near/occupation/2', 'near/occupation/3', 'near/occupation/4']);
      expect(neighbors.slice(1).map(value => value.footprint)).toEqual([
        neighbor.footprint, neighbor.courtyards, neighbor.circulation,
        neighbor.structural_features[0].surface, neighbor.structural_foundations![0].footprint,
      ]);
      neighbors[1].footprint[0].outer[0].x = -999;
      received.settings!.floors = 99;
      return batch([replacement]);
    }, settings);
    expect(result.applied).toBe(true);
    expect(result.changedIds).toEqual(['target']);
    expect(result.scene.buildings).toEqual([replacement, neighbor, distant]);
    expect(result.scene.buildings[1]).toBe(neighbor);
    expect(result.scene.buildings[2]).toBe(distant);
    expect({ previous, input }).toEqual(before);
    expect(settings.floors).toBe(2);
  });

  it('merges and prunes archives, replays new plans and supports explicit open-space conversion', async () => {
    const old = await archivePlanBatch(batch([building('target')]));
    const outside = await archivePlanBatch(batch([building('outside', 100)]));
    const oldMaterial = material('old'), addedMaterial = material('added');
    const previous = { ...batch([...old.buildings, ...outside.buildings]), materials: [oldMaterial], plan_archives: { ...old.plan_archives, ...outside.plan_archives } };
    const updated = { ...building('target'), resolved: { format: 'compact-plan-1', generator_version: HOUSE_GENERATOR, seed: 'new-exact-seed' } };
    const next = await archivePlanBatch({ ...batch([updated]), materials: [structuredClone(oldMaterial), addedMaterial] });
    const edited = await editArchitectureScene(previous, [request('target')], async () => next);
    expect(edited.applied).toBe(true);
    expect(edited.scene.buildings[1]).toBe(previous.buildings[1]);
    expect(Object.keys(edited.scene.plan_archives!).sort()).toEqual([...Object.keys(outside.plan_archives!), ...Object.keys(next.plan_archives!)].sort());
    expect(await resolveArchivedPlan(edited.scene.buildings[0])).toEqual(updated.resolved);
    expect(edited.scene.materials).toEqual([oldMaterial, addedMaterial]);
    expect(edited.scene.materials![0]).toBe(oldMaterial);
    const open = { id: 'target', parcel_id: 'parcel/target', surface: surface(0) };
    const converted = await editArchitectureScene(edited.scene, [{ ...request('target'), function: 'open_space' }], async () => ({ ...batch(), open_spaces: [open] }));
    expect(converted.applied).toBe(true);
    expect(converted.scene.buildings).toEqual([outside.buildings[0]]);
    expect(converted.scene.buildings[0]).toBe(previous.buildings[1]);
    expect(converted.scene.open_spaces[0]).toBe(open);
    expect(converted.scene.plan_archives).toEqual(outside.plan_archives);
    expect(previous.buildings).toHaveLength(2);
  });

  it('validates IDs, categories and generator compatibility before committing', async () => {
    const previous = batch([building('a'), building('outside', 100)]), input = request('a');
    const generate = vi.fn(async () => batch([building('a')]));
    await expect(editArchitectureScene(previous, [input, input], generate)).rejects.toThrow('duplicate');
    expect(generate).not.toHaveBeenCalled();
    expect((await editArchitectureScene(previous, [], generate)).scene).toBe(previous);
    expect(generate).not.toHaveBeenCalled();
    const cases: [PlacementBatch, string][] = [
      [batch([building('a'), building('a')]), 'edit_invalid_result_id'],
      [batch([building('alien')]), 'edit_invalid_result_id'],
      [batch([{ ...building('a'), parcel_id: 'changed' }]), 'edit_invalid_parcel'],
      [{ ...batch(), open_spaces: [{ id: 'a', parcel_id: input.parcel_id, surface: surface(0) }] }, 'edit_invalid_result_kind'],
      [{ ...batch([building('a')]), generator_version: 'other-engine' }, 'edit_incompatible_generator'],
      [batch([{ ...building('a'), simplification: 'recipe_volumes' }]), 'edit_incompatible_mode'],
    ];
    for (const [output, code] of cases) {
      const result = await editArchitectureScene(previous, [input], async () => output);
      expect(result.scene).toBe(previous);
      expect(result.applied).toBe(false);
      expect(result.refusals[0].code).toBe(code);
    }
    // A complete replacement may change engine/mode; partial edits may not.
    const legacy = { ...batch([{ ...building('a'), simplification: 'recipe_volumes' as const }]), generator_version: 'houses-2' };
    const migrated = await editArchitectureScene(legacy, [input], async () => batch([building('a')]));
    expect(migrated.applied).toBe(true);
    expect(migrated.scene.generator_version).toBe(ARCHITECTURE_PLAN_GENERATOR);
  });

  it('replaces all historical plans with genuinely current native records, never relabels archives', async () => {
    const oldRecord = { format: 'compact-plan-1', generator_version: 'houses-2', seed: 'historical' };
    const historical = await archivePlanBatch({ ...batch([{ ...building('a'), resolved: oldRecord }]), generator_version: 'architectural-plans-1' });
    const frozen = structuredClone(historical);
    const current = await archivePlanBatch(batch([building('a')]));
    const migrated = await editArchitectureScene(historical, [request('a')], async () => current);
    expect(migrated.applied).toBe(true);
    expect(migrated.scene.generator_version).toBe(ARCHITECTURE_PLAN_GENERATOR);
    expect(await resolveArchivedPlan(migrated.scene.buildings[0], migrated.scene)).toEqual(building('a').resolved);
    expect(migrated.scene.plan_archives).toEqual(current.plan_archives);
    expect(historical).toEqual(frozen);
    expect(await resolveArchivedPlan(historical.buildings[0], historical)).toEqual(oldRecord);

    // A batch label alone cannot upgrade a retained old native certificate.
    const relabelled = { ...historical, generator_version: ARCHITECTURE_PLAN_GENERATOR };
    const refused = await editArchitectureScene(historical, [request('a')], async () => relabelled);
    expect(refused.scene).toBe(historical);
    expect(refused.refusals[0].code).toBe('edit_incompatible_plan_version');
    expect(await resolveArchivedPlan(historical.buildings[0], historical)).toEqual(oldRecord);
  });

  it('rejects mixed versions, mismatched native metadata and unknown contracts without changing snapshots', async () => {
    const previous = batch([building('a')]), input = request('a');
    const oldRecord = { format: 'compact-plan-1', generator_version: 'houses-2', seed: 'old' };
    const old = { ...building('a'), resolved: oldRecord };
    const historical = { ...batch([old, { ...building('outside'), resolved: oldRecord }]), generator_version: 'architectural-plans-1' };
    const partial = await editArchitectureScene(historical, [input], async () => batch([building('a')]));
    expect(partial.scene).toBe(historical);
    expect(partial.refusals[0].code).toBe('edit_incompatible_generator');

    const cases: [PlacementBatch, string][] = [
      [batch([old]), 'edit_incompatible_plan_version'],
      [{ ...batch([building('a')]), generator_version: 'architectural-plans-1' }, 'edit_incompatible_plan_version'],
      [batch([{ ...building('a'), resolved: { format: 'compact-plan-1' } }]), 'edit_incompatible_plan_version'],
      [{ ...batch([building('a')]), generator_version: 'architectural-plans-99' }, 'edit_unknown_plan_generator'],
    ];
    for (const [generated, code] of cases) {
      const frozen = structuredClone(generated);
      const result = await editArchitectureScene(previous, [input], async () => generated);
      expect(result.scene).toBe(previous);
      expect(result.applied).toBe(false);
      expect(result.refusals[0].code).toBe(code);
      expect(generated).toEqual(frozen);
    }
    // A known historical native response is still editable with its matching
    // engine. Display/storage never force an upgrade to the current version.
    const oldBatch = { ...batch([old]), generator_version: 'architectural-plans-1' };
    const retained = await editArchitectureScene(oldBatch, [input], async () => structuredClone(oldBatch));
    expect(retained.applied).toBe(true);
    expect(retained.scene.generator_version).toBe('architectural-plans-1');
    expect(retained.scene.buildings[0].resolved).toEqual(oldRecord);
  });
});
