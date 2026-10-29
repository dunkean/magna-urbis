/** Preset stars track actual overrides, including restoration and shared bench URLs. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const v2 = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5187/v2.html', bench = process.env.BENCH_CHECK_URL ?? 'http://127.0.0.1:5188';
const output = resolve('out/render-style-customization'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
const report = { checks: [], errors: [] }; page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => {
  window.__styleGenerationJobs = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) { if (['all', 'terrain', 'region', 'roads', 'town', 'towns'].includes(args[0]?.action)) window.__styleGenerationJobs.push(args[0].action); return post.apply(this, args); };
});
const reveal = selector => page.locator(selector).evaluate(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true; });
const star = async (selector, expected) => {
  await page.waitForFunction(({ selector, expected }) => { const select = document.querySelector(selector); return select.options[select.selectedIndex]?.label.endsWith(' *') === expected; }, { selector, expected }, { timeout: 5000 });
  const selected = await page.locator(selector).evaluate(select => ({ value: select.value, text: select.options[select.selectedIndex].text, label: select.options[select.selectedIndex].label }));
  assert.equal(selected.text.endsWith('*'), false); assert(!selected.value.includes('*'));
};
try {
  await page.goto(`${v2}?empty&lang=en`); await page.locator('#render-settings').waitFor(); await star('#map-style', false);
  await page.locator('#map-style').selectOption('atlas'); await star('#map-style', false);
  const azimuth = '[data-setting-path="appearance.lighting.azimuth"]'; await reveal(azimuth); await page.locator(azimuth).fill('90');
  await star('#map-style', true); await star('[data-setting-path="appearance.terrainStyle"]', true); await star('#export-style', true);
  await page.locator('#language-select').selectOption('fr'); await star('#map-style', true);
  await page.locator('#map-style').selectOption('parchment'); await star('#map-style', true);
  await reveal(azimuth); await page.locator(azimuth).fill('315'); await page.locator(azimuth).blur(); await star('#map-style', false);
  const road = '[data-render-color="road"]'; await reveal(road); await page.locator(road).fill('#ab1234'); await star('#map-style', true);
  await page.locator('[data-color-key="road"] button').click(); await star('#map-style', false);
  const water = '[data-setting-path="appearance.terrainLayers.water"]'; await reveal(water); await page.locator(water).uncheck(); await star('#map-style', true);
  await page.screenshot({ path: resolve(output, 'v2-customized.png') }); await page.locator(water).check(); await star('#map-style', false);
  assert.deepEqual(await page.evaluate(() => window.__styleGenerationJobs), []);
  report.checks.push('V2: preset unchanged, lighting/colour/layer stars, exact reset, language and style changes, raw ids retained');

  await page.goto(`${bench}/terrainbench.html?standalone=1&profile=local&stage=settlements&source=procedural&auto=0&render=svg&style=atlas`);
  await page.waitForFunction(() => window.magnaBenchContext && document.body.dataset.terrainStartup === 'ready');
  await page.locator('#bench-render-settings #roadPreset').waitFor({ state: 'attached' }); await star('#style', false);
  await reveal('#lightAzimuth'); await page.locator('#lightAzimuth').fill('90'); await star('#style', true);
  await page.locator('#resetLighting').click(); await star('#style', false);
  const width = '[data-road-style="width"]'; await reveal(width); await page.locator(width).fill('1.5'); await page.locator(width).dispatchEvent('change'); await star('#style', true);
  await page.waitForFunction(() => JSON.parse(new URL(location.href).searchParams.get('roads') ?? '{}').style?.width === 1.5);
  await page.goto(page.url()); await page.waitForFunction(() => document.body.dataset.terrainStartup === 'ready'); await star('#style', true);
  await reveal('#style'); await page.locator('#style').selectOption('parchment'); await star('#style', true);
  await reveal(width); await page.locator(width).fill('1'); await page.locator(width).dispatchEvent('change'); await star('#style', false);
  await reveal(road); await page.locator(road).fill('#ab1234'); await star('#style', true);
  await page.locator('[data-color-key="road"] button').click(); await star('#style', false);
  report.checks.push('Terrainbench: lighting reset, road width and shared URL, style change retains star, colour reset');

  await page.goto(`${bench}/citybench.html?standalone=1`); await page.locator('#bench-render-settings [data-building-visible]').waitFor({ state: 'attached' });
  await star('#backgroundStyle', false);
  await reveal('#backgroundStyle'); await page.locator('#backgroundStyle').selectOption('parchment'); await star('#backgroundStyle', false);
  await page.locator('#backgroundStyle').selectOption('render'); await star('#backgroundStyle', false);
  const buildings = '[data-building-visible]'; await reveal(buildings); await page.locator(buildings).uncheck(); await star('#backgroundStyle', true);
  await page.screenshot({ path: resolve(output, 'citybench-customized.png') }); await page.locator(buildings).check(); await star('#backgroundStyle', false);
  report.checks.push('Citybench: automatic palette and road preset remain canonical; building visibility marks/reset style');
  assert.deepEqual(report.errors, []); report.ok = true; console.log(JSON.stringify(report));
} catch (error) {
  report.ok = false; report.failure = String(error.stack ?? error); process.exitCode = 1;
  report.controls = await page.locator('.render-settings-panel input,.render-settings-panel select').evaluateAll(elements => elements.map(element => ({ id: element.id, value: element.value, checked: element.checked, defaultValue: element.defaultValue, defaultChecked: element.defaultChecked, declared: element.dataset.renderDefault })));
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); console.error(report.failure);
} finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
