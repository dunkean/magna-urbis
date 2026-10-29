import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5175/v2.html';
const output = resolve('out/v2-terrain-controls'); await mkdir(output, { recursive: true });
console.log('Terrain UI check: launch browser');
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
await page.emulateMedia({ reducedMotion: 'reduce' });
const errors = []; page.on('pageerror', error => errors.push(error.message));
async function recipe() {
  const section = page.locator('#expert-open').locator('xpath=ancestor::details[1]');
  if (!await section.evaluate(element => element.open)) await section.locator('summary').click();
  await page.locator('#expert-open').click(); const result = JSON.parse(await page.locator('#expert-json').inputValue());
  await page.locator('#expert-dialog [data-close]').first().click(); return result;
}
try {
  console.log('Terrain UI check: open source app');
  await page.goto(origin); await page.locator('#terrain-width').waitFor();
  assert.notEqual(await page.locator('#app').getAttribute('aria-busy'), 'true');
  await page.locator('#language-select').selectOption('en');
  await page.locator('#terrain-width').fill('12.3'); await page.locator('#terrain-width').blur();
  assert.equal((await recipe()).extent, 12300); assert.equal(await page.locator('#terrain-extent-auto').isChecked(), false);
  const before = (await recipe()).terrain?.coastMask ?? 16;
  await page.locator('#terrain-coast-toggle').click();
  await page.locator('#terrain-coast-N').click(); await page.locator('#terrain-coast-NE').click();
  assert.equal((await recipe()).terrain.coastMask, before ^ 1 ^ 2);
  await page.locator('#terrain-coast-archipelago').click(); let current = await recipe(); assert.equal(current.terrain.coastMask, 255); assert.equal(current.terrain.islandMode, 'archipelago');
  await page.locator('#terrain-coast-none').click();
  await page.locator('.control-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: resolve(output, 'desktop-first-fold-en.png') });
  console.log('Terrain UI check: dimensions and coasts passed');
  await page.locator('#terrain-source').selectOption('neural-python');
  const neural = page.locator('.terrain-control-group').filter({ has: page.locator('[data-setting-path="terrain.neuralTuning.steps"]') });
  await neural.locator('summary').click();
  await page.locator('[data-setting-path="terrain.neuralTuning.steps"]').fill('8');
  await page.locator('[data-setting-path="terrain.neuralTuning.steps"]').blur();
  assert.equal((await recipe()).terrain.neuralTuning.steps, 8);
  await page.locator('#language-select').selectOption('fr');
  assert.equal(await page.locator('#terrain-coast-NE').getAttribute('aria-label'), 'Côte nord-est');
  assert.equal(await page.locator('[data-setting-path="terrain.neuralTuning.steps"]').inputValue(), '8');
  assert.match(await neural.locator('summary').textContent(), /Génération neuronale/);
  await neural.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(output, 'neural-fr.png') });
  console.log('Terrain UI check: neural configuration and live locale passed');
  await page.locator('#terrain-source').selectOption('procedural');
  await page.locator('#language-select').selectOption('en');
  await page.locator('#terrain-paint-regions').evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  });
  await page.locator('#terrain-paint-regions').click();
  const paint = page.locator('.terrain-zone-preview .terrain-paint-overlay'); await paint.scrollIntoViewIfNeeded();
  const box = await paint.boundingBox(); assert(box && box.width > 100);
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .4); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .6, { steps: 12 }); await page.mouse.up();
  current = await recipe(); assert.equal(current.terrain.zones.version, 1); assert(current.terrain.zones.weights.some(weight => weight > 0));
  await paint.scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(output, 'paint-before-generation-en.png') });
  console.log('Terrain UI check: painted mask passed');
  const png = await page.evaluate(async () => {
    const { heightmapPng } = await import('/terrainHeightmap.ts');
    return Array.from(heightmapPng({ version: 1, resolution: 8, processing: 'surface', heights: Array.from({ length: 64 }, (_, index) => index * 10 - 100) }, 12000));
  });
  await page.locator('#terrain-sketch-host [data-id="file"]').setInputFiles({ name: 'eight-by-eight-metres.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  console.log('Terrain UI check: PNG input selected');
  try { await page.waitForFunction(() => document.querySelector('#terrain-sketch-host [data-id="input"]')?.value === 'surface', null, { timeout: 15000 }); }
  catch (error) { await page.screenshot({ path: resolve(output, 'import-failure.png') }); throw new Error(`${error.message}\nEditor: ${await page.locator('#terrain-sketch-host [data-id="state"]').textContent()}\nPage errors: ${JSON.stringify(errors)}`); }
  current = await recipe(); assert.equal(current.extent, 12000); assert.equal(current.terrain.sketch.resolution, 8); assert.equal(current.terrain.sketch.processing, 'surface');
  assert(Math.abs(current.terrain.sketch.heights[0] + 100) < .02); assert(Math.abs(current.terrain.sketch.heights[63] - 530) < .02);
  const heightmapSection = page.locator('#terrain-sketch-host .heightmap-tools');
  if (!await heightmapSection.evaluate(element => element.open)) await heightmapSection.locator('summary').click();
  const exportOptions = page.locator('#terrain-sketch-host [data-id="exportSource"]'); await exportOptions.selectOption('draft');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#terrain-sketch-host [data-id="png"]').click()]);
  await download.saveAs(resolve(output, 'heightmap-roundtrip-16bit.png'));
  await page.locator('#terrain-sketch-host [data-id="input"]').selectOption('generated');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#language-select').selectOption('fr');
  if (await page.locator('#sidebar').evaluate(element => element.classList.contains('mobile-closed'))) await page.locator('#mobile-toggle').click();
  if (await page.locator('#terrain-coast-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#terrain-coast-toggle').click();
  await page.locator('.control-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: resolve(output, 'mobile-first-fold-fr.png') });
  assert.equal(await page.locator('#terrain-width').isVisible(), true);
  await page.locator('#terrain-coast-toggle').click();
  assert.equal(await page.locator('#terrain-coast-NE').isVisible(), true);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ok: true, checks: ['manual width', 'eight-way coast bitmask', 'archipelago preset', 'neural settings', 'live EN/FR', 'painting before generation', '16-bit PNG import and export', 'mobile layout'], errors }, null, 2));
  console.log(`Terrain UI checks passed. Artifacts: ${output}`);
} finally { await browser.close(); }
