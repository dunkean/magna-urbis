import { describe, expect, it } from 'vitest';
import { appearanceCustomized, writeAppearanceControl } from '../src/v2/renderControls';
import { markStyleCustomized } from '../src/ui/renderStyleCustomization';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject } from '../src/v2/project';
import { STYLE_IDS } from '../src/render/composition';
import { paletteColors } from '../src/render/customColors';
import { PALETTES } from '../src/render/styles';

describe('customized render style indicator', () => {
  it('does not mark a preset selected without other changes', () => {
    for (const preset of STYLE_IDS) {
      const settings = defaultSettings(); writeAppearanceControl(settings, 'appearance.composition.preset', preset);
      expect(appearanceCustomized(settings), preset).toBe(false);
    }
  });
  it('compares layers, buildings and canopy with their preset defaults', () => {
    for (const [path, changed, reset] of [
      ['city.layers.streets', false, true], ['forest.density', .5, 1],
    ] as const) {
      const settings = defaultSettings(); writeAppearanceControl(settings, 'appearance.composition.preset', 'satellite');
      writeAppearanceControl(settings, `appearance.${path}`, changed); expect(appearanceCustomized(settings), path).toBe(true);
      writeAppearanceControl(settings, `appearance.${path}`, reset); expect(appearanceCustomized(settings), path).toBe(false);
    }
  });
  it('turns the preset to custom when a global effect changes', () => {
    const settings = defaultSettings(); writeAppearanceControl(settings, 'appearance.composition.preset', 'satellite');
    writeAppearanceControl(settings, 'appearance.composition.effects.lighting.azimuth', 90);
    expect(settings.appearance!.composition!.preset).toBe('custom');
  });
  it('retains the indicator after project reload and style changes, and removes it for reset or identical colours', () => {
    const settings = defaultSettings(); writeAppearanceControl(settings, 'appearance.composition.preset', 'parchment');
    writeAppearanceControl(settings, 'appearance.colors.road', '#a01080'); expect(appearanceCustomized(settings)).toBe(true);
    expect(appearanceCustomized(parseProject(serializeProject(settings)).settings)).toBe(true);
    writeAppearanceControl(settings, 'appearance.composition.preset', 'atlas'); expect(appearanceCustomized(settings)).toBe(true);
    writeAppearanceControl(settings, 'appearance.colors.road', undefined); expect(appearanceCustomized(settings)).toBe(false);
    writeAppearanceControl(settings, 'appearance.colors.road', paletteColors(PALETTES.atlas).road.toUpperCase());
    expect(appearanceCustomized(settings)).toBe(false);
  });
  it('decorates the selected translated label once without changing option text or identifiers', () => {
    const first = { text: 'Render · Neural Earth', value: 'render', selected: true, label: '' };
    const second = { text: 'Atlas', value: 'atlas', selected: false, label: '' };
    const select = { options: [first, second], dataset: {} } as unknown as HTMLSelectElement;
    markStyleCustomized(select, true); markStyleCustomized(select, true);
    expect(first.label).toBe('Render · Neural Earth *'); expect(first.text).toBe('Render · Neural Earth'); expect(first.value).toBe('render');
    expect(second.label).toBe('Atlas');
    first.text = 'Rendu d’origine'; markStyleCustomized(select, true); expect(first.label).toBe('Rendu d’origine *');
    markStyleCustomized(select, false); expect(first.label).toBe('Rendu d’origine');
  });
});
