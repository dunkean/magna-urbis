/**
 * Pre-hydrology relief conditioning: makes a heightfield drain before rivers
 * are extracted from it, instead of correcting the rivers afterwards.
 *
 * Generated reliefs (neural ones especially) hold depressions no river could
 * have left: filling them turns them into flat "lakes" that steepest descent
 * crosses in straight lines over drowned hills. Two physical corrections:
 * - fluvial erosion: a few implicit stream-power steps (Braun & Willett 2013,
 *   m = 0.5, n = 1) without uplift. Water routed through each depression cuts
 *   its spill sill in proportion to √A; depressions receive sediment. Valleys
 *   deepen where large flows run and hillslopes stay as they are;
 * - sill breaching (Lindsay 2016, hybrid breaching–filling): every drowned
 *   local minimum, lowest first, has its outlet route lowered by at most
 *   `maxDepth` metres over at most `maxLength` metres, to lower ground beyond
 *   its spill or to a channel already cut; what stays below the lowered spill
 *   is a real depression, left to the lakes or to filling. Under the water the
 *   route follows the drowned valley floor (least cost, Lindsay & Dhun 2015)
 *   and the channel is cut along its smoothed axis with sloping banks, so no
 *   straight ray or D8 staircase is engraved for the rivers to follow.
 * Erosion runs on at most 512² (its height change is interpolated); breaching
 * runs on the full hydrology grid, whose own small pits it opens. With both,
 * the coarse erosion only incises: sediment raised on a coarse lake bed comes
 * back under the fine relief as a plateau of 1–2 m pits and flats, so it
 * settles on the full grid instead, in what the breaches leave flooded. The
 * bench applies the height change to the displayed terrain at every zoom.
 */
import { computeHydrology, downsample, type SimpleHydrology } from './simpleHydrology';
import { upsampleDelta } from '../../../rust/bridge/terrainAdjust';

export type ConditioningMode = 'none' | 'erosion' | 'breach' | 'both';

export interface ConditioningSettings {
  mode: ConditioningMode;
  /** Erosion duration, 0–3 (number of implicit steps / 12). */
  strength: number;
  /** Deepest spill cut of a breach, metres. */
  maxDepth: number;
  /** Longest breach channel, metres. */
  maxLength: number;
}

export interface ConditioningResult {
  height: Float32Array;
  /** Conditioned minus original height, metres. */
  delta: Float32Array;
  /** Depressions deeper than 1 m and the water they hold (m³), before and after. */
  before: { depressions: number; volume: number };
  after: { depressions: number; volume: number };
  breaches: number;
  steps: number;
  ms: number;
  /** Drainage of the conditioned height, reused by the water chain. */
  hydrology: SimpleHydrology;
}

export const DEFAULT_CONDITIONING: ConditioningSettings = { mode: 'none', strength: 2, maxDepth: 30, maxLength: 3000 };

function depressions(height: Float32Array, n: number, width: number, h = computeHydrology(height, n, width)): { depressions: number; volume: number; hydrology: SimpleHydrology } {
  const seen = new Uint8Array(n * n);
  let count = 0, volume = 0;
  const stack: number[] = [];
  for (let s = 0; s < n * n; s++) {
    const depth = h.filled[s] - height[s];
    volume += Math.max(0, depth) * h.cellArea;
    if (depth <= 0.01 || seen[s]) continue;
    let deepest = 0;
    stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!, x = c % n, y = (c - x) / n;
      deepest = Math.max(deepest, h.filled[c] - height[c]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (!seen[nb] && h.filled[nb] - height[nb] > 0.01 && h.filled[nb] === h.filled[c]) { seen[nb] = 1; stack.push(nb); }
      }
    }
    if (deepest > 1) count++;
  }
  return { depressions: count, volume, hydrology: h };
}

/** Implicit stream-power incision without uplift; depressions rise `deposit` of their depth per step. */
function erode(height: Float32Array, n: number, width: number, steps: number, deposit: number): void {
  for (let step = 0; step < steps; step++) {
    const { order, receiver, accumulation, filled, sea } = computeHydrology(height, n, width);
    for (let k = 0; k < order.length; k++) {
      const c = order[k], r = receiver[c];
      if (r < 0 || sea[c]) continue;
      const depth = filled[c] - height[c];
      // Sediment settles in depressions: they rise a share of their depth.
      if (depth > 0.01) { height[c] += deposit * depth; continue; }
      // Receivers are 8-neighbours: diagonal ones are n ± 1 cells away.
      const offset = r - c, diagonal = offset === n + 1 || offset === n - 1 || offset === -n - 1 || offset === 1 - n;
      // F = K Δt √A / Δx per cell step: hillslopes barely move, channels cut.
      const f = 0.03 * Math.sqrt(accumulation[c] / 1e6) / (diagonal ? Math.SQRT2 : 1);
      // Base level: the receiver's water surface. A stream entering a depression
      // stops cutting at the water it enters, not at the depression's floor.
      const base = Math.max(height[r], filled[r]);
      if (height[c] > base) height[c] = (height[c] + f * base) / (1 + f);
    }
  }
}

/** Lowers the flood path of every drowned pit through its spill; returns the number of breaches. */
function breach(height: Float32Array, n: number, width: number, maxDepth: number, maxLength: number): number {
  const cell = width / n, total = n * n;
  const { filled, receiver } = computeHydrology(height, n, width);
  const below = (c: number, z: number, among?: Uint8Array): boolean => {
    const x = c % n, y = (c - x) / n;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const nb = yy * n + xx;
      if (height[nb] < z && (!among || among[nb])) return true;
    }
    return false;
  };
  // Every drowned local minimum, lowest first: a lake's sub-basins open in the
  // same pass as its bottom, into the channels already cut, instead of turning
  // into new pits once the lake drains.
  const pits: number[] = [];
  for (let c = 0; c < total; c++) if (filled[c] - height[c] > 0.05 && !below(c, height[c])) pits.push(c);
  pits.sort((a, b) => height[a] - height[b]);
  const next = drownedRoutes(height, filled, receiver, n);
  const drained = new Uint8Array(total), chain: number[] = [], levels: number[] = [];
  let breaches = 0;
  for (const bottom of pits) {
    if (drained[bottom] || below(bottom, height[bottom], drained)) continue;
    const spill = filled[bottom];
    // The lowest cut level whose channel stays within the length budget.
    const lowest = Math.max(height[bottom], spill - maxDepth), stepZ = Math.max(0.5, (spill - lowest) / 8);
    for (let level = lowest; level < spill - 0.05; level += stepZ) {
      chain.length = 0; levels.length = 0;
      chain.push(bottom); levels.push(level);
      let z = level, ok = true, cut = 0;
      for (let c = next[bottom], previous = bottom; c >= 0; previous = c, c = next[c]) {
        // Lower ground beyond the spill, or a channel already cut: complete.
        if (height[c] < z && (drained[c] || filled[c] < spill)) break;
        z -= 0.001 * (c % n !== previous % n && Math.floor(c / n) !== Math.floor(previous / n) ? Math.SQRT2 : 1) * cell;
        chain.push(c); levels.push(z);
        if (height[c] > z && ++cut * cell > maxLength) { ok = false; break; }
      }
      if (!ok) continue;
      if (cut) { carve(height, n, cell, chain, levels, drained); breaches++; }
      if (level === height[bottom]) drained[bottom] = 1;
      break;
    }
  }
  return breaches;
}

/** Cost of a drowned route's step besides its height above the lake floor, metres. */
const ROUTE_LENGTH_COST = 0.5;

/**
 * Next cell of every cell towards its outlet: the drainage's receiver, except
 * across a filled depression. There the flood's receivers are breadth-first
 * parents from the spill, Chebyshev geodesics: straight rays and right-angle
 * zigzags over whatever lies under the water. Each depression (cells drowned
 * at one level) instead drains along the least-cost route to its spill, in
 * octile distance weighted by the height above its floor, so a breach follows
 * the drowned valley bottom.
 */
function drownedRoutes(height: Float32Array, filled: Float32Array, receiver: Int32Array, n: number): Int32Array {
  const total = n * n, next = new Int32Array(receiver);
  const label = new Int32Array(total).fill(-1), floor: number[] = [], stack: number[] = [];
  for (let s = 0; s < total; s++) {
    if (label[s] >= 0 || filled[s] <= height[s]) continue;
    const id = floor.length;
    let low = height[s];
    label[s] = id; stack.push(s);
    while (stack.length) {
      const c = stack.pop()!, x = c % n, y = (c - x) / n;
      low = Math.min(low, height[c]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (label[nb] < 0 && filled[nb] === filled[c] && filled[nb] > height[nb]) { label[nb] = id; stack.push(nb); }
      }
    }
    floor.push(low);
  }
  // Multi-source Dijkstra from the cells whose receiver leaves their depression.
  const cost = new Float64Array(total).fill(Infinity), heap = new CellHeap();
  for (let c = 0; c < total; c++) {
    if (label[c] >= 0 && (receiver[c] < 0 || label[receiver[c]] !== label[c])) { cost[c] = 0; heap.push(c, 0); }
  }
  while (heap.length) {
    const g = heap.topKey, c = heap.pop();
    if (g > cost[c]) continue;
    const x = c % n, y = (c - x) / n, id = label[c];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const nb = yy * n + xx;
      if (label[nb] !== id) continue;
      const step = (dx && dy ? Math.SQRT2 : 1) * (ROUTE_LENGTH_COST + height[nb] - floor[id]);
      if (g + step < cost[nb]) { cost[nb] = g + step; next[nb] = c; heap.push(nb, g + step); }
    }
  }
  return next;
}

/** Binary min-heap of cells on growable arrays; the caller skips stale entries. */
class CellHeap {
  private cells: number[] = []; private keys: number[] = [];
  get length(): number { return this.cells.length; }
  get topKey(): number { return this.keys[0]; }
  push(cell: number, key: number): void {
    const cells = this.cells, keys = this.keys;
    let i = cells.length;
    cells.push(cell); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      cells[i] = cells[p]; keys[i] = keys[p]; i = p;
    }
    cells[i] = cell; keys[i] = key;
  }
  pop(): number {
    const cells = this.cells, keys = this.keys, top = cells[0], cell = cells.pop()!, key = keys.pop()!, size = cells.length;
    if (size) {
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

/** Half-width of a breach channel's bed, in cells: over √2/2 every cell its axis crosses is cut, so the bed stays connected. */
const BED_HALF_WIDTH = 0.75;
/** Breach channel banks: half-width in cells, and slope. */
const BANK_HALF_WIDTH = 1.6, BANK_SLOPE = 0.3;
/** Smoothing of a breach channel's axis: half-window in cells of the chain. */
const AXIS_SMOOTHING = 3;

/**
 * Cuts a breach channel down to `levels` along `chain` (cells, from the pit).
 * The axis is the chain smoothed over a few cells, the bed every cell within
 * `BED_HALF_WIDTH` of it and the banks rise from it at `BANK_SLOPE`: no D8
 * staircase for the rivers to follow. Bed cells are marked `drained`.
 */
function carve(height: Float32Array, n: number, cell: number, chain: number[], levels: number[], drained: Uint8Array): void {
  const m = chain.length, xs = new Float64Array(m), ys = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    // Window shrinking towards the ends, which stay in place.
    const w = Math.min(AXIS_SMOOTHING, k, m - 1 - k);
    let sx = 0, sy = 0;
    for (let j = k - w; j <= k + w; j++) { sx += chain[j] % n; sy += Math.floor(chain[j] / n); }
    xs[k] = sx / (2 * w + 1) + 0.5; ys[k] = sy / (2 * w + 1) + 0.5;
  }
  const reach = Math.ceil(BANK_HALF_WIDTH);
  for (let k = 0; k < m; k++) {
    const last = k === m - 1, samples = last ? 1 : Math.max(1, Math.ceil(4 * Math.hypot(xs[k + 1] - xs[k], ys[k + 1] - ys[k])));
    for (let s = 0; s < samples; s++) {
      const t = s / samples, px = last ? xs[k] : xs[k] + (xs[k + 1] - xs[k]) * t, py = last ? ys[k] : ys[k] + (ys[k + 1] - ys[k]) * t;
      const z = last ? levels[k] : levels[k] + (levels[k + 1] - levels[k]) * t;
      const gx = Math.floor(px), gy = Math.floor(py);
      for (let yy = gy - reach; yy <= gy + reach; yy++) for (let xx = gx - reach; xx <= gx + reach; xx++) {
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const d = Math.hypot(xx + 0.5 - px, yy + 0.5 - py);
        if (d > BANK_HALF_WIDTH) continue;
        const c = yy * n + xx, bed = d <= BED_HALF_WIDTH;
        const floor = bed ? z : z + BANK_SLOPE * (d - BED_HALF_WIDTH) * cell;
        if (height[c] > floor) height[c] = floor;
        if (bed) drained[c] = 1;
      }
    }
  }
}

/**
 * Sediment settles in what stays flooded: each lake bed rises to a bowl
 * sloping `slope` down from its shore, never flat. Heights stay at or below
 * `filled`, so the flood that computed it is unchanged.
 */
function settle(height: Float32Array, filled: Float32Array, original: Float32Array, n: number, width: number, slope: number): void {
  const cell = width / n, diagonal = cell * Math.SQRT2, d = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) d[c] = filled[c] > height[c] ? Infinity : 0;
  // Two-pass chamfer distance to the shore; the second pass raises the bed.
  for (let y = 0, c = 0; y < n; y++) for (let x = 0; x < n; x++, c++) {
    if (!d[c]) continue;
    let v = d[c];
    if (x > 0) v = Math.min(v, d[c - 1] + cell);
    if (y > 0) v = Math.min(v, d[c - n] + cell, x > 0 ? d[c - n - 1] + diagonal : Infinity, x < n - 1 ? d[c - n + 1] + diagonal : Infinity);
    d[c] = v;
  }
  for (let y = n - 1, c = n * n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--, c--) {
    if (!d[c]) continue;
    let v = d[c];
    if (x < n - 1) v = Math.min(v, d[c + 1] + cell);
    if (y < n - 1) v = Math.min(v, d[c + n] + cell, x < n - 1 ? d[c + n + 1] + diagonal : Infinity, x > 0 ? d[c + n - 1] + diagonal : Infinity);
    d[c] = v;
    if (original[c] > 0) height[c] = Math.max(height[c], filled[c] - slope * v);
  }
}

export function conditionRelief(height: Float32Array, n: number, width: number, settings: ConditioningSettings): ConditioningResult {
  const started = performance.now();
  const before = depressions(height, n, width);
  const result = new Float32Array(height);
  const both = settings.mode === 'both';
  let steps = 0, breaches = 0;
  if (settings.mode === 'erosion' || both) {
    steps = Math.round(12 * Math.max(0, Math.min(3, settings.strength)));
    const deposit = both ? 0 : 0.12;
    if (n <= 512) erode(result, n, width, steps, deposit);
    else {
      const m = 512, small = downsample(height, n, n / m), eroded = new Float32Array(small);
      erode(eroded, m, width, steps, deposit);
      for (let c = 0; c < m * m; c++) eroded[c] -= small[c];
      const change = upsampleDelta(eroded, m, n);
      for (let c = 0; c < n * n; c++) if (height[c] > 0) result[c] = Math.max(Math.min(height[c], 0.1), height[c] + change[c]);
    }
  }
  // A second pass reroutes the pits whose stale flood path the first one cut short.
  if (settings.mode === 'breach' || both) for (let pass = 0; pass < 2; pass++) {
    const opened = breach(result, n, width, Math.max(0, settings.maxDepth), Math.max(0, settings.maxLength));
    breaches += opened;
    if (!opened) break;
  }
  // Sea and ground below sea level keep their heights: only land drains.
  for (let c = 0; c < n * n; c++) {
    if (height[c] <= 0) result[c] = height[c];
    else if (result[c] < 0.1) result[c] = Math.min(height[c], 0.1);
  }
  const hydrology = computeHydrology(result, n, width);
  // The erosion's sediment: more steps, fuller beds (2‰ bowls at the default 24).
  if (both && steps > 0) settle(result, hydrology.filled, height, n, width, 0.048 / steps);
  const delta = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) delta[c] = result[c] - height[c];
  const after = depressions(result, n, width, hydrology);
  return {
    height: result, delta, before: { depressions: before.depressions, volume: before.volume }, after: { depressions: after.depressions, volume: after.volume },
    breaches, steps, ms: performance.now() - started, hydrology: after.hydrology,
  };
}
