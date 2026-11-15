/** A single headless check against the real built app and same-origin publication chunks. No Rust builds. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageNeuralPublication } from './neural_publication.mjs';

process.env.VK_LOADER_DEVICE_ID_FILTER = '0x2b85';
const web = fileURLToPath(new URL('..', import.meta.url)), output = resolve(web, 'dist-v2');
const manifest = await stageNeuralPublication(resolve(web, '../rust/pkg/neural-web'), resolve(output, 'neural'));
const result = { time: new Date().toISOString(), checks: {}, requests: [], progress: [], errors: [] };
let corrupt = false, browser, page;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost'), path = resolve(output, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(output + sep) || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
    const bytes = await readFile(path);
    if (url.pathname.startsWith('/neural/')) result.requests.push(url.pathname);
    if (corrupt && url.pathname.endsWith('coarse.safetensors.part0')) bytes[0] ^= 1;
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Content-Length': bytes.length,
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' });
    if (/\.part\d+$/.test(path)) {
      for (let offset = 0; offset < bytes.length && !response.destroyed; offset += 262144) {
        response.write(bytes.subarray(offset, offset + 262144));
        await new Promise(resolveChunk => setTimeout(resolveChunk, 2));
      }
      response.end();
    } else response.end(bytes);
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const base = `http://127.0.0.1:${server.address().port}/`;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.MAGNA_NEURAL_CHROME || undefined,
    args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
    env: { ...process.env, VK_LOADER_DEVICE_ID_FILTER: '0x2b85' } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  page = await context.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', error => result.errors.push(error.message));
  await page.goto(`${base}?test=1&lang=en`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__v2Test);
  result.gpu = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    let device, error;
    try { device = await adapter?.requestDevice(); } catch (cause) { error = String(cause); }
    finally { device?.destroy(); }
    return { api: !!navigator.gpu, adapter: !!adapter, device: !!device, error,
      info: adapter && { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } };
  });
  assert.equal(result.requests.filter(path => /\.part\d+$/.test(path)).length, 0);
  result.checks.noStartupWeights = true;
  const start = () => page.evaluate(() => {
    window.__neuralRun = window.__v2Test.runRegion({ generation: 'neural', runtime: { source: 'neural-wasm', backend: 'rust', compute: 'gpu' },
      terrain: { relief: 'mountains', resolution: 64, sampleSpacing: 625, hydrology: { enabled: false } }, extent: 40000, settlementCount: 1, places: 'main', region: { autoBuildPopulation: 0 } }).catch(error => { window.__neuralError = String(error); });
  });
  await start();
  const warning = page.locator('#neural-download-warning');
  await page.waitForFunction(() => !!document.querySelector('#neural-download-warning') || !!window.__neuralError);
  if (!await warning.count()) throw new Error(await page.evaluate(() => window.__neuralError));
  await warning.waitFor({ state: 'visible' });
  assert.match(await warning.textContent(), /163 MB/);
  assert.equal(await warning.locator('a').getAttribute('href'), 'https://github.com/dunkean/magna-urbis/releases');
  assert.equal(result.requests.length, 0);
  await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  assert.equal(result.requests.length, 0); result.checks.warningCancelNoDownload = true;

  // Corrupt real response bytes, without changing the published manifest.
  corrupt = true; await start(); await warning.waitFor({ state: 'visible' });
  await warning.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  assert.match(await page.locator('#job-log').textContent(), /integrity check/);
  const cacheSize = await page.evaluate(async () => (await (await caches.open('magna-urbis-neural-models-v1')).keys()).filter(key => key.url.includes('sha256=')).length);
  assert.equal(cacheSize, 0); result.checks.corruptionRejected = true; corrupt = false;

  // Cancel the streaming download; incomplete weights must not enter the cache.
  await start();
  await page.waitForFunction(() => document.querySelector('#progress-label')?.textContent === 'Downloading neural models…');
  assert.equal(await warning.count(), 0);
  await page.locator('#cancel-job').click();
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  result.checks.progressCancel = true;

  await page.exposeFunction('recordNeuralProgress', value => result.progress.push(value));
  await page.evaluate(() => {
    const card = document.querySelector('#progress-card');
    new MutationObserver(() => {
      if (card.hidden) return;
      const detail = document.querySelector('#progress-detail').textContent;
      if (/MB.*%/.test(detail)) window.recordNeuralProgress({ label: document.querySelector('#progress-label').textContent, detail, value: document.querySelector('#progress').value });
    }).observe(card, { subtree: true, characterData: true, childList: true, attributes: true });
  });
  await start();
  await page.waitForFunction(() => /coarse → base → decoder/.test(document.querySelector('#job-log')?.textContent ?? ''), null, { timeout: 180000 });
  await page.locator('#cancel-job').click();
  assert(result.progress.some(value => value.value > 0 && value.value < 100));
  assert(result.progress.some(value => /100%/.test(value.detail)));
  result.checks.warningProgressHashAndGenerationStart = true;
  await page.screenshot({ path: resolve(web, 'out/v2-neural-download.png') });

  const beforeReload = result.requests.filter(path => /\.part\d+$/.test(path)).length;
  await page.route('**/neural/**', route => route.abort('internetdisconnected'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__v2Test); await start();
  await page.waitForFunction(() => /coarse → base → decoder/.test(document.querySelector('#job-log')?.textContent ?? ''), null, { timeout: 180000 });
  assert.equal(await page.locator('#neural-download-warning').count(), 0);
  assert.equal(result.requests.filter(path => /\.part\d+$/.test(path)).length, beforeReload);
  await page.locator('#cancel-job').click(); result.checks.offlineCachedReloadGenerationStart = true;
  result.checks.chunkSizes = Object.values(manifest.models).flatMap(entry => entry.chunks.map(part => part.bytes));
  assert(result.checks.chunkSizes.every(bytes => bytes < 50_000_000));
  assert.deepEqual(result.errors, []); result.ok = true;
} catch (error) {
  result.ok = false; result.error = error.stack;
  if (page && !page.isClosed()) {
    result.page = await page.evaluate(() => ({ runError: window.__neuralError, log: document.querySelector('#job-log')?.textContent, text: document.body.textContent.slice(-6000) })).catch(() => ({}));
    await page.screenshot({ path: resolve(web, 'out/v2-neural-download-failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
}
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolveClosed => server.close(resolveClosed));
  await mkdir(resolve(web, 'out'), { recursive: true });
  await writeFile(resolve(web, 'out/v2-neural-download-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, progress: `${result.progress.length} events` }, null, 2));
}
