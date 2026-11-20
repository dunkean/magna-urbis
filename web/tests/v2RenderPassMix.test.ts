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
    const components: RenderMixComponent[] = ['ground', 'vegetation', 'buildings', 'text', 'lighting'];
    for (const component of components)
      for (const preset of PRESET_IDS) {
        const settings = defaultSettings(),
          original = structuredClone(settings),
          key = terrainCacheKey(settings);
        mixRenderStyle(settings, component, preset);
        expect(() => validateSettings(settings), `${component}: ${preset}`).not.toThrow();
        expect(terrainCacheKey(settings)).toBe(key);
        // New recipes carry a default appearance (settings.ts): compare the generation inputs on both sides.
        const { appearance: _appearance, ...generation } = settings,
          { appearance: _original, ...originalGeneration } = original;
        expect(generation).toEqual(originalGeneration);
      }
  });

  it('mixes vegetation while keeping the selected ground and its network looks', () => {
    const settings = defaultSettings();
    writeAppearanceControl(settings, 'appearance.composition.preset', 'satellite');
    const original = structuredClone(currentComposition(settings));
    mixRenderStyle(settings, 'vegetation', 'parchment');
    expect(currentComposition(settings).vegetation.look).toBe('symbols');
    expect(currentComposition(settings).ground).toEqual(original.ground);
    const { networks } = resolveSettingsAppearance(settings, undefined, 'view2d').composition;
    expect(networks.water).toMatchObject({ look: 'natural', visible: true });
    expect(networks.roads.look).toBe('rendered');
  });

  it('shares the view plan policy and Roads switch across 2D, 3D and export', () => {
    const settings = defaultSettings();
    expect(resolveSettingsAppearance(settings, undefined, 'view3d').city.textured).toBe(false);
    writeAppearanceControl(settings, 'appearance.composition.preset', 'satellite');
    writeAppearanceControl(settings, 'appearance.composition.networks.roads.visible', false);
    for (const target of ['view2d', 'view3d', 'export'] as const) {
      const result = resolveSettingsAppearance(settings, undefined, target);
      expect(result.city.plan).toBe(false);
      for (const name of ['parcels', 'quarters', 'blocks', 'fronts', 'access'] as const) expect(result.city.layers[name]).toBe(false);
      expect(result.composition.networks.roads).toMatchObject({ look: 'rendered', visible: false });
      expect(result.city.layers.streets).toBe(true);
    }
    writeAppearanceControl(settings, 'appearance.composition.preset', 'cadastre');
    const cadastre = resolveSettingsAppearance(settings, undefined, 'view2d');
    expect(cadastre.city.plan).toBe(true);
    expect(cadastre.city.layers.parcels).toBe(true);
    expect(cadastre.composition.networks.roads).toMatchObject({ look: 'ink', visible: true });
  });
});
