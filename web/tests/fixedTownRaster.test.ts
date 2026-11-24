import { describe, expect, it } from 'vitest';
import { ALL_SHEET_PIXELS, FixedTownRaster, TOWN_SHEET_PIXELS, townRasterLayout } from '../src/render/city/canvas/fixedTownRaster';

describe('fixed cadastral town sheets', () => {
  it('skips unbuilt towns and keeps the original indices of the populated towns', () => {
    const tiles = townRasterLayout([
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      { minX: 100, minY: 200, maxX: 120, maxY: 240 },
    ]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].town).toBe(1);
    expect(Object.values(tiles[0].rect).every(Number.isFinite)).toBe(true);
  });
  it('bounds each town and each canvas independently of viewing scale', () => {
    const bounds = [{ minX: 100, minY: 200, maxX: 10100, maxY: 8200 }];
    const tiles = townRasterLayout(bounds);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.every(t => t.width <= 1024 && t.height <= 1024)).toBe(true);
    const pixels = (list: typeof tiles) => list.reduce((sum, t) => sum + t.width * t.height, 0);
    expect(pixels(tiles)).toBeLessThan(TOWN_SHEET_PIXELS * 1.01);
    expect(new Set(tiles.map(t => t.scale)).size).toBe(1);
    // A 1.5 km town keeps more than three pixels per metre; many towns share the total.
    const town = { minX: 0, minY: 0, maxX: 1500, maxY: 1500 };
    expect(townRasterLayout([town])[0].scale).toBeGreaterThan(3);
    expect(pixels(townRasterLayout([town, town, town, town, town]))).toBeLessThan(ALL_SHEET_PIXELS * 1.01);
  });
  it('retains completed content and repaints only when its content key changes', () => {
    const raster = new FixedTownRaster((w, h) => ({ width: w, height: h, getContext: () => ({}) }) as unknown as OffscreenCanvas);
    const bounds = [{ minX: 0, minY: 0, maxX: 10, maxY: 10 }];
    let paints = 0;
    function* paint() {
      paints++;
      yield;
    }
    raster.ensure('town-look-A', bounds);
    raster.work(paint);
    raster.ensure('town-look-A', bounds);
    raster.work(paint);
    expect(paints).toBe(1);
    raster.ensure('town-look-B', bounds);
    raster.work(paint);
    expect(paints).toBe(2);
  });
});
