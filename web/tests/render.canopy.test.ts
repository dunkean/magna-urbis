import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { canopyAreaMarks, canopyMarks, canopyAppearance, canopyColor } from '../src/render/canopy';
import { landuseLayer } from '../src/render/landuse';
import { biomePalette } from '../src/render/biomes';
import { TileIndex, boxesOf } from '../src/render/tileindex';
import { insideArea, type TextureLayer } from '../src/render/scene';
import { fakeWorld } from '../scripts/fakeworld';

const pal = biomePalette('parchment', 'temperate');
const rect = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

describe('individual canopy stamps', () => {
  it('varies colour and placement deterministically without repeating the old 64m motif', () => {
    const areas = [{ kind: 'forest' as const, poly: rect(0, 0, 256) }];
    const a = canopyAreaMarks(areas, 'forest', 256, '42');
    expect(a).toEqual(canopyAreaMarks(areas, 'forest', 256, '42'));
    expect(a).not.toEqual(canopyAreaMarks(areas, 'forest', 256, '43'));
    const colours = new Set(a.map(m => canopyColor(pal, canopyAppearance('42', m).tone)));
    expect(colours.size).toBeGreaterThanOrEqual(8);
    const cell = (offset: number) => a.filter(m => m.x >= offset && m.x < offset + 64 && m.y < 64)
      .map(m => [Number((m.x - offset).toFixed(3)), Number(m.y.toFixed(3))]);
    expect(cell(0)).not.toEqual(cell(64));
    let nearest = Infinity;
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) nearest = Math.min(nearest, Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y));
    expect(nearest).toBeGreaterThanOrEqual(4.5 - 1e-8);
  });

  it('keeps every centre identical across tile sizes, without duplicates or marks in holes', () => {
    const areas = [{ kind: 'forest' as const, poly: rect(0, 0, 256), holes: [rect(96, 96, 64)] }];
    const collect = (tileSize: number) => {
      const layer: TextureLayer = { kind: 'forest', areas, index: new TileIndex(256, tileSize, boxesOf(areas.map(a => a.poly)), 'overlap') };
      return layer.index.tilesInRect({ minX: 0, minY: 0, maxX: 256, maxY: 256 })
        .flatMap(t => canopyMarks(layer, t, '42')).sort((a, b) => a.y - b.y || a.x - b.x);
    };
    const a = collect(64);
    expect(a).toEqual(collect(128)); expect(a).toEqual(collect(256));
    expect(new Set(a.map(m => `${m.x},${m.y}`)).size).toBe(a.length);
    expect(a.every(m => insideArea(areas[0], m.x, m.y))).toBe(true);
  });

  it('leaves field hatching and underground symbols unchanged', () => {
    const w = fakeWorld({ mapSize: 600, buildings: 0, streets: 0, landAreas: 0 });
    w.landuse!.areas = [{ kind: 'field', poly: rect(20, 20, 120), strips: [rect(20, 20, 120)], stripAngle: .7 }];
    expect(landuseLayer(w, pal, 1, undefined, undefined, '', 'canopy')).toBe(landuseLayer(w, pal, 1));
    w.options.biome = 'underdark';
    expect(landuseLayer(w, pal, 1, undefined, undefined, '', 'canopy')).toBe(landuseLayer(w, pal, 1));
  });

  it('draws complete crowns across cover boundaries, keeping deep holes empty', () => {
    const w = fakeWorld({ mapSize: 160, buildings: 0, streets: 0, landAreas: 0 });
    w.landuse!.areas = [{ kind: 'forest', poly: rect(20, 20, 120), holes: [rect(60, 60, 40)] }];
    w.landuse!.farmsteads = [];
    const layer = landuseLayer(w, pal, 1, 1, undefined, '', 'canopy');
    const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="160" height="160"><rect width="160" height="160" fill="white"/>${layer}</svg>`).render();
    const pixel = (x: number, y: number) => [...image.pixels.slice((y * 160 + x) * 4, (y * 160 + x) * 4 + 4)];
    expect(pixel(80, 80)).toEqual([255, 255, 255, 255]);
    let overhang = 0;
    for (let y = 24; y < 136; y++) for (let x = 10; x <= 18; x++) if (pixel(x, y).slice(0, 3).some(v => v < 250)) overhang++;
    expect(overhang).toBeGreaterThan(30);
    expect(layer).not.toContain('fill="url(#p-forest)"');
  });
});
