import type { LineCap, LineJoin, PathGeometry } from './displayList';

export const SEGMENT_STRIDE = 6; // ax, ay, bx, by, length at a, flags
export const DISC_STRIDE = 4; // x, y, length, flags
export const JOIN_STRIDE = 8; // previous xy, vertex xy, next xy, length, kind (1 bevel, 2 miter)
export const STROKE_START = 1;
export const STROKE_END = 2;
export const STROKE_CLOSED = 4;
export const STROKE_DOT = 8;

export interface StrokeOptions { width: number; cap: LineCap; join: LineJoin; miterLimit: number }
export interface StrokeGeometry {
  readonly segments: Float32Array;
  readonly discs: Float32Array;
  readonly joins: Float32Array;
  /** Plain join triangles, x,y,length per vertex. The GPU can instead extrude `joins` in device space. */
  readonly triangles: Float32Array;
}

class Floats {
  private data = new Float32Array(96);
  private size = 0;
  push(...values: number[]): void {
    if (this.size + values.length > this.data.length) {
      const next = new Float32Array(Math.max(this.data.length * 2, this.size + values.length));
      next.set(this.data); this.data = next;
    }
    this.data.set(values, this.size); this.size += values.length;
  }
  done(): Float32Array { return this.data.slice(0, this.size); }
}

/** Signed fans deliberately retain orientation: stencil winding removes holes and overlaps. */
export function fillFans(geometry: PathGeometry): Float32Array {
  const { points: p, starts } = geometry;
  let count = 0;
  for (let s = 0; s + 1 < starts.length; s++) count += Math.max(0, starts[s + 1] - starts[s] - 2);
  const out = new Float32Array(count * 6);
  let k = 0;
  for (let s = 0; s + 1 < starts.length; s++) {
    const a = starts[s] * 2;
    for (let i = starts[s] + 1; i + 1 < starts[s + 1]; i++) {
      out[k++] = p[a]; out[k++] = p[a + 1];
      out[k++] = p[i * 2]; out[k++] = p[i * 2 + 1];
      out[k++] = p[i * 2 + 2]; out[k++] = p[i * 2 + 3];
    }
  }
  return out;
}

export function strokeSegments(geometry: PathGeometry, options: StrokeOptions): StrokeGeometry {
  const segments = new Floats(), discs = new Floats(), joins = new Floats(), triangles = new Floats();
  const { points: p, starts, closed } = geometry, hw = options.width / 2;
  if (!(hw > 0) || !Number.isFinite(hw)) return { segments: segments.done(), discs: discs.done(), joins: joins.done(), triangles: triangles.done() };
  for (let s = 0; s + 1 < starts.length; s++) {
    // Collapse repeated vertices without allocating point objects. Keep one point for cap dots.
    const ids = new Uint32Array(starts[s + 1] - starts[s]);
    let n = 0;
    for (let i = starts[s]; i < starts[s + 1]; i++) {
      if (!n || p[i * 2] !== p[ids[n - 1] * 2] || p[i * 2 + 1] !== p[ids[n - 1] * 2 + 1]) ids[n++] = i;
    }
    const ring = closed[s] !== 0;
    if (ring && n > 1 && p[ids[0] * 2] === p[ids[n - 1] * 2] && p[ids[0] * 2 + 1] === p[ids[n - 1] * 2 + 1]) n--;
    if (!n) continue;
    if (n === 1) {
      const x = p[ids[0] * 2], y = p[ids[0] * 2 + 1];
      if (options.cap === 'round') discs.push(x, y, 0, STROKE_DOT);
      else if (options.cap === 'square') segments.push(x, y, x, y, 0, STROKE_START | STROKE_END | STROKE_DOT);
      continue;
    }
    const lengths = new Float32Array(n);
    let length = 0;
    for (let i = 0, end = ring ? n : n - 1; i < end; i++) {
      const a = ids[i] * 2, b = ids[(i + 1) % n] * 2;
      lengths[i] = length;
      const flags = ring ? STROKE_CLOSED : (i === 0 ? STROKE_START : 0) | (i === end - 1 ? STROKE_END : 0);
      segments.push(p[a], p[a + 1], p[b], p[b + 1], length, flags);
      length += Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1]);
    }
    if (!ring) lengths[n - 1] = length;
    for (let i = ring ? 0 : 1, end = ring ? n : n - 1; i < end; i++) {
      const a = ids[(i + n - 1) % n] * 2, b = ids[i] * 2, c = ids[(i + 1) % n] * 2, along = lengths[i];
      if (options.join === 'round') { discs.push(p[b], p[b + 1], along, ring ? STROKE_CLOSED : 0); continue; }
      const l1 = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1]), l2 = Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1]);
      const ux = (p[b] - p[a]) / l1, uy = (p[b + 1] - p[a + 1]) / l1;
      const vx = (p[c] - p[b]) / l2, vy = (p[c + 1] - p[b + 1]) / l2;
      const turn = ux * vy - uy * vx;
      if (Math.abs(turn) < 1e-7) continue;
      const side = turn > 0 ? -1 : 1, nx = -uy * side, ny = ux * side, mx = -vy * side, my = vx * side;
      const denom = 1 + nx * mx + ny * my;
      const ox = denom > 1e-12 ? (nx + mx) / denom : 0, oy = denom > 1e-12 ? (ny + my) / denom : 0;
      const miter = options.join === 'miter' && denom > 1e-12 && Math.hypot(ox, oy) <= options.miterLimit;
      // Keep adjacent points so the GPU can recompute the wedge after an anisotropic transform.
      joins.push(p[a], p[a + 1], p[b], p[b + 1], p[c], p[c + 1], along, options.join === 'miter' ? 2 : 1);
      const x = p[b], y = p[b + 1], x1 = x + nx * hw, y1 = y + ny * hw, x2 = x + mx * hw, y2 = y + my * hw;
      if (miter) {
        const xx = x + ox * hw, yy = y + oy * hw;
        triangles.push(x, y, along, x1, y1, along, xx, yy, along, x, y, along, xx, yy, along, x2, y2, along);
      } else triangles.push(x, y, along, x1, y1, along, x2, y2, along);
    }
  }
  return { segments: segments.done(), discs: discs.done(), joins: joins.done(), triangles: triangles.done() };
}
