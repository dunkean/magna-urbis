// From web/: node scripts/terrain_urban_parity_ui_check.mjs [Terrain Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const terrainUrl = new URL(process.argv[2] ?? 'http://localhost:5173/terrainbench.html?v=4&seed=42&width=40000&source=neural&relief=valley&coasts=N&climate=mediterranean&style=render&auto=0');
if (!terrainUrl.searchParams.has('settlements')) terrainUrl.searchParams.set('settlements', JSON.stringify({ config: { mode: 'counts', main: { key: 'main', population: 3000, culture: 'european-organic', sitePrefs: {} }, counts: { village: 2, hamlet: 2, farmstead: 2 } } }));
if (!terrainUrl.searchParams.has('urban')) terrainUrl.searchParams.set('urban', JSON.stringify({ target: 'main', quarterSeed: 'shared-quarter-seed', parcelSeed: 'shared-parcel-seed', layoutConfig: { composition: 'settlement', culture: 'european-organic', preset: 'culture', recipe: 'auto', zone: 'auto', count: 3, fortification: 'none', tissue: 'organic', footprint: { mechanism: 'auto', family: 'compact', budget: 'population' } } }));
terrainUrl.searchParams.set('pipeline', 'legacy');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function instrument(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const Base = window.Worker;
    window.Worker = class extends Base {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (event.data.layouts) window.urbanLayouts = event.data.layouts;
          if (event.data.partitions) window.urbanPartitions = event.data.partitions;
        });
      }
      postMessage(message, ...args) {
        if (message.kind === 'quarters') {
          const request = structuredClone(message);
          if (request.raster) window.urbanRaster = request.raster;
          window.urbanInput = { ...request, raster: window.urbanRaster };
          window.urbanLayouts = undefined; window.urbanPartitions = undefined;
        }
        if (message.kind === 'parcels') window.urbanPartitions = undefined;
        if (message.roads && !Array.isArray(message.roads)) window.urbanRoutingInput = structuredClone(message.roads);
        super.postMessage(message, ...args);
      }
    };
  });
}
async function ready(page) {
  await page.waitForFunction(() => window.urbanLayouts && window.urbanPartitions
    && document.querySelector('#urbanQuarterStage [data-apply]').getAttribute('aria-busy') === 'false'
    && document.querySelector('#urbanParcelStage [data-apply]').getAttribute('aria-busy') === 'false', null, { timeout: 120000 });
}
async function fingerprint(page) {
  return page.evaluate(async () => {
    const hash = async value => {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
    };
    const q = window.urbanInput, r = q.raster;
    return {
      seed: q.seed, sites: q.sites, roads: await hash(JSON.stringify(q.roads)), config: q.layoutConfig,
      raster: { n: r.n, width: r.width, fields: await Promise.all([r.height, r.water, r.waterLevel, r.riverWidth, r.riverIds].map(hash)), geometry: await hash(JSON.stringify(r.geometry)) },
      layouts: await hash(JSON.stringify(window.urbanLayouts)), parcels: await hash(JSON.stringify(window.urbanPartitions)),
    };
  });
}
const output = 'out/terrain-urban-parity'; mkdirSync(output, { recursive: true });
try {
  const terrain = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); await instrument(terrain);
  await terrain.goto(terrainUrl.href); await ready(terrain);
  await terrain.waitForFunction(() => window.magnaDecor.ready());
  const capture = await terrain.evaluate(() => window.magnaDecor.export('parity.decor', { id: 'terrain-urban-parity', label: 'Même ville · Terrain/Urban' }));
  const bytes = Buffer.from(capture.base64, 'base64'); writeFileSync(`${output}/parity.decor`, bytes);
  const before = await fingerprint(terrain);
  const urban = await browser.newPage({ viewport: { width: 1500, height: 1000 } }); await instrument(urban);
  await urban.route('**/decors/terrain-urban-parity.decor', route => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  const url = new URL('/urbanbench.html', terrainUrl);
  url.searchParams.set('decor', 'terrain-urban-parity'); url.searchParams.set('landuse', JSON.stringify({ enabled: false }));
  await urban.goto(url.href); await ready(urban);
  const after = await fingerprint(urban);
  writeFileSync(`${output}/requests.json`, JSON.stringify({ terrain: before, urban: after }, null, 2));
  assert.deepEqual(after.config, before.config, 'Opening the exported decor must retain the applied urban configuration');
  assert.deepEqual(after.sites, before.sites, 'The selected city must retain its key, population, culture, centre and radius');
  assert.equal(after.seed, before.seed); assert.equal(after.roads, before.roads); assert.deepEqual(after.raster, before.raster);
  assert.equal(after.layouts, before.layouts, 'Same native inputs must produce identical quarters and streets');
  assert.equal(after.parcels, before.parcels, 'Same native inputs must produce identical parcels');
  await terrain.locator('#urbanTarget').selectOption('village:0'); await ready(terrain);
  const selectedCapture = await terrain.evaluate(() => window.magnaDecor.export('selected.decor', { id: 'terrain-urban-selected', label: 'Ville sélectionnée' }));
  const selectedBytes = Buffer.from(selectedCapture.base64, 'base64');
  await urban.route('**/decors/terrain-urban-selected.decor', route => route.fulfill({ body: selectedBytes, contentType: 'application/octet-stream' }));
  const selectedUrl = new URL(url); selectedUrl.searchParams.set('decor', 'terrain-urban-selected');
  await urban.goto(selectedUrl.href); await ready(urban);
  const selectedBefore = await fingerprint(terrain), selectedAfter = await fingerprint(urban);
  assert.deepEqual(selectedAfter, selectedBefore, 'The exported selection and both stage seeds must also replay identically');
  const override = await urban.evaluate(() => JSON.parse(new URL(location.href).searchParams.get('urban')));
  override.layoutConfig.tissue = 'grid'; selectedUrl.searchParams.set('urban', JSON.stringify(override));
  const routeOverride = await urban.evaluate(() => JSON.parse(new URL(location.href).searchParams.get('roads')));
  routeOverride.config = { ...routeOverride.config, density: 0, exits: 0, gradeWeight: 2 };
  selectedUrl.searchParams.set('roads', JSON.stringify(routeOverride));
  const editedCity = await urban.evaluate(() => JSON.parse(new URL(location.href).searchParams.get('city')));
  editedCity.roads = 'reroute'; selectedUrl.searchParams.set('city', JSON.stringify(editedCity));
  await urban.goto(selectedUrl.href); await ready(urban);
  assert.equal((await fingerprint(urban)).config.tissue, 'grid', 'Explicit Urban Bench links take precedence over the decor');
  assert.deepEqual(await urban.evaluate(() => window.urbanRoutingInput), routeOverride.config, 'Explicit road settings must reach the native router instead of being overwritten by the decor');
  const popupPromise = urban.waitForEvent('popup'); await urban.locator('#openTerrain').click();
  const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
  const returned = JSON.parse(new URL(popup.url()).searchParams.get('urban'));
  assert.equal(returned.layoutConfig.tissue, 'grid'); assert.equal(returned.target, 'village:0');
  assert.deepEqual(JSON.parse(new URL(popup.url()).searchParams.get('roads')), routeOverride, 'Opening Terrain must carry the current road settings and style');
  await popup.close();
  await urban.locator('#seedRoads').selectOption('none'); await ready(urban);
  const noRoadsPopupPromise = urban.waitForEvent('popup'); await urban.locator('#openTerrain').click();
  const noRoadsPopup = await noRoadsPopupPromise; await noRoadsPopup.waitForLoadState('domcontentloaded');
  assert.equal(JSON.parse(new URL(noRoadsPopup.url()).searchParams.get('roads')).enabled, false, 'Removed regional roads must remain disabled when opening Terrain');
  await noRoadsPopup.close();
  // Catalogue exports intentionally disable urban stages while capturing terrain.
  const disabledBytes = await urban.evaluate(async ({ moduleUrl, bytes }) => {
    const { decodeDecor, encodeDecor } = await import(moduleUrl);
    const decor = decodeDecor(Uint8Array.from(bytes)); decor.meta.id = 'terrain-urban-catalogue';
    const source = new URLSearchParams(decor.meta.query); source.set('urban', JSON.stringify({ enabled: false, parcelEnabled: false })); decor.meta.query = source.toString();
    return Array.from(encodeDecor(decor));
  }, { moduleUrl: `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/decor.ts`, bytes: Array.from(bytes) });
  await urban.route('**/decors/terrain-urban-catalogue.decor', route => route.fulfill({ body: Buffer.from(disabledBytes), contentType: 'application/octet-stream' }));
  const catalogueUrl = new URL(url); catalogueUrl.searchParams.set('decor', 'terrain-urban-catalogue');
  await urban.goto(catalogueUrl.href); await ready(urban);
  assert(await urban.locator('#urbanQuarterStage [data-enabled]').isChecked());
  assert(await urban.locator('#urbanParcelStage [data-enabled]').isChecked());
  // Retain matching selected-city captures for visual inspection.
  await urban.goto(new URL('/urbanbench.html?decor=terrain-urban-selected&landuse=' + encodeURIComponent(JSON.stringify({ enabled: false })), terrainUrl).href); await ready(urban);
  await terrain.locator('#urbanFocus').click(); await urban.locator('#focusSeed').click();
  await terrain.screenshot({ path: `${output}/terrain.png` }); await urban.screenshot({ path: `${output}/urban.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sameNativeInputs: true, identicalLayouts: true, identicalParcels: true, importedConfiguration: true, selectedCityAndSeeds: true, explicitLinkPriority: true, explicitRoadPriority: true, returnedConfiguration: true, returnedRoads: true, catalogueGeneration: true, errors }));
} finally { await browser.close(); }
