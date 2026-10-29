/** Fast-opening V2 cartographic 3D, on a real software WebGL2 context. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175';
const out = new URL('../out/v2-urban-3d/', import.meta.url);
const moduleRoot = '/@fs/' + fileURLToPath(new URL('../src/v2', import.meta.url)).replace(/\\/g, '/');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let page;
const result = { errors: [] };
try {
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.addInitScript(() => {
    window.__v2GlCounts = { uniforms: 0, draws: 0 };
    const prototype = WebGL2RenderingContext.prototype, location = prototype.getUniformLocation, arrays = prototype.drawArrays, elements = prototype.drawElements;
    prototype.getUniformLocation = function (...args) { window.__v2GlCounts.uniforms++; return location.apply(this, args); };
    prototype.drawArrays = function (...args) { window.__v2GlCounts.draws++; return arrays.apply(this, args); };
    prototype.drawElements = function (...args) { window.__v2GlCounts.draws++; return elements.apply(this, args); };
  });
  page.on('pageerror', error => result.errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${base}/v2.html?empty&lang=en`, { waitUntil: 'domcontentloaded' });
  result.open = await page.evaluate(async moduleRoot => {
    const { mountV2Urban3d } = await import(moduleRoot + '/urban3d.ts');
    const { defaultSettings } = await import(moduleRoot + '/settings.ts');
    const settings = defaultSettings(), n = 64, width = 2800;
    const height = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) height[y * n + x] = 30 + 25 * Math.sin(x / 15) * Math.sin(y / 18);
    const world = { seed: '3d-render-fixture', options: settings.options, mapSize: width,
      terrain: { height: { w: n, h: n, cell: width / n, data: height }, water: new Uint8Array(n * n), filled: height, seaLevel: 0, coastline: [], lakes: [], rivers: [] } };
    const host = document.createElement('div'); host.id = 'v2-3d-test-host'; host.style.cssText = 'position:fixed;inset:0;z-index:10000'; document.body.append(host);
    const started = performance.now(), view = await mountV2Urban3d({ host, getWorld: () => world, getSettings: () => settings });
    view.show(); window.__v2RenderingTest = { view, host };
    const elapsed = performance.now() - started;
    await new Promise(resolve => setTimeout(resolve, 300));
    const canvas = host.querySelector('canvas'), gl = canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { elapsedMs: Math.round(elapsed), shader: canvas.dataset.terrainShader, parallelShaderCompile: !!gl.getExtension('KHR_parallel_shader_compile'), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), stats: view.stats() };
  }, moduleRoot);
  assert.equal(result.open.shader, 'map');
  assert(result.open.elapsedMs < 10000, `Cartographic 3D startup took ${result.open.elapsedMs} ms`);
  await page.waitForFunction(() => { const lod = window.__v2RenderingTest.view.stats().lod; return lod?.pending === 0 && lod.ready === lod.tiles; });
  await page.waitForTimeout(300);
  await page.locator('#v2-3d-test-host').screenshot({ path: new URL('cartographic-software.png', out).pathname.replace(/^\/(\w:)/, '$1') });
  result.responsive = await page.evaluate(() => { const stats = window.__v2RenderingTest.view.stats(); window.__v2RenderingTest.view.hide(); window.__v2RenderingTest.view.show(); return { active: window.__v2RenderingTest.view.active, stats }; });
  assert(result.responsive.active); assert(result.responsive.stats.lod.tiles > 0);
  result.warmFrame = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 350));
    window.__v2GlCounts.uniforms = window.__v2GlCounts.draws = 0;
    const view = window.__v2RenderingTest.view, camera = view.getCamera();
    view.setCamera({ ...camera, yaw: camera.yaw + .001 });
    await new Promise(resolve => setTimeout(resolve, 120));
    return { ...window.__v2GlCounts, stats: view.stats() };
  });
  await page.evaluate(() => { window.__v2RenderingTest.view.dispose(); window.__v2RenderingTest.host.remove(); delete window.__v2RenderingTest; });
  assert.deepEqual(result.errors, []); result.ok = true;
} catch (error) { result.ok = false; result.error = error.stack; process.exitCode = 1; }
finally { await browser.close(); await writeFile(new URL('results.json', out), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
