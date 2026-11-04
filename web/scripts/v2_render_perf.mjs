/** Render perf of a static V2 build on a retained native-city project (no generation).
 *  node scripts/v2_render_perf.mjs --dist <dir> --out <json> [--runs 5] [--shots <dir>] */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const dist = resolve(arg('dist')), outFile = resolve(arg('out', resolve(web, 'out/v2-render-perf/run.json')));
const runs = Number(arg('runs', 5)), shots = arg('shots') && resolve(arg('shots'));
const fixture = process.env.MAGNA_RENDER_FIXTURE ?? resolve(web, 'out/v2-rust-browser/06-native-houses.json');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (path === '/') path = '/v2.html';
  const file = normalize(join(dist, path));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  try { if (!file.startsWith(dist) || !statSync(file).isFile()) throw 0; res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); createReadStream(file).pipe(res); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const median = values => { const v = values.filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const round = x => x == null ? null : Math.round(x * 10) / 10;
const report = { dist, time: new Date().toISOString(), runs, metrics: {}, errors: [] };
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
try {
  if (shots) await mkdir(shots, { recursive: true });
  const newPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.addInitScript(() => {
      window.__presents = []; window.__sigs = [];
      const proto = window.ImageBitmapRenderingContext?.prototype, native = proto?.transferFromImageBitmap;
      // A present is stamped when it happens; its content signature (48x48 average) is read right after.
      const probe = document.createElement('canvas'); probe.width = probe.height = 48; const pc = probe.getContext('2d', { willReadFrequently: true });
      // Direct presentation exposes stacked canvases; sample them in the drawing task, before GPU buffers clear.
      window.__recordDirect = canvas => {
        if (canvas.dataset.presentation !== 'direct') return;
        const layers = canvas.previousElementSibling?.querySelectorAll('canvas');
        if (!layers?.length) return;
        pc.clearRect(0, 0, 48, 48);
        for (const layer of layers) pc.drawImage(layer, 0, 0, 48, 48);
        window.__presents.push(performance.now()); window.__sigs.push(pc.getImageData(0, 0, 48, 48).data);
      };
      if (native) proto.transferFromImageBitmap = function (bitmap) {
        const r = native.call(this, bitmap), canvas = this.canvas, i = window.__presents.length; window.__presents.push(performance.now()); window.__sigs.push(null);
        queueMicrotask(() => { try { pc.clearRect(0, 0, 48, 48); pc.drawImage(canvas, 0, 0, 48, 48); window.__sigs[i] = pc.getImageData(0, 0, 48, 48).data; } catch {} });
        return r;
      };
    });
    const page = await context.newPage(); page.setDefaultTimeout(120000);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/v2.html?empty&lang=en`, { waitUntil: 'domcontentloaded' });
    await page.locator('#map-style').waitFor();
    await page.evaluate(() => {
      const canvas = document.querySelector('#map-canvas');
      new MutationObserver(() => window.__recordDirect(canvas)).observe(canvas, { attributes: true, attributeFilter: ['data-city-render'] });
      const quietMs = 350;
      window.__reveal = sel => { const el = document.querySelector(sel); for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true; return el; };
      window.__fire = (el, types) => { for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true })); };
      window.__nextPresent = (n0, timeout) => new Promise(resolve => { const t = performance.now(); const tick = () => { if (window.__presents.length > n0) resolve(window.__presents[n0]); else if (performance.now() - t > timeout) resolve(null); else setTimeout(tick, 2); }; tick(); });
      const differs = (a, b) => { if (!a || !b) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; };
      /** First present after n0 whose content differs from sig0 (a stale re-present does not count). */
      window.__nextChange = (n0, sig0, timeout) => new Promise(resolve => { const t = performance.now(); const tick = () => {
        for (let i = n0; i < window.__presents.length; i++) if (differs(window.__sigs[i], sig0)) return resolve(window.__presents[i]);
        if (performance.now() - t > timeout) resolve(null); else setTimeout(tick, 2); }; tick(); });
      window.__settle = async n0 => { // last present before a quiet window with the renderer idle
        let last = window.__presents.length > n0 ? window.__presents.at(-1) : null;
        for (;;) {
          await new Promise(r => setTimeout(r, 60));
          const status = document.querySelector('#render-status'), busy = status && !status.hidden;
          const n = window.__presents.length; if (n > n0) last = window.__presents[n - 1];
          if (!busy && performance.now() - (last ?? 0) > quietMs && (last != null || performance.now() - window.__t0 > 5000)) return last;
        }
      };
    });
    return page;
  };
  /** Apply a UI change in-page and time its first / settled presented frame. */
  const change = (page, op) => page.evaluate(async ({ kind, sel, value }) => {
    const n0 = window.__presents.length, el = kind === 'style' ? document.querySelector(sel) : window.__reveal(sel);
    const sig0 = window.__sigs.at(-1); window.__t0 = performance.now(); const t0 = window.__t0;
    if (kind === 'style') { el.value = value; window.__fire(el, ['input', 'change']); }
    else if (kind === 'check') { el.checked = value; window.__fire(el, ['input', 'change']); }
    else { el.value = value; window.__fire(el, ['input', 'change']); }
    const first = await window.__nextChange(n0, sig0, 6000), settled = await window.__settle(n0);
    return { first: first == null ? null : first - t0, settled: settled == null ? null : settled - t0, passes: document.querySelector('#map-canvas').dataset.renderPasses ?? null };
  }, op);
  const idle = page => page.evaluate(async () => { window.__t0 = performance.now(); await window.__settle(window.__presents.length); });
  const record = (name, samples) => { report.metrics[name] = { first: round(median(samples.map(s => s.first))), settled: round(median(samples.map(s => s.settled))), samples: samples.map(s => [round(s.first), round(s.settled)]), passes: samples.map(s => s.passes).filter(x => x != null) }; console.log(name, report.metrics[name].first, report.metrics[name].settled, report.metrics[name].passes.at(-1) ?? ''); };
  const openProject = async page => {
    await page.locator('#import-open').click(); await page.locator('#import-scope').selectOption('complete');
    await page.evaluate(() => { window.__t0 = performance.now(); });
    const t0 = await page.evaluate(() => performance.now()), n0 = await page.evaluate(() => window.__presents.length);
    await page.locator('#project-file').setInputFiles(fixture); await page.locator('#import-dialog').waitFor({ state: 'hidden', timeout: 180000 });
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
    const firstAt = await page.evaluate(n => window.__nextPresent(n, 60000), n0), settledAt = await page.evaluate(n => window.__settle(n), n0);
    return { first: firstAt - t0, settled: settledAt - t0 };
  };

  // Open: median of 3 fresh pages.
  const opens = []; let page;
  for (let i = 0; i < Number(arg('opens', 3)); i++) { if (page) await page.context().close(); page = await newPage(); opens.push(await openProject(page)); }
  record('openProject', opens);
  report.renderer = await page.locator('#map-canvas').getAttribute('data-renderer');
  report.cityRender = await page.locator('#map-canvas').getAttribute('data-city-render');

  if (process.argv.includes('--only-open')) { await page.context().close(); throw Object.assign(new Error('only-open'), { stack: 'only-open' }); }
  const styleOp = value => ({ kind: 'style', sel: '#map-style', value });
  const f = path => `[data-setting-path="appearance.${path}"]`;
  // Switch parchment -> render-v2 (alternating so every sample is a real switch).
  await change(page, styleOp('parchment')); await idle(page);
  const sw = []; for (let i = 0; i < runs; i++) { sw.push(await change(page, styleOp('render-v2'))); await change(page, styleOp('parchment')); }
  record('switchParchmentToRenderV2', sw);
  await change(page, styleOp('render-v2')); await idle(page);
  const series = (name, make) => (async () => { const s = []; for (let i = 0; i < runs; i++) s.push(await change(page, make(i))); record(name, s); })();
  await series('seasonChange', i => ({ kind: 'num', sel: f('season'), value: [.1, .8, .3, .65, .9, .2][i % 6] }));
  await series('paperColourChange', i => ({ kind: 'num', sel: '[data-render-color="paper"]', value: ['#d8c8a0', '#c0d0e0', '#e0c0c0', '#b0e0b0', '#f0f0c0', '#a0a0a0'][i % 6] }));
  await series('riverColourChange', i => ({ kind: 'num', sel: '[data-render-color="river"]', value: ['#2060a0', '#40a0c0', '#104060', '#6080c0', '#305070', '#80b0d0'][i % 6] }));
  await series('lightingAzimuthChange', i => ({ kind: 'num', sel: f('lighting.azimuth'), value: [40, 120, 200, 280, 330, 75][i % 6] }));
  await series('toggleLabels', i => ({ kind: 'check', sel: f('labels'), value: i % 2 === 1 }));
  await change(page, { kind: 'check', sel: f('labels'), value: true });

  // 40 pan frames, each paced on the previous present.
  const box = await page.locator('#map-canvas').boundingBox();
  const pan = await (async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    const t0 = await page.evaluate(() => performance.now()); let frames = 0;
    for (let i = 0; i < 40; i++) {
      const n0 = await page.evaluate(() => window.__presents.length);
      await page.mouse.move(box.x + box.width / 2 + (i % 20 < 10 ? 1 : -1) * (i % 10 + 1) * 14, box.y + box.height / 2 + (i % 2 ? 6 : -6) * (i % 10 + 1));
      const got = await page.evaluate(n => window.__nextPresent(n, 1500), n0); if (got != null) frames++;
    }
    const total = await page.evaluate(t => performance.now() - t, t0); await page.mouse.up(); await idle(page);
    return { msPerFrame: round(total / 40), presented: frames };
  })();
  report.metrics.pan40 = pan; console.log('pan40', pan);

  // PNG export 4096 (whole map, no crop).
  await page.locator('#render-settings').evaluate(e => { e.open = false; });
  const exportPng = async () => {
    await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('png');
    await page.locator('#export-crop').uncheck(); await page.locator('#export-resolution').selectOption('4096');
    const t0 = Date.now(), downloading = page.waitForEvent('download', { timeout: 240000 });
    await page.locator('#export-go').click(); const d = await downloading; await d.path(); const ms = Date.now() - t0;
    await page.locator('#export-dialog').waitFor({ state: 'hidden' }); return ms;
  };
  const exps = []; for (let i = 0; i < Math.min(runs, 3); i++) { const ms = await exportPng(); exps.push({ first: ms, settled: ms }); }
  record('exportPng4096', exps);

  if (shots) {
    for (const style of ['parchment', 'render-v2', 'render3d', 'fantasy-color']) {
      await change(page, styleOp(style)); await idle(page);
      await page.locator('#map').screenshot({ path: join(shots, `${arg('label', 'run')}-${style}.png`) });
    }
  }
  const heap = await page.evaluate(() => { gc(); return performance.memory.usedJSHeapSize / 1048576; });
  report.metrics.jsHeapMB = round(heap); console.log('heap', report.metrics.jsHeapMB);
} catch (e) { report.error = e.stack; process.exitCode = 1; console.error(e); }
finally {
  await browser.close(); server.close();
  await mkdir(resolve(outFile, '..'), { recursive: true }); await writeFile(outFile, JSON.stringify(report, null, 2));
  console.log('errors:', report.errors.slice(0, 5), '->', outFile);
}
