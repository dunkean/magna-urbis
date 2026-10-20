import { describe, expect, it } from 'vitest';
import { outsideUrbanStreets, prepareUrbanRoadClip, regionalOutsideUrban, urbanRoadOwnership } from '../../rust/bridge/urbanNetwork';
import type { Layout, Shape, Street } from '../../rust/bridge/urban';
import type { RoadOutput } from '../../rust/bridge/settlements';

const rectangle = (x0: number, y0: number, x1: number, y1: number): Shape => ({
  outer: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [],
});
const layout = (...shapes: Shape[]): Layout => ({
  key: 'town', culture: 'european', center: { x: 5, y: 5 }, quarters: shapes.map(shape => ({ shape, phase: 0 })),
  streets: [], blocks: [], warnings: [],
});
const road = (a = -5, b = 15): Street => ({ path: [{ x: a, y: 5 }, { x: b, y: 5 }], widths: [4, 8], rank: 1, role: 'regional' });
const xPaths = (streets: Street[]): number[][] => streets.map(s => s.path.map(p => p.x));

describe('regional geometry outside native urban quarters', () => {
  it('cuts exact entries and exits and interpolates widths without mutating inputs', () => {
    const original = road(), saved = JSON.stringify(original);
    const result = outsideUrbanStreets([original], [layout(rectangle(0, 0, 10, 10))]);
    expect(xPaths(result)).toEqual([[-5, 0], [10, 15]]);
    expect(result.map(s => s.widths)).toEqual([[4, 5], [7, 8]]);
    expect(result.every(s => s.rank === 1 && s.role === 'regional')).toBe(true);
    expect(JSON.stringify(original)).toBe(saved);
  });

  it('keeps holes and water crossings but removes overlapping and adjacent quarter interiors once', () => {
    const shape = rectangle(0, 0, 10, 10);
    shape.holes = [rectangle(4, 2, 6, 8).outer];
    expect(xPaths(outsideUrbanStreets([road()], [layout(shape)]))).toEqual([[-5, 0], [4, 6], [10, 15]]);
    expect(xPaths(outsideUrbanStreets([road()], [layout(shape, rectangle(6, 0, 12, 10), rectangle(9, 0, 13, 10))])))
      .toEqual([[-5, 0], [4, 6], [13, 15]]);
    expect(xPaths(outsideUrbanStreets([road()], [layout(shape, rectangle(3, 0, 7, 10))])))
      .toEqual([[-5, 0], [10, 15]]);
  });

  it.each(['bridge', 'ford', 'causeway'])('gives a native %s its water span while preserving unrelated water roads', role => {
    const shape = rectangle(0, 0, 10, 10);
    shape.holes = [rectangle(4, 1, 6, 9).outer];
    const town = layout(shape);
    town.streets = [{ path: [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 7, y: 3 }], widths: [1, 2, 1], rank: 1, role }];
    const crossing = { ...road(), path: [{ x: -5, y: 3 }, { x: 15, y: 3 }] };
    const unrelated = { ...road(), path: [{ x: -5, y: 7 }, { x: 15, y: 7 }] };
    const saved = JSON.stringify(town);
    expect(xPaths(outsideUrbanStreets([crossing], [town]))).toEqual([[-5, 0], [10, 15]]);
    expect(xPaths(outsideUrbanStreets([unrelated], [town]))).toEqual([[-5, 0], [4, 6], [10, 15]]);
    expect(JSON.stringify(town)).toBe(saved);
  });

  it('normalizes winding for an SVG nonzero union without changing the input rings', () => {
    const shape = rectangle(0, 0, 10, 10);
    shape.outer.reverse();
    shape.holes = [rectangle(4, 2, 6, 8).outer];
    const town = layout(shape);
    town.streets = [{ path: [{ x: 3, y: 5 }, { x: 7, y: 5 }], widths: [1, 3], rank: 1, role: 'bridge' }];
    const saved = JSON.stringify(town), ownership = urbanRoadOwnership([town]);
    const signedArea = (ring: Shape['outer']): number => ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return sum + p.x * q.y - p.y * q.x;
    }, 0);
    expect(ownership).toHaveLength(2);
    expect(ownership.every(s => signedArea(s.outer) > 0 && s.holes.every(hole => signedArea(hole) < 0))).toBe(true);
    expect(JSON.stringify(town)).toBe(saved);
  });

  it('treats shared district boundaries consistently and joins contiguous polyline fragments', () => {
    const street: Street = { ...road(), path: [{ x: -5, y: 0 }, { x: -2, y: 0 }, { x: 15, y: 0 }], widths: [4, 5, 8] };
    expect(xPaths(outsideUrbanStreets([street], [layout(rectangle(0, 0, 5, 10), rectangle(5, 0, 10, 10))])))
      .toEqual([[-5, -2, 0], [10, 15]]);
    expect(outsideUrbanStreets([road(), road()], [])).toHaveLength(1);
  });

  it('converts regional roads with type-only imports and accepts no road network', () => {
    expect(regionalOutsideUrban(undefined, [])).toEqual([]);
    const roads: RoadOutput = {
      segments: [{ class: 'highway', surface: 'dirt', profile: 'medieval', width: 7, a: 0, b: 1,
        path: road().path, crossings: [], length: 20, grade: 0, importance: 100 }],
      junctions: [], warnings: [], unreachable: [], routes: 1, lengthByClass: {}, lengthBySurface: {}, ms: 0,
    };
    const result = regionalOutsideUrban(roads, [layout(rectangle(0, 0, 10, 10))]);
    expect(xPaths(result)).toEqual([[-5, 0], [10, 15]]);
    expect(result.every(s => s.rank === 0 && s.role === 'regional' && s.widths.every(w => w === 7))).toBe(true);
  });

  it('removes collinear duplicates with different subdivisions and reversed direction', () => {
    const divided: Street = { ...road(0, 20), path: [{ x: 20, y: 5 }, { x: 10, y: 5 }, { x: 0, y: 5 }], widths: [8, 6, 4] };
    expect(xPaths(outsideUrbanStreets([road(0, 15), divided], []))).toEqual([[0, 15], [20, 15]]);
    expect(outsideUrbanStreets([road(0, 15), divided], [layout(rectangle(3, 0, 7, 10))])
      .flatMap(s => s.path.slice(1).map((p, i) => Math.hypot(p.x - s.path[i].x, p.y - s.path[i].y)))
      .reduce((a, b) => a + b, 0)).toBeCloseTo(16, 8);
  });

  it('reuses prepared ownership with holes and crossings without retaining duplicate coverage between draws', () => {
    const shape = rectangle(0, 0, 10, 10);
    shape.holes = [rectangle(4, 1, 6, 9).outer];
    const town = layout(shape);
    town.streets = [{ path: [{ x: 3, y: 3 }, { x: 7, y: 3 }], widths: [1, 1], rank: 1, role: 'bridge' }];
    const clip = prepareUrbanRoadClip([town]);
    const crossing = { ...road(), path: [{ x: -5, y: 3 }, { x: 15, y: 3 }] };
    const unrelated = { ...road(), path: [{ x: -5, y: 7 }, { x: 15, y: 7 }] };
    for (let draw = 0; draw < 3; draw++) {
      expect(xPaths(clip([crossing, crossing]))).toEqual([[-5, 0], [10, 15]]);
      expect(xPaths(clip([unrelated]))).toEqual([[-5, 0], [4, 6], [10, 15]]);
      expect(clip([crossing, unrelated])).toEqual(outsideUrbanStreets([crossing, unrelated], [town]));
    }
    const first = clip([unrelated]);
    first[0].path[0].x = 100;
    expect(xPaths(clip([unrelated]))).toEqual([[-5, 0], [4, 6], [10, 15]]);
  });

  it('keeps the one-shot adapter responsive to edited ownership and prepares replacement snapshots independently', () => {
    const shape = rectangle(0, 0, 10, 10), town = layout(shape);
    expect(xPaths(prepareUrbanRoadClip([town])([road()]))).toEqual([[-5, 0], [10, 15]]);
    shape.outer[1].x = shape.outer[2].x = 7;
    expect(xPaths(outsideUrbanStreets([road()], [town]))).toEqual([[-5, 0], [7, 15]]);
    expect(xPaths(prepareUrbanRoadClip([town])([road()]))).toEqual([[-5, 0], [7, 15]]);
  });
});
