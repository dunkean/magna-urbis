/** Real CityGlCanvasLayer regression: non-preserved GPU + 2D roofs + Canvas fallback. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const base = process.env.MAGNA_ILLUSTRATION_BENCH || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route(base + '/city-capture-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0"><div id="viewport" style="width:256px;height:128px"><svg id="map" xmlns="http://www.w3.org/2000/svg" width="256" height="128" viewBox="0 0 256 128"><rect width="256" height="128" fill="#bbb"/><g id="city"></g></svg></div></body></html>' }));
  await page.goto(base + '/city-capture-fixture');
  const result = await page.evaluate(async ({ hostModule, captureModule }) => {
    const { CityGlCanvasLayer } = await import(hostModule), { captureViewport } = await import(captureModule);
    const { buildCityScene } = await import(hostModule.replace('cityGlHost.ts', 'cityCanvas.ts'));
    let gpu = true, draws = 0;
    const layer = new CityGlCanvasLayer(document.getElementById('map'), document.getElementById('city'), (ctx, frame) => {
      draws++;
      if (gpu) frame.drawGl?.({ viewport: frame.viewport, metresPerPixel: frame.mpp, view: 'buildings', clear: [1, 0, 0, 1] });
      ctx.fillStyle = gpu ? 'blue' : 'yellow'; ctx.fillRect(gpu ? 128 : 0, 0, gpu ? 128 : 256, 128);
      return false;
    });
    if (!layer.gl) throw Error('This regression requires a real WebGL2 context.');
    await layer.gl.setScene(buildCityScene([]));
    if (!layer.gl.ready) throw Error('The GPU scene did not initialize.');
    layer.draw();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const before = draws;
    const probe = async () => {
      const blob = await captureViewport(document.getElementById('viewport')), bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return [16, 200].map(x => [...ctx.getImageData(x, 32, 1, 1).data]);
    };
    const stacked = await probe(); gpu = false;
    const fallback = await probe(); const capturedDraws = draws - before; layer.dispose();
    return { stacked, fallback, capturedDraws };
  }, { hostModule: '/@fs/' + resolve('src/render/cityGlHost.ts').replaceAll('\\', '/'), captureModule: '/@fs/' + resolve('../illustration/web/index.mjs').replaceAll('\\', '/') });
  assert.deepEqual(result.stacked, [[255, 0, 0, 255], [0, 0, 255, 255]]);
  assert.deepEqual(result.fallback, [[255, 255, 0, 255], [255, 255, 0, 255]]);
  assert.equal(result.capturedDraws, 2);
  console.log('City layer capture passed: fresh GPU frame, 2D roofs, hidden-GPU Canvas fallback.', result);
} finally { await browser.close(); }
