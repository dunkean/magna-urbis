/** Contour polylines shared by the SVG and Canvas renderers. */
import type { World, Polyline } from '../gen/types';
import type { Relief } from '../gen/options';
import { chaikin, simplify, polylineLength } from '../gen/core/geom';
import { sampleGrid } from '../gen/core/grid';
import { contourLevels } from '../../../rust/bridge/renderGeometry';

export const CONTOUR_INTERVAL: Record<Relief, number> = { flat: 2, hills: 5, valley: 5, mountains: 20 };

export interface ContourSet {
  /** Polylines; closed ones carry `closed` (the first point is NOT repeated). */
  thin: { pts: Polyline; closed: boolean }[];
  index: { pts: Polyline; closed: boolean }[];
}

/** Every 5th level is an index contour; short and near-flat loops are dropped. `u` = mapSize / 1600. */
export function contourSet(world: World, u: number, interval = CONTOUR_INTERVAL[world.options.relief], slopeScale = 1): ContourSet {
  const t = world.terrain;
  const hg = t.height;
  let maxH = 0, minH = Infinity;
  for (let i = 0; i < hg.data.length; i++) { maxH = Math.max(maxH, hg.data[i]); minH = Math.min(minH, hg.data[i]); }
  const out: ContourSet = { thin: [], index: [] };
  const levels: number[] = [];
  // High plateaus need only their occupied height range, even at sub-metre intervals.
  const first = Math.max(1, Math.ceil(minH / interval));
  for (let level = first; level * interval < maxH; level++) levels.push(level * interval);
  // All levels in one Rust call (marching squares + chaining, render_geometry::contours).
  const lines = contourLevels(hg.data, hg.w, hg.h, levels, hg.cell, hg.cell / 2, hg.cell / 2);
  for (let k = 1; k <= levels.length; k++) {
    const dst = (first + k - 1) % 5 === 0 ? out.index : out.thin;
    for (const p of lines[k - 1]) {
      if (p.pts.length < 4) continue;
      let pts = p.pts;
      if (polylineLength(pts) < 35 * u) continue;
      let sl = 0;
      for (const q of pts) sl += sampleGrid(t.slope, q.x, q.y);
      if (sl / pts.length < (world.options.relief === 'flat' ? 0.004 : 0.012) * slopeScale) continue;
      pts = chaikin(pts, 3, p.closed);
      pts = simplify(pts, 0.35 * u);
      dst.push({ pts, closed: p.closed });
    }
  }
  return out;
}
