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
 * - sill breaching (Lindsay 2016, hybrid breaching–filling): the flood path
 *   from each depression bottom through its spill is lowered by at most
 *   `maxDepth` metres over at most `maxLength` metres; what stays below the
 *   lowered spill is a real depression, left to the lakes or to filling.
 * Erosion runs on at most 512² (its height change is interpolated); breaching
 * runs on the full hydrology grid, whose own small pits it opens. The bench
 * applies the height change to the displayed terrain at every zoom.
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

function depressions(height: Float32Array, n: number, width: number): { depressions: number; volume: number; hydrology: SimpleHydrology } {
  const h = computeHydrology(height, n, width);
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

/** Implicit stream-power incision without uplift, deposition in depressions. */
function erode(height: Float32Array, n: number, width: number, steps: number): void {
  for (let step = 0; step < steps; step++) {
    const h = computeHydrology(height, n, width);
    const { order, receiver, accumulation, filled } = h;
    for (let k = 0; k < order.length; k++) {
      const c = order[k], r = receiver[c];
      if (r < 0 || h.sea[c]) continue;
      const depth = filled[c] - height[c];
      // Sediment settles in depressions: they rise a share of their depth.
      if (depth > 0.01) { height[c] += 0.12 * depth; continue; }
      const diagonal = c % n !== r % n && Math.floor(c / n) !== Math.floor(r / n);
      // F = K Δt √A / Δx per cell step: hillslopes barely move, channels cut.
      const f = 0.03 * Math.sqrt(accumulation[c] / 1e6) / (diagonal ? Math.SQRT2 : 1);
      // Base level: the receiver's water surface. A stream entering a depression
      // stops cutting at the water it enters, not at the depression's floor.
      const base = Math.max(height[r], filled[r]);
      if (height[c] > base) height[c] = (height[c] + f * base) / (1 + f);
    }
  }
}

/** Lowers each depression's flood path through its spill; returns the number of breaches. */
function breach(height: Float32Array, n: number, width: number, maxDepth: number, maxLength: number): number {
  const cell = width / n, total = n * n;
  const { filled, receiver } = computeHydrology(height, n, width);
  const seen = new Uint8Array(total), stack: number[] = [];
  // Bottom of every depression (component at one filled level), deepest first.
  const pits: [number, number][] = [];
  for (let s = 0; s < total; s++) {
    if (seen[s] || filled[s] - height[s] <= 0.05) continue;
    let bottom = s;
    stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!, x = c % n, y = (c - x) / n;
      if (height[c] < height[bottom]) bottom = c;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (!seen[nb] && filled[nb] - height[nb] > 0.05 && filled[nb] === filled[c]) { seen[nb] = 1; stack.push(nb); }
      }
    }
    pits.push([bottom, filled[s] - height[bottom]]);
  }
  pits.sort((a, b) => b[1] - a[1]);
  const path: number[] = [];
  let breaches = 0;
  for (const [bottom] of pits) {
    const spill = filled[bottom];
    if (spill - height[bottom] <= 0.05) continue;
    // The lowest cut level whose channel stays within the length budget.
    const lowest = Math.max(height[bottom], spill - maxDepth), stepZ = Math.max(0.5, (spill - lowest) / 8);
    for (let level = lowest; level < spill - 0.05; level += stepZ) {
      path.length = 0;
      let z = level, ok = true;
      for (let c = receiver[bottom], previous = bottom; c >= 0; previous = c, c = receiver[c]) {
        const step = (c % n !== previous % n && Math.floor(c / n) !== Math.floor(previous / n) ? Math.SQRT2 : 1) * cell;
        // Lower ground beyond the spill: the channel is complete.
        if (height[c] < z - 0.001 * step && filled[c] < spill) break;
        z -= 0.001 * step;
        if (height[c] > z) path.push(c, z);
        if (path.length / 2 * cell > maxLength) { ok = false; break; }
      }
      if (!ok) continue;
      for (let k = 0; k < path.length; k += 2) height[path[k]] = Math.min(height[path[k]], path[k + 1]);
      if (path.length) breaches++;
      break;
    }
  }
  return breaches;
}

export function conditionRelief(height: Float32Array, n: number, width: number, settings: ConditioningSettings): ConditioningResult {
  const started = performance.now();
  const before = depressions(height, n, width);
  const result = new Float32Array(height);
  let steps = 0, breaches = 0;
  if (settings.mode === 'erosion' || settings.mode === 'both') {
    steps = Math.round(12 * Math.max(0, Math.min(3, settings.strength)));
    if (n <= 512) erode(result, n, width, steps);
    else {
      const m = 512, small = downsample(height, n, n / m), eroded = new Float32Array(small);
      erode(eroded, m, width, steps);
      for (let c = 0; c < m * m; c++) eroded[c] -= small[c];
      const change = upsampleDelta(eroded, m, n);
      for (let c = 0; c < n * n; c++) if (height[c] > 0) result[c] = Math.max(Math.min(height[c], 0.1), height[c] + change[c]);
    }
  }
  if (settings.mode === 'breach' || settings.mode === 'both') breaches = breach(result, n, width, Math.max(0, settings.maxDepth), Math.max(0, settings.maxLength));
  // Sea and ground below sea level keep their heights: only land drains.
  const delta = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) {
    if (height[c] <= 0) result[c] = height[c];
    else if (result[c] < 0.1) result[c] = Math.min(height[c], 0.1);
    delta[c] = result[c] - height[c];
  }
  const after = depressions(result, n, width);
  return {
    height: result, delta, before: { depressions: before.depressions, volume: before.volume }, after: { depressions: after.depressions, volume: after.volume },
    breaches, steps, ms: performance.now() - started, hydrology: after.hydrology,
  };
}
