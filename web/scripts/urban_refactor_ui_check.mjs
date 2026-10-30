// From web/: node scripts/urban_refactor_ui_check.mjs [Urban Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/urbanbench.html');
const out = 'out/urban-refactor'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const Base = window.Worker;
  window.urbanReplies = 0; window.urbanRequests = []; window.urbanTimings = [];
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data.layouts) { window.urbanLayouts = event.data.layouts; window.urbanReplies++; }
        if (event.data.partitions) window.urbanPartitions = event.data.partitions;
        if (event.data.layouts || event.data.partitions) window.urbanTimings.push({ kind: event.data.layouts ? 'quarters' : 'parcels', ms: event.data.ms });
      });
    }
    postMessage(message, ...args) {
      if (message.kind === 'quarters' || message.kind === 'parcels') {
        window.urbanRequests.push(message.kind); window.urbanPartitions = undefined;
      }
      if (message.kind === 'quarters') window.urbanLayouts = undefined;
      super.postMessage(message, ...args);
    }
  };
});
const config = name => page.locator(`#urbanQuarterStage [data-config="${name}"]`);
const footprint = name => page.locator(`#urbanQuarterStage [data-footprint="${name}"]`);
async function ready(after = 0) {
  await page.waitForFunction(after => window.urbanReplies > after && window.urbanLayouts && window.urbanPartitions
    && document.querySelector('#urbanQuarterStage [data-apply]')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') === 'false', after, { timeout: 120000 });
  await page.locator('#urbanQuarterStage, #urbanParcelStage').evaluateAll(panels => panels.forEach(p => p.querySelectorAll('details').forEach(d => { d.open = true; })));
}
async function apply() {
  const before = await page.evaluate(() => window.urbanReplies);
  await page.locator('#urbanQuarterStage [data-apply]').click(); await ready(before);
}
const geometry = () => page.evaluate(() => JSON.stringify({ layouts: window.urbanLayouts, partitions: window.urbanPartitions }));
const measurement = () => page.evaluate(() => ({ timings: window.urbanTimings.slice(-2),
  blocks: window.urbanLayouts.reduce((sum, l) => sum + l.blocks.length, 0),
  streets: window.urbanLayouts.reduce((sum, l) => sum + l.streets.length, 0),
  parcels: window.urbanPartitions.reduce((sum, p) => sum + p.parcels.length, 0),
  metrics: window.urbanLayouts[0].structure.metrics }));

try {
  await page.goto(`${base.origin}/urbanbench.html?city=${encodeURIComponent(JSON.stringify({ removed: true }))}`);
  const bytes = await page.evaluate(async moduleUrl => {
    const { encodeDecor } = await import(moduleUrl);
    const n = 64, width = 3200, size = n * n;
    const paths = [[{ x: 100, y: 1600 }, { x: 3100, y: 1600 }], [{ x: 1600, y: 100 }, { x: 1600, y: 3100 }]];
    const segments = paths.map((path, i) => ({ path, class: 'main', surface: 'dirt', profile: 'european', width: 6, a: i * 2, b: i * 2 + 1,
      length: 3000, grade: 0, importance: 1, crossings: [] }));
    const roads = { segments, junctions: [], warnings: [], unreachable: [], routes: 2, lengthByClass: { main: 6000 }, lengthBySurface: { dirt: 6000 }, ms: 0 };
    const meta = { format: 'magna-decor', version: 1, id: 'urban-refactor-flat', label: 'Refonte · carrefour plat',
      tags: { relief: 'flat', coast: 'inland', roads: 'main', culture: 'european-organic' }, seed: 'urban-refactor-replay', width,
      query: '', created: '2026-10-13T00:00:00Z', settlements: [], roadConfig: null, roads, waterSvg: '',
      stats: { land: 1, minHeight: 20, maxHeight: 20, roadKm: 6, riverKm: 0 } };
    return Array.from(encodeDecor({ meta, raster: { n, width, height: new Float32Array(size).fill(20), water: new Uint8Array(size),
      waterLevel: new Float32Array(size).fill(20), riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1) } }));
  }, `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/decor.ts`);
  const fixture = Buffer.from(bytes); writeFileSync(`${out}/flat.decor`, fixture);
  await page.route('**/decors/urban-refactor-flat.decor', route => route.fulfill({ body: fixture, contentType: 'application/octet-stream' }));
  const url = new URL(base.href);
  url.searchParams.set('decor', 'urban-refactor-flat');
  url.searchParams.set('city', JSON.stringify({ key: 'refactor-town', name: 'Ville de test', population: 4000, culture: 'european-organic', center: { x: 1600, y: 1600 }, radius: 400, site: '', roads: 'decor' }));
  url.searchParams.set('landuse', JSON.stringify({ enabled: false }));
  await page.goto(url.href); await ready();
  assert.equal(await footprint('budget').inputValue(), 'population');
  assert.equal(await config('accessMode').inputValue(), 'adaptive');
  assert.equal(await config('suburbs').isVisible(), false, 'Legacy composition controls must stay hidden for modern growth');
  assert.equal(await config('radius').isEnabled(), false, 'Population budget must disable the ignored radius control');
  assert.equal(await footprint('family').locator('option').count(), 13, 'Twelve silhouette families plus automatic choice');

  await footprint('mechanism').selectOption('auto'); await footprint('family').selectOption('rectangle');
  await footprint('grossDensity').fill('160'); await footprint('aspect').fill('2');
  await config('fortification').selectOption('none');
  await config('tissue').selectOption('grid'); await apply();
  const planned = await page.evaluate(() => window.urbanLayouts[0]);
  const population4000 = await measurement();
  assert.equal(planned.structure.mechanism, 'planned');
  assert.equal(planned.structure.family, 'rectangle');
  assert.ok(planned.structure.metrics.targetArea > 0 && planned.structure.metrics.allocatedArea > 0);
  assert.equal(await page.locator('[data-urban-metrics]').count(), 1);

  await footprint('mechanism').selectOption('accessibility'); await footprint('family').selectOption('compact');
  await config('tissue').selectOption('organic'); await apply();
  const accessible = await page.evaluate(() => window.urbanLayouts[0]);
  assert.equal(accessible.structure.mechanism, 'accessibility');
  assert.notEqual(JSON.stringify(accessible.structure.allocated), JSON.stringify(planned.structure.allocated), 'Mechanisms must change native geometry');

  await footprint('mechanism').selectOption('fusion'); await footprint('family').selectOption('archipelago');
  await footprint('nuclei').fill('3'); await footprint('separation').fill('2.5'); await footprint('epochs').fill('3');
  await footprint('grossDensity').fill('100'); await apply();
  const fusion = await page.evaluate(() => window.urbanLayouts[0]);
  assert.equal(fusion.structure.mechanism, 'fusion');
  assert.equal(fusion.structure.centers.length, 3);
  assert.ok(fusion.structure.allocated.length > 1, 'Disconnected footprint must retain its components');
  assert.ok(fusion.structure.history.length > 1, 'Growth history must retain several events');
  assert.ok(fusion.structure.districts.length);

  // Diagnostic layers redraw the retained native plan without generation.
  await page.locator('[data-render="reserve"]').evaluate(input => { input.closest('details').open = true; });
  const requests = await page.evaluate(() => window.urbanRequests.length);
  for (const key of ['reserve', 'allocated', 'centers', 'access']) await page.locator(`[data-render="${key}"]`).check();
  assert.equal(await page.evaluate(() => window.urbanRequests.length), requests);
  assert.ok(await page.locator('[data-urban-surface="reserve"]').count());
  assert.ok(await page.locator('[data-urban-surface="allocated"]').count());
  assert.equal(await page.locator('[data-urban-center]').count(), 3);
  assert.ok(await page.locator('[data-urban-district]').count());
  assert.ok(await page.locator('[data-urban-district]').evaluateAll(labels => labels.every(label => Number.isFinite(Number(label.getAttribute('x'))) && Number.isFinite(Number(label.getAttribute('y'))))));
  assert.ok(await page.locator('[data-parcel-access]').count());
  assert.ok(await page.locator('[data-parcel-metrics]').count());

  // Parcel-stage operator changes retain streets, blocks and the complete layout.
  const retainedLayout = await page.evaluate(() => JSON.stringify(window.urbanLayouts));
  const layoutRequests = await page.evaluate(() => window.urbanRequests.filter(k => k === 'quarters').length);
  await page.locator('#urbanParcelStage [data-config="operator"]').selectOption('frontage');
  await page.locator('#urbanParcelStage [data-apply]').click();
  await page.waitForFunction(() => window.urbanPartitions && document.querySelector('#urbanParcelStage [data-apply]').getAttribute('aria-busy') === 'false');
  assert.equal(await page.evaluate(() => JSON.stringify(window.urbanLayouts)), retainedLayout);
  assert.equal(await page.evaluate(() => window.urbanRequests.filter(k => k === 'quarters').length), layoutRequests);
  assert.ok(await page.evaluate(() => window.urbanPartitions.every(p => p.parcels.every(parcel => parcel.access))));
  assert.equal(JSON.parse(new URL(page.url()).searchParams.get('urban')).parcelConfig.operator, 'frontage');

  const snapshot = await geometry(), replayUrl = page.url();
  writeFileSync(`${out}/replay.txt`, replayUrl);
  await footprint('nuclei').fill('6'); await footprint('family').selectOption('lobed');
  await page.locator('[data-render="axes"]').check();
  const retained = JSON.parse(new URL(page.url()).searchParams.get('urban'));
  assert.equal(retained.layoutConfig.footprint.nuclei, 3);
  assert.equal(retained.layoutConfig.footprint.family, 'archipelago');
  await page.goto(replayUrl); await ready();
  assert.equal(await geometry(), snapshot, 'Complete refactored city and parcels must replay exactly');
  await page.locator('#focusSeed').click(); await page.screenshot({ path: `${out}/fusion.png` });

  // A larger scene uses the same frozen site, planned/grid recipe and density.
  await footprint('mechanism').selectOption('auto'); await footprint('family').selectOption('rectangle');
  await footprint('grossDensity').fill('160'); await config('tissue').selectOption('grid');
  await page.locator('#urbanParcelStage [data-config="operator"]').selectOption('culture');
  await page.locator('#urbanParcelStage [data-apply]').click();
  await page.waitForFunction(() => window.urbanPartitions && document.querySelector('#urbanParcelStage [data-apply]').getAttribute('aria-busy') === 'false');
  await apply();
  const beforeLarge = await page.evaluate(() => window.urbanReplies);
  await page.locator('#seedPopulation').fill('30000'); await page.locator('#seedPopulation').press('Tab'); await ready(beforeLarge);
  const population30000 = await measurement();
  assert.equal(population30000.metrics.plannedPopulation, 30000);
  assert.ok(population30000.timings.every(t => Number.isFinite(t.ms) && t.ms < 120000));
  await page.locator('#focusSeed').click(); await page.screenshot({ path: `${out}/population-30000.png` });

  const oldUrl = new URL(page.url()), old = JSON.parse(oldUrl.searchParams.get('urban'));
  delete old.layoutConfig.footprint; delete old.layoutConfig.accessMode; oldUrl.searchParams.set('urban', JSON.stringify(old));
  await page.goto(oldUrl.href); await ready();
  assert.equal(await footprint('mechanism').inputValue(), 'legacy');
  assert.equal(await footprint('budget').inputValue(), 'radius');
  assert.equal(await config('accessMode').inputValue(), 'cultural');
  assert.equal(await config('suburbs').isVisible(), true);
  assert.equal(await config('radius').isEnabled(), true);
  const workshopDraft = await page.evaluate(async moduleUrl => {
    const { createTerrainUrban } = await import(moduleUrl);
    const map = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); document.body.append(map);
    const before = new Set(document.querySelectorAll('.urban-stage'));
    const sandbox = createTerrainUrban({ map, before: null, getTerrain: () => undefined, getSeed: () => 'workshop-shared', onChange: () => {} });
    const state = sandbox.workshopState();
    sandbox.applyWorkshop({ layoutConfig: { ...state.layoutConfig, scope: 'settlement', footprint: { ...state.layoutConfig.footprint, mechanism: 'planned', family: 'rectangle' }, params: { fieldNoise: 0.4 } },
      parcelConfig: { ...state.parcelConfig, params: { plotTilt: 0.2 } }, quarterSeed: 'workshop-shared' });
    const panels = [...document.querySelectorAll('.urban-stage')].filter(p => !before.has(p));
    const family = panels[0].querySelector('[data-footprint="family"]'); family.value = 'fan'; family.dispatchEvent(new Event('change'));
    const noise = panels[0].querySelector('[data-fields] label[title="fieldNoise"] input'); noise.value = '0.75'; noise.dispatchEvent(new Event('change'));
    const tilt = panels[1].querySelector('[data-fields] label[title="plotTilt"] input'); tilt.value = '0.9'; tilt.dispatchEvent(new Event('change'));
    const params = new URLSearchParams(); sandbox.share(params);
    panels.forEach(p => p.remove()); map.remove();
    return JSON.parse(params.get('urban'));
  }, `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/terrainUrban.ts`);
  assert.equal(workshopDraft.layoutConfig.footprint.family, 'rectangle', 'Workshop imports must retain a separate applied footprint');
  assert.equal(workshopDraft.layoutConfig.params.fieldNoise, 0.4, 'Nested layout drafts must not mutate shared applied parameters');
  assert.equal(workshopDraft.parcelConfig.params.plotTilt, 0.2, 'Nested parcel drafts must not mutate shared applied parameters');
  results.push({ planned: planned.structure.metrics, accessible: accessible.structure.metrics, fusion: fusion.structure.metrics,
    population4000, population30000,
    checked: ['native mechanisms', 'twelve families', 'population budget', 'multi nuclei and components', 'history', 'diagnostic layers do not regenerate', 'parcel-stage isolation', 'operator', 'native access metadata', 'unapplied nested drafts', 'workshop applied snapshots remain isolated from nested drafts', 'exact replay', 'legacy links', 'actual WASM measurements for populations 4000 and 30000'] });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ results, errors }));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  console.error(await page.locator('[data-status], [data-warnings]').allTextContents());
  throw error;
} finally { await browser.close(); }
