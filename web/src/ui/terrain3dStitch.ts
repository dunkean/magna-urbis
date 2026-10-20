/** The displayed triangle field, before joining it to its neighbours. */
export interface TerrainStitchPiece {
  key: string;
  x: number;
  y: number;
  width: number;
  cells: number;
  clip: { x: number; y: number; width: number };
  vertex: (x: number, y: number) => readonly [number, number, number];
}
export interface TerrainStitchedPiece {
  source: TerrainStitchPiece;
  /** Height and the two physical gradient corrections, in vertex order. */
  correction: Float32Array;
  releaseSpeed: Float32Array;
  releasing: boolean;
  vertex: (x: number, y: number) => readonly [number, number, number];
}
type Segment = { owner: TerrainStitchedPiece; axis: 0 | 1; fixed: number; low: number; high: number };

/** Interpolate the same diagonal and vertex gradients as the GPU mesh. */
export function sampleTerrainPiece(piece: TerrainStitchedPiece, x: number, y: number): [number, number, number] {
  const p = piece.source, step = p.width / p.cells;
  const gx = Math.max(0, Math.min(p.cells, (x - p.x) / step));
  const gy = Math.max(0, Math.min(p.cells, (y - p.y) / step));
  const ix = Math.min(p.cells - 1, Math.floor(gx)), iy = Math.min(p.cells - 1, Math.floor(gy));
  const tx = gx - ix, ty = gy - iy;
  const points = tx + ty <= 1 ? [[ix, iy, 1 - tx - ty], [ix + 1, iy, tx], [ix, iy + 1, ty]]
    : [[ix + 1, iy, 1 - ty], [ix, iy + 1, 1 - tx], [ix + 1, iy + 1, tx + ty - 1]];
  const result: [number, number, number] = [0, 0, 0];
  for (const [px, py, weight] of points) {
    if (!weight) continue;
    const value = piece.vertex(px, py);
    for (let k = 0; k < 3; k++) result[k] += value[k] * weight;
  }
  return result;
}

/**
 * Coarse displayed triangles own their shared edge. A fine edge is projected
 * onto that exact polyline, including intermediate T junctions and morphs.
 * Equal grids have a stable world-key owner, so asynchronous decoder responses
 * and traversal order cannot choose different heights for the same edge.
 */
export function stitchTerrainPieces(sources: TerrainStitchPiece[], previous: TerrainStitchedPiece[] = [], elapsed = 0): TerrainStitchedPiece[] {
  const order = [...sources].sort((a, b) => b.width / b.cells - a.width / a.cells || a.key.localeCompare(b.key));
  const done: TerrainStitchedPiece[] = [], results = new Map<TerrainStitchPiece, TerrainStitchedPiece>();
  const history = new Map(previous.map(piece => [piece.source.key, piece]));
  for (const source of order) {
    const side = source.cells + 1, step = source.width / source.cells;
    const correction = new Float32Array(side * side * 3), releaseSpeed = new Float32Array(correction.length), old = history.get(source.key);
    const piece: TerrainStitchedPiece = { source, correction, releaseSpeed, releasing: false, vertex: (x, y) => {
      const base = source.vertex(x, y), at = (y * side + x) * 3;
      return [base[0] + correction[at], base[1] + correction[at + 1], base[2] + correction[at + 2]];
    } };
    const bounds = source.clip, epsilon = Math.max(1e-8, source.width * 1e-10), segments: Segment[] = [];
    for (const owner of done) {
      const other = owner.source.clip;
      const lowY = Math.max(bounds.y, other.y), highY = Math.min(bounds.y + bounds.width, other.y + other.width);
      const lowX = Math.max(bounds.x, other.x), highX = Math.min(bounds.x + bounds.width, other.x + other.width);
      if (highY >= lowY - epsilon) {
        if (Math.abs(bounds.x - other.x - other.width) < epsilon) segments.push({ owner, axis: 0, fixed: bounds.x, low: lowY, high: highY });
        else if (Math.abs(bounds.x + bounds.width - other.x) < epsilon) segments.push({ owner, axis: 0, fixed: other.x, low: lowY, high: highY });
      }
      if (highX >= lowX - epsilon) {
        if (Math.abs(bounds.y - other.y - other.width) < epsilon) segments.push({ owner, axis: 1, fixed: bounds.y, low: lowX, high: highX });
        else if (Math.abs(bounds.y + bounds.width - other.y) < epsilon) segments.push({ owner, axis: 1, fixed: other.y, low: lowX, high: highX });
      }
    }
    const band = step * 3;
    if (segments.length || old) for (let iy = 0; iy < side; iy++) for (let ix = 0; ix < side; ix++) {
      const x = source.x + ix * step, y = source.y + iy * step;
      if (x < bounds.x - epsilon || x > bounds.x + bounds.width + epsilon || y < bounds.y - epsilon || y > bounds.y + bounds.width + epsilon) continue;
      const boundary = Math.abs(x - bounds.x) < epsilon || Math.abs(x - bounds.x - bounds.width) < epsilon
        || Math.abs(y - bounds.y) < epsilon || Math.abs(y - bounds.y - bounds.width) < epsilon;
      let best: Segment | undefined, weight = 0, px = 0, py = 0;
      for (const segment of segments) {
        const tangent = segment.axis === 0 ? y : x, normal = segment.axis === 0 ? x : y;
        // A corner owner affects the corner itself. Extending it along another
        // shared boundary would contradict that boundary's actual owner.
        if (tangent < segment.low - epsilon || tangent > segment.high + epsilon) continue;
        const distance = Math.abs(normal - segment.fixed);
        if (distance >= band || (boundary && distance > epsilon)) continue;
        if (segment.high - segment.low < epsilon && distance > epsilon) continue;
        const t = Math.max(0, 1 - distance / band), w = t * t * (3 - 2 * t);
        if (w <= weight) continue;
        best = segment; weight = w;
        px = segment.axis === 0 ? segment.fixed : x; py = segment.axis === 1 ? segment.fixed : y;
      }
      if (!best) {
        // If an owner splits, the formerly constrained neighbour can become
        // the new coarse owner. Release its old join over one morph interval
        // rather than exposing its unjoined raw edge in a single frame.
        if (old) for (let k = 0; k < 3; k++) {
          const at = (iy * side + ix) * 3 + k, value = old.correction[at];
          const speed = old.releaseSpeed[at] || Math.abs(value) / 220;
          const next = Math.sign(value) * Math.max(0, Math.abs(value) - speed * Math.max(0, Math.min(50, elapsed)));
          if (Math.abs(next) > 1e-7) { correction[at] = next; releaseSpeed[at] = speed; piece.releasing = true; }
        }
        continue;
      }
      const value = sampleTerrainPiece(best.owner, px, py), base = source.vertex(ix, iy);
      // Continue the owner's tangent into a narrow interior strip. The outer
      // row has precisely its height and normal; the interior stays untouched.
      const target = value[0] + value[1] * (x - px) + value[2] * (y - py), at = (iy * side + ix) * 3;
      correction[at] = (target - base[0]) * weight;
      correction[at + 1] = (value[1] - base[1]) * weight;
      correction[at + 2] = (value[2] - base[2]) * weight;
    }
    done.push(piece); results.set(source, piece);
  }
  return sources.map(source => results.get(source)!);
}
