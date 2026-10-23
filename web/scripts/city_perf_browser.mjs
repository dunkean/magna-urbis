// From web/: node scripts/city_perf_browser.mjs --map city-01-river-plain-l --request out/city-perf/check/<map>-quarters-request.json
//   [--server http://127.0.0.1:8790] [--out out/city-perf/browser] [--gpu] [--architecture silhouette|compact] [--no-buildings]
// Drives the real City Bench (native profile) in a headless Chrome and measures the
// main thread: worker → main message arrival, long tasks, sampled CPU profile per
// phase (quarters, parcels, buildings, camera), first display, per-frame cost when
// panning / zooming at far, mid, near and close zoom in each view, JS heap.
// Default: --disable-gpu (software Canvas 2D, the 5090 stays untouched). --gpu uses
// ANGLE D3D11; the script prints the WebGL renderer so the adapter can be checked.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const server = option('server', 'http://127.0.0.1:8790'), map = option('map', 'city-01-river-plain-l');
const out = option('out', 'out/city-perf/browser'), gpu = args.includes('--gpu'), readback = args.includes('--readback'), architecture = option('architecture', 'silhouette');
const request = JSON.parse(readFileSync(option('request', `out/city-perf/check/${map}-quarters-request.json`), 'utf8'));
const site = request.sites[0];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true,
  args: gpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] : ['--disable-gpu', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__perf = { longtasks: [], messages: [], frames: [] };
  try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask API */ }
  // Worker replies: arrival on the main thread (after structured-clone deserialization) and end of the handling task.
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', e => {
        const row = { at: performance.now(), keys: (Array.isArray(e.data) ? `array[${e.data.length}]` : Object.keys(e.data ?? {}).filter(k => k !== 'id').join(',')).slice(0, 60) };
        window.__perf.messages.push(row);
        setTimeout(() => { row.handledBy = performance.now(); }, 0);
      });
    }
  };
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Performance.enable');

const report = { map, server, gpu, architecture, phases: [], camera: [], errors };
const now = () => page.evaluate(() => performance.now());
const heap = async () => { const h = await cdp.send('Runtime.getHeapUsage'); return Math.round(h.usedSize / 1048576); };
/** Self time per function of a CPU profile, top N. */
function hot(profile, n = 14) {
  const byId = new Map(profile.nodes.map(node => [node.id, node])), self = new Map();
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame, key = `${f.functionName || '(anon)'} ${f.url ? f.url.split('/').pop().split('?')[0] + ':' + (f.lineNumber + 1) : ''}`.trim();
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  const total = [...self.entries()].filter(([k]) => k !== '(idle)').reduce((s, [, v]) => s + v, 0);
  return { busyMs: Math.round(total), top: [...self.entries()].filter(([k]) => k !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v)]) };
}
async function phase(name, run) {
  const t0 = await now(); await cdp.send('Profiler.start');
  const wall0 = Date.now(); await run(); const wall = Date.now() - wall0;
  const { profile } = await cdp.send('Profiler.stop'); const t1 = await now();
  const perf = await page.evaluate(([a, b]) => ({
    longtasks: window.__perf.longtasks.filter(([s]) => s >= a && s <= b),
    messages: window.__perf.messages.filter(m => m.at >= a && m.at <= b).map(m => ({ keys: m.keys, at: Math.round(m.at - a), handledMs: m.handledBy ? Math.round(m.handledBy - m.at) : undefined })),
  }), [t0, t1]);
  const lt = perf.longtasks;
  const row = { phase: name, wallMs: wall, longTasks: lt.length, longTaskMs: Math.round(lt.reduce((s, [, d]) => s + d, 0)), maxLongTaskMs: Math.round(Math.max(0, ...lt.map(([, d]) => d))),
    messages: perf.messages.filter(m => m.keys !== 'progress'), heapMB: await heap(), profile: hot(profile) };
  report.phases.push(row);
  console.log(JSON.stringify({ ...row, profile: { busyMs: row.profile.busyMs, top: row.profile.top.slice(0, 6) } }));
  return row;
}
const busy = sel => page.locator(sel).getAttribute('aria-busy');
const idle = (sel, timeout = 900000) => page.waitForFunction(s => document.querySelector(s)?.getAttribute('aria-busy') !== 'true', sel, { timeout });
const frameText = () => page.evaluate(() => document.querySelector('[data-city-frame]')?.textContent ?? '');
async function waitFrameChange(before, timeout = 120000) {
  await page.waitForFunction(b => { const t = document.querySelector('[data-city-frame]')?.textContent ?? ''; return t && t !== b; }, before, { timeout }).catch(() => {});
}

const url = new URL('http://127.0.0.1:5173/citybench.html');
for (const [k, v] of Object.entries({ standalone: '1', profile: 'local', localServer: server, artifact: map })) url.searchParams.set(k, v);
await phase('load+quarters (to first city frame)', async () => {
  await page.goto(url.href);
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), undefined, { timeout: 120000 });
  await page.waitForTimeout(1500);
  if (await busy('#urbanQuarterStage [data-apply]') !== 'true' && !(await frameText())) await page.locator('#urbanQuarterStage [data-apply]').click();
  await idle('#urbanQuarterStage [data-apply]');
  await page.waitForFunction(() => (document.querySelector('[data-city-frame]')?.textContent ?? '').includes('îlots'), undefined, { timeout: 120000 });
});
if (gpu) report.webgl = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'no webgl2'; });
if (gpu) console.log('WebGL renderer:', report.webgl);
await page.locator('#focusCity').click(); await page.waitForTimeout(300);
await phase('parcels (click → frame)', async () => {
  const before = await frameText();
  await page.locator('#urbanParcelStage [data-apply]').click();
  await page.waitForFunction(() => document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') === 'true', undefined, { timeout: 30000 }).catch(() => {});
  await idle('#urbanParcelStage [data-apply]');
  await waitFrameChange(before);
  await page.waitForTimeout(300);
});
if (!args.includes('--no-buildings')) {
  if (architecture !== 'silhouette') await page.locator('[data-city-architecture]').selectOption(architecture);
  await phase(`buildings ${architecture} (click → scene)`, async () => {
    await page.locator('[data-buildings-generate]').click();
    await page.waitForFunction(() => document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') === 'true', undefined, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('[data-buildings-generate]')?.getAttribute('aria-busy') !== 'true', undefined, { timeout: 900000 });
    await page.waitForTimeout(500);
  });
  report.buildingStatus = await page.locator('[data-buildings-status]').textContent();
  report.cityCounts = await page.locator('[data-city-building-counts]').textContent().catch(() => '');
  console.log(report.buildingStatus, '|', report.cityCounts);
}

// Camera: each step = restore(view) → city rAF paint → forced Canvas flush (getImageData 1 px) → next rAF.
async function camera(view, label, views) {
  await page.locator(`[data-urban-view="${view}"]`).click(); await page.waitForTimeout(200);
  const t0 = await now(); await cdp.send('Profiler.start');
  const steps = await page.evaluate(async ([list, readback]) => {
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const canvas = document.querySelector('foreignObject[data-city-canvas] canvas'), info = document.querySelector('[data-city-frame]');
    const rows = []; await raf(); await raf(); let last = performance.now();
    // Each step is issued from the previous rAF callback: `interval` is the presented
    // frame cadence (16.7 ms floor), so raster/compositor backpressure shows up even
    // when it runs off the main thread (GPU process). `flush` (readback) only with --readback:
    // repeated getImageData demotes an accelerated canvas to software in Chrome.
    for (const v of list) {
      const a = performance.now(); window.magnaBenchContext.restore({ view: v }); const b = performance.now();
      await raf(); const c = performance.now();
      let flush;
      if (readback) { canvas?.getContext('2d').getImageData(0, 0, 1, 1); flush = performance.now() - c; await raf(); }
      const text = info?.textContent ?? '', m = text.match(/·\s*([\d.]+)\s*ms$/);
      rows.push({ setView: b - a, toPaint: c - a, drawCity: m ? +m[1] : undefined, flush, frame: c - last, text });
      last = performance.now();
    }
    return rows;
  }, [views, readback]);
  const { profile } = await cdp.send('Profiler.stop'); const t1 = await now();
  const lt = await page.evaluate(([a, b]) => window.__perf.longtasks.filter(([s]) => s >= a && s <= b), [t0, t1]);
  const med = k => { const v = steps.map(s => s[k]).filter(x => x !== undefined).sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor(v.length / 2)] * 10) / 10 : undefined; };
  const max = k => Math.round(Math.max(...steps.map(s => s[k] ?? 0)) * 10) / 10;
  const busyPerStep = Math.round(hot(profile).busyMs / steps.length * 10) / 10;
  const row = { view, label, steps: steps.length, busyPerStep, medianToPaint: med('toPaint'), medianSetView: med('setView'), medianDrawCity: med('drawCity'), maxDrawCity: max('drawCity'), medianFlush: med('flush'), maxFlush: max('flush'), medianFrame: med('frame'), maxFrame: max('frame'), longTasks: lt.length,
    sample: steps[Math.floor(steps.length / 2)].text, profile: hot(profile, 8) };
  report.camera.push(row); console.log(JSON.stringify({ ...row, profile: row.profile.top.slice(0, 4) }));
}
const W = 1500, cx = site.center.x, cy = site.center.y, R = site.radius;
const pan = (mpp, n = 12) => Array.from({ length: n }, (_, i) => ({ cx: cx + Math.cos(i / n * 2 * Math.PI) * Math.min(R, W * mpp * 0.4), cy: cy + Math.sin(i / n * 2 * Math.PI) * Math.min(R, W * mpp * 0.25), scale: 1 / mpp }));
const zooms = { far: 14, mid: 4.5, near: 1.5, close: 0.4 };
for (const view of ['tissue', 'parcels', 'buildings', 'roles']) for (const [label, mpp] of Object.entries(zooms)) await camera(view, `${label} ${mpp} m/px pan`, pan(mpp));
const sweep = Array.from({ length: 24 }, (_, i) => ({ cx, cy, scale: 1 / (14 * Math.pow(0.35 / 14, i / 23)) }));
await camera('buildings', 'zoom sweep 14 → 0.35 m/px', sweep);
await camera('parcels', 'zoom sweep 14 → 0.35 m/px', sweep);
report.heapMB = await heap();
report.metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(m => /Heap|Nodes|LayoutCount|RecalcStyleCount|TaskDuration|ScriptDuration/.test(m.name)).map(m => [m.name, Math.round(m.value * 100) / 100]));
await page.locator('#viewport').screenshot({ path: `${out}/${map}-${architecture}${gpu ? '-gpu' : ''}.png` });
writeFileSync(`${out}/${map}-${architecture}${gpu ? '-gpu' : ''}${readback ? '-readback' : ''}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ heapMB: report.heapMB, metrics: report.metrics, errors }));
await browser.close();
