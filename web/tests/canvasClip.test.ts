import { describe, expect, it } from 'vitest';
import { clipRingRect } from '../src/render/canvas';
import { clipRingBox } from '../src/gen/geo/bool';
import { polyPath } from '../src/render/cartography/geometry';
import { RecOnlyPath2D } from '../src/render/gpu/path';
import type { PathGeometry, RecordedPath } from '../src/render/gpu/contract';
import { TileIndex, boxesOf } from '../src/render/tileindex';

/** The canvas tile clipper must give exactly the generic Sutherland-Hodgman result. */
describe('canvas ring clipping', () => {
  it('cuts a map-sized drape path while retaining its LOD outline and holes inside the tile', () => {
    const ring = (radius: number, count: number) => Array.from({ length: count }, (_, i) => ({ x: Math.cos((i * 2 * Math.PI) / count) * radius, y: Math.sin((i * 2 * Math.PI) / count) * radius }));
    const outer = ring(1000, 4096),
      hole = ring(20, 128).reverse();
    const layer = { name: 'lu-forest', polys: [outer], holes: [[hole]], index: new TileIndex(2000, 100, boxesOf([outer])) };
    const P = RecOnlyPath2D as unknown as new () => Path2D;
    const original = (polyPath(P, layer, [0], 3)! as unknown as RecordedPath).geometry(0.25);
    const clipped = (polyPath(P, layer, [0], 3, { minX: -60, minY: -60, maxX: 60, maxY: 60 }, true)! as unknown as RecordedPath).geometry(0.25);
    const winding = (g: PathGeometry, x: number, y: number): number => {
      let value = 0;
      for (let s = 0; s + 1 < g.starts.length; s++)
        for (let i = g.starts[s]; i < g.starts[s + 1]; i++) {
          const j = i + 1 === g.starts[s + 1] ? g.starts[s] : i + 1;
          const ax = g.points[2 * i],
            ay = g.points[2 * i + 1],
            bx = g.points[2 * j],
            by = g.points[2 * j + 1];
          const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
          if (ay <= y && by > y && cross > 0) value++;
          if (ay > y && by <= y && cross < 0) value--;
        }
      return value;
    };
    expect(clipped.points.length).toBeLessThan(original.points.length / 10);
    for (let y = -55; y < 60; y += 7) for (let x = -55; x < 60; x += 7) expect(winding(clipped, x, y)).toBe(winding(original, x, y));
    expect(winding(clipped, 0, 0)).toBe(0);
  });
  it('matches clipRingBox on random rings and rectangles', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let trial = 0; trial < 400; trial++) {
      const n = 3 + Math.floor(rand() * 40),
        cx = rand() * 1000,
        cy = rand() * 1000;
      const ring = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2,
          r = 50 + rand() * 300;
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      });
      if (trial % 5 === 0) ring.push({ ...ring[0] });
      const x0 = rand() * 1000,
        y0 = rand() * 1000,
        rect = { minX: x0, minY: y0, maxX: x0 + rand() * 500, maxY: y0 + rand() * 500 };
      const expected = clipRingBox([...ring.map(p => [p.x, p.y] as [number, number]), [ring[0].x, ring[0].y]], { x0: rect.minX, y0: rect.minY, x1: rect.maxX, y1: rect.maxY }).map(([x, y]) => ({ x, y }));
      expect(clipRingRect(ring, rect)).toEqual(expected);
    }
  });
});
