/** V2 water types. Computation lives in magna-urbis-terrain::vector_water. */
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
}

export interface WaterBalance {
  /** Relief after removal of sub-threshold pits, used to locate evaporation exits. */
  routingHeight: Float32Array;
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

export interface BalancedBodies {
  lake: Uint8Array;
  lakes: number;
  lakeAreaKm2: number;
  closedLakes: number;
}

export { waterBalance } from '../../../rust/bridge/waterNative';
