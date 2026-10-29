// Execution matrix of the Rust bench shell (web/src/ui/rustbench.html).
// From web/: node scripts/bench_matrix.mjs [--only <substring of combo id>] [--full] [--no-v2] [--v2-only]
//   [--server http://127.0.0.1:8791] [--python http://127.0.0.1:8793] [--width 3000] [--seed bench-matrix] [--timeout 300]
// For each valid combination of profile (web: WASM+WebGPU in the browser | rust: native engine profile=local |
// python: native engine + neural-python relief) x terrain generation (cpu|gpu|gpu-all|gpu-erosion|native) x
// render (gpu|cpu) x threads (auto|on|off|pool, web only) it opens the shell on that execution, then runs the chain
// terrain -> settlements + roads -> city (quarters, parcels, buildings) through the real UI, and records the
// per-stage milliseconds the code reports (window.magnaBenchTimings, src/ui/benchTimings.ts), the chosen modes
// (window.magnaWasmThreads, window.magnaRenderStats), errors and a screenshot.
// Output: web/out/bench-matrix/report.json, report.html, <combo>.png, v2/*.png (V2 default-flow screenshots).
// It starts its own Vite servers (COOP/COEP headers, so WASM threads work), never touches :8791 other than
// as a client, and runs one page at a time. Default matrix is the useful subset; --full adds gpu, gpu-all and pool.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
const freePort = () => new Promise(ok => { const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

const web = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const engine = option('server', 'http://127.0.0.1:8791'), pythonServer = option('python', 'http://127.0.0.1:8793');
const only = option('only', ''), full = args.includes('--full'), seed = option('seed', 'bench-matrix'), width = option('width', '3000');
const limit = Number(option('timeout', '300')) * 1000;
const out = resolve(web, 'out/bench-matrix'); mkdirSync(resolve(out, 'v2'), { recursive: true });
const channel = process.env.MAGNA_BROWSER_CHANNEL ?? 'chrome';

const reachable = async url => { try { return (await fetch(`${url}/status`, { signal: AbortSignal.timeout(4000) })).ok; } catch { return false; } };
const engineUp = await reachable(engine), pythonUp = await reachable(pythonServer);

/** The valid combinations. Native generation is always multithread (threads n/a); python only changes the relief source. */
function combinations() {
  const rows = [];
  const generations = full ? ['cpu', 'gpu', 'gpu-all', 'gpu-erosion'] : ['cpu', 'gpu-erosion'];
  const threads = full ? ['on', 'off', 'pool'] : ['on', 'off'];
  for (const generation of generations) for (const t of threads) for (const render of ['gpu', 'cpu'])
    rows.push({ id: `web-${generation}-${t}-render-${render}`, profile: 'web', generation, threads: t, render, source: 'procedural' });
  if (engineUp) {
    for (const render of ['gpu', 'cpu']) rows.push({ id: `rust-native-multithread-render-${render}`, profile: 'local', generation: 'native', threads: 'native (always multithread)', render, source: 'procedural' });
    if (pythonUp) for (const render of full ? ['gpu', 'cpu'] : ['gpu']) rows.push({ id: `python-native-multithread-render-${render}`, profile: 'local', generation: 'native', threads: 'native (always multithread)', render, source: 'neural-python' });
  }
  return rows.filter(row => row.id.includes(only));
}

let webgpuAdapter = true;
const lastLines = [];
const log = (...a) => { const line = a.join(' '); lastLines.push(line); console.log(line); };

async function runCombo(browser, origin, combo) {
  const started = Date.now();
  if (combo.profile === 'web' && combo.generation.startsWith('gpu') && !webgpuAdapter)
    return { ...combo, ok: false, skipped: true, stages: {}, phases: {}, errors: ['skipped: no WebGPU adapter in this headless browser (use --hardware on a machine where it does not freeze)'], totalMs: 0, wasmThreads: null, renderStats: null, screenshot: '' };
  const result = { ...combo, ok: false, stages: {}, errors: [], phases: {}, totalMs: 0, wasmThreads: null, renderStats: null, screenshot: `${combo.id}.png` };
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(limit);
  page.on('pageerror', e => result.errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource.*404/.test(m.text())) result.errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on('worker', w => w.on?.('console', () => {}));
  const phase = async (name, work) => {
    const t = Date.now();
    try { await work(); result.phases[name] = Date.now() - t; }
    catch (error) { result.phases[name] = Date.now() - t; result.errors.push(`${name}: ${String(error.message ?? error).split('\n')[0]}`); throw error; }
  };
  const frameOf = bench => page.frames().find(f => f.parentFrame() && f.url().includes(bench === 'city' ? 'citybench.html' : 'terrainbench.html') && (bench !== 'settlements' || f.url().includes('stage=settlements')) && (bench !== 'terrain' || !f.url().includes('stage=settlements')));
  const ready = bench => page.waitForFunction(b => {
    const f = document.querySelector(`iframe[data-bench=${b}]`);
    return !!f && !f.hidden && !!f.contentWindow?.magnaBenchContext?.ready?.();
  }, bench);
  const stageDone = (bench, stage) => page.waitForFunction(([b, s]) => {
    const w = document.querySelector(`iframe[data-bench=${b}]`)?.contentWindow;
    return w?.magnaBenchTimings?.stages?.[s] !== undefined || (w?.magnaBenchTimings?.errors?.length ?? 0) > 0;
  }, [bench, stage]);
  const collect = () => page.evaluate(() => {
    const merged = {}, errors = [];
    let threads = null, render = null;
    for (const f of document.querySelectorAll('iframe')) {
      const w = f.contentWindow; if (!w) continue;
      Object.assign(merged, w.magnaBenchTimings?.stages ?? {}); errors.push(...(w.magnaBenchTimings?.errors ?? []));
      threads = w.magnaWasmThreads ?? threads; render = w.magnaRenderStats ?? render;
    }
    return { merged, errors, threads, render, isolated: crossOriginIsolated };
  });
  try {
    const query = new URLSearchParams({ profile: combo.profile, generation: combo.generation, render: combo.render });
    if (combo.profile === 'local') query.set('localServer', engine);
    else query.set('threads', combo.threads);
    query.set('source', combo.source);
    const terrain = new URLSearchParams({ seed, width, auto: '1', ...(combo.generation === 'cpu' ? { compute: 'wasm' } : {}) });
    await page.goto(`${origin}/rustbench.html?${query}#terrain?${terrain}`, { waitUntil: "commit" });
    await phase('terrain', async () => { await ready('terrain'); await stageDone('terrain', 'terrain'); });
    await page.screenshot({ path: resolve(out, `${combo.id}-1-terrain.png`) });
    await phase('settlements', async () => {
      await page.waitForFunction(() => !document.querySelector('iframe[data-bench=terrain]')?.contentDocument?.querySelector('#pipelineNext')?.disabled);
      await frameOf('terrain').locator('#pipelineNext').click();
      await ready('settlements'); await stageDone('settlements', 'settlements'); await stageDone('settlements', 'roads');
    });
    await page.screenshot({ path: resolve(out, `${combo.id}-2-settlements.png`) });
    // The city atelier: its own quarters, parcels and buildings runs (panels may be collapsed: click without hit-testing).
    const press = (selector, stage) => async () => {
      const city = frameOf('city');
      await city.waitForSelector(selector, { state: 'attached' });
      // Clicks are retried: an apply pressed while an upstream stage is still publishing is ignored by the atelier.
      const has = () => page.evaluate(st => document.querySelector('iframe[data-bench=city]')?.contentWindow?.magnaBenchTimings?.stages?.[st] !== undefined, stage);
      const until = Date.now() + limit;
      while (!(await has()) && Date.now() < until) {
        await page.waitForFunction(sel => { const b = document.querySelector('iframe[data-bench=city]')?.contentDocument?.querySelector(sel); return b && b.getAttribute('aria-busy') !== 'true'; }, selector);
        await city.evaluate(sel => document.querySelector(sel).click(), selector);
        await page.waitForFunction(st => document.querySelector('iframe[data-bench=city]')?.contentWindow?.magnaBenchTimings?.stages?.[st] !== undefined, stage, { timeout: 25000 }).catch(() => {});
      }
      if (!(await has())) throw new Error(`${stage} did not complete`);
    };
    await phase('city', async () => {
      await stageDone('settlements', 'quarters');
      await page.waitForFunction(() => !document.querySelector('iframe[data-bench=settlements]')?.contentDocument?.querySelector('#pipelineNext')?.disabled);
      await frameOf('settlements').locator('#pipelineNext').click();
      await ready('city');
      await press('#urbanQuarterStage [data-apply]', 'quarters')();
    });
    await phase('parcels', press('#urbanParcelStage [data-apply]', 'parcels'));
    await phase('buildings', press('[data-buildings-generate]', 'buildings'));
    await page.screenshot({ path: resolve(out, `${combo.id}-3-city.png`) });
  } catch (error) { result.errors.push(`chain stopped: ${String(error.message ?? error).split('\n')[0]}`); }
  try {
    const state = await collect();
    result.stages = state.merged; result.wasmThreads = state.threads; result.renderStats = state.render; result.isolated = state.isolated;
    result.errors.push(...state.errors);
  } catch (error) { result.errors.push(`collect: ${error.message}`); }
  try { await page.screenshot({ path: resolve(out, result.screenshot) }); } catch { /* page closed */ }
  result.totalMs = Date.now() - started;
  result.ok = result.errors.length === 0 && ['terrain', 'settlements', 'roads', 'quarters', 'parcels', 'buildings'].every(s => result.stages[s] !== undefined);
  await context.close();
  return result;
}

function html(rows) {
  const keys = ['terrain', 'hydrology', 'settlements', 'roads', 'quarters', 'parcels', 'buildings'];
  const cols = ['totalMs', ...keys];
  const value = (r, c) => c === 'totalMs' ? r.totalMs : r.stages[c];
  const range = Object.fromEntries(cols.map(c => {
    const v = rows.filter(r => r.ok).map(r => value(r, c)).filter(x => typeof x === 'number');
    return [c, [Math.min(...v), Math.max(...v)]];
  }));
  const cell = (r, c) => {
    const v = value(r, c); if (typeof v !== 'number') return '<td>-</td>';
    const [lo, hi] = range[c];
    const cls = !r.ok || lo === hi ? '' : v === lo ? 'best' : v === hi ? 'worst' : '';
    return `<td class="${cls}">${Math.round(v).toLocaleString('en-US')}</td>`;
  };
  const body = rows.map(r => `<tr class="${r.ok ? '' : 'bad'}"><td><a href="${r.screenshot}">${r.id}</a></td><td>${r.profile === 'local' ? (r.source === 'neural-python' ? 'python' : 'rust') : 'web'}</td><td>${r.generation}</td><td>${r.threads}</td><td>${r.render}</td><td>${r.wasmThreads ? `${r.wasmThreads.mode}x${r.wasmThreads.threads}` : '-'}</td><td>${r.renderStats?.path ?? '-'}</td>${cols.map(c => cell(r, c)).join('')}<td>${r.ok ? 'ok' : r.skipped ? 'skipped' : 'error'}</td><td class="err">${[...new Set(r.errors)].slice(0, 3).join('<br>').replace(/</g, '&lt;').replace(/&lt;br>/g, '<br>')}</td></tr>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Bench matrix</title><style>body{font:13px system-ui;margin:20px;color:#273d33}table{border-collapse:collapse}th,td{border:1px solid #cdd0bf;padding:4px 8px;text-align:right}td:first-child,td:nth-child(2),td:nth-child(3),td:nth-child(4),td:nth-child(5),td.err{text-align:left}th{background:#e9eadb}.best{background:#cfe8c7}.worst{background:#f2cfc4}.bad td{color:#8a2d1a}.err{max-width:420px;font-size:11px}</style>
<h1>Bench matrix</h1><p>${new Date().toISOString()} - milliseconds; green = fastest, red = slowest among ok rows. Engine ${engine} ${engineUp ? 'online' : 'offline'}, python ${pythonServer} ${pythonUp ? 'online' : 'offline'}.</p>
<table><thead><tr><th>combination</th><th>profile</th><th>terrain generation</th><th>threads</th><th>render</th><th>wasm mode</th><th>render path</th><th>total (wall)</th>${keys.map(k => `<th>${k}</th>`).join('')}<th>status</th><th>errors</th></tr></thead><tbody>
${body}</tbody></table>`;
}

async function startVite(configFile, mode) {
  const server = await createServer({ configFile: resolve(web, configFile), mode, logLevel: 'warn', server: { host: '127.0.0.1', port: await freePort(), strictPort: true, watch: null, hmr: false }, clearScreen: false });
  await server.listen();
  return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
}

// Hardware ANGLE/D3D11 (--hardware) freezes the renderer main thread on terrainbench in headless Chrome here
// (GPU process spins at 100%; swiftshader does not), so the default is software GL, without a WebGPU adapter.
const hardware = args.includes('--hardware');
const launch = () => chromium.launch({ channel, headless: true, args: [...(hardware ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader']), '--enable-unsafe-webgpu', '--no-proxy-server'] });
const rows = [];
if (!args.includes('--v2-only')) {
  const { server, origin } = await startVite('vite.config.ts', 'rustbench');
  const browser = await launch();
  try {
    // WebGPU generation needs a real adapter: detect it once on an isolated page.
    const probe = await browser.newPage(); await probe.goto(`${origin}/coi-serviceworker.js`);
    webgpuAdapter = await probe.evaluate(async () => { try { return !!(await navigator.gpu?.requestAdapter()); } catch { return false; } }); await probe.close();
    const list = combinations();
    log(`matrix: ${list.length} combinations (engine ${engineUp ? 'up' : 'down'}, python ${pythonUp ? 'up' : 'down'})`);
    for (const combo of list) {
      log(`> ${combo.id}`);
      const row = await runCombo(browser, origin, combo);
      rows.push(row);
      log(`  ${row.ok ? 'ok' : 'ERROR'} total ${row.totalMs} ms stages ${JSON.stringify(Object.fromEntries(Object.entries(row.stages).map(([k, v]) => [k, Math.round(v)])))}${row.errors.length ? ` errors ${JSON.stringify(row.errors.slice(0, 2))}` : ''}`);
      writeFileSync(resolve(out, 'report.json'), JSON.stringify({ date: new Date().toISOString(), engine, engineUp, pythonServer, pythonUp, rows }, null, 2));
      writeFileSync(resolve(out, 'report.html'), html(rows));
    }
  } finally { await browser.close(); await server.close(); }
}

if (!args.includes('--no-v2')) {
  const { runV2Screens } = await import('./bench_matrix_v2.mjs');
  const { server, origin } = await startVite('vite.v2.config.ts', 'development');
  const browser = await launch();
  try { await runV2Screens(browser, origin, resolve(out, 'v2'), { engine, pythonServer, engineUp, pythonUp, limit }); }
  finally { await browser.close(); await server.close(); }
}
console.log(`report: ${resolve(out, 'report.html')}`);


