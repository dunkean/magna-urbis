// Real browser integration of the native workshop, after build:houses.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {qaConfig, replayUrl, normalBudgetMs, installWorkerTrace, checkReplayBatch, saveReport, errorIssue, classifyLine} from './houses_qa_common.mjs';

const args = process.argv.slice(2).filter(value => value !== '--plan');
const base = args[0] ?? 'http://127.0.0.1:5179/housebench.html';
const out = resolve(args[1] ?? 'out/houses-ui/workshop');
const initialConfig = qaConfig({count: 1}), initialUrl = replayUrl(base, initialConfig);
if (process.argv.includes('--plan')) {console.log(JSON.stringify({initialUrl, initialConfig, timeout_ms: normalBudgetMs, source: 'Normal QA120s; workshop scenarios restored to count10'}, null, 2)); process.exit(0);}
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({viewport: {width: 1580, height: 1060}, acceptDownloads: true});
const errors = [];
const report = {complete: false, base, initialUrl, timeout_ms: normalBudgetMs, errors};
await installWorkerTrace(context);
function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('#status').classList.contains('busy') &&
    (document.querySelectorAll('.house-card').length || !document.querySelector('#error').hidden), null, {timeout: 120000});
}
async function success(page, count = 10) {
  await settled(page);
  if (await page.locator('#error').isVisible()) {
    const message = await page.locator('#error').textContent(), error = new Error(message);
    error.qaIssue = classifyLine(message); throw error;
  }
  assert.equal(await page.locator('.house-card').count(), count);
}
async function download(page, id, name) {
  const pending = page.waitForEvent('download');
  await page.locator(`#${id}`).click();
  const file = await pending, target = join(out, name);
  await file.saveAs(target);
  return target;
}
async function batch(page, name) { return JSON.parse(await readFile(await download(page, 'export-json', name), 'utf8')); }
try {
  const page = await context.newPage(); observe(page);
  await page.goto(initialUrl); await success(page, 1);
  report.initial = await batch(page, 'initial-count1.json');
  report.initialTrace = await checkReplayBatch(page, report.initial, initialConfig);
  await page.locator('#count').fill('10');
  const atlasPack = await page.locator('#pack').inputValue();
  await page.locator('#source').selectOption('workshop');
  assert.equal(await page.locator('#workshop-preset option').count(), 42);
  assert.equal(await page.locator('#mode').isDisabled(), true);
  assert.equal(await page.locator('#size').isDisabled(), true);
  assert.equal(await page.locator('#tour').isDisabled(), true);
  await page.locator('#workshop-preset').selectOption('WORKSHOP-FP-CROSS');
  await page.locator('#seed').fill('atelier é🏠');
  await page.locator('#advanced summary').click();
  await page.locator('#coating').selectOption({label: 'Aucun'});
  await page.locator('#workshop-base').selectOption({label: 'Aucune'});
  await page.locator('#generate').click(); await success(page);
  const cross = await batch(page, 'cross.json');
  assert(cross.units.every(unit => unit.recipe_id === 'WORKSHOP-FP-CROSS' && unit.variant_id === 'workshop'));
  assert.equal(cross.settings.pack, 'atelier'); assert.equal(cross.settings.recipe, null);
  assert.equal(cross.settings.mode, 'fantasy_mix'); assert.equal(cross.settings.size, 1);
  assert.equal(cross.settings.overrides.footprint, null); assert.equal(cross.settings.overrides.roof, null);
  assert.equal(cross.settings.overrides.coating, ''); assert.equal(cross.settings.workshop.base, '');
  await page.screenshot({path: join(out, 'cross.png'), fullPage: true});
  await page.locator('.house-card').first().click();
  assert.match(await page.locator('#detail-info').textContent(), /Forme et métriques/);
  assert.match(await page.locator('#detail-info').textContent(), /Atelier libre/);
  assert.match(await page.locator('#detail-info').textContent(), /stylized/);
  await page.screenshot({path: join(out, 'cross-detail.png')});
  await page.locator('#close-detail').click();
  await download(page, 'export-svg', 'cross.svg');
  const replay = await context.newPage(); observe(replay);
  await replay.goto(page.url()); await success(replay);
  assert.equal(await replay.locator('#source').inputValue(), 'workshop');
  assert.equal(await replay.locator('#coating option:checked').textContent(), 'Aucun');
  assert.equal(await replay.locator('#workshop-base option:checked').textContent(), 'Aucune');
  assert.deepEqual(await batch(replay, 'cross-replay.json'), cross);
  await replay.close();
  await page.locator('#reset-overrides').click();
  await page.locator('#workshop-preset').selectOption('WORKSHOP-FP-RECT');
  await page.locator('#workshop-width').fill('14'); await page.locator('#workshop-depth').fill('12');
  await page.locator('#workshop-support').selectOption('posts');
  await page.locator('#workshop-support-material').selectOption('MAT-TIMBER-POST');
  await page.locator('#workshop-support-height').fill('2');
  await page.locator('#workshop-roof-frame').selectOption('MAT-TIMBER-POST');
  await page.locator('#generate').click(); await success(page);
  const raised = await batch(page, 'raised.json');
  assert.equal(raised.settings.workshop.width_m, 14); assert.equal(raised.settings.workshop.depth_m, 12);
  assert.deepEqual(raised.settings.workshop.support, {kind: 'posts', material: 'MAT-TIMBER-POST', height_m: [2, 2]});
  assert.equal(raised.settings.workshop.roof_frame, 'MAT-TIMBER-POST');
  assert(raised.units.every(unit => unit.features.some(feature => feature.kind === 'post')));
  await page.locator('#workshop-width').fill('3'); await page.locator('#generate').click(); await settled(page);
  assert.equal(await page.locator('#error').isVisible(), true);
  assert.equal(await page.locator('.house-card').count(), 10);
  assert.deepEqual(await batch(page, 'retained.json'), raised, 'Rejected dimensions preserve the displayed native batch');
  await page.locator('#reset-overrides').click();
  await page.locator('#workshop-preset').selectOption('WORKSHOP-RF-CONE');
  await page.locator('#generate').click(); await success(page);
  const cone = await batch(page, 'cone.json');
  assert(cone.units.every(unit => unit.bodies.some(body => body.roof_system === 'RF-CONE')));
  await page.screenshot({path: join(out, 'cone.png'), fullPage: true});
  const offline = await context.newPage(); observe(offline);
  const network = []; offline.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  const offlineUrl = pathToFileURL(resolve('../rust/out/houses/housebench.html')); offlineUrl.search = new URL(page.url()).search;
  await offline.goto(offlineUrl.href); await success(offline);
  assert.deepEqual(await batch(offline, 'cone-offline.json'), cone);
  assert.deepEqual(network, []);
  await offline.screenshot({path: join(out, 'cone-offline.png'), fullPage: true});
  await offline.close();
  await page.locator('#source').selectOption('atlas');
  assert.equal(await page.locator('#pack').inputValue(), atlasPack);
  assert.equal(await page.locator('#mode').inputValue(), 'historical_inspired');
  assert.equal(await page.locator('#tour').isDisabled(), false);
  await page.locator('#seed').fill('42');
  await page.locator('#generate').click(); await success(page);
  assert.equal(Object.hasOwn((await batch(page, 'atlas-restored.json')).settings, 'workshop'), false);
  await page.locator('#show-catalogue').click();
  await page.locator('#catalogue-kind').selectOption('workshop');
  assert.equal(await page.locator('.catalogue-entry').count(), 42);
  assert.match(await page.locator('#catalogue-summary').textContent(), /32 packs/);
  assert.deepEqual(errors, []);
  Object.assign(report, {complete: true, result: 'passed', workshopPresets: 42, cards: 10, replay: 'identical', offlineNetworkRequests: network.length});
} catch (error) {
  report.failure = errorIssue(error, 'workshop'); process.exitCode = 1;
} finally {
  await saveReport(join(out, 'results.json'), report).catch(error => {console.error('Report write failed:', error.message); process.exitCode = 1;});
  await browser.close(); console.log(JSON.stringify({...report, initial: undefined, initialTrace: undefined, out}, null, 2));
}
