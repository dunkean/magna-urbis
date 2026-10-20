import type { BenchOptions } from '../src/gen/urban/testbench';

const base: BenchOptions = { culture: 'european-organic', recipe: 'core', zone: 'core', density: 1,
  count: 6, radius: 240, placement: 'rectangle', monument: 'none' };

/** Browser- and Node-compatible inputs for generation latency and exact parity checks. */
export const TS_GENERATION_PERF_CASES: [string, BenchOptions, string][] = [
  ['organic', base, '42'],
  ['large', { ...base, radius: 500, count: 8, rings: 2 }, '83'],
  ['river', { ...base, placement: 'notched', relief: 'hill', river: 'diagonal', riverWidth: 18 }, '42'],
  ['medina', { ...base, culture: 'medina' }, '27'],
  ['chinese', { ...base, culture: 'chinese' }, '19'],
  ['micro', { ...base, mode: 'micro', microScale: 2.5 }, '42'],
];
