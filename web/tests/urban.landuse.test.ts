import { describe, expect, it } from 'vitest';
import type { UrbanLanduseInput } from '../src/ui/urbanLanduseData';
import { generateUrbanLanduse, urbanLanduseWorld } from '../src/ui/urbanLanduseData';
import { intersectionS, mpArea } from '../src/gen/geo/bool';
import type { PolyH } from '../src/gen/types';

const box = (x: number, y: number, w: number, h = w): PolyH => ({
  outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [],
});
function fixture(): UrbanLanduseInput {
  const n = 96, height = new Float32Array(n * n).fill(24), water = new Uint8Array(n * n);
  const waterLevel = height.slice(), riverWidth = new Float32Array(n * n), riverIds = new Int32Array(n * n).fill(-1);
  for (let y = 0; y < n; y++) for (let x = 0; x < 3; x++) {
    const i = y * n + x; water[i] = 3; height[i] = 5; waterLevel[i] = 18; riverWidth[i] = 70; riverIds[i] = 0;
  }
  return { raster: { n, width: 2400, height, water, waterLevel, riverWidth, riverIds }, seed: '42', biome: 'temperate', relief: 'flat',
    city: { key: 'city', center: { x: 1150, y: 1150 }, population: 3000, culture: 'european-organic', radius: 380 }, neighbours: [],
    layouts: [{ key: 'city', center: { x: 1150, y: 1150 }, culture: 'european-organic', warnings: [], blocks: [], streets: [],
      quarters: [{ shape: box(1000, 1000, 350, 550), phase: 0 }, { shape: box(1350, 1250, 450, 300), phase: 0 }] }],
  };
}

describe('Urban Bench countryside on retained plans', () => {
  it('reserves the real quarters without houses, keeps strips and source buffers deterministic', () => {
    const input = fixture(), before = structuredClone(input);
    const a = generateUrbanLanduse(input), b = generateUrbanLanduse(input);
    expect(a.landuse).toEqual(b.landuse);
    expect(input).toEqual(before);
    expect(a.landuse!.farmsteads).toEqual([]);
    expect(a.landuse!.areas.some(area => area.kind === 'field' && area.strips?.length)).toBe(true);
    const quarters = input.layouts![0].quarters.map(q => q.shape);
    for (const area of a.landuse!.areas) {
      expect(mpArea(intersectionS([{ outer: area.poly, holes: area.holes ?? [] }], quarters))).toBeLessThan(0.01);
      for (const strip of area.strips ?? []) expect(mpArea(intersectionS(strip, quarters))).toBeLessThan(0.01);
      for (const point of area.poly) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        expect(point.x).toBeGreaterThan(75);
      }
    }
  });

  it('uses the retained water surface and excludes cavern rock from irrigation sources', () => {
    const input = fixture();
    input.raster.water[30 * 96 + 50] = 4;
    input.raster.waterLevel[30 * 96 + 50] = 100;
    const world = urbanLanduseWorld(input), fields = world.site!.fields;
    expect(fields.hab[30 * 96 + 4]).toBeCloseTo(6);
    expect(fields.dWater[30 * 96 + 50]).toBeGreaterThan(1000);
    expect(world.terrain.height.data).toBe(input.raster.height);
    expect(world.site!.center).toEqual(input.city!.center);
  });

  it('lets countryside occupy retained open-fringe reserves while protecting built blocks', () => {
    const input = fixture(), free = box(1020, 1100, 300, 450);
    input.layouts![0].blocks = [{ shape: free, quarter: 0, kind: 'reserve', axis: { x: 1, y: 0 }, zone: 'edge' }];
    const scene = generateUrbanLanduse(input);
    const cover = scene.landuse!.areas.map(a => ({ outer: a.poly, holes: a.holes ?? [] }));
    expect(mpArea(intersectionS(cover, free))).toBeGreaterThan(1000);
    expect(mpArea(intersectionS(cover, box(1400, 1300, 300, 150)))).toBeLessThan(0.01);
  });

  it('produces natural cover when the city is removed', () => {
    const input = fixture(); input.city = undefined; input.layouts = undefined;
    const scene = generateUrbanLanduse(input);
    expect(scene.landuse!.areas.length).toBeGreaterThan(0);
    expect(scene.landuse!.areas.some(a => ['field', 'garden', 'orchard'].includes(a.kind))).toBe(false);
    expect(scene.landuse!.reserve).toEqual([]);
  });

  it('keeps dry cavern walls out of natural marsh classification', () => {
    const input = fixture(); input.city = undefined; input.layouts = undefined; input.biome = 'underdark';
    input.raster.water.fill(0);
    for (let y = 30; y < 60; y++) for (let x = 30; x < 60; x++) input.raster.water[y * 96 + x] = 4;
    const scene = generateUrbanLanduse(input);
    expect(scene.landuse!.areas.length).toBeGreaterThan(0);
    expect(scene.landuse!.areas.every(a => a.kind === 'commons')).toBe(true);
  });
});
