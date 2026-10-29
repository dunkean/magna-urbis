import { describe, expect, it } from 'vitest';
import { applyRenderColors, COLOR_KEYS, paletteColors, supportsRenderColor, validateRenderColors } from '../src/render/customColors';
import { PALETTES } from '../src/render/styles';
import { terrainStyle } from '../src/render/terrainStyle';
import { waterMaterialPixels } from '../src/render/terrainWater';
import { hydrologyWaterColour } from '../../rust/bridge/hydrologyRender';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject, validateSettings } from '../src/v2/project';
import { terrainCacheKey } from '../src/v2/engine';
import { appearanceDisplayOptions, svgOptionsForDisplay } from '../src/v2/appearance';
import { sameDisplay } from '../src/v2/displayState';
import { readRenderColorsQuery, writeRenderColorsQuery } from '../src/ui/benchRenderColors';
import { v2DisplayForest } from '../src/v2/displayForest';
import type { World } from '../src/gen/types';
import { displayWorld } from '../src/render/displayWorld';

describe('shared render customization', () => {
  it('hides buildings independently of streets, parcels and gardens without changing the retained city', () => {
    const urban = { buildings: [{ kind: 'house' }], masses: [{}], landmarks: [{}], streets: [{}], parcels: [{}], backLand: [{}] } as unknown as NonNullable<World['urban']>;
    const world = { urban, settlements: [{ key: 'town', urban }], roads: [{}] } as unknown as World;
    const shown = displayWorld(world, undefined, false);
    expect(shown.urban?.buildings).toEqual([]); expect(shown.urban?.masses).toEqual([]);
    expect(shown.urban?.streets).toBe(urban.streets); expect(shown.urban?.parcels).toBe(urban.parcels); expect(shown.urban?.backLand).toBe(urban.backLand);
    expect(shown.settlements?.[0].urban?.buildings).toEqual([]); expect(world.urban).toBe(urban); expect(urban.buildings).toHaveLength(1);
    expect(displayWorld(world)).toBe(world);
  });
  it('isolates palette edits and restores the exact style when overrides are removed', () => {
    const original = structuredClone(PALETTES.parchment), defaults = paletteColors(PALETTES.parchment);
    const edited = applyRenderColors(PALETTES.parchment, { groundLow: '#ff0000', forest: '#123456', road: '#abcdef', building: '#654321' });
    expect(edited.hypso).toEqual([[0, '#ff0000'], [1, defaults.groundHigh]]);
    expect(edited.land.forest).toBe('#123456'); expect(edited.treeFill).toBe('#123456');
    expect(edited.urban.street).toBe('#abcdef'); expect(edited.urban.mass).toBe('#654321');
    expect(PALETTES.parchment).toEqual(original);
    expect(applyRenderColors(PALETTES.parchment, {})).toBe(PALETTES.parchment);
    expect(terrainStyle('render3d')).toBe(terrainStyle('render3d', {}));
  });
  it('applies real water colours to the CPU raster and river adapter without changing source distances', () => {
    const distance = Float32Array.of(0, 1000), original = distance.slice();
    const water = terrainStyle('atlas', { waterShore: '#102030', waterDeep: '#a0b0c0' }).water;
    expect([...waterMaterialPixels(distance, water, 1000)]).toEqual([16, 32, 48, 160, 176, 192]);
    expect(hydrologyWaterColour('atlas', { river: '#010203' })).toBe('#010203');
    expect(distance).toEqual(original);
  });
  it('persists all tokens and visibility in V2 projects and exports without changing the terrain identity', () => {
    const settings = defaultSettings(), key = terrainCacheKey(settings);
    settings.appearance = { style: 'atlas', colors: Object.fromEntries(COLOR_KEYS.map(key => [key, '#12aBcD'])), roads: false, buildings: false, forest: { density: .5, clearings: .8 } };
    expect(() => validateSettings(settings)).not.toThrow();
    expect(parseProject(serializeProject(settings)).settings.appearance).toEqual(settings.appearance);
    expect(terrainCacheKey(settings)).toBe(key);
    const display = appearanceDisplayOptions(settings), exported = svgOptionsForDisplay({ layers: { water: false } }, display);
    expect(exported.colors).toEqual(settings.appearance.colors);
    expect(exported.layers).toMatchObject({ roads: false, water: false }); expect(exported.buildings).toBe(false);
    expect(sameDisplay(display, { ...display, colors: { ...display.colors, road: '#ffffff' } })).toBe(false);
    expect(sameDisplay(display, { ...display, colors: Object.fromEntries(Object.entries(display.colors!).reverse()) })).toBe(true);
  });
  it('round trips bench colour tokens without dropping unrelated query settings or retaining resets', () => {
    const query = new URLSearchParams('seed=42&color_road=%23112233');
    const colors = readRenderColorsQuery(query); expect(colors).toEqual({ road: '#112233' });
    delete colors.road; colors.contour = '#abcdef'; writeRenderColorsQuery(query, colors);
    expect(query.get('seed')).toBe('42'); expect(query.has('color_road')).toBe(false);
    expect(readRenderColorsQuery(query)).toEqual(colors);
    expect(readRenderColorsQuery(new URLSearchParams('color_road=red&color_paper=%22%3E'))).toEqual({});
  });
  it('rejects malformed or unknown colour tokens at the project boundary', () => {
    for (const value of [[], null, { road: 'red' }, { road: '#fff' }, { road: 'url(#paint)' }, { imaginary: '#123456' }])
      expect(() => validateRenderColors(value)).toThrow();
    expect(() => validateRenderColors({ road: '#A0b1C2' })).not.toThrow();
    expect(supportsRenderColor('groundLow', 'render-v2')).toBe(false);
    expect(supportsRenderColor('river', 'render-v2')).toBe(false);
    expect(supportsRenderColor('contour', 'render-v2')).toBe(true);
  });
  it('repaints satellite canopy over retained heights and caches it without changing terrain or generation settings', () => {
    const settings = defaultSettings(); settings.terrain = { forest: { enabled: true, density: 1, clearings: .45 } };
    const n = 8, height = new Float32Array(n * n).fill(100), water = new Uint8Array(n * n);
    const world = { seed: '42', mapSize: 128, terrain: { height: { w: n, h: n, cell: 16, data: height }, water } } as World;
    const before = height.slice(), recipe = structuredClone(settings.terrain), key = terrainCacheKey(settings);
    settings.appearance = { style: 'atlas', terrainStyle: 'render-v2', forest: { density: .3 } };
    const field = v2DisplayForest(world, settings);
    expect(field?.clearingProfile).toBe('progressive'); expect(v2DisplayForest(world, settings)).toBe(field);
    settings.appearance.forest = { enabled: false }; expect(v2DisplayForest(world, settings)).toBeUndefined();
    expect(height).toEqual(before); expect(settings.terrain).toEqual(recipe); expect(terrainCacheKey(settings)).toBe(key);
  });
});
