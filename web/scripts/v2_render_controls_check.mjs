/** Configure every retained-map render family without invoking generation. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const url = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5175/v2.html';
const output = resolve('out/v2-render-controls'); await mkdir(output, { recursive: true });
const report = { time: new Date().toISOString(), url, errors: [], checks: {} };
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000); await page.emulateMedia({ reducedMotion: 'reduce' });
page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => {
  window.__renderGenerationActions = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) {
    if (args[0]?.action && ['all', 'terrain', 'region', 'roads', 'town', 'towns'].includes(args[0].action))
      window.__renderGenerationActions.push(args[0].action);
    return post.apply(this, args);
  };
});
const field = path => `#render-settings [data-setting-path="appearance.${path}"]`;
async function reveal(selector) {
  await page.locator(selector).evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
  });
}
async function input(path, value) { const selector = field(path); await reveal(selector); await page.locator(selector).fill(String(value)); await page.locator(selector).blur(); }
async function select(path, value) { const selector = field(path); await reveal(selector); await page.locator(selector).selectOption(value); }
async function flag(path, value) { const selector = field(path); await reveal(selector); await page.locator(selector).setChecked(value); }
async function recipe() {
  await page.locator('#expert-open').evaluate(element => { for (let p = element.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true; });
  await page.locator('#expert-open').click(); const value = JSON.parse(await page.locator('#expert-json').inputValue());
  await page.locator('#expert-dialog [data-close]').first().click(); return value;
}
try {
  console.log(`Render controls acceptance: ${url}`);
  await page.goto(url); await page.locator('#render-settings').waitFor(); await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  const original = await recipe();
  await page.locator('#render-settings>summary').click();
  assert.equal(await page.locator(field('renderer')).isVisible(), true);
  await select('renderer', 'bench');
  await flag('contours', false); await flag('landuse', false); await flag('labels', false); await flag('legend', true); await flag('cartouche', true);
  await flag('painted', true); await select('vegetation', 'canopy');
  await input('lighting.azimuth', 123); await input('lighting.strength', 2.2);
  await flag('terrainLayers.hypsometry', false); await flag('lakes', false); await flag('oxbows', false);
  await select('city.view', 'roles'); await select('city.palette', 'parchment');
  await select('city.buildingStyle', 'geometric'); await select('city.diagnostic', 'height');
  await flag('textured', false); await flag('city.painted', true); await select('city.groundBlend', 'blended');
  await input('city.opacity', .4); await input('city.width', 1.1); await flag('city.layers.fronts', true);
  await page.locator('#map-style').selectOption('render-v2');
  await input('season', .8);
  await page.locator('#map-style').selectOption('fantasy-color');
  await input('fantasy.density', 1.4); await input('fantasy.size', .65); await input('fantasy.spacing', .8); await flag('fantasy.followLanduse', true);
  await select('diagnostic', 'v-basins');
  const selected = await recipe();
  assert.deepEqual(selected.options, original.options); assert.equal(selected.extent, original.extent);
  assert.deepEqual(selected.terrain, original.terrain); assert.equal(selected.settlementCount, original.settlementCount);
  assert.equal(selected.appearance.terrainStyle, 'fantasy-color'); assert.equal(selected.appearance.season, .8);
  assert.equal(selected.appearance.lighting.azimuth, 123); assert.equal(selected.appearance.lighting.strength, 2.2);
  assert.equal(selected.appearance.city.view, 'roles'); assert.equal(selected.appearance.city.width, 1.1);
  assert.equal(selected.appearance.city.layers.fronts, true); assert.equal(selected.appearance.fantasy.density, 1.4);
  assert.equal(selected.appearance.diagnostic, 'v-basins');
  assert.equal(await page.locator(`${field('diagnostic')} option[value="basins"]`).evaluate(option => option.disabled), true);
  report.checks.recipe = selected.appearance;
  await page.locator('#render-settings').evaluate(element => { element.open = true; });
  await page.locator('#render-settings .v2-render-popup').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: resolve(output, 'desktop-render-panel-en.png') });
  await page.locator('#language-select').selectOption('fr');
  assert.match(await page.locator('#render-settings>summary').textContent(), /Apparence/);
  assert.deepEqual(await recipe(), selected);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#render-settings').evaluate(element => { element.open = true; });
  await page.locator('#render-settings .v2-render-popup').evaluate(element => { element.scrollTop = 0; });
  const bounds = await page.locator('#render-settings .v2-render-popup').boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y >= 0 && bounds.y + bounds.height <= 845, JSON.stringify(bounds));
  await page.screenshot({ path: resolve(output, 'mobile-render-panel-fr.png') });
  await page.locator('#language-select').selectOption('en'); await page.setViewportSize({ width: 1440, height: 1000 });
  assert.deepEqual(await recipe(), selected);
  assert.deepEqual(await page.evaluate(() => window.__renderGenerationActions), []);
  assert.deepEqual(report.errors, []);
  report.checks = { ...report.checks, enFrRetained: true, responsivePopup: bounds, generationActions: [],
    fields: await page.locator('#render-settings [data-setting-path]').count() };
  report.ok = true; console.log(`Render controls acceptance passed. Artifacts: ${output}`);
} catch (error) {
  report.ok = false; report.failure = String(error.stack ?? error); process.exitCode = 1;
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); console.error(report.failure);
} finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
