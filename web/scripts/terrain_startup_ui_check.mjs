// From web/: node scripts/terrain_startup_ui_check.mjs [origin]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
await mkdir('out/startup', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let release;
const gate = new Promise(resolve => { release = resolve; });
let service = { state: 'ready', loaded: false, message: 'Service prêt' };
try {
  // Hold the expensive module: the visible defaults and feedback must work first.
  await page.route('**/terrainbench.ts*', async route => { await gate; await route.continue(); });
  await page.route('http://127.0.0.1:8793/status', route => route.fulfill({ json: service, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto(`${base}/terrainbench.html?standalone=1&profile=local&stage=settlements&auto=0`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('#terrainMethod')?.value === 'neural');
  assert.equal(await page.locator('#terrainSource').inputValue(), 'neural-python');
  assert.equal(await page.locator('#terrainLoading').isVisible(), true);
  assert.equal(await page.locator('#terrainLoadingTitle').innerText(), 'Chargement de l’atelier');
  await page.waitForFunction(() => document.querySelector('#terrainModelStatus')?.textContent.includes('premier calcul'));
  service = { state: 'loading', loaded: false, message: 'Chargement des modèles CUDA' };
  await page.waitForFunction(() => document.querySelector('#terrainModelStatus')?.textContent.includes('Chargement des modèles'));
  service = { state: 'ready', loaded: true, message: 'Prêt' };
  await page.waitForFunction(() => document.querySelector('#terrainModelStatus')?.textContent.includes('Modèles chargés'));
  assert.equal(await page.locator('#terrainLoading').isVisible(), true);
  await page.locator('#viewport').screenshot({ path: 'out/startup/interface-loading.png' });
  assert.equal(await page.locator('#map image').count(), 0);
  release();
  await page.waitForFunction(() => window.magnaBenchContext && document.body.dataset.terrainStartup === 'ready', null, { timeout: 120000 });
  assert.equal(await page.locator('#terrainMethod').inputValue(), 'neural');
  await page.unroute('**/terrainbench.ts*');
  await page.unroute('http://127.0.0.1:8793/status');
  // A fresh desktop route must replace both a saved procedural map and its draft.
  await page.addInitScript(() => {
    if (window.parent === window) {
      sessionStorage.setItem('magna-bench-context-v1-local', JSON.stringify({ terrain: 'source=procedural&seed=stale-procedural' }));
      sessionStorage.setItem('magna-bench-context-v1-local-ui', JSON.stringify({ terrain: { fields: [
        { selector: '#terrainSource', value: 'procedural' }, { selector: '#terrainMethod', value: 'procedural' },
      ], panels: [], scroll: [] } }));
    }
    window.__startupBackends = [];
    window.__startupPhases = [];
    window.addEventListener('terrain:loading', event => window.__startupPhases.push(event.detail.phase));
    const Base = Worker;
    window.Worker = class extends Base {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.kind === 'overview' && event.data.terrain) window.__startupBackends.push(event.data.terrain.generationBackend);
        });
      }
    };
  });
  await page.goto(`${base}/rustbench.html?profile=local#terrain?source=neural-python&width=2400&compute=wasm&hydro_enabled=0&auto=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=terrain]')?.contentDocument?.querySelector('#terrainMethod')?.value === 'neural', null, { timeout: 120000 });
  const frame = page.frames().find(frame => frame.parentFrame() && frame.url().includes('terrainbench.html'));
  await frame.waitForFunction(() => window.__startupBackends.length && document.querySelector('#terrainLoading').hidden, null, { timeout: 180000 });
  assert.equal(await frame.locator('#terrainSource').inputValue(), 'neural-python');
  assert.equal(await frame.locator('#terrainMethod').inputValue(), 'neural');
  const backends = await frame.evaluate(() => window.__startupBackends);
  assert(backends.length && backends.every(backend => backend === 'neural'), `first terrain must be neural: ${backends}`);
  const phases = await frame.evaluate(() => window.__startupPhases);
  assert(phases.includes('generation') && phases.includes('rendering') && phases.at(-1) === 'ready');
  await frame.waitForFunction(() => document.querySelector('#terrainModelStatus').textContent.includes('Modèles chargés'));
  await frame.locator('#viewport').screenshot({ path: 'out/startup/neural-first-view.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ earlyNeuralMenu: true, models: true, staleHistoryReplaced: true, backends, phases, errors }));
} catch (error) {
  console.error({ errors, path: new URL(page.url()).pathname });
  await page.screenshot({ path: 'out/startup/failure.png' });
  throw error;
} finally { release(); await browser.close(); }
