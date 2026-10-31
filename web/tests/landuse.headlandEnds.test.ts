import { describe, expect, it } from 'vitest';
import { partitionRegion, type FieldNet } from '../src/gen/landuse/fields';
import { Rng } from '../src/gen/core/rng';
import { Noise2D } from '../src/gen/core/noise';
import { distToPolyline } from '../src/gen/core/geom';
import type { Polygon, Vec2 } from '../src/gen/types';

// U-shaped arable region: two arms joined at the bottom, so a cut across one arm runs on into the other.
const U: Polygon = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 900 }, { x: 700, y: 900 }, { x: 700, y: 0 }, { x: 1300, y: 0 },
  { x: 1300, y: 1400 }, { x: 0, y: 1400 }];
const ring = (p: Polygon): Vec2[] => [...p, p[0]];

describe('headlands', () => {
  it('end on the region border or on another field line, never inside a field', () => {
    let checked = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const rng = new Rng(`headland-ends:${seed}`), net: FieldNet = { furlongs: [], ways: [], headlands: [] };
      // a direction field that curls in the right arm: streamlines stop short there
      const dirAt = (x: number, y: number) => (x > 700 ? (x - 700) / 45 + y / 300 : 0.15 * Math.sin(y / 200));
      partitionRegion(U, [], { dirAt, slopeAt: () => 0, closeAt: () => false, noise: new Noise2D(rng.fork('noise')), rng }, net);
      const lines = [...net.headlands, ...net.ways];
      for (const [i, line] of lines.entries()) for (const end of [line[0], line[line.length - 1]]) {
        const onBorder = distToPolyline(end, ring(U)) < 0.5;
        const onLine = lines.some((other, j) => j !== i && distToPolyline(end, other) < 3);
        expect(onBorder || onLine, `${seed}: loose end at ${end.x.toFixed(1)},${end.y.toFixed(1)}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
