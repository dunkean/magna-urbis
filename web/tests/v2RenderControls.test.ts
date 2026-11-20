import { describe, expect, it } from 'vitest';
import { renderControlFields, renderControlMessages, renderControlValues, writeAppearanceControl } from '../src/v2/renderControls';
import { defaultSettings } from '../src/v2/settings';
import { validateSettings, parseProject, serializeProject } from '../src/v2/project';
import { readSettingPath } from '../src/v2/parameterForm';
import { DIAGNOSTICS } from '../src/render/displayDiagnostics';
import { terrainCacheKey } from '../src/v2/engine';
import { ROOF_MODES } from '../src/render/roofMode';

describe('V2 retained-map render controls', () => {
  it('exposes physical city layers and existing terrain diagnostics without duplicate controls', () => {
    const paths = renderControlFields.map(field => field.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every(path => path.startsWith('appearance.'))).toBe(true);
    expect(paths.filter(path => path.startsWith('appearance.city.layers.'))).toEqual(['streets', 'enclosures', 'lotEnclosures', 'gardens', 'places'].map(name => `appearance.city.layers.${name}`));
    expect(renderControlFields.find(field => field.path === 'appearance.diagnostic')?.options?.map(choice => choice.value)).toEqual(DIAGNOSTICS.map(diagnostic => diagnostic.id));
    expect(renderControlFields.find(field => field.path === 'appearance.city.view')?.options).toHaveLength(5);
    expect(renderControlFields.find(field => field.path === 'appearance.city.palette')?.options).toHaveLength(5);
    const roof = renderControlFields.find(field => field.path === 'appearance.composition.buildings.roof');
    expect(roof?.options?.map(choice => choice.value)).toEqual(ROOF_MODES);
    expect(roof?.defaultValue).toBe('v2');
  });
  it('marks roof edits as custom, preserves them across ground edits, and applies the next preset default', () => {
    const settings = defaultSettings();
    writeAppearanceControl(settings, 'appearance.composition.buildings.roof', 'flat');
    expect(settings.appearance?.composition).toMatchObject({ preset: 'custom', buildings: { roof: 'flat' } });
    writeAppearanceControl(settings, 'appearance.composition.ground.variant', 'parchment');
    expect(settings.appearance?.composition?.buildings.roof).toBe('flat');
    writeAppearanceControl(settings, 'appearance.composition.preset', 'satellite');
    expect(settings.appearance?.composition).toMatchObject({ preset: 'satellite', buildings: { roof: 'v2' } });
  });
  it('accepts every displayed numeric bound and choice without changing generation inputs', () => {
    for (const field of renderControlFields) {
      const choices = field.type === 'number' ? [field.min, field.max] : field.type === 'boolean' ? [false, true] : (field.options?.map(option => option.value).filter(value => value !== 'custom') ?? []);
      for (const choice of choices) {
        const settings = defaultSettings(),
          generation = structuredClone(settings),
          key = terrainCacheKey(settings);
        delete generation.appearance;
        const value = field.fromInput ? field.fromInput(choice) : choice;
        writeAppearanceControl(settings, field.path, value);
        expect(() => validateSettings(settings), `${field.path} = ${choice}`).not.toThrow();
        expect(terrainCacheKey(settings)).toBe(key);
        const { appearance: _appearance, ...unchanged } = settings;
        expect(unchanged).toEqual(generation);
        expect(readSettingPath(parseProject(serializeProject(settings)).settings, field.path)).toEqual(value);
      }
    }
  });
  it('reads legacy and style-dependent defaults without expanding a saved recipe or losing inactive values', () => {
    const settings = defaultSettings(),
      original = structuredClone(settings);
    const defaults = renderControlValues(settings);
    expect(defaults.renderer).toBe('bench');
    expect(defaults.city?.painted).toBe(true);
    expect(settings).toEqual(original);
    writeAppearanceControl(settings, 'appearance.composition.effects.lighting.strength', 2.2);
    expect(settings.appearance?.composition?.effects.lighting).toMatchObject({ enabled: true, azimuth: 315, elevation: 45, strength: 2.2, exaggeration: 2 });
    expect(settings.appearance).not.toHaveProperty('fantasy');
    settings.appearance!.city = { layers: { fronts: true } };
    expect(renderControlValues(settings).city?.layers?.fronts).toBe(false);
    writeAppearanceControl(settings, 'appearance.composition.preset', 'satellite');
    expect(renderControlValues(settings).city?.painted).toBe(true);
    expect(settings.appearance?.composition?.effects.lighting.strength).toBe(2.2);
    expect(settings.appearance?.city?.layers?.fronts).toBe(true);
  });
  it('has intentional English and French copy for every field and choice', () => {
    for (const field of renderControlFields)
      for (const text of [field.label, field.help, ...(field.options?.map(option => option.label) ?? [])]) {
        if (text) {
          expect(renderControlMessages[text]?.en, text).toBeTruthy();
          expect(renderControlMessages[text]?.fr, text).toBeTruthy();
        }
      }
  });
});
