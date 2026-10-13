/**
 * Vector water chain of the terrain bench (formerly the neural bench's):
 * priority-flood drainage, optional water budget (Fill–Spill–Merge lakes,
 * closed basins), drawn lakes and vector rivers, with their geomorphic metrics.
 * Runs on a height grid of the whole map, in a worker.
 */
import { computeHydrology, waterBodies, type SimpleHydrology } from './simpleHydrology';
import { vectorRivers, type RiverNetwork } from './riverVectors';
import { waterBalance, balancedBodies, runoffModel, type ClimateInput } from './waterBalance';
import { riverMetrics, type RiverMetrics } from './riverMetrics';

export interface VectorWaterSettings {
  /** Upstream area that starts a river, km². */
  riverArea: number;
  /** Minimum depth of a lake cell, metres, and minimum lake surface, hectares. */
  lakeDepth: number; lakeArea: number;
  riverMode: 'vector' | 'grid';
  flatSlope: number; sinuosity: number; widthScale: number;
  /** Lakes from the climate's water budget instead of filling every depression. */
  balance: boolean;
  braiding: number; anabranching: boolean; terrainInfluence: boolean; avulsions: boolean;
  /** Confluence angle from the climate (Seybold et al. 2017) or as the drainage draws it. */
  confluence: 'climate' | 'drainage';
  deltas: boolean;
}

export interface VectorWater {
  hydro: SimpleHydrology;
  /** Drawn lakes. */
  lake: Uint8Array;
  /** Water surface of each balanced lake cell (NaN elsewhere), when the budget is on. */
  lakeLevel?: Float32Array;
  /** 1 open lake, 2 closed lake, per submerged cell (budget on). */
  lakeKind?: Uint8Array;
  lakes: number; closedLakes: number; lakeAreaKm2: number; riverCells: number;
  rivers?: RiverNetwork;
  /** Hydraulic width multiplier, also retained when grid diagnostics are selected. */
  widthScale?: number;
  metrics: RiverMetrics;
  runoff: { r0: number; e0: number; aridity: number };
  confluenceAngle?: number;
  hydrologyMs: number; balanceMs: number;
}

/** `drainage`: `computeHydrology(height, n, width)` when already known (the conditioning's last pass). */
export function computeVectorWater(height: Float32Array, n: number, width: number, settings: VectorWaterSettings, climate: ClimateInput, seed: string, drainage?: SimpleHydrology): VectorWater {
  const started = performance.now();
  const runoff = runoffModel(climate);
  let hydro = drainage ?? computeHydrology(height, n, width);
  let lake: Uint8Array, lakes: number, closedLakes = 0, lakeAreaKm2: number, lakeLevel: Float32Array | undefined, lakeKind: Uint8Array | undefined;
  let balanceMs = 0;
  if (settings.balance) {
    const balance = waterBalance(height, n, width, hydro.sea, climate, settings.lakeDepth, settings.lakeArea * 1e4, hydro);
    balanceMs = balance.ms;
    // One sink per connected submerged component. Separate pans below the
    // same depression's spill must not route across the dry ridge between them.
    const components = new Int32Array(n * n).fill(-1), sinks: number[] = [];
    const outlet = new Uint8Array(n * n), queue: number[] = [];
    for (let c = 0; c < n * n; c++) {
      if (!balance.closed[c] || components[c] >= 0) continue;
      const component = sinks.length, body = balance.lakeOf[c];
      queue.length = 0; queue.push(c); components[c] = component;
      let bottom = c;
      for (let head = 0; head < queue.length; head++) {
        const at = queue[head], x = at % n, y = Math.floor(at / n);
        if (height[at] < height[bottom]) bottom = at;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, nb = yy * n + xx;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n || components[nb] >= 0 || !balance.closed[nb] || balance.lakeOf[nb] !== body) continue;
          components[nb] = component; queue.push(nb);
        }
      }
      sinks.push(bottom); outlet[bottom] = 1;
    }
    // Use the same routing relief that located the open-lake evaporation
    // exits; rerouting on the original noisy pits charges the wrong cells.
    hydro = computeHydrology(balance.routingHeight, n, width, { weight: balance.weight, outlet, loss: balance.loss });
    hydro.height = height; // Physical channel fitting still follows the real floor.
    for (let c = 0; c < n * n; c++) if (balance.closed[c]) hydro.filled[c] = balance.level[c];
    const bodies = balancedBodies(balance, height, n, hydro.cellArea, settings.lakeDepth, settings.lakeArea);
    ({ lake, lakes, closedLakes, lakeAreaKm2 } = bodies);
    // Follow the existence of a displayed upstream stream even after losses
    // lower its terminal discharge below the river display threshold.
    const upstream = new Uint8Array(n * n), drawn = new Uint8Array(sinks.length), terminal = new Uint8Array(sinks.length);
    for (let k = hydro.order.length - 1; k >= 0; k--) {
      const c = hydro.order[k], r = hydro.receiver[c];
      upstream[c] ||= hydro.accumulation[c] >= settings.riverArea * 1e6 ? 1 : 0;
      if (r >= 0 && upstream[c]) upstream[r] = 1;
      if (lake[c] && components[c] >= 0) drawn[components[c]] = 1;
    }
    for (let id = 0; id < sinks.length; id++) {
      const c = sinks[id];
      if (!drawn[id] && upstream[c] && balance.level[c] - height[c] > 0.1) {
        terminal[id] = 1; lakes++; closedLakes++;
      }
    }
    for (let c = 0; c < n * n; c++) {
      const id = components[c];
      if (id >= 0 && terminal[id] && balance.level[c] - height[c] > 0.1 && !lake[c]) {
        lake[c] = 1; lakeAreaKm2 += hydro.cellArea / 1e6;
      }
    }
    lakeLevel = balance.level;
    lakeKind = new Uint8Array(n * n);
    for (let c = 0; c < n * n; c++) if (balance.lakeOf[c] >= 0) lakeKind[c] = balance.closed[c] ? 2 : 1;
  } else {
    const bodies = waterBodies(hydro, settings);
    ({ lake, lakes, lakeAreaKm2 } = bodies);
  }
  const hydrologyMs = performance.now() - started - balanceMs;
  const threshold = settings.riverArea * 1e6;
  let riverCells = 0;
  for (let c = 0; c < n * n; c++) if (!hydro.sea[c] && !lake[c] && hydro.accumulation[c] >= threshold) riverCells++;
  // Seybold, Rothman & Kirchner (2017): about 45° in arid climates, 72° in humid ones.
  const confluenceAngle = settings.confluence === 'climate' ? 45 + 27 * Math.max(0, Math.min(1, (runoff.aridity - 0.2) / 0.8)) : undefined;
  const rivers = settings.riverMode === 'vector' ? vectorRivers(hydro, lake, {
    riverArea: settings.riverArea, flatSlope: settings.flatSlope, sinuosity: settings.sinuosity, widthScale: settings.widthScale, seed,
    braiding: settings.braiding, anabranching: settings.anabranching, terrainInfluence: settings.terrainInfluence, avulsions: settings.avulsions,
    confluenceAngle, deltas: settings.deltas, aridity: runoff.aridity, dischargeScale: settings.balance ? runoff.r0 / 300 : 1,
  }) : undefined;
  const metrics = riverMetrics(hydro, lake, rivers, settings.riverArea, settings.widthScale);
  return {
    hydro, lake, lakeLevel, lakeKind, lakes, closedLakes, lakeAreaKm2, riverCells, rivers, widthScale: settings.widthScale, metrics,
    runoff: { r0: runoff.r0, e0: runoff.e0, aridity: runoff.aridity }, confluenceAngle, hydrologyMs, balanceMs,
  };
}
