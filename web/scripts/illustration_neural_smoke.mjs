/** Real Neural Earth capture and shared UI; no generation request or paid API call. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.NEURAL_EARTH_URL || 'http://127.0.0.1:8765';
const output = new URL('../../web/out/work/illustration/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().grantPermissions(['local-network-access'], { origin: base });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/?gpu=0&profile=natural&mode=relief&seed=42');
  await page.waitForFunction(() => typeof window.captureNeuralIllustration === 'function');
  await page.waitForFunction(() => !document.querySelector('#status')?.textContent.includes('Connecting'), null, { timeout: 60000 });
  await page.waitForFunction(() => typeof overview !== 'undefined' && (overview || visiblePlan.some(entry => entry.tile.image)), null, { timeout: 120000 });
  const preview = page.waitForRequest(request => request.url().endsWith('/v1/illustrations/prompt') && request.method() === 'POST');
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status')?.textContent === 'Capture prête.', null, { timeout: 60000 });
  const context = (await preview).postDataJSON().context;
  assert.equal(context.application, 'neural-earth');
  assert.equal(context.projection, 'orthographic');
  assert.ok(context.extentMetres.width > 0);
  assert.ok(await page.locator('.illustration-dialog').evaluate(dialog => dialog.clientWidth > 900), 'The shared dialog must not inherit Neural Earth’s narrow confirmation-dialog width.');
  const image = await page.locator('[data-source]').evaluate(async image => [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())]);
  await writeFile(new URL('neural-earth.png', output), Buffer.from(image));
  await page.screenshot({ path: new URL('neural-dialog.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  const overlays = await page.evaluate(async () => {
    const { captureViewport } = await import('/illustration/index.mjs');
    const waterDraw = hydrology.draw, toolsDraw = mapTools.draw;
    try {
      hydrology.draw = context => { context.fillStyle = '#fc1020'; context.fillRect(20, 20, 40, 40); };
      mapTools.draw = context => { context.fillStyle = '#20fc10'; context.fillRect(20, 20, 40, 40); };
      const captured = await window.captureNeuralIllustration(captureViewport), bitmap = await createImageBitmap(captured.image);
      const probe = document.createElement('canvas'); probe.width = bitmap.width; probe.height = bitmap.height;
      const context = probe.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      return { pixel: [...context.getImageData(Math.round(30 / W * probe.width), Math.round(30 / H * probe.height), 1, 1).data], active: window.neuralIllustrationCaptureActive };
    } finally { hydrology.draw = waterDraw; mapTools.draw = toolsDraw; draw(); }
  });
  assert.deepEqual(overlays.pixel, [252, 16, 32, 255], 'Keep the water layer while suppressing measurement tools.');
  assert.equal(overlays.active, false);
  await page.locator('[data-close]').click();
  await page.locator('#globeView').click();
  assert.equal(await page.locator('#globeView').getAttribute('aria-pressed'), 'true');
  const globePreview = page.waitForRequest(request => request.url().endsWith('/v1/illustrations/prompt') && request.method() === 'POST');
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status')?.textContent === 'Capture prête.');
  const globe = (await globePreview).postDataJSON().context;
  assert.equal(globe.projection, 'globe');
  await page.screenshot({ path: new URL('neural-globe-dialog.png', output).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Neural Earth illustration capture passed: map, globe, physical water, clean editor overlays.');
} finally { await browser.close(); }
