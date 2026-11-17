import { describe, expect, it } from 'vitest';
import { builtCore, builtLandCentre, coreTolerance, publishedCentre } from '../../src/v2/builtCore';

const square = (x: number, y: number, half: number) => ({ outer: [{ x: x - half, y: y - half }, { x: x + half, y: y - half }, { x: x + half, y: y + half }, { x: x - half, y: y + half }] });
const block = (kind: string, x: number, y: number, half = 30) => ({ kind, shape: square(x, y, half) });

describe('built core of a place', () => {
  it('is the area-weighted centre of the built blocks, without the land given back to the fields', () => {
    const centre = builtLandCentre([{ blocks: [block('block', 100, 0, 10), block('block', 0, 0, 20), block('reserve', 900, 900, 50)] }])!;
    // Areas 400 and 1600: 20 % of the way from the large block to the small one.
    expect(centre.x).toBeCloseTo(20, 6);
    expect(centre.y).toBeCloseTo(0, 6);
    expect(builtLandCentre([{ blocks: [block('reserve', 0, 0)] }])).toBeUndefined();
    expect(builtLandCentre(undefined)).toBeUndefined();
  });

  it('is published when the town stands beside its placed centre (user map: a village moved 300 m to its landing)', () => {
    const placed = { x: 919, y: 5032 }, radius = 175;
    const core = builtCore([{ blocks: [block('block', 1060, 5322, 60)] }], placed, radius)!;
    expect(core.x).toBeCloseTo(1060, 6);
    expect(core.y).toBeCloseTo(5322, 6);
    expect(publishedCentre({ center: placed, core })).toEqual(core);
  });

  it('keeps the placed centre for a town built round it, and for a place with no building', () => {
    const placed = { x: 2000, y: 2000 }, radius = 175;
    expect(coreTolerance(radius)).toBeCloseTo(61.25, 6);
    expect(builtCore([{ blocks: [block('block', 2030, 1990, 80), block('place', 1990, 2010, 20)] }], placed, radius)).toBeUndefined();
    expect(builtCore([{ blocks: [block('reserve', 2400, 2400, 80)] }], placed, radius)).toBeUndefined();
    expect(publishedCentre({ center: placed })).toEqual(placed);
  });

  it('reads the buildings once they exist: a camp whose houses stand in one part of its land', () => {
    const placed = { x: 919, y: 5032 }, houses = [square(1080, 5270, 6), square(1090, 5290, 6)].map(s => ({ poly: s.outer }));
    const core = builtCore([{ blocks: [block('block', 1150, 5320, 90)] }], placed, 175, houses)!;
    expect(core.x).toBeCloseTo(1085, 6);
    expect(core.y).toBeCloseTo(5280, 6);
    // No building yet (plan only): the built land.
    expect(builtCore([{ blocks: [block('block', 1150, 5320, 90)] }], placed, 175, [])!.x).toBeCloseTo(1150, 6);
  });

  it('follows a farm built beside its road (a programme-reserved block is built land)', () => {
    const core = builtCore([{ blocks: [block('reserve:programme', 5452, 2423, 22)] }], { x: 5490, y: 2464 }, 45)!;
    expect(Math.hypot(core.x - 5452, core.y - 2423)).toBeLessThan(1e-6);
  });
});
