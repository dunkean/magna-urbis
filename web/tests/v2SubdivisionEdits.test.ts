import { describe, expect, it } from 'vitest';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';
import { applyHouseEdit, geometryConfigs, localArchitectureSettings, requireHouseEditSuccess, scopedHouseEdit, isMassingEdit, massingEditApplied } from '../../rust/bridge/urbanHouseEdits';
import { architectureProfile, type PlacementBatch, type PlacementRequest } from '../../rust/bridge/urbanArchitecture';
import { houseControlDefaults } from '../src/v2/urbanControlSchema';
import { rerollSubdivisionBuildings, resetSubdivisionChildren } from '../src/v2/subdivisionEdits';
import type { V2Settings } from '../src/v2/contracts';
import type { World } from '../src/gen/types';
import { featureDisplayName } from '../src/v2/mapPresentation';
import { rerollSettlement } from '../src/v2/urbanSeeds';
import { urbanEffectiveValues, writeUrbanControl } from '../src/v2/urbanControls';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject } from '../src/v2/project';
import { presetComposition } from '../src/render/composition';
import { blockEditId, runtimeBlockEdits } from '../../rust/bridge/urbanBlockEdits';
import { resolveRustUrbanControls } from '../src/v2/rustUrban';

describe('subdivision architecture inheritance and variations', () => {
  it('keeps a saved block edit attached to its geometry when another quarter changes block indices', () => {
    const shape = (x: number) => ({
      outer: [
        { x, y: 0 },
        { x: x + 10, y: 0 },
        { x: x + 10, y: 20 },
        { x, y: 20 },
      ],
      holes: [],
    });
    const first = { shape: shape(0) },
      selected = { shape: shape(20) },
      inserted = { shape: shape(40) };
    const layout = { key: 'town', blocks: [first, selected] } as never;
    const id = blockEditId({ key: 'town' }, selected.shape);
    const cfg = { ...defaultParcelConfig(), overrides: { blocks: { [id]: { culture: 'elven', salt: 12 } } } };
    expect(runtimeBlockEdits(cfg, [layout]).overrides!.blocks!['1'].culture).toBe('elven');
    const shifted = { key: 'town', blocks: [inserted, first, selected] } as never;
    const applied = runtimeBlockEdits(cfg, [shifted]).overrides!.blocks!;
    expect(Object.keys(applied)).toEqual(['2']);
    expect(applied['2'].salt).toBe(12);
    const reversed = { outer: [...selected.shape.outer].reverse(), holes: [] };
    expect(blockEditId({ key: 'town' }, reversed)).toBe(id);
  });
  it('lets an explicit city culture replace inherited templates without changing the house renderer', () => {
    const settings = defaultSettings();
    settings.urban = { architecture: 'detailed', layout: { culture: 'medina', preset: 'morph/medina', tissue: 'grid' }, houses: { house_config: houseControlDefaults() }, local: { town: { layout: { culture: 'elven' } } } };
    const resolved = resolveRustUrbanControls(settings, 'town', settings.options);
    expect(resolved.layout.culture).toBe('elven');
    expect(resolved.layout.tissue).toBe('culture');
    expect(resolved.parcels.culture).toBe('elven');
    expect(resolved.houses.house_config).toBeUndefined();
    expect(resolved.houses.culture).toBe('elven');
    expect(settings.urban.architecture).toBe('detailed');
  });
  it('propagates the main quarter culture to houses and clears stale model pins while preserving rendering', () => {
    const settings = defaultSettings();
    settings.urban = { architecture: 'detailed', local: { town: { layout: { overrides: { quarters: { '2': { culture: 'medina', buildingCulture: 'byzantine-greek', houseConfig: { pack: 'EUR-MED' } } } } } } } };
    settings.appearance = { style: 'parchment', textured: true };
    writeUrbanControl(settings, { kind: 'quarter', key: 'town', id: '2' }, 'culture', 'elven');
    const layout = { ...defaultLayoutConfig(), ...settings.urban.local!.town.layout };
    expect(layout.overrides!.quarters!['2']).toEqual({ culture: 'elven', tissue: 'culture' });
    const profile = JSON.parse(architectureProfile(localArchitectureSettings({}, layout, defaultParcelConfig(), {}))!);
    expect(profile.houses.quarters['2'].styles).toEqual([{ culture: 'elven', weight: 1 }]);
    expect(settings.urban.architecture).toBe('detailed');
    expect(settings.appearance.textured).toBe(true);
  });
  it('persists block edits, inherits house choices through the block and preserves textured detailed rendering on reroll', () => {
    const settings = defaultSettings();
    settings.urban = { backend: 'native', architecture: 'detailed', local: { town: { layout: { houseComplexity: 'complex', overrides: { quarters: { '2': { houseConfig: { wealth: 0.8 } } } } } } } };
    const composition = presetComposition('parchment');
    composition.buildings.look = 'detailed-volumes';
    settings.appearance = { style: 'parchment', textured: true, composition };
    const appearance = structuredClone(settings.appearance);
    const block = { kind: 'block', key: 'town', id: '4', quarter: '2' } as const;
    writeUrbanControl(settings, block, 'culture', 'medina');
    writeUrbanControl(settings, block, 'density', 0.5);
    writeUrbanControl(settings, block, 'salt', 123);
    writeUrbanControl(settings, block, 'houseConfig.overrides.floors', 3);
    const local = settings.urban.local!.town;
    expect(local.parcels!.overrides!.blocks!['4']).toMatchObject({ culture: 'medina', density: 0.5, salt: 123 });
    const parcel = { kind: 'parcel', key: 'town', id: 'lot', quarter: '2', block: '4' } as const;
    expect(urbanEffectiveValues(settings, parcel)).toMatchObject({ culture: 'medina', houseConfig: { wealth: 0.8, overrides: { floors: 3 } } });
    expect(scopedHouseEdit(defaultLayoutConfig(), { ...defaultParcelConfig(), ...local.parcels }, '2', 'lot', undefined, '4').overrides?.floors).toBe(3);
    const profile = JSON.parse(architectureProfile(localArchitectureSettings({}, defaultLayoutConfig(), { ...defaultParcelConfig(), ...local.parcels }, {}))!);
    expect(profile.houses.blocks['4'].styles).toEqual([{ culture: 'medina', weight: 1 }]);
    resetSubdivisionChildren(settings, 'town', 'block', { parcels: ['lot'], requests: ['house'] });
    rerollSettlement(settings, 'town');
    const restored = parseProject(serializeProject(settings)).settings;
    expect(restored.urban!.architecture).toBe('detailed');
    expect(restored.urban!.local!.town.layout!.houseComplexity).toBe('complex');
    expect(restored.appearance).toEqual(appearance);
    expect(restored.urban!.local!.town.parcels!.overrides!.blocks!['4'].salt).toBe(123);
  });
  it('routes a procedural roof edit through native massing without selecting a new house template', () => {
    const patch = { overrides: { roof: 'RF-HIP', floors: 2 } as never };
    expect(isMassingEdit(patch)).toBe(true);
    expect(isMassingEdit({ ...patch, pack: 'AS-CHI' })).toBe(false);
    const settings = localArchitectureSettings({}, defaultLayoutConfig(), defaultParcelConfig(), { 'one/building': patch }, true);
    expect(JSON.parse(architectureProfile(settings)!)).toMatchObject({ houses: { massing: { 'b:one/building': patch } } });
    expect(massingEditApplied({ massing: [{ roof: 'hip', floors: 2 }] } as never, patch)).toBe(true);
    expect(massingEditApplied({ massing: [{ roof: 'gable', floors: 2 }] } as never, patch)).toBe(false);
  });
  it('shows localized common nouns in selection titles without changing the proper name or authored labels', () => {
    const world = {
      names: {
        entries: [
          { id: 'gate', kind: 'gate', text: 'Grahams Gate', parts: { kind: 'gate', proper: 'Grahams', cultural: 'Grahams Gate', opaque: false } },
          { id: 'manual', kind: 'gate', text: 'My authored Gate', manual: true, parts: { kind: 'gate', proper: 'Grahams', cultural: 'Grahams Gate', opaque: false } },
        ],
      },
    } as unknown as World;
    const settings = { naming: { mapLanguage: 'fr' } } as V2Settings;
    expect(featureDisplayName(world, 'gate', settings)).toBe('Porte de Grahams');
    settings.naming!.mapLanguage = 'en';
    expect(featureDisplayName(world, 'gate', settings)).toBe('Grahams Gate');
    expect(featureDisplayName(world, 'manual', settings)).toBe('My authored Gate');
    expect(world.names!.entries[0].parts!.proper).toBe('Grahams');
  });
  it('keeps an individual myconid house in a Byzantine parcel and Medina quarter of a European town', () => {
    const layout = defaultLayoutConfig(),
      parcels = defaultParcelConfig();
    layout.culture = 'european-organic';
    layout.overrides = { quarters: { '2': { culture: 'medina', buildingCulture: 'medina', houseConfig: { wealth: 0.8, overrides: { roof: 'RF-FLAT' } as never } } } };
    parcels.overrides = { parcels: { 'lot/one': { culture: 'byzantine-greek', houseConfig: { overrides: { floors: 2 } as never } } } };
    const own = { culture: 'myconid-colony', overrides: { floors: 1 } as never };
    expect(JSON.parse(architectureProfile(localArchitectureSettings({}, layout, parcels, { 'lot/one/building': own }))!)).toMatchObject({
      houses: { quarters: { '2': { styles: [{ culture: 'medina' }] } }, parcels: { 'lot/one': { styles: [{ culture: 'byzantine-greek' }] } }, buildings: { 'lot/one/building': { styles: [{ culture: 'myconid-colony' }] } } },
    });
    expect(scopedHouseEdit(layout, parcels, '2', 'lot/one', own)).toEqual({ wealth: 0.8, overrides: { roof: 'RF-FLAT', floors: 1 } });
    const geometry = geometryConfigs(layout, parcels);
    expect(geometry.layout.overrides?.quarters?.['2']).toEqual({ culture: 'medina' });
    expect(geometry.parcels.overrides).toBeUndefined();
    expect(layout.overrides.quarters!['2'].buildingCulture).toBe('medina');
  });
  it('changes the pack consistently and rejects a missing house before replacing the visible scene', () => {
    const request = { id: 'lot/building', parcel_id: 'lot', seed: 'source', culture: { pack: 'EUR-MED', mode: 'historical_inspired' } } as PlacementRequest;
    const edited = applyHouseEdit(request, { ...houseControlDefaults(), pack: 'AS-CHI', recipe: null });
    expect(edited.culture.pack).toBe('AS-CHI');
    expect(request.culture.pack).toBe('EUR-MED');
    const failed = { buildings: [], refusals: [{ id: request.id, code: 'roof_incompatible', message: 'Choose an allowed roof.' }] } as unknown as PlacementBatch;
    expect(() => requireHouseEditSuccess(failed, [request])).toThrow('roof_incompatible: Choose an allowed roof.');
  });
  it('rerolls every child seed while keeping individual styles, and can explicitly restore descendant inheritance', () => {
    const settings = {
      options: { seed: 'town' },
      urban: {
        backend: 'rust',
        local: { town: { parcels: { overrides: { parcels: { one: { culture: 'byzantine-greek' }, two: { role: 'dwelling' } } } } } },
        buildings: { 'town/one/building': { culture: 'myconid-colony', seed: 'fixed' }, 'town/two/building': { pack: 'EUR-MED' }, 'other/one/building': { seed: 'other' } },
      },
    } as unknown as V2Settings;
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
