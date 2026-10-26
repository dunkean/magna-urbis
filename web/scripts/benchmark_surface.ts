import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compileSurfaceWorld } from '../src/surface/compiler';
import { encodeSurfaceBinary, decodeSurfaceBinary } from '../src/surface/binary';
import type { SurfaceWorld } from '../src/surface/model';

const args = process.argv.slice(2), at = (key: string, fallback: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const n = Number(at('--size', '1024')), out = resolve(at('--out', 'out/surface/benchmark-1024.json'));
if (!Number.isInteger(n) || n < 8 || n > 2048) throw new Error('Benchmark size must be 8..2048.');
const heights = Float32Array.from({ length: n * n }, (_, i) => 300 + (i % n) * .8 + Math.sin(Math.floor(i / n) / 45) * 60);
const start = performance.now(), memoryStart = process.memoryUsage();
const world = compileSurfaceWorld({ seed: 42, terrain: { width: n, height: n, originX: 0, originZ: 0,
  spacingM: 40000 / n, heights, source: { id: 'performance-probe-not-generated-geography', version: '1', sourceLOD: 0,
    nativeSpacingM: 40000 / n, provenance: 'Explicitly synthetic performance probe; not evidence of Infinite Generation quality' } } });
const compiled = performance.now(), memoryCompiled = process.memoryUsage();
const binary = encodeSurfaceBinary({ format: 'magna-surface-packet', version: 1, world });
const encoded = performance.now(), copy = decodeSurfaceBinary<{ world: SurfaceWorld }>(binary).world;
const decoded = performance.now(), memoryDecoded = process.memoryUsage();
const digest = (node: unknown): string => {
  const hasher = createHash('sha256');
  const walk = (value: unknown): void => {
    if (ArrayBuffer.isView(value)) { hasher.update(value.constructor.name); hasher.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') for (const key of Object.keys(value).sort()) { hasher.update(key); walk((value as Record<string, unknown>)[key]); }
    else hasher.update(JSON.stringify(value) ?? 'undefined');
  };
  walk(node); return hasher.digest('hex');
};
const sourceHash = digest(world), copyHash = digest(copy);
if (sourceHash !== copyHash) throw new Error('Surface binary is not byte-exact');
const report = { fixture: 'synthetic-performance-only', n, samples: n * n,
  compileMs: compiled - start, encodeMs: encoded - compiled, decodeMs: decoded - encoded,
  bytes: binary.byteLength, sourceHash, copyHash, exact: true, versions: copy.versions,
  memory: { start: memoryStart, compiled: memoryCompiled, decoded: memoryDecoded, peakRssBytes: process.resourceUsage().maxRSS * 1024 },
  diagnostics: world.diagnostics };
await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: out, samples: report.samples, bytes: report.bytes, compileMs: report.compileMs,
  encodeMs: report.encodeMs, decodeMs: report.decodeMs, peakRssBytes: report.memory.peakRssBytes, exact: true }));
