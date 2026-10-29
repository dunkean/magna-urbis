// Native-server benchmark of the urban pipeline (same case as bench_urban_wasm.mjs): binary raster
// upload once, then quarters -> parcels (layoutsId) -> building sites (retained urbanSource) -> display
// buffers (binary), all products resident in the server session. Start your own server first, never
// the user's :8791 engine:  rust/target/release/magna-urbis-local.exe --port 8795
// Usage: node web/scripts/bench_urban_native.mjs [--server http://127.0.0.1:8795] [--case ...] [--baseline <saved dir>]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; };
const server = arg('server', 'http://127.0.0.1:8795').replace(/\/$/, '');
if (/:8791$/.test(server)) throw new Error('Refusing the user engine on :8791: start your own server on another port.');
const c = JSON.parse(readFileSync(resolve(root, arg('case', 'web/out/perf-baseline/hanseatic-case.json')), 'utf8'));
const baseDir = resolve(root, arg('baseline', 'web/out/perf-baseline/hanseatic'));
const parcelConfig = JSON.parse(readFileSync(join(baseDir, 'partitions.json'), 'utf8'))[0]?.config ?? {};
const session = randomUUID(), cells = c.n * c.n;
const post = async (path, body, type = 'application/json') => {
  const response = await fetch(server + path, { method: 'POST', headers: { 'Content-Type': type }, body });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  return response;
};
const rows = [];
const step = async (name, run) => {
  const start = performance.now(); const out = await run(); const wall = performance.now() - start;
  rows.push([name, wall, out.serverMs, out.bytes, out.decodeMs]);
  return out.value;
};
const json = async (path, input) => {
  const response = await post(path, JSON.stringify({ session, ...input }));
  const text = await response.text();
  const start = performance.now(); const value = JSON.parse(text); const decodeMs = performance.now() - start;
  if (value.error) throw new Error(value.error);
  return { value, text, serverMs: value.ms, bytes: text.length, decodeMs };
};
const texts = {};
await step('raster upload', async () => {
  const header = new TextEncoder().encode(JSON.stringify({ session, width: c.width, n: c.n, geometry: c.geometry }));
  const padded = new Uint8Array(Math.ceil(header.length / 4) * 4).fill(32); padded.set(header);
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, padded.length, true);
  const bytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const body = new Blob([length, padded, bytes(Float32Array.from(c.height)), bytes(Float32Array.from(c.waterLevel)),
    bytes(new Float32Array(cells)), bytes(new Int32Array(cells).fill(-1)), bytes(Uint8Array.from(c.water))]);
  await post('/raster', body, 'application/octet-stream');
  return { bytes: body.size };
});
const quarters = await step('quarters', async () => {
  const out = await json('/urban', { id: 1, kind: 'quarters', seed: c.seed, sites: c.sites ?? [], roads: c.roads ?? [], layoutConfig: c.layoutConfig });
  texts.layouts = JSON.stringify(out.value.layouts); return out;
});
const parcels = await step('parcels (layoutsId)', async () => {
  const out = await json('/urban', { id: 2, kind: 'parcels', seed: c.seed, layoutsId: 1, parcelConfig });
  texts.partitions = JSON.stringify(out.value.partitions); return out;
});
await step('building sites (source)', async () => {
  const out = await json('/urban', { id: 3, kind: 'buildingSites', seed: c.seed, source: parcels.urbanSource });
  texts.requests = JSON.stringify(out.value.placementRequests); return out;
});
await step('display buffers (binary)', async () => {
  const response = await post('/urban', JSON.stringify({ session, kind: 'displayBuffers', source: parcels.urbanSource }));
  const buffer = await response.arrayBuffer();
  return { bytes: buffer.byteLength, value: buffer };
});
await fetch(server + '/release', { method: 'POST', body: JSON.stringify({ session }) }).catch(() => undefined);
console.log(`native ${server}: layouts ${quarters.layouts.length}`);
console.log('step'.padEnd(26) + 'wall ms'.padStart(10) + 'server ms'.padStart(11) + 'KiB'.padStart(9) + 'JSON.parse ms'.padStart(15));
for (const [name, wall, ms, bytes, decode] of rows)
  console.log(name.padEnd(26) + wall.toFixed(1).padStart(10) + (ms === undefined ? '' : ms.toFixed(1)).padStart(11)
    + (bytes === undefined ? '' : (bytes / 1024).toFixed(0)).padStart(9) + (decode === undefined ? '' : decode.toFixed(1)).padStart(15));
const boundary = rows.reduce((n, [, wall, ms]) => n + (ms === undefined ? 0 : wall - ms), 0);
console.log(`boundary (wall - server compute, JSON steps): ${boundary.toFixed(1)} ms; total wall ${rows.reduce((n, r) => n + r[1], 0).toFixed(1)} ms`);
// Values (not key order: older servers sorted keys through serde_json::Value) against a saved run.
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
for (const name of ['layouts', 'partitions', 'requests']) {
  const file = join(baseDir, name + '.json');
  if (!existsSync(file)) continue;
  const same = JSON.stringify(canon(JSON.parse(texts[name]))) === JSON.stringify(canon(JSON.parse(readFileSync(file, 'utf8'))));
  console.log(`  ${name}: ${same ? 'IDENTICAL values' : 'DIFF'} vs ${baseDir}`);
}
const save = arg('save', undefined);
if (save) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(save, { recursive: true });
  for (const name of ['layouts', 'partitions', 'requests']) writeFileSync(join(save, name + '.json'), texts[name]);
  console.log('saved outputs to ' + save);
}
