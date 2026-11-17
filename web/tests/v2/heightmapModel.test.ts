import { describe, expect, it } from 'vitest';
import { zlibSync, strToU8 } from 'fflate';
import { acceptHeightmap, fitHeightmap, heightmapPixels, imageHeightmap, setHeightmapDefinition } from '../../src/v2/heightmapModel';
import { defaultSettings, adaptedExtent } from '../../src/v2/settings';
import { effectiveTerrainSettings, validateTerrainSettings } from '../../src/v2/terrainSettings';
import { serializeProject, parseProject, validateSettings } from '../../src/v2/project';
import { terrainCacheKey } from '../../src/v2/engine';
import { localeMessages } from '../../src/v2/localeMessages';
import { terrainStageValidityKeys } from '../../src/v2/stageValidity';
import { readHeightmap, heightmapPng } from '../../src/ui/terrainHeightmap';

const fit = { black: 0, white: 1200, scale: 1, datum: 0, crop: 100 };
const raster = (n = 32) => ({ version: 1 as const, resolution: n, heights: Array.from({ length: n * n }, (_, i): number => i % 2 ? 1200 : 0), processing: 'surface' as const });
const nativeSpacing = (s: ReturnType<typeof defaultSettings>) => adaptedExtent(s) / heightmapPixels(s)!;

describe('imported heightmap footprint and elevations', () => {
  it('links Size and editable Definition through the fixed image pixels, independent of procedural spacing', () => {
    const s = defaultSettings(); s.extent = 20000; s.terrain!.sampleSpacing = 100;
    const source = raster(512); acceptHeightmap(s, { terrain: source }, 'map.png');
    expect(s.extent).toBe(20000); expect(nativeSpacing(s)).toBe(39.0625);
    s.extent = 40000; expect(nativeSpacing(s)).toBe(78.125);
    expect(setHeightmapDefinition(s, 25)).toBe(true);
    expect(s.extent).toBe(12800); expect(heightmapPixels(s)).toBe(512);
    expect(s.terrain!.sketch).toBe(source);
    expect(() => validateTerrainSettings(s.terrain)).not.toThrow();
    expect(() => validateSettings(s)).not.toThrow();
    expect(effectiveTerrainSettings(s, 12800).sampleSpacing).toBe(25);
    expect(setHeightmapDefinition(s, NaN)).toBe(false);
    const symbolic = defaultSettings(); symbolic.terrain!.zones = { version: 1, resolution: 128, weights: Array(128 ** 2 * 5).fill(0) };
    expect(setHeightmapDefinition(symbolic, 25)).toBe(false);
  });

  it('restores embedded width and elevations from an exported PNG', async () => {
    const source = raster(); source.heights[0] = -50; source.heights[1] = 1800;
    const loaded = await readHeightmap(new File([new Uint8Array(heightmapPng(source, 20000)).buffer], 'export.png'), 0, 1200);
    const s = defaultSettings(); acceptHeightmap(s, loaded, 'export.png');
    expect(s.extent).toBe(20000); expect(loaded.elevationRange).toBeUndefined();
    expect(loaded.terrain.heights[0]).toBeCloseTo(-50, 1); expect(loaded.terrain.heights[1]).toBeCloseTo(1800, 1);
  });

  it('maps actual 8-bit PNG black and white to explicit signed metre elevations', async () => {
    // A grayscale PNG without application metadata; filter 0 on every row.
    const chunk = (name: string, bytes: Uint8Array) => {
      const out = new Uint8Array(bytes.length + 12); new DataView(out.buffer).setUint32(0, bytes.length);
      out.set(strToU8(name), 4); out.set(bytes, 8); return out;
    };
    const header = new Uint8Array(13); const view = new DataView(header.buffer); view.setUint32(0, 8); view.setUint32(4, 8); header[8] = 8;
    const raw = new Uint8Array(8 * 9); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) raw[y * 9 + x + 1] = x % 2 ? 255 : 0;
    const file = new File([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())], 'ordinary.png');
    const loaded = await readHeightmap(file, 0, 1200);
    expect(loaded.width).toBeUndefined(); expect(loaded.elevationRange).toEqual([0, 1200]);
    const output = fitHeightmap(loaded.terrain, { ...fit, black: -50, white: 1800 }, loaded.elevationRange);
    expect(output.heights[0]).toBe(-50); expect(output.heights[1]).toBe(1800);
    const adjusted = fitHeightmap(loaded.terrain, { ...fit, black: -50, white: 1800, scale: 2, datum: 100 }, loaded.elevationRange);
    expect(adjusted.heights[0]).toBe(-300); expect(adjusted.heights[1]).toBe(3400);
  });

  it('uses the same black/white mapping for the general image importer', () => {
    const rgba = new Uint8Array(8 * 8 * 4); for (let i = 0; i < 64; i++) rgba.set(i % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4);
    const loaded = imageHeightmap({ w: 8, h: 8, rgba });
    const output = fitHeightmap(loaded.terrain, { ...fit, black: -100, white: 900 }, loaded.elevationRange);
    expect(output.heights[0]).toBe(-100); expect(output.heights[1]).toBeCloseTo(900);
  });

  it('crops actual source pixels and recomputes their native ground resolution', () => {
    const source = raster(64), cropped = fitHeightmap(source, { ...fit, crop: 50 });
    expect(cropped.resolution).toBe(32); expect(cropped.heights).toHaveLength(32 ** 2);
    expect(cropped.heights[0]).toBe(source.heights[16 * 64 + 16]);
    const s = defaultSettings(); acceptHeightmap(s, { terrain: cropped }, 'crop.png');
    expect(nativeSpacing(s)).toBe(6000 / 32);
    expect(fitHeightmap(source, fit).heights).toEqual(source.heights);
  });

  it('keeps import provenance and exact fitted elevations through recipe serialization', () => {
    const s = defaultSettings(), source = raster(64);
    acceptHeightmap(s, { terrain: source, width: 20000, elevationRange: [0, 1200] }, 'ordinary.png');
    const key = terrainCacheKey(s);
    const reopened = parseProject(serializeProject(s)).settings;
    expect(reopened.terrain!.heightmap).toEqual(s.terrain!.heightmap);
    expect(reopened.terrain!.sketch).toEqual(source);
    expect(nativeSpacing(reopened)).toBe(20000 / 64);
    expect(terrainCacheKey(reopened)).toBe(key);
    expect(effectiveTerrainSettings(reopened, 20000)).not.toHaveProperty('heightmap');
  });

  it('translates all new heightmap copy in the additional UI locales', () => {
    for (const catalog of Object.values(localeMessages)) for (const text of ['No heightmap loaded yet. Import one from the sidebar.', 'Elevation of black (m)', 'Elevation of white (m)', 'Size read from the file', 'Values below 0 m become sea. Increasing the datum lowers the terrain.', 'Image resolution: {resolution} {unit} per pixel', 'The image has {pixels} × {pixels} pixels: its size and its resolution go together.', 'Elevations, vertical scale, datum, crop']) expect(catalog[text], text).toBeTruthy();
  });

  it('invalidates relief, fit and hydrology after Size, Definition or elevations change', () => {
    const s = defaultSettings(); acceptHeightmap(s, { terrain: raster(64) }, 'map.png');
    let before = terrainStageValidityKeys(s);
    for (const edit of [() => { s.extent = 10000; }, () => { setHeightmapDefinition(s, 50); }, () => { s.terrain!.sketch!.heights[0] = -50; }]) {
      edit(); const after = terrainStageValidityKeys(s);
      for (const id of ['relief-source', 'relief-heightmap-fit', 'relief-refine', 'water-hydrology']) {
        expect(before.get(id), id).toBeDefined(); expect(after.get(id), id).not.toBe(before.get(id));
      }
      before = after;
    }
  });
});
