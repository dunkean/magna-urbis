/** Region acceptance: actual controls and worker stops, without app-only test hooks. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const output = 'out/v2-region-stages'; await mkdir(output, { recursive: true });
console.log('Region acceptance: launching browser');
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
console.log('Region acceptance: opening app');
page.setDefaultTimeout(30000);
const errors = [], report = { checks: {} };
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => {
  const capture = window.regionStagesCheck = { requests: [], results: [], progress: [], errors: [] };
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) {
    const request = args[0];
    if (request.action) capture.requests.push({ action: request.action, stage: request.terrainStage });
    if (!this.regionStageCapture) {
      this.regionStageCapture = true;
      this.addEventListener('message', ({ data }) => {
        if (data.type === 'progress') capture.progress.push(data.progress.stage);
        if (data.type === 'error') capture.errors.push(data.error);
        if (data.type === 'result') {
          const w = data.world, h = w.terrain.height.data; let min = Infinity, max = -Infinity;
          for (const value of h) { min = Math.min(min, value); max = Math.max(max, value); }
          capture.results.push({ stats: w.stats, rivers: w.terrain.rivers.length, areas: w.landuse.areas.length,
            finite: h.every(Number.isFinite), min, max, hasCover: !!w.terrain.v2NaturalForest });
        }
      });
    }
    return post.apply(this, args);
  };
});
const field = path => page.locator(`[data-setting-path="${path}"]`);
const slider = path => page.locator(`[data-slider-path="${path}"]`);
async function open(stage) {
  const title = page.locator(`#row-${stage} .stage-title`);
  if (await title.getAttribute('aria-expanded') !== 'true') await title.click();
}
async function job(selector, stage) {
  const before = await page.evaluate(() => ({ results: regionStagesCheck.results.length, progress: regionStagesCheck.progress.length }));
  await page.locator(selector).click();
  await page.waitForFunction(n => regionStagesCheck.results.length > n || regionStagesCheck.errors.length, before.results, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 120000 });
  const capture = await page.evaluate(before => ({ request: regionStagesCheck.requests.at(-1), result: regionStagesCheck.results.at(-1),
    progress: regionStagesCheck.progress.slice(before.progress), errors: regionStagesCheck.errors }), before);
  assert.deepEqual(capture.errors, []); assert(capture.result.finite); assert.equal(capture.request.stage, stage);
  return capture;
}
try {
  await page.goto(`${url}/v2.html?empty&lang=fr`);
  await page.waitForFunction(() => !!document.querySelector('[data-setting-path="terrain.erosionTuning.iterations"]')?.value, null, { timeout: 60000 });
  assert.equal(await page.locator('#terrain-extent-auto').count(), 0);
  assert.equal(await field('options.biome').isVisible(), false);
  assert(await page.locator('.family-method').evaluate(el => el.compareDocumentPosition(document.querySelector('.family-general')) & Node.DOCUMENT_POSITION_FOLLOWING));
  assert.equal(await page.locator('.climate-art').count(), 12); assert.equal(await page.locator('.relief-art').count(), 11);
  await page.evaluate(async () => {
    for (const selector of ['.climate-art', '.relief-art']) {
      const image = new Image(); image.src = getComputedStyle(document.querySelector(selector)).backgroundImage.match(/url\("?([^"\)]+)/)[1]; await image.decode();
      if (image.naturalWidth !== 1448 || image.naturalHeight !== 1086) throw new Error('Invalid icon atlas');
    }
  });
  await page.screenshot({ path: `${output}/01-region.png` });
  console.log('Region acceptance: general controls and icons passed');
  report.checks.general = 'Method first; explicit width; climate-derived surface biome; 23 painted icons';
  await page.locator('#terrain-width').fill('4.2'); await page.locator('#terrain-width').blur();
  assert.equal(await slider('extent').inputValue(), '4200');
  await slider('extent').fill('6000'); await slider('extent').dispatchEvent('input');
  assert.equal(await page.locator('#terrain-width').inputValue(), '6');
  await page.locator('[data-climate="desert"]').click(); assert.equal(await field('options.biome').inputValue(), 'desert');
  await page.locator('[data-climate="temperate"]').click(); assert.equal(await field('options.biome').inputValue(), 'temperate');
  await page.locator('[data-relief="hills"]').click(); assert.equal(await field('terrain.relief').inputValue(), 'hills');
  await open('relief-regional');
  const incision = 'terrain.erosionTuning.incision'; assert.equal(await field(incision).inputValue(), '1');
  await field(incision).fill('1.7'); await field(incision).blur(); assert.equal(await slider(incision).inputValue(), '1.7');
  await slider(incision).fill('2.3'); await slider(incision).dispatchEvent('input'); assert.equal(await field(incision).inputValue(), '2.3');
  await page.locator('#terrain-erosion-reset').click(); assert.equal(await field(incision).inputValue(), '1');
  await page.screenshot({ path: `${output}/02-editable-defaults.png` });
  await open('relief-grids');
  for (const [path, value] of [['terrain.procedural.regionalN', '64'], ['terrain.procedural.surfaceN', '64'], ['terrain.resolution', '64']]) {
    await field(path).fill(value); await field(path).blur();
  }
  await field('terrain.erosionTuning.iterations').fill('2'); await field('terrain.erosionTuning.iterations').blur();
  report.checks.defaults = 'Rust defaults, numeric edits, synchronized sliders and reset';
  console.log('Region acceptance: defaults and sliders passed');
  const source = await job('#row-relief-source .stage-run', 'relief-source');
  assert(source.progress.includes('pipeline:initialize:done'));
  for (const forbidden of ['pipeline:regional', 'pipeline:coasts', 'pipeline:hydrology', 'biome']) assert(!source.progress.includes(forbidden), forbidden);
  assert.equal(source.result.rivers, 0); assert.equal(source.result.areas, 0); assert.equal(source.result.hasCover, false);
  assert.equal(source.result.stats['v2.persisted'], 0); assert(source.result.stats['v2.terrainKey'].endsWith('|preview:relief-source'));
  await page.screenshot({ path: `${output}/03-source-output.png` });
  const regional = await job('#row-relief-regional .stage-run', 'relief-regional');
  assert(regional.progress.includes('pipeline:regional:done')); assert(!regional.progress.includes('pipeline:regionalFinish'));
  assert(!regional.progress.includes('pipeline:hydrology')); assert(!regional.progress.includes('biome'));
  report.checks.source = source; report.checks.regional = regional;
  console.log('Region acceptance: stage stops passed');
  const finished = await job('#family-region .family-run');
  assert(finished.progress.includes('biome')); assert.equal(finished.result.stats['v2.previewStage'], undefined);
  assert(!finished.result.stats['v2.terrainKey'].includes('|preview:')); assert(finished.result.hasCover);
  report.checks.full = finished;
  console.log('Region acceptance: full generation passed');
  const fullSubtitle = await page.locator('#map-subtitle').textContent();
  await job('#row-relief-source .stage-run', 'relief-source');
  assert(await page.locator('#preview-close').isVisible());
  await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('project');
  const downloadPending = page.waitForEvent('download'); await page.locator('#export-go').click();
  const download = await downloadPending, exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.world.stats['v2.terrainKey'], finished.result.stats['v2.terrainKey']);
  assert.equal(exported.world.stats['v2.previewStage'], undefined);
  const requestsBeforeClose = await page.evaluate(() => regionStagesCheck.requests.length);
  await page.locator('#preview-close').click();
  await page.waitForFunction(text => document.querySelector('#map-subtitle').textContent === text, fullSubtitle);
  assert.equal(await page.evaluate(() => regionStagesCheck.requests.length), requestsBeforeClose);
  assert.equal(await page.locator('#preview-close').isVisible(), false);
  report.checks.preservedProject = 'Preview preserves the full project on export; closing restores it without generation';
  await page.locator('#language-select').selectOption('en');
  await page.locator('.chain-scroll').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `${output}/04-region-en.png` });
  assert.deepEqual(errors, []); report.errors = errors;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log('Region acceptance passed: controls, generated icons, stage stops, separate full generation.');
} finally { await browser.close(); }
