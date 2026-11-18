/** Real V2 selection, scoped model controls and atomic refusal, against the current native build. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const out = fileURLToPath(new URL('../out/subdivision-editing/', import.meta.url));
await mkdir(out, { recursive: true });
const binary = process.env.MAGNA_LOCAL_BIN ?? fileURLToPath(new URL('../../rust/target/debug/magna-urbis-local.exe', import.meta.url));
const engine = spawn(binary, ['--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, MAGNA_LOCAL_ADDR: '127.0.0.1:0' } });
let browser, page, monitor, dev;
const errors = [];
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native engine startup timed out')), 20000);
    let output = '';
    engine.stdout.on('data', chunk => {
      output += chunk;
      for (const line of output.split('\n'))
        try {
          const value = JSON.parse(line);
          if (value.ready && value.port) {
            clearTimeout(timer);
            resolve(value.port);
          }
        } catch {}
    });
    engine.once('error', reject);
    engine.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Native engine exited: ${code}`));
    });
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(90000);
  page.on('pageerror', error => {
    errors.push(error.stack ?? error.message);
    console.error(error.stack ?? error.message);
  });
  let base = process.env.MAGNA_V2_URL;
  if (!base) {
    dev = await createServer({ mode: 'rustbench', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
    await dev.listen();
    base = `http://127.0.0.1:${dev.httpServer.address().port}`;
  }
  await page.goto(`${base}/v2.html?empty&test=1&lang=fr&profile=local&localServer=${encodeURIComponent(`http://127.0.0.1:${port}`)}`);
  await page.waitForFunction(() => window.__v2Test?.ready);
  monitor = setInterval(
    () =>
      void page
        .evaluate(() => ({ busy: document.querySelector('#app')?.getAttribute('aria-busy'), status: document.querySelector('#footer-status')?.textContent, progress: document.querySelector('#progress-label')?.textContent }))
        .then(state => console.log('V2 check:', JSON.stringify(state)))
        .catch(() => {}),
    20000,
  );
  await page.evaluate(async () => {
    await window.__v2Test.prepare({ decor: 'city-temperate-river-s', culture: 'european-organic', population: 100, seed: 'local-house-editing', fortification: 'none' });
  });
  const generation = page.evaluate(() => window.__v2Test.run());
  await Promise.race([generation, new Promise((_, reject) => setTimeout(() => reject(new Error('V2 generation did not settle within 180 seconds')), 180000).unref())]);
  const view = await page.evaluate(() => window.__v2Test.view('2d-core'));
  const box = await page.locator('#map').boundingBox();
  const candidates = await page.evaluate(() =>
    window.__v2Test
      .world()
      .urban.buildings.filter(b => b.nativeRequestId)
      .map(b => ({ id: b.nativeRequestId, x: b.poly.reduce((sum, p) => sum + p.x / b.poly.length, 0), y: b.poly.reduce((sum, p) => sum + p.y / b.poly.length, 0) })),
  );
  const house = candidates
    .map(b => ({ ...b, screenX: box.x + box.width / 2 + (b.x - view.cx) * view.scale, screenY: box.y + box.height / 2 + (b.y - view.cy) * view.scale }))
    .find(b => b.screenX > box.x + 50 && b.screenX < box.x + box.width * 0.55 && b.screenY > box.y + 100 && b.screenY < box.y + box.height - 80);
  assert(house, 'a house is visible in the map');
  await page.evaluate(() => {
    const inspect = document.querySelector('#inspect-mode');
    inspect.checked = true;
    inspect.dispatchEvent(new Event('change'));
    document.querySelector('#inspect-target').value = 'house';
  });
  await page.mouse.click(house.screenX, house.screenY);
  await page.locator('#house-native-controls [data-setting-path="pack"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#house-roof').count(), 0, 'native houses use a single generation editor');
  assert(await page.locator('[data-urban-selection] path').last().getAttribute('d'), 'selected house has an outline');
  assert(await page.locator('#house-native-controls [data-setting-path="culture"] option[value="myconid-colony"]').count(), 'individual fantasy styles are selectable');
  const styleCaption = await page.locator('#house-native-controls [data-field-path="culture"] .parameter-caption').textContent();
  assert.equal(styleCaption, 'Style de la maison', 'custom architectural labels retain their locale');
  await page.locator('#house-native-controls [data-setting-path="pack"]').evaluate(input => {
    for (let p = input.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  });
  await page.waitForFunction(() => document.querySelector('#house-native-controls [data-setting-path="pack"]')?.getAttribute('list'));
  await page.screenshot({ path: `${out}/selected-house.png` });
  const roof = page.locator('#house-native-controls [data-setting-path="overrides.roof"]');
  const originalFootprint = await page.evaluate(id => {
    const w = window.__v2Test.world();
    return w.debug.v2RustCities[w.settlements[0].key].scene.buildings.find(b => b.id === id).footprint;
  }, house.id);
  const allowed = 'RF-FLAT';
  await roof.fill(allowed);
  await roof.dispatchEvent('change');
  await page.locator('#house-native-apply').click();
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  const recomputed = await page.evaluate(() => {
    const w = window.__v2Test.world();
    return w.debug.v2RustCities[w.settlements[0].key].lastBuildingRequests;
  });
  assert.equal(recomputed, 1, 'an allowed roof replans only the selected house');
  assert.deepEqual(
    await page.evaluate(id => {
      const w = window.__v2Test.world();
      return w.debug.v2RustCities[w.settlements[0].key].scene.buildings.find(b => b.id === id).footprint;
    }, house.id),
    originalFootprint,
    'a procedural roof change preserves the existing footprint',
  );
  assert.equal(await page.evaluate(id => window.__v2Test.world().urban.buildings.find(b => b.nativeRequestId === id).roof, house.id), 'flat', 'the edited roof is visible in the rendered city contract');
  await page.locator('#house-native-controls [data-setting-path="overrides.roof"]').waitFor({ state: 'attached' });
  assert(await page.locator('[data-urban-selection] path').last().getAttribute('d'), 'selection survives an accepted edit');
  const before = await page.evaluate(() => {
    const w = window.__v2Test.world();
    return JSON.stringify(w.debug.v2RustCities[w.settlements[0].key].scene);
  });
  const nextRoof = page.locator('#house-native-controls [data-setting-path="overrides.roof"]');
  await nextRoof.evaluate(input => {
    for (let p = input.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  });
  await nextRoof.fill('RF-INVALID');
  await nextRoof.dispatchEvent('change');
  await page.locator('#house-native-apply').click();
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  assert.equal(
    await page.evaluate(() => {
      const w = window.__v2Test.world();
      return JSON.stringify(w.debug.v2RustCities[w.settlements[0].key].scene);
    }),
    before,
    'a refused roof keeps every existing building',
  );
  assert(await page.locator('[data-urban-selection] path').last().getAttribute('d'), 'selection survives the refusal');
  assert(await page.locator('#toast').isVisible(), 'the engine refusal is visible');
  await page.locator('#map-advanced-open').click();
  await page.locator('#name-visibility-controls').waitFor();
  assert.equal(await page.locator('[data-name-category="buildings"]').isChecked(), false);
  assert.equal(await page.locator('[data-name-category="districts"]').isChecked(), false);
  assert.equal(await page.locator('#name-detail').getAttribute('type'), 'range');
  await page.screenshot({ path: `${out}/names-advanced.png` });
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ selected: house.id, outline: true, styleSelector: true, styleCaption, acceptedRoof: allowed, recomputed, footprintPreserved: true, refusalRetainsScene: true, quietDefaults: true, errors }, null, 2));
  console.log('V2 subdivision editing check passed');
} catch (error) {
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error('Browser errors:', errors);
  throw error;
} finally {
  clearInterval(monitor);
  await browser?.close();
  await dev?.close();
  engine.kill();
}
