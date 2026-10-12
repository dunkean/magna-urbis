/**
 * Lakes from a water budget: Fill–Spill–Merge (Barnes, Callaghan & Wickert
 * 2021) at equilibrium, on the drainage the rivers follow.
 *
 * Runoff r (precipitation minus evapotranspiration, Turc–Pike) feeds every
 * depression of the filled drainage from its catchment; open water evaporates
 * e per unit area. A depression whose inflow exceeds the evaporation of its
 * full surface overflows and passes the excess on; otherwise its lake settles
 * where evaporation balances inflow (e·A = Q), below the spill, and closes its
 * basin. Humid climates fill every basin and drain to the sea; arid ones keep
 * closed lakes well below their spill (salt lakes) and dry basins, and rivers
 * end in them. Nested pits of one depression share its water.
 *
 * Inflows follow the priority-flood routing of the rivers themselves, so lakes
 * and courses agree. Each pass accumulates the runoff once, letting every
 * depression pass on what its evaporation leaves; a few passes carry the
 * changes down chains of lakes. Areas are in m² of reference runoff (the
 * runoff at sea level): a cell weighs its runoff ratio, a lake cell evaporates
 * e / r₀ of its area.
 */
import { computeHydrology } from './simpleHydrology';

export interface ClimateInput {
  /** Mean annual temperature at sea level, °C (−6.5 °C/km above). */
  temperature: number;
  /** Annual precipitation, mm. */
  precipitation: number;
}

export interface Runoff {
  /** Runoff at sea level, mm/yr. */
  r0: number;
  /** Open-water evaporation at sea level, mm/yr. */
  e0: number;
  /** Aridity index P / PET. */
  aridity: number;
  runoffAt(z: number): number;
  evaporationAt(z: number): number;
}

/** Turc–Pike: L(T) = 300 + 25 T + 0.05 T³, ET = P / √(0.9 + P²/L²); lake evaporation ≈ L. */
export function runoffModel(climate: ClimateInput): Runoff {
  const potential = (z: number): number => {
    const t = climate.temperature - 0.0065 * Math.max(0, z);
    return Math.max(60, 300 + 25 * t + 0.05 * t * t * t);
  };
  const runoffAt = (z: number): number => {
    const p = climate.precipitation, l = potential(z);
    const et = p / Math.sqrt(0.9 + (p * p) / (l * l));
    return Math.max(0.02 * p, p - et, 0.5);
  };
  return { r0: runoffAt(0), e0: potential(0), aridity: climate.precipitation / potential(0), runoffAt, evaporationAt: potential };
}

export interface WaterBalance {
  /** Runoff weight of each cell (its runoff over the reference runoff). */
  weight: Float32Array;
  /** Lake id of each submerged cell, −1 elsewhere. */
  lakeOf: Int32Array;
  /** Water level of each submerged cell, NaN elsewhere. */
  level: Float32Array;
  /** Closed lakes: they evaporate all their inflow (absorbing outlets for routing). */
  closed: Uint8Array;
  /** Evaporation charged where a spilling lake leaves its basin, m² of reference runoff. */
  loss: Float32Array;
  lakes: number;
  closedLakes: number;
  /** Total submerged area, m². */
  lakeArea: number;
  runoff: Runoff;
  ms: number;
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];


/**
 * Depressions that could never be drawn as lakes, even full (shallower than
 * `minDepth` metres or smaller than `minArea` m²), are filled first with a
 * slight slope to their spill: they are grid noise, not ponds. Left as they
 * are, a plain riddled with them would evaporate its rivers away pit by pit.
 */
function fillNoise(height: Float32Array, n: number, width: number, minDepth: number, minArea: number): Float32Array {
  const h = computeHydrology(height, n, width), total = n * n, out = new Float32Array(height);
  const seen = new Uint8Array(total), noise = new Uint8Array(total), component: number[] = [];
  for (let s = 0; s < total; s++) {
    if (seen[s] || h.filled[s] - height[s] <= 0) continue;
    component.length = 0; component.push(s); seen[s] = 1;
    let deepest = 0;
    for (let i = 0; i < component.length; i++) {
      const c = component[i], x = c % n, y = (c - x) / n;
      deepest = Math.max(deepest, h.filled[c] - height[c]);
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (!seen[nb] && h.filled[nb] - height[nb] > 0 && h.filled[nb] === h.filled[c]) { seen[nb] = 1; component.push(nb); }
      }
    }
    if (deepest < minDepth || component.length * h.cellArea < minArea) for (const c of component) noise[c] = 1;
  }
  // Flood order: every receiver first, so the fill rises away from the spill.
  for (let k = 0; k < total; k++) {
    const c = h.order[k], r = h.receiver[c];
    if (noise[c] && r >= 0) out[c] = Math.max(h.filled[c], out[r] + 1e-3);
  }
  return out;
}

export function waterBalance(source: Float32Array, n: number, width: number, sea: Uint8Array, climate: ClimateInput, minDepth = 1, minArea = 1e5): WaterBalance {
  const started = performance.now();
  const total = n * n, cell = width / n, cellArea = cell * cell;
  const height = fillNoise(source, n, width, minDepth, minArea);
  const runoff = runoffModel(climate);
  const weight = new Float32Array(total);
  for (let c = 0; c < total; c++) weight[c] = sea[c] ? 0 : runoff.runoffAt(height[c]) / runoff.r0;
  const evaporationRatio = (z: number): number => runoff.evaporationAt(z) / runoff.r0;
  const { filled, receiver, order } = computeHydrology(height, n, width);

  // Depressions: connected cells under one filled level.
  const depression = new Int32Array(total).fill(-1), cells: number[][] = [], spill: number[] = [];
  for (let s = 0; s < total; s++) {
    if (depression[s] >= 0 || sea[s] || filled[s] - height[s] <= 0) continue;
    const id = cells.length, list = [s];
    depression[s] = id;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], x = c % n, y = (c - x) / n;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const nb = yy * n + xx;
        if (depression[nb] < 0 && !sea[nb] && filled[nb] - height[nb] > 0 && filled[nb] === filled[c]) { depression[nb] = id; list.push(nb); }
      }
    }
    cells.push(list); spill.push(filled[s]);
  }
  const count = cells.length;
  // Evaporation of each depression full to its spill.
  const full = Float64Array.from(cells, (list, d) => list.length * cellArea * evaporationRatio(spill[d]));

  // Passes: water leaving a depression keeps what its evaporation leaves.
  const pass = new Float64Array(count).fill(1), inflow = new Float64Array(count), outflow = new Float64Array(total);
  const acc = new Float64Array(total);
  for (let round = 0; round < 6; round++) {
    for (let c = 0; c < total; c++) acc[c] = weight[c] * cellArea;
    inflow.fill(0); outflow.fill(0);
    for (let k = total - 1; k >= 0; k--) {
      const c = order[k], r = receiver[c];
      if (r < 0) continue;
      const d = depression[c];
      if (d >= 0 && depression[r] !== d) { inflow[d] += acc[c]; outflow[c] = acc[c]; acc[r] += acc[c] * pass[d]; } else acc[r] += acc[c];
    }
    let changed = false;
    for (let d = 0; d < count; d++) {
      const share = inflow[d] > full[d] ? 1 - full[d] / inflow[d] : 0;
      if (Math.abs(share - pass[d]) > 1e-3) changed = true;
      pass[d] = share;
    }
    if (!changed) break;
  }

  const lakeOf = new Int32Array(total).fill(-1), level = new Float32Array(total).fill(NaN);
  const closed = new Uint8Array(total), loss = new Float32Array(total);
  let lakes = 0, closedLakes = 0, lakeArea = 0;
  for (let d = 0; d < count; d++) {
    const list = cells[d];
    let surface = spill[d], wet = list;
    if (pass[d] === 0) {
      // Closed: the lake rises from the lowest ground until e·A balances the inflow.
      const sorted = list.slice().sort((a, b) => height[a] - height[b]);
      let area = 0, k = 0;
      for (; k < sorted.length; k++) {
        area += cellArea;
        if (area * evaporationRatio(height[sorted[k]]) >= inflow[d]) break;
      }
      surface = height[sorted[Math.min(k, sorted.length - 1)]];
      wet = sorted.slice(0, k + 1);
      closedLakes++;
    } else for (const c of list) if (outflow[c] > 0) loss[c] = outflow[c] * (1 - pass[d]);
    for (const c of wet) {
      lakeOf[c] = lakes; level[c] = surface; lakeArea += cellArea;
      if (pass[d] === 0) closed[c] = 1;
    }
    lakes++;
  }
  return { weight, lakeOf, level, closed, loss, lakes, closedLakes, lakeArea, runoff, ms: performance.now() - started };
}

export interface BalancedBodies {
  lake: Uint8Array;
  lakes: number;
  lakeAreaKm2: number;
  closedLakes: number;
}

/**
 * Drawn lakes: cells at least `lakeDepth` metres deep in lakes with at least
 * `lakeArea` hectares that deep; shallower submerged cells surrounded by them
 * (holes, ragged shores) are drawn too, but not the long shallow margins
 * along valley floors.
 */
export function balancedBodies(balance: WaterBalance, height: Float32Array, n: number, cellArea: number, lakeDepth: number, lakeArea: number): BalancedBodies {
  const total = n * n, area = new Float64Array(balance.lakes), closed = new Uint8Array(balance.lakes);
  for (let c = 0; c < total; c++) {
    const k = balance.lakeOf[c];
    if (k < 0 || balance.level[c] - height[c] < lakeDepth) continue;
    area[k] += cellArea;
    if (balance.closed[c]) closed[k] = 1;
  }
  const lake = new Uint8Array(total);
  let cells = 0;
  const kept = new Uint8Array(balance.lakes);
  for (let k = 0; k < balance.lakes; k++) kept[k] = area[k] >= lakeArea * 1e4 && area[k] > 0 ? 1 : 0;
  const deep = new Uint8Array(total);
  for (let c = 0; c < total; c++) {
    const k = balance.lakeOf[c];
    if (k >= 0 && kept[k] && balance.level[c] - height[c] >= lakeDepth) deep[c] = 1;
  }
  for (let c = 0; c < total; c++) {
    let drawn = deep[c] === 1;
    if (!drawn && balance.lakeOf[c] >= 0 && balance.level[c] - height[c] > 0.1) {
      const x = c % n, y = (c - x) / n;
      let around = 0;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx >= 0 && yy >= 0 && xx < n && yy < n && deep[yy * n + xx]) around++;
      }
      drawn = around >= 5;
    }
    if (drawn) { lake[c] = 1; cells++; }
  }
  let lakes = 0, closedLakes = 0;
  for (let k = 0; k < balance.lakes; k++) if (kept[k]) { lakes++; if (closed[k]) closedLakes++; }
  return { lake, lakes, lakeAreaKm2: cells * cellArea / 1e6, closedLakes };
}
