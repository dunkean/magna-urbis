/** The displayed triangle field, before joining it to its neighbours. */
export interface TerrainStitchPiece {
  key: string;
  x: number;
  y: number;
  width: number;
  cells: number;
  clip: { x: number; y: number; width: number };
  vertex: (x: number, y: number) => readonly [number, number, number];
  /** The same values as `vertex` without a tuple: the join reads tens of thousands per frame. */
  read?: (x: number, y: number, out: Float64Array) => void;
}
export interface TerrainStitchedPiece {
  source: TerrainStitchPiece;
  /** Height and the two physical gradient corrections, in vertex order. */
  correction: Float32Array;
  /** Allocated only once a join is being released. */
  releaseSpeed?: Float32Array;
  releasing: boolean;
  vertex: (x: number, y: number) => readonly [number, number, number];
  /** Vertices that may hold a correction: every other one is zero. */
  touched: number[];
  segments: TerrainStitchSegment[];
}
export type TerrainStitchSegment = { owner: TerrainStitchedPiece; axis: 0 | 1; fixed: number; low: number; high: number };
export interface TerrainStitchOptions {
  /** Whether two pieces of one key draw the same surface: such a piece keeps its join while its owners keep theirs. */
  same?: (a: TerrainStitchPiece, b: TerrainStitchPiece) => boolean;
  /** Floats kept free after the correction, in the same buffer (the caller's skirt vertices). */
  tail?: number;
}

const vertexValue = new Float64Array(3), ownerValue = new Float64Array(3);
function readVertex(source: TerrainStitchPiece, x: number, y: number): void {
  if (source.read) { source.read(x, y, vertexValue); return; }
  const value = source.vertex(x, y); vertexValue[0] = value[0]; vertexValue[1] = value[1]; vertexValue[2] = value[2];
}
function addVertex(piece: TerrainStitchedPiece, x: number, y: number, weight: number, out: Float64Array): void {
  if (!weight) return;
  const source = piece.source, correction = piece.correction, at = (y * (source.cells + 1) + x) * 3;
  readVertex(source, x, y);
  out[0] += (vertexValue[0] + correction[at]) * weight;
  out[1] += (vertexValue[1] + correction[at + 1]) * weight;
  out[2] += (vertexValue[2] + correction[at + 2]) * weight;
}
function samplePiece(piece: TerrainStitchedPiece, x: number, y: number, out: Float64Array): void {
  const p = piece.source, step = p.width / p.cells;
  const gx = Math.max(0, Math.min(p.cells, (x - p.x) / step));
  const gy = Math.max(0, Math.min(p.cells, (y - p.y) / step));
  const ix = Math.min(p.cells - 1, Math.floor(gx)), iy = Math.min(p.cells - 1, Math.floor(gy));
  const tx = gx - ix, ty = gy - iy;
  out[0] = out[1] = out[2] = 0;
  if (tx + ty <= 1) {
    addVertex(piece, ix, iy, 1 - tx - ty, out); addVertex(piece, ix + 1, iy, tx, out); addVertex(piece, ix, iy + 1, ty, out);
  } else {
    addVertex(piece, ix + 1, iy, 1 - ty, out); addVertex(piece, ix, iy + 1, 1 - tx, out); addVertex(piece, ix + 1, iy + 1, tx + ty - 1, out);
  }
}
/** Interpolate the same diagonal and vertex gradients as the GPU mesh. */
export function sampleTerrainPiece(piece: TerrainStitchedPiece, x: number, y: number): [number, number, number] {
  const out = new Float64Array(3); samplePiece(piece, x, y, out);
  return [out[0], out[1], out[2]];
}
const sameSegments = (a: TerrainStitchSegment[], b: TerrainStitchSegment[]): boolean => a.length === b.length && a.every((segment, i) => {
  const other = b[i];
  return segment.owner === other.owner && segment.axis === other.axis && segment.fixed === other.fixed && segment.low === other.low && segment.high === other.high;
});
// Scratch of one piece's join, reset between pieces.
let joined = new Uint8Array(0), memoStamp = new Uint32Array(0), memoValue = new Float64Array(0), memoGeneration = 0;

/**
 * Coarse displayed triangles own their shared edge. A fine edge is projected
 * onto that exact polyline, including intermediate T junctions and morphs.
 * Equal grids have a stable world-key owner, so asynchronous decoder responses
 * and traversal order cannot choose different heights for the same edge.
 */
export function stitchTerrainPieces(sources: TerrainStitchPiece[], previous: TerrainStitchedPiece[] = [], elapsed = 0, options: TerrainStitchOptions = {}): TerrainStitchedPiece[] {
  const order = [...sources].sort((a, b) => b.width / b.cells - a.width / a.cells || a.key.localeCompare(b.key));
  const done: TerrainStitchedPiece[] = [], results = new Map<TerrainStitchPiece, TerrainStitchedPiece>();
  const history = new Map(previous.map(piece => [piece.source.key, piece]));
  const tail = options.tail ?? 0;
  for (const source of order) {
    const side = source.cells + 1, step = source.width / source.cells, old = history.get(source.key);
    const bounds = source.clip, epsilon = Math.max(1e-8, source.width * 1e-10), segments: TerrainStitchSegment[] = [];
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
    // A correction is a function of the piece's surface, its owners' surfaces and, for a release, its
    // old values: with none of them changed, the previous join is exactly what the loops below would write.
    if (old && !old.releasing && options.same?.(old.source, source) && sameSegments(old.segments, segments)) {
      done.push(old); results.set(source, old); continue;
    }
    const values = side * side * 3, storage = new Float32Array(values + tail), correction = tail ? storage.subarray(0, values) : storage;
    const touched: number[] = [];
    const piece: TerrainStitchedPiece = { source, correction, releasing: false, touched, segments, vertex: (x, y) => {
      const base = source.vertex(x, y), at = (y * side + x) * 3;
      return [base[0] + correction[at], base[1] + correction[at + 1], base[2] + correction[at + 2]];
    } };
    const band = step * 3, memoSlots = segments.length * side, generation = ++memoGeneration;
    if (joined.length < side * side) joined = new Uint8Array(side * side);
    if (memoStamp.length < memoSlots) { memoStamp = new Uint32Array(memoSlots); memoValue = new Float64Array(memoSlots * 3); }
    // Only columns and rows within a band of a segment can be joined.
    const nearColumn = new Uint8Array(side), nearRow = new Uint8Array(side);
    for (const segment of segments) for (let i = 0; i < side; i++) {
      if (Math.abs((segment.axis === 0 ? source.x : source.y) + i * step - segment.fixed) < band) (segment.axis === 0 ? nearColumn : nearRow)[i] = 1;
    }
    if (segments.length) for (let iy = 0; iy < side; iy++) for (let ix = 0; ix < side; ix++) {
      if (!nearRow[iy] && !nearColumn[ix]) continue;
      const x = source.x + ix * step, y = source.y + iy * step;
      if (x < bounds.x - epsilon || x > bounds.x + bounds.width + epsilon || y < bounds.y - epsilon || y > bounds.y + bounds.width + epsilon) continue;
      const boundary = Math.abs(x - bounds.x) < epsilon || Math.abs(x - bounds.x - bounds.width) < epsilon
        || Math.abs(y - bounds.y) < epsilon || Math.abs(y - bounds.y - bounds.width) < epsilon;
      let best = -1, weight = 0, px = 0, py = 0;
      for (let s = 0; s < segments.length; s++) {
        const segment = segments[s], tangent = segment.axis === 0 ? y : x, normal = segment.axis === 0 ? x : y;
        // A corner owner affects the corner itself. Extending it along another
        // shared boundary would contradict that boundary's actual owner.
        if (tangent < segment.low - epsilon || tangent > segment.high + epsilon) continue;
        const distance = Math.abs(normal - segment.fixed);
        if (distance >= band || (boundary && distance > epsilon)) continue;
        if (segment.high - segment.low < epsilon && distance > epsilon) continue;
        const t = Math.max(0, 1 - distance / band), w = t * t * (3 - 2 * t);
        if (w <= weight) continue;
        best = s; weight = w;
        px = segment.axis === 0 ? segment.fixed : x; py = segment.axis === 1 ? segment.fixed : y;
      }
      if (best < 0) continue;
      // The rows of a band project onto one owner point: its tangent position names it.
      const segment = segments[best], slot = best * side + (segment.axis === 0 ? iy : ix), memo = slot * 3;
      if (memoStamp[slot] !== generation) {
        samplePiece(segment.owner, px, py, ownerValue);
        memoStamp[slot] = generation; memoValue[memo] = ownerValue[0]; memoValue[memo + 1] = ownerValue[1]; memoValue[memo + 2] = ownerValue[2];
      }
      const value0 = memoValue[memo], value1 = memoValue[memo + 1], value2 = memoValue[memo + 2], vertex = iy * side + ix;
      readVertex(source, ix, iy);
      // Continue the owner's tangent into a narrow interior strip. The outer
      // row has precisely its height and normal; the interior stays untouched.
      const target = value0 + value1 * (x - px) + value2 * (y - py), at = vertex * 3;
      correction[at] = (target - vertexValue[0]) * weight;
      correction[at + 1] = (value1 - vertexValue[1]) * weight;
      correction[at + 2] = (value2 - vertexValue[2]) * weight;
      joined[vertex] = 1; touched.push(vertex);
    }
    // If an owner splits, the formerly constrained neighbour can become
    // the new coarse owner. Release its old join over one morph interval
    // rather than exposing its unjoined raw edge in a single frame.
    if (old) for (const vertex of old.touched) {
      if (joined[vertex]) continue;
      const ix = vertex % side, iy = (vertex - ix) / side, x = source.x + ix * step, y = source.y + iy * step;
      if (x < bounds.x - epsilon || x > bounds.x + bounds.width + epsilon || y < bounds.y - epsilon || y > bounds.y + bounds.width + epsilon) continue;
      let kept = false;
      for (let k = 0; k < 3; k++) {
        const at = vertex * 3 + k, value = old.correction[at];
        const speed = old.releaseSpeed?.[at] || Math.abs(value) / 220;
        const next = Math.sign(value) * Math.max(0, Math.abs(value) - speed * Math.max(0, Math.min(50, elapsed)));
        if (Math.abs(next) > 1e-7) { correction[at] = next; (piece.releaseSpeed ??= new Float32Array(values))[at] = speed; piece.releasing = kept = true; }
      }
      if (kept) touched.push(vertex);
    }
    for (const vertex of touched) joined[vertex] = 0;
    done.push(piece); results.set(source, piece);
  }
  return sources.map(source => results.get(source)!);
}
