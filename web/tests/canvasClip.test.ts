import { describe, expect, it } from 'vitest';
import { clipRingRect } from '../src/render/canvas';
import { clipRingBox } from '../src/gen/geo/bool';

/** The canvas tile clipper must give exactly the generic Sutherland-Hodgman result. */
describe('canvas ring clipping', () => {
  it('matches clipRingBox on random rings and rectangles', () => {
    let seed = 7;
    const rand = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    for (let trial = 0; trial < 400; trial++) {
      const n = 3 + Math.floor(rand() * 40), cx = rand() * 1000, cy = rand() * 1000;
      const ring = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2, r = 50 + rand() * 300;
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      });
      if (trial % 5 === 0) ring.push({ ...ring[0] });
      const x0 = rand() * 1000, y0 = rand() * 1000, rect = { minX: x0, minY: y0, maxX: x0 + rand() * 500, maxY: y0 + rand() * 500 };
      const expected = clipRingBox([...ring.map(p => [p.x, p.y] as [number, number]), [ring[0].x, ring[0].y]],
        { x0: rect.minX, y0: rect.minY, x1: rect.maxX, y1: rect.maxY }).map(([x, y]) => ({ x, y }));
      expect(clipRingRect(ring, rect)).toEqual(expected);
    }
  });
});
