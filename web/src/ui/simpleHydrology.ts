/** V2 hydrology types; the implementation lives in Rust vector_water. */
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

export interface HydrologyOptions {
  /** Runoff weight of each cell (1: the reference runoff); areas are weighted by it. */
  weight?: Float32Array;
  /** Extra outlets: cells that absorb all the water reaching them (closed lakes). */
  outlet?: Uint8Array;
  /** Water lost by each cell before it passes on, m² of reference runoff (lake evaporation at its exit). */
  loss?: Float32Array;
}
export { computeHydrology, waterBodies } from '../../../rust/bridge/waterNative';
