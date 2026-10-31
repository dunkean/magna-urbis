/** Real workers: separate placement, batch urban stops, subset preservation and bilingual scope UI. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const web = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(web, 'out/city-pipeline');
await mkdir(out, { recursive: true });
const server = await createServer({ configFile: resolve(web, 'vite.v2.config.ts'), logLevel: 'warn', server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-proxy-server'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/v2.html?empty&lang=fr&threads=off`);
  await page.locator('#expert-open').click();
  const settings = JSON.parse(await page.locator('#expert-json').inputValue());
  settings.generation = 'procedural'; settings.extent = 4000; settings.settlementCount = 3;
  settings.runtime = { backend: 'typescript', source: 'procedural', compute: 'cpu' };
  settings.terrain = undefined;
  settings.urban = { backend: 'rust', through: 'layout' };
  Object.assign(settings.options, { seed: 'city-pipeline-ui', population: 80, size: 'hamlet', relief: 'flat', coast: 'none', river: 'none', walls: 'none', castle: 'no', workflow: 'list',
    settlements: { list: [{ key: 'main', population: 80, position: { x: 2000, y: 2000 } }, { key: 'east', population: 80, position: { x: 3300, y: 2000 } }, { key: 'west', population: 80, position: { x: 700, y: 2000 } }] } });
  await page.locator('#expert-json').fill(JSON.stringify(settings));
  await page.locator('#expert-apply').click();
  assert.equal(await page.locator('#expert-error').textContent(), '');
  const job = async selector => {
    const before = await page.locator('#job-log').textContent();
    await page.locator(selector).click();
    await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
    const log = (await page.locator('#job-log').textContent()).slice(before.length);
    assert(!log.includes('Échec'), log);
    assert.match(await page.locator('#footer-status').textContent(), /Carte prête/);
  };
  const project = async label => {
    await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('project');
    const pending = page.waitForEvent('download'); await page.locator('#export-go').click();
    const download = await pending, path = resolve(out, `${label}.json`);
    await download.saveAs(path); await page.locator('#export-dialog').waitFor({ state: 'hidden' });
    return JSON.parse(await readFile(path, 'utf8'));
  };
  assert.deepEqual(await page.locator('.chain-family-tab').evaluateAll(tabs => tabs.map(tab => tab.id)), ['family-tab-region', 'family-tab-settlements', 'family-tab-cities', 'family-tab-map']);
  await job('#generate-region');
  await page.locator('#family-tab-settlements').click();
  assert.equal(await page.locator('#family-settlements .stage-row').count(), 3);
  await job('#family-settlements .family-run');
  let data = await project('01-placed');
  assert.equal(data.world.settlements.length, 3);
  assert(!data.world.urban); assert(data.world.settlements.every(place => !place.urban));
  const terrain = JSON.stringify(data.world.terrain.height), roads = JSON.stringify(data.world.roads);
  await page.locator('#family-tab-cities').click();
  assert.match(await page.locator('#city-scope-count').textContent(), /3 \/ 3 villes/);
  await job('#family-cities .family-run');
  data = await project('02-all-layout');
  assert(Object.values(data.world.debug.v2RustCities).every(city => city.stage === 'layout'));
  assert(data.world.settlements.every(place => place.urban.quarters.length > 0 && place.urban.parcels.length === 0));
  assert.equal(await page.locator('#row-city-quarters').getAttribute('data-led'), 'valid');
  assert.equal(await page.locator('#row-city-parcels').getAttribute('data-led'), 'pending');
  const west = JSON.stringify(data.world.settlements.find(place => place.key === 'west').urban);
  const westNative = JSON.stringify(data.world.debug.v2RustCities.west);
  await page.locator('[data-city-select="main"]').check(); await page.locator('[data-city-select="east"]').check();
  assert.equal(await page.locator('#city-scope').inputValue(), 'selection');
  assert.match(await page.locator('#city-scope-count').textContent(), /2 \/ 3 villes/);
  await job('#row-city-parcels .stage-run');
  data = await project('03-subset-parcels');
  assert.equal(data.world.debug.v2RustCities.main.stage, 'parcels'); assert.equal(data.world.debug.v2RustCities.east.stage, 'parcels');
  assert.equal(JSON.stringify(data.world.settlements.find(place => place.key === 'west').urban), west);
  assert.equal(JSON.stringify(data.world.debug.v2RustCities.west), westNative);
  assert.equal(JSON.stringify(data.world.terrain.height), terrain); assert.equal(JSON.stringify(data.world.roads), roads);
  assert.equal(await page.locator('#row-city-parcels').getAttribute('data-led'), 'valid');
  await job('#row-city-houses .stage-run');
  data = await project('04-subset-houses');
  for (const key of ['main', 'east']) {
    assert.equal(data.world.debug.v2RustCities[key].stage, 'buildings');
    assert(data.world.debug.v2RustCities[key].scene.buildings.length > 0);
  }
  assert.equal(JSON.stringify(data.world.settlements.find(place => place.key === 'west').urban), west);
  assert.equal(await page.locator('#row-city-houses').getAttribute('data-led'), 'valid');
  // An earlier stop clears the displayed downstream result for this subset only.
  await job('#row-city-parcels .stage-run');
  data = await project('05-subset-back-to-parcels');
  assert(data.world.settlements.filter(place => ['main', 'east'].includes(place.key)).every(place => place.urban.buildings.length === 0));
  assert.equal(JSON.stringify(data.world.debug.v2RustCities.west), westNative);
  assert.equal(await page.locator('#row-city-houses').getAttribute('data-led'), 'pending');
  assert.match(await page.locator('[data-town="main"] .settlement-stage').textContent(), /parcelles/);
  assert.match(await page.locator('[data-town="west"] .settlement-stage').textContent(), /routes et quartiers/);
  await page.locator('#row-city-composition').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, 'cities-fr.png'), fullPage: true });
  await page.locator('#language-select').selectOption('en');
  assert.match(await page.locator('#city-scope-count').textContent(), /2 \/ 3 cities/);
  assert.match(await page.locator('#family-tab-cities').textContent(), /Cities/);
  await page.locator('#cities-select-none').click();
  assert(await page.locator('#family-cities .family-run').isDisabled());
  assert(await page.locator('#row-city-parcels .stage-run').isDisabled());
  assert(await page.locator('#towns-only').isDisabled());
  await page.locator('#city-scope').selectOption('all');
  assert(await page.locator('#family-cities .family-run').isEnabled());
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ separatePlacement: true, allCitiesLayout: true, selectedCitiesParcels: true, selectedCitiesHouses: true, earlierStop: true, untouchedNeighbours: true, retainedTerrainAndRegionalRoads: true, bilingual: true, emptySelectionBlocked: true, errors }, null, 2));
  console.log('Cities pipeline UI: separate placement, all/subset stages, preserved neighbours, bilingual scope and empty selection passed.');
} finally { await browser.close(); await server.close(); }
