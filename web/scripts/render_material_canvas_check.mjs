/** Reproduce page-only WebGL2: identical materials, retained V2 Render view and PNG export. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5187/v2.html';
const output = resolve('out/render-material-canvas'); await mkdir(output, { recursive: true });
const project = JSON.parse(await readFile(process.env.MAGNA_RENDER_FIXTURE ?? 'out/v2-rust-browser/06-native-houses.json', 'utf8'));
project.settings.appearance = { style: 'parchment', terrainStyle: 'render', renderer: 'bench', labels: false, landuse: false };
const fixture = resolve(output, 'retained-render.json'); await writeFile(fixture, JSON.stringify(project));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(120000);
const report = { checks: {}, errors: [] }; page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => {
  window.__materialGenerationJobs = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) {
    if (['all', 'terrain', 'region', 'roads', 'town', 'towns'].includes(args[0]?.action)) window.__materialGenerationJobs.push(args[0].action);
    return post.apply(this, args);
  };
});
try {
  await page.goto(`${url}?empty&lang=fr`); await page.locator('#map-style').waitFor();
  const rasterUrl = `${new URL(url).origin}/@fs/${resolve('../rust/bridge/terrainMaterialRaster.ts').replaceAll('\\', '/')}`;
  report.checks.shaderParity = await page.evaluate(async rasterUrl => {
    const offscreen = OffscreenCanvas.prototype.getContext, pageContext = HTMLCanvasElement.prototype.getContext, contexts = [];
    OffscreenCanvas.prototype.getContext = function (type, ...args) { const result = offscreen.call(this, type, ...args); if (type === 'webgl2' && result) contexts.push(result); return result; };
    const { renderMaterialRaster } = await import(rasterUrl);
    const n = 32, width = 512, terrain = { resolution: n, x: 0, y: 0, width, height: Float32Array.from({ length: n * n }, (_, i) => 40 + i % n + Math.sin(i / n) * 8) };
    const settings = { seed: '42', climate: 'temperate' }, before = terrain.height.slice();
    const original = renderMaterialRaster(terrain, settings), satellite = renderMaterialRaster(terrain, settings, true, { renderV2: 1, v2Season: .5 });
    if (contexts.length !== 2) throw new Error(`Expected two baseline shader contexts, got ${contexts.length}`);
    for (const gl of contexts) gl.getExtension('WEBGL_lose_context').loseContext();
    await new Promise(resolve => setTimeout(resolve, 50));
    let domContexts = 0;
    OffscreenCanvas.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : offscreen.call(this, type, ...args); };
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { const result = pageContext.call(this, type, ...args); if (type === 'webgl2' && result) domContexts++; return result; };
    const fallback = renderMaterialRaster(terrain, settings), fallbackSatellite = renderMaterialRaster(terrain, settings, true, { renderV2: 1, v2Season: .5 });
    const exact = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
    if (!exact(original.rgb, fallback.rgb) || !exact(satellite.rgb, fallbackSatellite.rgb)) throw new Error('Page canvas changed material pixels.');
    if (!exact(before, terrain.height)) throw new Error('Raster composition changed retained heights.');
    return { originalExact: true, satelliteExact: true, heightsRetained: true, domContexts };
  }, rasterUrl);
  assert.equal(report.checks.shaderParity.domContexts, 2);
  assert.equal(await page.locator('#map-style option[value="render"]').count(), 1);
  assert.equal(await page.locator('[data-setting-path="appearance.terrainStyle"] option[value="render"]').count(), 1);
  await page.locator('#import-open').click(); await page.locator('#import-scope').selectOption('complete'); await page.locator('#project-file').setInputFiles(fixture);
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#render-status').hidden && document.querySelector('#map-canvas').dataset.renderStyle === 'render');
  const toast = await page.locator('#toast').evaluate(element => ({ hidden: element.hidden, error: element.dataset.error, text: element.textContent }));
  assert(toast.hidden || toast.error !== 'true', toast.text);
  await page.screenshot({ path: resolve(output, 'render-view-page-canvas.png') });
  await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('png');
  await page.locator('#export-crop').uncheck(); await page.locator('#export-resolution').selectOption('1600');
  const pending = page.waitForEvent('download'); await page.locator('#export-go').click(); const download = await pending;
  const png = resolve(output, 'render-page-canvas.png'); await download.saveAs(png);
  assert((await readFile(png)).length > 10000);
  assert.deepEqual(await page.evaluate(() => window.__materialGenerationJobs), []); assert.deepEqual(report.errors, []);
  report.checks.v2 = { originalRenderListed: true, renderedStyle: 'render', pngExported: true, generationJobs: [] }; report.ok = true;
  console.log(JSON.stringify(report));
} catch (error) {
  report.ok = false; report.failure = String(error.stack ?? error); process.exitCode = 1;
  report.state = await page.evaluate(() => ({ canvas: { ...document.querySelector('#map-canvas').dataset }, status: document.querySelector('#render-status').outerHTML, toast: document.querySelector('#toast').outerHTML })).catch(() => null);
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); console.error(report.failure);
} finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
