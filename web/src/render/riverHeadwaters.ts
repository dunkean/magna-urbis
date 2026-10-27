/** Display-only headwater emergence (port of godot-render/tools/river_headwaters.mjs, docs/surface/RIVER_HEADWATERS.md).
 * A genuine spring starts at 0.6 m and smoothsteps to its retained width, instead of a disc of the full initial width.
 * Topology, discharge and downstream widths are untouched. Used by the Blended ground option (groundBlend.ts). */
export const HEADWATER_PROFILE = { version: 1, minimumWidthMetres: 0.6, minimumReachMetres: 100, maximumReachMetres: 420, widthMultiples: 10 };

/** What the classifier reads of a river line (RiverLine, riverVectors.ts). */
export interface HeadwaterLine { points: number[]; area: number[]; level: number[]; kind: number[] }
export interface HeadwaterContext { rivers: readonly HeadwaterLine[]; lakeLinks?: readonly HeadwaterLine[]; hydro: { width: number; n: number; sea: ArrayLike<number> }; lake: ArrayLike<number> }
export interface HeadwaterGeometry { points: number[]; widths: number[]; level: number[]; kind: number[]; reach: number }

function segmentDistance(x: number, y: number, p: readonly number[], i: number): number {
  const ax = p[2 * i], ay = p[2 * i + 1], dx = p[2 * i + 2] - ax, dy = p[2 * i + 3] - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Only actual small headwaters: not map-edge inflows, lake or sea outlets, lines starting on another line, or large initial flows. */
export function isHeadwater(line: HeadwaterLine, ctx: HeadwaterContext, threshold: number): boolean {
  const p = line.points, { hydro } = ctx, cell = hydro.width / hydro.n, x = p[0], y = p[1];
  if (line.area.length < 2 || x < 2 * cell || y < 2 * cell || x > hydro.width - 2 * cell || y > hydro.width - 2 * cell) return false;
  if (line.area[0] > threshold * 2) return false;
  const ix = Math.floor(x / cell), iy = Math.floor(y / cell);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = ix + dx, yy = iy + dy;
    if (xx < 0 || yy < 0 || xx >= hydro.n || yy >= hydro.n) continue;
    if (hydro.sea[yy * hydro.n + xx] || ctx.lake[yy * hydro.n + xx]) return false;
  }
  const near = cell * 0.8;
  for (const other of [...ctx.rivers, ...(ctx.lakeLinks ?? [])]) {
    if (other === line) continue;
    const q = other.points;
    for (let i = 0; i + 1 < other.area.length; i++) {
      // Cheap box test before the exact distance.
      const x0 = q[2 * i], y0 = q[2 * i + 1], x1 = q[2 * i + 2], y1 = q[2 * i + 3];
      if (x < Math.min(x0, x1) - near || x > Math.max(x0, x1) + near || y < Math.min(y0, y1) - near || y > Math.max(y0, y1) + near) continue;
      if (segmentDistance(x, y, q, i) < near) return false;
    }
  }
  return true;
}

/** Smoothly resolve a small spring into its retained width; the first segments are subdivided. */
export function headwaterGeometry(line: HeadwaterLine, widths: readonly number[]): HeadwaterGeometry {
  const s = HEADWATER_PROFILE, p = line.points;
  let total = 0;
  for (let i = 1; i < widths.length; i++) total += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
  // Short streams still recover their full width well before the confluence.
  const reach = Math.min(total * 0.6, Math.max(s.minimumReachMetres, Math.min(s.maximumReachMetres, widths[0] * s.widthMultiples)));
  const points: number[] = [], out: number[] = [], level: number[] = [], kind: number[] = [];
  let arc = 0;
  const add = (x: number, y: number, width: number, lv: number, k: number, distance: number): void => {
    const u = Math.min(1, distance / Math.max(0.001, reach)), smooth = u * u * (3 - 2 * u), floor = Math.min(width, s.minimumWidthMetres);
    points.push(x, y); out.push(floor + (width - floor) * smooth); level.push(lv); kind.push(k);
  };
  add(p[0], p[1], widths[0], line.level[0], line.kind[0], 0);
  for (let i = 1; i < widths.length; i++) {
    const x0 = p[2 * i - 2], y0 = p[2 * i - 1], x1 = p[2 * i], y1 = p[2 * i + 1], length = Math.hypot(x1 - x0, y1 - y0);
    const pieces = arc < reach ? Math.max(1, Math.ceil(length / Math.max(2, reach / 24))) : 1;
    for (let j = 1; j <= pieces; j++) {
      const t = j / pieces;
      add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, widths[i - 1] + (widths[i] - widths[i - 1]) * t, line.level[i - 1] + (line.level[i] - line.level[i - 1]) * t,
        j === pieces ? line.kind[i] ?? line.kind[i - 1] : line.kind[i - 1], arc + length * t);
    }
    arc += length;
  }
  return { points, widths: out, level, kind, reach };
}
