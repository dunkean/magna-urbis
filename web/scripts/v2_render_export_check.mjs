/** Retained native fixture: independent visual exports and legacy brush parity on a HiDPI display. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5175/v2.html';
const output = resolve('out/v2-render-exports'); await mkdir(output, { recursive: true });
const candidates = [process.env.MAGNA_RENDER_FIXTURE, resolve('out/v2-rust-browser/06-native-houses.json'), resolve('out/v2-rust-browser/08c-native-corrected.json')].filter(Boolean);
let fixture; for (const path of candidates) if (await stat(path).then(file => file.isFile(), () => false)) { fixture = path; break; }
assert(fixture, 'Set MAGNA_RENDER_FIXTURE to a retained V2 native city project.');
const source = JSON.parse(await readFile(fixture, 'utf8'));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const physical = project => ({ terrain: project.world.terrain.height, nativeHeight: project.world.terrain.v2NativeTerrain?.height,
  terrainKey: project.world.stats['v2.terrainKey'], cities: project.world.debug?.v2RustCities });
const originalPhysical = hash(physical(source));
const water = source.world.terrain.water.data, height = source.world.terrain.height.data.data, grid = source.world.terrain.height.w;
const drySamples = [];
for (let y = 4; y < grid - 4 && drySamples.length < 80; y += 3) for (let x = 4; x < grid - 4 && drySamples.length < 80; x += 3) {
  if (height[y * grid + x] <= Math.max(0, source.world.terrain.seaLevel ?? 0) + 1) continue;
  let dry = true;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (water[(y + dy) * grid + x + dx]) dry = false;
  if (dry) drySamples.push({ x: (x + .5) / grid, y: (y + .5) / grid });
}
assert(drySamples.length >= 10, 'Fixture needs dry land away from retained water.');
const report = { time: new Date().toISOString(), url, fixture, deviceScaleFactor: 2, checks: {}, errors: [] };
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
await context.addInitScript(() => {
  const capture = window.__v2ExportQA = { jobs: [], brushSources: [], brushReady: [], brushFrames: [], exports: [] };
  const post = Worker.prototype.postMessage;
  const brushInfo = sources => sources && ({ version: sources.version, vegetationBytes: sources.vegetation.length, terrainBytes: sources.terrain.length });
  Worker.prototype.postMessage = function (...args) {
    const value = args[0];
    if (value && ['terrain', 'region', 'roads', 'town', 'towns', 'all'].includes(value.action)) capture.jobs.push(value.action);
    if (value?.type === 'brushes') capture.brushSources.push(brushInfo(value.sources));
    if (value?.display && value.world && value.options) capture.exports.push({ display: structuredClone(value.display), options: structuredClone(value.options), brushes: brushInfo(value.brushes) });
    if (!this.__v2ExportCapture) {
      this.__v2ExportCapture = true;
      this.addEventListener('message', ({ data }) => {
        if (data.type === 'brushStatus') capture.brushReady.push(data.ready);
        if (data.type === 'frame' && data.stats?.brushBytes > 0) capture.brushFrames.push(data.stats.brushBytes);
      });
    }
    return post.apply(this, args);
  };
});
const page = await context.newPage(); page.setDefaultTimeout(60000);
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
await page.emulateMedia({ reducedMotion: 'reduce' });
const field = name => `#render-settings [data-setting-path="appearance.${name}"]`;
async function reveal(selector) { await page.locator(selector).evaluate(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true; }); }
async function idle(style) {
  await page.waitForTimeout(180);
  await page.waitForFunction(style => document.querySelector('#render-status')?.hidden && (!style || document.querySelector('#map-canvas')?.dataset.renderStyle === style), style, { timeout: 120000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const toast = await page.locator('#toast').evaluate(element => ({ hidden: element.hidden, error: element.dataset.error, text: element.textContent }));
  assert(toast.hidden || toast.error !== 'true', toast.text);
}
async function select(name, value) { await reveal(field(name)); await page.locator(field(name)).selectOption(value); await idle(); }
async function check(name, value) { await reveal(field(name)); await page.locator(field(name)).setChecked(value); await idle(); }
async function closePanel() { await page.locator('#render-settings').evaluate(element => { element.open = false; }); }
async function camera() {
  await idle();
  return { image: hash(await page.locator('#map-canvas').evaluate(canvas => canvas.toDataURL('image/png'))),
    scale: await page.locator('#scale-label').textContent(), frame: await page.locator('#map-canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height,
      transform: canvas.style.transform, cssWidth: canvas.style.width, cssHeight: canvas.style.height })) };
}
const layerNames = ['background', 'terrain', 'water', 'landuse', 'city', 'streets', 'roads', 'labels', 'decor'];
async function exportFile(format, filename, layers = layerNames) {
  await closePanel(); await page.locator('#export-open').click(); await page.locator('#export-format').selectOption(format);
  if (format === 'png' || format === 'svg') {
    await page.locator('#export-crop').uncheck(); await page.locator('#export-resolution').selectOption('1600');
    for (const name of layerNames) await page.locator(`[data-layer="${name}"]`).setChecked(layers.includes(name));
  }
  const pending = page.waitForEvent('download', { timeout: 180000 }); await page.locator('#export-go').click();
  const download = await pending, path = resolve(output, filename); await download.saveAs(path);
  await page.locator('#export-dialog').waitFor({ state: 'hidden' }); return readFile(path);
}
async function pixels(bytes, type, samples = []) {
  return page.evaluate(async ({ encoded, type, samples }) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const image = new Image(), href = URL.createObjectURL(new Blob([bytes], { type }));
    image.src = href; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); URL.revokeObjectURL(href);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let drawn = 0, opaque = 0, fingerprint = 2166136261;
    for (let index = 0; index < rgba.length; index++) { fingerprint = Math.imul(fingerprint ^ rgba[index], 16777619); if (index % 4 === 3) { if (rgba[index]) drawn++; if (rgba[index] === 255) opaque++; } }
    return { width: canvas.width, height: canvas.height, drawn, opaque, pixels: canvas.width * canvas.height, fingerprint: fingerprint >>> 0,
      samples: samples.map(point => rgba[(Math.min(canvas.height - 1, Math.floor(point.y * canvas.height)) * canvas.width + Math.min(canvas.width - 1, Math.floor(point.x * canvas.width))) * 4 + 3]) };
  }, { encoded: bytes.toString('base64'), type, samples });
}
async function svgInfo(bytes) {
  return page.evaluate(text => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
    return { rendering: root.getAttribute('data-rendering'), style: root.getAttribute('data-style'),
      landuse: doc.querySelectorAll('.layer-landuse').length, contours: doc.querySelectorAll('.layer-contours,#terrain-contour-ground').length,
      labels: doc.querySelectorAll('.layer-labels').length, text: doc.querySelectorAll('text').length,
      legend: !!doc.querySelector('#legend'), cartouche: !!doc.querySelector('#cartouche'),
      brushVegetation: (doc.querySelector('#brush-vegetation')?.getAttribute('href') ?? doc.querySelector('#brush-vegetation')?.getAttribute('xlink:href') ?? '').startsWith('data:image/png;base64,'),
      brushTerrain: (doc.querySelector('#brush-terrain')?.getAttribute('href') ?? doc.querySelector('#brush-terrain')?.getAttribute('xlink:href') ?? '').startsWith('data:image/png;base64,') };
  }, bytes.toString('utf8'));
}
try {
  console.log(`HiDPI render export acceptance: ${url}`);
  await page.goto(url); await page.locator('#map-style').waitFor();
  await page.locator('#import-open').click(); await page.locator('#import-scope').selectOption('complete');
  await page.locator('#project-file').setInputFiles(fixture); await page.locator('#import-dialog').waitFor({ state: 'hidden', timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false'); await idle();
  await check('textured', false); await page.locator('#map-style').selectOption('render-v2'); await idle('render-v2');
  await closePanel(); await page.locator('#zoom-in').click(); await idle('render-v2');
  const cameraBefore = await camera(); assert.equal(await page.evaluate(() => devicePixelRatio), 2);
  const empty = await pixels(await exportFile('png', 'all-layers-off.png', []), 'image/png');
  assert.equal(empty.drawn, 0, 'An export with every layer disabled must be completely transparent.');
  const city = await pixels(await exportFile('png', 'city-only.png', ['city']), 'image/png');
  const streets = await pixels(await exportFile('png', 'streets-only.png', ['streets']), 'image/png');
  for (const [name, result] of [['city', city], ['streets', streets]]) assert(result.drawn > 0 && result.drawn < result.pixels, `${name}: empty or opaque full-map export.`);
  assert.notEqual(city.fingerprint, streets.fingerprint);
  const isolatedWater = await pixels(await exportFile('png', 'water-only.png', ['water']), 'image/png', drySamples);
  assert(isolatedWater.drawn > 0 && isolatedWater.drawn < isolatedWater.pixels);
  assert(isolatedWater.samples.every(alpha => alpha === 0), 'Water-only export paints dry land.');
  report.checks.independentLayers = { empty, city, streets, water: isolatedWater };
  console.log('Independent empty / city / streets / water exports passed.');
  const png = await exportFile('png', 'satellite.png'), svg = await exportFile('svg', 'satellite.svg');
  const pngPixels = await pixels(png, 'image/png'), svgPixels = await pixels(svg, 'image/svg+xml');
  assert.equal(pngPixels.width, 1600); assert.equal(svgPixels.width, 1600); assert.equal(pngPixels.fingerprint, svgPixels.fingerprint);
  const satelliteSvg = await svgInfo(svg); assert.equal(satelliteSvg.rendering, 'embedded-raster'); assert.equal(satelliteSvg.style, 'render-v2');
  const cameraAfter = await camera(); assert.deepEqual(cameraAfter, cameraBefore, 'Exports changed the visible camera or retained map frame.');
  report.checks.satellite = { png: pngPixels, svg: svgPixels, metadata: satelliteSvg, cameraPreserved: true };

  await select('renderer', 'classic'); await page.locator('#map-style').selectOption('parchment'); await idle('parchment');
  await check('contours', false); await check('landuse', true); await check('labels', false); await check('legend', false); await check('cartouche', false);
  await select('vegetation', 'canopy'); await check('painted', true);
  await page.waitForFunction(() => window.__v2ExportQA.brushReady.includes(true), null, { timeout: 60000 });
  await closePanel(); await page.locator('#zoom-in').click(); await idle('parchment');
  const paintedSvg = await exportFile('svg', 'classic-painted-canopy.svg');
  const paintedInfo = await svgInfo(paintedSvg); assert.equal(paintedInfo.rendering, null);
  assert(paintedInfo.brushVegetation && paintedInfo.brushTerrain, 'Painted atlases are absent from the legacy SVG.');
  assert(paintedInfo.landuse > 0); assert.equal(paintedInfo.contours, 0); assert.equal(paintedInfo.labels, 0);
  assert.equal(paintedInfo.legend, false); assert.equal(paintedInfo.cartouche, false);
  await check('landuse', false);
  const hiddenSvg = await exportFile('svg', 'classic-hidden-layers.svg'), hiddenInfo = await svgInfo(hiddenSvg);
  assert.equal(hiddenInfo.landuse, 0); assert.equal(hiddenInfo.contours, 0); assert.equal(hiddenInfo.labels, 0);
  assert.equal(hiddenInfo.legend, false); assert.equal(hiddenInfo.cartouche, false);
  const capture = await page.evaluate(() => window.__v2ExportQA), legacyRequest = capture.exports.at(-1);
  assert.deepEqual(capture.jobs, []); assert(capture.brushReady.includes(true)); assert(capture.brushSources.length > 0);
  assert.equal(legacyRequest.display.painted, true); assert.equal(legacyRequest.display.vegetation, 'canopy');
  for (const flag of ['contours', 'landuse', 'labels', 'legend', 'cartouche']) assert.equal(legacyRequest.display[flag], false);
  assert(legacyRequest.brushes.vegetationBytes > 10000 && legacyRequest.brushes.terrainBytes > 10000);
  report.checks.legacy = { painted: paintedInfo, hidden: hiddenInfo, brushSources: capture.brushSources,
    brushDecoded: capture.brushReady, activeBrushFrameBytes: capture.brushFrames.slice(-5), exportRequest: legacyRequest };
  const finalProject = JSON.parse(await exportFile('project', 'physical-retained.project.json'));
  assert.equal(hash(physical(finalProject)), originalPhysical, 'Export/render changes mutated retained terrain, houses or scientific provenance.');
  report.checks.physicalFingerprint = originalPhysical; report.checks.generationActions = capture.jobs;
  await page.screenshot({ path: resolve(output, 'legacy-hidpi.png') });
  assert.deepEqual(report.errors, []); report.ok = true;
  console.log(`HiDPI render export acceptance passed. Artifacts: ${output}`);
} catch (error) {
  report.ok = false; report.failure = String(error.stack ?? error); process.exitCode = 1;
  report.capture = await page.evaluate(() => window.__v2ExportQA).catch(() => undefined);
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); console.error(report.failure);
} finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
