import { describe, expect, it } from 'vitest';
import { urbanPaintingMask } from '../../rust/bridge/urbanPaintingMask';
import type { Layout, Shape } from '../../rust/bridge/urban';

const rectangle = (a: number, b: number): Shape => ({ outer: [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }], holes: [] });
const layout = (allocated: Shape[], quarters: Shape[] = allocated): Layout => ({ key: 'main', quarters: quarters.map(shape => ({ shape })), structure: { allocated }, streets: [] } as unknown as Layout);

describe('Shared urban painting mask', () => {
  it('indexes smooth boundaries without replacing them with occupied raster cells', () => {
    const triangle = { outer: [{ x: 100, y: 100 }, { x: 280, y: 100 }, { x: 100, y: 280 }], holes: [] };
    const contains = urbanPaintingMask(1000, 10, { layouts: [layout([triangle])] });
    expect(contains(160, 160)).toBe(true);
    expect(contains(195, 195)).toBe(false); // Same cell, outside the actual contour.
  });
  it('uses allocated land and retains its holes instead of old calculation sectors', () => {
    const shape = rectangle(100, 400); shape.holes = [rectangle(150, 250).outer];
    const contains = urbanPaintingMask(1000, 10, { layouts: [layout([shape], [rectangle(0, 900)])] });
    expect(contains(120, 120)).toBe(true);
    expect(contains(175, 175)).toBe(false);
    expect(contains(600, 600)).toBe(false);
  });
  it('replaces the preliminary city radius when its native layout is available', () => {
    const city = { key: 'main', center: { x: 200, y: 200 }, radius: 200 };
    expect(urbanPaintingMask(1000, 10, { cities: [city] })(350, 200)).toBe(true);
    const contains = urbanPaintingMask(1000, 10, { cities: [city], layouts: [layout([rectangle(100, 300)])] });
    expect(contains(350, 200)).toBe(false);
    expect(contains(200, 200)).toBe(true);
  });
});
