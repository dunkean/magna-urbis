import { afterEach, describe, expect, it } from 'vitest';
import { setDisplayAppearanceQuality, setDisplayQualityPreference } from '../src/render/displayQuality';
import { lookVariant, mapPasses, speculativePrewarmAllowed } from '../src/ui/terrain/variant';
import { captureLook, lookPalettes } from '../src/ui/terrain/redraw';
import { writeLookParams, type LookBindings, type LookParamsState } from '../src/ui/terrain/lookParams';
import { DEFAULT_TERRAIN_LAYERS, DEFAULT_TERRAIN_LIGHTING } from '../src/render/terrainLighting';
import { DEFAULT_FRACTAL_DETAIL } from '../../rust/bridge/terrainAdjust';
import type { TerrainLook } from '../src/ui/terrain/contract';
import { landPainters, paintLandUseSteps } from '../src/render/cartography/landuse';
import { paintTextureLayerSteps } from '../src/render/cartography/symbols';
import { paintFieldTexture } from '../src/render/cartography/fields';
import { cityOverlayLandKinds } from '../src/render/cityEnvironment';
import { presetComposition } from '../src/render/composition';
import { resolveAppearance } from '../src/render/appearanceRecipe';

const lookOf = (style: TerrainLook['style']): TerrainLook => ({
  style,
  lighting: DEFAULT_TERRAIN_LIGHTING,
  layers: DEFAULT_TERRAIN_LAYERS,
  mapWidth: 10000,
  globalMin: -10,
  globalMax: 400,
  contours: false,
  contourStep: 10,
  flatRelief: false,
  refine: true,
  sourceCell: 20,
  seed: 1,
  detail: DEFAULT_FRACTAL_DETAIL,
  floor: 0,
  frame: false,
  background: '#fff',
  groundCover: true,
  independentCanopy: true,
  waterLook: 'natural',
});
afterEach(() => {
  setDisplayAppearanceQuality('full');
  setDisplayQualityPreference('auto');
});

describe('paper map tree symbols on the ground', () => {
  it('draw in the shaded paper ground at both qualities, on the brush atlas variant, never on other modes', () => {
    const paper = { ...lookOf('parchment'), groundCover: false, treeSymbols: { conifer: 0.14 } };
    setDisplayQualityPreference('full');
    expect(lookVariant(paper, false)).toEqual({ mode: 0, v2: 0, forest: false, brushes: true });
    setDisplayAppearanceQuality('light');
    expect(lookVariant(paper, false)).toEqual({ mode: 0, v2: 0, forest: false, brushes: true });
    expect(lookVariant({ ...paper, style: 'copernicus' }, false).brushes).toBe(false);
  });
});

describe('flat light look policy', () => {
  it.each(['render-v2', 'parchment'] as const)('removes optional ground passes for %s and preserves full capture variants', style => {
    setDisplayQualityPreference('full');
    const look = lookOf(style),
      full = lookVariant(look, true);
    setDisplayAppearanceQuality('light');
    const light = lookVariant(look, true);
    expect(light).toEqual({ mode: 0, v2: 0, forest: false, brushes: false });
    expect(mapPasses(light)).toEqual(['map']);
    expect(speculativePrewarmAllowed()).toBe(false);
    expect(lookVariant(captureLook(look, false), true)).toEqual(full);
  });
  it.each(['render-v2', 'parchment'] as const)('writes no light noise or crown inputs even at close zoom (%s)', style => {
    const values = new Map<string, unknown>();
    const bindings = new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args: unknown[]) => {
            values.set(String(name) + ':' + String(args[0]), args.slice(1));
          },
      },
    ) as LookBindings;
    const look = lookOf(style);
    const state: LookParamsState = { look, quality: 1, frame: { width: 512, height: 512, origin: [0, 0], px: 0.02 }, stylePixelRatio: 1, dpr: 1, scale: 50, palettes: lookPalettes(look), mode: 0, forest: true, coastal: false, lake: 0, lakeN: 1, overlay: false, city: [0, 0] };
    writeLookParams(bindings, state);
    for (const name of ['uRenderV2', 'uRefine', 'uOctaves', 'uEnhanced3d', 'uNaturalWater']) expect(values.get('int:' + name)).toEqual([0]);
    expect(values.has('forest:false')).toBe(true);
    expect(values.has('shoreRing:0')).toBe(true);
    values.clear();
    writeLookParams(bindings, { ...state, quality: 0 });
    expect(values.get('int:uRefine')).toEqual([1]);
    expect(values.get('int:uOctaves')).toEqual([8]);
  });
  it.each(['satellite', 'parchment'] as const)('keeps flat rural classes on %s light and preserves the full export policy', base => {
    const composition = presetComposition(`${base}-light`);
    const live = resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, 'view2d');
    expect(cityOverlayLandKinds(live)).toBe(true);
    const exported = resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, 'export');
    const original = resolveAppearance({ style: 'parchment', composition: presetComposition(base) }, { mapStyle: 'parchment' }, { nativeCities: true }, 'export');
    expect(exported.quality).toBe('full');
    for (const kind of ['field', 'forest', 'meadow'] as const) {
      const accepts = (r: typeof live) => {
        const owns = cityOverlayLandKinds(r);
        return owns === true || owns(kind);
      };
      expect(accepts(exported)).toBe(accepts(original));
    }
    expect(composition.text).toEqual(presetComposition(base).text);
  });
  it('does not paint light-only polygons in a full capture of a light scene', () => {
    const c = {
      activeLight: false,
      deps: { fullLanduse: () => false },
      polyL: () => {
        throw new Error('Light-only polygon reached the full painter');
      },
    };
    expect([...paintLandUseSteps(c as never, { luOn: true } as never)]).toEqual([]);
  });
  it('uses one flat land fill and never constructs plant or furrow geometry in light', () => {
    const calls: unknown[][] = [];
    const c = { activeLight: true, pal: { land: { forest: '#345' }, landOpacity: 0.4 }, deps: {}, world: { options: { landuse: true } } };
    const painters = landPainters(c as never, { fillPolys: (...args: unknown[]) => calls.push(args) } as never);
    expect([...painters.fillLandSteps('lu-field', 'field')]).toEqual([]);
    expect(calls).toHaveLength(1);
    expect([...paintTextureLayerSteps({ activeLight: true } as never, {} as never)]).toEqual([]);
    expect(() => paintFieldTexture({ activeLight: true } as never, {} as never, 'field')).not.toThrow();
  });
});
