/** Rustbench generation-panel QA. Stub workers before app boot: no terrain or model computation. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.RUSTBENCH_CHECK_URL ?? 'http://127.0.0.1:5185/rustbench.html';
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.context().grantPermissions(['local-network-access'], { origin: new URL(base).origin });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__rustbench-physical-controls-qa.html', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' }));
  await page.goto(new URL('/__rustbench-physical-controls-qa.html', base).href, { waitUntil: 'domcontentloaded' });
  const markup = await page.evaluate(async () => {
    const response = await fetch('/terrainbench.html');
    if (!response.ok) throw new Error(`terrainbench.html: HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const withinSuperAdvanced = id => !!doc.getElementById(id)?.closest('details')?.querySelector('summary')?.textContent.includes('Super avancé');
    return {
      widthMax: doc.getElementById('width')?.getAttribute('max'), spacing: !!doc.getElementById('sampleSpacing'),
      summary: !!doc.getElementById('sourceDefinitionSummary'), auto: !!doc.querySelector('#generationCompute option[value="auto"]'),
      erosionAdvanced: withinSuperAdvanced('erosion'), hydroGridAdvanced: withinSuperAdvanced('hydroResolution'),
    };
  });
  assert.deepEqual(markup, { widthMax: '200000', spacing: true, summary: true, auto: true, erosionAdvanced: true, hydroGridAdvanced: true });

  const bench = await browser.newPage();
  await bench.context().grantPermissions(['local-network-access'], { origin: new URL(base).origin });
  bench.on('pageerror', error => { errors.push(error.message); console.error(`RustBench page: ${error.stack ?? error.message}`); });
  await bench.addInitScript(() => {
    window.__physicalQaRequests = [];
    class StubWorker {
      onmessage = null;
      onerror = null;
      listeners = new Map();
      postMessage(message) {
        window.__physicalQaRequests.push(message);
        if (message.kind === 'overview') queueMicrotask(() => this.onmessage?.({ data: {
          id: message.id, generation: message.generation, kind: message.kind, error: 'Génération annulée.',
        } }));
      }
      addEventListener(type, listener) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
      removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener)); }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { configurable: true, value: StubWorker });
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });
  const url = new URL('/terrainbench.html', base);
  url.search = 'standalone=1&profile=web&source=procedural&generation=auto&width=10000&sampleSpacing=30&compute=wasm&auto=0&render=svg';
  await bench.goto(url.href, { waitUntil: 'domcontentloaded' });
  await bench.waitForFunction(() => document.querySelector('#sourceDefinitionSummary')?.textContent.includes('334²')).catch(async error => {
    const state = await bench.evaluate(() => ({ title: document.title, path: location.pathname,
      summary: document.querySelector('#sourceDefinitionSummary')?.textContent,
      status: document.querySelector('#status')?.textContent,
      source: document.querySelector('#terrainSource')?.value,
      width: document.querySelector('#width')?.value,
      startup: document.body.dataset.terrainStartup, requests: window.__physicalQaRequests?.length }));
    throw new Error(`${error.message}\nRustBench state: ${JSON.stringify(state)}\nPage errors: ${errors.join('; ')}`);
  });
  await bench.waitForFunction(() => window.__physicalQaRequests?.some(request => request.kind === 'overview'));
  const layout = await bench.evaluate(() => ({
    widthMain: !!document.querySelector('#width')?.closest('.panel-main'),
    spacingMain: !!document.querySelector('#sampleSpacing')?.closest('.panel-main'),
    summaryMain: !!document.querySelector('#sourceDefinitionSummary')?.closest('.panel-main'),
    noteMain: !!document.querySelector('#sourceDefinitionNote')?.closest('.panel-main'),
    erosionExpert: !!document.querySelector('#erosion')?.closest('#terrainSuperAdvanced'),
    erosionClosed: document.querySelector('#terrainSuperAdvanced')?.open === false,
  }));
  assert.deepEqual(layout, { widthMain: true, spacingMain: true, summaryMain: true, noteMain: true, erosionExpert: true, erosionClosed: true });
  await bench.locator('#terrainSource').evaluate(select => { select.closest('details').open = true; });
  await bench.locator('#generationCompute').evaluate(select => { select.closest('details').open = true; });
  const initial = await bench.evaluate(() => ({ summary: document.querySelector('#sourceDefinitionSummary').textContent,
    min: document.querySelector('#sampleSpacing').min, max: document.querySelector('#width').max,
    compute: document.querySelector('#generationCompute').value, requests: window.__physicalQaRequests.filter(request => request.kind === 'overview').length }));
  assert.match(initial.summary, /334².*29\.94 m/);
  assert.equal(initial.min, '1');
  assert.equal(initial.max, '100000');
  assert.equal(initial.compute, 'auto');

  await bench.locator('#width').fill('200000');
  await bench.locator('#terrainMethod').selectOption('neural');
  await bench.locator('#terrainSource').selectOption('neural-wasm');
  await bench.waitForFunction(() => document.querySelector('#sourceDefinitionSummary')?.textContent.includes('6667²'));
  const neural = await bench.evaluate(() => ({ summary: document.querySelector('#sourceDefinitionSummary').textContent,
    min: document.querySelector('#sampleSpacing').min, max: document.querySelector('#width').max }));
  assert.match(neural.summary, /6667².*30\.00 m/);
  assert.equal(neural.min, '30');
  assert.equal(neural.max, '200000');

  await bench.locator('#terrainMethod').selectOption('procedural');
  await bench.locator('#width').fill('10000');
  await bench.locator('#generationCompute').selectOption('gpu-erosion');
  assert.match(await bench.locator('#sourceDefinitionSummary').textContent(), /GPU procédural explicite limité à 1024²/);
  await bench.locator('#generationCompute').selectOption('auto');
  await bench.locator('#sampleSpacing').fill('25');
  await bench.waitForFunction(() => document.querySelector('#sourceDefinitionSummary')?.textContent.includes('400²'));
  await bench.locator('#generate').click();
  await bench.waitForFunction(count => window.__physicalQaRequests.filter(request => request.kind === 'overview').length > count, initial.requests);
  const submitted = await bench.evaluate(() => {
    const request = window.__physicalQaRequests.filter(item => item.kind === 'overview').at(-1);
    return { width: request.settings.width, sampleSpacing: request.settings.sampleSpacing,
      generationCompute: request.settings.generationCompute, count: window.__physicalQaRequests.filter(item => item.kind === 'overview').length };
  });
  assert.deepEqual(submitted, { width: 10000, sampleSpacing: 25, generationCompute: undefined, count: initial.requests + 1 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, markup, initial, neural, submitted }));
} finally {
  await browser.close();
}
