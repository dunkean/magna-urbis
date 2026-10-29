/** Real V2 UI composition, appearance, and minimal seed import/export checks. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175';
const out = `${web}/out/v2-compose-browser`;
const report = { time: new Date().toISOString(), checks: {}, errors: [] };
const stable = value => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
const physicalHash = terrain => createHash('sha256').update(stable({
  height: terrain.height, slope: terrain.slope, flow: terrain.flow, water: terrain.water,
  receiver: terrain.receiver, filled: terrain.filled, seaLevel: terrain.seaLevel, seaFraction: terrain.seaFraction,
  coastline: terrain.coastline, islands: terrain.islands, lakes: terrain.lakes,
  rivers: terrain.rivers.map(({ name: _name, ...river }) => river),
})).digest('hex');
let browser, page;
await mkdir(out, { recursive: true });
try {
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(`${base}/v2.html?empty&lang=fr`, { waitUntil: 'networkidle' });
  await page.locator('#terrain-only').waitFor();
  const input = async (selector, value) => {
    await page.locator(selector).fill(String(value));
    await page.locator(selector).dispatchEvent('change');
  };
  const job = async selector => {
    const before = await page.locator('#job-log').textContent();
    await page.locator(selector).click();
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
    const log = (await page.locator('#job-log').textContent()).slice(before.length);
    assert(!log.includes('Échec :'), log);
    assert.match(await page.locator('#footer-status').textContent(), /Carte prête/);
    return log;
  };
  const stagedWorld = async () => {
    const logs = [`[Terrain]\n${await job('#generate-region')}`];
    await page.locator('#tab-settlements').click();
    logs.push(`[Placement and roads]\n${await job('#region-only')}`);
    logs.push(`[City construction]\n${await job('#towns-only')}`);
    return logs.join('\n');
  };
  const exportFile = async (format, name) => {
    await page.locator('#export-open').click();
    await page.locator('#export-format').selectOption(format);
    const pending = page.waitForEvent('download', { timeout: 120000 });
    await page.locator('#export-go').click();
    const download = await pending;
    const path = `${out}/${name}`;
    await download.saveAs(path);
    await page.locator('#export-dialog').waitFor({ state: 'hidden' });
    return readFile(path);
  };
  const project = async name => {
    const buffer = await exportFile('project', name);
    return { buffer, data: JSON.parse(buffer) };
  };
  const importFile = async (buffer, scope, name) => {
    await page.locator('#import-open').click();
    await page.locator('#import-scope').selectOption(scope);
    await page.locator('#project-file').setInputFiles({ name, mimeType: 'application/json', buffer });
    await page.locator('#import-dialog').waitFor({ state: 'hidden', timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  };
  const terrainOnly = world => {
    for (const field of ['site', 'roads', 'bridges', 'urban', 'settlements', 'megaDetail', 'names', 'debug']) assert.equal(world[field], undefined, `${field} survived composition`);
    assert.equal(world.stats['v2.stage'], 'terrain');
    assert.equal(world.stats['v2.planKey'], undefined);
  };

  // Two distinct actual territories make an accidental no-op or wrong-direction merge observable.
  const reveal=async selector=>page.locator(selector).evaluate(node=>{for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
  await reveal('#terrain-backend');await page.locator('#terrain-backend').selectOption('typescript');
  await input('#seed', 'v2-compose-browser-source');
  await input('#terrain-width',2.4);
  await reveal('[data-setting-path="options.biome"]:visible');await page.locator('[data-setting-path="options.biome"]:visible').selectOption('forest');
  await reveal('[data-setting-path="options.relief"]');await page.locator('[data-setting-path="options.relief"]').selectOption('flat');
  await reveal('[data-setting-path="options.coast"]');await page.locator('[data-setting-path="options.coast"]').selectOption('none');
  await reveal('[data-setting-path="options.river"]');await page.locator('[data-setting-path="options.river"]').selectOption('none');
  await page.locator('#tab-settlements').click();
  await input('[data-option="population"]', 80);
  await input('#town-count', 1);
  await page.locator('#tab-terrain').click();
  report.checks.sourceTerrainLog = await job('#terrain-only');
  const source = await project('01-source-territory.project.json');
  const sourceHash = physicalHash(source.data.world.terrain);

  await input('#seed', 'v2-compose-browser-current');
  await page.locator('[data-setting-path="options.biome"]:visible').selectOption('desert');
  await page.locator('#tab-settlements').click();
  await input('[data-option="population"]', 300);
  await page.locator('[data-option="culture"]').selectOption('medina');
  report.checks.currentWorldLog = await stagedWorld();
  await page.locator('[data-town="main"]').click();
  await input('#local-sprawl', 1.3);
  report.checks.localTownLog = await job('#build-town');
  await page.locator('#inspector .close').click();
  await page.locator('#map-style').selectOption('atlas');
  await page.locator('.display-menu > summary').click();
  await page.locator('#display-contours').uncheck();
  await page.locator('#display-labels').uncheck();
  await page.locator('.display-menu > summary').click();
  const current = await project('02-current-world.project.json');
  assert(current.data.world.urban.buildings.length > 0);
  assert.notEqual(physicalHash(current.data.world.terrain), sourceHash);

  await importFile(source.buffer, 'terrain', 'source-territory.project.json');
  const composed = await project('03-terrain-composition.project.json');
  assert.equal(physicalHash(composed.data.world.terrain), sourceHash);
  assert.deepEqual(composed.data.world.terrain.rivers, source.data.world.terrain.rivers);
  terrainOnly(composed.data.world);
  assert.equal(composed.data.settings.options.seed, source.data.world.seed);
  assert.equal(composed.data.settings.options.biome, 'forest');
  assert.equal(composed.data.settings.options.culture, 'medina');
  assert.equal(composed.data.settings.options.population, 300);
  assert.deepEqual(composed.data.settings.local, current.data.settings.local);
  assert.deepEqual(composed.data.settings.appearance, current.data.settings.appearance);
  assert.deepEqual(composed.data.mods, []);
  assert.equal(composed.data.world.stats['v2.persisted'], 1);
  report.checks.terrainComposition = { exactPhysicalHash: sourceHash, currentCityRecipeRetained: true, oldGeometryPurged: true, cached: true };
  await page.screenshot({ path: `${out}/03-terrain-composition.png` });

  await page.locator('#tab-settlements').click();
  report.checks.composedRegionLog = await job('#region-only');
  report.checks.composedTownsLog = await job('#towns-only');
  const rebuilt = await project('04-composed-rebuilt.project.json');
  assert.equal(physicalHash(rebuilt.data.world.terrain), sourceHash);
  assert(rebuilt.data.world.urban.buildings.length > 0);
  assert.equal(rebuilt.data.world.settlements[0].population, 300);
  report.checks.terrainComposition.rebuildValid = true;

  // A recipe without a World can still be transplanted, while its foreign terrain knobs are ignored.
  const foreignRecipe = structuredClone(source.data);
  delete foreignRecipe.world;
  foreignRecipe.mods = [{ type: 'foreign-manual-geometry' }];
  foreignRecipe.settings.options.seed = 'foreign-seed-must-not-replace-territory';
  foreignRecipe.settings.options.biome = 'tundra';
  foreignRecipe.settings.options.relief = 'mountains';
  foreignRecipe.settings.options.population = 120;
  foreignRecipe.settings.local = { main: { sprawl: 1.1 } };
  foreignRecipe.settings.urban = { backend: 'typescript' };
  await importFile(Buffer.from(JSON.stringify(foreignRecipe)), 'urban', 'foreign-city-recipe.json');
  const urbanComposition = await project('05-urban-composition.project.json');
  terrainOnly(urbanComposition.data.world);
  assert.equal(physicalHash(urbanComposition.data.world.terrain), sourceHash);
  assert.equal(urbanComposition.data.settings.options.seed, source.data.world.seed);
  assert.equal(urbanComposition.data.settings.options.biome, 'forest');
  assert.equal(urbanComposition.data.settings.options.relief, 'flat');
  assert.equal(urbanComposition.data.settings.options.population, 120);
  assert.equal(urbanComposition.data.settings.options.culture, foreignRecipe.settings.options.culture);
  assert.deepEqual(urbanComposition.data.settings.local, foreignRecipe.settings.local);
  assert.deepEqual(urbanComposition.data.settings.appearance, current.data.settings.appearance);
  assert.deepEqual(urbanComposition.data.mods, []);
  report.checks.urbanComposition = { territoryRetained: true, foreignTerrainIgnored: true, cityRecipeImported: true, oldGeometryPurged: true };
  report.checks.composedStagedLog = await stagedWorld();
  const final = await project('06-final-world.project.json');
  assert.equal(physicalHash(final.data.world.terrain), sourceHash);
  assert(final.data.world.urban.buildings.length > 0);
  assert.equal(final.data.world.settlements[0].population, 120);
  report.checks.urbanComposition.stagedRebuildValid = true;
  await page.screenshot({ path: `${out}/06-composed-world.png` });

  await page.locator('#map-style').selectOption('parchment');
  await page.locator('.display-menu > summary').click();
  await page.locator('#display-contours').check();
  await page.locator('#display-labels').check();
  await page.locator('.display-menu > summary').click();
  await importFile(final.buffer, 'complete', 'appearance-roundtrip.project.json');
  assert.equal(await page.locator('#map-style').inputValue(), 'atlas');
  assert.equal(await page.locator('#display-contours').isChecked(), false);
  assert.equal(await page.locator('#display-labels').isChecked(), false);
  report.checks.appearance = { style: 'atlas', contours: false, labels: false, roundTrip: true };

  const seedBuffer = await exportFile('seed', '07-minimal-seed.json');
  const seed = JSON.parse(seedBuffer);
  assert.deepEqual(Object.keys(seed).sort(), ['format', 'seed', 'version']);
  assert.equal(seed.format, 'magna-urbis-v2-seed');
  assert.equal(seed.seed, source.data.world.seed);
  await importFile(seedBuffer, 'complete', 'minimal-seed.json');
  await page.locator('#tab-terrain').click();
  assert.equal(await page.locator('#seed').inputValue(), seed.seed);
  assert.equal(await page.locator('#empty-map').isVisible(), true);
  assert.equal(await page.locator('#map-style').inputValue(), 'parchment');
  report.checks.seedTerrainLog = await job('#terrain-only');
  const seedWorld = await project('08-seed-rebuilt.project.json');
  assert.equal(seedWorld.data.world.seed, seed.seed);
  report.checks.minimalSeed = { bytes: seedBuffer.length, onlySeedAndFormat: true, importResetsRecipe: true, terrainGenerationValid: true };

  assert.deepEqual(report.errors, [], 'Browser errors');
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.stack;
  process.exitCode = 1;
  if (page) {
    await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
    report.log = await page.locator('#job-log').textContent().catch(() => '');
    report.toast = await page.locator('#toast').textContent().catch(() => '');
  }
} finally {
  await browser?.close();
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
