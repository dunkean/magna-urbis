/** Opt-in Windows desktop test against an already running real Python/CUDA terrain service.
 * Run: node scripts/v2_python_desktop_check.mjs --allow-existing-backend [--binary=<absolute path>]
 * This starts only an isolated desktop app; it never starts or stops the existing Python service.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

if (process.platform !== 'win32') throw Error('This test requires Windows and WebView2.');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
let allowed = process.env.MAGNA_TEST_NEURAL === 'local', binary = join(root, 'rust/desktop-v2/target/release/magna-urbis-v2-desktop.exe');
for (const arg of process.argv.slice(2)) {
  if (arg === '--allow-existing-backend') allowed = true;
  else if (arg.startsWith('--binary=')) binary = arg.slice('--binary='.length);
  else throw Error(`Unknown argument: ${arg}`);
}
if (!allowed) throw Error('Opt in with --allow-existing-backend or MAGNA_TEST_NEURAL=local; this test runs a real neural generation.');
if (!isAbsolute(binary) || !existsSync(binary)) throw Error(`Desktop executable must be an existing absolute path: ${binary}`);
const service = 'http://127.0.0.1:8793';
async function serviceStatus() {
  try {
    const response = await fetch(`${service}/status`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}
if ((await serviceStatus())?.backend !== 'python-cuda') throw Error('A compatible Python/CUDA terrain service must already be online at http://127.0.0.1:8793; no backend was started.');
const pause = ms => new Promise(done => setTimeout(done, ms));
async function freePort() {
  const server = createServer();
  await new Promise((done, fail) => server.once('error', fail).listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  return port;
}
const tempRoot = join(root, '.tmp'); await mkdir(tempRoot, { recursive: true });
const isolated = await mkdtemp(join(tempRoot, 'python-desktop-smoke-'));
const port = await freePort();
const env = { ...process.env, MAGNA_RUNTIME_DATA: join(isolated, 'data'), MAGNA_RUNTIME_CACHE: join(isolated, 'cache'),
  WEBVIEW2_USER_DATA_FOLDER: join(isolated, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
for (const key of ['MAGNA_LOCAL_BIN', 'MAGNA_NEURAL_PYTHON', 'MAGNA_ILLUSTRATION_PYTHON', 'MAGNA_NEURAL_EARTH']) delete env[key];
let child, browser, page, requestInFlight = false, finishRequest, completion, failure;
const checks = {};
async function until(description, check, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw Error(`Desktop exited while waiting for ${description}`);
    try { const result = await check(); if (result) return result; } catch { /* Retry until deadline. */ }
    await pause(250);
  }
  throw Error(`Timed out waiting for ${description}`);
}
try {
  child = spawn(binary, [], { cwd: dirname(binary), env, windowsHide: true, stdio: 'ignore' });
  const spawnError = new Promise((_, reject) => child.once('error', reject));
  await Promise.race([spawnError, until('WebView2 debugging endpoint', async () => (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok)]);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60000 });
  page = await until('desktop page', async () => {
    for (const context of browser.contexts()) for (const candidate of context.pages()) if (await candidate.locator('#terrain-only').count()) return candidate;
  });
  page.setDefaultTimeout(60000);
  await page.locator('#boot-splash').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#terrain-source').inputValue(), 'procedural', 'Expected a fresh procedural app profile');
  const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('desktop_status'));
  assert.equal(before.components.find(item => item.component === 'terrain')?.installed, false, 'The isolated app must not have a managed Python environment');
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('desktop_action', { action: 'start-terrain' }));
  const reuse = await until('existing Python service reuse', async () => {
    const value = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('desktop_status'));
    return !value.busy && value.lastOperation?.action === 'start-terrain' ? value.lastOperation : null;
  });
  assert.equal(reuse.success, true, `Could not reuse the existing Python service: ${reuse.message}`);
  assert.match(reuse.message, /reuse/i);
  await page.locator('#hardware-open').click();
  // Start from procedural: the bug was selecting Python without first clicking the neural source button.
  await page.locator('#exec-neural').selectOption('python');
  await page.waitForFunction(() => document.querySelector('#terrain-source')?.value === 'neural-python');
  assert.equal(await page.locator('#source-neural').getAttribute('aria-checked'), 'true');
  await page.evaluate(() => {
    document.querySelector('#hardware-dialog').close();
    const input = document.querySelector('[data-setting-path="terrain.resolution"]');
    if (input) { input.value = '64'; input.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  assert.equal(await page.locator('#terrain-source').inputValue(), 'neural-python');
  const isGenerate = request => { const url = new URL(request.url()); return url.hostname === '127.0.0.1' && url.port === '8793' && url.pathname === '/generate' && request.method() === 'POST'; };
  completion = new Promise(done => { finishRequest = done; });
  page.on('request', request => { if (isGenerate(request)) requestInFlight = true; });
  page.on('requestfinished', request => { if (isGenerate(request)) { requestInFlight = false; finishRequest(); } });
  page.on('requestfailed', request => { if (isGenerate(request)) { requestInFlight = false; finishRequest(); } });
  const responsePromise = page.waitForResponse(response => isGenerate(response.request()), { timeout: 120000 });
  await page.locator('#terrain-only').evaluate(button => button.click());
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Python generation returned HTTP ${response.status()}`);
  const payload = await response.body();
  assert.ok(payload.length > 0, 'Python generation response body is empty');
  await page.waitForFunction(() => !document.querySelector('#map-canvas')?.hidden && /python-cuda/i.test(document.querySelector('#job-log')?.textContent ?? '') && /carte prête|map ready/i.test(document.querySelector('#footer-status')?.textContent ?? ''), null, { timeout: 120000 });
  assert.match(await page.locator('#footer-status').innerText(), /carte prête|map ready/i);
  checks.python = { reused: reuse.message, status: response.status(), bytes: payload.length, backend: 'python-cuda' };
} catch (error) { failure = error; }
finally {
  if (requestInFlight) {
    console.error('Waiting for the in-flight Python generation response before closing the app.');
    await completion;
  }
  try { await page?.close({ runBeforeUnload: true }); } catch {}
  if (child && child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise(done => child.once('exit', done)), pause(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  try { await browser?.close(); } catch {}
  if ((await serviceStatus())?.backend !== 'python-cuda') failure ??= Error('Existing Python service stopped during the test.');
  try {
    const actualRoot = await realpath(tempRoot), actualTarget = await realpath(isolated), within = relative(actualRoot, actualTarget);
    if (!within || within === '..' || within.startsWith(`..\\`) || isAbsolute(within)) throw Error(`Unsafe cleanup target: ${actualTarget}`);
    await rm(actualTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) { failure ??= Error(`Could not remove isolated test data: ${error.message}`); }
}
if (failure) { console.error(failure.stack ?? String(failure)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, checks }, null, 2));
