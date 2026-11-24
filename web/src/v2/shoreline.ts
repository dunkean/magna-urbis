/** The one coastline of a generated V2 world: the zero level of the physical display field's cubic B-spline, refined
 * below its cells by the fractal shore detail (render/shoreDetail.ts).
 *
 * The town engine (urban `Surface::wet`: the sea polygon), the vector maps and the 3D water read the polygon traced here;
 * the 2D ground (ui/terrain/gl/shaders.ts) evaluates the same refined height. The field's own cells are too large for a
 * coast (30 m), and a finer field over the whole map would cost everywhere: the squares of the grid the zero line crosses,
 * and their neighbours, are the only ones subdivided, so the cost follows the length of the coast. Away from a band
 * around the planning coast the planning sea mask gives the side. */
import { pointInRing } from '../gen/geo/poly';
import { simplify } from '../gen/core/geom';
import { shoreOffset } from '../render/shoreDetail';
import type { Polygon } from '../gen/types';

export interface ShoreField {
  n: number;
  data: ArrayLike<number>;
}
type Region = { outer: Polygon; holes: Polygon[] };

const weights = (t: number): [number, number, number, number] => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6, (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
const derivatives = (t: number): [number, number, number, number] => [-0.5 * (1 - t) ** 2, 1.5 * t * t - 2 * t, -1.5 * t * t + t + 0.5, 0.5 * t * t];

/** Spline value and gradient (metres, metres per metre) at a world point of a cell-centred control grid. */
export function splineSample(field: ShoreField, width: number, x: number, y: number): [number, number, number] {
  const n = field.n,
    cell = width / n,
    gx = x / cell - 0.5,
    gy = y / cell - 0.5,
    fx = Math.floor(gx),
    fy = Math.floor(gy);
  const wx = weights(gx - fx),
    wy = weights(gy - fy),
    dx = derivatives(gx - fx),
    dy = derivatives(gy - fy);
  let v = 0,
    sx = 0,
    sy = 0;
  for (let j = 0; j < 4; j++) {
    const row = Math.max(0, Math.min(n - 1, fy + j - 1)) * n;
    for (let i = 0; i < 4; i++) {
      const h = field.data[row + Math.max(0, Math.min(n - 1, fx + i - 1))];
      v += h * wx[i] * wy[j];
      sx += h * dx[i] * wy[j];
      sy += h * wx[i] * dy[j];
    }
  }
  return [v, sx / cell, sy / cell];
}

/** Subdivisions of a grid square on the coast: four samples per wavelength of the finest shore octave. */
const SUB = 8;
/** Spline weights and derivatives at the subdivision points of a cell. */
const SUB_WEIGHTS = Array.from({ length: SUB + 1 }, (_, k) => weights(k / SUB)),
  SUB_DERIVATIVES = Array.from({ length: SUB + 1 }, (_, k) => derivatives(k / SUB));
/** Corners of a marching square clockwise from the top left, as offsets in x and y. */
const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

/** Closed ring without its collinear points, to a fiftieth of a cell: a sandy shore keeps few vertices, a rocky one all. */
function simplified(ring: Polygon, tolerance: number): Polygon {
  let far = 0,
    best = -1;
  ring.forEach((p, k) => {
    const d = Math.hypot(p.x - ring[0].x, p.y - ring[0].y);
    if (d > best) {
      best = d;
      far = k;
    }
  });
  if (far < 1) return ring;
  return [...simplify(ring.slice(0, far + 1), tolerance).slice(0, -1), ...simplify([...ring.slice(far), ring[0]], tolerance).slice(0, -1)];
}

/**
 * Sea regions (outer rings with their islands as holes) bounded by the refined zero line. `sea` is the planning sea
 * mask (n × n over `width`): it chooses the sea side away from the coast, and only spline values within `band` planning
 * cells of its coast are read, so an inland depression below 0 m stays land as it does for the engine.
 */
export function shoreRegions(field: ShoreField, width: number, sea: ArrayLike<number>, n: number, band = 3): Region[] {
  const fn = field.n,
    cell = width / fn,
    // Squares between the control points, one ring of them beyond the map: square (i, j) starts at control point (i - 1, j - 1).
    squares = fn + 1,
    m = fn + 2,
    values = new Float32Array(m * m).fill(-1e-3);
  // Planning cells within `band` of a sea/land change.
  const near = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const s = sea[y * n + x] ? 1 : 0;
      if ((x + 1 < n && (sea[y * n + x + 1] ? 1 : 0) !== s) || (y + 1 < n && (sea[(y + 1) * n + x] ? 1 : 0) !== s)) {
        for (let j = Math.max(0, y - band); j <= Math.min(n - 1, y + 1 + band); j++) near.fill(1, j * n + Math.max(0, x - band), j * n + Math.min(n - 1, x + 1 + band) + 1);
      }
    }
  const h = field.data,
    planning = (world: number): number => Math.max(0, Math.min(n - 1, Math.floor((world / width) * n))),
    column = Int32Array.from({ length: fn }, (_, i) => planning((i + 0.5) * cell));
  // The spline at a control point: weights 1/6, 4/6, 1/6 per axis (rows clamped at the map edge).
  const smooth = (j: number, i: number): number => {
    const row = Math.max(0, Math.min(fn - 1, j)) * fn;
    return (h[row + Math.max(0, i - 1)] + 4 * h[row + i] + h[row + Math.min(fn - 1, i + 1)]) / 6;
  };
  for (let j = 0; j < fn; j++) {
    const planningRow = column[j] * n,
      out = (j + 1) * m + 1;
    for (let i = 0; i < fn; i++) {
      const p = planningRow + column[i];
      // Positive inside the sea; the padding around the map is land just outside its edge.
      values[out + i] = near[p] ? -(smooth(j - 1, i) + 4 * smooth(j, i) + smooth(j + 1, i)) / 6 : sea[p] ? 1e3 : -1e3;
    }
  }
  // Squares to subdivide: those the spline's zero line crosses and their neighbours, then any square a traced line enters.
  const queued = new Uint8Array(squares * squares),
    queue: number[] = [];
  const enqueue = (i: number, j: number): void => {
    if (i < 0 || j < 0 || i >= squares || j >= squares || queued[j * squares + i]) return;
    queued[j * squares + i] = 1;
    queue.push(j * squares + i);
  };
  for (let j = 0; j < squares; j++)
    for (let i = 0; i < squares; i++) {
      const o = j * m + i,
        side = values[o] > 0;
      if (values[o + 1] > 0 === side && values[o + m] > 0 === side && values[o + m + 1] > 0 === side) continue;
      for (let y = j - 1; y <= j + 1; y++) for (let x = i - 1; x <= i + 1; x++) enqueue(x, y);
    }
  // Segments keyed by the sub-grid edges they join, directed with the sea on the same side: each edge starts one segment
  // and ends another, so the rings chain without a search.
  const stride = squares * SUB + 1,
    points = new Map<number, { x: number; y: number }>(),
    next = new Map<number, number>(),
    fine = new Float64Array((SUB + 1) ** 2),
    rows = new Float64Array(4 * (SUB + 1)),
    rowSlopes = new Float64Array(4 * (SUB + 1));
  const position = (k: number): number => (k / SUB - 0.5) * cell;
  const sampleSquare = (i: number, j: number): void => {
    for (let r = 0; r < 4; r++) {
      const row = Math.max(0, Math.min(fn - 1, j - 2 + r)) * fn;
      for (let k = 0; k <= SUB; k++) {
        const w = SUB_WEIGHTS[k],
          d = SUB_DERIVATIVES[k];
        let v = 0,
          s = 0;
        for (let c = 0; c < 4; c++) {
          const value = h[row + Math.max(0, Math.min(fn - 1, i - 2 + c))];
          v += value * w[c];
          s += value * d[c];
        }
        rows[r * (SUB + 1) + k] = v;
        rowSlopes[r * (SUB + 1) + k] = s;
      }
    }
    for (let y = 0; y <= SUB; y++) {
      const Y = j * SUB + y,
        wy = position(Y),
        planningRow = planning(wy) * n,
        w = SUB_WEIGHTS[y],
        d = SUB_DERIVATIVES[y];
      for (let x = 0; x <= SUB; x++) {
        const X = i * SUB + x,
          wx = position(X),
          p = planningRow + planning(wx);
        let value: number;
        if (X === 0 || Y === 0 || X === stride - 1 || Y === stride - 1) value = -1e-3;
        else if (!near[p]) value = sea[p] ? 1e3 : -1e3;
        else {
          let v = 0,
            sx = 0,
            sy = 0;
          for (let r = 0; r < 4; r++) {
            const a = rows[r * (SUB + 1) + x];
            v += a * w[r];
            sy += a * d[r];
            sx += rowSlopes[r * (SUB + 1) + x] * w[r];
          }
          value = -(v + shoreOffset(wx, wy, v, Math.hypot(sx, sy) / cell, cell));
        }
        fine[y * (SUB + 1) + x] = value;
      }
    }
  };
  // Edge k of a sub-square joins its corners k and k + 1 (top, right, bottom, left).
  const edgeOf = (X: number, Y: number, k: number): number => (k === 0 ? 2 * (Y * stride + X) : k === 1 ? 2 * (Y * stride + X + 1) + 1 : k === 2 ? 2 * ((Y + 1) * stride + X) : 2 * (Y * stride + X) + 1);
  for (let at = 0; at < queue.length; at++) {
    const i = queue[at] % squares,
      j = Math.floor(queue[at] / squares);
    sampleSquare(i, j);
    for (let y = 0; y < SUB; y++)
      for (let x = 0; x < SUB; x++) {
        const o = y * (SUB + 1) + x,
          wet = fine[o] > 0;
        if (fine[o + 1] > 0 === wet && fine[o + SUB + 1] > 0 === wet && fine[o + SUB + 2] > 0 === wet) continue;
        const X = i * SUB + x,
          Y = j * SUB + y,
          corner = [fine[o], fine[o + 1], fine[o + SUB + 2], fine[o + SUB + 1]],
          inside = corner.map(v => v > 0);
        const saddle = inside[0] === inside[2] && inside[1] === inside[3],
          joined = saddle && corner[0] + corner[1] + corner[2] + corner[3] > 0;
        for (let k = 0; k < 4; k++) {
          const after = (k + 1) & 3;
          // Crossing of the edge, from the corner with the smaller coordinate so that both squares find the same point.
          if (inside[k] !== inside[after]) {
            const key = edgeOf(X, Y, k);
            if (!points.has(key)) {
              const [a, b] = k < 2 ? [k, after] : [after, k],
                t = corner[a] / (corner[a] - corner[b]),
                [ax, ay] = CORNERS[a],
                [bx, by] = CORNERS[b];
              points.set(key, { x: position(X + ax + (bx - ax) * t), y: position(Y + ay + (by - ay) * t) });
            }
          }
          if (inside[k] || !inside[after]) continue;
          // From the edge entering the sea (clockwise) to the one leaving it, the next one unless the sea joins across.
          let leave = after;
          while (!(inside[leave] && !inside[(leave + 1) & 3])) leave = (leave + 1) & 3;
          if (joined) leave = (leave + 2) & 3;
          next.set(edgeOf(X, Y, k), edgeOf(X, Y, leave));
        }
      }
    // The line runs on into the neighbours whose shared side it crosses.
    for (let k = 0; k < SUB; k++) {
      const side = (a: number, b: number): boolean => fine[a] > 0 !== fine[b] > 0;
      if (side(k, k + 1)) enqueue(i, j - 1);
      if (side(SUB * (SUB + 1) + k, SUB * (SUB + 1) + k + 1)) enqueue(i, j + 1);
      if (side(k * (SUB + 1), (k + 1) * (SUB + 1))) enqueue(i - 1, j);
      if (side(k * (SUB + 1) + SUB, (k + 1) * (SUB + 1) + SUB)) enqueue(i + 1, j);
    }
  }
  const chains: Polygon[] = [];
  for (const start of next.keys()) {
    const ring: Polygon = [];
    let key: number | undefined = start;
    do {
      const follow: number | undefined = next.get(key);
      next.delete(key);
      ring.push(points.get(key)!);
      key = follow;
    } while (key !== undefined && key !== start);
    if (key === start && ring.length >= 3) chains.push(ring);
  }
  const rings = chains
    .map(chain => {
      const pts = simplified(chain, cell * 0.02);
      let area = 0,
        minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      pts.forEach((p, k) => {
        const q = pts[(k + 1) % pts.length];
        area += p.x * q.y - q.x * p.y;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      return { pts, area: Math.abs(area / 2), box: [minX, minY, maxX, maxY] as const };
    })
    .filter(r => r.pts.length >= 3 && r.area > cell * cell * 0.1)
    .sort((a, b) => b.area - a.area);
  // Nesting by containment: even depth = sea region, odd depth = its island.
  const placed: { ring: (typeof rings)[number]; depth: number; region?: Region }[] = [],
    out: Region[] = [];
  for (const ring of rings) {
    const p = ring.pts[0];
    let parent: (typeof placed)[number] | undefined;
    for (let i = placed.length - 1; i >= 0; i--) {
      const b = placed[i].ring.box;
      if (p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3] && pointInRing(placed[i].ring.pts, p)) {
        parent = placed[i];
        break;
      }
    }
    const depth = parent ? parent.depth + 1 : 0;
    if (depth % 2 === 0) {
      const region = { outer: ring.pts, holes: [] as Polygon[] };
      out.push(region);
      placed.push({ ring, depth, region });
    } else {
      parent!.region!.holes.push(ring.pts);
      placed.push({ ring, depth });
    }
  }
  return out;
}
