import { waterSampler } from './waterStyle';
import { hexToRgb, type MapStyle, type Palette } from './styles';
import { marchingSquares } from '../gen/terrain/contour';

// Width in world metres, shared by all camera regions and both renderers.
export const SEA_BAND_WIDTH = 0.016;
/** Compatibility adapter; every palette now supports the same coastal material. */
export const hasCoastalSea = (_style: MapStyle | 'copernicus' | 'render' | 'fantasy-ink' | 'fantasy-color'): boolean => true;
export function coastalSeaColors(pal: Palette): { shore: number[]; offshore: number[]; sample: (position: number) => number[] } {
  return { shore: hexToRgb(pal.water.stops[0][1]), offshore: hexToRgb(pal.water.stops[pal.water.stops.length - 1][1]), sample: waterSampler(pal.water) };
}
export function coastalSeaColor(distance: number, bandWidth: number, _shadeFactor: number, colors: ReturnType<typeof coastalSeaColors>): number[] {
  return colors.sample(Math.max(0, distance) / Math.max(1e-6, bandWidth));
}

interface Segment { ax: number; ay: number; bx: number; by: number }

/** Signed Euclidean distance to the sub-cell zero contour, capped at the coastal
 * band. Each segment updates only the texels within the band around it (the minimum
 * is order independent, so the values equal a per-texel nearest-segment search). */
function narrowCoastDistances(height: Float32Array, n: number, cell: number, bandWidth: number): Float32Array {
  const segments: Segment[] = [];
  for (const path of marchingSquares(height, n, n, 0, cell, cell / 2, cell / 2)) {
    for (let i = 1; i < path.pts.length + (path.closed ? 1 : 0); i++) {
      const a = path.pts[i - 1], b = path.pts[i % path.pts.length];
      segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  const limit = bandWidth * bandWidth;
  const best = new Float64Array(n * n).fill(limit);
  for (const s of segments) {
    const dx = s.bx - s.ax, dy = s.by - s.ay, length2 = Math.max(1e-20, dx * dx + dy * dy);
    // Texel centres are at (i + 0.5) * cell.
    const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - bandWidth) / cell - 0.5)), x1 = Math.min(n - 1, Math.ceil((Math.max(s.ax, s.bx) + bandWidth) / cell - 0.5));
    const y0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - bandWidth) / cell - 0.5)), y1 = Math.min(n - 1, Math.ceil((Math.max(s.ay, s.by) + bandWidth) / cell - 0.5));
    for (let y = y0; y <= y1; y++) {
      const py = (y + 0.5) * cell, row = y * n;
      for (let x = x0; x <= x1; x++) {
        const px = (x + 0.5) * cell;
        const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / length2));
        const d = (px - s.ax - t * dx) ** 2 + (py - s.ay - t * dy) ** 2;
        if (d < best[row + x]) best[row + x] = d;
      }
    }
  }
  const distances = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const d = segments.length ? Math.sqrt(best[i]) : bandWidth;
    distances[i] = height[i] > 0 ? -d : d;
  }
  return distances;
}

interface CoastNode { minX: number; minY: number; maxX: number; maxY: number; segments?: Segment[]; left?: CoastNode; right?: CoastNode }

/** Signed Euclidean distance to the sub-cell zero contour, capped at the coastal
 * band. A bounding-volume tree keeps this cheap even for detailed archipelagos. */
function wideCoastDistances(height: Float32Array, n: number, cell: number, bandWidth: number): Float32Array {
  const segments: Segment[] = [];
  for (const path of marchingSquares(height, n, n, 0, cell, cell / 2, cell / 2)) {
    for (let i = 1; i < path.pts.length + (path.closed ? 1 : 0); i++) {
      const a = path.pts[i - 1], b = path.pts[i % path.pts.length];
      segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  const build = (items: Segment[]): CoastNode => {
    const node: CoastNode = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const s of items) {
      node.minX = Math.min(node.minX, s.ax, s.bx); node.maxX = Math.max(node.maxX, s.ax, s.bx);
      node.minY = Math.min(node.minY, s.ay, s.by); node.maxY = Math.max(node.maxY, s.ay, s.by);
    }
    if (items.length <= 8) node.segments = items;
    else {
      const horizontal = node.maxX - node.minX >= node.maxY - node.minY;
      items.sort((a, b) => horizontal ? a.ax + a.bx - b.ax - b.bx : a.ay + a.by - b.ay - b.by);
      const middle = items.length >> 1;
      node.left = build(items.slice(0, middle)); node.right = build(items.slice(middle));
    }
    return node;
  };
  const root = segments.length ? build(segments) : undefined;
  const boxDistance = (node: CoastNode, x: number, y: number): number => {
    const dx = Math.max(node.minX - x, 0, x - node.maxX), dy = Math.max(node.minY - y, 0, y - node.maxY);
    return dx * dx + dy * dy;
  };
  const segmentDistance = (s: Segment, x: number, y: number): number => {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / Math.max(1e-20, dx * dx + dy * dy)));
    return (x - s.ax - t * dx) ** 2 + (y - s.ay - t * dy) ** 2;
  };
  // The previous texel's nearest segment bounds this texel's search (its true distance to that segment), so the
  // tree prunes from the first node; the minimum over all segments is unchanged.
  let found: Segment | undefined;
  const nearest = (node: CoastNode, x: number, y: number, best: number): number => {
    if (boxDistance(node, x, y) >= best) return best;
    if (node.segments) {
      for (const s of node.segments) {
        const d = segmentDistance(s, x, y);
        if (d < best) { best = d; found = s; }
      }
      return best;
    }
    let a = node.left!, b = node.right!;
    if (boxDistance(a, x, y) > boxDistance(b, x, y)) [a, b] = [b, a];
    return nearest(b, x, y, nearest(a, x, y, best));
  };
  const distances = new Float32Array(n * n), limit = bandWidth * bandWidth;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, px = (x + 0.5) * cell, py = (y + 0.5) * cell;
    let start = limit;
    if (found) { const bound = segmentDistance(found, px, py); if (bound < start) start = bound; else found = undefined; }
    const d = root ? Math.sqrt(nearest(root, px, py, start)) : bandWidth;
    distances[i] = height[i] > 0 ? -d : d;
  }
  return distances;
}

/** Signed Euclidean distance to the sub-cell zero contour, capped at the coastal band. */
export function coastDistances(height: Float32Array, n: number, cell: number, bandWidth: number): Float32Array {
  return bandWidth <= 24 * cell ? narrowCoastDistances(height, n, cell, bandWidth) : wideCoastDistances(height, n, cell, bandWidth);
}
