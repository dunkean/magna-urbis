import { describe, expect, it } from 'vitest';
import { makeOptions } from '../src/gen/options';
import { defaultHouseConfig } from '../../rust/bridge/houses';
import { defaultLayoutConfig, defaultParcelConfig, normalizeLayoutConfig, normalizeParcelConfig } from '../../rust/bridge/urbanConfig';
import { houseControlDefaults, scalarLeaves, urbanCatalogue, urbanControlFields } from '../src/v2/urbanControlSchema';
import { urbanEffectiveValues, urbanInheritedValues, urbanScopeValues, writeUrbanControl } from '../src/v2/urbanControls';
import { resolveRustUrbanControls } from '../src/v2/rustUrban';
import { translate } from '../src/v2/i18n';
import type { V2Settings } from '../src/v2/contracts';

function settings(): V2Settings { return { options: makeOptions({ seed: 'city-parity', culture: 'roman-core', population: 300 }), extent: 3000, settlementCount: 1, local: {}, generation: 'procedural', urban: { backend: 'rust' } }; }
const global = { kind: 'global' } as const;

describe('V2 native city inspector parity and scoped persistence', () => {
  it('represents every default layout/parcel leaf and every morphology field consumed by the native bench', () => {
    const fields = urbanControlFields(), paths = new Set(fields.map(field => field.path));
    expect(paths.size).toBe(fields.length);
    for (const leaf of scalarLeaves(defaultLayoutConfig(), 'layout')) expect(paths.has(leaf.path), leaf.path).toBe(true);
    for (const leaf of scalarLeaves(defaultParcelConfig(), 'parcels')) expect(paths.has(leaf.path), leaf.path).toBe(true);
    for (const [kind, stage] of [['quarters', 'layout'], ['parcels', 'parcels']] as const) for (const key of urbanCatalogue.fields[kind]) expect(fields.some(f => f.path === `${stage}.params.${key}` || f.path.startsWith(`${stage}.params.${key}.`)), `${stage}.${key}`).toBe(true);
    expect(paths.has('layout.footprint.gapSize')).toBe(true); expect(paths.has('layout.programme.functions.port')).toBe(true);
    expect(paths.has('houses.house_config.overrides.roof_pitch_deg')).toBe(true);
    expect(paths.has('houses.house_config.workshop.support.height_m.1')).toBe(true);
  });
  it('does not load houses WASM for source defaults and keeps them identical to the shared native bridge', () => {
    expect(houseControlDefaults()).toEqual(defaultHouseConfig());
  });
  it('changes a range endpoint without creating sparse arrays, resets to the selected preset and preserves all other endpoints', () => {
    const config = settings(), before = urbanEffectiveValues(config, global) as any;
    const spacing = before.layout.params.gridSpacing as number[];
    writeUrbanControl(config, global, 'layout.params.gridSpacing.1', 117);
    expect(config.urban?.layout?.params?.gridSpacing).toEqual([spacing[0], 117]);
    writeUrbanControl(config, global, 'layout.params.gridSpacing.1', undefined);
    expect(config.urban?.layout?.params?.gridSpacing).toBeUndefined();
    const preset = Object.entries(urbanCatalogue.presets).find(([, preset]) => Array.isArray(preset.params.gridSpacing) && JSON.stringify(preset.params.gridSpacing) !== JSON.stringify(spacing))!;
    writeUrbanControl(config, global, 'layout.preset', preset[0]);
    writeUrbanControl(config, global, 'layout.params.gridSpacing.0', 83);
    expect((config.urban?.layout?.params?.gridSpacing as number[])[1]).toBe((preset[1].params.gridSpacing as number[])[1]);
  });
  it('keeps global/local inheritance, native null and exact identifiers independent', () => {
    const config = settings(), local = { kind: 'settlement', key: 'east/main.v2' } as const;
    writeUrbanControl(config, global, 'layout.wallTowerSpacing', 37);
    writeUrbanControl(config, local, 'layout.wallTowerSpacing', null);
    expect((urbanEffectiveValues(config, local) as any).layout.wallTowerSpacing).toBeNull();
    writeUrbanControl(config, local, 'layout.wallTowerSpacing', undefined);
    expect((urbanEffectiveValues(config, local) as any).layout.wallTowerSpacing).toBe(37);
    const quarter = { kind: 'quarter', key: local.key, id: 'q/4.2' } as const;
    writeUrbanControl(config, quarter, 'wealth', .83);
    expect(config.urban!.local![local.key].layout?.overrides?.quarters?.['q/4.2'].wealth).toBe(.83);
    const building = { kind: 'building', key: local.key, id: 'b/1.3' } as const;
    writeUrbanControl(config, building, 'overrides.roof_pitch_deg', 42.5);
    expect(config.urban!.buildings![`${local.key}/b/1.3`].overrides?.roof_pitch_deg).toBe(42.5);
    expect(config.urban!.buildings!['b/1.3']).toBeUndefined();
    expect(urbanScopeValues(config, quarter)).toEqual({ wealth: .83 });
  });
  it('passes advanced geometry, functions, zones, parcel and exact house settings into the real runtime configuration unchanged', () => {
    const config = settings(), local = { kind: 'settlement', key: 'main' } as const;
    const fields: [string, unknown][] = [
      ['layout.footprint.gapSize', 213], ['layout.maxStreetGrade', .075], ['layout.fortificationStyle', 'wengcheng'], ['layout.portEnclosure', 'outside'], ['layout.programme.functions.port', .8],
      ['layout.phaseOverrides.faubourg.tissue', 'organic'], ['parcels.zoneOperators.faubourg', 'frontage'], ['parcels.params.frontage.core.1', 17], ['houses.parcel_fit', false], ['houses.house_config.overrides.roof', 'RF-GABLE'],
    ];
    for (const [path, value] of fields) writeUrbanControl(config, local, path, value);
    const resolved = resolveRustUrbanControls(config, 'main', config.options);
    expect(resolved.layout.footprint.gapSize).toBe(213); expect(resolved.layout.maxStreetGrade).toBe(.075);
    expect(resolved.layout.fortificationStyle).toBe('wengcheng'); expect(resolved.layout.portEnclosure).toBe('outside'); expect(resolved.layout.programme.functions?.port).toBe(.8);
    expect(resolved.layout.phaseOverrides?.faubourg.tissue).toBe('organic'); expect(resolved.parcels.zoneOperators?.faubourg).toBe('frontage');
    expect((resolved.parcels.params.frontage as Record<string, number[]>).core[1]).toBe(17);
    expect(resolved.houses.parcel_fit).toBe(false); expect(resolved.houses.house_config?.overrides.roof).toBe('RF-GABLE');
    expect(normalizeLayoutConfig(resolved.layout)).toEqual(resolved.layout); expect(normalizeParcelConfig(resolved.parcels)).toEqual(resolved.parcels);
    expect((urbanInheritedValues(config, local) as any).layout.maxStreetGrade).toBe(defaultLayoutConfig().maxStreetGrade);
  });
  it('registers English and French control and policy labels without translating native identifiers', () => {
    expect(translate('Footprint family', 'fr')).toBe('Famille d’emprise');
    expect(translate('Accessibility growth', 'fr')).toBe('Croissance par accessibilité');
    expect(translate('Strict historical', 'en')).toBe('Strict historical');
    expect(translate('roof_pitch_deg', 'fr')).toBe('roof_pitch_deg');
    expect(translate('1', 'fr')).toBe('1');
  });
  it('constructs complete optional workshop and support records when the first edit is a nested field', () => {
    const config = settings(), scope = { kind: 'building', key: 'main', id: 'native-request' } as const;
    writeUrbanControl(config, scope, 'workshop.support.kind', 'posts');
    writeUrbanControl(config, scope, 'workshop.support.height_m.1', 2.5);
    const workshop = config.urban!.buildings!['main/native-request'].workshop!;
    expect(workshop).toMatchObject({ preset_id: '', footprint: null, roof: null, width_m: null, depth_m: null, roof_frame: null, base: null });
    expect(workshop.support).toEqual({ kind: 'posts', material: null, height_m: [0, 2.5] });
  });
});
