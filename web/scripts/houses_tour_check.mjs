// One real count10 tour; checkpoints preserve Rust rejections and QA timeouts.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {qaConfig, replayUrl, normalBudgetMs, readMeasuredBudgets, classifyLine,
  errorIssue, saveReport, installWorkerTrace} from './houses_qa_common.mjs';

const args = process.argv.slice(2), plan = args.includes('--plan');
const positional = args.filter(value => value !== '--plan');
const base = positional[0] ?? 'http://127.0.0.1:5179/housebench.html';
const out = resolve(positional[1] ?? 'out/houses-ui/tour');
const initialConfig = qaConfig({count: 1});
const expectedConfig = pack => qaConfig({pack});
const budgets = await readMeasuredBudgets(positional[2], expectedConfig);
if (Object.keys(budgets).length) {
  const source = JSON.parse(await readFile(new URL('../../rust/crates/houses/data/source-inventory.json', import.meta.url), 'utf8'));
  for (const id of Object.keys(budgets)) assert(source.packs.some(pack => pack.id === id), `Unknown budget pack ${id}`);
}
const initialUrl = replayUrl(base, initialConfig);
if (plan) {
  console.log(JSON.stringify({initialUrl, initialConfig, tourConfig: qaConfig(), normalBudgetMs,
    measuredPackBudgets: budgets, scope: 'one count10 tour, seed42, orientation0; default10 tested by ui_check'}, null, 2));
  process.exit(0);
}
await mkdir(out, {recursive: true});
const reportPath = join(out, 'results.json');
const report = {base, initialUrl, complete: false, normalBudgetMs, measuredPackBudgets: budgets,
  scope: 'count10, seed42, orientation0', rows: [], consoleErrors: []};
const browser = await chromium.launch();
let page, packs = [], phase = 'initialReplay';
try {
  page = await browser.newPage({viewport: {width: 1580, height: 1060}});
  await installWorkerTrace(page);
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
  await page.goto(initialUrl, {timeout: normalBudgetMs});
  await page.waitForFunction(() => !document.querySelector('#status').classList.contains('busy') &&
    (document.querySelectorAll('.house-card').length || !document.querySelector('#error').hidden), null, {timeout: normalBudgetMs});
  if (await page.locator('#error').isVisible()) throw new Error(`Initial replay: ${await page.locator('#error').textContent()}`);
  assert.equal(await page.locator('.house-card').count(), 1);
  assert.equal(await page.locator('#replay-warning').isVisible(), false);
  report.initialRequests = await page.evaluate(() => window.houseQaTrace.requests);
  const initialGenerates = report.initialRequests.filter(request => request.kind === 'generate');
  assert.equal(initialGenerates.length, 1); assert.deepEqual(initialGenerates[0].config, initialConfig);
  packs = await page.locator('#pack option').evaluateAll(options => options.map(option => ({id: option.value, label: option.textContent})));
  assert.equal(packs.length, 32);
  for (const id of Object.keys(budgets)) assert(packs.some(pack => pack.id === id), `Unknown budget pack ${id}`);
  await page.locator('#count').fill('10'); await page.locator('#seed').fill('42'); await page.locator('#orientation').fill('0');
  await page.locator('.tour-panel summary').click(); await page.locator('#tour').click();
  for (let index = 0; index < packs.length; index++) {
    const pack = packs[index], budget = budgets[pack.id]?.timeout_ms ?? normalBudgetMs;
    phase = 'packStart';
    await page.waitForFunction(i => document.querySelectorAll('#tour-table tbody tr').length > i, index, {timeout: normalBudgetMs});
    const started = Date.now(); phase = 'packGeneration';
    report.current = {pack: pack.id, index, timeout_ms: budget, config: expectedConfig(pack.id)};
    await saveReport(reportPath, report);
    try {
      await page.waitForFunction(i => document.querySelectorAll('#tour-table tbody tr')[i]?.cells[1].textContent !== 'Génération…', index, {timeout: budget});
    } catch (error) {
      report.rows.push({...report.current, ...errorIssue(error, phase), elapsed_ms: Date.now() - started});
      for (const next of packs.slice(index + 1)) report.rows.push({pack: next.id, status: 'notRun'});
      process.exitCode = 1; break;
    }
    const cells = await page.locator('#tour-table tbody tr').nth(index).evaluate(row => [...row.cells].map(cell => cell.textContent));
    const trace = await page.evaluate(() => window.houseQaTrace);
    const requests = trace.requests.filter(request => request.kind === 'generate' && request.config?.pack === pack.id);
    const tourRequests = requests.filter(request => request.config.count === 10);
    assert.equal(tourRequests.length, 1); assert.deepEqual(tourRequests[0].config, expectedConfig(pack.id));
    const row = {...report.current, label: cells[0], ...classifyLine(cells[1]), rooms: cells[2] ? Number(cells[2]) : null,
      elapsed_ms: Date.now() - started, wasm_elapsed_ms: cells[3] ? Number(cells[3].split(' ')[0]) : null, request: tourRequests[0]};
    report.rows.push(row); delete report.current;
    if (row.status !== 'success') process.exitCode = 1;
    await saveReport(reportPath, report);
  }
  if (!report.current) {
    phase = 'tourFinished'; await page.locator('#stop-tour').waitFor({state: 'hidden', timeout: normalBudgetMs});
    report.complete = report.rows.length === packs.length;
  }
  phase = 'capture'; await page.screenshot({path: join(out, 'tour.png'), fullPage: true});
} catch (error) {
  report.failure = errorIssue(error, phase);
  if (phase === 'initialReplay') report.failure.status = error?.name === 'TimeoutError' ? 'timeoutQA' : 'replayError';
  const recorded = new Set(report.rows.map(row => row.pack));
  for (const pack of packs) if (!recorded.has(pack.id)) report.rows.push({pack: pack.id, status: 'notRun'});
  process.exitCode = 1;
} finally {
  if (page && !page.isClosed()) report.trace = await page.evaluate(() => window.houseQaTrace).catch(() => null);
  report.succeeded = report.rows.filter(row => row.status === 'success').length;
  if (report.consoleErrors.length) process.exitCode = 1;
  await saveReport(reportPath, report).catch(error => {console.error('Report write failed:', error.message); process.exitCode = 1;});
  await browser.close();
  console.log(JSON.stringify({complete: report.complete, succeeded: report.succeeded,
    issues: report.rows.filter(row => row.status !== 'success'), failure: report.failure, report: reportPath}, null, 2));
}
