/** Isolated terrain-controls QA: no V2 app, terrain generation, or model inference. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5185/v2.html';
const url = new URL('/__physical-terrain-qa.html', base).href;
const errors = [];
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.context().grantPermissions(['local-network-access'], { origin: new URL(base).origin });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__physical-terrain-qa.html', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main id="terrain-qa"></main></body></html>' }));
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const modules = ['../src/v2/terrainControls.ts', '../src/v2/settings.ts'].map(path => '/@fs/' + fileURLToPath(new URL(path, import.meta.url)).replaceAll('\\', '/'));
  const result = await page.evaluate(async ([controlsModule, settingsModule]) => {
    const [{ mountTerrainControls }, { defaultSettings }] = await Promise.all([
      import(controlsModule), import(settingsModule),
    ]);
    const root = document.querySelector('#terrain-qa');
    const settings = defaultSettings();
    const defaults = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Terrain control defaults did not load')), 30000);
      root.addEventListener('terrain-defaults-ready', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    const controls = mountTerrainControls(root, { getSettings: () => settings, onChange: () => {} });
    await defaults;
    const capture = () => {
      const width = root.querySelector('#terrain-width');
      const spacing = root.querySelector('[data-setting-path="terrain.sampleSpacing"]');
      return { width: settings.extent, source: settings.runtime?.source,
        widthInput: { value: width.value, min: width.min, max: width.max, invalid: width.getAttribute('aria-invalid') },
        spacingInput: { value: spacing.value, min: spacing.min, max: spacing.max, disabled: spacing.disabled },
        definition: root.querySelector('#terrain-definition-help').textContent.trim() };
    };
    controls.access.set('extent', 200000);
    controls.access.set('terrain.sampleSpacing', 30);
    const neural = capture();
    const oldNeuralControlsAbsent = !root.querySelector('[data-setting-path="terrain.neuralFit"], [data-field-path="terrain.neuralFit"], [data-setting-path="terrain.neuralSlopes"], [data-field-path="terrain.neuralSlopes"]');

    controls.access.set('runtime.source', 'procedural');
    controls.access.set('extent', 10000);
    const procedural = capture();
    for (const group of root.querySelectorAll('details.terrain-control-group')) group.open = true;
    const incision = root.querySelector('[data-field-path="terrain.erosionTuning.incision"]');
    const advanced = incision?.closest('details.terrain-super-advanced');
    const expertBefore = { present: !!incision, insideAdvanced: !!advanced, advancedOpen: advanced?.open,
      visible: !!incision?.checkVisibility(),
      outsideAdvanced: [...root.querySelectorAll('[data-field-path="terrain.erosionTuning.incision"]')]
        .some(node => !node.closest('.terrain-super-advanced')) };
    if (advanced) advanced.open = true;
    const expertAfter = { advancedOpen: advanced?.open, visible: !!incision?.checkVisibility() };

    controls.access.set('runtime.source', 'neural-python');
    controls.access.set('terrain.baseModel', 'residual8k');
    controls.access.set('extent', 40000);
    const residual8k = capture();
    residual8k.model = controls.access.get('terrain.baseModel');
    controls.dispose();
    return { neural, oldNeuralControlsAbsent, procedural, expertBefore, expertAfter, residual8k };
  }, modules);

  assert.equal(result.neural.source, 'neural-wasm');
  assert.equal(result.neural.width, 200000);
  assert.equal(Number(result.neural.widthInput.max), 200);
  assert.equal(Number(result.neural.spacingInput.min), 30);
  assert.match(result.neural.definition, /6667 × 6667 · 30\.00 m/);
  assert.equal(result.neural.widthInput.invalid, null);
  assert.equal(result.oldNeuralControlsAbsent, true);

  assert.equal(result.procedural.source, 'procedural');
  assert.equal(result.procedural.width, 10000);
  assert.equal(Number(result.procedural.spacingInput.min), 1);
  assert.match(result.procedural.definition, /334 × 334 · 29\.94 m/);
  assert.deepEqual(result.expertBefore, { present: true, insideAdvanced: true, advancedOpen: false,
    visible: false, outsideAdvanced: false });
  assert.deepEqual(result.expertAfter, { advancedOpen: true, visible: true });

  assert.equal(result.residual8k.source, 'neural-python');
  assert.equal(result.residual8k.model, 'residual8k');
  assert.equal(result.residual8k.width, 40000);
  assert.equal(Number(result.residual8k.widthInput.min), 40);
  assert.equal(Number(result.residual8k.widthInput.max), 40);
  assert.equal(result.residual8k.spacingInput.disabled, true);
  assert.match(result.residual8k.definition, /1024 × 1024 · 39\.06 m/);
  assert.equal(result.residual8k.widthInput.invalid, null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, neural: result.neural.definition, procedural: result.procedural.definition,
    residual8k: result.residual8k.definition }));
} finally {
  await browser.close();
}
