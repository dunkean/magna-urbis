import { hexToRgb, type MapStyle, type Palette } from './styles';
import { marchingSquares } from '../gen/terrain/contour';

// Width in world metres, shared by all camera regions and both renderers.
export const SEA_BAND_WIDTH = 0.016;
export const SEA_SHADE_STRENGTH = 0.15;
export const SEA_SHADE_LIMIT = 0.035;
export const hasCoastalSea = (style: MapStyle | 'copernicus' | 'render' | 'fantasy-ink' | 'fantasy-color'): boolean => style === 'parchment' || style === 'atlas';

export function coastalSeaColors(pal: Palette): { shore: number[]; offshore: number[] } {
  return { shore: hexToRgb(pal.waterEdge), offshore: hexToRgb(pal.seaFill) };
}

/** Smooth coastal tint and a faint hillshade, fading to the exact water ink at shore. */
export function coastalSeaColor(distance: number, bandWidth: number, shadeFactor: number, colors: ReturnType<typeof coastalSeaColors>): number[] {
  const t = Math.max(0, Math.min(1, distance / Math.max(1e-6, bandWidth)));
  const blend = t * t * (3 - 2 * t);
  const shade = 1 + Math.max(-SEA_SHADE_LIMIT, Math.min(SEA_SHADE_LIMIT, (shadeFactor - 1) * SEA_SHADE_STRENGTH)) * blend;
  return colors.shore.map((shore, channel) => (shore + (colors.offshore[channel] - shore) * blend) * shade);
}

interface Segment { ax: number; ay: number; bx: number; by: number }
interface CoastNode { minX: number; minY: number; maxX: number; maxY: number; segments?: Segment[]; left?: CoastNode; right?: CoastNode }

/** Signed Euclidean distance to the sub-cell zero contour, capped at the coastal
 * band. A bounding-volume tree keeps this cheap even for detailed archipelagos. */
export function coastDistances(height: Float32Array, n: number, cell: number, bandWidth: number): Float32Array {
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
  const nearest = (node: CoastNode, x: number, y: number, best: number): number => {
    if (boxDistance(node, x, y) >= best) return best;
    if (node.segments) {
      for (const s of node.segments) {
        const dx = s.bx - s.ax, dy = s.by - s.ay;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / Math.max(1e-20, dx * dx + dy * dy)));
        best = Math.min(best, (x - s.ax - t * dx) ** 2 + (y - s.ay - t * dy) ** 2);
      }
      return best;
    }
    let a = node.left!, b = node.right!;
    if (boxDistance(a, x, y) > boxDistance(b, x, y)) [a, b] = [b, a];
    return nearest(b, x, y, nearest(a, x, y, best));
  };
  const distances = new Float32Array(n * n), limit = bandWidth * bandWidth;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, d = root ? Math.sqrt(nearest(root, (x + 0.5) * cell, (y + 0.5) * cell, limit)) : bandWidth;
    distances[i] = height[i] > 0 ? -d : d;
  }
  return distances;
}
