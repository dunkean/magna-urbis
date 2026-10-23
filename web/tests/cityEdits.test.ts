import { describe, expect, it } from 'vitest';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';
import type { PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { applyHouseEdits, editCount, emptyEdits, layoutWithEdits, normalizeEdits, parcelWithEdits, setEdit } from '../src/ui/cityEdits';
import { lotRoleChoices, roleLabel } from '../src/render/cityRoles';

/** City Bench per-item edits: persisted through the share JSON, injected only when present. */
describe('city edits', () => {
  it('round-trips quarter, lot and house edits and injects them into each stage', () => {
    let edits = setEdit(emptyEdits(), 'quarters', '3', { role: 'market', wealth: 2, tissue: 'grid' });
    edits = setEdit(edits, 'parcels', 'p/12', { role: 'craft.smithy', function: 'workshop' });
    edits = setEdit(edits, 'buildings', 'p/12/building', { recipe: 'EUR-MED-B02', variant: 'default' });
    // Share query round trip, with junk from an old or hand-edited link dropped.
    const restored = normalizeEdits({ ...JSON.parse(JSON.stringify(edits)), parcels: { ...edits.parcels, bad: {} }, junk: 1 });
    expect(restored).toEqual(edits);
    expect(restored.quarters['3'].wealth).toBe(1);
    expect(editCount(restored)).toBe(3);
    // Unedited stages send the strict contract unchanged.
    const layout = defaultLayoutConfig(), parcels = defaultParcelConfig();
    expect(layoutWithEdits(layout, emptyEdits())).toBe(layout);
    expect((layoutWithEdits(layout, edits) as unknown as { overrides: unknown }).overrides).toEqual({ quarters: edits.quarters });
    expect((parcelWithEdits(parcels, edits) as unknown as { overrides: unknown }).overrides).toEqual({ parcels: edits.parcels });
    // House edits pin recipe and variant on that request only, without mutating it.
    const request = (id: string) => ({ id, config: { recipe: 'EUR-MED-B01', overrides: { variant: null, floors: 2 } } }) as unknown as PlacementRequest;
    const originals = [request('p/12/building'), request('p/13/building')], before = JSON.stringify(originals);
    const styled = applyHouseEdits(originals, edits.buildings);
    expect(styled[0].config).toMatchObject({ recipe: 'EUR-MED-B02', overrides: { variant: 'default', floors: 2 } });
    expect(styled[1]).toBe(originals[1]);
    expect(JSON.stringify(originals)).toBe(before);
    // Reset removes the item.
    expect(editCount(setEdit(edits, 'quarters', '3', undefined))).toBe(2);
    // French labels: never a raw id tail.
    expect(roleLabel('worship.mosque.friday')).toBe('Mosquée du vendredi');
    expect(roleLabel('craft.smithy', 'Forge du roi')).toBe('Forge du roi');
    expect(lotRoleChoices('medina').some(c => c.role === 'worship.mosque.friday' && c.label === 'Mosquée du vendredi')).toBe(true);
  });
});
