/** V2 water types. Computation lives in magna-urbis-terrain::vector_water. */
import type { SimpleHydrology } from './simpleHydrology';
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

export type ConditioningMode = 'none' | 'erosion' | 'breach' | 'both';
export const DEFAULT_CONDITIONING: ConditioningSettings = { mode: 'none', strength: 2, maxDepth: 30, maxLength: 3000 };
export { conditionRelief } from '../../../rust/bridge/waterNative';
