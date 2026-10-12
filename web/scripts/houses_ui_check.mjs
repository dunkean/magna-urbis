// Compact browser integration check. Run after build:houses with a dedicated
// Vite housebench server: node scripts/houses_ui_check.mjs http://127.0.0.1:5179/housebench.html
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {qaConfig, replayUrl, normalBudgetMs, installWorkerTrace, saveReport, errorIssue, classifyLine} from './houses_qa_common.mjs';

const args = process.argv.slice(2).filter(value => value !== '--plan');
const base = args[0] ?? 'http://127.0.0.1:5179/housebench.html';
const out = resolve(args[1] ?? 'out/houses-ui');
if (process.argv.includes('--plan')) {console.log(JSON.stringify({defaultConfig: qaConfig(), timeout_ms: normalBudgetMs,
  cancellationReplay: replayUrl(base, qaConfig({pack: 'AS-CHI', recipe: 'AS-CHI-B13', count: 1, variation: 0, allow_late: true})),
  scope: 'default10/interactions/Unicode37/offline/mobile/fallback/occupiedWorker/stopTour; full tour only in tour_check'}, null, 2)); process.exit(0);}
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1580, height: 1060 }, acceptDownloads: true });
await installWorkerTrace(context);
const errors = [];
const report = {complete: false, base, timeout_ms: normalBudgetMs, errors,
  tourScope: 'Stop only. The complete orientation0 tour is in tour_check; Unicode replay retains orientation37.'};
function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('#status').classList.contains('busy') && (document.querySelectorAll('.house-card').length > 0 || !document.querySelector('#error').hidden), null, { timeout: 120000 });
}
async function successful(page) {
  await settled(page);
  if (await page.locator('#error').isVisible()) {
    const message = await page.locator('#error').textContent(), error = new Error(message);
    error.qaIssue = classifyLine(message); throw error;
  }
  assert.equal(await page.locator('.house-card').count(), 10);
}
async function exportFile(page, id, name) {
  const download = page.waitForEvent('download');
  await page.locator(`#${id}`).click();
  const result = await download;
  const filename = join(out, name ?? result.suggestedFilename());
  await result.saveAs(filename);
  return filename;
}
try {
  const page = await context.newPage(); observe(page);
  await page.goto(base); await successful(page);
  await page.screenshot({ path: join(out, 'roof.png'), fullPage: true });
  const initial = JSON.parse(await readFile(await exportFile(page, 'export-json', 'initial.json'), 'utf8'));
  report.initial = {file: 'initial.json', settings: initial.settings, units: initial.units.length,
    requests: await page.evaluate(() => window.houseQaTrace.requests)};
  const initialGenerates = report.initial.requests.filter(request => request.kind === 'generate');
  assert.equal(initialGenerates.length, 1); assert.deepEqual(initialGenerates[0].config, initial.settings);
  assert.deepEqual(initial.settings, qaConfig(), 'The dedicated script records the real default10');
  await saveReport(join(out, 'results.json'), report);
  assert.equal(initial.schema_version, '2'); assert.equal(initial.settings.count, 10);
  assert.equal(initial.units.length, 10); assert(initial.generator_version && initial.catalogue_version);
  await page.locator('#view-plan').click(); await page.locator('#graph').check(); await page.locator('#dimensions').check();
  await page.screenshot({ path: join(out, 'plan-graph.png'), fullPage: true });
  await page.locator('.house-card').first().click();
  assert.equal(await page.locator('#detail-dialog').isVisible(), true);
  assert.equal(await page.locator('#detail-level option').count(), initial.units[0].levels.length);
  await page.screenshot({ path: join(out, 'detail.png') });
  await exportFile(page, 'detail-svg', 'detail.svg'); await page.locator('#close-detail').click();
  const sheet = await exportFile(page, 'export-svg', 'sheet.svg');
  const svg = await readFile(sheet, 'utf8');
  assert(svg.includes('fill-rule="evenodd"')); assert(!/https?:\/\//.test(svg.replace('http://www.w3.org/2000/svg', '')));
  const svgPage = await context.newPage(); observe(svgPage);
  const external = []; svgPage.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await svgPage.goto(pathToFileURL(sheet).href);
  const svgBox = await svgPage.locator('svg').first().boundingBox();
  await svgPage.setViewportSize({ width: Math.ceil(svgBox.width), height: Math.ceil(svgBox.height) });
  await svgPage.screenshot({ path: join(out, 'sheet.png') });
  assert.equal(external.length, 0); await svgPage.close();
  await page.locator('#advanced summary').click();
  await page.locator('#mode').selectOption('historical_strict'); await page.locator('#allow-late').check();
  await page.locator('#generate').click(); await settled(page);
  assert.equal(await page.locator('#error').isVisible(), true);
  assert.match(await page.locator('#error').textContent(), /invalid_config/);
  assert.equal(await page.locator('.house-card').count(), 10, 'Rejected requests preserve the last successful lot');
  await page.locator('#mode').selectOption('historical_inspired'); await page.locator('#allow-late').uncheck();
  await page.locator('#recipe').selectOption(initial.settings.recipe ?? 'EUR-MED-B01');
  await page.locator('#overhang').fill('0'); await page.locator('#generate').click(); await settled(page);
  assert.equal(await page.evaluate(() => window.houseRequests.at(-1).overrides.overhang_m), 0, 'An explicit zero reaches Rust unchanged');
  await page.locator('#floors').fill('');
  await page.locator('#seed').fill('Village é🏠'); await page.locator('#orientation').fill('37'); await page.locator('#overhang').fill('');
  await page.locator('#generate').click(); await successful(page);
  const unicode = JSON.parse(await readFile(await exportFile(page, 'export-json', 'unicode.json'), 'utf8'));
  const unicodeUrl = page.url();
  assert.equal(unicode.settings.seed, 'Village é🏠'); assert.equal(unicode.settings.overrides.overhang_m, null); assert.equal(unicode.settings.overrides.floors, null);
  const replayPage = await context.newPage(); observe(replayPage); await replayPage.goto(page.url()); await successful(replayPage);
  const replay = JSON.parse(await readFile(await exportFile(replayPage, 'export-json', 'replay.json'), 'utf8'));
  assert.deepEqual(replay, unicode, 'UTF-8 replay reproduces the entire Rust lot'); await replayPage.close();
  await page.locator('#seed').fill('premier ticket'); await page.locator('#generate').click();
  await page.locator('#seed').fill('dernier ticket'); await page.locator('#generate').click(); await successful(page);
  const latest = JSON.parse(await readFile(await exportFile(page, 'export-json', 'latest.json'), 'utf8'));
  assert.equal(latest.settings.seed, 'dernier ticket');
  const occupied = await context.newPage(); observe(occupied);
  await occupied.goto(replayUrl(base, qaConfig({pack: 'AS-CHI', recipe: 'AS-CHI-B13', count: 1, variation: 0, allow_late: true})));
  await occupied.waitForFunction(() => window.houseQaTrace.requests.some(request => request.kind === 'generate'), null, {timeout: normalBudgetMs});
  const interrupted = await occupied.evaluate(() => window.houseQaTrace.requests.find(request => request.kind === 'generate'));
  assert.equal(await occupied.locator('#status').evaluate(status => status.classList.contains('busy')), true);
  assert.equal(await occupied.evaluate(ticket => window.houseQaTrace.responses.some(response => response.ticket === ticket), interrupted.ticket), false);
  await occupied.locator('#pack').selectOption('EUR-MED'); await occupied.locator('#recipe').selectOption('EUR-MED-B01');
  await occupied.locator('#count').fill('10'); await occupied.locator('#seed').fill('Worker interrompu é🏠');
  await occupied.locator('#generate').click(); await successful(occupied);
  const replacement = JSON.parse(await readFile(await exportFile(occupied, 'export-json', 'occupied-worker-replacement.json'), 'utf8'));
  const occupiedTrace = await occupied.evaluate(() => window.houseQaTrace);
  const replacementRequest = occupiedTrace.requests.filter(request => request.kind === 'generate').at(-1);
  assert(replacementRequest.ticket > interrupted.ticket);
  assert(occupiedTrace.terminated.some(event => event.worker === interrupted.worker));
  assert(!occupiedTrace.responses.some(response => response.ticket === interrupted.ticket));
  assert.deepEqual(replacement.settings, replacementRequest.config);
  assert.equal(replacement.settings.seed, 'Worker interrompu é🏠');
  report.cancellation = {status: 'cancelled', interrupted, replacementRequest, trace: occupiedTrace};
  await occupied.close();
  await page.locator('#seed').evaluate(element => { element.value = '\ud800'; element.dispatchEvent(new Event('input', {bubbles: true})); });
  await page.locator('#generate').click(); await settled(page);
  assert.match(await page.locator('#error').textContent(), /Unicode invalide/); assert.equal(await page.locator('.house-card').count(), 10);
  await page.locator('#seed').fill('\u0001'.repeat(4096)); await page.locator('#generate').click(); await successful(page);
  assert.equal(await page.locator('#copy-link').isDisabled(), true); assert.equal(new URL(page.url()).searchParams.has('replay'), false);
  assert.match(await page.locator('#link-warning').textContent(), /trop longue/);
  await page.locator('#show-catalogue').click();
  assert.match(await page.locator('#catalogue-summary').textContent(), /32 packs/); await page.locator('#catalogue-kind').selectOption('roofs');
  assert.equal(await page.locator('.catalogue-entry').count(), 22); await page.locator('#close-catalogue').click();
  const offline = await context.newPage(); observe(offline);
  const network = []; offline.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  const offlineUrl = pathToFileURL(resolve('../rust/out/houses/housebench.html')); offlineUrl.search = new URL(unicodeUrl).search;
  await offline.goto(offlineUrl.href); await successful(offline);
  assert.deepEqual(JSON.parse(await readFile(await exportFile(offline, 'export-json', 'unicode-offline.json'), 'utf8')), unicode);
  assert.equal(network.length, 0); await offline.screenshot({ path: join(out, 'offline.png'), fullPage: true });
  const mobile = await context.newPage(); observe(mobile); await mobile.setViewportSize({width: 430, height: 932});
  await mobile.goto(unicodeUrl); await successful(mobile); await mobile.locator('.house-card').first().click();
  const mobileMap = await mobile.locator('#detail-map').boundingBox(); assert(mobileMap.x >= 0 && mobileMap.x + mobileMap.width <= 430);
  await mobile.screenshot({path: join(out, 'mobile-detail.png')});
  const fallback = await context.newPage(); observe(fallback);
  await fallback.addInitScript(() => { window.Worker = undefined; });
  await fallback.goto(unicodeUrl); await successful(fallback);
  assert.match(await fallback.locator('#status').textContent(), /sans worker/);
  await fallback.locator('#count').fill('11'); await fallback.locator('#generate').click(); await settled(fallback);
  assert.match(await fallback.locator('#error').textContent(), /limité à dix unités/); assert.equal(await fallback.locator('.house-card').count(), 10);
  await page.locator('#seed').fill('42'); await page.locator('.tour-panel summary').click(); await page.locator('#tour').click();
  await page.waitForFunction(() => document.querySelectorAll('#tour-table tbody tr').length > 0);
  await page.locator('#stop-tour').click(); await page.locator('#stop-tour').waitFor({state: 'hidden', timeout: normalBudgetMs});
  assert.match(await page.locator('#status').textContent(), /Tournée arrêtée/);
  const tour = await page.locator('#tour-table tbody tr').allTextContents();
  await page.screenshot({path: join(out, 'tour.png'), fullPage: true});
  assert.deepEqual(errors, [], 'Browser console remains clean');
  Object.assign(report, {complete: true, result: 'passed', cards: 10, replay: 'identical', offlineNetworkRequests: network.length, stoppedTourPacks: tour.length});
} catch (error) {
  report.failure = errorIssue(error, 'interactions'); process.exitCode = 1;
} finally {
  await saveReport(join(out, 'results.json'), report).catch(error => {console.error('Report write failed:', error.message); process.exitCode = 1;});
  await browser.close(); console.log(JSON.stringify({...report, initial: undefined, cancellation: report.cancellation ? {status: report.cancellation.status} : undefined, out}, null, 2));
}
