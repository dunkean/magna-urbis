/** The one coastline of a generated V2 world: the zero level of the physical display field's cubic B-spline.
 *
 * The town engine (urban `Surface::wet`: the sea polygon, plus the spline at or below 0 m next to the sea), the 2D
 * ground (ui/terrainGl.ts land cover) and the 3D sea cover (render/seaCover.ts) all read that spline. The sea polygon
 * used to be the planning sea mask vectorised on its own cells (78 m on a 40 km map) and smoothed, so the parcels and
 * the quay band were built on a line the maps did not draw. It is now traced on the spline itself:
 * marching squares on the spline's values at the control points, only in a band around the planning coast (elsewhere
 * the planning sea mask gives the side), then every vertex and segment midpoint projected onto the exact zero line. */
import { marchingSquares } from '../gen/terrain/contour';
import { pointInRing } from '../gen/geo/poly';
import type { Polygon } from '../gen/types';

export interface ShoreField { n: number; data: ArrayLike<number> }
type Region = { outer: Polygon; holes: Polygon[] };

const weights = (t: number): [number, number, number, number] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
const derivatives = (t: number): [number, number, number, number] => [-.5 * (1 - t) ** 2, 1.5 * t * t - 2 * t, -1.5 * t * t + t + .5, .5 * t * t];

/** Spline value and gradient (metres, metres per metre) at a world point of a cell-centred control grid. */
export function splineSample(field: ShoreField, width: number, x: number, y: number): [number, number, number] {
  const n = field.n, cell = width / n, gx = x / cell - .5, gy = y / cell - .5, fx = Math.floor(gx), fy = Math.floor(gy);
  const wx = weights(gx - fx), wy = weights(gy - fy), dx = derivatives(gx - fx), dy = derivatives(gy - fy);
  let v = 0, sx = 0, sy = 0;
  for (let j = 0; j < 4; j++) {
    const row = Math.max(0, Math.min(n - 1, fy + j - 1)) * n;
    for (let i = 0; i < 4; i++) {
      const h = field.data[row + Math.max(0, Math.min(n - 1, fx + i - 1))];
      v += h * wx[i] * wy[j]; sx += h * dx[i] * wy[j]; sy += h * wx[i] * dy[j];
    }
  }
  return [v, sx / cell, sy / cell];
}

/** Two Newton steps along the gradient onto the zero line, at most a cell away. */
function project(field: ShoreField, width: number, p: { x: number; y: number }, cell: number): { x: number; y: number } {
  let x = p.x, y = p.y;
  for (let k = 0; k < 2; k++) {
    const [v, gx, gy] = splineSample(field, width, x, y), g = gx * gx + gy * gy;
    if (g < 1e-12) break;
    x -= v * gx / g; y -= v * gy / g;
  }
  return Math.hypot(x - p.x, y - p.y) <= cell ? { x, y } : p;
}

/**
 * Sea regions (outer rings with their islands as holes) bounded by the spline's zero line. `sea` is the planning sea
 * mask (n × n over `width`): it chooses the sea side away from the coast, and only spline values within `band` planning
 * cells of its coast are read, so an inland depression below 0 m stays land as it does for the engine.
 */
export function shoreRegions(field: ShoreField, width: number, sea: ArrayLike<number>, n: number, band = 3): Region[] {
  const fn = field.n, cell = width / fn, m = fn + 2, values = new Float32Array(m * m).fill(-1e-3);
  // Planning cells within `band` of a sea/land change.
  const near = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const s = sea[y * n + x] ? 1 : 0;
    if ((x + 1 < n && (sea[y * n + x + 1] ? 1 : 0) !== s) || (y + 1 < n && (sea[(y + 1) * n + x] ? 1 : 0) !== s)) {
      for (let j = Math.max(0, y - band); j <= Math.min(n - 1, y + 1 + band); j++) near.fill(1, j * n + Math.max(0, x - band), j * n + Math.min(n - 1, x + 1 + band) + 1);
    }
  }
  const h = field.data, column = new Int32Array(fn);
  for (let i = 0; i < fn; i++) column[i] = Math.min(n - 1, Math.floor((i + .5) * n / fn));
  // The spline at a control point: weights 1/6, 4/6, 1/6 per axis (rows clamped at the map edge).
  const smooth = (j: number, i: number): number => {
    const row = Math.max(0, Math.min(fn - 1, j)) * fn;
    return (h[row + Math.max(0, i - 1)] + 4 * h[row + i] + h[row + Math.min(fn - 1, i + 1)]) / 6;
  };
  for (let j = 0; j < fn; j++) {
    const planningRow = Math.min(n - 1, Math.floor((j + .5) * n / fn)) * n, out = (j + 1) * m + 1;
    for (let i = 0; i < fn; i++) {
      const p = planningRow + column[i];
      // Positive inside the sea; the padding around the map is land just outside its edge.
      values[out + i] = near[p] ? -(smooth(j - 1, i) + 4 * smooth(j, i) + smooth(j + 1, i)) / 6 : sea[p] ? 1e3 : -1e3;
    }
  }
  const rings = marchingSquares(values, m, m, 0, cell, -cell / 2, -cell / 2).filter(c => c.closed && c.pts.length >= 3).map(c => {
    const pts: Polygon = [];
    for (let k = 0; k < c.pts.length; k++) {
      const a = c.pts[k], b = c.pts[(k + 1) % c.pts.length], inside = (q: { x: number; y: number }): boolean => q.x > 0 && q.y > 0 && q.x < width && q.y < width;
      // Vertices on the map edge (the padding) stay where they are; the others, and the midpoints, go onto the line.
      pts.push(inside(a) ? project(field, width, a, cell) : a);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (inside(a) && inside(b)) pts.push(project(field, width, mid, cell));
    }
    let area = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((p, k) => { const q = pts[(k + 1) % pts.length]; area += p.x * q.y - q.x * p.y; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    return { pts, area: Math.abs(area / 2), box: [minX, minY, maxX, maxY] as const };
  }).filter(r => r.area > cell * cell * .1).sort((a, b) => b.area - a.area);
  // Nesting by containment: even depth = sea region, odd depth = its island.
  const placed: { ring: typeof rings[number]; depth: number; region?: Region }[] = [], out: Region[] = [];
  for (const ring of rings) {
    const p = ring.pts[0];
    let parent: typeof placed[number] | undefined;
    for (let i = placed.length - 1; i >= 0; i--) {
      const b = placed[i].ring.box;
      if (p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3] && pointInRing(placed[i].ring.pts, p)) { parent = placed[i]; break; }
    }
    const depth = parent ? parent.depth + 1 : 0;
    if (depth % 2 === 0) { const region = { outer: ring.pts, holes: [] as Polygon[] }; out.push(region); placed.push({ ring, depth, region }); }
    else { parent!.region!.holes.push(ring.pts); placed.push({ ring, depth }); }
  }
  return out;
}
