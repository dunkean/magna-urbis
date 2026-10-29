// Node WASM benchmark of the urban pipeline (quarters -> parcels -> building sites), no browser.
// Usage: node web/scripts/bench_urban_wasm.mjs [--pkg rust/pkg/wasm] [--case web/out/perf-baseline/hanseatic-case.json]
//        [--pool N  building sites over N single-thread workers, like ?threads=pool]
//        pkg/wasm-threads needs a browser (Node cannot send a shared WebAssembly.Memory to
//        worker_threads): node web/scripts/bench_urban_wasm_browser.mjs --pkg rust/pkg/wasm-threads
//        [--baseline web/out/perf-baseline/hanseatic] [--save <dir>  write layouts/partitions/requests.json, usable as --baseline] [--river-id -1|0] [--culture <name>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

if (existsSync(resolve(pkg, 'snippets'))) throw new Error('Threads package: use web/scripts/bench_urban_wasm_browser.mjs (Node cannot share WebAssembly.Memory with workers).');
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

// --resident: products stay in the WASM instance (rust/crates/wasm/src/resident.rs);
// stages pass ids, pool helpers import one binary image per batch. Otherwise the
// JSON path: every stage re-sends layouts/partitions as JSON text.
const residentMode = process.argv.includes('--resident');
let parcelConfig = c.parcelConfig;
if (!parcelConfig) {
  // Same default the UI sends: taken from the native baseline partitions' config.
  const base = JSON.parse(readFileSync(resolve(baseDir, 'partitions.json'), 'utf8'));
  parcelConfig = base[0]?.config ?? {};
}
let qOutStr, pOutStr, layouts, partitions, layoutsJson, partitionsJson, lid = 0, pid = 0;
// quarters
const qIn = time('json.stringify', () => [JSON.stringify(c.sites ?? []), JSON.stringify(c.layoutConfig), JSON.stringify(c.roads ?? [])]);
const pCfg = time('json.stringify', () => JSON.stringify(parcelConfig));
if (residentMode) {
  qOutStr = time('wasm.quarters', () => terrain.urban_quarters_resident(c.seed, qIn[0], qIn[1], qIn[2]));
  layouts = time('json.parse', () => JSON.parse(qOutStr));
  lid = terrain.resident_layouts_id();
  pOutStr = time('wasm.parcels', () => terrain.urban_parcels_resident(c.seed, lid, pCfg, 0, 0xffffffff));
  partitions = time('json.parse', () => JSON.parse(pOutStr));
  pid = terrain.resident_partitions_id();
} else {
  qOutStr = time('wasm.quarters', () => terrain.urban_quarters(c.seed, qIn[0], qIn[1], qIn[2]));
  layouts = time('json.parse', () => JSON.parse(qOutStr));
  layoutsJson = time('json.stringify', () => JSON.stringify(layouts));
  pOutStr = time('wasm.parcels', () => terrain.urban_parcels(c.seed, layoutsJson, pCfg));
  partitions = time('json.parse', () => JSON.parse(pOutStr));
  partitionsJson = time('json.stringify', () => JSON.stringify(partitions));
}
const sitesRange = (start, end) => residentMode
  ? terrain.urban_building_sites_resident(c.seed, lid, pid, culture, start, end)
  : terrain.urban_building_sites_range(c.seed, layoutsJson, partitionsJson, culture, start, end);

// building sites (--pool N: N-1 single-thread workers plus this thread share
// contiguous site ranges, merged in order, like rust/bridge/urbanPool.ts)
const poolSize = Number(arg('pool', '0'));
let sOutStr;
if (poolSize > 1) {
  const { Worker } = await import('node:worker_threads');
  const helpers = await Promise.all(Array.from({ length: poolSize - 1 }, () => new Promise(ok => {
    const w = new Worker(new URL('./bench_urban_pool_worker.mjs', import.meta.url), { workerData: { pkg, casePath, riverFill } });
    w.once('message', () => ok(w));
  })));
  const s = now();
  const total = residentMode ? terrain.urban_building_sites_total_resident(lid, pid) : SettlementTerrain.urban_building_sites_total(layoutsJson, partitionsJson);
  const parts = Math.min(Math.ceil(total / 16), poolSize * 4);
  const jobs = Array.from({ length: parts }, (_, k) => [Math.floor(total * k / parts), Math.floor(total * (k + 1) / parts)]);
  const results = new Array(jobs.length);
  let next = 0, done = 0, id = 0;
  const shared = residentMode ? { seed: c.seed, culture, image: time('resident.export', () => terrain.export_resident(lid, pid)) }
    : { seed: c.seed, layouts: layoutsJson, partitions: partitionsJson, culture };
  await new Promise(finish => {
    const settle = () => { if (done === jobs.length) finish(); };
    const give = (w, first) => {
      if (next >= jobs.length) return;
      const i = next++, [start, end] = jobs[i];
      w.once('message', m => { results[i] = m.json ?? sitesRange(start, end); done++; give(w); settle(); });
      w.postMessage({ id: id++, start, end, ...(first ? { shared } : {}) });
    };
    for (const w of helpers) give(w, true);
    const step = () => { if (next < jobs.length) { const i = next++; results[i] = sitesRange(...jobs[i]); done++; setImmediate(step); } settle(); };
    step();
  });
  sOutStr = '[' + results.map(r => r.slice(1, -1)).filter(r => r.length).join(',') + ']';
  timings['wasm.sites'] = now() - s;
  console.log(`pool: ${poolSize} participants, ${jobs.length} site ranges${residentMode ? `, binary image ${kb({ length: shared.image.byteLength })}` : ''}`);
  for (const w of helpers) void w.terminate();
} else sOutStr = time('wasm.sites', () => residentMode ? terrain.urban_building_sites_resident(c.seed, lid, pid, culture, 0, 0xffffffff)
  : terrain.urban_building_sites(c.seed, layoutsJson, partitionsJson, culture));
const requests = time('json.parse', () => JSON.parse(sOutStr));
console.log(`mode: ${residentMode ? 'resident (ids, binary pool image)' : 'json (re-sent per stage)'}`);
if (timings['resident.export']) console.log(`${'resident.export'.padEnd(16)}${fmt(timings['resident.export'])}`);

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
console.log(`equivalence vs ${baseDir}:`);
for (const [name, got] of [['layouts', layouts], ['partitions', partitions], ['requests', requests]]) {
  let want;
  try { want = JSON.parse(readFileSync(resolve(baseDir, name + '.json'), 'utf8')); } catch { console.log(`  ${name}: baseline missing`); continue; }
  const exact = JSON.stringify(canon(got)) === JSON.stringify(canon(want));
  const out = { count: 0, big: 0, small: 0, examples: [] };
  if (!exact) diff(got, want, '', out, 1e-9);
  const text = { layouts: qOutStr, partitions: pOutStr, requests: sOutStr }[name];
  const bytes = text === readFileSync(resolve(baseDir, name + ".json"), "utf8");
  console.log(`  ${name}: ${exact ? "IDENTICAL" : `DIFF ${out.count} values (${out.big} beyond 1e-9 rel, ${out.small} within)`}${bytes ? " (byte-identical JSON text)" : ""}`);
  for (const e of out.examples) console.log('     ' + e);
}
const save = arg('save', undefined);
if (save) {
  mkdirSync(resolve(save), { recursive: true });
  writeFileSync(resolve(save, 'layouts.json'), qOutStr); writeFileSync(resolve(save, 'partitions.json'), pOutStr); writeFileSync(resolve(save, 'requests.json'), sOutStr);
  console.log('saved outputs to ' + resolve(save));
}
terrain.free();
