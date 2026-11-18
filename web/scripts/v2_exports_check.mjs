/** Retained-project acceptance: every export, current style, layers and rectangular crops. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const output = resolve('out/v2-exports-check');
await mkdir(output, { recursive: true });
const fixture = resolve(process.env.MAGNA_RENDER_FIXTURE ?? 'out/v2-rust-browser/06-native-houses.json');
const source = JSON.parse(await readFile(fixture, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const physical = project => hash({ terrain: project.world.terrain.height, native: project.world.terrain.v2NativeTerrain?.height, cities: project.world.debug?.v2RustCities });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [`--use-angle=${process.env.MAGNA_EXPORT_ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'default')}`] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', error => {
  errors.push(error.message);
  console.error('PAGE', error.message);
});
page.on('console', message => {
  if (message.type() === 'error') console.error('CONSOLE', message.text());
});
page.on('crash', () => {
  console.error('PAGE CRASH');
});
const layerNames = ['background', 'terrain', 'water', 'landuse', 'city', 'streets', 'roads', 'labels', 'decor'];
const checks = {};
async function exportFile(format, name, { crop = false, size = '1600', layers = layerNames, cancel = false } = {}) {
  if (!(await page.locator('#export-dialog').isVisible())) await page.locator('#export-open').click();
  assert.equal(await page.locator('#export-style').count(), 0);
  await page.locator('#export-format').selectOption(format);
  if (['png', 'svg'].includes(format)) {
    await page.locator('#export-crop').setChecked(crop);
    await page.locator('#export-resolution').selectOption(size);
    for (const layer of layerNames) await page.locator(`[data-layer="${layer}"]`).setChecked(layers.includes(layer));
  } else assert(await page.locator('#export-map-options').isHidden());
  if (cancel) {
    await page.locator('#export-go').click();
    await page.locator('.export-crop [data-action="cancel"]').click();
    await page.waitForFunction(() => !document.querySelector('#export-go').disabled);
    assert(await page.locator('#export-dialog').isVisible());
    return;
  }
  const pending = page.waitForEvent('download', { timeout: 120000 });
  // Attach a handler immediately so a failed crop doesn't leave an unhandled rejection.
  void pending.catch(() => {});
  await page.locator('#export-go').click();
  if (crop) {
    const width = Number(await page.locator('.export-crop [data-field="width"]').inputValue());
    await page.locator('.export-crop [data-field="height"]').fill(String(width / 2));
    await page.locator('.export-crop [data-field="height"]').dispatchEvent('change');
    await page.locator('.export-crop [data-action="export"]').click();
  }
  const download = await pending,
    path = resolve(output, name);
  await download.saveAs(path);
  await page.locator('#export-dialog').waitFor({ state: 'hidden' });
  console.log(`Downloaded ${name}`);
  return readFile(path);
}
async function pixels(bytes, type = 'image/png') {
  return page.evaluate(
    async ({ base64, type }) => {
      const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type });
      const url = URL.createObjectURL(blob),
        image = new Image();
      try {
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let drawn = 0,
          fingerprint = 2166136261;
        for (let i = 0; i < rgba.length; i++) {
          fingerprint = Math.imul(fingerprint ^ rgba[i], 16777619);
          if (i % 4 === 3 && rgba[i]) drawn++;
        }
        return { width: canvas.width, height: canvas.height, drawn, fingerprint: fingerprint >>> 0 };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { base64: bytes.toString('base64'), type },
  );
}
async function style(value) {
  console.log(`Selecting ${value}…`);
  await page.locator('#map-style').selectOption(value);
  await page.waitForFunction(() => document.querySelector('#render-status').hidden, null, { timeout: 120000 });
}
try {
  await page.goto(process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5174/v2.html');
  await page.locator('#import-open').click();
  await page.locator('#import-scope').selectOption('complete');
  await page.locator('#project-file').setInputFiles(fixture);
  await page.locator('#import-dialog').waitFor({ state: 'hidden', timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  console.log('Imported retained native project.');
  const seed = JSON.parse(await exportFile('seed', 'seed.json'));
  assert.equal(seed.format, 'magna-urbis-v2-seed');
  const recipe = JSON.parse(await exportFile('recipe', 'recipe.json'));
  assert.equal(recipe.format, 'magna-urbis-v2');
  assert.equal(recipe.world, undefined);
  assert(Array.isArray(recipe.mods));
  const project = JSON.parse(await exportFile('project', 'project.json'));
  assert.equal(physical(project), physical(source));
  checks.json = { seed: true, recipe: true, project: true, retainedPhysicalData: true };
  const metadataPending = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.metadata.json') });
  const height = await pixels(await exportFile('heightmap', 'heightmap.png'));
  const metadataDownload = await metadataPending;
  await metadataDownload.saveAs(resolve(output, 'heightmap.metadata.json'));
  const metadata = JSON.parse(await readFile(resolve(output, 'heightmap.metadata.json'), 'utf8'));
  assert.equal(height.width, metadata.width);
  assert.equal(height.height, metadata.height);
  assert(metadata.maxHeight >= metadata.minHeight);
  checks.heightmap = { height, metadata };
  await style('cadastre');
  const svg = await exportFile('svg', 'cadastre.svg'),
    svgText = svg.toString('utf8');
  assert(svgText.includes('data-style="cadastre"'));
  assert(!svgText.includes('embedded-raster'));
  assert(svgText.includes('<path'));
  assert(svgText.includes('layer-urban') || svgText.includes('u-buildings'));
  const svgCrop = await pixels(await exportFile('svg', 'cadastre-crop.svg', { crop: true }), 'image/svg+xml');
  assert.deepEqual([svgCrop.width, svgCrop.height], [1600, 800]);
  checks.svg = { vectors: true, currentStyle: true, crop: svgCrop };
  const empty = await pixels(await exportFile('png', 'transparent.png', { layers: [] }));
  assert.equal(empty.drawn, 0);
  const city = await pixels(await exportFile('png', 'city.png', { layers: ['city'] }));
  const streets = await pixels(await exportFile('png', 'streets.png', { layers: ['streets'] }));
  assert(city.drawn > 0 && city.drawn < city.width * city.height);
  assert(streets.drawn > 0);
  assert.notEqual(city.fingerprint, streets.fingerprint);
  const mapCrop = await pixels(await exportFile('png', 'cadastre-crop.png', { crop: true }));
  assert.deepEqual([mapCrop.width, mapCrop.height], [1600, 800]);
  await exportFile('png', 'cancel.png', { crop: true, cancel: true });
  await page.locator('#export-dialog [data-close]').first().click();
  checks.layers = { empty, city, streets };
  checks.pngCrop = mapCrop;
  await style('satellite');
  await page.locator('#export-open').click();
  assert(await page.locator('#export-format option[value="svg"]').isDisabled());
  const satellite = await pixels(await exportFile('png', 'satellite-4096.png', { size: '4096' }));
  assert.deepEqual([satellite.width, satellite.height], [4096, 4096]);
  assert(satellite.drawn > 0);
  const satelliteCrop = await pixels(await exportFile('png', 'satellite-crop.png', { size: '3000', crop: true }));
  assert.deepEqual([satelliteCrop.width, satelliteCrop.height], [3000, 1500]);
  checks.satellite = { svgDisabled: true, satellite, satelliteCrop };
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: true, checks, errors }, null, 2));
  console.log('All six formats, layers, sizes, current style and crop/cancellation passed.');
} catch (error) {
  console.error(error);
  console.error(
    await page
      .locator('#toast')
      .textContent()
      .catch(() => 'page unavailable'),
  );
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: false, checks, errors, failure: String(error.stack ?? error) }, null, 2));
} finally {
  await browser.close();
}
