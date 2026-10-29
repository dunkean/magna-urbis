import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject, validateSettings } from '../src/v2/project';
import { terrainCacheKey } from '../src/v2/engine';
import { appearanceDisplayOptions, CITY_LAYER_NAMES, svgOptionsForDisplay, validateAppearance } from '../src/v2/appearance';
import { DEFAULT_TERRAIN_LIGHTING, DEFAULT_TERRAIN_LAYERS } from '../src/render/terrainLighting';
import { TERRAIN_STYLE_LIST } from '../src/render/terrainStyle';
import { DIAGNOSTICS } from '../src/render/displayDiagnostics';
import type { V2Appearance } from '../src/v2/contracts';

const complete = (): V2Appearance => ({ style: 'parchment', terrainStyle: 'render-v2', renderer: 'bench',
  contours: false, landuse: false, labels: false, legend: false, cartouche: false, painted: true, textured: true,
  vegetation: 'canopy', lighting: { ...DEFAULT_TERRAIN_LIGHTING, azimuth: 120, strength: 2.5 },
  terrainLayers: { relief: true, hypsometry: false, frame: false, water: true }, diagnostic: 'v-basins', lakes: false, oxbows: false,
  season: .75, fantasy: { density: 1.5, size: .5, spacing: .8, followLanduse: true },
  city: { view: 'buildings', palette: 'terrain', buildingStyle: 'cartographic', diagnostic: 'height',
    layers: Object.fromEntries(CITY_LAYER_NAMES.map(layer => [layer, layer === 'gardens'])),
    groundBlend: 'blended', opacity: .75, width: 1.2, painted: true,
    ground: 'render-v2', plan: false, colors: 'uses', exaggeration: 2.5, refinement: 'noise' } });

describe('V2 appearance recipes and export snapshots', () => {
  it('round trips the complete bench display recipe without changing the generation cache key', () => {
    const settings = defaultSettings(), key = terrainCacheKey(settings);
    settings.appearance = complete();
    expect(() => validateSettings(settings)).not.toThrow();
    expect(terrainCacheKey(settings)).toBe(key);
    const loaded = parseProject(serializeProject(settings)).settings;
    expect(loaded.appearance).toEqual(settings.appearance);
    expect(terrainCacheKey(loaded)).toBe(key);
    for (const style of TERRAIN_STYLE_LIST) {
      settings.appearance.terrainStyle = style.id;
      expect(parseProject(serializeProject(settings)).settings.appearance?.terrainStyle).toBe(style.id);
      expect(terrainCacheKey(settings)).toBe(key);
    }
    for (const diagnostic of DIAGNOSTICS) {
      settings.appearance.diagnostic = diagnostic.id;
      expect(() => validateSettings(settings), diagnostic.id).not.toThrow();
    }
  });
  it('preserves absent and original palette-only appearance settings without inserting new defaults', () => {
    const settings = defaultSettings();
    expect(parseProject(serializeProject(settings)).settings.appearance).toBeUndefined();
    settings.appearance = { style: 'atlas', contours: false, textured: false };
    expect(parseProject(serializeProject(settings)).settings.appearance).toEqual(settings.appearance);
    expect(settings.appearance).not.toHaveProperty('renderer');
  });
  it('validates the real bench ranges and rejects invalid display enums, flags and partial required structures', () => {
    for (const patch of [
      { terrainStyle: 'satellite' }, { style: 'render-v2' }, { renderer: 'native' }, { vegetation: 'pbr' },
      { diagnostic: 'fake-water' }, { season: -1 }, { season: 1.01 }, { painted: 'yes' }, { lakes: 0 },
      { lighting: { ...DEFAULT_TERRAIN_LIGHTING, azimuth: 361 } }, { lighting: { ...DEFAULT_TERRAIN_LIGHTING, elevation: 4 } },
      { lighting: { ...DEFAULT_TERRAIN_LIGHTING, strength: 3.1 } }, { lighting: { enabled: true } },
      { terrainLayers: { ...DEFAULT_TERRAIN_LAYERS, relief: 1 } }, { terrainLayers: { water: true } },
      { fantasy: { density: .2, size: 1, spacing: 1 } }, { fantasy: { density: 1, size: 2.1, spacing: 1 } },
      { city: { view: 'streets' } }, { city: { palette: 'satellite' } }, { city: { buildingStyle: 'mesh' } },
      { city: { diagnostic: 'snow' } }, { city: { opacity: 1.01 } }, { city: { width: 5.1 } },
      { city: { groundBlend: true } }, { city: { ground: 'fantasy-ink' } }, { city: { colors: 'height' } },
      { city: { exaggeration: .5 } }, { city: { refinement: 'neural' } }, { city: { painted: 1 } },
      { city: { layers: { gardens: 'yes' } } }, { city: { layers: { imaginary: true } } },
    ]) expect(() => validateAppearance({ style: 'parchment', ...patch }), JSON.stringify(patch)).toThrow();
    for (const lighting of [
      { enabled: false, azimuth: 0, elevation: 5, strength: 0, exaggeration: 0 },
      { enabled: true, azimuth: 360, elevation: 90, strength: 3, exaggeration: 10 },
    ]) expect(() => validateAppearance({ style: 'parchment', lighting })).not.toThrow();
    expect(() => validateAppearance({ style: 'parchment', season: 0, city: { opacity: 0, width: 0, exaggeration: 1 } })).not.toThrow();
    expect(() => validateAppearance({ style: 'parchment', season: 1, city: { opacity: 1, width: 5, exaggeration: 5 } })).not.toThrow();
  });
  it('uses persisted false flags in visual exports instead of generation-time layer defaults', () => {
    const settings = defaultSettings(); settings.options.contours = settings.options.landuse = settings.options.labels = settings.options.legend = true;
    settings.appearance = { style: 'night', contours: false, landuse: false, labels: false, legend: false, cartouche: false, painted: true, vegetation: 'canopy' };
    expect(appearanceDisplayOptions(settings)).toEqual({ ...settings.appearance });
    const sources = { version: 'retained-test-atlases', vegetation: 'data:image/png;base64,AAA', terrain: 'data:image/png;base64,BBB' };
    const snapshot = svgOptionsForDisplay({ width: 1600, style: 'atlas', contours: true, labels: true, legend: true,
      layers: { city: false } }, { ...appearanceDisplayOptions(settings), layers: { water: false, decor: false } }, sources);
    expect(snapshot).toMatchObject({ width: 1600, style: 'night', contours: false, landuse: false, labels: false, legend: false,
      cartouche: false, vegetation: 'canopy', layers: { water: false, decor: false }, brushes: sources });
    expect(svgOptionsForDisplay(snapshot, { painted: false }).brushes).toBeUndefined();
    expect(() => svgOptionsForDisplay({}, { painted: true })).toThrow('still loading');
    const legacy = { width: 3000, contours: false, brushes: sources };
    expect(svgOptionsForDisplay(legacy)).toBe(legacy);
  });
});
