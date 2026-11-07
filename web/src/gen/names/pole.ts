import type { Vec2, Polygon } from '../core/geom';
import { bbox, polygonCentroid } from '../core/geom';

/**
 * Approximate pole of inaccessibility (point deepest inside the polygon) by coarse grid + refinement.
 *
 * Same samples, same comparisons and same returned numbers as the original ringDist/depth implementation
 * (web/out/perf-2026-11-07/port/forest-names/pole_identity.ts proves it), without per-call allocation and with
 * an edge grid so a sample only visits the edges near it:
 *  - a sample is accepted iff its exact distance to every ring (outer and holes) is above the best so far and it is
 *    inside; the accepted distance is the minimum of the per-edge Math.hypot values, as before;
 *  - the nearest-edge search works on squared distances and only evaluates Math.hypot for the edges within 1e-12
 *    (relative) of the minimum, so ties are resolved on the very values the original minimised;
 *  - rejection by the floor is taken early only when the squared distance is clearly below the floor.
 */
interface Nearest { d2: number; h: number }

class RingIndex {
  readonly count: number;
  // Edge k runs from vertex j (jx, jy) to vertex i (ix, iy) of its ring, as in ringDist (a = ring[j], b = ring[i]).
  readonly jx: Float64Array; readonly jy: Float64Array; readonly ix: Float64Array; readonly iy: Float64Array;
  readonly dx: Float64Array; readonly dy: Float64Array; readonly l2: Float64Array;
  /** Ring boundaries in edge indices, for the parity test. */
  readonly starts: number[] = [];
  /** Ring of every edge, and the edges whose y-extent touches each horizontal band (parity test). */
  private ringOf?: Uint8Array;
  private bands?: { minY: number; scale: number; count: number; offsets: Int32Array; items: Int32Array; parity: Uint8Array };
  private grid?: { minX: number; minY: number; size: number; nx: number; ny: number; offsets: Int32Array; items: Int32Array; stamp: Int32Array; serial: number };

  constructor(rings: Polygon[]) {
    let total = 0;
    for (const r of rings) total += r.length;
    this.count = total;
    this.jx = new Float64Array(total); this.jy = new Float64Array(total); this.ix = new Float64Array(total); this.iy = new Float64Array(total);
    this.dx = new Float64Array(total); this.dy = new Float64Array(total); this.l2 = new Float64Array(total);
    let k = 0;
    for (const ring of rings) {
      this.starts.push(k);
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++, k++) {
        const a = ring[j], b = ring[i];
        this.jx[k] = a.x; this.jy[k] = a.y; this.ix[k] = b.x; this.iy[k] = b.y;
        const dx = b.x - a.x, dy = b.y - a.y;
        this.dx[k] = dx; this.dy[k] = dy; this.l2[k] = dx * dx + dy * dy;
      }
    }
    this.starts.push(total);
    if (total >= 160) { this.buildGrid(); this.buildRows(); }
  }

  private buildRows(): void {
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < this.count; k++) { minY = Math.min(minY, this.jy[k]); maxY = Math.max(maxY, this.jy[k]); }
    if (!(maxY > minY) || !Number.isFinite(maxY - minY) || this.starts.length > 256) return;
    const count = Math.max(8, Math.min(512, Math.round(this.count / 6))), scale = count / (maxY - minY);
    const row = (y: number): number => Math.max(0, Math.min(count - 1, Math.floor((y - minY) * scale)));
    const counts = new Int32Array(count + 1);
    for (let k = 0; k < this.count; k++) for (let r = row(Math.min(this.iy[k], this.jy[k])), end = row(Math.max(this.iy[k], this.jy[k])); r <= end; r++) counts[r + 1]++;
    for (let r = 0; r < count; r++) counts[r + 1] += counts[r];
    const items = new Int32Array(counts[count]), fill = counts.slice(0, count);
    for (let k = 0; k < this.count; k++) for (let r = row(Math.min(this.iy[k], this.jy[k])), end = row(Math.max(this.iy[k], this.jy[k])); r <= end; r++) items[fill[r]++] = k;
    const ringOf = new Uint8Array(this.count);
    for (let ring = 0; ring + 1 < this.starts.length; ring++) ringOf.fill(ring, this.starts[ring], this.starts[ring + 1]);
    this.ringOf = ringOf;
    this.bands = { minY, scale, count, offsets: counts, items, parity: new Uint8Array(this.starts.length - 1) };
  }

  private buildGrid(): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < this.count; k++) {
      minX = Math.min(minX, this.jx[k]); maxX = Math.max(maxX, this.jx[k]); minY = Math.min(minY, this.jy[k]); maxY = Math.max(maxY, this.jy[k]);
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (!(span > 0) || !Number.isFinite(span)) return;
    const g = Math.max(4, Math.min(64, Math.round(Math.sqrt(this.count / 2))));
    const size = span / g, nx = Math.min(g, Math.floor((maxX - minX) / size) + 1), ny = Math.min(g, Math.floor((maxY - minY) / size) + 1);
    const cellOf = (v: number, o: number, n: number): number => Math.max(0, Math.min(n - 1, Math.floor((v - o) / size)));
    const counts = new Int32Array(nx * ny + 1);
    const each = (visit: (cell: number, k: number) => void): void => {
      for (let k = 0; k < this.count; k++) {
        const x0 = cellOf(Math.min(this.jx[k], this.ix[k]), minX, nx), x1 = cellOf(Math.max(this.jx[k], this.ix[k]), minX, nx);
        const y0 = cellOf(Math.min(this.jy[k], this.iy[k]), minY, ny), y1 = cellOf(Math.max(this.jy[k], this.iy[k]), minY, ny);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit(y * nx + x, k);
      }
    };
    each(cell => { counts[cell + 1]++; });
    for (let c = 0; c < nx * ny; c++) counts[c + 1] += counts[c];
    const items = new Int32Array(counts[nx * ny]), fill = counts.slice(0, nx * ny);
    each((cell, k) => { items[fill[cell]++] = k; });
    this.grid = { minX, minY, size, nx, ny, offsets: counts, items, stamp: new Int32Array(this.count), serial: 0 };
  }

  /** Edge k against p, with the original ringDist arithmetic; Math.hypot only for edges within 1e-12 of the running minimum. */
  private visit(k: number, px: number, py: number, near: Nearest): void {
    const l2 = this.l2[k], ax = this.jx[k], ay = this.jy[k], dx = this.dx[k], dy = this.dy[k];
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const ex = px - ax - t * dx, ey = py - ay - t * dy, d2 = ex * ex + ey * ey;
    if (d2 <= near.d2 * (1 + 1e-12)) {
      const h = Math.hypot(ex, ey);
      if (h < near.h) near.h = h;
      if (d2 < near.d2) near.d2 = d2;
    }
  }

  /** Exact minimum edge distance (minimum of the per-edge Math.hypot values), or a value <= `floor` once that is certain. */
  distance(px: number, py: number, floor: number, near: Nearest): number {
    near.d2 = Infinity; near.h = Infinity;
    const floor2 = floor > 0 ? floor * floor * (1 - 1e-12) : -1;
    const grid = this.grid;
    if (!grid) {
      for (let k = 0; k < this.count; k++) {
        this.visit(k, px, py, near);
        if (near.d2 < floor2) return near.h;
      }
      return near.h;
    }
    const { minX, minY, size, nx, ny, offsets, items, stamp } = grid;
    const serial = ++grid.serial;
    const cx = Math.max(0, Math.min(nx - 1, Math.floor((px - minX) / size))), cy = Math.max(0, Math.min(ny - 1, Math.floor((py - minY) / size)));
    const scan = (x: number, y: number): void => {
      for (let c = offsets[y * nx + x], end = offsets[y * nx + x + 1]; c < end; c++) {
        const k = items[c];
        if (stamp[k] === serial) continue;
        stamp[k] = serial;
        this.visit(k, px, py, near);
      }
    };
    const last = Math.max(nx, ny);
    for (let r = 0; r <= last; r++) {
      const y0 = cy - r, y1 = cy + r, x0 = cx - r, x1 = cx + r;
      for (let y = Math.max(0, y0); y <= Math.min(ny - 1, y1); y++) {
        if (y === y0 || y === y1) { for (let x = Math.max(0, x0); x <= Math.min(nx - 1, x1); x++) scan(x, y); }
        else { if (x0 >= 0) scan(x0, y); if (x1 < nx) scan(x1, y); }
      }
      if (near.d2 < floor2) return near.h;
      // Every edge not seen yet lies entirely in cells more than r cells away from p's (clamped) cell: at least r * size from p.
      const bound = r * size;
      if (near.d2 < bound * bound * (1 - 1e-9)) return near.h;
    }
    return near.h;
  }

  /** Whether p is inside the outer ring and outside every hole (polygonContains of each), over the edges of p's band only. */
  insideAll(px: number, py: number, rings: number): boolean {
    const bands = this.bands;
    if (!bands) {
      if (!this.contains(0, px, py)) return false;
      for (let h = 1; h < rings; h++) if (this.contains(h, px, py)) return false;
      return true;
    }
    const { minY, scale, count, offsets, items, parity } = bands, ringOf = this.ringOf!;
    parity.fill(0);
    // An edge that toggles the parity has min(iy, jy) <= py < max(iy, jy): its band range contains py's band.
    const r = Math.max(0, Math.min(count - 1, Math.floor((py - minY) * scale)));
    for (let c = offsets[r], end = offsets[r + 1]; c < end; c++) {
      const k = items[c], iy = this.iy[k], jy = this.jy[k];
      if ((iy > py) !== (jy > py) && px < (-this.dx[k] * (py - iy)) / -this.dy[k] + this.ix[k]) parity[ringOf[k]] ^= 1;
    }
    if (!parity[0]) return false;
    for (let h = 1; h < rings; h++) if (parity[h]) return false;
    return true;
  }

  /** polygonContains of one ring: same predicate and arithmetic as geom.ts (a = ring[i], b = ring[j]; its differences are the exact negations of dx/dy). */
  contains(ring: number, px: number, py: number): boolean {
    let inside = false;
    for (let k = this.starts[ring], end = this.starts[ring + 1]; k < end; k++) {
      const iy = this.iy[k], jy = this.jy[k];
      if ((iy > py) !== (jy > py) && px < (-this.dx[k] * (py - iy)) / -this.dy[k] + this.ix[k]) inside = !inside;
    }
    return inside;
  }
}

export function poleOf(poly: Polygon, holes: Polygon[] = []): { p: Vec2; r: number } {
  const b = bbox(poly);
  let best = polygonCentroid(poly), bestR = -1;
  const index = new RingIndex([poly, ...holes]), near: Nearest = { d2: Infinity, h: Infinity };
  const depth = (px: number, py: number): number => {
    // Only a depth above the best so far matters: a ring distance <= bestR rejects the sample, inside or not.
    const d = index.distance(px, py, bestR, near);
    if (d <= bestR) return d;
    return index.insideAll(px, py, 1 + holes.length) ? d : -1;
  };
  let cx0 = b.minX, cy0 = b.minY, w = b.maxX - b.minX, h = b.maxY - b.minY;
  for (let pass = 0; pass < 3; pass++) {
    const N = 12;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = cx0 + (w * i) / N, y = cy0 + (h * j) / N;
      const d = depth(x, y);
      if (d > bestR) { bestR = d; best = { x, y }; }
    }
    w /= 5; h /= 5; cx0 = best.x - w / 2; cy0 = best.y - h / 2;
  }
  if (bestR < 0) return { p: polygonCentroid(poly), r: 0 };
  return { p: best, r: bestR };
}
