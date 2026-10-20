// From web/: node scripts/styles_ui_check.mjs [base URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const modules = '/@fs/' + resolve(import.meta.dirname, '..').replaceAll('\\', '/');
const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/display-contract.html', route => route.fulfill({ contentType: 'text/html', body: '<canvas id="test"></canvas>' }));
  await page.goto(base + '/display-contract.html');
  console.log('Checking shared water shader');
  const audit = await page.evaluate(async modules => {
    const { TerrainGl } = await import('/terrainGl.ts');
    const { TERRAIN_STYLE_LIST, terrainStyle } = await import(modules + '/src/render/terrainStyle.ts');
    const { DEFAULT_TERRAIN_LAYERS, DEFAULT_TERRAIN_LIGHTING } = await import(modules + '/src/render/terrainLighting.ts');
    const { DEFAULT_FRACTAL_DETAIL } = await import('/@fs/' + modules.slice(5).replace(/\/web$/, '') + '/rust/bridge/terrainAdjust.ts');
    const n = 256, width = 2560, height = Float32Array.from({ length: n * n }, (_, i) => i % n < 64 ? -100 : 100);
    const lake = Float32Array.from({ length: n * n }, (_, i) => i % n >= 192 ? 1 : -1);
    const canvas = document.getElementById('test'), renderer = new TerrainGl(canvas);
    renderer.setBase({ x: 0, y: 0, width, n, data: height });
    const look = { style: 'atlas', mapWidth: width, lighting: { ...DEFAULT_TERRAIN_LIGHTING, enabled: false }, layers: { ...DEFAULT_TERRAIN_LAYERS }, globalMin: -100, globalMax: 100,
      contours: false, contourStep: 5, flatRelief: false, refine: false, sourceCell: 10, seed: 42, detail: DEFAULT_FRACTAL_DETAIL, floor: 0, frame: false, background: '#ffffff' };
    renderer.setLook(look); renderer.setWater({ lake, shore: 'exact', n });
    renderer.setView({ cx: width / 2, cy: width / 2, scale: .1 }, 256, 256);
    const sample = (x, y = width / 2) => {
      renderer.draw();
      const pixel = new Uint8Array(4), gl = renderer.gl;
      gl.readPixels(Math.floor(x * .1), canvas.height - 1 - Math.floor(y * .1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel.slice(0, 3)];
    };
    const styles = [];
    for (const style of TERRAIN_STYLE_LIST) {
      look.style = style.id; renderer.setLook(look);
      const sea = sample(600), lakeColor = sample(1950), delta = Math.max(...sea.map((c, i) => Math.abs(c - lakeColor[i])));
      styles.push({ id: style.id, sea, lake: lakeColor, delta });
    }
    look.style = 'atlas'; renderer.setLook(look);
    const water = sample(200);
    look.layers.water = false; renderer.setLook(look); const hiddenSea = sample(200);
    look.layers.water = true; look.layers.relief = false; renderer.setLook(look); const noReliefSea = sample(200);
    const rgba = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) rgba.set([255, 0, 255, 255], i * 4);
    renderer.setOverlay({ rgba, n }); const diagnosticLake = sample(2100);
    const glError = renderer.gl.getError(); renderer.dispose();
    return { styles, water, hiddenSea, noReliefSea, diagnosticLake, glError };
  }, modules);
  for (const style of audit.styles) assert.ok(style.delta <= 4, `${style.id}: different sea/lake material ${JSON.stringify(style)}`);
  assert.notDeepEqual(audit.hiddenSea, audit.water, 'Water visibility must also hide sea');
  assert.deepEqual(audit.noReliefSea, audit.water, 'Water must be independent of terrain visibility');
  assert.deepEqual(audit.diagnosticLake, [255, 0, 255], 'Diagnostics must cover water');
  assert.equal(audit.glError, 0, 'No WebGL errors');

  console.log('Shader checks passed');
  for (const render of ['gl', 'svg']) {
    console.log('Checking view and replay:', render);
    const params = new URLSearchParams({ seed: '42', relief: 'hills', erosion: '0', width: '8000', motif: '3000', coasts: 'S', hydro_enabled: '0', generation: 'cpu', compute: 'cpu', style: 'atlas', render });
    await page.goto(`${base}/terrainbench.html?${params}`);
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('rendering'), null, { timeout: 90000 });
    assert.equal(await page.locator('#style option[value=copernicus]').count(), 0);
    await page.locator('#hydroOverlay').selectOption('elevation');
    assert.equal(await page.locator('#style').inputValue(), 'atlas');
    assert.equal(new URL(page.url()).searchParams.get('diagnostic'), 'elevation');
    await page.locator('#style').selectOption('night');
    await page.locator('#hydroOverlay').selectOption('none');
    assert.equal(await page.locator('#style').inputValue(), 'night');
    assert.equal(new URL(page.url()).searchParams.get('style'), 'night');
    await page.locator('#lightingControls > summary').click();
    await page.locator('#showWater').uncheck();
    assert.equal(new URL(page.url()).searchParams.get('water'), '0');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('rendering'), null, { timeout: 90000 });
    assert.equal(await page.locator('#style').inputValue(), 'night');
    assert.equal(await page.locator('#showWater').isChecked(), false);
  }
  console.log('Checking workshop style and diagnostic separation');
  await page.goto(base + '/testbench.html?style=atlas');
  await page.locator('#map [data-quarter]').first().waitFor({ timeout: 60000 });
  const quarter = await page.locator('#map [data-quarter]').first().getAttribute('d');
  await page.locator('#mapStyle').selectOption('night');
  await page.locator('#planDiagnostic').selectOption('none');
  assert.equal(await page.locator('#mapStyle').inputValue(), 'night');
  assert.equal(await page.locator('#map [data-quarter]').first().getAttribute('d'), quarter);
  await page.reload();
  await page.locator('#map [data-quarter]').first().waitFor({ timeout: 60000 });
  assert.equal(await page.locator('#mapStyle').inputValue(), 'night');
  assert.equal(await page.locator('#planDiagnostic').inputValue(), 'none');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ styles: audit.styles.length, maximumSeaLakeChannelDifference: Math.max(...audit.styles.map(s => s.delta)), glError: audit.glError }));
  console.log('Style material parity, visibility, diagnostics and replay checks passed (WebGL + SVG).');
} finally { await browser.close(); }
