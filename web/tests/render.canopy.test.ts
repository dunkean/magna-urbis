import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { canopyAreaMarks, canopyMarks, canopyAppearance, canopyColor } from '../src/render/canopy';
import { landuseLayer } from '../src/render/landuse';
import { biomePalette } from '../src/render/biomes';
import { TileIndex, boxesOf } from '../src/render/tileindex';
import { insideArea, type TextureLayer } from '../src/render/scene';
import { fakeWorld } from '../scripts/fakeworld';

import { buildNearTrees, buildNearTreesSteps, TREE_MAX, TREE_STRIDE, type TreeInputs } from '../src/ui/terrain3dTrees';
import { forestOccupation } from '../src/ui/forestOccupation';
import { withLandDetail } from '../src/ui/landDetail';
import { ForestRoom } from '../src/render/forestRoom';

const pal = biomePalette('parchment', 'temperate');
const rect = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

describe('individual canopy stamps', () => {
  it('aligns orchard rows to the holding and retains identical trees across tile sizes', () => {
    const angle = .63, ca = Math.cos(angle), sa = Math.sin(angle);
    const areas = [{kind:'orchard' as const, poly:rect(20,20,200), holes:[rect(80,80,45)], stripAngle:angle}];
    const collect = (tileSize:number) => {
      const layer:TextureLayer = {kind:'orchard',areas,index:new TileIndex(256,tileSize,boxesOf(areas.map(a=>a.poly)),'overlap')};
      return layer.index.tilesInRect({minX:0,minY:0,maxX:256,maxY:256}).flatMap(t=>canopyMarks(layer,t,'rows')).sort((a,b)=>a.y-b.y||a.x-b.x);
    };
    const marks = collect(64);
    expect(marks).toEqual(collect(128));
    expect(marks.length).toBeGreaterThan(100);
    const rows = marks.map(m => -m.x*sa+m.y*ca);
    const phase = rows[0];
    for (const row of rows) expect((row-phase)/8).toBeCloseTo(Math.round((row-phase)/8),8);
    for (const m of marks) for (const [dx,dy] of [[4.5,0],[-4.5,0],[0,4.5],[0,-4.5]]) expect(insideArea(areas[0],m.x+dx,m.y+dy)).toBe(true);
  });

  it('uses the same bounded tree stream for fruit rows and excludes natural trees inside the parcel', () => {
    const angle = .58, ca = Math.cos(angle), sa = Math.sin(angle);
    const rotate = (ring: { x: number; y: number }[]) => ring.map(p => ({ x: 180 + p.x * ca - p.y * sa, y: 90 + p.x * sa + p.y * ca }));
    const orchard = { kind: 'orchard' as const, poly: rotate(rect(0, 0, 128)), holes: [rotate(rect(48, 48, 32))] };
    const landuse = { areas: [orchard], reserve: [], farmsteads: [] };
    const occupation = withLandDetail(forestOccupation(landuse), landuse)!;
    const rgba = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([230, 110, 180, 128], i); // dense, tall, conifer-biased forest
    const inputs: TreeInputs = { field: { x: 0, y: 0, width: 640, n: 32, rgba, key: 'dense' }, occupation,
      seed: 98, climate: { temperature: 16, precipitation: 1200 }, renderV2: 1, zone: 1, season: .5,
      water: () => 0, height: () => 20 };
    const view = { x: 250, y: 0, forwardX: 0, forwardY: 1 }, trees = buildNearTrees(inputs, view);
    const rows = occupation.detail!.orchards![0].along;
    let fruit = 0;
    for (let i = 0; i < trees.length; i += TREE_STRIDE) {
      const [x, y] = trees.slice(i, i + 2);
      if (!insideArea(orchard, x, y)) continue;
      fruit++;
      expect(trees[i + 6]).toBe(0); // broadleaf fruit, never a forest conifer
      expect(trees[i + 4]).toBeGreaterThanOrEqual(6); expect(trees[i + 4]).toBeLessThanOrEqual(7.2);
      expect(trees[i + 3]).toBeGreaterThanOrEqual(2.3); expect(trees[i + 3]).toBeLessThanOrEqual(2.7);
      const u = (x * rows[0] + y * rows[1]) / 8 - .5, v = (-x * rows[1] + y * rows[0]) / 8 - .5;
      expect(Math.abs(u - Math.round(u))).toBeLessThan(.061); expect(Math.abs(v - Math.round(v))).toBeLessThan(.061);
    }
    expect(fruit).toBeGreaterThan(120);
    expect(trees.length / TREE_STRIDE).toBeLessThanOrEqual(TREE_MAX);
    expect(new Set(Array.from({ length: trees.length / TREE_STRIDE }, (_, i) => `${trees[i * TREE_STRIDE]},${trees[i * TREE_STRIDE + 1]}`)).size).toBe(trees.length / TREE_STRIDE);
    const work = buildNearTreesSteps(inputs, view); let step = work.next(); while (!step.done) step = work.next();
    expect(step.value).toEqual(trees);
    // Vector forest brush/symbol roots obey the same exclusion and preserve the parcel's hole.
    const room = new ForestRoom([], [orchard]);
    const centre = rotate([{ x: 24, y: 24 }])[0], hole = rotate([{ x: 60, y: 60 }])[0];
    expect(room.keeps(centre.x, centre.y, .5)).toBe(false); expect(room.keeps(hole.x, hole.y, .5)).toBe(true);
  });

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
