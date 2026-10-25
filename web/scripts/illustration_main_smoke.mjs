/** Real TypeScript app capture, including exclusion of its minimap and toolbar. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().grantPermissions(['local-network-access'], { origin: base });
  await page.goto(base + '/index.html?size=hamlet&population=100&settlements=none&seed=illustration&render=main');
  await page.locator('.illustration-trigger').waitFor();
  await page.waitForFunction(() => !document.getElementById('busy')?.classList.contains('on'), null, { timeout: 120000 });
  await page.evaluate(() => {
    const canvas = document.getElementById('minimap'), context = canvas.getContext('2d');
    context.fillStyle = '#ff00ff'; context.fillRect(0, 0, canvas.width, canvas.height);
  });
  const preview = page.waitForRequest(request => request.url().endsWith('/v1/illustrations/prompt') && request.method() === 'POST');
  await page.locator('.illustration-trigger').click();
  await page.waitForFunction(() => document.querySelector('.illustration-status')?.textContent === 'Capture prête.', null, { timeout: 30000 });
  const context = (await preview).postDataJSON().context;
  assert.equal(context.application, 'magna-urbis'); assert.equal(context.generation.population, 100);
  const magenta = await page.locator('[data-source]').evaluate(async image => {
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 255) count++;
    return count;
  });
  assert.equal(magenta, 0, 'The minimap must not be included in the illustration source.');
  console.log('TypeScript application illustration capture passed: factual context, minimap and HUD excluded.');
} finally { await browser.close(); }
