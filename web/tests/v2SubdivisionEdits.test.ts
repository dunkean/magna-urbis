import { describe, expect, it } from 'vitest';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';
import { applyHouseEdit, geometryConfigs, localArchitectureSettings, requireHouseEditSuccess, scopedHouseEdit, isMassingEdit, massingEditApplied } from '../../rust/bridge/urbanHouseEdits';
import { architectureProfile, type PlacementBatch, type PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { houseControlDefaults } from '../src/v2/urbanControlSchema';
import { rerollSubdivisionBuildings, resetSubdivisionChildren } from '../src/v2/subdivisionEdits';
import type { V2Settings } from '../src/v2/contracts';
import type { World } from '../src/gen/types';
import { featureDisplayName } from '../src/v2/mapPresentation';

describe('subdivision architecture inheritance and variations', () => {
  it('routes a procedural roof edit through native massing without selecting a new house template',()=>{
    const patch={overrides:{roof:'RF-HIP',floors:2} as never};
    expect(isMassingEdit(patch)).toBe(true);expect(isMassingEdit({...patch,pack:'AS-CHI'})).toBe(false);
    const settings=localArchitectureSettings({},defaultLayoutConfig(),defaultParcelConfig(),{'one/building':patch},true);
    expect(JSON.parse(architectureProfile(settings)!)).toMatchObject({houses:{massing:{'b:one/building':patch}}});
    expect(massingEditApplied({massing:[{roof:'hip',floors:2}]} as never,patch)).toBe(true);
    expect(massingEditApplied({massing:[{roof:'gable',floors:2}]} as never,patch)).toBe(false);
  });
  it('shows localized common nouns in selection titles without changing the proper name or authored labels', () => {
    const world = { names: { entries: [
      { id: 'gate', kind: 'gate', text: 'Grahams Gate', parts: { kind: 'gate', proper: 'Grahams', cultural: 'Grahams Gate', opaque: false } },
      { id: 'manual', kind: 'gate', text: 'My authored Gate', manual: true, parts: { kind: 'gate', proper: 'Grahams', cultural: 'Grahams Gate', opaque: false } },
    ] } } as unknown as World;
    const settings = { naming: { mapLanguage: 'fr' } } as V2Settings;
    expect(featureDisplayName(world, 'gate', settings)).toBe('Porte de Grahams');
    settings.naming!.mapLanguage = 'en';
    expect(featureDisplayName(world, 'gate', settings)).toBe('Grahams Gate');
    expect(featureDisplayName(world, 'manual', settings)).toBe('My authored Gate');
    expect(world.names!.entries[0].parts!.proper).toBe('Grahams');
  });
  it('keeps an individual myconid house in a Byzantine parcel and Medina quarter of a European town', () => {
    const layout = defaultLayoutConfig(), parcels = defaultParcelConfig();
    layout.culture = 'european-organic';
    layout.overrides = { quarters: { '2': { culture: 'medina', buildingCulture: 'medina', houseConfig: { wealth: .8, overrides: { roof: 'RF-FLAT' } as never } } } };
    parcels.overrides = { parcels: { 'lot/one': { culture: 'byzantine-greek', houseConfig: { overrides: { floors: 2 } as never } } } };
    const own = { culture: 'myconid-colony', overrides: { floors: 1 } as never };
    expect(JSON.parse(architectureProfile(localArchitectureSettings({}, layout, parcels, { 'lot/one/building': own }))!)).toMatchObject({ houses: {
      quarters: { '2': { styles: [{ culture: 'medina' }] } }, parcels: { 'lot/one': { styles: [{ culture: 'byzantine-greek' }] } }, buildings: { 'lot/one/building': { styles: [{ culture: 'myconid-colony' }] } },
    } });
    expect(scopedHouseEdit(layout, parcels, '2', 'lot/one', own)).toEqual({ wealth: .8, overrides: { roof: 'RF-FLAT', floors: 1 } });
    const geometry = geometryConfigs(layout, parcels);
    expect(geometry.layout.overrides?.quarters?.['2']).toEqual({ culture: 'medina' });
    expect(geometry.parcels.overrides).toBeUndefined();
    expect(layout.overrides.quarters!['2'].buildingCulture).toBe('medina');
  });
  it('changes the pack consistently and rejects a missing house before replacing the visible scene', () => {
    const request = { id: 'lot/building', parcel_id: 'lot', seed: 'source', culture: { pack: 'EUR-MED', mode: 'historical_inspired' } } as PlacementRequest;
    const edited = applyHouseEdit(request, { ...houseControlDefaults(), pack: 'AS-CHI', recipe: null });
    expect(edited.culture.pack).toBe('AS-CHI'); expect(request.culture.pack).toBe('EUR-MED');
    const failed = { buildings: [], refusals: [{ id: request.id, code: 'roof_incompatible', message: 'Choose an allowed roof.' }] } as unknown as PlacementBatch;
    expect(() => requireHouseEditSuccess(failed, [request])).toThrow('roof_incompatible: Choose an allowed roof.');
  });
  it('rerolls every child seed while keeping individual styles, and can explicitly restore descendant inheritance', () => {
    const settings = { options: { seed: 'town' }, urban: { backend: 'rust', local: { town: { parcels: { overrides: { parcels: { one: { culture: 'byzantine-greek' }, two: { role: 'dwelling' } } } } } }, buildings: {
      'town/one/building': { culture: 'myconid-colony', seed: 'fixed' }, 'town/two/building': { pack: 'EUR-MED' }, 'other/one/building': { seed: 'other' },
    } } } as unknown as V2Settings;
    const children = { parcels: ['one'], requests: ['one/building'] };
    rerollSubdivisionBuildings(settings, 'town', children);
    expect(settings.urban!.buildings!['town/one/building'].culture).toBe('myconid-colony');
    expect(settings.urban!.buildings!['town/one/building'].seed).not.toBe('fixed');
    expect(settings.urban!.buildings!['other/one/building'].seed).toBe('other');
    resetSubdivisionChildren(settings, 'town', 'quarter', children);
    expect(settings.urban!.buildings!['town/one/building']).toBeUndefined();
    expect(settings.urban!.local!.town.parcels!.overrides!.parcels!.one).toBeUndefined();
    expect(settings.urban!.buildings!['town/two/building'].pack).toBe('EUR-MED');
    expect(settings.urban!.local!.town.parcels!.overrides!.parcels!.two.role).toBe('dwelling');
  });
});
