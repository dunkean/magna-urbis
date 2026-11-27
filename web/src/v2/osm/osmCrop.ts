import polygonClipping, { type Polygon } from 'polygon-clipping';

type Point = { x: number; y: number };
type Area = { outer: Point[]; holes: Point[][] };

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8;

export function clipOsmLine(path: readonly (Point | null)[], size: number): Point[][] {
  const lines: Point[][] = [];
  let run: Point[] | undefined;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    if (!a || !b) {
      run = undefined;
      continue;
    }
    const dx = b.x - a.x,
      dy = b.y - a.y;
    let from = 0,
      to = 1;
    // Intersect the segment parameter with the intervals allowed by both map axes.
    for (const [origin, delta] of [
      [a.x, dx],
      [a.y, dy],
    ]) {
      if (!delta) {
        if (origin < 0 || origin > size) to = -1;
        continue;
      }
      const start = -origin / delta,
        end = (size - origin) / delta;
      from = Math.max(from, Math.min(start, end));
      to = Math.min(to, Math.max(start, end));
    }
    if (from >= to) {
      run = undefined;
      continue;
    }
    const p = { x: a.x + from * dx, y: a.y + from * dy };
    const q = { x: a.x + to * dx, y: a.y + to * dy };
    if (same(p, q)) continue;
    if (!run || !same(run.at(-1)!, p)) {
      run = [p];
      lines.push(run);
    }
    run.push(q);
    if (to < 1) run = undefined;
  }
  return lines;
}

export function clipOsmArea(area: Area, size: number): Area[] {
  const { outer, holes } = area;
  const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= size && p.y <= size;
  if (outer.every(inside) && holes.every(ring => ring.every(inside))) return [area];
  if (outer.every(p => p.x < 0) || outer.every(p => p.x > size) || outer.every(p => p.y < 0) || outer.every(p => p.y > size)) return [];
  const polygon: Polygon = [outer, ...holes].map(ring => ring.map(({ x, y }) => [x, y]));
  const square: Polygon = [
    [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
      [0, 0],
    ],
  ];
  return polygonClipping.intersection(polygon, square).map(([outer, ...holes]) => {
    const points = (ring: [number, number][]) => ring.slice(0, -1).map(([x, y]) => ({ x, y }));
    return { outer: points(outer), holes: holes.map(points) };
  });
}
