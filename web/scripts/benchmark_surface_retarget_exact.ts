/** Explicit before/after CPU comparison. Baseline is a separately bundled,
 * frozen compiler, never a second import of the modified source. No NN/GPU. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import type * as CurrentCompiler from '../src/surface/compiler';
import { unpackMaterialMean } from '../src/surface/materials';
import { decodeSurfaceBinary } from '../src/surface/binary';
import { recoverRetainedPopulationSampler } from '../src/surface/retainedPopulation';
import { generateSurfaceCandidates } from '../src/surface/population';
import { SURFACE_LAYER_FIELDS } from '../src/surface/surfaceLayers';
import { surfaceLayerInput } from '../tests/fixtures/surfaceLayerInput';
import type { SurfaceWorld, TerrainGrid } from '../src/surface/model';

const { values } = parseArgs({ options: { baseline: { type: 'string' }, optimized: { type: 'string' }, replay: { type: 'string' }, out: { type: 'string' }, rounds: { type: 'string', default: '5' } } });
if (!values.baseline || !values.optimized || !values.out) throw Error('--baseline frozen-compiler.mjs --optimized equally-bundled-current.mjs --out report.json [--replay V11-REPLAY-DIRECTORY] [--rounds 5]');
const baseline = await import(pathToFileURL(resolve(values.baseline)).href) as typeof CurrentCompiler & { unpackMaterialMean: typeof unpackMaterialMean };
const current = await import(pathToFileURL(resolve(values.optimized)).href) as typeof baseline;
const rounds = Number(values.rounds);
assert.ok(Number.isInteger(rounds) && rounds >= 3 && rounds <= 30);
function exact(a: unknown, b: unknown, path = 'world'): void {
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    assert.equal(a.constructor.name, b.constructor.name, path + ': constructor');
    assert.ok(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength)), path + ': byte difference');
  } else if (a && typeof a === 'object' && b && typeof b === 'object') {
    assert.deepEqual(Object.keys(a), Object.keys(b), path + ': keys');
    for (const key of Object.keys(a)) exact((a as any)[key], (b as any)[key], path + '.' + key);
  } else assert.ok(Object.is(a, b), path + ': scalar difference');
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cases: Array<{ name: string; base: SurfaceWorld; fine: TerrainGrid; retained?: boolean }> = [];
for (const season of [0, .25, .5, .75]) {
  const input = surfaceLayerInput(); input.state = { version: 'season-test', dayOfYear: 1 + Math.round(season * 360), surfaceWetness: .3, snowWaterEquivalentM: season === 0 ? .1 : 0 };
  const base = baseline.compileSurfaceWorld(input, { topographicRadiiM: [32, 64, 128] });
  exact(base, current.compileSurfaceWorld(input, { topographicRadiiM: [32, 64, 128] }), 'compiled');
  for (const n of [33, 128]) cases.push({ name: `contact-season-${season}-${n}`, base, fine: { ...base.terrain, originX: 7.3, originZ: 9.7, width: n, height: n, spacingM: 480 / (n - 1), heights: Float32Array.from({ length: n * n }, (_, i) => 120 + Math.sin(i * .13)) } });
}
const altered = structuredClone(cases[0].base), f = altered.fields;
for (let i = 0; i < f.material.length; i++) {
  f.lowCoverOpacity![i] = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : .25;
  f.lowCoverMaterialMeanColor![i] = i % 3 === 0 ? 0xff00ff : 0x19ee21;
  f.material[i] = f.materialSecondary[i] = i % altered.materials.length;
  f.handM[i] = NaN; f.distanceToWaterM[i] = Infinity;
  if (i % 5 === 0) f.slope[i] = NaN; // Deliberately exercise historical nearest fallback.
}
cases.push({ name: 'transparent-arbitrary-colors-NaN-Infinity-ties', base: altered, fine: cases[1].fine });
const legacy = structuredClone(altered);
for (const key of SURFACE_LAYER_FIELDS) delete (legacy.fields as any)[key];
delete legacy.surfaceLayers; delete legacy.versions.surfaceLayers;
cases.push({ name: 'explicitly-unavailable-legacy', base: legacy, fine: cases[0].fine });
// Full requested-size projection, independent of a provider's actual delivery cap.
cases.push({ name: 'generated-512', base: cases[0].base, fine: { ...cases[0].fine, width: 512, height: 512, spacingM: 480 / 511, heights: new Float32Array(512 * 512).fill(123) } });
if (values.replay) for (const serial of [21, 204, 253]) {
  const path = resolve(values.replay, `preview-${serial}-standalone.surfacebin`);
  const packet = decodeSurfaceBinary<any>(readFileSync(path));
  const recovered = recoverRetainedPopulationSampler(packet);
  cases.push({ name: `V11-retained-${serial}-actual-${packet.world.terrain.width}`, base: recovered.sampler, fine: packet.world.terrain, retained: true });
}
for (let byte = 0; byte < 256; byte++) exact(baseline.unpackMaterialMean(byte | byte << 8 | byte << 16), current.unpackMaterialMean(byte | byte << 8 | byte << 16), 'sRGB8-' + byte);
const results: any[] = [];
for (const entry of cases) {
  const before = baseline.retargetSurfaceWorld(entry.base, entry.fine), after = current.retargetSurfaceWorld(entry.base, entry.fine);
  exact(before, after); // Every field byte, identity, descriptor and metadata, not only a hash.
  const b = before.bounds;
  for (let i = 0; i < 50; i++) {
    const x = b.minX + (b.maxX - b.minX) * ((i * 13 % 51) / 51), z = b.minZ + (b.maxZ - b.minZ) * ((i * 29 % 53) / 53);
    exact(baseline.sampleSurface(before, x, z), current.sampleSurface(after, x, z), 'sample');
  }
  const timings = { baseline: [] as number[], optimized: [] as number[] };
  for (let round = 0; round < rounds + 1; round++) for (const mode of round % 2 ? ['optimized', 'baseline'] as const : ['baseline', 'optimized'] as const) {
    const began = performance.now(); (mode === 'baseline' ? baseline : current).retargetSurfaceWorld(entry.base, entry.fine);
    if (round) timings[mode].push(performance.now() - began);
  }
  const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
  results.push({ name: entry.name, width: entry.fine.width, height: entry.fine.height, retainedRequestReplay: !!entry.retained, allBytesAndMetadataExact: true, timings, medianBaselineMs: median(timings.baseline), medianOptimizedMs: median(timings.optimized), speedup: median(timings.baseline) / median(timings.optimized) });
  console.log(JSON.stringify(results.at(-1)));
}
const stable = generateSurfaceCandidates(current.compileSurfaceWorld(surfaceLayerInput(), { topographicRadiiM: [32, 64, 128] }), { minX: 32, minZ: 32, maxX: 480, maxZ: 480 });
const frozen = JSON.parse(readFileSync(new URL('../tests/fixtures/surface-layer-legacy-baseline.json', import.meta.url), 'utf8'));
// Existing regression test verifies its record fingerprint; retain exact baseline inventory here too.
const oldStable = generateSurfaceCandidates(baseline.compileSurfaceWorld(surfaceLayerInput(), { topographicRadiiM: [32, 64, 128] }), { minX: 32, minZ: 32, maxX: 480, maxZ: 480 });
exact(oldStable, stable, 'candidate inventory');
assert.equal(stable.length, frozen.candidateCount); assert.equal(current.fingerprint(stable), frozen.candidateFingerprint);
const normal = cases[0], cancelled = new AbortController(); cancelled.abort();
const invalid: Array<{ name: string; base?: SurfaceWorld; fine?: TerrainGrid; options?: any }> = [
  { name: 'source-version', fine: { ...normal.fine, source: { ...normal.fine.source, version: 'stale' } } },
  { name: 'source-id', fine: { ...normal.fine, source: { ...normal.fine.source, id: 'other' } } },
  { name: 'invalid-spacing', fine: { ...normal.fine, spacingM: NaN } },
  { name: 'outside', fine: { ...normal.fine, originX: -500 } },
  { name: 'memory-budget', options: { memoryBudgetBytes: 1 } },
  { name: 'cancelled', options: { signal: cancelled.signal } },
  { name: 'stale-environment', options: { expectedEnvironmentVersion: 'stale' } },
  { name: 'stale-terrain', options: { expectedTerrainVersion: 'stale' } },
  { name: 'unavailable-context', base: { ...cases[0].base, canonicalContextRef: beforeReference(), canonicalContext: undefined } },
];
function beforeReference() { return current.retargetSurfaceWorld(normal.base, normal.fine).canonicalContextRef!; }
const errors: any[] = [];
for (const entry of invalid) {
  const run = (compiler: typeof current) => { try { compiler.retargetSurfaceWorld(entry.base ?? normal.base, entry.fine ?? normal.fine, entry.options); } catch (error: any) { return { name: error.name, constructor: error.constructor.name, message: error.message }; } throw Error('Expected rejected input: ' + entry.name); };
  const expected = run(baseline); exact(expected, run(current), 'error-' + entry.name); errors.push({ case: entry.name, ...expected });
}
const report = { version: 1, status: 'PASS', baselineBundleSha256: sha(readFileSync(values.baseline)), optimizedBundleSha256: sha(readFileSync(values.optimized)), results, errors, allMaterialBytesExact: true, candidateCount: stable.length, candidateFingerprint: current.fingerprint(stable), scope: 'Direct synchronous Node CPU wall spans of equally bundled modules, alternating order and one discarded warm-up. No browser delivery, OS scheduling attribution, GPU, navigation gate, or guaranteed latency. Retained V11 requests were requeried earlier and checked against original world/terrain/version summaries; original BODY bytes were not archived. Synthetic 512 is labelled separately from actual provider-delivered 129/140 grids.' };
writeFileSync(values.out, JSON.stringify(report, null, 2) + '\n');
