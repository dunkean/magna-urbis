/** Real-browser display regression. It never replaces a worker or a rendering backend. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const out = new URL('../out/workbench-layout/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.generationRequests = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.action && message.action !== 'serialize' && message?.settings) window.generationRequests.push({ action: message.action, keys: message.keys });
      return send.call(this, message, ...args);
    };
  });
  await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5185'}/v2.html?empty&test=1&lang=fr`);
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  const fixture = JSON.parse(await readFile(new URL('fixture.json', out), 'utf8'));
  const engineUrl = '/@fs/' + fileURLToPath(new URL('../src/v2/engine.ts', import.meta.url)).replaceAll('\\', '/');
  const fixtureText = await page.evaluate(
    async ({ fixture, engineUrl }) => {
      const { terrainCacheKey } = await import(engineUrl);
      fixture.world.stats['v2.terrainKey'] = terrainCacheKey(fixture.settings);
      return JSON.stringify(fixture);
    },
    { fixture, engineUrl },
  );
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles({ name: 'render-controls.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText) });
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  const exportProject = async () => {
    await page.locator('#export-open').click();
    await page.locator('#export-format').selectOption('project');
    const download = page.waitForEvent('download');
    await page.locator('#export-go').click();
    return JSON.parse(await readFile(await (await download).path(), 'utf8'));
  };
  const original = await exportProject();
  assert.equal(!!original.settings.appearance.textured, false);
  const roof = page.locator('.toolbar-row #roof-display');
  assert.equal(await page.locator('#roof-display').count(), 1);
  assert(await roof.isVisible());
  assert.equal(await roof.inputValue(), 'v2');
  assert.deepEqual(await roof.locator('option').evaluateAll(options => options.map(option => option.value)), ['v1', 'v2', 'flat', 'minimal']);
  assert.equal(await roof.locator('option[value=v1]').textContent(), 'V1 · Arêtes');
  assert(
    await page.evaluate(() => {
      const style = document.querySelector('#map-style'),
        spinner = document.querySelector('#view-loading');
      const original = spinner.hidden,
        left = style.getBoundingClientRect().left;
      spinner.hidden = !original;
      const stable = style.getBoundingClientRect().left === left;
      spinner.hidden = original;
      return stable;
    }),
    'the spinner reserves space in the toolbar',
  );
  const advanced = page.locator('.view-strip > .workbench-advanced');
  const flags = ['appearance.composition.ground.contours', 'appearance.composition.networks.roads.visible', 'appearance.composition.text.visible', 'appearance.composition.buildings.visible'];
  for (const path of ['appearance.composition.networks.water.visible', 'appearance.composition.networks.water.look', 'appearance.composition.networks.roads.look', 'appearance.city.plan']) {
    assert.equal(await page.locator(`[data-setting-path="${path}"]`).count(), 0);
  }
  await page.evaluate(paths => {
    window.sharedFlags = paths.map(path => document.querySelector(`[data-setting-path="${path}"]`));
  }, flags);
  await page.locator('#map-advanced-open').click();
  await advanced.locator('[data-render-pass=ground]').waitFor();
  assert.equal(await advanced.locator('.render-pass-card').count(), 9);
  await page.screenshot({ path: fileURLToPath(new URL('render-advanced-overview.png', out)) });
  // One page: component settings are open in their cards, no disclosure to click.
  assert.equal(await advanced.locator('details').count(), 0, 'no disclosure inside the advanced render view');
  assert(await advanced.locator('[data-setting-path="appearance.composition.ground.look"]').isVisible());
  assert(await advanced.locator('[data-setting-path="appearance.textured"]').isVisible());
  assert.equal(await page.locator('.toolbar-row [data-city-display]').count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('render-advanced-2d.png', out)) });
  await page.keyboard.press('Escape');
  assert.deepEqual((await exportProject()).settings, original.settings, 'opening Advanced is read-only');
  for (const path of flags) assert(await page.locator(`.toolbar-row [data-setting-path="${path}"]`).isVisible());
  assert(await page.evaluate(paths => paths.every((path, i) => window.sharedFlags[i] === document.querySelector(`[data-setting-path="${path}"]`)), flags));
  await roof.selectOption('v1');
  const edged = await exportProject();
  assert.equal(edged.settings.appearance.composition.preset, 'custom');
  assert.equal(edged.settings.appearance.composition.buildings.roof, 'v1');
  await page.locator('#view3d').click();
  const nav = page.locator('.toolbar-row [data-navigation]');
  await nav.waitFor();
  await page.locator('#map-style').selectOption('satellite');
  await page.waitForFunction(() => document.querySelector('#roof-display').value === 'v2');
  for (const path of flags) assert(await page.locator(`.toolbar-row [data-setting-path="${path}"]`).isVisible());
  assert.equal(await page.locator('.toolbar-row [data-ground]').count(), 0);
  assert.equal(await page.locator('.toolbar-row [data-textured]:visible,.toolbar-row [data-plan]:visible').count(), 0);
  assert.equal(await page.locator('#road-display').count(), 0);
  await page.locator('#map-advanced-open').click();
  assert(await advanced.locator('[data-render-pass=ground] > .render-pass-options').isVisible());
  assert(await advanced.locator('[data-ground]').isVisible());
  await advanced.locator('[data-ground]').selectOption('map');
  await page.keyboard.press('Escape');
  await page.locator('#map-style').selectOption('parchment');
  await page.locator('#map-style').selectOption('satellite');
  await page.locator('#map-advanced-open').click();
  assert.equal(await advanced.locator('[data-ground]').inputValue(), 'render-v2', 'a new preset clears the old ground override');
  await advanced.locator('[data-render-pass=vegetation] .render-pass-source select').selectOption('parchment');
  const vegetation = advanced.locator('[data-pass-switch="appearance.composition.vegetation.look"]');
  await vegetation.uncheck();
  await vegetation.check();
  await page.screenshot({ path: fileURLToPath(new URL('render-advanced-3d.png', out)) });
  await page.keyboard.press('Escape');
  await roof.selectOption('minimal');
  const mixed = await exportProject();
  assert.equal(mixed.settings.appearance.composition.ground.look, 'satellite');
  assert.deepEqual(mixed.settings.appearance.composition.networks.water, {});
  assert.equal(mixed.settings.appearance.composition.vegetation.look, 'symbols');
  assert.equal(mixed.settings.appearance.composition.buildings.roof, 'minimal');
  assert.equal(mixed.settings.appearance.city?.ground, undefined);
  assert.deepEqual(mixed.world, original.world, 'style composition leaves every generated product untouched');
  await nav.selectOption('fly');
  const canvas = page.locator('.map-area > .city3d canvas').first();
  await canvas.focus();
  const initial = await page.evaluate(() => window.__v2Test.camera3d());
  assert.equal(initial.navigation, 'fly');
  await page.keyboard.down('Space');
  await page.waitForFunction(z => window.__v2Test.camera3d().flightAltitude > z + 3, initial.flightAltitude);
  await page.keyboard.up('Space');
  const raised = await page.evaluate(() => window.__v2Test.camera3d());
  await page.evaluate(() => {
    const camera = window.__v2Test.camera3d();
    window.__v2Test.setCamera3d({ ...camera, pitch: 0 });
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(({ x, y }) => {
    const camera = window.__v2Test.camera3d();
    return Math.hypot(camera.x - x, camera.y - y) > 3;
  }, raised);
  await page.keyboard.up('KeyW');
  const flown = await page.evaluate(() => window.__v2Test.camera3d());
  assert.equal(flown.flightAltitude, raised.flightAltitude, 'horizontal flight keeps absolute altitude');
  await page.keyboard.press('Escape');
  assert.equal(await nav.inputValue(), 'orbit');
  await nav.selectOption('walk');
  await canvas.focus();
  assert.equal((await page.evaluate(() => window.__v2Test.camera3d())).navigation, 'walk');
  await nav.selectOption('orbit');
  await page.screenshot({ path: fileURLToPath(new URL('shared-toolbar-3d.png', out)) });
  assert.deepEqual(await page.evaluate(() => window.generationRequests), [], 'display and flight never invoke generation');
  assert.deepEqual(errors, []);
  await writeFile(new URL('render-report.json', out), JSON.stringify({ checks: 'passed', generationRequests: [], errors }, null, 2));
  console.log('Shared rendering, shader mix, ground and free-flight browser checks passed.');
} catch (error) {
  console.error('Display diagnostics:', errors, await page?.locator('#toast').textContent());
  await page?.screenshot({ path: fileURLToPath(new URL('render-failure.png', out)) });
  throw error;
} finally {
  await browser.close();
}
