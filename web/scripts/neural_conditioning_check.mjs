/** CPU-only contract check against the built neural conditioning WASM. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimeUrl = new URL('../../rust/pkg/neural-web/magna_urbis_neural_wasm.js', import.meta.url);
const wasmUrl = new URL('../../rust/pkg/neural-web/magna_urbis_neural_wasm_bg.wasm', import.meta.url);
const runtime = await import(runtimeUrl.href);
await runtime.default({ module_or_path: await readFile(wasmUrl) });

const conditioning = params => JSON.parse(runtime.conditioning_json(JSON.stringify(params), ''));
const regional = conditioning({ extent: 200000, sampleSpacing: 30, resolution: 6667 });
assert.equal(regional.extent, 200000);
assert.equal(regional.nativeResolution, 6667);
assert.equal(regional.resolution, 6667);
assert.equal(regional.size, 64);
assert.equal(regional.origin, 4784);

const sampled = conditioning({ extent: 200000, sampleSpacing: 60, resolution: 3334 });
assert.equal(sampled.extent, 200000);
assert.equal(sampled.nativeResolution, 6667);
assert.equal(sampled.resolution, 3334);
assert.equal(sampled.size, 64);
assert.equal(sampled.origin, 4784);

const finite = conditioning({ extent: 40000, sampleSpacing: 40000 / 1024, resolution: 1024, baseModel: 'residual8k' });
assert.equal(finite.extent, 40000);
assert.equal(finite.origin, 6304);
assert.equal(finite.start, -24);
assert.equal(finite.size, 113);
assert.equal(finite.nativeResolution, 1334);
assert.equal(finite.resolution, 1024);
assert.equal(finite.fields.length, 5 * 113 ** 2);

let rejected = false;
try {
  conditioning({ extent: 200001, sampleSpacing: 30, resolution: 6667 });
} catch (error) {
  rejected = true;
  assert.match(String(error), /extent|200000/i);
}
assert.ok(rejected, 'extent above 200 km must be rejected');

console.log(JSON.stringify({ ok: true, regional: { origin: regional.origin, size: regional.size, nativeResolution: regional.nativeResolution },
  sampled: { resolution: sampled.resolution }, finite: { start: finite.start, size: finite.size, resolution: finite.resolution } }));
