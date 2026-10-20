import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// From web/: node scripts/ruler3d_ui_check.mjs [bench origin]
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const params = new URLSearchParams({ source: 'procedural', standalone: '1', seed: 'ruler3d', width: '3000', relief: 'flat',
  generation: 'cpu', compute: 'wasm', hydro_enabled: '0', auto: '0', refine: '0', projection: '3d' });
try {
  await page.goto(`${base}/terrainbench.html?${params}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 120000 });
  await page.locator('#terrain3d').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#terrain3d').width > 1);
  const ruler = page.locator('.ruler-controls button');
  await ruler.click();
  assert.equal(await ruler.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#projection3d').getAttribute('aria-pressed'), 'true');
  const bounds = await page.locator('#viewport').boundingBox();
  const camera = await page.evaluate(() => window.magnaBenchContext.capture().camera3d);
  const from = { x: bounds.x + bounds.width * .43, y: bounds.y + bounds.height * .52 };
  const to = { x: bounds.x + bounds.width * .57, y: bounds.y + bounds.height * .62 };
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
  const result = page.locator('.ruler-distance');
  await result.filter({ hasText: /Distance: [\d,.]+ (km|m)/ }).waitFor();
  const distance = await result.textContent();
  assert.deepEqual(await page.evaluate(() => window.magnaBenchContext.capture().camera3d), camera);
  const before = await page.locator('.ruler-layer line').first().getAttribute('x1');
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(x => document.querySelector('.ruler-layer line').getAttribute('x1') !== x, before);
  assert.equal(await result.textContent(), distance);
  await mkdir('out', { recursive: true });
  await page.screenshot({ path: 'out/ruler3d-ui.png' });
  await page.locator('#projection3d').click();
  assert.equal(await result.textContent(), distance);
  assert.equal(await ruler.getAttribute('aria-pressed'), 'true');
  // Existing 2D drag still measures and survives switching back to 3D.
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y); await page.mouse.up();
  const distance2d = await result.textContent();
  assert.match(distance2d, /Distance: [\d,.]+ (km|m)/);
  await page.locator('#projection3d').click();
  assert.equal(await ruler.getAttribute('aria-pressed'), 'true');
  assert.equal(await result.textContent(), distance2d);
  await page.keyboard.press('Escape');
  assert.equal(await ruler.getAttribute('aria-pressed'), 'false');
  assert.equal(await result.isVisible(), false);
  await page.locator('#pinMode').click();
  assert.equal(await page.locator('#projection3d').getAttribute('aria-pressed'), 'false');
  assert.equal(await ruler.getAttribute('aria-pressed'), 'false');

  // Exercise actual WebGL projection/picking independently of procedural generation.
  const geometry = await browser.newPage();
  await geometry.goto(`${base}/terrainbench.html?standalone=1&source=procedural&width=3000&hydro_enabled=0&auto=0`, { waitUntil: 'domcontentloaded' });
  const checks = await geometry.evaluate(async () => {
    const { Terrain3d } = await import('/terrain3d.ts');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const terrain = new Terrain3d(canvas, () => {});
    const n = 32, data = Float32Array.from({ length: n * n }, (_, i) => 100 + 50 * Math.sin((i % n) / n * Math.PI));
    terrain.resize(800, 600); terrain.setSurface({ x: 0, y: 0, width: 1000, n, data }); terrain.setActive(true);
    let checked = 0;
    for (const yaw of [0, .7, -1.4]) for (const exaggeration of [1, 4]) {
      terrain.setCamera({ x: 500, y: 500, distance: 1200, yaw, pitch: .9, exaggeration });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (const point of [[500, 500], [400, 450], [600, 550]]) {
        const screen = terrain.worldToScreen(...point), world = screen && terrain.screenToWorld(...screen);
        if (!world || Math.hypot(world[0] - point[0], world[1] - point[1]) > .001) throw new Error(`Projection round trip failed: ${JSON.stringify({ point, screen, world, yaw, exaggeration })}`);
        checked++;
      }
    }
    terrain.setCamera({ x: 500, y: 500, distance: 300, yaw: 0, pitch: .14, exaggeration: 1 });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (terrain.screenToWorld(400, 0) !== null) throw new Error('Sky must not be measurable');
    terrain.dispose(); canvas.remove();
    return checked;
  });
  await geometry.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, distance, distance2d, projectionChecks: checks, zoom: true, escape: true, errors }, null, 2));
} finally { await browser.close(); }
