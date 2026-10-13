// From web/: node scripts/urban_natural_ui_check.mjs [--baseline]
// Replay the reported hilly site; compare its automatic footprint before/after.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const baseline = process.argv.includes('--baseline');
const out = 'out/urban-natural'; mkdirSync(out, { recursive: true });
const city = { key: 'main', name: 'Main settlement', population: 12000, culture: 'japanese-jokamachi', radius: 0, site: 'main', center: { x: 3481.2714944311665, y: 4569.911631539253 }, roads: 'reroute' };
const footprint = { mechanism: 'auto', family: 'auto', budget: 'population', grossDensity: 0, aspect: 1.4, orientation: 0, nuclei: 3, irregularity: 0.2, anisotropy: 0.65, separation: 1.3, epochs: 3 };
const urban = { enabled: true, parcelEnabled: true, target: 'all', quarterSeed: '', parcelSeed: '',
  layoutConfig: { composition: 'settlement', settlementForm: 'auto', suburbs: 'auto', phases: 0, preset: 'culture', culture: 'russian-kremlin', recipe: 'auto', zone: 'village', density: 1, count: 7, rings: 1, radius: 0, radiusScale: 1, placement: 'center', params: {}, monument: 'none', fortification: 'culture', maxStreetGrade: 0.12, maxLaneGrade: 0.18, maxStairGrade: 0.65, allowStairs: true, footprint, tissue: 'culture', accessMode: 'adaptive', accessDepth: 0, accessBudget: 4, operator: 'culture' },
  parcelConfig: { preset: 'culture', culture: 'site', recipe: 'core', zone: 'core', density: 1, params: {}, operator: 'culture' },
  render: { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false, opacity: 0.8, width: 0.6, palette: 'atlas' } };
const roads = { config: { level: 'rural', surface: 'auto', culture: 'mesoamerican', density: 0.45, gradeWeight: 1, maxGrade: 0, crossingCost: 1, wobble: 1, sharing: 0.7, exits: 2 }, style: { preset: 'surface', width: 1, opacity: 1, curves: true, casing: true, crossings: true }, enabled: true, show: true };
const url = new URL(process.env.URBAN_BENCH_URL ?? 'http://127.0.0.1:5173/urbanbench.html');
for (const [key, value] of Object.entries({ decor: 'd085-hills-coast-E-city', city: JSON.stringify(city), roads: JSON.stringify(roads), urban: JSON.stringify(urban), landuse: JSON.stringify({ seed: '', biome: 'temperate', style: 'atlas', vegetation: 'canopy', painted: false, opacity: 0.65, visible: true, enabled: false }), view: '3461.9,4557.3,0.4945' })) url.searchParams.set(key, value);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
// Freeze this verification page while the development server receives edits.
await page.routeWebSocket('**', () => {});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const Base = window.Worker;
  window.urbanResults = []; window.urbanRequests = [];
  window.Worker = class extends Base {
    constructor(...args) { super(...args); this.addEventListener('message', event => {
      if (event.data.layouts || event.data.partitions || event.data.error) window.urbanResults.push(event.data);
    }); }
    postMessage(message, ...args) {
      if (message.kind === 'quarters' || message.kind === 'parcels') window.urbanRequests.push(structuredClone(message));
      super.postMessage(message, ...args);
    }
  };
});
const ready = () => page.waitForFunction(() => window.urbanResults.some(r => r.error || r.partitions), undefined, { timeout: 180000 });
try {
  await page.goto(url.href); await ready();
  const original = await page.evaluate(() => window.urbanResults);
  writeFileSync(`${out}/${baseline ? 'before' : 'after'}-original.json`, JSON.stringify(original));
  if (baseline && original.some(r => r.error)) {
    assert.ok(original.some(r => /unknown field.*operator/.test(r.error ?? '')));
    delete urban.layoutConfig.operator; url.searchParams.set('urban', JSON.stringify(urban));
    await page.goto(url.href); await ready();
  }
  const results = await page.evaluate(() => window.urbanResults);
  assert.equal(results.filter(r => r.error).length, 0, JSON.stringify(results.filter(r => r.error)));
  assert.equal(new URL(page.url()).searchParams.get('view'), url.searchParams.get('view'), 'Loading the decor must retain the supplied camera');
  const layout = results.find(r => r.layouts)?.layouts[0], partition = results.find(r => r.partitions)?.partitions[0];
  assert.ok(layout?.blocks.length > 0 && partition?.parcels.length > 0);
  const input = await page.evaluate(() => {
    const request = window.urbanRequests.find(r => r.kind === 'quarters');
    return { ...request, raster: Object.fromEntries(Object.entries(request.raster).map(([key, value]) => [key, ArrayBuffer.isView(value) ? Array.from(value) : value])) };
  });
  writeFileSync(`${out}/site-input.json`, JSON.stringify(input));
  writeFileSync(`${out}/${baseline ? 'before' : 'after'}-geometry.json`, JSON.stringify({ layout, partition }));
  const measurement = { mechanism: layout.structure.mechanism, family: layout.structure.family, blocks: layout.blocks.length, parcels: partition.parcels.length, warnings: layout.warnings, metrics: layout.structure.metrics, timings: results.map(r => ({ kind: r.layouts ? 'quarters' : 'parcels', ms: r.ms })), errors };
  if (!baseline) {
    assert.equal(Object.hasOwn(JSON.parse(new URL(page.url()).searchParams.get('urban')).layoutConfig, 'operator'), false);
    assert.equal(layout.structure.mechanism, 'accessibility');
    const replay = page.url();
    await page.goto(replay); await ready();
    assert.equal(await page.evaluate(() => JSON.stringify(window.urbanResults.map(({ layouts, partitions }) => ({ layouts, partitions })))), JSON.stringify(results.map(({ layouts, partitions }) => ({ layouts, partitions }))));
  }
  await page.locator('#focusSeed').click();
  await page.screenshot({ path: `${out}/${baseline ? 'before' : 'after'}.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/${baseline ? 'before' : 'after'}-result.json`, JSON.stringify(measurement, null, 2));
  console.log(JSON.stringify(measurement));
} finally { await browser.close(); }
