import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/gen/core/rng';
import type { Polygon, Vec2 } from '../src/gen/core/geom';
import { blockReach } from '../src/gen/urban/access';
import { Streets, type StreetRec } from '../src/gen/urban/streets';

const box = (x: number, y: number, w: number, h: number): Polygon => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

/** Original distance calculation, including the index's first-seen segment tie order. */
function referenceNearest(streets: Streets, p: Vec2, radius: number, filter?: (s: StreetRec) => boolean) {
  let bs = -1, bd = radius, bseg = 0, bt = 0;
  streets.forEachSeg(p.x - radius, p.y - radius, p.x + radius, p.y + radius, (st, i) => {
    if (!st.ribbon || filter && !filter(st)) return;
    const a = st.path[i], b = st.path[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (d < bd || d === bd && bs >= 0 && st.id < bs) { bs = st.id; bd = d; bseg = i; bt = t; }
  });
  if (bs < 0) return null;
  const st = streets.list[bs];
  return { s: bs, d: bd, hw: (st.widths[bseg] * (1 - bt) + st.widths[bseg + 1] * bt) / 2, seg: bseg };
}

describe('generation performance preserves exact geometry decisions', () => {
  it('keeps access verdicts across overlapping footprints, concave blocks, all street sides and four raster scales', () => {
    const rng = new Rng('ts-access-perf-parity'), results: boolean[][] = [];
    for (let i = 0; i < 2048; i++) {
      const cell = [0.25, 0.5, 1, 1.5][i % 4];
      const block = i % 2 ? box(0, 0, 12, 16) : [
        { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 5 },
        { x: 5, y: 5 }, { x: 5, y: 16 }, { x: 0, y: 16 },
      ];
      const buildings = Array.from({ length: i % 13 }, () => box(rng.range(-2, 15), rng.range(-2, 15), rng.range(0, 10), rng.range(0, 10)));
      if (i % 5 === 0 && buildings.length) buildings.push(buildings[0]);
      const street = (p: Vec2) => i % 3 === 0 ? p.y < 0.5 : i % 3 === 1 ? p.x < 1 : p.x > 14 || p.y > 14;
      for (const input of [buildings, buildings.slice().reverse(), buildings.map(p => p.map(q => ({ ...q })))]) {
        results.push(blockReach(block, input, street, cell));
      }
    }
    // Captured from the unoptimized flood; all 6,144 arrays were also compared
    // directly against that implementation before accepting the optimization.
    expect(createHash('sha256').update(JSON.stringify(results)).digest('hex'))
      .toBe('e862ff9a1434ecec8172e99b7e507211e14b19f1dbec259cd70a380f3df32b51');
  });

  it('retains exact nearest distances, widths and tie choices without unnecessary hypot calls', () => {
    const rng = new Rng('ts-street-perf-parity'), streets = new Streets();
    for (let i = 0; i < 100; i++) {
      const path = Array.from({ length: 2 + i % 5 }, () => ({ x: rng.range(-100, 100), y: rng.range(-100, 100) }));
      if (i % 7 === 0) path[1] = path[0];
      streets.add(path, path.map(() => rng.range(2, 14)), i % 4, 'street', 0, i % 11 !== 0);
    }
    streets.add([{ x: -30, y: 0 }, { x: 30, y: 0 }], 4, 0, 'street', 0);
    streets.add([{ x: 30, y: 0 }, { x: -30, y: 0 }], 8, 0, 'street', 0);
    const filter = (s: StreetRec) => s.rank <= 1;
    for (let i = 0; i < 2048; i++) {
      const p = i % 2 ? { x: rng.range(-140, 140), y: rng.range(-140, 140) }
        : { x: i % 3 * 30, y: i % 5 * 30 };
      const radius = [0, 0.1, 1, 14, 30, 70][i % 6];
      expect(streets.nearest(p, radius, i % 3 ? undefined : filter))
        .toEqual(referenceNearest(streets, p, radius, i % 3 ? undefined : filter));
    }
  });
});
