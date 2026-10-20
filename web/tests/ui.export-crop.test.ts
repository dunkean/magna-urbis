import { describe, expect, it } from 'vitest';
import { clampExportRect, exportPixelSize } from '../src/ui/exportCropGeometry';

describe('image export crop bounds and proportions', () => {
  const bounds = { x: 100, y: 200, width: 1600, height: 1200 };
  it('keeps a moved rectangle inside the map without changing its size', () => {
    expect(clampExportRect({ x: -40, y: 1500, width: 800, height: 400 }, bounds))
      .toEqual({ x: 100, y: 1000, width: 800, height: 400 });
  });
  it('limits oversized selections and keeps tiny selections nonempty', () => {
    expect(clampExportRect({ x: 0, y: 0, width: 9000, height: 9000 }, bounds)).toEqual(bounds);
    expect(clampExportRect({ x: 1700, y: 1400, width: 0, height: 0 }, bounds))
      .toEqual({ x: 1699, y: 1399, width: 1, height: 1 });
  });
  it('exports landscape and portrait crops at their selected aspect ratio', () => {
    expect(exportPixelSize({ x: 300, y: 400, width: 800, height: 400 }, 3000)).toEqual({ width: 3000, height: 1500 });
    expect(exportPixelSize({ x: 300, y: 400, width: 400, height: 800 }, 4096)).toEqual({ width: 2048, height: 4096 });
    expect(exportPixelSize(bounds, 3000)).toEqual({ width: 3000, height: 2250 });
  });
});
