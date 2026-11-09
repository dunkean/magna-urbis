import { describe, expect, it, vi } from 'vitest';
import { BRUSH, FAMILY_NAMES, createBrushLibrary, isReliefBrush, planPainting, type Atlas, type BrushFamily, type PaintSample } from '../../rust/bridge/fantasyPainting';
import { prepareFantasyTerrain, registerFantasyBrushes } from '../../rust/bridge/fantasyTerrain';
import type { TerrainData } from '../../rust/bridge/terrain';
import { fantasyClearance } from '../src/ui/fantasyRaster';

describe('illustration brush review regressions', () => {
  it('rejects roots inside retained water beyond the river centreline corridor, with dry bank crowns retained', () => {
    // No road or centreline pixels: only the drawn bank raster can clear these roots.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
      scale: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(2048 * 2048 * 4) }),
    }) }) });
    try {
      const clear = fantasyClearance({ seed: 'retained-bank', mapSize: 500,
        water: { x: 100, y: 200, width: 200, n: 2, alpha: new Uint8Array([0, 255, 0, 255]), key: 'drawn-banks' } });
      expect(clear.test(250, 250)).toBe(true);
      expect(clear.test(250, 350)).toBe(true);
      expect(clear.test(199, 250)).toBe(false);
      expect(clear.test(300, 250)).toBe(false);
      expect(clear.test(250, 199)).toBe(false);
      const sample = (x: number, y: number): PaintSample | undefined => x < 0 || y < 0 || x >= 500 || y >= 500 ? undefined
        : { height: 10, slope: .01, temperature: 18, rain: 1800, landuse: 'forest', cleared: clear.test(x, y) };
      for (const vegetation of ['coarse', 'fine'] as const) {
        const stamps = planPainting({ x: 0, y: 0, width: 500, height: 500 }, sample,
          { seed: 'bank-crowns', pitch: 20, brushPitch: 20, mapWidth: 500, vegetation });
        expect(stamps.length).toBeGreaterThan(0);
        expect(stamps.every(s => !clear.test(s.x, s.y))).toBe(true);
        if (vegetation === 'fine') expect(stamps.some(s => s.x < 200 && s.x + s.width / 2 > 200 && s.y > 200 && s.y < 400)).toBe(true);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps hills at physical scale across map and raster sizes and omits them on tiny maps', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
    const hill = (x: number, y: number): PaintSample | undefined => x < 0 || y < 0 || x >= 1000 || y >= 1000 ? undefined
      : { height: 100, slope: .12, relief: 50, tpi: .08, temperature: 16, rain: 600 };
    const options = { seed: 'physical-hills', pitch: 50, brushPitch: 50, reliefRef: 500, heightRange: [0, 400] as const, vegetation: 'coarse' as const };
    const relief = (mapWidth: number, raster: number) => planPainting(bounds, hill, { ...options, mapWidth, raster }).filter(s => isReliefBrush(s.brush));
    const a = relief(1000, 3400), b = relief(6000, 1400);
    expect(a.length).toBeGreaterThan(0);
    // Immense, low downs: 400-2000 m (with the per-stamp variation), never a function of the map or raster size.
    expect(a.every(s => s.brush === BRUSH.hills && s.width >= 400 * .85 && s.width <= 2000)).toBe(true);
    expect(a).toEqual(b);
    expect(relief(100, 3400)).toEqual([]);
  });

  it('leaves detailed fields and gardens to their actual crop strips, including irrigated desert plots', () => {
    for (const [temperature, rain] of [[16, 1200], [28, 100]]) for (const landuse of ['field', 'garden'] as const) {
      const stamps = planPainting({ x: 0, y: 0, width: 300, height: 300 },
        () => ({ height: 30, slope: .01, temperature, rain, landuse, landuseDetail: true }),
        { seed: 'irrigated-strips', pitch: 20, brushPitch: 20, mapWidth: 1000 });
      expect(stamps.some(s => s.brush === BRUSH.crops || isReliefBrush(s.brush))).toBe(false);
    }
  });

  it('keeps the multiple roots of woodland clumps on dry ground', () => {
    const sample = (x: number, y: number): PaintSample | undefined => x < 0 || y < 0 || x >= 1000 || y >= 1000 ? undefined
      : { height: 10, slope: .01, temperature: 18, rain: 1800, landuse: 'forest', water: x >= 600 };
    const stamps = planPainting({ x: 0, y: 0, width: 1000, height: 1000 }, sample,
      { seed: 'coastal-clumps', pitch: 20, brushPitch: 20, mapWidth: 1000, vegetation: 'coarse' });
    const clumps = stamps.filter(s => s.brush === BRUSH.woodland);
    expect(clumps.length).toBeGreaterThan(0);
    expect(clumps.every(s => s.x + .45 * s.width < 600)).toBe(true);
  });

  it('rejects positive-height roots labelled as sea by either hydrology source', () => {
    const atlas: Atlas = { url: 'test', width: 400, height: 400, rows: [0, .25, .5, .75, 1] };
    const families = Object.fromEntries(FAMILY_NAMES.map(f => [f, atlas])) as Record<BrushFamily, Atlas>;
    registerFantasyBrushes({ 'fantasy-color': createBrushLibrary('fantasy-color', families), 'fantasy-ink': createBrushLibrary('fantasy-ink', families) });
    for (const vector of [false, true]) {
      const sea = new Uint8Array([0, 1, 0, 1]), empty = new Uint8Array(4);
      const terrain = { x: 0, y: 0, width: 1000, resolution: 2, height: new Float32Array(4).fill(10), caveMask: new Uint8Array(),
        ...(vector ? { water: { hydro: { n: 2, sea }, lake: empty } }
          : { hydrology: { resolution: 2, seaMask: sea, waterField: new Float32Array(4) } }) } as unknown as TerrainData;
      const scene = prepareFantasyTerrain(terrain, 'fantasy-color', { seed: 'sea-roots', width: 1000 });
      expect(scene?.sample?.(750, 500)?.water).toBe(true);
      expect(scene?.sample?.(250, 500)?.water).toBe(false);
      expect(scene?.stamps.every(s => s.x < 500)).toBe(true);
      expect(scene?.fine?.({ x: 500, y: 0, width: 500, height: 1000 }).every(s => s.x < 500)).toBe(true);
    }
  });
});
