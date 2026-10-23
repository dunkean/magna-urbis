// From web/: node scripts/city_perf_trace.mjs [--map city-01-river-plain-l] [--server http://127.0.0.1:8790] [--gpu] [--parcels] [--out out/city-perf/trace]
// Chrome trace of City Bench camera steps (after the plan, optionally parcels):
// per step, where the main thread (renderer) and the GPU process spend time, by
// trace event name (Paint, Layout, FunctionCall, raster/GPU tasks…). Complements
// city_perf_browser.mjs, whose sampled profile lumps native work into "(program)".
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const server = option('server', 'http://127.0.0.1:8790'), map = option('map', 'city-01-river-plain-l'), out = option('out', 'out/city-perf/trace'), gpu = args.includes('--gpu');
const request = JSON.parse(readFileSync(option('request', `out/city-perf/check/${map}-quarters-request.json`), 'utf8')), site = request.sites[0];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true, args: gpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const url = new URL('http://127.0.0.1:5173/citybench.html');
for (const [k, v] of Object.entries({ standalone: '1', profile: 'local', localServer: server, artifact: map })) url.searchParams.set(k, v);
await page.goto(url.href);
await page.waitForFunction(() => window.magnaBenchContext?.ready(), undefined, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.waitForFunction(() => (document.querySelector('[data-city-frame]')?.textContent ?? '').includes('îlots'), undefined, { timeout: 300000 });
if (args.includes('--parcels')) {
  await page.locator('#urbanParcelStage [data-apply]').click();
  await page.waitForFunction(() => document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') === 'true', undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') !== 'true', undefined, { timeout: 600000 });
  await page.locator('[data-urban-view="parcels"]').click();
}
const report = { map, gpu, runs: [] };
for (const [label, mpp] of [['far', 14], ['mid', 4.5], ['near', 1.5]]) {
  const views = Array.from({ length: 12 }, (_, i) => ({ cx: site.center.x + Math.cos(i / 12 * 2 * Math.PI) * Math.min(site.radius, 1500 * mpp * 0.4), cy: site.center.y + Math.sin(i / 12 * 2 * Math.PI) * Math.min(site.radius, 1000 * mpp * 0.25), scale: 1 / mpp }));
  await page.evaluate(v => window.magnaBenchContext.restore({ view: v }), views[0]); await page.waitForTimeout(500);
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'gpu', 'viz', 'cc', 'blink', 'v8'] });
  await page.evaluate(async list => {
    const raf = () => new Promise(r => requestAnimationFrame(r));
    for (const v of list) { window.magnaBenchContext.restore({ view: v }); await raf(); }
    await raf(); await raf();
  }, views);
  const trace = JSON.parse((await browser.stopTracing()).toString());
  const events = trace.traceEvents ?? trace;
  // Threads by name.
  const names = new Map(); for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  const sums = {}, add = (thread, name, dur) => { const t = sums[thread] ??= {}; t[name] = (t[name] ?? 0) + dur; };
  // Top-level "X" events only (no nesting double count): for each thread keep events not contained in a previous one.
  const byThread = new Map();
  for (const e of events) if (e.ph === 'X' && e.dur) { const k = `${e.pid}:${e.tid}`; if (!byThread.has(k)) byThread.set(k, []); byThread.get(k).push(e); }
  for (const [k, list] of byThread) {
    const thread = names.get(k) ?? k; if (!/CrRendererMain|CrGpuMain|VizCompositor|Compositor|Raster|DedicatedWorker/.test(thread)) continue;
    list.sort((a, b) => a.ts - b.ts); let end = -1;
    // Second level: children of the top-level task (what the task did).
    for (const e of list) { if (e.ts >= end) { add(thread.replace(/\d+$/, ''), '(task total)', e.dur); end = e.ts + e.dur; } }
    // Self time by event name (nesting resolved with a stack), so wrappers such as RunTask do not hide the work.
    const stack = [];
    for (const e of list) {
      while (stack.length && e.ts >= stack[stack.length - 1].end) stack.pop();
      if (stack.length) stack[stack.length - 1].self -= e.dur;
      const node = { name: e.name, end: e.ts + e.dur, self: e.dur };
      stack.push(node); (node.thread = thread.replace(/\d+$/, ''));
      e.__node = node;
    }
    for (const e of list) add(e.__node.thread, e.name, Math.max(0, e.__node.self));
  }
  const per = Object.fromEntries(Object.entries(sums).map(([t, m]) => [t, Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, d]) => [n, Math.round(d / 1000 / views.length * 10) / 10]))]));
  report.runs.push({ label, mpp, perStepMs: per });
  console.log(label, JSON.stringify(per));
}
writeFileSync(`${out}/${map}${gpu ? '-gpu' : ''}.json`, JSON.stringify(report, null, 1));
await browser.close();
