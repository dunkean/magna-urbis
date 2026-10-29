/** One available WebGL context must suffice for retained V2 materials and PNG exports. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5187/v2.html';
const output = resolve('out/render-material-shared'); await mkdir(output, { recursive: true });
const project = JSON.parse(await readFile(process.env.MAGNA_RENDER_FIXTURE ?? 'out/v2-rust-browser/06-native-houses.json', 'utf8'));
project.settings.appearance = { style: 'atlas', terrainStyle: 'atlas', renderer: 'bench', labels: false, landuse: false };
const fixture = resolve(output, 'retained-atlas.json'); await writeFile(fixture, JSON.stringify(project));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { checks: {}, errors: [] };
async function open(mode) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(error.message));
  if (mode) await page.addInitScript(mode => {
    window.__materialContexts = 0; window.__materialRefusals = 0; window.__materialGenerationJobs = [];
    const offscreen = OffscreenCanvas.prototype.getContext, context = HTMLCanvasElement.prototype.getContext, contexts = new WeakMap();
    OffscreenCanvas.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : offscreen.call(this, type, ...args); };
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type !== 'webgl2') return context.call(this, type, ...args);
      if (contexts.has(this)) return contexts.get(this);
      if (mode === 'none' || window.__materialContexts) { window.__materialRefusals++; return null; }
      const result = context.call(this, type, ...args);
      if (result) { contexts.set(this, result); window.__materialContexts++; } return result;
    };
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (['all', 'terrain', 'region', 'roads', 'town', 'towns'].includes(args[0]?.action)) window.__materialGenerationJobs.push(args[0].action);
      return post.apply(this, args);
    };
  }, mode);
  await page.goto(`${url}?empty&lang=fr`); await page.locator('#map-style').waitFor(); return page;
}
async function importProject(page) {
  await page.locator('#import-open').click(); await page.locator('#import-scope').selectOption('complete'); await page.locator('#project-file').setInputFiles(fixture);
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#map-canvas').dataset.renderStyle === 'atlas');
}
async function style(page, value) {
  await page.locator('#map-style').selectOption(value);
  await page.waitForFunction(value => document.querySelector('#render-status').hidden && document.querySelector('#map-canvas').dataset.renderStyle === value, value);
}
try {
  const direct = await open();
  report.checks.borrowedOpaque = await direct.evaluate(async rasterUrl => {
    const { renderMaterialRaster } = await import(rasterUrl);
    const n = 32, terrain = { resolution: n, x: 0, y: 0, width: 512, height: Float32Array.from({ length: n * n }, (_, i) => 40 + i % n + Math.sin(i / n) * 8) }, settings = { seed: '42', climate: 'temperate' };
    const canvas = document.createElement('canvas'); canvas.width = 157; canvas.height = 113;
    const gl = canvas.getContext('webgl2', { alpha: false, preserveDrawingBuffer: true });
    gl.clearColor(.2, .3, .6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const pixels = () => { const data = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data); return [...data]; };
    const before = pixels(), texture = gl.createTexture(), vao = gl.createVertexArray();
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, texture); gl.bindVertexArray(vao);
    gl.viewport(3, 4, 101, 67); gl.enable(gl.BLEND); gl.enable(gl.SCISSOR_TEST); gl.colorMask(false, true, false, true); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    const exact = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    for (const enhanced of [false, true]) {
      const forest = enhanced ? { renderV2: 1, v2Season: .5 } : undefined;
      const baseline = renderMaterialRaster(terrain, settings, enhanced, forest);
      const borrowed = renderMaterialRaster(terrain, settings, enhanced, forest, { canvas, gl });
      if (!exact(baseline.rgb, borrowed.rgb) || !exact(baseline.canopyAlpha, borrowed.canopyAlpha)) throw new Error('Borrowed opaque context changed RGBA material pixels.');
      if (canvas.width !== 157 || canvas.height !== 113 || !exact(before, pixels())) throw new Error('Borrowing altered the live map buffer.');
      if (!exact([...gl.getParameter(gl.VIEWPORT)], [3, 4, 101, 67]) || gl.getParameter(gl.ACTIVE_TEXTURE) !== gl.TEXTURE5 || gl.getParameter(gl.TEXTURE_BINDING_2D) !== texture || gl.getParameter(gl.VERTEX_ARRAY_BINDING) !== vao || !gl.isEnabled(gl.BLEND) || !gl.isEnabled(gl.SCISSOR_TEST) || !exact(gl.getParameter(gl.COLOR_WRITEMASK), [false, true, false, true]) || gl.getParameter(gl.UNPACK_ALIGNMENT) !== 2) throw new Error('Borrowing altered the live map state.');
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error after material composition.');
    }
    return { rgbaExact: true, liveBufferRetained: true, liveStateRestored: true };
  }, `${new URL(url).origin}/@fs/${resolve('../rust/bridge/terrainMaterialRaster.ts').replaceAll('\\', '/')}`);
  await direct.close();

  const page = await open('one'); await importProject(page);
  for (const value of ['render', 'render3d', 'render-v2']) await style(page, value);
  await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('png'); await page.locator('#export-crop').uncheck(); await page.locator('#export-resolution').selectOption('1600');
  const pending = page.waitForEvent('download'); await page.locator('#export-go').click(); const download = await pending;
  const png = resolve(output, 'one-context.png'); await download.saveAs(png); assert((await readFile(png)).length > 10000);
  const one = await page.evaluate(() => ({ contexts: window.__materialContexts, extraRefusals: window.__materialRefusals, generationJobs: window.__materialGenerationJobs, toastError: !document.querySelector('#toast').hidden && document.querySelector('#toast').dataset.error === 'true' }));
  assert.equal(one.contexts, 1); assert.equal(one.extraRefusals, 0); assert.equal(one.toastError, false); assert.deepEqual(one.generationJobs, []);
  report.checks.oneContext = { ...one, pngExported: true }; await page.close();

  const unavailable = await open('none'); await importProject(unavailable);
  const before = await unavailable.locator('#map-canvas').evaluate(canvas => canvas.toDataURL());
  await unavailable.locator('#map-style').selectOption('render');
  await unavailable.waitForFunction(() => document.querySelector('#render-status').dataset.error === 'true');
  assert.match(await unavailable.locator('#render-status').textContent(), /WebGL2/);
  assert.equal(await unavailable.locator('#map-canvas').evaluate(canvas => canvas.toDataURL()), before);
  await style(unavailable, 'parchment');
  assert.deepEqual(await unavailable.evaluate(() => window.__materialGenerationJobs), []);
  report.checks.noContext = { previousMapRetained: true, explicitNotice: true, cartographyRecovered: true, generationJobs: [] }; await unavailable.close();
  assert.deepEqual(report.errors, []); report.ok = true; console.log(JSON.stringify(report));
} catch (error) { report.ok = false; report.failure = String(error.stack ?? error); console.error(report.failure); process.exitCode = 1; }
finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
