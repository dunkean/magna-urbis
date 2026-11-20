import { describe, expect, it } from 'vitest';
import { joinStreets, roadSurface, type SurfaceStreet } from '../src/render/roadSurface';

const street = (pts: [number, number][], w: number, rank = 2, role = 'street'): SurfaceStreet => ({ path: pts.map(([x, y]) => ({ x, y })), widths: pts.map(() => w), role, rank });
const area = (r: { x: number; y: number }[]): number => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j].x * r[i].y - r[i].x * r[j].y;
  return s / 2;
};
const points = (pieces: ReturnType<typeof roadSurface>, street?: number) => pieces.filter(p => street === undefined || p.street === street).flatMap(p => p.ring);

describe('road surface', () => {
  // Main street along x (6 m), a 3 m lane leaving it at the origin towards +y.
  const tee = [
    street(
      [
        [-40, 0],
        [0, 0],
        [40, 0],
      ],
      6,
      1,
    ),
    street(
      [
        [0, 0],
        [0, 30],
      ],
      3,
      3,
      'lane',
    ),
  ];

  it('stops a lane at the road it joins: nothing past the far edge, curb returns on its side', () => {
    const pieces = roadSurface(tee);
    for (const p of points(pieces)) expect(p.y).toBeGreaterThanOrEqual(-3 - 1e-6);
    // The curb returns widen the mouth on the lane side only, within the lane's reach.
    const mouth = points(pieces).filter(p => p.y > 3.05 && p.y < 4.5);
    expect(Math.max(...mouth.map(p => Math.abs(p.x)))).toBeGreaterThan(1.5 + 0.2);
    expect(
      Math.max(
        ...points(pieces)
          .filter(p => p.y > 3)
          .map(p => Math.abs(p.x)),
      ),
    ).toBeLessThan(1.5 + 0.55 * 3 + 1e-6);
  });

  it('cuts a loose end square at its last vertex and keeps every ring counter-clockwise', () => {
    const pieces = roadSurface(tee, { extra: 0.9 });
    expect(Math.max(...points(pieces, 1).map(p => p.y))).toBeCloseTo(30, 6);
    for (const p of pieces) {
      expect(area(p.ring)).toBeGreaterThan(0);
      for (const q of p.ring) expect(Number.isFinite(q.x + q.y)).toBe(true);
    }
  });

  it('casing runs parallel to the fill at a junction (same curb centre, grown by the edge)', () => {
    const fill = roadSurface(tee),
      casing = roadSurface(tee, { extra: 1 });
    const reach = (ps: { x: number; y: number }[]) => Math.max(...ps.filter(p => p.y > 4).map(p => Math.abs(p.x)));
    expect(reach(points(casing)) - reach(points(fill))).toBeLessThan(1.2);
    for (const p of points(casing)) expect(p.y).toBeGreaterThanOrEqual(-4 - 1e-6);
  });

  it("treats a loose end on another street's segment as a junction (no cap past the road)", () => {
    const pieces = roadSurface([
      street(
        [
          [-40, 0],
          [40, 0],
        ],
        6,
        1,
      ),
      street(
        [
          [5, 0],
          [5, 30],
        ],
        3,
        3,
      ),
    ]);
    for (const p of points(pieces)) expect(p.y).toBeGreaterThanOrEqual(-3 - 1e-6);
  });
});

describe('street joins', () => {
  const main = street(
    [
      [-40, 0],
      [40, 0],
    ],
    6,
    1,
  );

  it('moves a stem end that stops inside the ribbon (short of or past the axis) onto the axis, so it ends at the far edge', () => {
    for (const y of [1.2, -2.1]) {
      const streets = [
          main,
          street(
            [
              [5, y],
              [5, 30],
            ],
            4,
            2,
          ),
        ],
        [, stem] = joinStreets(streets);
      expect(stem.path[0]).toEqual({ x: 5, y: 0 });
      expect(stem.stroke[0]).toEqual({ x: 5, y: 0 });
      const pieces = roadSurface(streets.map((s, i) => ({ ...s, path: joinStreets(streets)[i].path })));
      for (const p of points(pieces)) expect(p.y).toBeGreaterThanOrEqual(-3 - 1e-6);
    }
    // Outside the ribbon, or running alongside it: left as it is.
    expect(
      joinStreets([
        main,
        street(
          [
            [5, 3.5],
            [5, 30],
          ],
          4,
          2,
        ),
      ])[1].path[0],
    ).toEqual({ x: 5, y: 3.5 });
    expect(
      joinStreets([
        main,
        street(
          [
            [5, 1],
            [40, 2],
          ],
          4,
          2,
        ),
      ])[1].path[0],
    ).toEqual({ x: 5, y: 1 });
  });

  it('ends every stroke square on a through street and at a dead end, with no extra vertex', () => {
    const [m, lane] = joinStreets([
      main,
      street(
        [
          [0, 0],
          [0, 30],
        ],
        3,
        3,
      ),
      street(
        [
          [0, 0],
          [0, -20],
        ],
        8,
        1,
      ),
    ]);
    expect(m.stroke).toEqual(m.path);
    expect(lane.stroke).toEqual(lane.path);
  });

  it('closes a bend between two records with the narrower stroke running into the wider one', () => {
    const bend = [
      street(
        [
          [0, 0],
          [30, 0],
        ],
        6,
        1,
      ),
      street(
        [
          [0, 0],
          [0, 30],
        ],
        4,
        2,
      ),
    ];
    const [wide, narrow] = joinStreets(bend);
    expect(wide.stroke).toEqual(wide.path);
    expect(narrow.stroke[0]).toEqual({ x: 2, y: 0 });
    expect(narrow.widths).toEqual([4, 4, 4]);
    // A street of a lesser rank (hidden first when zooming out) is never the one run into.
    expect(
      joinStreets([
        street(
          [
            [0, 0],
            [30, 0],
          ],
          6,
          3,
        ),
        street(
          [
            [0, 0],
            [0, 30],
          ],
          4,
          2,
        ),
      ])[1].stroke,
    ).toHaveLength(2);
  });

  it('runs a street on under the end of a deck, surface and stroke', () => {
    const [road] = joinStreets([
      street(
        [
          [0, 0],
          [30, 0],
        ],
        6,
        2,
      ),
      street(
        [
          [0, 0],
          [-8, 0],
        ],
        4,
        2,
        'bridge',
      ),
    ]);
    expect(road.path[0]).toEqual({ x: -3, y: 0 });
    expect(road.stroke[0]).toEqual({ x: -3, y: 0 });
    expect(road.pathWidths).toEqual([6, 6, 6]);
  });

  it('runs a street on into a ford and closes a gap between two of its records cut in line', () => {
    const [road] = joinStreets([
      street(
        [
          [0, 0],
          [30, 0],
        ],
        6,
        2,
      ),
      street(
        [
          [0, 0],
          [-12, 0],
        ],
        5,
        2,
        'ford',
      ),
    ]);
    expect(road.path[0]).toEqual({ x: -3, y: 0 });
    // A 21 m market cut over 15.6 m where a regional road passes: one continuous way, no hole in the surface.
    const cut = [
      street(
        [
          [0, 40],
          [0.8, 15.6],
        ],
        21,
        0,
        'market',
      ),
      street(
        [
          [1.8, 0],
          [3, -30],
        ],
        24,
        0,
        'market',
      ),
    ];
    const [a, b] = joinStreets(cut),
      joined = cut.map((s, i) => ({ ...s, path: [a, b][i].path }));
    expect(a.path[a.path.length - 1]).toEqual(b.path[0]);
    const surface = roadSurface(joined);
    expect(points(surface).some(p => p.y > 7 && p.y < 9)).toBe(true);
    // Apart wider than the way, or not in line: left as they are.
    expect(
      joinStreets([
        street(
          [
            [0, 40],
            [0, 25],
          ],
          6,
          0,
        ),
        street(
          [
            [0, 0],
            [0, -30],
          ],
          6,
          0,
        ),
      ])[0].path[1],
    ).toEqual({ x: 0, y: 25 });
    expect(
      joinStreets([
        street(
          [
            [0, 40],
            [0, 4],
          ],
          6,
          0,
        ),
        street(
          [
            [4, 0],
            [30, 0],
          ],
          6,
          0,
        ),
      ])[0].path[1],
    ).toEqual({ x: 0, y: 4 });
  });

  it('takes the same decisions whatever the order of the streets', () => {
    const set = [
      main,
      street(
        [
          [5, 1.2],
          [5, 30],
        ],
        4,
        2,
      ),
      street(
        [
          [40, 0],
          [60, 20],
        ],
        6,
        1,
      ),
      street(
        [
          [60, 20],
          [60, 50],
        ],
        3,
        3,
      ),
      street(
        [
          [-40, 0],
          [-40, -30],
        ],
        5,
        2,
      ),
    ];
    const forward = joinStreets(set),
      backward = joinStreets([...set].reverse()).reverse();
    expect(backward).toEqual(forward);
  });
});
