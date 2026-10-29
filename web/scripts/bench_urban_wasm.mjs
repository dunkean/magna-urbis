// Node WASM benchmark of the urban pipeline (quarters -> parcels -> building sites), no browser.
// Usage: node web/scripts/bench_urban_wasm.mjs [--pkg rust/pkg/wasm] [--case web/out/perf-baseline/hanseatic-case.json]
//        [--baseline web/out/perf-baseline/hanseatic] [--save <dir>  write layouts/partitions/requests.json, usable as --baseline] [--river-id -1|0] [--culture <name>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; };
const pkg = resolve(root, arg('pkg', 'rust/pkg/wasm'));
const casePath = resolve(root, arg('case', 'web/out/perf-baseline/hanseatic-case.json'));
const baseDir = resolve(root, arg('baseline', 'web/out/perf-baseline/hanseatic'));
const riverFill = Number(arg('river-id', '-1'));
const culture = arg('culture', undefined);
const now = () => performance.now();
const kb = s => (s.length / 1024).toFixed(0) + ' KiB';
const fmt = ms => ms.toFixed(1).padStart(9) + ' ms';

const mod = await import(pathToFileURL(resolve(pkg, 'magna_urbis_wasm.js')).href);
const wasmBytes = readFileSync(resolve(pkg, 'magna_urbis_wasm_bg.wasm'));
await mod.default({ module_or_path: wasmBytes });
const { SettlementTerrain } = mod;

const c = JSON.parse(readFileSync(casePath, 'utf8'));
const cells = c.n * c.n;
const t0 = now();
const terrain = new SettlementTerrain(c.width, c.n, Float32Array.from(c.height), Uint8Array.from(c.water),
  Float32Array.from(c.waterLevel), new Float32Array(cells), new Int32Array(cells).fill(riverFill));
const tNew = now() - t0;
const t1 = now();
terrain.set_urban_geometry(JSON.stringify(c.geometry));
const tGeo = now() - t1;

const timings = {};
const time = (name, f) => { const s = now(); const r = f(); timings[name] = (timings[name] ?? 0) + now() - s; return r; };

// quarters
const qIn = time('json.stringify', () => [JSON.stringify(c.sites ?? []), JSON.stringify(c.layoutConfig), JSON.stringify(c.roads ?? [])]);
const qOutStr = time('wasm.quarters', () => terrain.urban_quarters(c.seed, qIn[0], qIn[1], qIn[2]));
const layouts = time('json.parse', () => JSON.parse(qOutStr));
const layoutsJson = time('json.stringify', () => JSON.stringify(layouts));

// parcels
let parcelConfig = c.parcelConfig;
if (!parcelConfig) {
  // Same default the UI sends: taken from the native baseline partitions' config.
  const base = JSON.parse(readFileSync(resolve(baseDir, 'partitions.json'), 'utf8'));
  parcelConfig = base[0]?.config ?? {};
}
const pCfg = time('json.stringify', () => JSON.stringify(parcelConfig));
const pOutStr = time('wasm.parcels', () => terrain.urban_parcels(c.seed, layoutsJson, pCfg));
const partitions = time('json.parse', () => JSON.parse(pOutStr));
const partitionsJson = time('json.stringify', () => JSON.stringify(partitions));

// building sites
const sOutStr = time('wasm.sites', () => terrain.urban_building_sites(c.seed, layoutsJson, partitionsJson, culture));
const requests = time('json.parse', () => JSON.parse(sOutStr));

console.log(`terrain new ${fmt(tNew)}   set_urban_geometry ${fmt(tGeo)}`);
for (const k of ['wasm.quarters', 'wasm.parcels', 'wasm.sites']) console.log(`${k.padEnd(16)}${fmt(timings[k])}`);
console.log(`${'json.stringify'.padEnd(16)}${fmt(timings['json.stringify'])}   (inputs to wasm)`);
console.log(`${'json.parse'.padEnd(16)}${fmt(timings['json.parse'])}   (outputs from wasm)`);
console.log(`total wasm calls ${fmt(timings['wasm.quarters'] + timings['wasm.parcels'] + timings['wasm.sites'])}`);
console.log(`sizes: layouts ${kb(qOutStr)}, partitions ${kb(pOutStr)}, requests ${kb(sOutStr)}`);
console.log(`counts: layouts ${layouts.length}, partitions ${partitions.length}, requests ${requests.length}`);

// Equivalence against the native baseline (canonical: sorted keys, numbers via shortest repr).
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
function diff(a, b, path, out, tol) {
  if (out.count > 1e7) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return;
    out.count++; if (Math.abs(a - b) > tol * Math.max(1, Math.abs(a), Math.abs(b))) out.big++; else out.small++;
    if (out.examples.length < 3 && Math.abs(a - b) > tol) out.examples.push(`${path}: ${a} vs ${b}`);
    return;
  }
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.count++; out.big++; if (out.examples.length < 3) out.examples.push(`${path}: length ${a.length} vs ${b.length}`); }
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], path + '/' + i, out, tol);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], path + '/' + k, out, tol);
    return;
  }
  out.count++; out.big++; if (out.examples.length < 3) out.examples.push(`${path}: ${JSON.stringify(a)?.slice(0, 40)} vs ${JSON.stringify(b)?.slice(0, 40)}`);
}
console.log('equivalence vs native baseline:');
for (const [name, got] of [['layouts', layouts], ['partitions', partitions], ['requests', requests]]) {
  let want;
  try { want = JSON.parse(readFileSync(resolve(baseDir, name + '.json'), 'utf8')); } catch { console.log(`  ${name}: baseline missing`); continue; }
  const exact = JSON.stringify(canon(got)) === JSON.stringify(canon(want));
  const out = { count: 0, big: 0, small: 0, examples: [] };
  if (!exact) diff(got, want, '', out, 1e-9);
  console.log(`  ${name}: ${exact ? 'IDENTICAL' : `DIFF ${out.count} values (${out.big} beyond 1e-9 rel, ${out.small} within)`}`);
  for (const e of out.examples) console.log('     ' + e);
}
const save = arg('save', undefined);
if (save) {
  mkdirSync(resolve(save), { recursive: true });
  writeFileSync(resolve(save, 'layouts.json'), qOutStr); writeFileSync(resolve(save, 'partitions.json'), pOutStr); writeFileSync(resolve(save, 'requests.json'), sOutStr);
  console.log('saved outputs to ' + resolve(save));
}
terrain.free();
