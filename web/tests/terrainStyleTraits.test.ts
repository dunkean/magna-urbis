import { describe, expect, it } from 'vitest';
import { TERRAIN_STYLE_LIST, styleTraits, terrainStyle, type TerrainStyle } from '../src/render/terrainStyle';
import { isMapStyle } from '../src/render/styles';
import { supportsRenderColor, type RenderColorKey } from '../src/render/customColors';
import { isFantasyStyle } from '../../rust/bridge/fantasyPainting';

// Old name-based predicates, kept inline as the oracle.
const oldRender3d = (s: string): boolean => s === 'render3d' || s === 'render3d-brush' || s.startsWith('render-v2');
const oldV2Number = (s: string): number => ({ 'render-v2': 1, 'render-v2-substrate': 2, 'render-v2-moisture': 3, 'render-v2-vegetation': 4, 'render-v2-snow': 5 } as Record<string, number>)[s] ?? 0;
const oldSupports = (key: string, s: string): boolean => {
  if (['groundLow', 'groundHigh', 'forest', 'meadow'].includes(key)) return !/^(render|fantasy|copernicus)/.test(s);
  if (['waterShore', 'waterDeep', 'river'].includes(key)) return !s.startsWith('render-v2');
  if (key === 'contour') return !/^(fantasy|copernicus)/.test(s);
  return true;
};

describe('style traits', () => {
  const ids = [...TERRAIN_STYLE_LIST.map(style => style.id), 'copernicus'] as TerrainStyle[];
  it('reproduce the former name-based predicates for every style', () => {
    expect(ids.length).toBeGreaterThan(14);
    for (const id of ids) {
      const t = styleTraits(id);
      expect(terrainStyle(id).traits, id).toBe(t);
      expect(t.ground3d, id).toBe(oldRender3d(id));
      expect(t.satelliteVariant, id).toBe(oldV2Number(id));
      expect(t.forestClearingProfile, id).toBe(id.startsWith('render-v2') ? 'progressive' : undefined);
      expect(t.forestBrushes, id).toBe(id === 'render3d-brush');
      expect(t.waterAlwaysDrawn, id).toBe(id.startsWith('render-v2'));
      expect(t.physicalRiverWidth, id).toBe(id.startsWith('render-v2'));
      expect(t.seaInMaterial, id).toBe(id.startsWith('render-v2'));
      expect(t.neuralEarth, id).toBe(id === 'render');
      expect(!!t.fantasy, id).toBe(id === 'fantasy-ink' || id === 'fantasy-color');
      expect(isFantasyStyle(id), id).toBe(id === 'fantasy-ink' || id === 'fantasy-color');
      expect(t.elevation, id).toBe(id === 'copernicus');
      expect(t.cartographicVegetation, id).toBe(isMapStyle(id));
      expect(t.family === 'map', id).toBe(isMapStyle(id));
      expect(t.family === 'material', id).toBe(id.startsWith('render'));
      expect(t.family === 'brush', id).toBe(id.startsWith('fantasy'));
      expect(t.paintedCityByDefault, id).toBe(id.startsWith('render'));
      expect(!!t.variantOf, id).toBe(id.startsWith('render-v2-'));
      for (const key of ['groundLow', 'groundHigh', 'forest', 'meadow', 'waterShore', 'waterDeep', 'river', 'contour', 'paper'])
        expect(supportsRenderColor(key as RenderColorKey, id), `${id}.${key}`).toBe(oldSupports(key, id));
    }
    expect(styleTraits('city-ground-map').family).toBe('map');
    expect(styleTraits('').paintedCityByDefault).toBe(false);
  });
});
