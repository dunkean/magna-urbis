// UI-only check: SVG + empty settlements stage avoids terrain/GPU/model work.
// From web/: node scripts/render_v2_controls_ui_check.mjs [origin]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
const out = 'out/render-v2';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [], generationRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/127\.0\.0\.1:879[123]\/.*generat/.test(request.url())) generationRequests.push(request.url());
  });
  await page.goto(base + '/terrainbench.html?standalone=1&profile=local&stage=settlements&source=procedural&auto=0&render=svg&style=render-v2-snow&v2season=0.25');
  await page.waitForFunction(() => window.magnaBenchContext && document.body.dataset.terrainStartup === 'ready');
  await page.locator('#bench-render-settings').evaluate(element => { element.open = true; element.querySelector('[data-render-section="cover"]').open = true; });
  assert.deepEqual(await page.locator('#style option').evaluateAll(options => options.filter(option => option.value.startsWith('render-v2')).map(option => [option.value, option.textContent])), [['render-v2', 'Render v2']]);
  assert.equal(await page.locator('#style').inputValue(), 'render-v2');
  assert.equal(await page.locator('#renderV2Diagnostic').inputValue(), 'render-v2-snow');
  assert.equal(await page.locator('#renderV2Controls').isVisible(), true);
  const snapshot = () => page.evaluate(() => ({
    context: window.magnaBenchContext.capture(),
    controls: Object.fromEntries(['terrainSource', 'compute', 'generationCompute', 'climate', 'width', 'seed'].map(id => [id, document.getElementById(id).value])),
  }));
  const before = await snapshot();
  const modes = ['render-v2', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'];
  for (const mode of modes) {
    await page.selectOption('#renderV2Diagnostic', mode);
    await page.waitForFunction(mode => new URL(location.href).searchParams.get('style') === mode, mode);
    assert.equal(await page.locator('#style').inputValue(), 'render-v2');
    assert.equal(await page.locator('#renderV2Season').inputValue(), '0.25');
  }
  await page.locator('#renderV2Season').fill('0.75');
  await page.locator('#renderV2Season').dispatchEvent('input');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('v2season') === '0.75');
  assert.equal(await page.locator('#renderV2Diagnostic').inputValue(), 'render-v2-snow');
  await page.selectOption('#style', 'parchment');
  assert.equal(await page.locator('#renderV2Controls').isVisible(), false);
  await page.selectOption('#style', 'render-v2');
  assert.equal(await page.locator('#renderV2Diagnostic').inputValue(), 'render-v2-snow');
  assert.equal(await page.locator('#renderV2Controls').isVisible(), true);
  assert.equal(await page.locator('#renderV2Season').inputValue(), '0.75');
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(generationRequests, []);
  assert.deepEqual(errors, []);
  await page.locator('nav[aria-label="Display"]').screenshot({ path: out + '/render-v2-controls.png' });
  const report = { mainOptions: 1, diagnosticViews: modes.length, legacyUrlRestored: true, seasonPreserved: true, cameraAndInputsPreserved: true, generationRequests, errors };
  writeFileSync(out + '/controls-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
