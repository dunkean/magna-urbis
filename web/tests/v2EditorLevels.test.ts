import { describe, expect, it } from 'vitest';
import { makeOptions } from '../src/gen/options';
import { localFields, writeUrbanControl, urbanEffectiveValues, catalogueChoiceLabel } from '../src/v2/urbanControls';
import { resolveRustUrbanControls } from '../src/v2/rustUrban';
import { compatibleBuildingTypes } from '../src/v2/urbanEditOptions';
import { stickySelection } from '../src/v2/editingTools';
import { localArchitectureSettings } from '../../rust/bridge/urbanHouseEdits';
import { translate } from '../src/v2/i18n';
import type { V2Settings } from '../src/v2/contracts';

function settings(): V2Settings { return { options: makeOptions({ seed: 'editor-levels', culture: 'european-organic', population: 2000 }), extent: 3000, settlementCount: 1, local: {}, generation: 'procedural', urban: { backend: 'rust' } }; }
const paths = (kind: 'quarter' | 'block' | 'parcel' | 'building') => localFields(kind === 'building' ? { kind, key: 'main', id: 'r1' } : { kind, key: 'main', id: '3' }).map(field => field.path);

describe('editor levels', () => {
  it('offers only the generation choices each level applies', () => {
    expect(paths('quarter').slice(0, 4)).toEqual(['culture', 'tissue', 'zone', 'density']);
    expect(paths('block').slice(0, 3)).toEqual(['culture', 'density', 'operator']);
    expect(paths('parcel').slice(0, 4)).toEqual(['role', 'culture', 'enclosure', 'households']);
    expect(paths('building').slice(0, 4)).toEqual(['culture', 'recipe', 'overrides.roof', 'overrides.floors']);
    expect(paths('parcel')).toEqual(expect.arrayContaining(['houseConfig.pack', 'houseConfig.era', 'houseConfig.overrides.variant']));
    expect(paths('building')).toEqual(expect.arrayContaining(['pack', 'era', 'overrides.overhang_m']));
    expect(paths('building').filter(path => path === 'recipe')).toHaveLength(1);
  });
  it('carries a parcel content choice into the native programme request', () => {
    const config = settings(), scope = { kind: 'parcel', key: 'main', id: 'q0/b2/p5', defaults: { role: 'storage.barn', area: 400 } } as const;
    writeUrbanControl(config, scope, 'role', 'commerce.tavern');
    expect(resolveRustUrbanControls(config, 'main', config.options).parcels.overrides?.parcels?.['q0/b2/p5']?.role).toBe('commerce.tavern');
    writeUrbanControl(config, scope, 'role', 'dwelling');
    expect(resolveRustUrbanControls(config, 'main', config.options).parcels.overrides?.parcels?.['q0/b2/p5']?.role).toBe('dwelling');
    writeUrbanControl(config, scope, 'enclosure', 'hedge');
    expect(resolveRustUrbanControls(config, 'main', config.options).parcels.overrides?.parcels?.['q0/b2/p5']?.enclosure).toBe('hedge');
    writeUrbanControl(config, scope, 'enclosure', undefined);
    writeUrbanControl(config, scope, 'role', undefined);
    expect(resolveRustUrbanControls(config, 'main', config.options).parcels.overrides?.parcels?.['q0/b2/p5']?.role).toBeUndefined();
  });
  it('lists every building type, the culture’s own first, including the current use', () => {
    const types = compatibleBuildingTypes({ culture: 'european-organic', area: 150, current: 'storage.barn' });
    expect(types.map(choice => choice.value)).toEqual(expect.arrayContaining(['dwelling', 'open.garden', 'commerce.tavern', 'craft.smithy', 'storage.barn', 'worship.parish', 'civic.arena']));
    expect(compatibleBuildingTypes({ culture: 'site', fallbackCulture: 'european-organic', area: 150 }).find(choice => choice.value === 'commerce.tavern')?.group).toBe('This culture');
  });
  it('sends a house roof edit to the city-volume request and resets type and roof on a culture change', () => {
    const config = settings(), scope = { kind: 'building', key: 'main', id: 'q0/b2/p5/building', defaults: { pack: 'EUR-MED', overrides: { roof: 'RF-GABLE' } } as never } as const;
    writeUrbanControl(config, scope, 'overrides.roof', 'RF-HIP');
    writeUrbanControl(config, scope, 'recipe', 'some-recipe');
    const own = config.urban!.buildings!['main/q0/b2/p5/building'];
    expect(own).toMatchObject({ recipe: 'some-recipe', pack: 'EUR-MED', overrides: { roof: 'RF-HIP' } });
    const resolved = resolveRustUrbanControls(config, 'main', config.options);
    const roofOnly = localArchitectureSettings(resolved.houses, resolved.layout, resolved.parcels, { 'q0/b2/p5/building': { overrides: { roof: 'RF-HIP' } } as never }, true);
    expect(roofOnly.houses?.massing?.['b:q0/b2/p5/building']).toEqual({ overrides: { roof: 'RF-HIP' } });
    writeUrbanControl(config, scope, 'culture', 'medina');
    expect(config.urban!.buildings!['main/q0/b2/p5/building']).toEqual({ culture: 'medina' });
    expect((urbanEffectiveValues(config, scope) as { culture: string }).culture).toBe('medina');
  });
  it('names roof systems and house types instead of showing catalogue codes', () => {
    const catalogue = { packs: [], materials: [], recipes: [] };
    expect(catalogueChoiceLabel(catalogue, 'overrides.roof', 'RF-HIP')).toBe(translate('Hip roof'));
    expect(translate('Hip roof', 'fr')).toBe('Toit à quatre pans');
    expect(catalogueChoiceLabel(catalogue, 'overrides.roof', 'RF-UNKNOWN-THING')).toBe('Unknown thing');
    expect(catalogueChoiceLabel(catalogue, 'overrides.roof', 'RF-HIP')).not.toContain('RF-');
  });
  it('keeps "Select on map" on through picks, tab changes and regeneration', () => {
    for (const token of ['busy', 'family', 'selection']) expect(stickySelection(token, true)).toBe(true);
    for (const token of ['navigate', 'labels', 'network:roads', 'town-move', '3d']) expect(stickySelection(token, true)).toBe(false);
    expect(stickySelection('busy', false)).toBe(false);
  });
});
