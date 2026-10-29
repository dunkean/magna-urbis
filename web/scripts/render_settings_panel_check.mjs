/** Shared V2 / RustBench panel: real inputs, persistence, disabled tokens and responsive bounds. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const v2 = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5187/v2.html';
const bench = process.env.BENCH_CHECK_URL ?? 'http://127.0.0.1:5188';
const output = resolve('out/render-settings-panel'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { checks: [], errors: [] };
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => {
  window.__renderJobs = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) { if (args[0]?.action) window.__renderJobs.push(args[0].action); return post.apply(this, args); };
});
const reveal = async selector => page.locator(selector).evaluate(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true; });
const color = key => `[data-render-color="${key}"]`;
try {
  await page.goto(`${v2}?empty&lang=fr`); await page.locator('#render-settings').waitFor();
  assert.deepEqual(await page.locator('#render-settings [data-render-section]').evaluateAll(elements => elements.map(element => element.dataset.renderSection)), ['general', 'relief', 'ground', 'cover', 'roads', 'water', 'buildings', 'diagnostics']);
  await reveal(color('road')); await page.locator(color('road')).fill('#ca1256');
  await page.locator('[data-setting-path="appearance.terrainStyle"]').selectOption('render-v2');
  await page.waitForTimeout(300);
  assert.equal(await page.locator(color('groundLow')).isDisabled(), true);
  assert.equal(await page.locator(color('waterDeep')).isDisabled(), true);
  assert.equal(await page.locator(color('contour')).isDisabled(), false);
  await page.locator('[data-setting-path="appearance.terrainStyle"]').selectOption('atlas');
  assert.equal(await page.locator(color('road')).inputValue(), '#ca1256');
  await reveal(color('road')); await page.screenshot({ path: resolve(output, 'v2-desktop.png') });
  await page.locator('[data-color-key="road"] button').click();
  assert.equal(await page.locator('[data-color-key="road"] button').isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 }); await reveal(color('contour'));
  const bounds = await page.locator('.render-settings-popup').boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844, JSON.stringify(bounds));
  await page.screenshot({ path: resolve(output, 'v2-mobile.png') });
  assert.deepEqual(await page.evaluate(() => window.__renderJobs), []);
  report.checks.push('V2: eight sections, retained colours, material compatibility, reset, mobile bounds, no generation');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${bench}/terrainbench.html?standalone=1&profile=local&stage=settlements&source=procedural&auto=0&render=svg&style=atlas`);
  await page.waitForFunction(() => window.magnaBenchContext && document.body.dataset.terrainStartup === 'ready');
  await page.locator('#bench-render-settings #roadPreset').waitFor({ state: 'attached' });
  for (const [id, category] of Object.entries({ showShading: 'relief', style: 'ground', showContours: 'cover', roadPreset: 'roads', showWater: 'water', hydroOverlay: 'diagnostics' })) {
    assert.equal(await page.locator(`#${id}`).evaluate(element => element.closest('[data-render-section]')?.dataset.renderSection), category, id);
    assert.equal(await page.locator(`#${id}`).count(), 1);
  }
  const before = await page.evaluate(() => window.magnaBenchContext.capture());
  await reveal('#roadPreset'); await page.locator('#roadPreset').selectOption('ink');
  await reveal(color('road')); await page.locator(color('road')).fill('#ab1234');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('color_road') === '#ab1234');
  await reveal('#showWater'); await page.locator('#showWater').uncheck();
  assert.equal(await page.locator('#showWater').isChecked(), false);
  assert.deepEqual(await page.evaluate(() => window.magnaBenchContext.capture()), before);
  await page.screenshot({ path: resolve(output, 'terrainbench-desktop.png') });
  const savedUrl = page.url(); await page.goto(savedUrl);
  await page.waitForFunction(() => document.body.dataset.terrainStartup === 'ready');
  assert.equal(await page.locator(color('road')).inputValue(), '#ab1234');
  assert.equal(await page.locator('#roadPreset').inputValue(), 'ink');
  await page.setViewportSize({ width: 390, height: 844 }); await reveal('#style');
  const benchBounds = await page.locator('#bench-render-settings .render-settings-popup').boundingBox();
  assert(benchBounds && benchBounds.x >= 0 && benchBounds.x + benchBounds.width <= 390 && benchBounds.y + benchBounds.height <= 844);
  await page.screenshot({ path: resolve(output, 'terrainbench-mobile.png') });
  report.checks.push('Terrainbench: original controls grouped once, road settings and colours restored from URL, retained stage state, mobile bounds');

  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${bench}/citybench.html?standalone=1`);
  await page.locator('#bench-render-settings [data-building-visible]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#bench-render-settings [data-render="streets"]').evaluate(element => element.closest('[data-render-section]').dataset.renderSection), 'roads');
  await reveal('[data-building-visible]'); await page.locator('[data-building-visible]').uncheck();
  await reveal('[data-render="streets"]'); await page.locator('[data-render="streets"]').uncheck();
  await reveal(color('building')); await page.locator(color('building')).fill('#789abc');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('color_building') === '#789abc');
  await page.screenshot({ path: resolve(output, 'citybench-desktop.png') });
  report.checks.push('Citybench: shared panel, original building and street toggles, persisted roof colour');
  assert.deepEqual(report.errors, []); report.ok = true;
  console.log(JSON.stringify(report));
} catch (error) {
  report.ok = false; report.failure = String(error.stack ?? error); process.exitCode = 1;
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); console.error(report.failure);
} finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
