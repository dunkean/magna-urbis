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
  /** Upstream area of each cell in m², itself included. */
  accumulation: Float32Array;
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
class Heap {
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

export function computeHydrology(height: Float32Array, n: number, width: number): SimpleHydrology {
  const started = performance.now();
  const total = n * n, cell = width / n;
  const filled = new Float32Array(height);
  const receiver = new Int32Array(total).fill(-1);
  const order = new Int32Array(total);
  const done = new Uint8Array(total);
  const sea = new Uint8Array(total);

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
  const heap = new Heap(total);
  for (let c = 0; c < total; c++) {
    const x = c % n, y = (c - x) / n;
    if (sea[c] || x === 0 || y === 0 || x === n - 1 || y === n - 1) { heap.push(c, height[c]); done[c] = 1; }
  }
  // Cells discovered at or below the current level go through a FIFO "pit"
  // queue, so flats and basins drain by breadth-first fronts from the spill.
  const pit = new Int32Array(total);
  let pitHead = 0, pitTail = 0, popped = 0;
  while (pitHead < pitTail || heap.length) {
    const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
    order[popped++] = c;
    const x = c % n, y = (c - x) / n;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const nb = yy * n + xx;
      if (done[nb]) continue;
      done[nb] = 1;
      receiver[nb] = c;
      if (height[nb] <= filled[c]) { filled[nb] = filled[c]; pit[pitTail++] = nb; }
      else heap.push(nb, height[nb]);
    }
    if (pitHead === pitTail) { pitHead = 0; pitTail = 0; }
  }

  // Follow slopes where the filled surface descends: steepest D8 descent.
  // Receivers stay strictly lower or flood parents, so `order` remains topological.
  for (let c = 0; c < total; c++) {
    if (receiver[c] < 0 || sea[c]) continue;
    const x = c % n, y = (c - x) / n;
    let best = -1, slope = 0;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const nb = yy * n + xx;
      const s = (filled[c] - filled[nb]) / (DX[k] && DY[k] ? Math.SQRT2 : 1);
      if (s > slope) { slope = s; best = nb; }
    }
    if (best >= 0) receiver[c] = best;
  }

  const cellArea = cell * cell;
  const accumulation = new Float32Array(total);
  for (let c = 0; c < total; c++) if (!sea[c]) accumulation[c] = cellArea;
  for (let k = total - 1; k >= 0; k--) {
    const c = order[k], r = receiver[c];
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
  return { n, width, cellArea, height, filled, receiver, accumulation, basin, sea, outlets, ms: performance.now() - started };
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
