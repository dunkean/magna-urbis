// CPU vs GPU vector-overlay parity and timing on the V2 page. One chain run, then per style and zoom:
// capture with engine cpu, then gpu. Needs globalThis.__muVectorEngine (web/src/render/vectorEngine.ts).
// Usage: node scripts/vector_gpu_parity.mjs --port 5191 --label name [--styles a,b] [--zooms far,mid,near] [--point x,y] [--hold ms] [--page v2.html] [--webgpu]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const port = Number(arg('port', '')), label = arg('label', '');
if (!Number.isInteger(port) || port < 5191 || port > 5199 || !/^[\w.-]+$/.test(label)) throw Error('Usage: --port 5191..5199 --label name [--styles a,b] [--zooms far,mid,near] [--point x,y] [--hold ms] [--page v2.html] [--webgpu]');
const styles = arg('styles', 'parchment,cadastre,topographic,atlas').split(',');
const zooms = arg('zooms', 'far,mid,near').split(','), steps = { far: 0, mid: 5, near: 9 };
for (const z of zooms) if (!(z in steps)) throw Error(`Unknown zoom ${z}`);
const out = path.join(web, 'out/vector-gpu', label); fs.mkdirSync(out, { recursive: true });
const start = Date.now(), elapsed = () => Date.now() - start;
const meta = { label, started: new Date().toISOString(), page: arg('page', 'v2.html'), viewport: { width: 1400, height: 1000 }, seed: 'magna-urbis-v2', styles, zooms, wheel: { point: { x: 680, y: 200 }, deltaY: -240, steps }, pairs: [], pageErrors: [], consoleErrors: [], timings: {}, notes: [] };

const median = a => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = a => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]; };
const r2 = v => v == null ? null : Math.round(v * 100) / 100;
const summarize = st => ({
  preference: st.preference, engine: st.engine, renderer: st.renderer, software: st.software, demoted: st.demoted ?? null,
  gpuTiles: st.gpuTiles, cpuTiles: st.cpuTiles, fallbackTiles: st.fallbackTiles, lastFallback: st.lastFallback ?? null,
  recordMs: { n: st.recordMs?.length ?? 0, median: r2(median(st.recordMs)), p90: r2(p90(st.recordMs)) },
  rasterMs: { n: st.rasterMs?.length ?? 0, median: r2(median(st.rasterMs)), p90: r2(p90(st.rasterMs)) },
  cpuMs: { n: st.cpuMs?.length ?? 0, median: r2(median(st.cpuMs)), p90: r2(p90(st.cpuMs)) },
});

function save() {
  meta.timings.totalMs = elapsed();
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(meta, null, 2));
  const f = v => v == null ? '-' : v.toFixed(2);
  const rows = meta.pairs.map(p => {
    const c = p.cpu.stats, g = p.gpu.stats, gpuMs = (g.recordMs.median ?? 0) + (g.rasterMs.median ?? 0);
    const demoted = g.demoted ? ` demoted: ${g.demoted}` : '';
    return `| ${p.style} | ${p.zoom} | ${f(p.mad)} | ${f(p.pctOver24)} | ${f(c.cpuMs.median)} | ${g.recordMs.n || g.rasterMs.n ? f(gpuMs) : '-'} | ${g.fallbackTiles ?? 0}${g.lastFallback ? ` (${String(g.lastFallback).replaceAll('|', '/')})` : ''}${demoted} | ${g.gpuTiles ?? 0}/${c.cpuTiles ?? 0} | ${g.renderer ?? '-'} |`;
  });
  fs.writeFileSync(path.join(out, 'summary.md'), `# Vector GPU parity: ${label}\n\nMAD = mean absolute RGB difference (0-255); %>24 = share of pixels with a channel difference > 24. Times are medians per tile (ms).\n\n| style | zoom | MAD | %>24 | CPU ms/tile | GPU record+raster ms/tile | fallbacks | GPU/CPU tiles | renderer |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
}

// Page-side diff: decode both PNGs with the browser, return numbers and a diff PNG (red where > 24, else gray x4).
async function diffInBrowser(cmp, aBuf, bBuf) {
  return cmp.evaluate(async ([a, b]) => {
    const load = async s => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0); return { w: bmp.width, h: bmp.height, d: x.getImageData(0, 0, bmp.width, bmp.height).data }; };
    const A = await load(a), B = await load(b);
    if (A.w !== B.w || A.h !== B.h) return { error: `size mismatch ${A.w}x${A.h} vs ${B.w}x${B.h}` };
    const out = new OffscreenCanvas(A.w, A.h), ox = out.getContext('2d'), img = ox.createImageData(A.w, A.h);
    let sum = 0, over = 0; const n = A.w * A.h;
    for (let i = 0; i < n; i++) {
      const o = i * 4, dr = Math.abs(A.d[o] - B.d[o]), dg = Math.abs(A.d[o + 1] - B.d[o + 1]), db = Math.abs(A.d[o + 2] - B.d[o + 2]), m = Math.max(dr, dg, db);
      sum += dr + dg + db;
      if (m > 24) { over++; img.data[o] = 255; img.data[o + 1] = 0; img.data[o + 2] = 0; } else { const v = Math.min(255, m * 4); img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; }
      img.data[o + 3] = 255;
    }
    ox.putImageData(img, 0, 0);
    const blob = await out.convertToBlob({ type: 'image/png' }), buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { mad: sum / (n * 3), pctOver24: 100 * over / n, png: btoa(bin) };
  }, [aBuf.toString('base64'), bBuf.toString('base64')]);
}

let browser, page, cmp;
const timer = setTimeout(() => { meta.failure = 'Run exceeded 20 minutes; stopped without retry'; save(); browser?.close().finally(() => process.exit(2)); }, 1200000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, VK_LOADER_DEVICE_ID_FILTER: '0x2b85' }, args: args.includes('--webgpu') ? ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--use-webgpu-adapter=d3d12', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] : ['--use-angle=vulkan', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] });
  // Restrict only processes launched by this browser. Never select by image name.
  if (process.platform === 'win32') {
    try { const cdp = await browser.newBrowserCDPSession(); const { processInfo } = await cdp.send('SystemInfo.getProcessInfo'); meta.chromePids = processInfo.map(p => p.id); execFileSync('powershell.exe', ['-NoProfile', '-Command', `$ids=@(${meta.chromePids.join(',')}); foreach($idValue in $ids){try{(Get-Process -Id $idValue -ErrorAction Stop).ProcessorAffinity=[IntPtr]0xFFFE00}catch{}}`], { stdio: 'ignore' }); await cdp.detach(); } catch (e) { meta.notes.push(`Affinity: ${e.message}`); }
  }
  page = await browser.newPage({ viewport: meta.viewport, deviceScaleFactor: 1 });
  cmp = await browser.newPage(); // scratch page for PNG decoding and diffing
  page.on('crash', () => { meta.notes.push(`Page crashed at ${elapsed()} ms`); });
  page.on('pageerror', e => { meta.pageErrors.push({ ms: elapsed(), message: e.message }); console.log('PAGEERROR', e.message); });
  page.on('console', m => { if (m.type() === 'error') meta.consoleErrors.push({ ms: elapsed(), message: m.text().slice(0, 2000) }); });
  page.setDefaultTimeout(30000);
  // Other sessions edit this tree: a hot reload in the middle of the chain would lose the page.
  await page.route('**/@vite/client', route => route.fulfill({ contentType: 'text/javascript', body: 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}});export const updateStyle=(id,css)=>{let e=document.querySelector(`style[data-vite-dev-id="${id}"]`);if(!e){e=document.createElement("style");e.dataset.viteDevId=id;document.head.append(e);}e.textContent=css;};export const removeStyle=()=>{};export const injectQuery=u=>u;export const ErrorOverlay=class{};' }));
  await page.goto(`http://127.0.0.1:${port}/${meta.page}?test=1${args.includes('--plain') ? '' : '&quality=full'}&lang=fr&source=procedural${args.includes('--webgpu') ? '&renderer=webgpu' : ''}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#map-style').waitFor(); await page.waitForTimeout(6000);
  if (!await page.evaluate(() => !!globalThis.__muVectorEngine?.get)) throw Error('globalThis.__muVectorEngine is missing on this page: build/serve a tree with src/render/vectorEngine.ts registered (see web/out/vector-gpu-2026-11-12/DESIGN.md)');
  const proc = page.locator('button', { hasText: /^\s*Proc/ }).first();
  if (await proc.count() && await proc.getAttribute('aria-checked') === 'true') meta.notes.push('Procedural source already selected');
  else if (await proc.count() && await proc.isVisible()) { await proc.click(); await page.waitForTimeout(1500); meta.notes.push('Clicked procedural source'); }
  else throw Error('Procedural source button missing; refusing an unverified generation');
  // The seed field may sit in a collapsed stage panel: set it directly.
  await page.evaluate(seed => { const e = document.querySelector('#seed'); e.value = seed; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, meta.seed);
  await page.locator('#expert-open').click();
  meta.recipe = JSON.parse(await page.locator('#expert-json').inputValue());
  await page.evaluate(() => document.querySelector('#expert-dialog').close());
  if (meta.recipe.generation !== 'procedural' || !String(meta.recipe.runtime?.source).startsWith('procedural')) throw Error('Recipe did not confirm procedural source');
  meta.timings.readyMs = elapsed();
  // The chain button moves with the UI; the test hook runs the same full chain.
  await page.evaluate(() => document.querySelector('#run-chain').click());
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: 330000 });
  await page.waitForTimeout(6000);
  if (await page.locator('#map-canvas').isHidden()) throw Error(`Generation failed: ${await page.locator('#toast').textContent()}`);
  meta.timings.chainDoneMs = elapsed();
  meta.options = await page.locator('#map-style option').evaluateAll(os => os.map(o => ({ value: o.value, label: o.textContent, disabled: o.disabled })));
  const aliases = { atlas: ['atlas'], cadastre: ['cadastre', 'plan', 'cadastral'], topographic: ['topographic', 'topo', 'topography'], parchment: ['parchment'] };
  function resolveStyle(style) { const list = aliases[style] ?? [style]; for (const id of list) if (meta.options.some(o => o.value === id && !o.disabled)) return id; throw Error(`No enabled style option for ${style}`); }
  await page.addStyleTag({ content: `html,body,#app{width:100%!important;height:100%!important;overflow:hidden!important}.app-header,#sidebar,.mobile-toggle,.map-topbar,.map-bottom,.map-compass,.map-tools,.map-hint,.inspector-mode,.places-panel,.inspector,.toast,.hint,.legend-strip,.progress-card,.city3d-bar,.city3d-info,.city3d-help{visibility:hidden!important;pointer-events:none!important}.workspace{display:block!important;position:fixed!important;inset:0!important;height:100vh!important}.map-area{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}.city3d{position:absolute!important;inset:0!important}` });
  await page.waitForTimeout(1000);
  const settle = async (delay = 3000) => { await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true' && document.querySelector('#render-status')?.hidden !== false, null, { timeout: 240000 }); await page.waitForTimeout(delay); };
  const hold = Number(arg('hold', '0'));

  // Switch engine, clear the counters (repaints), wait for the overlay to settle, capture PNG + stats.
  async function capture(choice, base) {
    await page.evaluate(c => { const v = globalThis.__muVectorEngine; v.set(c); v.reset(); }, choice);
    await page.waitForTimeout(500); await settle(3000); if (hold) await page.waitForTimeout(hold);
    await page.evaluate(() => window.__v2Test?.prepareCapture());
    const file = `${base}-${choice}.png`, buf = await page.screenshot({ timeout: 200000 });
    fs.writeFileSync(path.join(out, file), buf);
    const raw = await page.evaluate(() => { const s = globalThis.__muVectorEngine.stats(); return JSON.parse(JSON.stringify(s)); });
    return { file, buf, stats: summarize(raw), engineAfter: await page.evaluate(() => globalThis.__muVectorEngine.get()) };
  }

  const point = arg('point', '') ? arg('point', '').split(',').map(Number) : null;
  if (point) meta.wheel.point = { x: point[0], y: point[1] };
  // --profile: per style and zoom level, wheel zoom out/in and a drag pan; per-frame work (ms), frame intervals,
  // long tasks and the slowest part of a frame. Engines from --engines (default gpu).
  if (args.includes('--profile')) {
    meta.profile = [];
    meta.optionValues = meta.options.map(o => o.value);
    console.log('STYLES', JSON.stringify(meta.optionValues));
    const engines = arg('engines', 'gpu').split(',');
    const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return r2(s[Math.min(s.length - 1, Math.floor(s.length * q))]); };
    const measure = async (label, run) => {
      await page.evaluate(() => {
        globalThis.__muVectorEngine.reset();
        const f = globalThis.__frames = []; let last = performance.now();
        globalThis.__long = 0; globalThis.__longMax = 0;
        try { globalThis.__obs?.disconnect(); globalThis.__obs = new PerformanceObserver(l => { for (const e of l.getEntries()) { globalThis.__long++; globalThis.__longMax = Math.max(globalThis.__longMax, e.duration); } }); globalThis.__obs.observe({ type: 'longtask' }); } catch {}
        const tick = t => { f.push(t - last); last = t; if (!globalThis.__framesStop) requestAnimationFrame(tick); };
        globalThis.__framesStop = false; requestAnimationFrame(tick);
      });
      await run();
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => { globalThis.__framesStop = true; globalThis.__obs?.disconnect(); const s = globalThis.__muVectorEngine.stats(); return { frames: globalThis.__frames.slice(1), long: globalThis.__long, longMax: globalThis.__longMax, parts: s.liveParts, work: s.liveSeries.frame ?? [], ground: s.liveSeries.ground ?? [], engine: s.engine, demoted: s.demoted ?? null, fallbacks: s.fallbackTiles, lastFallback: s.lastFallback ?? null, gpuTiles: s.gpuTiles, cpuTiles: s.cpuTiles }; });
      const parts = Object.fromEntries(Object.entries(r.parts).filter(([, v]) => v >= 4).map(([k, v]) => [k, Math.round(v)]));
      return { label, engine: r.engine, demoted: r.demoted, fallbacks: r.fallbacks, lastFallback: r.lastFallback, gpuTiles: r.gpuTiles, cpuTiles: r.cpuTiles, frames: r.frames.length, intervalP95: pct(r.frames, .95), intervalMax: pct(r.frames, 1), workP50: pct(r.work, .5), workP95: pct(r.work, .95), workMax: pct(r.work, 1), groundP95: pct(r.ground, .95), long: r.long, longMax: r2(r.longMax), parts };
    };
    for (const style of styles) {
      const option = resolveStyle(style);
      for (const engine of engines) {
        await page.evaluate(v => { const s = document.querySelector('#map-style'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, option); await settle(5000);
        await page.evaluate(c => globalThis.__muVectorEngine.set(c), engine); await settle(2000);
        await page.evaluate(() => document.querySelector('#fit-map').click()); await settle();
        let at = 0;
        for (const zoom of [...zooms].sort((a, b) => steps[a] - steps[b])) {
          await page.mouse.move(meta.wheel.point.x, meta.wheel.point.y);
          while (at < steps[zoom]) { await page.mouse.wheel(0, meta.wheel.deltaY); await page.waitForTimeout(150); at++; }
          await settle();
          const zoomRun = await measure('zoom', async () => { for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, i < 4 ? -meta.wheel.deltaY : meta.wheel.deltaY); await page.waitForTimeout(120); } });
          await settle(1500);
          const panRun = await measure('pan', async () => {
            await page.mouse.move(700, 600); await page.mouse.down();
            for (let i = 1; i <= 30; i++) { await page.mouse.move(700 - i * 15, 600 - i * 6); await page.waitForTimeout(16); }
            for (let i = 29; i >= 0; i--) { await page.mouse.move(700 - i * 15, 600 - i * 6); await page.waitForTimeout(16); }
            await page.mouse.up();
          });
          await settle(1500);
          for (const run of [zoomRun, panRun]) {
            const row = { style, zoom, ...run };
            meta.profile.push(row); console.log('PROFILE', JSON.stringify(row)); save();
          }
        }
      }
    }
    meta.completed = true; save(); throw Object.assign(new Error('profile done'), { done: true });
  }
  // --dezoom: zoom out step by step past the whole-map view (GPU engine), capture after each step and report blank frames.
  if (args.includes('--dezoom')) {
    meta.dezoom = [];
    for (const style of styles) {
      await page.evaluate(v => { const s = document.querySelector('#map-style'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, resolveStyle(style)); await settle(5000);
      await page.evaluate(() => { globalThis.__muVectorEngine.set('gpu'); globalThis.__muVectorEngine.reset(); }); await settle(2000);
      await page.evaluate(() => document.querySelector('#fit-map').click()); await settle();
      await page.mouse.move(meta.wheel.point.x, meta.wheel.point.y);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, meta.wheel.deltaY); await page.waitForTimeout(150); }
      await settle();
      for (let step = 0; step < 14; step++) {
        await page.mouse.wheel(0, -meta.wheel.deltaY);
        for (const wait of [60, 400, 1500]) {
          await page.waitForTimeout(wait);
          const file = `${style}-dezoom-${step}-${wait}.png`, buf = await page.screenshot({ timeout: 200000 });
          fs.writeFileSync(path.join(out, file), buf);
          const blank = await page.evaluate(async b64 => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0); const d = x.getImageData(0, 0, bmp.width, bmp.height).data; let same = 0; for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) < 6) same++; return same / (d.length / 16); }, buf.toString('base64'));
          const st = await page.evaluate(() => { const s = globalThis.__muVectorEngine.stats(); return { engine: s.engine, demoted: s.demoted ?? null, fallbacks: s.fallbackTiles, last: s.lastFallback ?? null, scale: document.querySelector('#scale-label')?.textContent }; });
          meta.dezoom.push({ style, step, wait, file, blank: r2(blank), ...st });
          console.log('DEZOOM', JSON.stringify(meta.dezoom.at(-1)));
        }
      }
    }
    meta.completed = true; save(); throw Object.assign(new Error('dezoom done'), { done: true });
  }
  for (const style of styles) {
    const option = resolveStyle(style);
    await page.evaluate(v => { const s = document.querySelector('#map-style'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, option); await settle(5000);
    await page.evaluate(() => document.querySelector('#fit-map').click()); await settle();
    let at = 0;
    for (const zoom of [...zooms].sort((a, b) => steps[a] - steps[b])) {
      await page.mouse.move(meta.wheel.point.x, meta.wheel.point.y);
      while (at < steps[zoom]) { await page.mouse.wheel(0, meta.wheel.deltaY); await page.waitForTimeout(200); at++; }
      await settle();
      const base = `${style}-${zoom}`;
      const cpu = await capture('cpu', base), gpu = await capture('gpu', base);
      const d = await diffInBrowser(cmp, cpu.buf, gpu.buf);
      if (d.error) throw Error(`${base}: ${d.error}`);
      fs.writeFileSync(path.join(out, `${base}-diff.png`), Buffer.from(d.png, 'base64'));
      const pair = { style, option, zoom, mad: d.mad, pctOver24: d.pctOver24, scaleLabel: await page.locator('#scale-label').textContent().catch(() => null), cpu: { file: cpu.file, stats: cpu.stats }, gpu: { file: gpu.file, stats: gpu.stats }, diff: `${base}-diff.png`, ms: elapsed() };
      if (gpu.engineAfter !== 'gpu') pair.note = `engine after gpu switch is ${gpu.engineAfter} (demoted or unavailable)`;
      meta.pairs.push(pair);
      console.log('PAIR', JSON.stringify({ style, zoom, mad: r2(d.mad), pctOver24: r2(d.pctOver24), cpuMs: cpu.stats.cpuMs.median, gpuRecord: gpu.stats.recordMs.median, gpuRaster: gpu.stats.rasterMs.median, fallbacks: gpu.stats.fallbackTiles, engineAfter: gpu.engineAfter }));
      // Navigation smoothness: frame intervals during a wheel zoom out and back in, per engine (live view, no capture).
      if (zoom === 'mid') {
        pair.gesture = {};
        for (const choice of ['cpu', 'gpu']) {
          await page.evaluate(c => globalThis.__muVectorEngine.set(c), choice); await settle(2000);
          await page.evaluate(() => globalThis.__muVectorEngine.reset());
          await page.evaluate(() => { const f = globalThis.__frames = []; let last = performance.now(); const tick = t => { f.push(t - last); last = t; if (!globalThis.__framesStop) requestAnimationFrame(tick); }; globalThis.__framesStop = false; requestAnimationFrame(tick); });
          for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, i < 4 ? -meta.wheel.deltaY : meta.wheel.deltaY); await page.waitForTimeout(120); }
          if (choice === 'gpu') fs.writeFileSync(path.join(out, `${base}-gesture-gpu.png`), await page.screenshot({ timeout: 200000 }));
          await page.waitForTimeout(400);
          const f = await page.evaluate(() => { globalThis.__framesStop = true; return globalThis.__frames.slice(1); });
          const sorted = [...f].sort((x, y) => x - y);
          const parts = await page.evaluate(() => globalThis.__muVectorEngine.stats().liveParts);
          pair.gesture[choice] = { parts, frames: f.length, median: r2(median(f)), p95: r2(sorted[Math.floor(sorted.length * .95)] ?? null), max: r2(sorted[sorted.length - 1] ?? null) };
          await settle(1000);
        }
        console.log('GESTURE', JSON.stringify({ style, ...pair.gesture }));
      }
      save();
    }
  }
  meta.completed = true;
} catch (e) { if (e.done) { console.log('DEZOOM DONE'); } else { meta.failure = e.stack; console.error(e); process.exitCode = 1; if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 }).catch(() => {}); } } }
finally {
  clearTimeout(timer);
  try { if (page && !page.isClosed()) await page.evaluate(() => globalThis.__muVectorEngine?.set('auto')); } catch { /* page may be gone */ }
  save(); await browser?.close();
}
