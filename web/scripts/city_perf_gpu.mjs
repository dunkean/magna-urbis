// From web/ (Vite dev server running on :5173):
//   node scripts/city_perf_gpu.mjs [--data out/city-perf/native] [--map city-01-river-plain-l] [--scales 1,10] [--gpu] [--out out/city-perf/gpu]
// GPU city renderer (src/render/cityGl.ts) vs the Canvas 2D renderer (drawCity of
// src/render/cityCanvas.ts, imported read-only), on the same scene objects:
// the saved 100k plan (layout, partition, placement requests → silhouettes, written by
// city_perf_native.mjs or city_replay.mjs) and N× tiled copies (10× = synthetic 1M).
// Reports scene build/upload (single thread and workers), GPU bytes, JS heap, and per
// zoom (whole, far 14, mid 4.5, near 1.5, close 0.4 m/px) × view: presented-frame
// cadence over 16 pans (16.7 ms floor), JS per frame, forced completion (readPixels /
// getImageData), and for WebGL 10 redraws per vsync (bounds the GPU cost per frame).
// "webgl+overlay" = GPU plan + drawCity restricted to labels/glyphs on a 2D canvas.
// GPU rule: --gpu uses ANGLE D3D11 and aborts (falls back to --disable-gpu) if the
// browser lands on the RTX 5090; without --gpu WebGL runs on SwiftShader (CPU).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const data = option('data', 'out/city-perf/native'), map = option('map', 'city-01-river-plain-l'), out = option('out', 'out/city-perf/gpu');
const scales = option('scales', '1,10').split(',').map(Number), views = option('views', 'parcels,buildings,roles').split(',');
let gpu = args.includes('--gpu');
const unthrottled = args.includes('--unthrottled'); // no vsync / frame-rate cap: frame cadence = real throughput
mkdirSync(out, { recursive: true });
const smi = () => { try { return execSync('nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used --format=csv,noheader', { encoding: 'utf8' }).trim(); } catch { return 'nvidia-smi unavailable'; } };
console.log('GPUs before:', smi().replace(/\n/g, ' | '));

// Slim inputs: only what the renderers read.
const layout = JSON.parse(readFileSync(`${data}/${map}-layout.json`, 'utf8'));
const partition = JSON.parse(readFileSync(`${data}/${map}-partition.json`, 'utf8'));
const requests = JSON.parse(readFileSync(`${data}/${map}-placement-requests.json`, 'utf8'));
const sil = await tsImport('../src/ui/urbanSilhouettes.ts', import.meta.url);
const { silhouetteScene } = sil.silhouetteScene ? sil : sil.default;
const batch = silhouetteScene(requests);
const slim = {
  layout: { key: layout.key, blocks: layout.blocks, streets: layout.streets, quarters: layout.quarters, enclosures: layout.enclosures, phases: layout.phases,
    structure: layout.structure && { districts: layout.structure.districts, allocated: layout.structure.allocated, centers: layout.structure.centers } },
  partition: { key: partition.key, parcels: partition.parcels.map(p => ({ shape: p.shape, use: p.use, block: p.block, id: p.id, axis: p.axis })),
    programme: { allocations: (partition.programme?.allocations ?? []).map(a => ({ parcelId: a.parcelId, function: a.function, role: a.role, label: a.label, landmark: a.landmark, demandId: a.demandId, culture: a.culture })) } },
  batch: { buildings: batch.buildings.map(b => ({ id: b.id, parcel_id: b.parcel_id, function: b.function, footprint: b.footprint, roof_footprint: b.roof_footprint, programme: b.programme })), refusals: [], open_spaces: [] },
};
const body = JSON.stringify(slim);
console.log(`slim input ${(body.length / 1e6).toFixed(1)} MB · ${layout.blocks.length} blocks · ${partition.parcels.length} parcels · ${batch.buildings.length} buildings`);

async function launch(useGpu) {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true,
    args: [...(useGpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']), '--enable-precise-memory-info',
      ...(unthrottled ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('[perf]')) console.log('page:', m.text()); });
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.route('http://127.0.0.1:5173/__perf/gpu.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#f2ead8"><canvas id="c2" width="1500" height="1000" style="position:fixed;inset:0"></canvas><canvas id="gl" width="1500" height="1000" style="position:fixed;inset:0"></canvas><canvas id="ov" width="1500" height="1000" style="position:fixed;inset:0"></canvas></body>' }));
  await page.route('http://127.0.0.1:5173/__perf/data.json', r => r.fulfill({ contentType: 'application/json', body }));
  await page.goto('http://127.0.0.1:5173/__perf/gpu.html');
  const renderer = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'no webgl2'; const e = g.getExtension('WEBGL_debug_renderer_info'); return String(g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER)); });
  return { browser, page, renderer };
}
let { browser, page, renderer } = await launch(gpu);
console.log('WebGL renderer:', renderer, '| GPUs:', smi().replace(/\n/g, ' | '));
if (gpu && /5090/.test(renderer)) {
  console.log('Browser landed on the RTX 5090: aborting GPU mode, falling back to --disable-gpu (SwiftShader).');
  await browser.close(); gpu = false; ({ browser, page, renderer } = await launch(false));
  console.log('WebGL renderer:', renderer);
}

const fs = p => `/@fs/${resolve(p).replace(/\\/g, '/')}`;
const report = { map, gpu, unthrottled, renderer, scales: [] };
for (const scale of scales) {
  const result = await page.evaluate(async ({ scale, mods, gpu, views }) => {
    const [cc, cg] = await Promise.all(mods.map(m => import(m)));
    const input = await (await fetch('/__perf/data.json')).json();
    // Tile: copies side by side, each offset by the city extent.
    const pts = input.layout.blocks.flatMap(b => b.shape.outer), xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const w = Math.max(...xs) - Math.min(...xs) + 300, h = Math.max(...ys) - Math.min(...ys) + 300, side = Math.ceil(Math.sqrt(scale));
    const shift = (v, dx, dy) => { if (Array.isArray(v)) { for (const x of v) shift(x, dx, dy); return v; } if (v && typeof v === 'object') { if (typeof v.x === 'number' && typeof v.y === 'number') { v.x += dx; v.y += dy; } for (const k in v) if (k !== 'x' && k !== 'y') shift(v[k], dx, dy); } return v; };
    const layouts = [], partitions = [], buildings = [];
    for (let i = 0; i < scale; i++) {
      const dx = (i % side) * w, dy = Math.floor(i / side) * h, key = `${input.layout.key}#${i}`, suffix = i ? `#${i}` : '';
      const l = i ? shift(structuredClone(input.layout), dx, dy) : input.layout, p = i ? shift(structuredClone(input.partition), dx, dy) : input.partition;
      l.key = key; p.key = key;
      if (i) { for (const q of p.parcels) if (q.id) q.id += suffix; for (const a of p.programme.allocations) a.parcelId += suffix; }
      layouts.push(l); partitions.push(p);
      for (const b of input.batch.buildings) { const c = i ? shift(structuredClone(b), dx, dy) : b; if (i) { c.id += suffix; c.parcel_id += suffix; } buildings.push(c); }
    }
    const res = { scale, timings: {}, configs: [] };
    let t = performance.now(); const scene = cc.buildCityScene(layouts, partitions); res.timings.buildCityScene = performance.now() - t;
    t = performance.now(); const built = cc.buildCityBuildings({ buildings, refusals: [], open_spaces: [] }, scene); res.timings.buildCityBuildings = performance.now() - t;
    res.counts = { blocks: scene.blocks.length, parcels: scene.parcels.length, streets: scene.streets.length, walls: scene.walls.length, buildings: built.items.length };
    const c2 = document.getElementById('c2'), cgl = document.getElementById('gl'), ov = document.getElementById('ov');
    const renderer = cg.createCityGlRenderer(cgl, { allowSoftware: true });
    // Build: single thread, then with workers (the main-thread time is what blocks the UI).
    const longTasks = []; const obs = new PerformanceObserver(l => { for (const e of l.getEntries()) longTasks.push(e.duration); }); obs.observe({ type: 'longtask', buffered: false });
    t = performance.now(); res.buildSync = await renderer.setScene(scene, built, { workers: 0 }); res.timings.setSceneSync = performance.now() - t;
    await renderer.setScene(scene, built, { workers: 4 }); // warm-up: worker start-up and module load are paid once per page
    await new Promise(r => setTimeout(r, 200)); longTasks.length = 0;
    t = performance.now(); res.buildWorkers = await renderer.setScene(scene, built, { workers: 4 }); res.timings.setSceneWorkers = performance.now() - t;
    await new Promise(r => setTimeout(r, 50));
    res.longTasksDuringWorkerBuild = longTasks.map(x => Math.round(x)); obs.disconnect();
    t = performance.now(); res.buildBuildingsOnly = await renderer.setBuildings(built, { workers: 4 }); res.timings.setBuildingsWorkers = performance.now() - t;
    res.gl = renderer.stats();
    const ex = scene.extent, W = 1500, H = 1000;
    const tileBoxes = scene.blocks.filter(b => b.layout === 0).map(b => cc.shapeBox(b.shape));
    const core0 = { x: tileBoxes.reduce((s, b) => s + (b.minX + b.maxX) / 2, 0) / tileBoxes.length, y: tileBoxes.reduce((s, b) => s + (b.minY + b.maxY) / 2, 0) / tileBoxes.length };
    const mid = Math.min(scale - 1, side + 1), cx0 = core0.x + (mid % side) * w, cy0 = core0.y + Math.floor(mid / side) * h;
    const ecx = (ex.minX + ex.maxX) / 2, ecy = (ex.minY + ex.maxY) / 2;
    const fitMpp = Math.max((ex.maxX - ex.minX) / W, (ex.maxY - ex.minY) / H) * 1.05;
    const box = (x, y, mpp) => ({ minX: x - W / 2 * mpp, minY: y - H / 2 * mpp, maxX: x + W / 2 * mpp, maxY: y + H / 2 * mpp });
    const layers = { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false };
    const overlayLayers = cg.cityGlOverlayLayers(layers);
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const ctx = c2.getContext('2d'), octx = ov.getContext('2d');
    const configs = [
      { name: 'whole city', mpp: fitMpp }, { name: 'whole city, parcels forced (near LOD)', mpp: fitMpp, lod: 'near' },
      { name: 'far 14 m/px', mpp: 14 }, { name: 'mid 4.5 m/px', mpp: 4.5 }, { name: 'near 1.5 m/px', mpp: 1.5 }, { name: 'close 0.4 m/px', mpp: 0.4 },
    ];
    const appearance = { style: 'silhouette', diagnostic: 'none' };
    const paint2d = (c, v, mpp, lod, view, lyr, buildingsVisible) => {
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); const k = 1 / mpp; c.setTransform(k, 0, 0, k, -v.minX * k, -v.minY * k);
      return cc.drawCity(c, scene, { viewport: v, mpp, dpr: 1, lod, view, palette: 'growth', width: 1, layers: lyr, buildings: built, buildingsVisible, appearance });
    };
    const med = x => { const y = [...x].sort((p, q) => p - q); return Math.round(y[y.length >> 1] * 10) / 10; };
    for (const view of views) for (const cfg of configs) {
      const lod = cfg.lod ?? cc.selectCityLod(cfg.mpp);
      const whole = cfg.name.startsWith('whole'), cx = whole ? ecx : cx0, cy = whole ? ecy : cy0;
      const pans = Array.from({ length: 16 }, (_, i) => { const a = i / 16 * Math.PI * 2, r = whole ? W * cfg.mpp / 20 : Math.min(W * cfg.mpp / 4, 600); return box(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, cfg.mpp); });
      const row = { view, config: cfg.name, mpp: Math.round(cfg.mpp * 100) / 100, lod };
      for (const kind of ['webgl', 'webgl+overlay', 'canvas2d']) {
        for (let i = 0; i < 20; i++) await raf(); // drain the previous configuration's GPU work
        c2.style.display = kind === 'canvas2d' ? '' : 'none'; cgl.style.display = kind === 'canvas2d' ? 'none' : ''; ov.style.display = kind === 'webgl+overlay' ? '' : 'none';
        let lastGl;
        const draw = v => {
          if (kind === 'canvas2d') return paint2d(ctx, v, cfg.mpp, lod, view, layers, true);
          lastGl = renderer.draw({ viewport: v, metresPerPixel: cfg.mpp, lod, view });
          if (kind === 'webgl+overlay') paint2d(octx, v, cfg.mpp, lod, view, overlayLayers, false);
          return lastGl;
        };
        let a = performance.now(); draw(pans[0]); const cold = performance.now() - a;
        let sync;
        if (kind !== 'canvas2d') { const px = new Uint8Array(4), g = renderer.gl; draw(pans[1]); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); const s = []; for (let i = 0; i < 7; i++) { a = performance.now(); draw(pans[i % 16]); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); s.push(performance.now() - a); } sync = med(s); }
        else if (!gpu) { const s = []; for (let i = 0; i < 3; i++) { a = performance.now(); draw(pans[i + 1]); ctx.getImageData(0, 0, 1, 1); s.push(performance.now() - a); } sync = med(s); }
        // GPU time per frame from timer queries, when the browser exposes them.
        let gpuMs;
        const tq = kind === 'webgl' && renderer.gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (tq) {
          const g = renderer.gl, qs = [];
          for (let i = 0; i < 8; i++) { const q = g.createQuery(); g.beginQuery(tq.TIME_ELAPSED_EXT, q); draw(pans[i % 16]); g.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); }
          for (let k = 0; k < 60 && !g.getQueryParameter(qs[7], g.QUERY_RESULT_AVAILABLE); k++) await raf();
          if (!g.getParameter(tq.GPU_DISJOINT_EXT) && g.getQueryParameter(qs[7], g.QUERY_RESULT_AVAILABLE)) gpuMs = Math.round(med(qs.map(q => g.getQueryParameter(q, g.QUERY_RESULT) / 1e6)) * 100) / 100;
          qs.forEach(q => g.deleteQuery(q));
        }
        await raf(); await raf();
        const js = [], intervals = []; let last = performance.now();
        for (const v of pans) { const s = performance.now(); draw(v); js.push(performance.now() - s); await raf(); const n = performance.now(); intervals.push(n - last); last = n; }
        let stress;
        if (kind === 'webgl') {
          const iv = []; let l = performance.now();
          for (let f = 0; f < 12; f++) { for (let k = 0; k < 10; k++) draw(pans[(f + k) % 16]); await raf(); const n = performance.now(); iv.push(n - l); l = n; }
          stress = med(iv.slice(2));
        }
        row[kind] = { gpuMs, frameMedian: med(intervals), frameMax: Math.round(Math.max(...intervals) * 10) / 10, jsMedian: med(js), syncMedian: sync, coldMs: Math.round(cold * 10) / 10, stress10PerVsync: stress,
          drawCalls: lastGl?.drawCalls, triangles: lastGl ? Math.round(lastGl.triangles) : undefined, instances: lastGl?.instances };
      }
      res.configs.push(row);
    }
    res.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined;
    // Visual witness: the same near views in both renderers (screenshots taken from Node).
    window.__show = (kind, view, mpp) => {
      const v = box(cx0, cy0, mpp), lod = cc.selectCityLod(mpp);
      c2.style.display = kind === 'canvas2d' ? '' : 'none'; cgl.style.display = kind === 'canvas2d' ? 'none' : ''; ov.style.display = kind === 'canvas2d' ? 'none' : '';
      if (kind === 'canvas2d') paint2d(ctx, v, mpp, lod, view, layers, true);
      else { renderer.draw({ viewport: v, metresPerPixel: mpp, lod, view, selectedId: built.items[Math.floor(built.items.length / 2)]?.id }); paint2d(octx, v, mpp, lod, view, overlayLayers, false); }
    };
    window.__dispose = () => renderer.dispose();
    return res;
  }, { scale, mods: [fs('src/render/cityCanvas.ts'), fs('src/render/cityGl.ts')], gpu, views });
  report.scales.push(result);
  const r = v => typeof v === 'number' ? Math.round(v * 10) / 10 : v;
  console.log(JSON.stringify({ scale: result.scale, counts: result.counts, timings: Object.fromEntries(Object.entries(result.timings).map(([k, v]) => [k, r(v)])),
    buildSync: Object.fromEntries(Object.entries(result.buildSync).map(([k, v]) => [k, r(v)])), buildWorkers: Object.fromEntries(Object.entries(result.buildWorkers).map(([k, v]) => [k, r(v)])),
    longTasksDuringWorkerBuild: result.longTasksDuringWorkerBuild, gl: { ...result.gl, gpuMB: r(result.gl.gpuBytes / 1048576), build: undefined, buildingsBuild: undefined, frame: undefined }, heapMB: result.heapMB }));
  for (const c of result.configs) console.log(JSON.stringify(c));
  for (const kind of ['webgl', 'canvas2d']) for (const [view, mpp] of [['buildings', 1.2], ['parcels', 0.5], ['roles', 3], ['parcels', 6]]) {
    await page.evaluate(([k, v, m]) => window.__show(k, v, m), [kind, view, mpp]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${map}-x${scale}-${kind}-${view}-${mpp}${gpu ? '-gpu' : ''}.png` });
  }
  await page.evaluate(() => window.__dispose());
}
console.log('GPUs after:', smi().replace(/\n/g, ' | '));
writeFileSync(`${out}/${map}${gpu ? '-gpu' : '-cpu'}${unthrottled ? '-unthrottled' : ''}.json`, JSON.stringify(report, null, 1));
await browser.close();
