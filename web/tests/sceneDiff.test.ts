import { describe, expect, it } from 'vitest';
import { sceneDirty, mergeRects } from '../src/render/sceneDiff';
import { TileIndex, boxesOf } from '../src/render/tileindex';
import type { Scene, PolyLayer } from '../src/render/scene';
import type { Polygon } from '../src/gen/types';

const square = (x: number, y: number, s = 10): Polygon => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const layer = (name: string, polys: Polygon[]): PolyLayer => ({ name, polys, index: new TileIndex(1000, 250, boxesOf(polys), 'center') });
const scene = (polys: Polygon[]): Scene => ({ mapSize: 1000, tileSize: 250, poly: new Map([['lu-field', layer('lu-field', polys)]]), lines: [], textures: [], density: null, counts: {}, buildMs: 0 });

describe('sceneDirty', () => {
  it('is clean for rebuilt but identical geometry', () => {
    expect(sceneDirty(scene([square(0, 0), square(500, 500)]), scene([square(500, 500), square(0, 0)]))).toEqual([]);
  });
  it('reports only the changed shapes', () => {
    const dirty = sceneDirty(scene([square(0, 0), square(500, 500)]), scene([square(0, 0), square(520, 500)]))!;
    expect(dirty).toHaveLength(1);
    expect(dirty[0]).toEqual({ minX: 500, minY: 500, maxX: 530, maxY: 510 });
  });
  it('merges nearby rectangles', () => {
    expect(mergeRects([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 30, minY: 0, maxX: 40, maxY: 10 }, { minX: 900, minY: 900, maxX: 910, maxY: 910 }], 64)).toHaveLength(2);
  });
});
