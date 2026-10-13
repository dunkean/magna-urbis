import { describe, expect, it } from 'vitest';
import { paintFantasyDecor } from '../src/ui/fantasyUrban';
import { createBrushLibrary, FAMILY_NAMES, type Atlas, type BrushFamily } from '../../rust/bridge/fantasyPainting';
import type { Layout } from '../../rust/bridge/urban';
import type { RoadOutput, SettlementRaster } from '../../rust/bridge/settlements';
describe('fantasy urban landscape', () => {
  it('keeps water, urban quarters and road axes clear without changing physical inputs', () => {
    const n = 64, width = 10000, count = n * n;
    const raster: SettlementRaster = { n, width, height: new Float32Array(count).fill(300), water: new Uint8Array(count), waterLevel: new Float32Array(count), riverWidth: new Float32Array(count), riverIds: new Int32Array(count).fill(-1) };
    for (let y = 0; y < n; y++) for (let x = 0; x < 7; x++) raster.water[y * n + x] = 2;
    const layouts: Layout[] = [{ key: 'city', culture: 'test', center: { x: 5500, y: 5500 }, warnings: [], streets: [], blocks: [], quarters: [{ phase: 0, shape: { outer: [{x:4000,y:4000},{x:7000,y:4000},{x:7000,y:7000},{x:4000,y:7000}], holes: [] } }] }];
    const roads: RoadOutput = { segments: [{ class: 'main', surface: 'dirt', profile: 'test', width: 20, a: 0, b: 1, path: [{x:2000,y:0},{x:2000,y:10000}], crossings: [], length: 10000, grade: 0, importance: 1 }], junctions: [], warnings: [], unreachable: [], routes: 1, lengthByClass: {}, lengthBySurface: {}, ms: 0 };
    const atlas: Atlas = { url: 'data:image/png;base64,fixture', width: 400, height: 400, rows: [0,.25,.5,.75,1] };
    const families = Object.fromEntries(FAMILY_NAMES.map(family => [family, atlas])) as Record<BrushFamily, Atlas>;
    const heights = raster.height.slice(), water = raster.water.slice(), geometry = JSON.stringify(layouts);
    const scene = paintFantasyDecor({ raster, seed: 'urban-42', temperature: 18, rain: 1800, layouts, roads }, createBrushLibrary('fantasy-color', families), { density: 1, size: 1, spacing: 1 });
    const anchors = [...scene.matchAll(/transform="translate\(([-\d.]+) ([-\d.]+)\)/g)].map(match => ({x:Number(match[1]),y:Number(match[2])}));
    expect(anchors.length).toBeGreaterThan(100);
    expect(anchors.every(p => p.x > 1000 && Math.abs(p.x - 2000) > 100 && !(p.x > 4000 && p.x < 7000 && p.y > 4000 && p.y < 7000))).toBe(true);
    expect(raster.height).toEqual(heights); expect(raster.water).toEqual(water); expect(JSON.stringify(layouts)).toBe(geometry);
  });
});
