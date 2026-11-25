/** Real V2 block editing, contextual options, propagation intent and selection lifecycle. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../out/editor-contract/', import.meta.url));
await mkdir(out, { recursive: true });
const binary = fileURLToPath(new URL('../../rust/target/debug/magna-urbis-local.exe', import.meta.url));
const engine = spawn(binary, ['--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, MAGNA_LOCAL_ADDR: '127.0.0.1:0' } });
let dev, browser, page;
const errors = [];
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Engine startup timed out')), 20000);
    let output = '';
    engine.stdout.on('data', chunk => {
      output += chunk;
      for (const line of output.split('\n'))
        try {
          const row = JSON.parse(line);
          if (row.ready && row.port) {
            clearTimeout(timer);
            resolve(row.port);
          }
        } catch {}
    });
    engine.once('error', reject);
  });
  dev = await createServer({ mode: 'rustbench', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
  await dev.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.setDefaultTimeout(90000);
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${dev.httpServer.address().port}/v2.html?empty&test=1&lang=en&profile=local&localServer=${encodeURIComponent(`http://127.0.0.1:${port}`)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__v2Test?.ready);
  console.log('Preparing editor fixture');
  await page.evaluate(() => window.__v2Test.prepare({ decor: 'city-temperate-river-s', culture: 'european-organic', population: 100, seed: 'editor-contract', fortification: 'none' }));
  await page.locator('#map-style').selectOption('parchment');
  await page.evaluate(() => window.__v2Test.run());
  const codeModule = '/@fs/' + fileURLToPath(new URL('../src/v2/cityCode.ts', import.meta.url)).replaceAll('\\', '/');
  const recipe = () =>
    page.evaluate(async module => {
      const { decodeCityCode } = await import(module);
      return decodeCityCode(await window.__v2Test.code()).settings;
    }, codeModule);
  const original = await recipe();
  const view = await page.evaluate(() => window.__v2Test.view('2d-core')),
    box = await page.locator('#map').boundingBox();
  const houses = await page.evaluate(() =>
    window.__v2Test
      .world()
      .urban.buildings.filter(b => b.nativeRequestId)
      .map(b => ({ x: b.poly.reduce((sum, p) => sum + p.x / b.poly.length, 0), y: b.poly.reduce((sum, p) => sum + p.y / b.poly.length, 0) })),
  );
  const point = houses.map(p => ({ x: box.x + box.width / 2 + (p.x - view.cx) * view.scale, y: box.y + box.height / 2 + (p.y - view.cy) * view.scale })).find(p => p.x > box.x + 50 && p.x < box.x + box.width * 0.55 && p.y > box.y + 100 && p.y < box.y + box.height - 70);
  assert(point, 'an editable building is visible');
  const pick = async target => {
    await page.evaluate(target => {
      const input = document.querySelector('#inspect-mode');
      input.checked = true;
      input.dispatchEvent(new Event('change'));
      document.querySelector('#inspect-target').value = target;
    }, target);
    await page.mouse.click(point.x, point.y);
  };
  await pick('block');
  await page.locator('#subdivision-controls [data-setting-path="culture"]').waitFor();
  assert(await page.locator('#subdivision-apply').isVisible());
  assert.equal(await page.locator('#subdivision-controls [data-setting-path="houseConfig.pack"]').isVisible(), false);
  assert.equal(await page.locator('#subdivision-controls [data-setting-path^="shape."]').count(), 0);
  assert.equal(await page.locator('#building-inspector .advanced-open:visible').count(), 1);
  await page.locator('#subdivision-controls [data-setting-path="density"]').fill('0.8');
  assert.match(await page.locator('#selection-status').innerText(), /pending/i);
  console.log('Regenerating one retained block');
  await page.locator('#subdivision-actions .subdivision-reroll').click();
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  const after = await recipe();
  const blockEdits = Object.values(after.urban.local).flatMap(local => Object.entries(local.parcels?.overrides?.blocks ?? {}));
  assert.equal(blockEdits.length, 1);
  assert.equal(blockEdits[0][1].density, 0.8);
  assert(blockEdits[0][1].salt > 0);
  assert.equal(after.urban.architecture, original.urban?.architecture);
  assert.deepEqual(after.appearance, original.appearance);
  const actual = await page.evaluate(() => {
    const w = window.__v2Test.world();
    return Object.values(w.debug.v2RustCities)[0].partitions?.[0]?.config?.overrides?.blocks;
  });
  assert(
    Object.values(actual ?? {}).some(edit => edit.salt === blockEdits[0][1].salt && edit.density === 0.8),
    'the real native partition retained the selected block settings',
  );
  await page.screenshot({ path: `${out}/block.png` });
  await page.evaluate(() => {
    const input = document.querySelector('#inspect-mode');
    input.checked = false;
    input.dispatchEvent(new Event('change'));
  });
  assert.equal(await page.locator('[data-urban-selection] path').last().getAttribute('d'), '');
  await pick('quarter');
  await page.locator('#subdivision-controls [data-city-pattern="radial"]').click();
  assert.equal(await page.locator('#subdivision-controls select[data-setting-path="tissue"]').isVisible(), false);
  const pending = await recipe();
  assert(Object.values(pending.urban.local).some(local => Object.values(local.layout?.overrides?.quarters ?? {}).some(edit => edit.tissue === 'radial')));
  await page.screenshot({ path: `${out}/quarter.png` });
  // The tilt ends the editors and clears their outline.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: '3d' })));
  assert.equal(await page.locator('[data-urban-selection] path').last().getAttribute('d'), '');
  await pick('parcel');
  const parcelTypes = await page.locator('#subdivision-controls [data-setting-path="role"] option').allTextContents();
  assert(parcelTypes.length > 1);
  assert(!parcelTypes.some(text => /Tour du mage|Église|Entrepôt/.test(text)), 'English parcel options contain no hardcoded French labels');
  await pick('house');
  await page.locator('#house-native-controls [data-setting-path="culture"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#house-native-controls [data-setting-path="pack"]').isVisible(), false);
  assert.equal(await page.locator('#building-inspector .advanced-open:visible').count(), 1);
  assert(await page.locator('#building-inspector [data-setting-path="role"]').isVisible());
  await page.waitForFunction(() => document.querySelector('#house-native-controls [data-setting-path="pack"]')?.options.length > 2);
  await page.screenshot({ path: `${out}/building.png` });
  let smallPlaceBatches;
  if (process.argv.includes('--small-places')) {
    console.log('Checking real native farmstead batches');
    await page.goto(page.url(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__v2Test?.ready);
    await page.evaluate(() => window.__v2Test.prepare({ decor: 'city-temperate-river-s', culture: 'european-organic', population: 100, seed: 'small-place-batches', fortification: 'none' }));
    await page.locator('#map-style').selectOption('parchment');
    await page.evaluate(async () => {
      window.__editorBatchWorlds = [];
      window.addEventListener('v2-place-built', event => {
        let group = window.__editorBatchWorlds.find(group => group.world === event.detail.world);
        if (!group) window.__editorBatchWorlds.push((group = { world: event.detail.world, keys: [] }));
        group.keys.push(event.detail.key);
      });
      const spec = (key, population) => ({ key, population, culture: 'european-organic', name: '', siteType: 'auto', sitePrefs: {} });
      await window.__v2Test.runRegion({
        places: 'main',
        region: { placement: { mode: 'list', main: spec('main', 100), list: [spec('main', 100), ...Array.from({ length: 9 }, (_, i) => spec(`farm-${i}`, 6))], farmDensity: 0, remotePlaces: 0 }, demography: { isolatedCount: 0 }, autoBuildPopulation: 500 },
      });
      await window.__v2Test.smallPlacesSettled();
    });
    smallPlaceBatches = await page.evaluate(() => ({
      batches: window.__editorBatchWorlds.map(group => group.keys),
      farms: window.__v2Test
        .world()
        .settlements.filter(p => !p.main)
        .map(p => ({ key: p.key, built: !!p.urban })),
    }));
    assert.equal(smallPlaceBatches.farms.length, 9);
    assert(
      smallPlaceBatches.farms.every(p => p.built),
      'all farmsteads were built by the real native engine',
    );
    assert.deepEqual(
      smallPlaceBatches.batches.map(keys => keys.length),
      [8, 1],
      'one world update per bounded group',
    );
  }
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ blockEdits, sharedPendingPattern: true, rendererPreserved: true, selectionLifecycle: true, sceneControls3d: true, smallPlaceBatches, errors }, null, 2));
  console.log('Editor contract browser check passed');
} catch (error) {
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await dev?.close();
  engine.kill();
}
