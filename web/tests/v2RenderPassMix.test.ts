import { describe, expect, it } from 'vitest';
import { mixRenderStyle, type RenderMixComponent } from '../src/v2/renderPassMix';
import { defaultSettings } from '../src/v2/settings';
import { validateSettings } from '../src/v2/project';
import { terrainCacheKey } from '../src/v2/engine';
import { currentComposition, writeAppearanceControl } from '../src/v2/renderControls';
import { PRESET_IDS } from '../src/render/composition';
import { resolveSettingsAppearance } from '../src/v2/appearance';

describe('mixing existing display components', () => {
  it('accepts every component and source style without altering any generation input', () => {
    const components: RenderMixComponent[] = ['ground', 'water', 'roads', 'vegetation', 'buildings', 'text', 'lighting', 'plan'];
    for (const component of components) for (const preset of PRESET_IDS) {
      const settings = defaultSettings(), original = structuredClone(settings), key = terrainCacheKey(settings);
      mixRenderStyle(settings, component, preset);
      expect(() => validateSettings(settings), `${component}: ${preset}`).not.toThrow();
      expect(terrainCacheKey(settings)).toBe(key);
      const { appearance: _appearance, ...generation } = settings;
      expect(generation).toEqual(original);
    }
  });

  it('mixes water and vegetation independently while preserving all other components and visibility', () => {
    const settings = defaultSettings();
    writeAppearanceControl(settings, 'appearance.composition.preset', 'satellite');
    writeAppearanceControl(settings, 'appearance.composition.networks.water.visible', false);
    const original = structuredClone(currentComposition(settings));
    mixRenderStyle(settings, 'water', 'cadastre');
    expect(currentComposition(settings)).toEqual({ ...original, preset: 'custom', networks: { ...original.networks, water: { ...original.networks.water, look: 'ink' } } });
    mixRenderStyle(settings, 'vegetation', 'parchment');
    expect(currentComposition(settings).vegetation.look).toBe('symbols');
    expect(currentComposition(settings).ground).toEqual(original.ground);
    expect(currentComposition(settings).networks.water.visible).toBe(false);
  });

  it('shares visibility across 2D, 3D and export and restores saved plan layer choices', () => {
    const settings = defaultSettings();
    expect(resolveSettingsAppearance(settings, undefined, 'view3d').city.textured).toBe(false);
    writeAppearanceControl(settings, 'appearance.city.layers.fronts', true);
    writeAppearanceControl(settings, 'appearance.city.plan', false);
    for (const target of ['view2d', 'view3d', 'export'] as const) {
      const result = resolveSettingsAppearance(settings, undefined, target);
      expect(result.city.plan).toBe(false);
      for (const name of ['parcels', 'quarters', 'blocks', 'streets', 'fronts', 'access'] as const) expect(result.city.layers[name]).toBe(false);
    }
    expect(settings.appearance!.city!.layers!.fronts).toBe(true);
    writeAppearanceControl(settings, 'appearance.city.plan', true);
    expect(resolveSettingsAppearance(settings, undefined, 'view2d').city.layers.fronts).toBe(true);
  });
});
