/** Local before/after adapter benchmark. Baselines are the exact source files
 * captured before this optimisation pass, not a reimplementation of the loops. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as ts from 'typescript';
import { cloneRustTownSnapshot, projectRustTown, rustSettlementRaster, withRetainedNeighbors, type RustTownSnapshot } from '../src/v2/rustUrban';
import { combineV2NativeScenes, v2WorldDecor } from '../src/v2/urban3d';
import { makeOptions } from '../src/gen/options';
import type { World } from '../src/gen/types';
import type { V2Settings } from '../src/v2/contracts';

const out = new URL('../out/v2-optimization/', import.meta.url); await mkdir(out, { recursive: true });
const oldRust = await readFile(new URL('rustUrban-before.ts', out), 'utf8'), old3d = await readFile(new URL('urban3d-before.ts', out), 'utf8');
function sourceFunctions(source: string, names: string[], variables: string[], dependencies: Record<string, unknown> = {}): Record<string, (...args: any[]) => any> {
  const tree = ts.createSourceFile('baseline.ts', source, ts.ScriptTarget.Latest, true), pieces: string[] = [];
  for (const node of tree.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) pieces.push(node.getText(tree).replace(/^export /, ''));
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variables.includes(declaration.name.getText(tree)))) pieces.push(node.getText(tree).replace(/^export /, ''));
  }
  const code = ts.transpileModule(`${pieces.join('\n')}\nreturn {${names.join(',')}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}
const legacy = sourceFunctions(oldRust, ['surfaceBounds', 'withRetainedNeighbors', 'projectRustTown', 'rustSettlementRaster'], ['zones', 'zone', 'roles']);
const legacy3d = sourceFunctions(old3d, ['combineV2NativeScenes', 'v2WorldDecor'], ['stageIndex', 'rasters'], { rustSettlementRaster: legacy.rustSettlementRaster });
const square = (x: number, y: number) => ({ outer: [{ x, y }, { x: x + 8, y }, { x: x + 8, y: y + 8 }, { x, y: y + 8 }], holes: [] });
const count = Number(process.env.MAGNA_BENCH_BUILDINGS ?? 5000), shapes = Array.from({ length: count }, (_, i) => square(i % 100 * 15, Math.floor(i / 100) * 15));
const buildings = shapes.map((shape, i) => ({ id: `house-${i}`, parcel_id: `parcel-${i}`, function: 'domestic', ground_z_m: 12, transform: { origin: shape.outer[0], orientation_deg: i % 360 }, recipe_id: 'EUR-MED-B01', footprint: [shape], roof_footprint: [shape], courtyards: [], circulation: [], structural_features: [], volumes: [{ z_m: 12, wall_height_m: 6, roof_height_m: 2, roof_system: 'RF-GABLE', levels: [{}, {}], materials: { infill: 'stone' } }], resolved: { archive_id: 'retained-plans' } }));
const requests = shapes.map((shape, i) => ({ id: `request-${i}`, parcel_id: `parcel-${i}`, cadastral: [shape], neighbors: [] }));
const snapshot = { backend: 'rust-wasm-cpu', stage: 'buildings', layoutKey: 'fixed-native-layout', layouts: [{ key: 'main', culture: 'roman-core', center: { x: 0, y: 0 }, quarters: [{ shape: square(0, 0), phase: 0 }], blocks: [], streets: [], warnings: [] }], partitions: [{ key: 'main', parcels: [], warnings: [] }], requests,
  scene: { schema_version: '1', generator_version: 'architectural-plans-2', buildings, refusals: [], open_spaces: [], materials: [], plan_archives: { 'retained-plans': 'unchanged-native-plan-archive:'.repeat(160000) } }, buildingIds: [], warnings: [] } as unknown as RustTownSnapshot;
const settings: V2Settings = { options: makeOptions({ seed: 'adapter-benchmark' }), extent: 2400, settlementCount: 1, local: {}, generation: 'procedural' };
const n = 512, height = Float32Array.from({ length: n * n }, (_, i) => i % 100), water = new Uint8Array(n * n);
const world = { seed: settings.options.seed, options: settings.options, mapSize: 2400, terrain: { height: { w: n, h: n, cell: 2400 / n, data: height }, filled: height, seaLevel: 0, water, coastline: [], lakes: [], rivers: [] } } as unknown as World;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function median(action: () => unknown, repeats = 9): number {
  action(); const times: number[] = [];
  for (let i = 0; i < repeats; i++) { const start = performance.now(); action(); times.push(performance.now() - start); }
  return +times.sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(4);
}
const result: Record<string, unknown> = { workload: { buildings: count, neighbouringRequests: 32, rasterSamples: n * n, archiveCharacters: snapshot.scene!.plan_archives!['retained-plans'].length }, baselineSourceSha256: digest([oldRust, old3d]), equality: {}, medianMs: {} };
const equality = result.equality as Record<string, unknown>, timings = result.medianMs as Record<string, unknown>;
const beforeProjection = legacy.projectRustTown(snapshot, 5000, 'roman-core'), afterProjection = projectRustTown(snapshot, 5000, 'roman-core');
assert.deepEqual(afterProjection, beforeProjection); equality.projectionSha256 = digest(afterProjection);
const selected = requests.slice(0, 32);
assert.deepEqual(withRetainedNeighbors(selected as never, buildings as never), legacy.withRetainedNeighbors(selected, buildings)); equality.neighbours = true;
assert.deepEqual(cloneRustTownSnapshot(snapshot), structuredClone(snapshot)); equality.snapshotCopy = true;
assert.deepEqual(rustSettlementRaster(world), legacy.rustSettlementRaster(world)); equality.physicalRaster = true;
assert.deepEqual(v2WorldDecor(world, settings), legacy3d.v2WorldDecor(world, settings)); equality.decorMetrics = true;
assert.deepEqual(combineV2NativeScenes([snapshot]), legacy3d.combineV2NativeScenes([snapshot])); equality.nativeSceneUnion = true;
for (const [name, before, after] of [
  ['projection', () => legacy.projectRustTown(snapshot, 5000, 'roman-core'), () => projectRustTown(snapshot, 5000, 'roman-core')],
  ['retainedNeighboursWarm', () => legacy.withRetainedNeighbors(selected, buildings), () => withRetainedNeighbors(selected as never, buildings as never)],
  ['snapshotCopy', () => structuredClone(snapshot), () => cloneRustTownSnapshot(snapshot)],
  ['physicalRasterWarm', () => legacy.rustSettlementRaster(world), () => rustSettlementRaster(world)],
  ['decorWarm', () => legacy3d.v2WorldDecor(world, settings), () => v2WorldDecor(world, settings)],
  ['singleSceneUnion', () => legacy3d.combineV2NativeScenes([snapshot]), () => combineV2NativeScenes([snapshot])],
] as const) {
  const beforeMs = median(before), afterMs = median(after); timings[name] = { before: beforeMs, after: afterMs, speedup: afterMs ? +(beforeMs / afterMs).toFixed(2) : 'below timer resolution' };
}
await writeFile(new URL('urban-kernels.json', out), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
