// Browser WASM benchmark of the urban pipeline (same steps as bench_urban_wasm.mjs) in headless
// Chromium: cross-origin-isolated page, module worker, wasm-bindgen-rayon pool for pkg/wasm-threads.
// Compares the outputs byte-for-byte with a run saved by `bench_urban_wasm.mjs --save <dir>`.
// Usage: node web/scripts/bench_urban_wasm_browser.mjs [--pkg rust/pkg/wasm-threads] [--threads 8 (0: none)]
//        [--case web/out/perf-baseline/hanseatic-case.json] [--baseline <saved dir>] [--chrome <executable>]
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
const worker = `try {
  const mod = await import('/pkg/magna_urbis_wasm.js');
  await mod.default({ module_or_path: await (await fetch('/pkg/magna_urbis_wasm_bg.wasm')).arrayBuffer() });
  const pool = mod.initThreadPool && ${threads} > 0 ? ${threads} : 0;
  if (pool) await mod.initThreadPool(pool);
  const c = await (await fetch('/case.json')).json();
  const parcelConfig = await (await fetch('/parcel-config.json')).text();
  const cells = c.n * c.n;
  const terrain = new mod.SettlementTerrain(c.width, c.n, Float32Array.from(c.height), Uint8Array.from(c.water),
    Float32Array.from(c.waterLevel), new Float32Array(cells), new Int32Array(cells).fill(-1));
  terrain.set_urban_geometry(JSON.stringify(c.geometry));
  const timings = {};
  const time = (name, f) => { const s = performance.now(); const r = f(); timings[name] = performance.now() - s; return r; };
  const layouts = time('wasm.quarters', () => terrain.urban_quarters(c.seed, JSON.stringify(c.sites ?? []), JSON.stringify(c.layoutConfig), JSON.stringify(c.roads ?? [])));
  const layoutsJson = JSON.stringify(JSON.parse(layouts));
  const partitions = time('wasm.parcels', () => terrain.urban_parcels(c.seed, layoutsJson, parcelConfig));
  const partitionsJson = JSON.stringify(JSON.parse(partitions));
  const requests = time('wasm.sites', () => terrain.urban_building_sites(c.seed, layoutsJson, partitionsJson, undefined));
  postMessage({ timings, isolated: crossOriginIsolated, pool, out: { layouts, partitions, requests } });
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
  console.log(`${relative(root, pkg)}: crossOriginIsolated=${result.isolated}, rayon pool ${result.pool || 'none'}`);
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
