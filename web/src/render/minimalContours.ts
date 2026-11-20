/** World-space minimal contours. Called once per terrain by the contour worker; never accepts a camera.
 * Reuses the generator's marching squares, since the cartographic extractor selects/smooths levels per view.
 * The interval rounds up max(land height range / 96, 5 m * sqrt(map width / 6 km)) to 1/2/5 decades.
 * Thus hills on 6 km maps use 5–10 m, while regional maps scale the spacing without changing it on zoom.
 */
import { marchingSquares } from '../gen/terrain/contour';
import { simplify } from '../gen/core/geom';
import type { MinimalGeometry, MinimalFeature, MinimalHeight } from './minimalMap';

export function minimalContourInterval(range: number, width: number): number {
  const raw = Math.max(1, range / 96, 5 * Math.sqrt(width / 6000));
  const unit = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].find(step => step * unit >= raw)! * unit;
}

export function* minimalContours(height: MinimalHeight): Generator<MinimalFeature> {
  const n = height.n,
    m = Math.max(2, Math.min(512, n)),
    cell = height.width / m;
  const field = new Float32Array(m * m);
  const tap = (k: number, q: number): number => Math.min(n - 1, Math.floor(((k + q) * n) / m));
  let top = -Infinity,
    bottom = Infinity;
  for (let y = 0; y < m; y++)
    for (let x = 0; x < m; x++) {
      const x0 = tap(x, 0.25),
        x1 = tap(x, 0.75),
        y0 = tap(y, 0.25) * n,
        y1 = tap(y, 0.75) * n;
      const h = (height.data[y0 + x0] + height.data[y0 + x1] + height.data[y1 + x0] + height.data[y1 + x1]) / 4;
      field[y * m + x] = h;
      if (Number.isFinite(h)) {
        top = Math.max(top, h);
        if (h >= 0) bottom = Math.min(bottom, h);
      }
    }
  if (!(top > bottom)) return;
  const interval = minimalContourInterval(top - bottom, height.width);
  for (let k = Math.max(1, Math.floor(bottom / interval) + 1); k * interval < top; k++) {
    for (const line of marchingSquares(field, m, m, k * interval, cell, cell / 2, cell / 2)) {
      if (line.pts.length < 2) continue;
      const layer = k % 5 ? 'contour' : 'contourIndex';
      // Small overlapping chunks keep long rings cullable by the painter's retained spatial batches.
      if (line.pts.length <= 64) yield { layer, points: line.pts, closed: line.closed };
      else {
        const points = line.closed ? [...line.pts, line.pts[0]] : line.pts;
        for (let i = 0; i < points.length - 1; i += 63) yield { layer, points: points.slice(i, i + 64) };
      }
    }
  }
}

/** Exact Canvas paths plus retained instanced segments for moving views. */
export interface MinimalContourProducts {
  features: MinimalFeature[];
  levels: MinimalContourSet['levels'];
}
export interface MinimalContourSet {
  exact: MinimalGeometry;
  levels: { scale: number; segments: Float32Array }[];
}
/** Simplification is bounded by half a device pixel at this level's largest scale. Each segment is two world-space
 * endpoints and its contour weight; the GPU clips it to the view and draws all visible weights in one pass. */
export function* minimalContourSegments(features: readonly MinimalFeature[], scale: number): Generator<void, Float32Array> {
  const capacity = features.reduce((sum, feature) => sum + feature.points.length, 0),
    data = new Float32Array(capacity * 5);
  let used = 0;
  for (const feature of features) {
    if (feature.points.length < 2) continue;
    const ring = feature.closed ? [...feature.points, feature.points[0]] : [...feature.points],
      points = simplify(ring, 0.5 / scale),
      weight = feature.layer === 'contourIndex' ? 1 : 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      data[used++] = a.x;
      data[used++] = a.y;
      data[used++] = b.x;
      data[used++] = b.y;
      data[used++] = weight;
    }
    yield;
  }
  return data.slice(0, used);
}
