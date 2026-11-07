/** V2 water types. Computation lives in magna-urbis-terrain::vector_water. */
import type { SimpleHydrology } from './simpleHydrology';
import type { RiverNetwork } from './riverVectors';
import type { RiverMetrics } from './riverMetrics';
import type { LakeField } from './lakeGeometry';
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
  /** Shore coefficients and signed distance, computed once in Rust. */
  lakeField: LakeField;
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
  /** Applied threshold, retained so grid-mode consumers reproduce the drawn D8 network. */
  riverArea?: number;
  metrics: RiverMetrics;
  runoff: { r0: number; e0: number; aridity: number };
  confluenceAngle?: number;
  hydrologyMs: number; balanceMs: number;
}

export { computeVectorWater } from '../../../rust/bridge/waterNative';
