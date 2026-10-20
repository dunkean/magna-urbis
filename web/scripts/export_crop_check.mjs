// Usage: node scripts/export_crop_check.mjs [http://localhost:5173]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = 'out/export-crop';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const field = key => page.locator(`.export-crop [data-field="${key}"]`);
async function setCrop(x, y, width, height) {
  // Shrink before positioning so the new origin lies within the map.
  for (const [key, value] of Object.entries({ width, height, x, y })) {
    await field(key).fill(String(value)); await field(key).press('Tab');
  }
}
async function downloadCrop(button, format, width, height) {
  await page.locator(button).click();
  await page.locator('.export-crop').waitFor({ state: 'visible' });
  await setCrop(100, 200, 800, 400);
  const download = page.waitForEvent('download');
  await page.locator('.export-crop [data-action="export"]').click();
  const result = await download;
  const file = `${out}/${result.suggestedFilename()}`;
  await result.saveAs(file);
  const bytes = await readFile(file);
  if (format === 'png') {
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  } else {
    assert.match(bytes.toString(), /viewBox="100 200 800 400"/);
    assert.match(bytes.toString(), new RegExp(`width="${width}" height="${height}"`));
  }
  console.log(`ok ${button}: ${width} × ${height}, selected bounds retained`);
}
try {
  await page.goto(`${base}/?seed=7&size=village&legend=1&style=illuminated`);
  await page.waitForFunction(() => /Generated in/.test(document.getElementById('gentime')?.textContent ?? ''));
  await page.locator('#quickShare > summary').click();
  await downloadCrop('#exportSvg', 'svg', 3000, 1500);
  await downloadCrop('#exportPng', 'png', 3000, 1500);
  const jsonDownload = page.waitForEvent('download'); await page.locator('#exportJson').click();
  assert((await jsonDownload).suggestedFilename().endsWith('.json'));

  // Known vector pixels prove cropping rather than merely rectangular stretching.
  await page.evaluate(async () => {
    const { chooseExportCrop } = await import('/exportCrop.ts');
    const { exportPng } = await import('/pngExport.ts');
    window.startCropFixture = () => {
      const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1600" width="1600" height="1600"><rect x="100" y="200" width="400" height="400" fill="red"/><rect x="500" y="200" width="400" height="400" fill="blue"/></svg>';
      window.cropResult = undefined;
      window.cropTask = chooseExportCrop(new Blob([source], { type: 'image/svg+xml' }), 320).then(async crop => {
        if (!crop) { window.cropResult = null; return; }
        const png = await exportPng(crop.blob, crop, () => {});
        const image = await createImageBitmap(png), canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        window.cropResult = { width: image.width, height: image.height,
          left: [...ctx.getImageData(80, 80, 1, 1).data], right: [...ctx.getImageData(240, 80, 1, 1).data] };
        image.close();
      });
    };
    window.startCropFixture();
  });
  const box = await page.locator('.export-crop-preview').boundingBox();
  // Reverse drag: bottom-right to top-left.
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .25, box.y + box.height * .25, { steps: 6 }); await page.mouse.up();
  assert.equal(Number(await field('width').inputValue()), 800);
  assert.equal(Number(await field('height').inputValue()), 400);
  // Drag the selected rectangle, retaining its dimensions.
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .375);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .55, box.y + box.height * .425, { steps: 4 }); await page.mouse.up();
  assert.equal(Number(await field('width').inputValue()), 800);
  assert.equal(Number(await field('x').inputValue()), 480);
  await page.locator('.export-crop [data-action="reset"]').click();
  assert.equal(Number(await field('width').inputValue()), 1600);
  await field('width').fill('9000'); await field('width').press('Tab');
  assert.equal(Number(await field('width').inputValue()), 1600);
  await setCrop(100, 200, 800, 400);
  await page.locator('.export-crop').screenshot({ path: `${out}/dialog.png` });
  await page.locator('.export-crop [data-action="export"]').click();
  await page.evaluate(() => window.cropTask);
  assert.deepEqual(await page.evaluate(() => window.cropResult), { width: 320, height: 160, left: [255, 0, 0, 255], right: [0, 0, 255, 255] });
  for (const cancel of ['button', 'escape']) {
    await page.evaluate(() => window.startCropFixture());
    await page.locator('.export-crop').waitFor({ state: 'visible' });
    if (cancel === 'button') await page.locator('.export-crop [data-action="cancel"]').click(); else await page.keyboard.press('Escape');
    await page.evaluate(() => window.cropTask);
    assert.equal(await page.evaluate(() => window.cropResult), null);
  }
  // Compact screens retain all controls within the viewport.
  await page.setViewportSize({ width: 390, height: 740 });
  await page.evaluate(() => window.startCropFixture());
  await page.locator('.export-crop').waitFor({ state: 'visible' });
  assert(await page.locator('.export-crop').evaluate(d => d.getBoundingClientRect().width <= innerWidth));
  await page.locator('.export-crop').screenshot({ path: `${out}/dialog-mobile.png` });
  await page.keyboard.press('Escape');
  console.log('ok drag, move, numeric bounds, reset, cancel, Escape, mobile layout, exact SVG → PNG crop pixels');

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(`${base}/terrainbench.html?seed=42&width=4000&motif=2000&relief=plain&hydro_enabled=0&auto=0&generation=cpu&compute=wasm&style=fantasy-color&render=svg`);
  await page.waitForFunction(() => document.querySelector('.fantasy-brushes'));
  await page.locator('#lightingControls > summary').click();
  await downloadCrop('#fantasyExport_svg', 'svg', 4096, 2048);
  await downloadCrop('#fantasyExport_png', 'png', 4096, 2048);
  await page.goto(`${base}/urbanbench.html?decor=d001-hills-inland-hamlet&style=fantasy-color`);
  await page.waitForFunction(() => document.querySelector('#fantasyPainting .fantasy-brushes'));
  await page.locator('#fantasyStyleControls > summary').click();
  await downloadCrop('#fantasyExport_svg', 'svg', 4096, 2048);
  await downloadCrop('#fantasyExport_png', 'png', 4096, 2048);
  assert.deepEqual(errors, []);
  console.log('all export crop browser checks passed; no page errors');
} finally { await browser.close(); }
