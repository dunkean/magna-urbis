// Browser WASM benchmark of the urban pipeline (same steps as bench_urban_wasm.mjs) in headless
// Chromium: cross-origin-isolated page, module worker, wasm-bindgen-rayon pool for pkg/wasm-threads.
// Compares the outputs byte-for-byte with a run saved by `bench_urban_wasm.mjs --save <dir>`.
// Usage: node web/scripts/bench_urban_wasm_browser.mjs [--pkg rust/pkg/wasm-threads] [--threads 8 (0: none)]
//        [--case web/out/perf-baseline/hanseatic-case.json] [--baseline <saved dir>] [--chrome <executable>]
//        [--resident  products stay in WASM, stages pass ids (rust/crates/wasm/src/resident.rs)]
//        [--pool N    building sites over N single-thread instances of --pkg (use rust/pkg/wasm), like ?threads=pool:
//                     JSON mode re-sends layouts/partitions JSON per batch and every range re-parses them;
//                     resident mode sends one binary image per helper, decoded once]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : fallback; };
const pkg = resolve(root, arg('pkg', 'rust/pkg/wasm-threads'));
const threads = Number(arg('threads', '8'));
const pool = Number(arg('pool', '0'));
const resident = process.argv.includes('--resident');
const casePath = resolve(root, arg('case', 'web/out/perf-baseline/hanseatic-case.json'));
const baseDir = resolve(root, arg('baseline', 'web/out/perf-baseline/hanseatic'));
// Playwright's own Chromium, else an installed headless shell of another Playwright version.
let executablePath = arg('chrome', undefined);
if (!executablePath && !existsSync(chromium.executablePath())) {
  const store = join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'ms-playwright');
  const shell = existsSync(store) && readdirSync(store).filter(d => d.startsWith('chromium_headless_shell-')).sort().pop();
  if (shell) executablePath = join(store, shell, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
}

const page = `<!doctype html><meta charset="utf-8"><script type="module">
  const worker = new Worker('./bench-worker.js', { type: 'module' });
  worker.onmessage = e => { window.benchResult = e.data; };
  worker.onerror = e => { window.benchResult = { error: String(e.message ?? e) }; };
</script>`;
// One pool helper: its own single-thread instance and terrain (rust/bridge/urbanPoolWorker.ts).
// The handler is registered synchronously: messages posted during a top-level await are dropped.
const helper = `const loading = import('/pkg/magna_urbis_wasm.js');
let mod, terrain, shared, lid = 0, pid = 0;
onmessage = async e => {
  const m = e.data;
  if (m.init) {
    mod = await loading;
    await mod.default({ module_or_path: m.module });
    const r = m.raster;
    terrain = new mod.SettlementTerrain(r.width, r.n, r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds);
    terrain.set_urban_geometry(r.geometry);
    postMessage({ ready: true }); return;
  }
  if (m.shared) { shared = m.shared; if (shared.image) { lid = terrain.import_resident(shared.image); pid = terrain.resident_partitions_id(); } }
  try {
    postMessage({ json: shared.image ? terrain.urban_building_sites_resident(shared.seed, lid, pid, undefined, m.start, m.end)
      : terrain.urban_building_sites_range(shared.seed, shared.layouts, shared.partitions, undefined, m.start, m.end) });
  } catch (error) { postMessage({ error: String(error) }); }
};`;
const worker = `try {
  const mod = await import('/pkg/magna_urbis_wasm.js');
  const bytes = await (await fetch('/pkg/magna_urbis_wasm_bg.wasm')).arrayBuffer();
  await mod.default({ module_or_path: bytes });
  const rayon = mod.initThreadPool && ${threads} > 0 ? ${threads} : 0;
  if (rayon) await mod.initThreadPool(rayon);
  const resident = ${resident}, poolSize = ${pool};
  const c = await (await fetch('/case.json')).json();
  const parcelConfig = await (await fetch('/parcel-config.json')).text();
  const cells = c.n * c.n;
  const raster = { width: c.width, n: c.n, height: Float32Array.from(c.height), water: Uint8Array.from(c.water),
    waterLevel: Float32Array.from(c.waterLevel), riverWidth: new Float32Array(cells), riverIds: new Int32Array(cells).fill(-1), geometry: JSON.stringify(c.geometry) };
  const terrain = new mod.SettlementTerrain(raster.width, raster.n, raster.height, raster.water, raster.waterLevel, raster.riverWidth, raster.riverIds);
  terrain.set_urban_geometry(raster.geometry);
  // Helpers are ready before timing starts, as a pool created with the engine.
  const helpers = [];
  if (poolSize > 1) {
    const module = await WebAssembly.compile(bytes);
    for (let i = 0; i < poolSize - 1; i++) {
      const w = new Worker('/pool-helper.js', { type: 'module' });
      await new Promise(ok => { w.onmessage = ok; w.postMessage({ init: true, module, raster }); });
      helpers.push(w);
    }
  }
  const timings = {};
  const time = (name, f) => { const s = performance.now(); const r = f(); timings[name] = (timings[name] ?? 0) + performance.now() - s; return r; };
  const config = JSON.stringify(c.layoutConfig), sites = JSON.stringify(c.sites ?? []), roads = JSON.stringify(c.roads ?? []);
  let layouts, partitions, layoutsJson, partitionsJson, lid = 0, pid = 0;
  const t0 = performance.now();
  if (resident) {
    layouts = time('wasm.quarters', () => terrain.urban_quarters_resident(c.seed, sites, config, roads));
    time('json.parse', () => JSON.parse(layouts)); lid = terrain.resident_layouts_id();
    partitions = time('wasm.parcels', () => terrain.urban_parcels_resident(c.seed, lid, parcelConfig, 0, 0xffffffff));
    time('json.parse', () => JSON.parse(partitions)); pid = terrain.resident_partitions_id();
  } else {
    layouts = time('wasm.quarters', () => terrain.urban_quarters(c.seed, sites, config, roads));
    layoutsJson = time('json.stringify', () => JSON.stringify(time('json.parse', () => JSON.parse(layouts))));
    partitions = time('wasm.parcels', () => terrain.urban_parcels(c.seed, layoutsJson, parcelConfig));
    partitionsJson = time('json.stringify', () => JSON.stringify(time('json.parse', () => JSON.parse(partitions))));
  }
  const range = (a, b) => resident ? terrain.urban_building_sites_resident(c.seed, lid, pid, undefined, a, b)
    : terrain.urban_building_sites_range(c.seed, layoutsJson, partitionsJson, undefined, a, b);
  let requests;
  const s = performance.now();
  if (helpers.length) {
    const total = resident ? terrain.urban_building_sites_total_resident(lid, pid) : mod.SettlementTerrain.urban_building_sites_total(layoutsJson, partitionsJson);
    const parts = Math.min(Math.ceil(total / 16), poolSize * 4);
    const jobs = Array.from({ length: parts }, (_, k) => [Math.floor(total * k / parts), Math.floor(total * (k + 1) / parts)]);
    const shared = resident ? { seed: c.seed, image: time('resident.export', () => terrain.export_resident(lid, pid)) } : { seed: c.seed, layouts: layoutsJson, partitions: partitionsJson };
    const results = new Array(jobs.length);
    let next = 0, done = 0;
    await new Promise(finish => {
      const settle = () => { if (done === jobs.length) finish(); };
      const give = (w, first) => {
        if (next >= jobs.length) return;
        const i = next++;
        w.onmessage = e => { results[i] = e.data.json ?? range(...jobs[i]); done++; give(w); settle(); };
        w.postMessage({ start: jobs[i][0], end: jobs[i][1], ...(first ? { shared } : {}) });
      };
      for (const w of helpers) give(w, true);
      const step = () => { if (next < jobs.length) { const i = next++; results[i] = range(...jobs[i]); done++; setTimeout(step, 0); } settle(); };
      step();
    });
    requests = '[' + results.map(r => r.slice(1, -1)).filter(r => r.length).join(',') + ']';
  } else requests = resident ? terrain.urban_building_sites_resident(c.seed, lid, pid, undefined, 0, 0xffffffff)
    : terrain.urban_building_sites(c.seed, layoutsJson, partitionsJson, undefined);
  timings['wasm.sites'] = performance.now() - s;
  time('json.parse', () => JSON.parse(requests));
  timings.total = performance.now() - t0;
  for (const w of helpers) w.terminate();
  postMessage({ timings, isolated: crossOriginIsolated, rayon, pool: helpers.length + (helpers.length ? 1 : 0), out: { layouts, partitions, requests } });
} catch (error) { postMessage({ error: String(error?.stack ?? error) }); }`;

let parcelConfig = '{}';
try { parcelConfig = JSON.stringify(JSON.parse(readFileSync(join(baseDir, 'partitions.json'), 'utf8'))[0]?.config ?? {}); } catch { /* no baseline */ }
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (body, type) => {
    res.writeHead(200, { 'Content-Type': type, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.end(body);
  };
  if (path === '/' || path === '/index.html') return send(page, 'text/html');
  if (path === '/bench-worker.js') return send(worker, 'text/javascript');
  if (path === '/pool-helper.js') return send(helper, 'text/javascript');
  if (path === '/case.json') return send(readFileSync(casePath), 'application/json');
  if (path === '/parcel-config.json') return send(parcelConfig, 'application/json');
  if (path.startsWith('/pkg/')) {
    let file = resolve(pkg, '.' + path.slice(4));
    if (relative(pkg, file).startsWith('..')) { res.writeHead(403); res.end(); return; }
    // wasm-bindgen-rayon imports its package as a directory ('../../..'), as bundlers resolve it.
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'magna_urbis_wasm.js');
    if (existsSync(file) && statSync(file).isFile()) return send(readFileSync(file), types[extname(file)] ?? 'application/octet-stream');
  }
  res.writeHead(404); res.end();
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const tab = await browser.newPage();
  tab.on('pageerror', e => console.log('[pageerror]', e.message));
  await tab.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await tab.waitForFunction(() => window.benchResult, null, { timeout: 900000, polling: 250 }).then(h => h.jsonValue());
  if (result.error) throw new Error(result.error);
  console.log(`${relative(root, pkg)}: crossOriginIsolated=${result.isolated}, rayon pool ${result.rayon || 'none'}, worker pool ${result.pool || 'none'}, mode ${resident ? 'resident' : 'json'}`);
  const t = result.timings;
  for (const [k, v] of Object.entries(t)) console.log(`${k.padEnd(16)}${v.toFixed(1).padStart(9)} ms`);
  console.log(`total wasm calls ${(t['wasm.quarters'] + t['wasm.parcels'] + t['wasm.sites']).toFixed(1).padStart(9)} ms`);
  console.log('equivalence vs saved run:');
  for (const name of ['layouts', 'partitions', 'requests']) {
    const file = join(baseDir, name + '.json');
    if (!existsSync(file)) { console.log(`  ${name}: baseline missing`); continue; }
    const want = readFileSync(file, 'utf8');
    console.log(`  ${name}: ${result.out[name] === want ? 'IDENTICAL' : `DIFF (${result.out[name].length} vs ${want.length} chars)`}`);
  }
} finally { await browser.close(); server.close(); }
