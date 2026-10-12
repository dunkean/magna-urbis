/**
 * Minimal hydrology for the neural bench: the terrain is taken as is.
 *
 * Priority-flood (Barnes 2014) from the sea and the map edges fills every
 * basin to its spill level. Cells with a downhill neighbour drain by steepest
 * descent (D8); cells of filled basins and flats drain along the flood front
 * towards their spill point. No breaching, carving, smoothing or erosion.
 */
export interface SimpleHydrology {
  n: number; width: number; cellArea: number;
  /** Signed heights used for the computation (metres). */
  height: Float32Array;
  /** Water surface after filling (metres). */
  filled: Float32Array;
  /** Downstream cell, or -1 for outlets (sea, map edge). */
  receiver: Int32Array;
  /** Upstream area of each cell in m², itself included (weighted by runoff when given). */
  accumulation: Float32Array;
  /** Cells in flood order: every receiver comes before its donors. */
  order: Int32Array;
  /** Outlet index of each cell. */
  basin: Int32Array;
  sea: Uint8Array;
  /** Outlets draining at least one land cell. */
  outlets: number;
  ms: number;
}

export interface WaterSettings {
  /** Upstream area that starts a river, km². */
  riverArea: number;
  /** Minimum filled depth of a lake cell, metres. */
  lakeDepth: number;
  /** Minimum lake surface, hectares. */
  lakeArea: number;
}

export interface WaterBodies {
  lake: Uint8Array;
  lakes: number;
  lakeAreaKm2: number;
  riverCells: number;
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

/** Binary min-heap of cells keyed by height, ties in insertion order. */
export class Heap {
  private cells: Int32Array;
  private keys: Float64Array;
  private order: Float64Array;
  private size = 0;
  private count = 0;
  constructor(capacity: number) {
    this.cells = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
    this.order = new Float64Array(capacity);
  }
  get length(): number { return this.size; }
  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.order[a] < this.order[b]);
  }
  private swap(a: number, b: number): void {
    const c = this.cells[a]; this.cells[a] = this.cells[b]; this.cells[b] = c;
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
    const o = this.order[a]; this.order[a] = this.order[b]; this.order[b] = o;
  }
  push(cell: number, key: number): void {
    let i = this.size++;
    this.cells[i] = cell; this.keys[i] = key; this.order[i] = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop(): number {
    const top = this.cells[0];
    this.size--;
    if (this.size > 0) {
      this.swap(0, this.size);
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

/** Mean-pools a square grid by an integer factor. */
export function downsample(height: Float32Array, n: number, factor: number): Float32Array {
  if (factor === 1) return height;
  const m = Math.floor(n / factor), out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    let sum = 0;
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += height[(y * factor + dy) * n + x * factor + dx];
    out[y * m + x] = sum / (factor * factor);
  }
  return out;
}

export interface HydrologyOptions {
  /** Runoff weight of each cell (1: the reference runoff); areas are weighted by it. */
  weight?: Float32Array;
  /** Extra outlets: cells that absorb all the water reaching them (closed lakes). */
  outlet?: Uint8Array;
  /** Water lost by each cell before it passes on, m² of reference runoff (lake evaporation at its exit). */
  loss?: Float32Array;
}

/**
 * Min-heap of the flood: one Float64 priority per cell, the float32 height's
 * sortable bits times 2²¹ plus the insertion count, so ties pop in insertion
 * order exactly as `Heap` does, with a single comparison. Up to 2²¹ pushes.
 */
class FloodHeap {
  private cells: Int32Array; private keys: Float64Array;
  private size = 0; private count = 0;
  private f32 = new Float32Array(1); private u32 = new Uint32Array(this.f32.buffer);
  constructor(capacity: number) { this.cells = new Int32Array(capacity); this.keys = new Float64Array(capacity); }
  get length(): number { return this.size; }
  push(cell: number, height: number): void {
    this.f32[0] = height === 0 ? 0 : height;
    const u = this.u32[0], sortable = u & 0x80000000 ? ~u >>> 0 : (u | 0x80000000) >>> 0;
    const key = sortable * 2097152 + this.count++;
    const cells = this.cells, keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      cells[i] = cells[parent]; keys[i] = keys[parent]; i = parent;
    }
    cells[i] = cell; keys[i] = key;
  }
  pop(): number {
    const cells = this.cells, keys = this.keys, top = cells[0], size = --this.size;
    if (size > 0) {
      const cell = cells[size], key = keys[size];
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= size) break;
        if (m + 1 < size && keys[m + 1] < keys[m]) m++;
        if (keys[m] >= key) break;
        cells[i] = cells[m]; keys[i] = keys[m]; i = m;
      }
      cells[i] = cell; keys[i] = key;
    }
    return top;
  }
}

/** Generic heap for grids above 2²¹ cells (same pop order). */
const floodHeap = (total: number): { length: number; push(cell: number, key: number): void; pop(): number } => total <= 2097152 ? new FloodHeap(total) : new Heap(total);

/** A compiled flood (the Rust `flood_hydrology` in WASM), bit-identical to the TypeScript one below. */
export interface FloodKernel {
  (height: Float32Array, n: number, cellArea: number, weight: Float32Array, outlet: Uint8Array, loss: Float32Array): {
    take_filled(): Float32Array; take_receiver(): Int32Array; take_order(): Int32Array; take_accumulation(): Float32Array;
    take_basin(): Int32Array; take_sea(): Uint8Array; readonly outlets: number; free(): void;
  };
}
let kernel: FloodKernel | undefined;
/** Installs (or removes) the compiled flood; workers install it once their WASM is ready. */
export function setFloodKernel(next: FloodKernel | undefined): void { kernel = next; }

export function computeHydrology(height: Float32Array, n: number, width: number, options: HydrologyOptions = {}): SimpleHydrology {
  const started = performance.now();
  const total = n * n, cell = width / n;
  if (kernel) {
    const none = new Float32Array(0);
    const flood = kernel(height, n, cell * cell, options.weight ?? none, options.outlet ?? new Uint8Array(0), options.loss ?? none);
    try {
      return { n, width, cellArea: cell * cell, height, filled: flood.take_filled(), receiver: flood.take_receiver(), accumulation: flood.take_accumulation(),
        order: flood.take_order(), basin: flood.take_basin(), sea: flood.take_sea(), outlets: flood.outlets, ms: performance.now() - started };
    } finally { flood.free(); }
  }
  const filled = new Float32Array(height);
  const receiver = new Int32Array(total).fill(-1);
  const order = new Int32Array(total);
  const done = new Uint8Array(total);
  const sea = new Uint8Array(total);
  // Neighbour offsets in DX/DY order, for cells away from the map edge.
  const offsets = DX.map((dx, k) => DY[k] * n + dx);
  const interior = (x: number, y: number): boolean => x > 0 && y > 0 && x < n - 1 && y < n - 1;

  // Sea: cells at or below zero connected to the map edge.
  const stack: number[] = [];
  for (let i = 0; i < n; i++) for (const c of [i, (n - 1) * n + i, i * n, i * n + n - 1]) {
    if (height[c] <= 0 && !sea[c]) { sea[c] = 1; stack.push(c); }
  }
  while (stack.length) {
    const c = stack.pop()!, x = c % n, y = (c - x) / n;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const nb = yy * n + xx;
      if (!sea[nb] && height[nb] <= 0) { sea[nb] = 1; stack.push(nb); }
    }
  }

  // Outlets: the sea and the map edge.
  const heap = floodHeap(total), outlet = options.outlet;
  for (let y = 0, c = 0; y < n; y++) for (let x = 0; x < n; x++, c++) {
    if (sea[c] || outlet?.[c] || x === 0 || y === 0 || x === n - 1 || y === n - 1) { heap.push(c, height[c]); done[c] = 1; }
  }
  // Cells discovered at or below the current level go through a FIFO "pit"
  // queue, so flats and basins drain by breadth-first fronts from the spill.
  const pit = new Int32Array(total);
  let pitHead = 0, pitTail = 0, popped = 0;
  const o0 = offsets[0], o1 = offsets[1], o2 = offsets[2], o3 = offsets[3], o4 = offsets[4], o5 = offsets[5], o6 = offsets[6], o7 = offsets[7];
  const last = n - 1;
  while (pitHead < pitTail || heap.length) {
    const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
    order[popped++] = c;
    const x = c % n, y = (c - x) / n, level = filled[c];
    for (let k = 0; k < 8; k++) {
      let nb: number;
      if (x > 0 && y > 0 && x < last && y < last) nb = c + (k === 0 ? o0 : k === 1 ? o1 : k === 2 ? o2 : k === 3 ? o3 : k === 4 ? o4 : k === 5 ? o5 : k === 6 ? o6 : o7);
      else {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        nb = yy * n + xx;
      }
      if (done[nb]) continue;
      done[nb] = 1;
      receiver[nb] = c;
      const z = height[nb];
      if (z <= level) { filled[nb] = level; pit[pitTail++] = nb; }
      else heap.push(nb, z);
    }
    if (pitHead === pitTail) { pitHead = 0; pitTail = 0; }
  }

  // Follow slopes where the filled surface descends: steepest D8 descent.
  // Receivers stay strictly lower or flood parents, so `order` remains topological.
  const distance = DX.map((dx, k) => dx && DY[k] ? Math.SQRT2 : 1);
  for (let y = 0, c = 0; y < n; y++) for (let x = 0; x < n; x++, c++) {
    if (receiver[c] < 0 || sea[c] || outlet?.[c]) continue;
    let best = -1, slope = 0;
    const z = filled[c];
    if (interior(x, y)) {
      for (let k = 0; k < 8; k++) {
        const nb = c + offsets[k], s = (z - filled[nb]) / distance[k];
        if (s > slope) { slope = s; best = nb; }
      }
    } else for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const nb = yy * n + xx;
      const s = (z - filled[nb]) / distance[k];
      if (s > slope) { slope = s; best = nb; }
    }
    if (best >= 0) receiver[c] = best;
  }

  const cellArea = cell * cell;
  const accumulation = new Float32Array(total);
  const { weight, loss } = options;
  for (let c = 0; c < total; c++) if (!sea[c]) accumulation[c] = cellArea * (weight ? weight[c] : 1);
  for (let k = total - 1; k >= 0; k--) {
    const c = order[k], r = receiver[c];
    if (loss && loss[c]) accumulation[c] = Math.max(0, accumulation[c] - loss[c]);
    if (r >= 0) accumulation[r] += accumulation[c];
  }
  const basin = new Int32Array(total);
  let ids = 0;
  for (let k = 0; k < total; k++) {
    const c = order[k], r = receiver[c];
    basin[c] = r < 0 ? ids++ : basin[r];
  }
  // Outlets that actually drain land.
  const drains = new Uint8Array(ids);
  let outlets = 0;
  for (let c = 0; c < total; c++) if (!sea[c] && !drains[basin[c]]) { drains[basin[c]] = 1; outlets++; }
  return { n, width, cellArea, height, filled, receiver, accumulation, order, basin, sea, outlets, ms: performance.now() - started };
}

/** Lakes are filled basins deep and large enough; rivers start above an upstream area. */
export function waterBodies(h: SimpleHydrology, settings: WaterSettings): WaterBodies {
  const { n, filled, height, sea } = h, total = n * n;
  const deep = new Uint8Array(total);
  for (let c = 0; c < total; c++) deep[c] = !sea[c] && filled[c] > 0 && filled[c] - height[c] >= settings.lakeDepth ? 1 : 0;
  // Each connected filled area at one level is one lake.
  const lake = new Uint8Array(total), seen = new Uint8Array(total);
  const minCells = settings.lakeArea * 1e4 / h.cellArea;
  let lakes = 0, lakeCells = 0;
  const component: number[] = [];
  for (let s = 0; s < total; s++) {
    if (!deep[s] || seen[s]) continue;
    component.length = 0; component.push(s); seen[s] = 1;
    for (let i = 0; i < component.length; i++) {
      const c = component[i], x = c % n, y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (deep[nb] && !seen[nb] && filled[nb] === filled[c]) { seen[nb] = 1; component.push(nb); }
      }
    }
    if (component.length < minCells) continue;
    lakes++; lakeCells += component.length;
    for (const c of component) lake[c] = 1;
  }
  const threshold = settings.riverArea * 1e6;
  let riverCells = 0;
  for (let c = 0; c < total; c++) if (!sea[c] && !lake[c] && h.accumulation[c] >= threshold) riverCells++;
  return { lake, lakes, lakeAreaKm2: lakeCells * h.cellArea / 1e6, riverCells };
}
