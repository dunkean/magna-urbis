/** End-to-end check of Region / Settlements / Map and their retained-world controls. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const web = fileURLToPath(new URL('..', import.meta.url)), out = resolve(web, 'out/v2-sections');
await mkdir(out, { recursive: true });
process.env.CI = 'true';
const server = await createServer({ configFile: resolve(web, 'vite.v2.config.ts'), server: { port: 5193, strictPort: true, hmr: false }, clearScreen: false });
let browser;
const errors = [], report = { checks: [], errors };
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5193/v2.html?lang=en');
  await page.locator('.chain-family-tab').first().waitFor();
  assert.deepEqual(await page.locator('.chain-family-tab').evaluateAll(tabs => tabs.map(tab => tab.id)), ['family-tab-region', 'family-tab-settlements', 'family-tab-map']);
  assert.deepEqual(await page.locator('.chain-family-label').allTextContents(), ['Region', 'Settlements', 'Map']);
  for (const selector of ['.terrain-coast-compass', '.climate-strip']) {
    assert(await page.locator(`#family-region .family-general ${selector}`).isVisible());
    const boxes = await page.locator(`${selector} button`).evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right }; }));
    assert.equal(new Set(boxes.map(box => Math.round(box.top))).size, selector === '.terrain-coast-compass' ? 3 : 1, selector + ' row count');
    assert(boxes.at(-1).right < 385, selector + ' fits the sidebar');
  }
  assert.deepEqual(await page.locator('#family-region > .family-general, #family-region > .family-method, #family-region > .chain-spine').evaluateAll(nodes => nodes.map(node => node.className)), ['family-general', 'family-method', 'chain-spine']);
  for (const path of ['runtime.backend', 'runtime.compute', 'terrain.generationCompute', 'terrain.compute']) {
    const field = page.locator(`[data-field-path="${path}"]`);
    assert.equal(await field.count(), 1);
    assert(await field.isVisible());
    assert(await field.evaluate(node => !!node.closest('.family-method')));
  }
  assert(await page.locator('#terrain-source').isHidden(), 'procedural source is already selected by the method bar');
  await page.locator('#row-relief-source .stage-title').click();
  for (const selector of ['#terrain-width', '#terrain-relief', '#terrain-biome', '#terrain-backend', '#terrain-compute', '#seed', '#terrain-coast-panel'])
    assert.equal(await page.locator(`#body-relief-source ${selector}`).count(), 0, selector + ' is only above the pipeline');
  await page.locator('#row-relief-source .stage-title').click();
  await page.locator('#terrain-coast-island').check();
  assert(await page.locator('#terrain-coast-island').isChecked());
  await page.locator('#terrain-coast-archipelago').check();
  assert(await page.locator('#terrain-coast-island').isChecked() === false);
  await page.locator('#terrain-coast-N').click();
  assert.equal(await page.locator('[name="terrain-coast-layout"]:checked').count(), 0, 'custom directions clear the preset selection');
  await page.locator('#terrain-coast-none').check();
  assert(await page.locator('#terrain-coast-none').isChecked());
  await page.locator('#terrain-coast-random').check();
  assert(await page.locator('#terrain-coast-random').isChecked());
  assert(await page.locator('[data-field-path="terrain.islandMode"]').isHidden());
  await page.locator('#terrain-coast-none').check();
  await page.locator('.chain-scroll').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: resolve(out, 'region-en.png') });
  await page.locator('.family-method').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, 'terrain-method-en.png') });
  await page.locator('.chain-scroll').evaluate(node => { node.scrollTop = 0; });
  await page.setViewportSize({ width: 390, height: 844 });
  if ((await page.locator('#sidebar').getAttribute('class')).includes('mobile-closed')) await page.locator('#mobile-toggle').click();
  assert((await page.locator('#sidebar').boundingBox()).x >= 0);
  for (const selector of ['.terrain-coast-compass', '.climate-strip']) {
    const tops = await page.locator(`${selector} button`).evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
    assert.equal(new Set(tops.map(Math.round)).size, selector === '.terrain-coast-compass' ? 3 : 1, selector + ' row count on mobile');
  }
  await page.screenshot({ path: resolve(out, 'region-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-climate="arid"]').click();
  assert.equal(await page.locator('[data-climate="arid"]').getAttribute('aria-checked'), 'true');
  await page.locator('#terrain-coast-archipelago').click();
  assert(await page.locator('#terrain-coast-archipelago').isChecked());
  const download = async (format, file) => {
    await page.locator('#export-open').click();
    await page.locator('#export-format').selectOption(format);
    const pending = page.waitForEvent('download'); await page.locator('#export-go').click();
    const data = await pending; const path = resolve(out, file); await data.saveAs(path);
    await page.locator('#export-dialog').waitFor({ state: 'hidden' });
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const recipe = await download('recipe', 'initial.recipe.json');
  assert.equal(recipe.settings.terrain.climate, 'arid');
  assert.equal(recipe.settings.terrain.coastMask, 255);
  assert.equal(recipe.settings.terrain.islandMode, 'archipelago');
  assert.equal(recipe.settings.options.biome, 'temperate');
  if (!await page.locator('#source-neural').isDisabled()) {
    await page.locator('#source-neural').click();
    assert(await page.locator('#row-relief-neural-coarse').isVisible());
    assert(await page.locator('#family-region .family-general .climate-strip').isVisible());
    assert.equal(await page.locator('[data-climate="arid"]').getAttribute('aria-checked'), 'true');
    assert(await page.locator('#row-relief-coasts').isHidden());
    await page.screenshot({ path: resolve(out, 'neural-inputs.png') });
    await page.locator('#source-procedural').click();
    report.checks.push('Neural source keeps climate/coast inputs above diffusion and hides procedural coastal finishing');
  }
  report.checks.push('General settings, checkable coast layouts and 3×3 compass precede the expanded method/backend/compute controls and pipeline without duplicate source controls');

  await page.locator('#family-tab-settlements').click();
  assert(await page.locator('#row-settle-sites').isVisible());
  assert(await page.locator('#row-city-composition').isVisible());
  await page.screenshot({ path: resolve(out, 'settlements-en.png') });
  await page.locator('#family-tab-map').click();
  for (const id of ['display-terrain', 'map-naming', 'map-export']) assert(await page.locator(`#row-${id}`).isVisible());
  await page.locator('#row-map-export .stage-run').click();
  assert(await page.locator('#export-dialog').isVisible());
  await page.locator('#export-dialog [data-close]').first().click();
  report.checks.push('Placement and city stages share Settlements; Map exposes appearance, naming and export');

  // Small classic fixture exercises the actual combined worker action and naming without a GPU dependency.
  const settings = recipe.settings;
  settings.runtime = { backend: 'typescript', source: 'procedural', compute: 'cpu' };
  settings.extent = 1200; settings.settlementCount = 1;
  settings.options = { ...settings.options, population: 80, size: 'hamlet', coast: 'none', river: 'none', relief: 'flat', walls: 'none', castle: 'no' };
  settings.terrain = {};
  await page.locator('#expert-open').click();
  await page.locator('#expert-json').fill(JSON.stringify(settings));
  await page.locator('#expert-apply').click();
  await page.locator('#expert-dialog').waitFor({ state: 'hidden' });
  const run = async () => {
    await page.locator('#generate-region').click();
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
    assert(!/Échec :|Failed:/.test(await page.locator('#job-log').textContent()));
  };
  await page.locator('#family-tab-region').click(); await run();
  await page.locator('#family-tab-settlements').click(); await run();
  const before = await download('project', 'before.project.json');
  assert(before.world.settlements.length > 0); assert(before.world.urban.buildings.length > 0);
  await page.locator('#family-tab-map').click();
  for (const id of ['map-naming', 'map-export']) await page.locator(`#row-${id} .stage-title`).click();
  await page.locator('#map-title-input').fill('The Copper Coast'); await page.locator('#map-title-input').dispatchEvent('change');
  await page.locator('#map-naming-language').selectOption('english');
  await page.locator('[data-place-name="main"]').fill('Valmont'); await page.locator('[data-place-name="main"]').dispatchEvent('change');
  await page.waitForFunction(() => document.querySelector('#map-names-apply').getAttribute('aria-busy') === 'false');
  await page.waitForFunction(() => document.querySelector('#map-name').textContent === 'The Copper Coast');
  await page.screenshot({ path: resolve(out, 'map-en.png') });
  const after = await download('project', 'after.project.json');
  assert.equal(after.world.names.town, 'The Copper Coast');
  assert.equal(after.world.settlements.find(place => place.main).name, 'Valmont');
  assert.deepEqual(after.world.terrain.height, before.world.terrain.height);
  assert.deepEqual(after.world.urban.buildings, before.world.urban.buildings);
  assert.deepEqual(after.settings.naming, { title: 'The Copper Coast', places: { main: 'Valmont' } });
  await page.locator('#map-title-input').fill('');
  await page.waitForFunction(() => document.querySelector('#map-names-apply').getAttribute('aria-busy') === 'false');
  await page.waitForFunction(() => document.querySelector('#map-name').textContent === 'Valmont');
  await page.locator('#map-title-input').fill('The Copper Coast');
  await page.waitForFunction(() => document.querySelector('#map-names-apply').getAttribute('aria-busy') === 'false');
  report.checks.push('Combined settlement generation builds places; naming and project export preserve terrain and buildings');

  await page.locator('#language-select').selectOption('fr');
  assert.deepEqual(await page.locator('.chain-family-label').allTextContents(), ['Région', 'Peuplements', 'Carte']);
  await page.locator('#family-tab-region').click();
  await page.screenshot({ path: resolve(out, 'region-fr.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  if ((await page.locator('#sidebar').getAttribute('class')).includes('mobile-closed')) await page.locator('#mobile-toggle').click();
  await page.screenshot({ path: resolve(out, 'classic-mobile.png') });
  assert.equal(await page.locator('.chain-family-tab').count(), 3);
  report.checks.push('English/French navigation and narrow viewport');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error) { report.ok = false; errors.push(String(error.stack ?? error)); process.exitCode = 1; }
finally {
  await browser?.close(); await server.close();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
