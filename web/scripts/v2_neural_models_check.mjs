/** Model downloads through the real V2 controls, including persistence across page loads. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const output = resolve('out/v2-neural-models'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
const report = { checks: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    let persistent = false;
    Object.defineProperties(navigator.storage, { persist: { value: async () => { persistent = true; return true; } }, persisted: { value: async () => persistent } });
    const put = Cache.prototype.put;
    Cache.prototype.put = function(request, response) {
      if (globalThis.failModelSave && String(request).includes('base.nf4')) return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'));
      return put.call(this, request, response);
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  const payloads = { coarse: Buffer.alloc(8192, 1), base: Buffer.alloc(65536, 2), decoder: Buffer.alloc(8192, 3) };
  const manifest = { profile: 'coarse4-nf4-b75-t2-distilled-decoder', runtimeSha256: 'a'.repeat(64), engineRevision: 'browser-check', models: Object.fromEntries(Object.entries(payloads).map(([name, bytes]) => [name, { file: name === 'base' ? 'base.nf4' : `${name}.safetensors`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(name === 'base' ? { selection: 'nf4_b75', solverSteps: 2 } : {}) }])) };
  let catalogueOffline = false, holdBase = false, corruptBase = false;
  const requests = [];
  await page.route('**/neural/models/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('manifest.json')) {
      if (catalogueOffline) return route.abort('internetdisconnected');
      return route.fulfill({ json: manifest });
    }
    requests.push(path);
    const name = Object.keys(manifest.models).find(key => path.endsWith(manifest.models[key].file));
    if (!name) return route.fulfill({ status: 404 });
    if (name === 'base' && holdBase) await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ body: name === 'base' && corruptBase ? Buffer.alloc(payloads.base.length, 9) : payloads[name], contentType: 'application/octet-stream' }).catch(() => {});
  });
  const panel = page.locator('#neural-model-manager');
  const message = page.locator('#neural-model-message');
  const open = async () => { await page.locator('#hardware-open').click(); await panel.waitFor(); await panel.scrollIntoViewIfNeeded(); await page.waitForFunction(() => document.querySelector('#neural-model-manager')?.getAttribute('aria-busy') === 'false'); };
  const waitFor = async expression => { await page.waitForFunction(expression); };
  const stored = async name => page.locator(`[data-model="${name}"]`).getAttribute('data-stored');
  const close = async () => { await page.locator('#hardware-dialog [data-close]').first().click(); };
  await page.goto(`${base}/v2.html?empty&lang=fr`); await open();
  assert.equal(await page.locator('[data-model]').count(), 3);
  assert.match(await panel.textContent(), /NF4 B75/); assert.equal(requests.length, 0);
  report.checks.push('Inspecting downloads does not fetch weights');
  await page.locator('[data-model="coarse"] [data-action="download"]').click();
  await waitFor(() => document.querySelector('[data-model="coarse"]')?.getAttribute('data-stored') === 'true');
  holdBase = true;
  await page.locator('[data-model="base"] [data-action="download"]').click();
  await page.locator('#neural-model-cancel').click();
  await waitFor(() => document.querySelector('#neural-model-message')?.textContent.includes('annulé'));
  assert.equal(await stored('base'), 'false'); assert.equal(await stored('coarse'), 'true'); holdBase = false;
  report.checks.push('Cancellation keeps completed files without saving partial models');
  await page.evaluate(() => { globalThis.failModelSave = true; });
  await page.locator('[data-model="base"] [data-action="download"]').click();
  await waitFor(() => document.querySelector('#neural-model-message')?.textContent.includes('espace disque'));
  assert.equal(await stored('base'), 'false');
  await page.evaluate(() => { globalThis.failModelSave = false; });
  report.checks.push('Quota errors remain visible and never claim the model is saved');
  corruptBase = true;
  await page.locator('[data-model="base"] [data-action="download"]').click();
  await waitFor(() => document.querySelector('#neural-model-message')?.textContent.includes('intégrité a échoué'));
  assert.equal(await stored('base'), 'false'); corruptBase = false;
  report.checks.push('Corrupt downloads rejected by the UI');
  await page.locator('#neural-model-download-all').click();
  await waitFor(() => document.querySelectorAll('[data-model][data-stored="true"]').length === 3);
  assert.match(await message.textContent(), /vérifiés et enregistrés/);
  await page.locator('#neural-model-persist').click();
  await waitFor(() => document.querySelector('#neural-model-persist')?.disabled);
  assert.match(await panel.textContent(), /Stockage persistant accordé/);
  report.checks.push('Download all missing models, then request persistent storage');
  const downloadedCount = requests.length;
  await page.reload(); await open();
  assert.equal(await page.locator('[data-model][data-stored="true"]').count(), 3);
  assert.equal(requests.length, downloadedCount);
  report.checks.push('Reload discovers saved files without downloading them again');
  catalogueOffline = true;
  await page.locator('#neural-model-refresh').click();
  await waitFor(() => document.querySelector('#neural-model-message')?.textContent.includes('catalogue conservé'));
  assert.equal(await page.locator('[data-model][data-stored="true"]').count(), 3);
  report.checks.push('Saved catalogue and model inventory remain inspectable when server fails');
  catalogueOffline = false;
  await page.locator('[data-model="base"] [data-action="remove"]').click();
  await waitFor(() => document.querySelector('[data-model="base"]')?.getAttribute('data-stored') === 'false');
  assert.equal(await stored('coarse'), 'true'); assert.equal(await stored('decoder'), 'true');
  await page.locator('#neural-model-clear').click();
  await waitFor(() => document.querySelectorAll('[data-model][data-stored="true"]').length === 0);
  report.checks.push('Individual deletion and remove all affect the model cache');
  await close(); await page.locator('#language-select').selectOption('en'); await open();
  assert.match(await panel.locator(':scope > summary').textContent(), /Downloaded neural models/);
  await panel.locator('.neural-model-explanation > summary').click();
  assert.match(await panel.locator('.neural-model-explanation').textContent(), /22.15–24.06 m/);
  assert.match(await page.locator('#neural-model-download-all').textContent(), /Download missing models/);
  report.checks.push('Live English and French translations');
  await context.close();

  // Verify the actual prepared files as served by Vite, without starting neural inference.
  const real = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const realPage = await real.newPage(); realPage.setDefaultTimeout(30000);
  realPage.on('pageerror', error => report.errors.push(error.message));
  await realPage.goto(`${base}/v2.html?empty&lang=fr`);
  await realPage.locator('#hardware-open').click();
  const realPanel = realPage.locator('#neural-model-manager');
  await realPanel.scrollIntoViewIfNeeded();
  await realPage.locator('#neural-model-download-all').click();
  await realPage.waitForFunction(() => document.querySelectorAll('[data-model][data-stored="true"]').length === 3, null, { timeout: 120000 });
  assert.match(await realPanel.textContent(), /149,64 Mo/); assert.match(await realPanel.textContent(), /162,27 Mo/);
  await realPanel.screenshot({ path: resolve(output, 'models-downloaded-fr.png') });
  await realPage.reload(); await realPage.locator('#hardware-open').click();
  await realPage.waitForFunction(() => document.querySelectorAll('[data-model][data-stored="true"]').length === 3);
  report.checks.push('Actual 162.27 MB prepared weights downloaded, SHA-256 verified, saved and found after reload');
  await realPage.setViewportSize({ width: 390, height: 844 });
  await realPanel.scrollIntoViewIfNeeded();
  assert(await realPanel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await realPanel.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await realPage.screenshot({ path: resolve(output, 'models-downloaded-mobile-fr.png') });
  report.checks.push('Mobile panel fits a 390 px viewport');
  await real.close();
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
