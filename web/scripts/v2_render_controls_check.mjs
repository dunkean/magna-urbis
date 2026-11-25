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
  await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5185'}/v2.html?empty&test=1&lang=fr&camera=dual`);
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  const fixture = JSON.parse(await readFile(new URL('fixture.json', out), 'utf8'));
  const engineUrl = '/@fs/' + fileURLToPath(new URL('../src/v2/engine.ts', import.meta.url)).replaceAll('\\', '/');
  const projectUrl = '/@fs/' + fileURLToPath(new URL('../src/v2/project.ts', import.meta.url)).replaceAll('\\', '/');
  const fixtureText = await page.evaluate(
    async ({ fixture, engineUrl, projectUrl }) => {
      const { terrainCacheKey } = await import(engineUrl);
      const { parseProjectValue, serializeProject } = await import(projectUrl);
      const { settings, world, mods } = parseProjectValue(fixture);
      const { w: resolution, data: height } = world.terrain.height;
      const elevation = height[0];
      // The existing flat workbench fixture supplies the terrain in both its legacy and native formats.
      settings.appearance.renderer = 'bench';
      world.terrain.v2NativeTerrain = {
        x: 0,
        y: 0,
        width: world.mapSize,
        resolution,
        minHeight: elevation,
        maxHeight: elevation,
        globalMinHeight: elevation,
        globalMaxHeight: elevation,
        motifSize: world.mapSize,
        height,
        caveMask: new Uint8Array(),
        normalX: new Float32Array(height.length),
        normalY: new Float32Array(height.length),
        normalZ: new Float32Array(height.length).fill(1),
        generationMs: 0,
        field: { n: resolution, data: height, exact: true, floor: 0 },
      };
      world.stats['v2.terrainKey'] = terrainCacheKey(settings);
      return serializeProject(settings, world, mods);
    },
    { fixture, engineUrl, projectUrl },
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
  assert.deepEqual(await roof.locator('option').evaluateAll(options => options.map(option => option.value)), ['minimal', 'flat', 'v2', 'v1', 'crafted']);
  assert.equal(await roof.locator('option[value=crafted]').textContent(), 'extra');
  assert.equal(await roof.locator('option[value=v1]').textContent(), 'high*');
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
  await roof.selectOption('crafted');
  assert.equal((await exportProject()).settings.appearance.composition.buildings.roof, 'crafted');
  await roof.selectOption('v1');
  const edged = await exportProject();
  assert.equal(edged.settings.appearance.composition.preset, 'custom');
  assert.equal(edged.settings.appearance.composition.buildings.roof, 'v1');
  await page.locator('#map-style').selectOption('satellite');
  await page.waitForFunction(() => document.querySelector('#roof-display').value === 'v2');
  assert.equal(await page.locator('#road-display').count(), 0);
  await page.locator('#map-advanced-open').click();
  assert(await advanced.locator('[data-render-pass=ground] > .render-pass-options').isVisible());
  await advanced.locator('[data-render-pass=vegetation] .render-pass-source select').selectOption('parchment');
  const vegetation = advanced.locator('[data-pass-switch="appearance.composition.vegetation.look"]');
  await vegetation.uncheck();
  await vegetation.check();
  await page.screenshot({ path: fileURLToPath(new URL('render-advanced-mixed.png', out)) });
  await page.keyboard.press('Escape');
  await roof.selectOption('minimal');
  const mixed = await exportProject();
  assert.equal(mixed.settings.appearance.composition.ground.look, 'satellite');
  assert.deepEqual(mixed.settings.appearance.composition.networks.water, {});
  assert.equal(mixed.settings.appearance.composition.vegetation.look, 'symbols');
  assert.equal(mixed.settings.appearance.composition.buildings.roof, 'minimal');
  assert.equal(mixed.settings.appearance.city?.ground, undefined);
  assert.deepEqual(mixed.world, original.world, 'style composition leaves every generated product untouched');
  // The tilted map: the same visibility controls, and its navigation on the map's own camera.
  await page.locator('[data-camera=tilt]').waitFor();
  await page.locator('#view3d').click();
  const nav = page.locator('.toolbar-row [data-navigation]');
  await nav.waitFor();
  for (const path of flags) assert(await page.locator(`.toolbar-row [data-setting-path="${path}"]`).isVisible());
  await nav.selectOption('fly');
  const canvas = page.locator('#map-canvas');
  await canvas.focus();
  const initial = await page.evaluate(() => window.__v2Test.camera3d());
  assert.equal(initial.navigation, 'fly');
  await page.keyboard.down('Space');
  await page.waitForFunction(z => window.__v2Test.camera3d().eye > z + 3, initial.eye);
  await page.keyboard.up('Space');
  // Pitch is measured from straight down: a quarter turn looks at the horizon.
  await page.evaluate(() => window.__v2Test.setCamera3d({ ...window.__v2Test.camera3d(), pitch: Math.PI / 2 }));
  const raised = await page.evaluate(() => window.__v2Test.camera3d());
  await page.keyboard.down('KeyW');
  await page.waitForFunction(({ x, y }) => {
    const camera = window.__v2Test.camera3d();
    return Math.hypot(camera.x - x, camera.y - y) > 3;
  }, raised);
  await page.keyboard.up('KeyW');
  const flown = await page.evaluate(() => window.__v2Test.camera3d());
  assert(Math.abs(flown.eye - raised.eye) < 0.01, 'horizontal flight keeps absolute altitude');
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
