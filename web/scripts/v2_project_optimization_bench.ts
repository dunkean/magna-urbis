/** Run with node --expose-gc --import tsx scripts/v2_project_optimization_bench.ts before|after. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serializeProject, serializeProjectChunks, parseProject, validateSettings, validateWorld } from '../src/v2/project';
import { defaultSettings } from '../src/v2/settings';
import { TerrainCache, type TerrainStore } from '../src/v2/cache';
import type { World, TerrainLayer } from '../src/gen/types';
const mode = process.argv[2] ?? 'after';
const output = new URL('../out/v2-project-optimization/', import.meta.url); await mkdir(output, { recursive: true });
function fixture(n: number) {
  const settings = defaultSettings(); settings.options.seed = 'project-memory-stable'; settings.extent = 40000;
  settings.terrain = { sketch: { version: 1, resolution: 128, processing: 'surface', heights: Array.from({ length: 128 ** 2 }, (_, i) => 10 + (i % 127) / 7) } };
  const length = n * n, cell = 40000 / n;
  const height = Float32Array.from({ length }, (_, i) => 20 + (i % 4096) / 7), slope = Float32Array.from({ length }, (_, i) => (i % 32) / 320);
  const terrain: TerrainLayer = { height: { w: n, h: n, cell, data: height }, slope: { w: n, h: n, cell, data: slope }, flow: { w: n, h: n, cell, data: new Float32Array(length) }, water: new Uint8Array(length), receiver: new Int32Array(length).fill(-1), filled: height.slice(), coastline: [], rivers: [], lakes: [], downSide: 'S', seaSide: null, seaLevel: 0, seaFraction: 0 };
  const world: World = { seed: settings.options.seed, options: settings.options, mapSize: 40000, terrain, stats: { backend: 'benchmark-fixture' } };
  return { settings, world };
}
function measure<T>(operation: () => T) {
  global.gc?.(); const before = process.memoryUsage(), start = performance.now(); const value = operation();
  const ms = performance.now() - start, after = process.memoryUsage();
  return { value, ms, heapDeltaMB: (after.heapUsed - before.heapUsed) / 1048576, arrayBufferDeltaMB: (after.arrayBuffers - before.arrayBuffers) / 1048576, rssDeltaMB: (after.rss - before.rss) / 1048576 };
}
const samples = [];
for (const n of [256, 512, 1024]) {
  const { settings, world } = fixture(n);
  const validation = measure(() => { for (let i = 0; i < 5; i++) { validateSettings(settings); validateWorld(world); } });
  const serialized = measure(() => serializeProject(settings, world));
  const text = serialized.value;
  const parsed = measure(() => parseProject(text));
  const payloadHash = createHash('sha256').update(text).digest('hex');
  const restoredHash = createHash('sha256').update(Buffer.from(parsed.value.world!.terrain.height.data.buffer)).digest('hex');
  const discard = ({ value: _value, ...metrics }: ReturnType<typeof measure>) => metrics;
  samples.push({ n, payloadBytes: Buffer.byteLength(text), payloadHash, restoredHash, validation5: discard(validation), serialize: discard(serialized), parse: discard(parsed) });
  console.log(JSON.stringify(samples.at(-1)));
}
await writeFile(new URL(`${mode}.json`, output), JSON.stringify({ mode, node: process.version, samples }, null, 2));
if (mode === 'after') {
  const { settings, world } = fixture(1024);
  const project = { format: 'magna-urbis-v2', version: 1, engine: (await import('../src/v2/cache')).V2_ENGINE_VERSION, settings, world, mods: [] };
  const legacy = measure(() => { validateSettings(settings); validateWorld(world); return new Blob([JSON.stringify(project, (_key, child) => ArrayBuffer.isView(child) && !(child instanceof DataView) ? { $mu: child.constructor.name, data: Array.from(child as Float32Array) } : typeof child === 'number' && !Number.isFinite(child) ? { $mu: 'number', value: String(child) } : child)]); });
  const optimized = measure(() => new Blob(serializeProjectChunks(settings, world)));
  const metrics = ({ value, ...rest }: ReturnType<typeof measure<Blob>>) => ({ bytes: value.size, ...rest });
  const result = { legacy: metrics(legacy), optimized: metrics(optimized) };
  if (result.legacy.bytes !== result.optimized.bytes) throw new Error('Blob output size changed');
  await writeFile(new URL('blob-export.json', output), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ blob: result }));
}
