/** CPU mirror of a 2048 m draw page. Each 256 m cell owns vertex and feature slots. Index runs follow
 * the original layer, 512 m culling chunk and source-feature order, including interleaved neighbours.
 * WebGL2's fixed restart index fills spare index slots without drawing a line or a triangle. */
import { grow4, type CityGlBox4, type CityGlFillMesh, type CityGlRange } from '../../cityGlBuild';

export interface MeshCell<T> {
  part: T;
  mesh: CityGlFillMesh;
  order: readonly number[];
  key: number;
}
type Stream = 'triangles' | 'lines';
const STREAMS = ['triangles', 'lines'] as const;
const emptyBox = (): CityGlBox4 => [Infinity, Infinity, -Infinity, -Infinity];
const capacity = (n: number, unit = 1): number => (unit === 1 ? n + Math.ceil(n / 8) : n + Math.floor(n / (8 * unit)) * unit);
interface CellSlot {
  vertex: CityGlRange;
  feature: CityGlRange;
}
interface Piece {
  feature: number;
  start: number;
  count: number;
}
interface ChunkPieces {
  name: string;
  chunk: number;
  box: CityGlBox4;
  pieces: Piece[];
}
const pieceCache = new WeakMap<CityGlFillMesh, Record<Stream, ChunkPieces[]>>();
function piecesOf(mesh: CityGlFillMesh): Record<Stream, ChunkPieces[]> {
  const kept = pieceCache.get(mesh);
  if (kept) return kept;
  const result: Record<Stream, ChunkPieces[]> = { triangles: [], lines: [] };
  for (const [name, layer] of Object.entries(mesh.layers))
    for (const c of layer.chunks)
      for (const stream of STREAMS) {
        const { start, count } = c[stream];
        if (!count) continue;
        const pieces: Piece[] = [];
        for (let i = start; i < start + count;) {
          const feature = mesh.vertexFeatures[mesh[stream][i]],
            first = i++;
          while (i < start + count && mesh.vertexFeatures[mesh[stream][i]] === feature) i++;
          pieces.push({ feature, start: first, count: i - first });
        }
        result[stream].push({ name, chunk: c.key!, box: c.box, pieces });
      }
  pieceCache.set(mesh, result);
  return result;
}
interface Run {
  firstOrder: number;
  lastOrder: number;
  cell: number;
  source: number;
  count: number;
  target: number;
  capacity: number;
}
interface Group {
  name: string;
  chunk: number;
  box: CityGlBox4;
  runs: Run[];
}
function schedule<T>(cells: readonly MeshCell<T>[], stream: Stream): Group[] {
  type Ordered = Piece & { cell: number; order: number };
  const layers = new Map<string, Map<number, { box: CityGlBox4; pieces: Ordered[] }>>();
  for (const cell of cells)
    for (const c of piecesOf(cell.mesh)[stream]) {
      let chunks = layers.get(c.name);
      if (!chunks) layers.set(c.name, (chunks = new Map()));
      let group = chunks.get(c.chunk);
      if (!group) chunks.set(c.chunk, (group = { box: emptyBox(), pieces: [] }));
      grow4(group.box, c.box);
      for (const p of c.pieces) group.pieces.push({ ...p, cell: cell.key, order: cell.order[p.feature] });
    }
  const result: Group[] = [];
  for (const [name, chunks] of layers)
    for (const [chunk, { box, pieces }] of [...chunks].sort((a, b) => a[0] - b[0])) {
      const runs: Run[] = [];
      for (const p of pieces.sort((a, b) => a.order - b.order)) {
        const last = runs[runs.length - 1];
        if (last && last.cell === p.cell && last.source + last.count === p.start) {
          last.count += p.count;
          last.lastOrder = p.order;
        } else runs.push({ firstOrder: p.order, lastOrder: p.order, cell: p.cell, source: p.start, count: p.count, target: 0, capacity: 0 });
      }
      result.push({ name, chunk, box, runs });
    }
  return result;
}

export type MeshUpload = (stream: 'positions' | 'vertexFeatures' | Stream, offset: number, data: Float32Array | Uint32Array) => void;
interface IndexMove {
  from?: number;
  start: number;
  count: number;
}
export type MeshReindex = (stream: Stream, indices: Uint32Array, moves: IndexMove[]) => void;
export class CellPageMesh<T> {
  readonly slots = new Map<number, CellSlot>();
  readonly mesh: CityGlFillMesh;
  private groups: Record<Stream, Group[]>;
  cells: ReadonlyMap<number, MeshCell<T>>;
  box: CityGlBox4 = emptyBox();
  constructor(cells: readonly MeshCell<T>[]) {
    let vertices = 0,
      features = 0;
    for (const c of cells) {
      const v = capacity(c.mesh.vertexFeatures.length),
        f = capacity(c.mesh.featureCount);
      this.slots.set(c.key, { vertex: { start: vertices, count: v }, feature: { start: features, count: f } });
      vertices += v;
      features += f;
    }
    this.cells = new Map(cells.map(c => [c.key, c]));
    this.groups = { triangles: schedule(cells, 'triangles'), lines: schedule(cells, 'lines') };
    const indices = (stream: Stream) => {
      let size = 0;
      for (const g of this.groups[stream])
        for (const r of g.runs) {
          r.target = size;
          r.capacity = capacity(r.count, stream === 'lines' ? 2 : 3);
          size += r.capacity;
        }
      return new Uint32Array(size).fill(0xffffffff);
    };
    this.mesh = { origin: cells[0].mesh.origin, positions: new Float32Array(2 * vertices), vertexFeatures: new Uint32Array(vertices), triangles: indices('triangles'), lines: indices('lines'), layers: {}, featureCount: features };
    for (const c of cells) this.writeVertices(c);
    for (const s of STREAMS) for (const g of this.groups[s]) for (const r of g.runs) this.writeIndices(s, r, this.cells.get(r.cell)!);
    this.bounds();
  }
  private writeVertices(cell: MeshCell<T>, upload?: MeshUpload) {
    const slot = this.slots.get(cell.key)!,
      v = slot.vertex.start,
      mesh = cell.mesh;
    const positions = this.mesh.positions,
      features = this.mesh.vertexFeatures;
    // A stable-topology edit typically changes a handful of coordinates. Send one contiguous span
    // per attribute in this cell even if its other buildings keep exactly the same values.
    let first = mesh.positions.length,
      end = 0;
    for (let i = 0; i < mesh.positions.length; i++)
      if (mesh.positions[i] !== positions[v * 2 + i]) {
        first = Math.min(first, i);
        end = i + 1;
      }
    if (first < end) {
      const span = mesh.positions.subarray(first, end);
      positions.set(span, v * 2 + first);
      upload?.('positions', (v * 2 + first) * 4, span);
    }
    first = mesh.vertexFeatures.length;
    end = 0;
    for (let i = 0; i < mesh.vertexFeatures.length; i++) {
      const value = slot.feature.start + mesh.vertexFeatures[i];
      if (value !== features[v + i]) {
        features[v + i] = value;
        first = Math.min(first, i);
        end = i + 1;
      }
    }
    if (first < end) upload?.('vertexFeatures', (v + first) * 4, features.subarray(v + first, v + end));
  }
  private writeIndices(s: Stream, r: Run, c: MeshCell<T>, upload?: MeshUpload, previous = 0) {
    const dst = this.mesh[s],
      src = c.mesh[s],
      base = this.slots.get(c.key)!.vertex.start;
    let first = Infinity,
      end = 0;
    for (let j = 0; j < Math.max(r.count, previous); j++) {
      const value = j < r.count ? src[r.source + j] + base : 0xffffffff;
      if (dst[r.target + j] !== value) {
        dst[r.target + j] = value;
        first = Math.min(first, j);
        end = j + 1;
      }
    }
    if (end > first) upload?.(s, (r.target + first) * 4, dst.subarray(r.target + first, r.target + end));
  }
  /** In the common case the source ordinals still fall in the same painter runs. Only inspect the new
   * cell's features, even when several neighbours interleave in the same 512 m culling chunk. */
  private localSchedule(s: Stream, cells: Map<number, MeshCell<T>>, dirty: Set<number>): Group[] | undefined {
    const sources = new Map<number, Map<string, { chunk: ChunkPieces; at: number }>>();
    for (const key of dirty) {
      const cell = cells.get(key);
      if (cell) sources.set(key, new Map(piecesOf(cell.mesh)[s].map(chunk => [chunk.name + '/' + chunk.chunk, { chunk, at: 0 }])));
    }
    const result: Group[] = [];
    for (const g of this.groups[s]) {
      if (!g.runs.some(r => dirty.has(r.cell))) {
        result.push(g);
        continue;
      }
      const runs: Run[] = [],
        box = emptyBox();
      for (const r of g.runs) {
        const cell = cells.get(r.cell),
          id = g.name + '/' + g.chunk;
        if (!dirty.has(r.cell)) {
          runs.push(r);
          const bounds = cell?.mesh.layers[g.name]?.chunks.find(c => c.key === g.chunk);
          if (bounds) grow4(box, bounds.box);
          continue;
        }
        const source = sources.get(r.cell)?.get(id);
        let count = 0,
          start = 0;
        if (source && cell) {
          const pieces = source.chunk.pieces;
          while (source.at < pieces.length) {
            const p = pieces[source.at],
              order = cell.order[p.feature];
            if (order > r.lastOrder) break;
            if (order < r.firstOrder) return;
            if (!count) start = p.start;
            count += p.count;
            source.at++;
          }
          if (count) grow4(box, source.chunk.box);
        }
        if (count > r.capacity) return;
        runs.push({ ...r, source: start, count });
      }
      if (!runs.some(r => r.count)) return;
      result.push({ ...g, box, runs });
    }
    for (const columns of sources.values()) for (const p of columns.values()) if (p.at !== p.chunk.pieces.length) return;
    return result;
  }
  readonly counts = { vertices: 0, triangles: 0, edges: 0, features: 0 };
  private bounds() {
    const counts = this.counts;
    counts.vertices = counts.triangles = counts.edges = counts.features = 0;
    for (const { mesh } of this.cells.values()) {
      counts.vertices += mesh.positions.length / 2;
      counts.edges += mesh.lines.length / 2;
      counts.triangles += mesh.triangles.length / 3;
      counts.features += mesh.featureCount;
    }
    // Only one chunk per original 512 m culling cell, regardless of the number of update slots.
    this.mesh.layers = {};
    this.box = emptyBox();
    for (const s of STREAMS)
      for (const g of this.groups[s]) {
        if (!g.runs.some(r => r.count)) continue;
        const layer = (this.mesh.layers[g.name] ??= { features: [0, 0], polygons: [0, 0], triangles: { start: 0, count: 0 }, lines: { start: 0, count: 0 }, chunks: [] });
        let chunk = layer.chunks.find(c => c.key === g.chunk);
        if (!chunk) {
          chunk = { key: g.chunk, box: emptyBox(), triangles: { start: 0, count: 0 }, lines: { start: 0, count: 0 } };
          layer.chunks.push(chunk);
        }
        grow4(chunk.box, g.box);
        grow4(this.box, g.box);
        const first = g.runs[0],
          last = g.runs[g.runs.length - 1];
        chunk[s] = { start: first.target, count: last.target + last.capacity - first.target };
        if (!layer[s].count) layer[s].start = first.target;
        layer[s].count += chunk[s].count;
      }
    for (const l of Object.values(this.mesh.layers)) l.chunks.sort((a, b) => a.key! - b.key!);
  }
  /** Reorder indices if insertion/deletion changes the interleaving. Copy clean runs between GPU buffers.
   * Vertex and feature slots (and all palette textures) stay in place. */
  private reindex(s: Stream, groups: Group[], dirty: Set<number>, move: MeshReindex) {
    const size = groups.reduce((n, g) => n + g.runs.reduce((m, r) => m + r.count, 0), 0);
    const old = this.mesh[s],
      next = new Uint32Array(Math.max(size, old.length)),
      moves: IndexMove[] = [];
    const byCell = new Map<number, Run[]>();
    for (const group of this.groups[s])
      for (const run of group.runs) {
        let runs = byCell.get(run.cell);
        if (!runs) byCell.set(run.cell, (runs = []));
        if (run.count) runs.push(run);
      }
    for (const runs of byCell.values()) runs.sort((a, b) => a.source - b.source);
    let at = 0;
    const append = (start: number, count: number, from?: number) => {
      const last = moves[moves.length - 1];
      if (last && last.start + last.count === start && (from === undefined ? last.from === undefined : last.from !== undefined && last.from + last.count === from)) last.count += count;
      else moves.push({ start, count, from });
    };
    for (const group of groups)
      for (const r of group.runs) {
        r.target = at;
        r.capacity = r.count;
        at += r.count;
        if (dirty.has(r.cell)) {
          const base = this.slots.get(r.cell)!.vertex.start,
            src = this.cells.get(r.cell)!.mesh[s];
          for (let j = 0; j < r.count; j++) next[r.target + j] = src[r.source + j] + base;
          append(r.target, r.count);
        } else {
          const runs = byCell.get(r.cell)!;
          let lo = 0,
            hi = runs.length;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1,
              p = runs[mid];
            if (p.source + p.count <= r.source) lo = mid + 1;
            else hi = mid;
          }
          for (let i = lo; i < runs.length && runs[i].source < r.source + r.count; i++) {
            const p = runs[i],
              start = Math.max(p.source, r.source),
              end = Math.min(p.source + p.count, r.source + r.count);
            if (end <= start) continue;
            const from = p.target + start - p.source,
              to = r.target + start - r.source;
            next.set(old.subarray(from, from + end - start), to);
            append(to, end - start, from);
          }
        }
      }
    this.mesh[s] = next;
    move(s, next, moves);
  }
  /** Validate vertex/feature capacities before publishing any writes. */
  patch(cells: readonly MeshCell<T>[], upload: MeshUpload, move?: MeshReindex): boolean {
    const dirty = new Set<number>();
    for (const c of cells) {
      const old = this.cells.get(c.key),
        s = this.slots.get(c.key);
      if (!s || s.vertex.count < c.mesh.vertexFeatures.length || s.feature.count < c.mesh.featureCount) return false;
      if (c.mesh !== old?.mesh) dirty.add(c.key);
    }
    const current = new Map(cells.map(c => [c.key, c]));
    for (const key of this.cells.keys()) if (!current.has(key)) dirty.add(key);
    let next: Record<Stream, Group[]>;
    const stableOrder = cells.every(c => this.cells.get(c.key)?.order === c.order);
    const triangles = stableOrder ? this.localSchedule('triangles', current, dirty) : undefined,
      lines = triangles ? this.localSchedule('lines', current, dirty) : undefined;
    const reorder = new Set<Stream>();
    if (triangles && lines) next = { triangles, lines };
    else {
      next = { triangles: schedule(cells, 'triangles'), lines: schedule(cells, 'lines') };
      for (const s of STREAMS) {
        const old = new Map(this.groups[s].map(g => [g.name + '/' + g.chunk, g]));
        if (old.size !== next[s].length) reorder.add(s);
        for (const g of next[s]) {
          const previous = old.get(g.name + '/' + g.chunk);
          if (!previous || previous.runs.length !== g.runs.length) {
            reorder.add(s);
            break;
          }
          for (const [i, r] of g.runs.entries()) {
            const p = previous.runs[i];
            if (p.cell !== r.cell || r.count > p.capacity) {
              reorder.add(s);
              break;
            }
            r.target = p.target;
            r.capacity = p.capacity;
          }
        }
        if (!reorder.has(s)) next[s].sort((a, b) => a.runs[0].target - b.runs[0].target);
      }
    }
    if (reorder.size && !move) return false;
    this.cells = current;
    for (const c of cells) if (dirty.has(c.key)) this.writeVertices(c, upload);
    for (const s of STREAMS) {
      if (reorder.has(s)) {
        this.reindex(s, next[s], dirty, move!);
        continue;
      }
      for (const [i, g] of next[s].entries())
        for (const [j, r] of g.runs.entries()) {
          const old = this.groups[s][i].runs[j];
          if (r.count === 0 && old.count) {
            const dst = this.mesh[s];
            dst.fill(0xffffffff, r.target, r.target + old.count);
            upload(s, r.target * 4, dst.subarray(r.target, r.target + old.count));
          } else if (r.count && (dirty.has(r.cell) || r.source !== old.source || r.count !== old.count)) this.writeIndices(s, r, this.cells.get(r.cell)!, upload, old.count);
        }
    }
    this.groups = next;
    this.bounds();
    return true;
  }
}
