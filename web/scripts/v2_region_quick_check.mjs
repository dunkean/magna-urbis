/** Browser acceptance for the first region: quick choices, real vector terrain and no urban stages. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5175/v2.html';
const output = resolve('out/v2-region-quick');
await mkdir(output, { recursive: true });
const report = { time: new Date().toISOString(), url, checks: {}, errors: [] };
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
await page.emulateMedia({ reducedMotion: 'reduce' });
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });

// Observe the real worker boundary. Only recipes, progress and compact result summaries leave the page.
await page.addInitScript(() => {
  const capture = window.__v2RegionQuick = { requests: [], results: [], progress: [], errors: [] };
  const postMessage = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) {
    const request = args[0];
    if (request?.action && ['terrain', 'region', 'roads', 'towns', 'town', 'all'].includes(request.action)) {
      capture.requests.push({ action: request.action, settings: structuredClone(request.settings),
        hasWorld: !!request.world, retainedWorldId: request.retainedWorldId });
    }
    if (!this.__v2RegionQuickCapture) {
      this.__v2RegionQuickCapture = true;
      this.addEventListener('message', ({ data }) => {
        if (data.type === 'progress') capture.progress.push({ stage: data.progress.stage,
          label: data.progress.label, detail: data.progress.detail, completed: data.progress.completed, total: data.progress.total });
        if (data.type === 'error') capture.errors.push(data.error);
        if (data.type !== 'result' || !data.world) return;
        const world = data.world, native = world.terrain.v2NativeTerrain, heights = world.terrain.height;
        capture.results.push({ mapSize: world.mapSize, workflow: world.options.workflow, worldKeys: Object.keys(world).sort(),
          stats: { ...world.stats }, terrain: { width: heights.w, height: heights.h, samples: heights.data.length,
            allFinite: heights.data.every(Number.isFinite), retainedNative: !!native, motifSize: native?.motifSize,
            vectorGrid: native?.water?.hydro?.n, rustWaterGrid: native?.hydrology?.resolution,
            rivers: world.terrain.rivers.length, lakes: world.terrain.lakes.length },
          unwantedLayers: ['site', 'roads', 'bridges', 'settlements', 'urban', 'names'].filter(key => Object.hasOwn(world, key)) });
      });
    }
    return postMessage.apply(this, args);
  };
});

const field = path => `#terrain-controls [data-setting-path="${path}"]`;
async function reveal(selector) {
  await page.locator(selector).evaluate(element => {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement)
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  });
}
async function input(selector, value) {
  await reveal(selector); await page.locator(selector).fill(String(value)); await page.locator(selector).blur();
  assert.notEqual(await page.locator(selector).getAttribute('aria-invalid'), 'true', `Invalid control: ${selector}`);
}
async function select(selector, value) { await reveal(selector); await page.locator(selector).selectOption(String(value)); }
async function recipe() {
  const section = page.locator('#expert-open').locator('xpath=ancestor::details[1]');
  const originallyOpen = await section.evaluate(element => element.open);
  if (!originallyOpen) await section.locator('summary').click();
  await page.locator('#expert-open').click();
  const settings = JSON.parse(await page.locator('#expert-json').inputValue());
  await page.locator('#expert-dialog [data-close]').first().click();
  if (!originallyOpen) await section.locator('summary').click();
  return settings;
}
async function resetScroll() { await page.locator('.control-scroll').evaluate(element => { element.scrollTop = 0; }); }
async function firstFold(name) {
  await resetScroll();
  const selectors = ['#terrain-width', '#terrain-source', '#terrain-biome', '#terrain-relief', '#terrain-scale',
    '#terrain-coast-toggle', '#terrain-hydrology-toggle', '#generate-region'];
  const geometry = await page.evaluate(selectors => selectors.map(selector => {
    const element = document.querySelector(selector), box = element.getBoundingClientRect();
    const scroll = element.closest('.control-scroll')?.getBoundingClientRect();
    return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      visible: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1
        && (!scroll || box.top >= scroll.top - 1 && box.bottom <= scroll.bottom + 1) };
  }), selectors);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  assert(geometry.every(item => item.visible), `Quick controls clipped on ${name}: ${JSON.stringify(geometry)}`);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow on ${name}`);
  return geometry;
}

try {
  console.log(`Region quick acceptance: ${url}`);
  await page.goto(url);
  await page.locator('#generate-region').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('#language-select').inputValue(), 'en');
  assert.equal(await page.locator('#terrain-width').inputValue(), '6');
  assert.equal(await page.locator('#terrain-width-unit').inputValue(), 'km');
  assert.equal(await page.locator('#terrain-extent-auto').isChecked(), false);
  assert.equal(await page.locator('#terrain-source').inputValue(), 'procedural');
  assert.equal(await page.locator('#terrain-scale').inputValue(), '10');
  assert.equal(await page.locator(field('terrain.hydrology.engine')).inputValue(), 'vector');
  assert.equal(await page.locator('#terrain-coast-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#terrain-hydrology-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#footer-status').textContent(), 'Terrain and water, in one click');
  report.checks.desktopFirstFold = await firstFold('desktop-first-fold-en');
  const defaults = await recipe();
  assert.equal(defaults.extent, 6000); assert.equal(defaults.terrain.motifSize, 10000);
  assert.equal(defaults.terrain.hydrology.engine, 'vector');
  report.checks.defaults = { language: 'en', extent: defaults.extent, proceduralScale: defaults.terrain.motifSize,
    hydrology: defaults.terrain.hydrology.engine };

  const icon = await page.locator('#terrain-hydrology-toggle .art-hydrology').evaluate(async element => {
    const background = getComputedStyle(element).backgroundImage;
    const source = /^url\(["']?(.*?)["']?\)$/.exec(background)?.[1];
    if (!source) throw new Error(`Missing hydrology icon: ${background}`);
    const image = new Image(); image.src = source; await image.decode();
    return { source, width: image.naturalWidth, height: image.naturalHeight };
  });
  assert(icon.width > 0 && icon.height > 0); report.checks.hydrologyIcon = icon;
  await page.locator('#terrain-hydrology-toggle').click();
  assert.equal(await page.locator('#terrain-hydrology-panel').isVisible(), true);
  assert.equal(await page.locator(field('terrain.hydrology.enabled')).isVisible(), true);
  assert.equal(await page.locator(field('terrain.hydrology.condMode')).isVisible(), true);
  assert.equal(await page.locator(field('terrain.hydrology.vectorResolution')).isVisible(), true);
  assert.equal(await page.locator(field('terrain.hydrology.resolution')).isVisible(), false);
  await input(field('terrain.hydrology.vectorWidth'), 4.2);
  await select(field('terrain.hydrology.engine'), 'rust');
  assert.equal(await page.locator(field('terrain.hydrology.resolution')).isVisible(), true);
  assert.equal(await page.locator(field('terrain.hydrology.vectorResolution')).isVisible(), false);
  await select(field('terrain.hydrology.resolution'), '256');
  await select(field('terrain.hydrology.compute'), 'cpu');
  await select(field('terrain.hydrology.engine'), 'vector');
  assert.equal(await page.locator(field('terrain.hydrology.vectorWidth')).inputValue(), '4.2');
  await select(field('terrain.hydrology.vectorResolution'), '512');
  await page.screenshot({ path: resolve(output, 'hydrology-vector-en.png') });
  await page.locator('#terrain-hydrology-toggle').click();
  await page.locator('#terrain-coast-toggle').click();
  assert.equal(await page.locator('#terrain-coast-panel').isVisible(), true);
  assert.equal(await page.locator('#terrain-coast-S').getAttribute('aria-pressed'), 'true');
  await page.locator('#terrain-coast-N').click();
  assert.equal((await recipe()).terrain.coastMask, 17);
  await page.locator('#terrain-coast-N').click();
  await page.locator('#terrain-coast-toggle').click();
  report.checks.optionalPanels = { commonWaterControls: true, vectorControls: true, rustControls: true,
    inactiveValuesRetained: true, selectableCoasts: true };

  await input('#terrain-scale', 12.5);
  await page.locator('#terrain-biome').selectOption('forest');
  await page.locator('#terrain-relief').selectOption('hills');
  const beforeLanguage = await recipe();
  assert.equal(beforeLanguage.terrain.motifSize, 12500);
  assert.equal(beforeLanguage.options.biome, 'forest'); assert.equal(beforeLanguage.terrain.relief, 'hills');
  await page.locator('#language-select').selectOption('fr');
  assert.equal(await page.locator('html').getAttribute('lang'), 'fr');
  assert.equal(await page.locator('#terrain-scale').inputValue(), '12.5');
  assert.equal(await page.locator('#terrain-hydrology-toggle .terrain-option-badge').textContent(), 'Vectoriel');
  assert.deepEqual(await recipe(), beforeLanguage);
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('#sidebar').evaluate(element => element.classList.contains('mobile-closed')))
    await page.locator('#mobile-toggle').click();
  report.checks.mobileFirstFold = await firstFold('mobile-first-fold-fr');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#language-select').selectOption('en');
  assert.deepEqual(await recipe(), beforeLanguage);
  report.checks.liveLanguages = { french: true, english: true, recipePreserved: true, editedScaleKm: 12.5, editedScaleMetres: 12500 };

  // Run exactly one primary-button job, at the new 10 km scale. Keep the selected 6 km region separate.
  await input('#terrain-scale', 10);
  await select('#terrain-compute', 'cpu');
  await select(field('terrain.generationCompute'), 'cpu');
  await input(field('terrain.resolution'), 128);
  await input(field('terrain.erosion'), .15);
  await page.locator('#terrain-hydrology-toggle').click();
  await select(field('terrain.hydrology.condMode'), 'none');
  await page.locator('#terrain-hydrology-toggle').click();
  await resetScroll();
  assert.equal(await page.evaluate(() => window.__v2RegionQuick.requests.length), 0);
  console.log('Quick controls, units, optional panels and live EN/FR passed; generating real CPU/vector terrain.');
  const started = Date.now();
  await page.locator('#generate-region').click();
  await page.waitForFunction(() => window.__v2RegionQuick.results.length || window.__v2RegionQuick.errors.length,
    null, { timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false',
    null, { timeout: 120000 });
  const capture = await page.evaluate(() => window.__v2RegionQuick);
  assert.deepEqual(capture.errors, [], await page.locator('#job-log').textContent());
  assert.equal(capture.requests.length, 1); assert.equal(capture.results.length, 1);
  const request = capture.requests[0], result = capture.results[0];
  assert.equal(request.action, 'terrain'); assert.equal(request.hasWorld, false);
  assert.equal(request.settings.extent, 6000); assert.equal(request.settings.terrain.motifSize, 10000);
  assert.equal(request.settings.terrain.hydrology.engine, 'vector');
  assert.equal(request.settings.terrain.hydrology.vectorResolution, 512);
  assert.equal(request.settings.terrain.hydrology.vectorWidth, 4.2);
  assert.equal(request.settings.runtime.compute, 'cpu');
  assert.equal(result.mapSize, 6000); assert.equal(result.workflow, 'environment');
  assert.equal(result.terrain.width, 128); assert.equal(result.terrain.height, 128);
  assert.equal(result.terrain.samples, 128 * 128); assert.equal(result.terrain.allFinite, true);
  assert.equal(result.terrain.retainedNative, true); assert.equal(result.terrain.motifSize, 10000);
  assert.equal(result.terrain.vectorGrid, 512); assert.equal(result.stats.backend, 'rust-wasm-cpu');
  assert.equal(result.stats['v2.stage'], 'terrain'); assert.deepEqual(result.unwantedLayers, []);
  assert.deepEqual(Object.keys(result.stats).filter(key => /settlement|population|urban|town|building|road/i.test(key)), []);
  assert(capture.progress.length > 2); assert(capture.progress.some(progress => progress.stage === 'terrain-water'));
  assert.equal(await page.locator('#tab-terrain').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#towns-count').textContent(), '0');
  assert.doesNotMatch(await page.locator('#job-log').textContent(), /\bvilles\b|\bcities\b|\btowns\b/i);
  report.checks.primaryGeneration = { elapsedMs: Date.now() - started, request, result, progress: capture.progress };
  await page.screenshot({ path: resolve(output, 'terrain-only-result-en.png') });
  assert.deepEqual(report.errors, []);
  report.ok = true;
  console.log(`Region quick acceptance passed. Artifacts: ${output}`);
} catch (error) {
  report.ok = false; report.failure = String(error.stack ?? error);
  report.capture = await page.evaluate(() => window.__v2RegionQuick).catch(() => undefined);
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  console.error(report.failure); process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
