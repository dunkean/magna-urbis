import { describe, expect, it } from 'vitest';
import { renderControlFields, renderControlMessages, renderControlValues, writeAppearanceControl } from '../src/v2/renderControls';
import { defaultSettings } from '../src/v2/settings';
import { validateSettings, parseProject, serializeProject } from '../src/v2/project';
import { readSettingPath } from '../src/v2/parameterForm';
import { CITY_LAYER_NAMES } from '../src/v2/appearance';
import { DIAGNOSTICS } from '../src/render/displayDiagnostics';
import { terrainCacheKey } from '../src/v2/engine';

describe('V2 retained-map render controls', () => {
  it('exposes every native city layer and the exact existing terrain diagnostics without duplicate controls', () => {
    const paths = renderControlFields.map(field => field.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every(path => path.startsWith('appearance.'))).toBe(true);
    for (const name of CITY_LAYER_NAMES) expect(paths).toContain(`appearance.city.layers.${name}`);
    expect(renderControlFields.find(field => field.path === 'appearance.diagnostic')?.options?.map(choice => choice.value)).toEqual(DIAGNOSTICS.map(diagnostic => diagnostic.id));
    expect(renderControlFields.find(field => field.path === 'appearance.city.view')?.options).toHaveLength(5);
    expect(renderControlFields.find(field => field.path === 'appearance.city.palette')?.options).toHaveLength(5);
  });
  it('accepts every displayed numeric bound and choice without changing generation inputs', () => {
    for (const field of renderControlFields) {
      const choices = field.type === 'number' ? [field.min, field.max] : field.type === 'boolean' ? [false, true] : field.options?.map(option => option.value) ?? [];
      for (const choice of choices) {
        const settings = defaultSettings(), generation = structuredClone(settings), key = terrainCacheKey(settings);
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
    const settings = defaultSettings(), original = structuredClone(settings);
    const defaults = renderControlValues(settings);
    expect(defaults.renderer).toBe('classic'); expect(defaults.city?.painted).toBe(false);
    expect(settings).toEqual(original);
    writeAppearanceControl(settings, 'appearance.lighting.strength', 2.2);
    expect(settings.appearance?.renderer).toBe('bench');
    expect(settings.appearance?.lighting).toMatchObject({ enabled: true, azimuth: 315, elevation: 45, strength: 2.2, exaggeration: 2 });
    expect(settings.appearance).not.toHaveProperty('fantasy');
    writeAppearanceControl(settings, 'appearance.city.layers.fronts', true);
    expect(settings.appearance?.city?.layers).toEqual({ fronts: true });
    settings.appearance!.terrainStyle = 'render-v2';
    expect(renderControlValues(settings).city?.painted).toBe(true);
    settings.appearance!.renderer = 'classic';
    expect(settings.appearance?.lighting?.strength).toBe(2.2);
    expect(settings.appearance?.city?.layers?.fronts).toBe(true);
  });
  it('has intentional English and French copy for every field and choice', () => {
    for (const field of renderControlFields) for (const text of [field.label, field.help, ...(field.options?.map(option => option.label) ?? [])]) {
      if (text) { expect(renderControlMessages[text]?.en, text).toBeTruthy(); expect(renderControlMessages[text]?.fr, text).toBeTruthy(); }
    }
  });
});
