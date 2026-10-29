/** Real V2 import → material controls → native 3D → capture, without generating a region or city. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const base = (process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175').replace(/\/$/, '');
const production = process.argv.includes('--production');
const out = resolve(web, production ? 'out/v2-render-3d-production' : 'out/v2-render-3d');
const grounds = ['map', 'render', 'render3d', 'render3d-brush', 'render-v2', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const physical = project => ({ height: project.world.terrain.height, water: project.world.terrain.water, filled: project.world.terrain.filled,
  nativeHeight: project.world.terrain.v2NativeTerrain?.height, nativeField: project.world.terrain.v2NativeTerrain?.field,
  terrainKey: project.world.stats['v2.terrainKey'], cities: project.world.debug?.v2RustCities });
const report = { mode: production ? 'production' : 'source', base, time: new Date().toISOString(), checks: {}, errors: [], missing: [] };
let browser, page;
await mkdir(out, { recursive: true });
try {
  const fixture = process.env.MAGNA_RENDER_FIXTURE ?? resolve(web, 'out/v2-rust-browser/06-native-houses.json');
  assert(await stat(fixture).then(value => value.isFile(), () => false), 'Set MAGNA_RENDER_FIXTURE to a retained V2 project containing native houses.');
  const source = JSON.parse(await readFile(fixture, 'utf8'));
  const nativeBuildings = Object.values(source.world.debug?.v2RustCities ?? {}).reduce((sum, city) => sum + (city.scene?.buildings.length ?? 0), 0);
  assert(nativeBuildings > 0 && source.world.terrain.v2NativeTerrain, 'The fixture must retain native terrain and houses.');
  const original = hash(physical(source)); report.fixture = { file: fixture, nativeBuildings, physicalFingerprint: original };
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, acceptDownloads: true });
  await context.addInitScript(() => {
    const fingerprint = text => { let value = 2166136261; for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619); return `${text.length}:${value >>> 0}`; };
    const qa = window.__render3dQA = { jobs: [], rasterSources: [], drapedSources: [], buildingDraws: 0, buildingVertices: 0, terrainDraws: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { postMessage(value, ...rest) {
      if (value && ['terrain', 'region', 'roads', 'towns', 'town', 'all'].includes(value.action)) qa.jobs.push(value.action);
      return super.postMessage(value, ...rest);
    } };
    const createUrl = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob.type?.includes('svg')) void blob.text().then(text => { if (/width="2048" height="2048" viewBox=/.test(text)) qa.rasterSources.push(fingerprint(text)); });
      return createUrl.call(this, blob);
    };
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...src, set(value) {
      if (typeof value === 'string' && value.startsWith('data:image/svg+xml')) qa.drapedSources.push(fingerprint(decodeURIComponent(value.slice(value.indexOf(',') + 1))));
      return src.set.call(this, value);
    } });
    const gl = WebGL2RenderingContext.prototype, shaderSources = new WeakMap(), programShaders = new WeakMap();
    const shaderSource = gl.shaderSource, attachShader = gl.attachShader, useProgram = gl.useProgram, arrays = gl.drawArrays, elements = gl.drawElements;
    let current;
    gl.shaderSource = function (shader, source) { shaderSources.set(shader, source); return shaderSource.call(this, shader, source); };
    gl.attachShader = function (program, shader) { const list = programShaders.get(program) ?? []; list.push(shader); programShaders.set(program, list); return attachShader.call(this, program, shader); };
    gl.useProgram = function (program) { current = program; return useProgram.call(this, program); };
    const record = (context, count) => {
      if (!context.canvas?.closest?.('.city3d')) return;
      const source = (programShaders.get(current) ?? []).map(shader => shaderSources.get(shader) ?? '').join('\n');
      if (source.includes('uniform vec3 material;')) { qa.buildingDraws++; qa.buildingVertices += count; } else qa.terrainDraws++;
    };
    gl.drawArrays = function (mode, first, count) { record(this, count); return arrays.call(this, mode, first, count); };
    gl.drawElements = function (mode, count, type, offset) { record(this, count); return elements.call(this, mode, count, type, offset); };
  });
  page = await context.newPage(); page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !response.url().includes('favicon')) report.missing.push({ url: response.url(), status: response.status() }); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/v2.html?empty&lang=en`, { waitUntil: 'domcontentloaded' });
  await page.locator('#map-style').waitFor();
  const reveal = async selector => page.locator(selector).evaluate(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true; });
  const closeSettings = async () => page.locator('#render-settings').evaluate(element => { element.open = false; });
  const idle = async style => {
    await page.waitForTimeout(180);
    await page.waitForFunction(style => document.querySelector('#render-status')?.hidden && (!style || document.querySelector('#map-canvas').dataset.renderStyle === style), style, { timeout: 60000 });
    const toast = await page.locator('#toast').evaluate(element => ({ hidden: element.hidden, error: element.dataset.error, text: element.textContent }));
    assert(toast.hidden || toast.error !== 'true', toast.text);
  };
  const field = path => `#render-settings [data-setting-path="appearance.${path}"]`;
  const fill = async (path, value) => { await reveal(field(path)); await page.locator(field(path)).fill(String(value)); await page.locator(field(path)).blur(); };
  const exportJson = async (format, label) => {
    await closeSettings(); await page.locator('#export-open').click(); await page.locator('#export-format').selectOption(format);
    const pending = page.waitForEvent('download', { timeout: 60000 }); await page.locator('#export-go').click();
    const download = await pending, path = resolve(out, `${label}.${format}.json`); await download.saveAs(path);
    await page.locator('#export-dialog').waitFor({ state: 'hidden' }); return JSON.parse(await readFile(path, 'utf8'));
  };
  await page.locator('#import-open').click(); await page.locator('#import-scope').selectOption('complete');
  await page.locator('#project-file').setInputFiles(fixture); await page.locator('#import-dialog').waitFor({ state: 'hidden', timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  await idle(); console.log(`Imported ${nativeBuildings} native houses through the real V2 UI.`);
  const initial = await exportJson('project', '01-imported'); assert.equal(hash(physical(initial)), original);
  const jobsBefore = await page.evaluate(() => window.__render3dQA.jobs.length);
  await page.locator('#map-style').selectOption('render-v2'); await idle('render-v2');
  await fill('season', .82); await fill('lighting.azimuth', 120); await fill('lighting.elevation', 28); await fill('lighting.strength', 1.4); await idle('render-v2'); await closeSettings();
  const opening = Date.now(); await page.locator('#view3d').click(); await page.locator('.city3d:not([hidden]) canvas').waitFor();
  await page.waitForFunction(expected => {
    const root = document.querySelector('.city3d:not([hidden])'), count = root?.querySelector('.city3d-info b')?.textContent.replace(/\D/g, '');
    return root?.dataset.materialBackend === 'software-texture' && root.querySelector('canvas').dataset.terrainShader === 'map' && Number(count) === expected && window.__render3dQA.buildingDraws > 0;
  }, nativeBuildings);
  report.checks.open = { elapsedMs: Date.now() - opening, buildings: nativeBuildings, status: await page.locator('.city3d-info').innerText(), shader: await page.locator('.city3d canvas').getAttribute('data-terrain-shader') };
  assert.match(report.checks.open.status, /software WebGL/); assert.match(await page.locator('.city3d [data-ground]').locator('xpath=..').innerText(), /Ground/);
  const loaded = await page.evaluate(() => ({ rasters: window.__render3dQA.rasterSources, draped: window.__render3dQA.drapedSources }));
  assert(loaded.draped.length > 0 && loaded.rasters.at(-1) === loaded.draped.at(-1), '3D did not load the latest actual 2D terrain raster.');
  report.checks.currentBackground = { matched: true, fingerprint: loaded.draped.at(-1) };
  const available = await page.locator('.city3d [data-ground] option').evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(available, grounds); report.checks.grounds = [];
  for (const ground of grounds.filter(value => value !== 'map')) {
    await page.locator('.city3d [data-ground]').selectOption(ground);
    const expected = ground === 'render' ? 'render3d' : ground; await idle(expected);
    const recipe = await exportJson('recipe', `ground-${ground}`);
    assert.equal(recipe.settings.appearance.terrainStyle, expected); assert.equal(recipe.settings.appearance.renderer, 'bench');
    assert.equal(recipe.settings.appearance.city.ground, ground);
    assert.equal(await page.locator('.city3d').getAttribute('data-material-backend'), 'software-texture');
    assert.equal(await page.locator('.city3d canvas').getAttribute('data-terrain-shader'), 'map');
    report.checks.grounds.push({ ground, terrainStyle: expected, retained: true }); console.log(`3D ground ${ground}: persisted and draped.`);
  }
  await page.locator('.city3d [data-ground]').selectOption('render-v2'); await idle('render-v2');
  await page.locator('.city3d [data-plan]').uncheck(); await page.locator('.city3d [data-colors]').selectOption('uses');
  await page.locator('.city3d [data-refinement]').selectOption('source'); await page.locator('.city3d [data-relief]').fill('2'); await page.locator('.city3d [data-relief]').dispatchEvent('input'); await idle();
  const canvas = await page.locator('.city3d canvas').boundingBox(); assert(canvas);
  await page.mouse.move(canvas.x + 70, canvas.y + canvas.height * .7); await page.mouse.down({ button: 'right' });
  await page.mouse.move(canvas.x + 115, canvas.y + canvas.height * .7 + 20, { steps: 5 }); await page.mouse.up({ button: 'right' });
  await page.locator('#view3d').click(); await page.locator('#view3d').click(); await idle();
  assert.equal(await page.locator('.city3d [data-plan]').isChecked(), false); assert.equal(await page.locator('.city3d [data-colors]').inputValue(), 'uses');
  assert.equal(await page.locator('.city3d [data-refinement]').inputValue(), 'source'); assert.equal(await page.locator('.city3d [data-relief]').inputValue(), '2');
  await page.locator('#language-select').selectOption('fr');
  assert.match(await page.locator('.city3d [data-ground]').locator('xpath=..').innerText(), /Sol/);
  assert.match(await page.locator('.city3d [data-ground] option[value="render-v2-snow"]').innerText(), /Neige/);
  assert.match(await page.locator('.city3d-info').innerText(), /WebGL logiciel/);
  await reveal(field('season')); assert.equal(await page.locator(field('season')).getAttribute('aria-label'), 'Saison (cycle annuel)'); await closeSettings();
  await page.screenshot({ path: resolve(out, 'native-satellite-3d-fr.png') });
  const pendingPng = page.waitForEvent('download', { timeout: 45000 }); await page.locator('#capture3d').click();
  const pngDownload = await pendingPng, pngPath = resolve(out, 'native-satellite-3d.png'); await pngDownload.saveAs(pngPath);
  const png = await readFile(pngPath); assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert(png.length > 5000);
  report.checks.capture = { bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const final = await exportJson('project', '99-after-display'); assert.equal(hash(physical(final)), original, 'Display changes altered retained physical terrain or native architecture.');
  const a = final.settings.appearance; assert.equal(a.season, .82); assert.equal(a.lighting.azimuth, 120); assert.equal(a.lighting.elevation, 28); assert.equal(a.lighting.strength, 1.4);
  assert.equal(a.city.ground, 'render-v2'); assert.equal(a.city.plan, false); assert.equal(a.city.colors, 'uses'); assert.equal(a.city.exaggeration, 2); assert.equal(a.city.refinement, 'source');
  report.checks.preferences = a;
  const qa = await page.evaluate(() => ({ jobs: window.__render3dQA.jobs, buildingDraws: window.__render3dQA.buildingDraws, buildingVertices: window.__render3dQA.buildingVertices, terrainDraws: window.__render3dQA.terrainDraws }));
  assert.equal(qa.jobs.length, jobsBefore); assert(qa.buildingDraws > 0 && qa.buildingVertices > nativeBuildings * 6);
  report.checks.retention = { physicalRetained: true, generationJobsDuringDisplay: qa.jobs.length - jobsBefore, ...qa };
  assert.deepEqual(report.errors, []); assert.deepEqual(report.missing, []); report.ok = true;
} catch (error) {
  report.ok = false; report.error = error.stack; process.exitCode = 1;
  if (page) { await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {}); report.body = (await page.locator('body').innerText().catch(() => '')).slice(-6000); }
} finally {
  await browser?.close(); await writeFile(resolve(out, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, mode: report.mode, open: report.checks.open, grounds: report.checks.grounds?.length,
    capture: report.checks.capture, retention: report.checks.retention, errors: report.errors, missing: report.missing,
    ...(report.error ? { error: report.error } : {}), report: resolve(out, 'results.json') }, null, 2));
}
