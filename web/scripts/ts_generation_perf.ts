/** Deterministic urban stage benchmark: npx tsx scripts/ts_generation_perf.ts [repeats] [case]. */
import { createHash } from 'node:crypto';
import { benchLayout, benchParcels, benchBuildings } from '../src/gen/urban/testbench';
import { TS_GENERATION_PERF_CASES } from './ts_generation_perf_cases';
const repeats = Math.max(1, Number(process.argv[2] ?? 3));
const filter = process.argv[3];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const [name, options, seed] of TS_GENERATION_PERF_CASES) {
  if (filter && name !== filter) continue;
  const times: number[][] = [], hashes: string[][] = [];
  let counts: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    const layout = benchLayout(options, seed), layoutEnd = performance.now();
    const parcels = benchParcels(layout, seed), parcelsEnd = performance.now();
    const houses = benchBuildings(layout, parcels, seed), housesEnd = performance.now();
    times.push([layoutEnd - start, parcelsEnd - layoutEnd, housesEnd - parcelsEnd]);
    hashes.push([digest({ ...layout, streets: { list: layout.streets.list, connected: [...layout.streets.connected] } }), digest(parcels), digest(houses)]);
    counts = [layout.quarters.length, layout.blocks.length, parcels.parcels.length, houses.buildings.length];
  }
  if (hashes.some(h => h.some((value, i) => value !== hashes[0][i]))) throw new Error(`${name}: nondeterministic output`);
  console.log(JSON.stringify({ name, seed, counts, hashes: hashes[0], medianMs: [0, 1, 2].map(i => median(times.map(t => t[i]))), times }));
}
