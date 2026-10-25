/** Shared panel: credentials, mobile layout and frozen screenshot layers. No provider calls. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.NEURAL_EARTH_URL || process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:8765';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(base + '/illustration/index.mjs', async route => route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../../illustration/web/index.mjs', import.meta.url)) }));
  await page.route(base + '/panel-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
    <header></header><div id="view" style="width:256px;height:128px;position:relative"><canvas width="256" height="128"></canvas>
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="128" style="position:absolute;inset:0">
    <foreignObject width="64" height="64" style="display:none"><canvas xmlns="http://www.w3.org/1999/xhtml" width="64" height="64"></canvas></foreignObject>
    <foreignObject x="64" width="64" height="64"><canvas xmlns="http://www.w3.org/1999/xhtml" width="64" height="64"></canvas></foreignObject></svg></div></body></html>` }));
  await page.goto(base + '/panel-fixture');
  const pixels = await page.evaluate(async () => {
    const { mountIllustration, captureViewport } = await import('/illustration/index.mjs');
    const canvas = document.querySelector('#view>canvas'), context = canvas.getContext('2d');
    context.fillStyle = 'red'; context.fillRect(0, 0, 256, 128);
    const paint = document.querySelectorAll('foreignObject canvas')[1].getContext('2d');
    paint.fillStyle = 'blue'; paint.fillRect(0, 0, 64, 64);
    const pending = captureViewport(document.getElementById('view'));
    context.fillStyle = 'green'; context.fillRect(0, 0, 256, 128);
    const frozen = await createImageBitmap(await pending), probe = document.createElement('canvas');
    probe.width = frozen.width; probe.height = frozen.height;
    const out = probe.getContext('2d'); out.drawImage(frozen, 0, 0); frozen.close();
    const at = (x, y) => [...out.getImageData(x, y, 1, 1).data];
    const result = { background: at(8, 8), paint: at(80, 20) };
    mountIllustration({ host: document.querySelector('header'), capture: async () => ({ image: await captureViewport(document.getElementById('view')), context: { application: 'test', sourceStyle: 'parchment' } }) });
    return result;
  });
  assert.deepEqual(pixels.background, [255, 0, 0, 255]); assert.deepEqual(pixels.paint, [0, 0, 255, 255]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM0LJrHwMDAxAAGAA7JAUW48M0QAAAAAElFTkSuQmCC', 'base64');
  let connectionState = 'offline', submissions = 0;
  await page.route('http://127.0.0.1:8794/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/status') {
      if (connectionState === 'offline') return route.abort('connectionrefused');
      return route.fulfill({ json: { service: connectionState === 'incompatible' ? 'other-service' : 'magna-illustration', protocol: 1, localDependencies: connectionState !== 'missing' } });
    }
    if (path.endsWith('/jobs') && request.method() === 'POST') { submissions++; return route.fulfill({ status: 500, json: { error: 'Unexpected generation' } }); }
    if (path.endsWith('/prompt')) return route.fulfill({ json: { description: 'Test scene', prompt: 'Test prompt' } });
    if (route.request().url().endsWith('/jobs')) return route.fulfill({ json: { jobs: [{ id: 'a'.repeat(24), status: 'succeeded', createdAt: 1, resolvedStyle: 'parchment',
      settings: { mode: 'cloud', provider: 'openai' }, context: { application: 'test' }, prompt: 'saved prompt', totalSeconds: 1, outputSize: [2, 2] }] } });
    if (route.request().url().endsWith('/edges.png') || route.request().url().endsWith('/depth.png')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status')?.textContent === 'Capture prête.');
  assert.equal(await page.locator('[name=mode]').inputValue(), 'quality');
  assert.equal(await page.locator('[name=steps]').inputValue(), '8');
  assert.equal(await page.locator('[name=pixels]').inputValue(), '1048576');
  await page.locator('[data-generate]').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status').textContent.includes('npm run illustration:serve'));
  connectionState = 'incompatible';
  await page.locator('[data-generate]').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status').textContent.includes('Service incompatible'));
  connectionState = 'missing';
  await page.locator('[data-generate]').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status').textContent.includes('Dépendances de diffusion absentes'));
  assert.equal(submissions, 0, 'Do not submit a capture to an unavailable or incompatible runtime.');
  connectionState = 'online';
  await page.locator('[data-generate]').waitFor({ state: 'visible' });
  await page.locator('details').filter({ has: page.locator('[data-connect]') }).locator('summary').click();
  await page.locator('[data-connect]').click();
  await page.waitForFunction(() => document.querySelector('[data-connection]').textContent.includes('Connecté'));
  await page.locator('[name=mode]').selectOption('cloud');
  await page.locator('[name=apiKey]').fill('openai-test-secret');
  await page.locator('[name=provider]').selectOption('gemini');
  assert.equal(await page.locator('[name=apiKey]').inputValue(), '');
  await page.locator('[name=apiKey]').fill('gemini-test-secret');
  await page.locator('[name=provider]').selectOption('openai');
  assert.equal(await page.locator('[name=apiKey]').inputValue(), 'openai-test-secret');
  await page.locator('[name=provider]').selectOption('gemini');
  assert.equal(await page.locator('[name=apiKey]').inputValue(), 'gemini-test-secret');
  await page.locator('[data-history] summary').click();
  await page.locator('.illustration-history button').click();
  await page.waitForFunction(() => document.querySelector('[name=provider]').value === 'openai');
  assert.equal(await page.locator('[name=apiKey]').inputValue(), 'openai-test-secret', 'Restoring history must switch credentials along with the provider.');
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('test-secret')), false);
  const layout = await page.locator('.illustration-dialog').evaluate(dialog => ({ width: dialog.getBoundingClientRect().width, overflow: dialog.scrollWidth > dialog.clientWidth }));
  assert.ok(layout.width <= 390); assert.equal(layout.overflow, false);
  console.log('Shared illustration panel passed: connection failures, incompatible service, missing dependencies, reconnect, quality defaults, frozen capture, isolated credentials, mobile layout.');
} finally { await browser.close(); }
