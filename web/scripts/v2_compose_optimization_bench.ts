/** Reconstruct the pre-optimization clone boundaries and compare the real composition. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { composeTerrain } from '../src/v2/compose';
import { terrainCacheKey } from '../src/v2/engine';
import { defaultSettings } from '../src/v2/settings';
import { TerrainCache, V2_ENGINE_VERSION } from '../src/v2/cache';
import { resultTransferBuffers } from '../src/v2/transfer';
import type { V2Project } from '../src/v2/contracts';
import type { World } from '../src/gen/types';

const output = new URL('../out/v2-project-optimization/', import.meta.url); await mkdir(output, { recursive: true });
const filename = fileURLToPath(new URL('../src/v2/compose.ts', import.meta.url)); let legacy = await readFile(filename, 'utf8');
const replace = (before: string, after: string) => { if (!legacy.includes(before)) throw new Error('Baseline reconstruction drift: ' + before); legacy = legacy.replace(before, after); };
replace('owned ? origin[key] : structuredClone(origin[key])', 'structuredClone(origin[key])');
replace("const proposed = { ...draft, extent: world.mapSize, options: { ...draft.options, mapSize: world.mapSize } };\n  const coherent = world.seed === draft.options.seed && world.stats['v2.terrainKey'] === terrainCacheKey(proposed);\n  const settings = coherent ? structuredClone(proposed) : cloneWithoutTerrainOptions(draft);\n  settings.extent = world.mapSize;", "const settings = structuredClone(draft);\n  settings.extent = world.mapSize; settings.options.mapSize = world.mapSize;\n  const coherent = world.seed === draft.options.seed && world.stats['v2.terrainKey'] === terrainCacheKey(settings);");
replace("TERRAIN_OPTIONS.filter(key => key !== 'importedHeight')", 'TERRAIN_OPTIONS');
replace('const settings = cloneWithoutTerrainOptions(current);', 'const settings = structuredClone(current);');
replace('settings.terrain=adopted.settings.terrain', 'settings.terrain=structuredClone(adopted.settings.terrain)');
replace('settings.runtime = adopted.settings.runtime', 'settings.runtime = structuredClone(adopted.settings.runtime)');
legacy = legacy.replace(/from '(\.[^']+)'/g, (_match, path: string) => `from '${pathToFileURL(resolve(dirname(filename), path + '.ts')).href}'`);
const legacyFile = new URL('legacy-compose.ts', output); await writeFile(legacyFile, legacy);
const { composeTerrain: legacyCompose } = await import(legacyFile.href);
function fixture() {
  const settings = defaultSettings(); settings.extent = 4000; settings.options.mapSize = 4000;
  settings.options.importedHeight = { w: 1024, h: 1024, rgba: new Uint8Array(0), elevations: new Float32Array(1024 ** 2).fill(20) };
  const n = 128, length = n * n, cell = 4000 / n, grid = () => ({ w: n, h: n, cell, data: new Float32Array(length).fill(20) });
  const world: World = { seed: settings.options.seed, options: settings.options, mapSize: 4000, terrain: { height: grid(), slope: grid(), flow: grid(), water: new Uint8Array(length), receiver: new Int32Array(length).fill(-1), filled: new Float32Array(length).fill(20), coastline: [], rivers: [], lakes: [], seaFraction: 0, seaLevel: 0, seaSide: null, downSide: 'S' }, stats: { 'v2.terrainKey': terrainCacheKey(settings) } };
  const source: V2Project = { format: 'magna-urbis-v2', version: 1, engine: V2_ENGINE_VERSION, settings, world, mods: [] };
  const current = structuredClone(settings); current.options.seed = 'current-discarded-heightmap'; current.options.importedHeight!.elevations!.fill(30);
  return { source, current };
}
const store = () => ({ async get() { return undefined; }, async put() {}, async clear() {} });
const originalClone = globalThis.structuredClone;
async function run(compose: typeof composeTerrain, source: V2Project, current: ReturnType<typeof defaultSettings>) {
  let cloneCalls = 0, cloneBytes = 0;
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => { cloneCalls++; cloneBytes += resultTransferBuffers(value).reduce((sum, buffer) => sum + buffer.byteLength, 0); return originalClone(value, options); }) as typeof structuredClone;
  let result: V2Project;
  try { result = await compose(source, current, new TerrainCache(store())); } finally { globalThis.structuredClone = originalClone; }
  global.gc?.(); const before = process.memoryUsage(), start = performance.now();
  await compose(source, current, new TerrainCache(store()));
  return { result, metrics: { cloneCalls, copiedRasterBytes: cloneBytes, ms: performance.now() - start, arrayBufferDeltaBytes: process.memoryUsage().arrayBuffers - before.arrayBuffers } };
}
const { source, current } = fixture(), baseline = await run(legacyCompose, source, current), optimized = await run(composeTerrain, source, current);
delete baseline.result.world!.stats['ms.total']; delete optimized.result.world!.stats['ms.total'];
assert.deepEqual(optimized.result, baseline.result); assert(optimized.metrics.copiedRasterBytes < baseline.metrics.copiedRasterBytes);
assert.equal(source.world!.terrain.height.data[0], 20); assert.equal(current.options.importedHeight!.elevations![0], 30);
const report = { ok: true, inputHeightmapBytes: 4 * 1024 ** 2, baseline: baseline.metrics, optimized: optimized.metrics, identicalComposition: true, sourceInputsUnmodified: true };
await writeFile(new URL('compose.json', output), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
