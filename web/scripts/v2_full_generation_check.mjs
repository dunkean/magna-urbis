/** Exercise the real Full generation buttons over retained terrain, using WASM and no native service. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const out = new URL('../out/workbench-layout/', import.meta.url);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.generationRequests = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      if (message?.action && message.action !== 'serialize' && message?.settings) window.generationRequests.push({ action: message.action, keys: message.keys });
      return send.call(this, message, ...args);
    };
  });
  await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5185'}/v2.html?empty&test=1&lang=fr`);
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  const fixture = JSON.parse(await readFile(new URL('fixture.json', out), 'utf8'));
  fixture.settings.options.population = 80;
  fixture.settings.options.size = 'hamlet';
  fixture.settings.urban = { backend: 'rust', architecture: 'silhouette', through: 'buildings' };
  fixture.settings.region.placement = { mode: 'list', list: fixture.world.settlements.map((place, i) => ({
    key: place.key, name: place.name, population: i ? 30 : 80, culture: place.culture, siteType: 'plain', position: place.center,
  })) };
  const engineUrl = '/@fs/' + fileURLToPath(new URL('../src/v2/engine.ts', import.meta.url)).replaceAll('\\', '/');
  const fixtureText = await page.evaluate(async ({ fixture, engineUrl }) => {
    const { terrainCacheKey } = await import(engineUrl);
    fixture.world.stats['v2.terrainKey'] = terrainCacheKey(fixture.settings);
    return JSON.stringify(fixture);
  }, { fixture, engineUrl });
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles({ name: 'continuation.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText) });
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  const exportProject = async () => {
    await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('project');
    const download = page.waitForEvent('download'); await page.locator('#export-go').click();
    return JSON.parse(await readFile(await (await download).path(), 'utf8'));
  };
  const before = await exportProject();
  await page.locator('#family-tab-settlements').click();
  await page.locator('#run-chain').click();
  await page.waitForFunction(() => window.generationRequests.length >= 2);
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  const settled = await exportProject();
  assert.deepEqual((await page.evaluate(() => window.generationRequests)).map(call => call.action), ['region', 'towns']);
  // Town generation may attach its city-ground display cache; every retained physical product must stay identical.
  for (const [field, value] of Object.entries(before.world.terrain)) assert.deepEqual(settled.world.terrain[field], value, `retained terrain.${field}`);
  assert.equal(settled.world.stats['v2.terrainKey'], before.world.stats['v2.terrainKey']);
  assert.equal(settled.world.stats['v2.regionBackend'], 'rust-wasm-cpu');
  assert(settled.world.debug.v2RustCities.main.layouts.length > 0);
  assert(settled.world.debug.v2RustCities.village.layouts.length > 0);
  await page.locator('#family-tab-cities').click();
  await page.locator('[data-city-select=village]').check();
  await page.evaluate(() => window.generationRequests = []);
  await page.locator('#run-chain').click();
  await page.waitForFunction(() => window.generationRequests.length === 1);
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  const targeted = await exportProject();
  assert.deepEqual(await page.evaluate(() => window.generationRequests), [{ action: 'towns', keys: ['village'] }]);
  assert.deepEqual(targeted.world.terrain, settled.world.terrain);
  assert.deepEqual(targeted.world.settlements, settled.world.settlements);
  assert.deepEqual(targeted.world.debug.v2RustCities.main, settled.world.debug.v2RustCities.main, 'an unselected city keeps its retained native products');
  await page.locator('#family-tab-map').click();
  assert.equal(await page.locator('#run-chain').isVisible(), false);
  assert.equal(await page.locator('#family-map .family-run').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(new URL('full-generation-report.json', out), JSON.stringify({ checks: 'passed', actions: ['region', 'towns', 'towns:village'], terrainPreserved: true, errors }, null, 2));
  console.log('Full generation continuation preserves terrain, placement and untargeted cities.');
} finally { await browser.close(); }
