/** Real connector preview: prose, model-specific prompt and style changes; no generation. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.context().grantPermissions(['local-network-access'], { origin: base });
  const generationRequests = []; page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/v1/illustrations/jobs')) generationRequests.push(request.url());
  });
  await page.route(base + '/prompt-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body><header></header></body></html>' }));
  await page.goto(base + '/prompt-fixture');
  await page.evaluate(async module => {
    const { mountIllustration, canvasBlob } = await import(module), canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    mountIllustration({ host: document.querySelector('header'), capture: async () => ({ image: await canvasBlob(canvas), context: {
      projection: 'orthographic', sourceStyle: 'parchment', environment: { relief: 'flat', climate: 'mediterranean' },
      settlements: [{ urbanCulture: 'roman-core', name: 'Roma', population: 30000 }],
      architecture: { roofSystems: ['tiled_hip'], materials: [{ label: 'fired clay tiles' }], storeys: [1, 2] } } }) });
  }, '/@fs/' + resolve('../illustration/web/index.mjs').replaceAll('\\', '/'));
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('[data-scene-description]').textContent.includes('a Roman city in a Mediterranean plain'));
  const description = await page.locator('[data-scene-description]').textContent();
  assert.ok(description.includes('fired clay tiles')); assert.ok(!description.includes('"urbanCulture"'));
  const short = await page.locator('.illustration-prompt').textContent();
  await page.locator('[name=mode]').selectOption('cloud');
  await page.waitForFunction(() => document.querySelector('.illustration-prompt').textContent.startsWith('Edit the supplied source image itself'));
  const prompt = await page.locator('.illustration-prompt').textContent();
  assert.ok(prompt.includes('relative positions')); assert.ok(prompt.includes('street intersections')); assert.ok(prompt.length > short.length);
  await page.locator('[name=style]').selectOption('photorealistic');
  await page.waitForFunction(() => document.querySelector('.illustration-prompt').textContent.includes('photorealistic landscape'));
  const original = await page.locator('[data-source]').getAttribute('src');
  await page.locator('details').filter({ has: page.locator('[data-prompt-edit]') }).locator('summary').click();
  await page.locator('[data-prompt-edit]').click();
  const edited = 'Restyle this exact Roman city as a satellite image. Preserve every street and courtyard. Custom user wording.';
  await page.locator('[data-prompt-editor]').fill(edited);
  await page.locator('[data-prompt-preview]').click();
  await page.waitForFunction(text => document.querySelector('.illustration-prompt').textContent === text, edited);
  assert.equal(await page.locator('[data-prompt-editor]').inputValue(), edited);
  assert.ok((await page.locator('[data-prompt-state]').textContent()).includes('personnalisé'));
  await page.locator('[name=style]').selectOption('satellite');
  await page.waitForFunction(() => document.querySelector('.illustration-prompt').textContent.includes('realistic overhead satellite imagery'));
  assert.equal(await page.locator('[data-source]').getAttribute('src'), original, 'Style changes must keep the captured reference image.');
  await page.locator('[name=style]').selectOption('photorealistic');
  await page.waitForFunction(text => document.querySelector('[data-prompt-editor]').value === text, edited);
  await page.locator('[data-prompt-reset]').click();
  await page.waitForFunction(() => document.querySelector('.illustration-prompt').textContent.includes('photorealistic landscape'));
  assert.ok(!(await page.locator('[data-prompt-state]').textContent()).includes('personnalisé'));
  assert.deepEqual(generationRequests, []);
  console.log('Prompt preview passed: prose, cloud edit, satellite template, editable prompt, draft restore, template reset, unchanged reference; no generation.');
} finally { await browser.close(); }
