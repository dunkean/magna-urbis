/** V2 UI integration: real controls, exports and imports, without test-only app hooks. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const out = `${web}/out/v2-browser`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashTerrain = terrain => hash({ ...terrain, rivers: terrain.rivers.map(({ name, ...river }) => river) });
const result = { time: new Date().toISOString(), checks: {}, errors: [] };
let browser, page;
await mkdir(out, { recursive: true });
try {
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  await page.goto(`${base}/v2.html?empty&lang=fr`, { waitUntil: 'networkidle' });
  await page.locator('#terrain-only').waitFor({ state: 'visible' });
  const reveal = async selector => { await page.locator(selector).evaluate(element => { const sections=[]; for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)sections.push(parent); for(const section of sections.reverse())section.open=true; }); };
  const setInput = async (selector, value) => { await reveal(selector); await page.locator(selector).fill(String(value)); await page.locator(selector).dispatchEvent('change'); };
  const select = async (selector, value) => { await reveal(selector); await page.locator(selector).selectOption(value); };
  const close = async id => { if (await page.locator(id).evaluate(el => el.open)) await page.locator(`${id} [data-close]`).last().click(); };
  const job = async selector => {
    const before = await page.locator('#job-log').textContent();
    await page.locator(selector).click();
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
    const log = (await page.locator('#job-log').textContent()).slice(before.length);
    assert(!log.includes('Échec :'), log);
    assert.match(await page.locator('#footer-status').textContent(), /Carte prête/);
    return log;
  };
  const exportFile = async (format, name, crop = false) => {
    await page.locator('#export-open').click();
    await page.locator('#export-format').selectOption(format);
    if (format === 'svg' || format === 'png') await page.locator('#export-crop').setChecked(crop);
    const pending = page.waitForEvent('download', { timeout: 120000 });
    await page.locator('#export-go').click();
    if (crop) {
      await page.locator('.export-crop').waitFor({ state: 'visible' });
      for (const [key, value] of Object.entries({ width: 1200, height: 600, x: 100, y: 100 })) {
        await setInput(`.export-crop [data-field="${key}"]`, value);
      }
      await page.locator('.export-crop [data-action="export"]').click();
    }
    const download = await pending;
    const path = `${out}/${name}`; await download.saveAs(path);
    await page.locator('#export-dialog').waitFor({ state: 'hidden' });
    return readFile(path);
  };
  const project = async stage => JSON.parse(await exportFile('project', `${stage}.project.json`));
  const importData = async (buffer, name) => {
    await page.locator('#import-open').click();
    await page.locator('#project-file').setInputFiles({ name, mimeType: 'application/json', buffer });
    await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  };

  await setInput('#seed', 'v2-ui-evidence');
  await select('#terrain-backend', 'typescript');
  await setInput('#terrain-width', '2.4'); await page.locator('#terrain-width').blur();
  await select('[data-setting-path="options.relief"]', 'flat');
  await select('[data-setting-path="options.coast"]', 'none');
  await select('[data-setting-path="options.river"]', 'stream');
  result.checks.terrainLog = await job('#terrain-only');
  const terrain = await project('01-terrain');
  assert.equal(terrain.world.stats['v2.stage'], 'terrain');
  assert.equal(terrain.settings.runtime.backend, 'typescript');
  assert.equal(terrain.world.stats.backend, 'typescript-cpu');
  assert(!terrain.world.urban); assert(!terrain.world.settlements?.length);
  const terrainHash = hashTerrain(terrain.world.terrain);
  result.checks.terrain = { hash: terrainHash, rivers: terrain.world.terrain.rivers.length, grid: terrain.world.terrain.height.w };
  await page.screenshot({ path: `${out}/01-topography.png`, fullPage: true });

  await page.locator('#tab-settlements').click();
  await setInput('[data-option="population"]', 300);
  await setInput('#town-count', 2);
  result.checks.regionLog = await job('#region-only');
  const region = await project('02-region');
  assert.equal(hashTerrain(region.world.terrain), terrainHash);
  assert(region.world.settlements.length >= 2, 'Expected at least two retained settlements');
  assert(!region.world.urban); assert(region.world.settlements.every(s => !s.urban));
  result.checks.region = { settlements: region.world.settlements.length, roads: region.world.roads.length, terrainRetained: true };
  await page.screenshot({ path: `${out}/02-placements.png`, fullPage: true });

  await page.locator('[data-town="main"]').click();
  await setInput('#local-population', 350);
  await page.locator('#local-walls').selectOption('none');
  result.checks.individualLog = await job('#build-town');
  const oneTown = await project('03-individual');
  assert.equal(hashTerrain(oneTown.world.terrain), terrainHash);
  assert.equal(oneTown.world.settlements.find(s => s.main).population, 350);
  assert(oneTown.world.urban.buildings.length > 0);
  assert(oneTown.world.settlements.filter(s => !s.main).every(s => !s.urban));
  assert.equal(hash(oneTown.world.roads), hash(region.world.roads));
  result.checks.individual = { buildings: oneTown.world.urban.buildings.length, neighborsUnbuilt: true, roadsRetained: true };

  await page.locator('#inspector .close').click();
  result.checks.allTownsLog = await job('#towns-only');
  const allTowns = await project('04-all-towns');
  const neighbors = allTowns.world.settlements.filter(s => !s.main);
  const neighborHash = hash(neighbors.map(s => s.urban));
  await page.locator('[data-town="main"]').click();
  await setInput('#local-population', 500);
  await job('#build-town');
  const rebuilt = await project('05-rebuilt-main');
  assert.equal(hashTerrain(rebuilt.world.terrain), terrainHash);
  assert.equal(hash(rebuilt.world.settlements.filter(s => !s.main).map(s => s.urban)), neighborHash);
  assert.equal(rebuilt.world.settlements.find(s => s.main).population, 500);
  result.checks.rebuild = { neighborHash, terrainRetained: true, neighborsRetained: true };

  // Select a real exported building via the public map interaction and persist its local modification.
  await page.locator('[data-town="main"]').click();
  await page.locator('#inspect-mode').check();
  const main = rebuilt.world.settlements.find(s => s.main), map = await page.locator('#map').boundingBox();
  const scale = Math.min(3, Math.min(map.height, map.width) / Math.max(600, main.radius * 3));
  let editedHouse = false;
  for (const building of rebuilt.world.urban.buildings) {
    const p = building.poly.reduce((s, p) => ({ x: s.x + p.x / building.poly.length, y: s.y + p.y / building.poly.length }), { x: 0, y: 0 });
    const x = map.x + map.width / 2 + (p.x - main.center.x) * scale, y = map.y + map.height / 2 + (p.y - main.center.y) * scale;
    if (x < map.x + 60 || x > map.x + map.width - 360 || y < map.y + 180 || y > map.y + map.height - 180) continue;
    await page.mouse.click(x, y);
    if (await page.locator('#house-height').count()) {
      await setInput('#house-height', 9.5); await setInput('#house-storeys', 3);
      await page.locator('#house-roof').selectOption('hip'); await page.locator('#house-apply').click();
      editedHouse = true; break;
    }
  }
  assert(editedHouse, 'Could not inspect a real building through the canvas');
  const edited = await project('06-house-edit');
  assert.equal(edited.mods.length, 1); assert.equal(edited.mods[0].patch.height, 9.5);
  result.checks.house = { persisted: true, height: edited.mods[0].patch.height, storeys: edited.mods[0].patch.storeys };
  await page.screenshot({ path: `${out}/03-house-inspector.png`, fullPage: true });
  await page.locator('#inspector .close').click();

  const beforeStyle = hash(await page.locator('#map-canvas').screenshot());
  await page.locator('#map-style').selectOption('atlas');
  await page.waitForTimeout(1200);
  const afterStyle = hash(await page.locator('#map-canvas').screenshot());
  assert.notEqual(afterStyle, beforeStyle, 'Changing map style should redraw the same world');
  const svg = (await exportFile('svg', '07-atlas.svg')).toString();
  assert.match(svg, /<svg/); assert(svg.length > 1000);
  result.checks.styleAndSvg = { redrawn: true, bytes: svg.length };

  await page.locator('#export-open').click();
  await page.locator('#export-resolution').selectOption('1600');
  for (const layer of ['background', 'terrain', 'landuse', 'labels', 'decor']) await page.locator(`[data-layer="${layer}"]`).uncheck();
  await close('#export-dialog');
  const png = await exportFile('png', '08-cropped-layers.png', true);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1600); assert.equal(png.readUInt32BE(20), 800);
  result.checks.croppedLayers = { width: 1600, height: 800, bytes: png.length };

  const recipe = await exportFile('recipe', '09-recipe.json');
  const savedProject = Buffer.from(JSON.stringify(edited));
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('#terrain-only').waitFor();
  await importData(savedProject, 'restored.project.json');
  const restored = await project('10-restored');
  assert.equal(hashTerrain(restored.world.terrain), terrainHash); assert.equal(restored.mods.length, 1);
  assert.equal(restored.mods[0].patch.height, 9.5);
  result.checks.projectImport = { terrainExact: true, modificationsRetained: true };
  await page.reload({ waitUntil: 'networkidle' }); await page.locator('#terrain-only').waitFor();
  await importData(recipe, 'cached.recipe.json');
  result.checks.diskCacheLog = await job('#terrain-only');
  assert.match(result.checks.diskCacheLog, /disk/);
  const cached = await project('11-cache-restored');
  assert.equal(hashTerrain(cached.world.terrain), terrainHash);
  result.checks.diskCache = { sameTerrain: true, source: cached.world.stats['v2.cache'] };

  result.checks.oneClickLog = await job('#generate-region');
  const oneClick = await project('12-one-click');
  assert.equal(hashTerrain(oneClick.world.terrain), terrainHash);
  assert.equal(oneClick.world.stats['v2.stage'], 'terrain');
  assert(!oneClick.world.urban); assert(!oneClick.world.settlements?.length);
  result.checks.oneClick = { terrainOnly: true, terrainRetained: true };
  await page.screenshot({ path: `${out}/05-one-click.png`, fullPage: true });

  await page.locator('#tab-settlements').click();
  result.checks.oneClickPlacementLog = await job('#region-only');
  result.checks.oneClickConstructionLog = await job('#towns-only');
  const staged = await project('12b-staged-world');
  assert.equal(hashTerrain(staged.world.terrain), terrainHash);
  assert(staged.world.urban.buildings.length > 0);
  assert(staged.world.settlements.filter(s => !s.main && s.detail !== 'farmstead').every(s => s.urban));
  result.checks.stagedCompletion = { settlements: staged.world.settlements.length, buildings: staged.world.urban.buildings.length };

  // A real PNG import goes through image decoding and the same terrain worker as a user file.
  const heightPng = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const h = Math.round(255 * (x + y) / 62); image.data.set([h, h, h, 255], (y * 32 + x) * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#import-open').click();
  await page.locator('#heightmap-file').setInputFiles({ name: 'v2-heightmap-fixture.png', mimeType: 'image/png', buffer: Buffer.from(heightPng, 'base64') });
  await page.waitForFunction(() => document.querySelector('#import-height-info').textContent.includes('32 × 32'));
  await close('#import-dialog');
  await page.locator('#tab-terrain').click();
  await setInput('[data-option="heightScale"]', 200); await setInput('[data-option="importSea"]', 20);
  await job('#terrain-only');
  const importedHeight = await project('13-heightmap-import');
  assert.equal(importedHeight.settings.options.importedHeight.w, 32);
  assert.equal(importedHeight.settings.options.importedHeight.h, 32);
  assert.notEqual(hashTerrain(importedHeight.world.terrain), terrainHash);
  result.checks.heightmapImport = { dimensions: [32, 32], replacedTerrain: true };

  await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('heightmap');
  const heightDownloads = [];
  const collectHeight = download => heightDownloads.push(download); page.on('download', collectHeight);
  await page.locator('#export-go').click(); await page.locator('#export-dialog').waitFor({ state: 'hidden' });
  for (let i = 0; i < 100 && heightDownloads.length < 2; i++) await page.waitForTimeout(50);
  page.off('download', collectHeight);
  assert.equal(heightDownloads.length, 2, 'Heightmap export must deliver image and altitude metadata');
  for (const download of heightDownloads) await download.saveAs(`${out}/${download.suggestedFilename()}`);
  const metadataDownload = heightDownloads.find(d => d.suggestedFilename().endsWith('.json'));
  const metadata = JSON.parse(await readFile(await metadataDownload.path()));
  assert(metadata.maxHeight > metadata.minHeight); assert.equal(metadata.mapSize, 2400);
  result.checks.heightmapExport = { files: 2, minHeight: metadata.minHeight, maxHeight: metadata.maxHeight };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobile-toggle').waitFor({ state: 'visible' });
  const pageWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert(pageWidth.scroll <= pageWidth.width + 1, 'Mobile document overflows horizontally');
  await page.locator('#mobile-toggle').click();
  assert.equal(await page.locator('#mobile-toggle').getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: `${out}/04-mobile.png`, fullPage: true });
  result.checks.mobile = { width: 390, noHorizontalOverflow: true, menuAccessible: true };
  assert.deepEqual(result.errors, [], 'Browser errors');
  result.ok = true;
} catch (error) {
  result.ok = false; result.error = error.stack; process.exitCode = 1;
  if (page) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); result.log = await page.locator('#job-log').textContent().catch(() => ''); }
} finally {
  await browser?.close();
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
