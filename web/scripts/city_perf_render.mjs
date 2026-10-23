// From web/ (Vite dev server running on :5173):
//   node scripts/city_perf_render.mjs [--data out/city-perf/native] [--map city-01-river-plain-l] [--scales 1,10] [--gpu] [--out out/city-perf/render]
// Renderer-only benchmark, outside the UI: the real 100k plan (written by
// city_perf_native.mjs: layout, partition, placement requests → silhouettes),
// tiled N times side by side for a synthetic N×city, drawn by
//  - Canvas 2D: drawCity of web/src/render/cityCanvas.ts (the City Bench renderer),
//  - WebGL2: the cityGl prototype (cityGlMesh + cityGlLayer), mesh uploaded once.
// Per configuration: presented-frame cadence over 16 pans issued from rAF (16.7 ms
// floor), JS time per frame, and a forced sync (2D: getImageData 1 px, only without
// --gpu since readbacks demote accelerated canvases; GL: readPixels 1 px).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const data = option('data', 'out/city-perf/native'), map = option('map', 'city-01-river-plain-l'), out = option('out', 'out/city-perf/render');
const scales = option('scales', '1,10').split(',').map(Number), gpu = args.includes('--gpu');
mkdirSync(out, { recursive: true });

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
    programme: { allocations: (partition.programme?.allocations ?? []).map(a => ({ parcelId: a.parcelId, function: a.function, role: a.role, landmark: a.landmark, demandId: a.demandId, culture: a.culture })) } },
  batch: { buildings: batch.buildings.map(b => ({ id: b.id, parcel_id: b.parcel_id, function: b.function, footprint: b.footprint, roof_footprint: b.roof_footprint, programme: b.programme })), refusals: [], open_spaces: [] },
};
const body = JSON.stringify(slim);
console.log(`slim input ${(body.length / 1e6).toFixed(1)} MB · ${layout.blocks.length} blocks · ${partition.parcels.length} parcels · ${batch.buildings.length} buildings`);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true,
  args: gpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] : ['--disable-gpu', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', m => { if (m.type() === 'error') console.log('page:', m.text()); });
await page.route('http://127.0.0.1:5173/__perf/page.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#f2ead8"><canvas id="c2" width="1500" height="1000" style="position:fixed;inset:0"></canvas><canvas id="gl" width="1500" height="1000" style="position:fixed;inset:0"></canvas></body>' }));
await page.route('http://127.0.0.1:5173/__perf/data.json', r => r.fulfill({ contentType: 'application/json', body }));
await page.goto('http://127.0.0.1:5173/__perf/page.html');
const fs = p => `/@fs/${resolve(p).replace(/\\/g, '/')}`;
const report = { map, gpu, scales: [] };
for (const scale of scales) {
  const result = await page.evaluate(async ({ scale, mods, gpu }) => {
    const [cc, gm, gl] = await Promise.all(mods.map(m => import(m)));
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
    t = performance.now(); const mesh = gm.buildCityGlMesh(scene, built); res.timings.buildCityGlMesh = performance.now() - t;
    res.mesh = { ...mesh.stats, gpuMB: Math.round(gm.cityGlBytes(mesh) / 1048576 * 10) / 10 };
    res.counts = { blocks: scene.blocks.length, parcels: scene.parcels.length, streets: scene.streets.length, buildings: built.items.length };
    const c2 = document.getElementById('c2'), cgl = document.getElementById('gl');
    let renderer, glError;
    try { renderer = new gl.CityGlRenderer(cgl); t = performance.now(); res.timings.glUpload = renderer.upload(mesh); res.timings.glUploadWall = performance.now() - t; }
    catch (e) { glError = String(e); }
    const glInfo = renderer && (() => { const g = renderer.gl, e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER); })();
    res.webgl = glInfo ?? glError;
    const ex = scene.extent, W = 1500, H = 1000;
    // Pans are centred on the core of a middle tile (dense area), not on the gaps between tiles.
    const tileBoxes = scene.blocks.filter(b => b.layout === 0).map(b => cc.shapeBox(b.shape));
    const core0 = { x: tileBoxes.reduce((s, b) => s + (b.minX + b.maxX) / 2, 0) / tileBoxes.length, y: tileBoxes.reduce((s, b) => s + (b.minY + b.maxY) / 2, 0) / tileBoxes.length };
    const mid = Math.min(scale - 1, side + 1), cx0 = core0.x + (mid % side) * w, cy0 = core0.y + Math.floor(mid / side) * h;
    const ecx = (ex.minX + ex.maxX) / 2, ecy = (ex.minY + ex.maxY) / 2;
    const fitMpp = Math.max((ex.maxX - ex.minX) / W, (ex.maxY - ex.minY) / H) * 1.05;
    const box = (x, y, mpp) => ({ minX: x - W / 2 * mpp, minY: y - H / 2 * mpp, maxX: x + W / 2 * mpp, maxY: y + H / 2 * mpp });
    const layers = { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false };
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const ctx = c2.getContext('2d');
    const configs = [
      { name: 'whole city', mpp: fitMpp }, { name: 'whole city, parcels forced (near LOD)', mpp: fitMpp, lod: 'near' },
      { name: 'mid 4.5 m/px', mpp: 4.5 }, { name: 'near 1.5 m/px', mpp: 1.5 }, { name: 'close 0.4 m/px', mpp: 0.4 },
    ];
    for (const view of ['parcels', 'buildings']) {
      const colors = renderer && gl.cityGlColors(scene, built, mesh, view);
      if (renderer) { t = performance.now(); renderer.setColors(colors); res.timings[`glColors ${view}`] = performance.now() - t; }
      for (const cfg of configs) {
        const lod = cfg.lod ?? cc.selectCityLod(cfg.mpp);
        // Pans around the centre of the tiled city, at most a third of the view.
        const whole = cfg.name.startsWith('whole'), cx = whole ? ecx : cx0, cy = whole ? ecy : cy0;
        const views = Array.from({ length: 16 }, (_, i) => { const a = i / 16 * Math.PI * 2, r = whole ? W * cfg.mpp / 20 : Math.min(W * cfg.mpp / 4, 600); return box(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, cfg.mpp); });
        const row = { view, config: cfg.name, mpp: Math.round(cfg.mpp * 100) / 100, lod };
        for (const kind of ['webgl', 'canvas2d']) {
          for (let i = 0; i < 30; i++) await raf(); // drain the previous configuration's GPU work
          if (kind === 'webgl' && !renderer) continue;
          c2.style.display = kind === 'canvas2d' ? '' : 'none'; cgl.style.display = kind === 'webgl' ? '' : 'none';
          const draw = v => {
            if (kind === 'canvas2d') {
              ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); const k = 1 / cfg.mpp; ctx.setTransform(k, 0, 0, k, -v.minX * k, -v.minY * k);
              return cc.drawCity(ctx, scene, { viewport: v, mpp: cfg.mpp, dpr: 1, lod, view, palette: 'growth', width: 1, layers, buildings: built, buildingsVisible: true, appearance: { style: 'silhouette', diagnostic: 'none' } });
            }
            return renderer.draw({ viewport: v, mpp: cfg.mpp, lod, view });
          };
          // Cold frame (Path2D creation for the 2D path), then a synced frame, then cadence.
          let a = performance.now(); draw(views[0]); const cold = performance.now() - a;
          let sync;
          if (kind === 'webgl') { const px = new Uint8Array(4), g = renderer.gl; draw(views[1]); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); const xs = []; for (let i = 0; i < 7; i++) { a = performance.now(); draw(views[i % 16]); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); xs.push(performance.now() - a); } xs.sort((p, q) => p - q); sync = xs[3]; }
          else if (!gpu) { a = performance.now(); draw(views[1]); ctx.getImageData(0, 0, 1, 1); sync = performance.now() - a; }
          await raf(); await raf();
          const js = [], intervals = []; let last = performance.now();
          for (const v of views) { const s = performance.now(); draw(v); js.push(performance.now() - s); await raf(); const n = performance.now(); intervals.push(n - last); last = n; }
          const med = x => { const y = [...x].sort((p, q) => p - q); return Math.round(y[y.length >> 1] * 10) / 10; };
          let stress;
          if (kind === 'webgl') {
            // 10 full redraws per presented frame: cadence / 10 bounds the GPU cost of one frame.
            const iv = []; let l = performance.now();
            for (let f = 0; f < 12; f++) { for (let k = 0; k < 10; k++) draw(views[(f + k) % 16]); await raf(); const n = performance.now(); iv.push(n - l); l = n; }
            stress = med(iv.slice(2));
          }
          row[kind] = { stress10FrameMedian: stress, coldMs: Math.round(cold * 10) / 10, syncMs: sync === undefined ? undefined : Math.round(sync * 10) / 10, jsMedian: med(js), frameMedian: med(intervals), frameMax: Math.round(Math.max(...intervals) * 10) / 10 };
        }
        res.configs.push(row);
      }
    }
    res.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined;
    // Visual witness: the same near view in both renderers (screenshots taken from Node).
    window.__show = (kind, view, mpp) => {
      c2.style.display = kind === 'canvas2d' ? '' : 'none'; cgl.style.display = kind === 'webgl' ? '' : 'none';
      const v = box(cx0, cy0, mpp), lod = cc.selectCityLod(mpp);
      if (kind === 'webgl') { renderer.setColors(gl.cityGlColors(scene, built, mesh, view)); renderer.draw({ viewport: v, mpp, lod, view }); }
      else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); const k = 1 / mpp; ctx.setTransform(k, 0, 0, k, -v.minX * k, -v.minY * k);
        cc.drawCity(ctx, scene, { viewport: v, mpp, dpr: 1, lod, view, palette: 'growth', width: 1, layers, buildings: built, buildingsVisible: true, appearance: { style: 'silhouette', diagnostic: 'none' } }); }
    };
    window.__dispose = () => renderer?.dispose();
    return res;
  }, { scale, mods: [fs('src/render/cityCanvas.ts'), fs('src/render/cityGlMesh.ts'), fs('src/render/cityGlLayer.ts')], gpu });
  report.scales.push(result);
  console.log(JSON.stringify({ scale: result.scale, counts: result.counts, timings: Object.fromEntries(Object.entries(result.timings).map(([k, v]) => [k, Math.round(v)])), mesh: result.mesh, webgl: result.webgl, heapMB: result.heapMB }));
  for (const c of result.configs) console.log(JSON.stringify(c));
  for (const kind of ['webgl', 'canvas2d']) for (const [view, mpp] of [['buildings', 1.2], ['parcels', 0.5]]) {
    await page.evaluate(([k, v, m]) => window.__show(k, v, m), [kind, view, mpp]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${map}-x${scale}-${kind}-${view}${gpu ? '-gpu' : ''}.png` });
  }
  await page.evaluate(() => window.__dispose());
}
writeFileSync(`${out}/${map}${gpu ? '-gpu' : ''}.json`, JSON.stringify(report, null, 1));
await browser.close();
