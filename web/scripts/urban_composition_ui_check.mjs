// From web/: node scripts/urban_composition_ui_check.mjs [Urban Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/urbanbench.html');
const out = 'out/urban-composition'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const Base = window.Worker;
  window.urbanReplies = 0;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data.layouts) { window.urbanLayouts = event.data.layouts; window.urbanReplies++; }
        if (event.data.partitions) window.urbanPartitions = event.data.partitions;
      });
    }
    postMessage(message, ...args) {
      if (message.kind === 'quarters') window.urbanLayouts = undefined;
      if (message.kind === 'quarters' || message.kind === 'parcels') window.urbanPartitions = undefined;
      super.postMessage(message, ...args);
    }
  };
});
const config = name => page.locator(`#urbanQuarterStage [data-config="${name}"]`);
async function ready(after = 0) {
  await page.waitForFunction(after => window.urbanReplies > after && window.urbanLayouts && window.urbanPartitions
    && document.querySelector('#urbanQuarterStage [data-apply]')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') === 'false', after, { timeout: 120000 });
  await page.locator('#urbanQuarterStage details, #urbanParcelStage details').evaluateAll(items => items.forEach(item => { item.open = true; }));
}
async function apply() {
  const before = await page.evaluate(() => window.urbanReplies);
  await page.locator('#urbanQuarterStage [data-apply]').click(); await ready(before);
}
const geometry = () => page.evaluate(() => JSON.stringify({ layouts: window.urbanLayouts, partitions: window.urbanPartitions }));

try {
  // A frozen flat crossroads isolates settlement composition from terrain quality.
  await page.goto(`${base.origin}/urbanbench.html?city=${encodeURIComponent(JSON.stringify({ removed: true }))}&landuse=${encodeURIComponent(JSON.stringify({ enabled: false }))}`);
  const bytes = await page.evaluate(async moduleUrl => {
    const { encodeDecor } = await import(moduleUrl);
    const n = 64, width = 1600, size = n * n;
    const center = { x: 800, y: 800 };
    const paths = [[{ x: 100, y: 800 }, { x: 1500, y: 800 }], [{ x: 800, y: 100 }, center]];
    const segments = paths.map((path, i) => ({ path, class: 'main', surface: 'dirt', profile: 'european', width: 6, a: i, b: i + 1,
      length: i ? 700 : 1400, grade: 0, importance: 1, crossings: [] }));
    const roads = { segments, junctions: [], warnings: [], unreachable: [], routes: 2, lengthByClass: { main: 2100 }, lengthBySurface: { dirt: 2100 }, ms: 0 };
    const meta = { format: 'magna-decor', version: 1, id: 'urban-composition-flat', label: 'Composition · carrefour plat',
      tags: { relief: 'flat', coast: 'inland', roads: 'main', culture: 'european-organic' }, seed: 'large-village-composition', width,
      query: '', created: '2026-10-13T00:00:00Z', settlements: [], roadConfig: null, roads, waterSvg: '',
      stats: { land: 1, minHeight: 20, maxHeight: 20, roadKm: 2.1, riverKm: 0 } };
    return Array.from(encodeDecor({ meta, raster: { n, width, height: new Float32Array(size).fill(20), water: new Uint8Array(size),
      waterLevel: new Float32Array(size).fill(20), riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1) } }));
  }, `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/decor.ts`);
  const fixture = Buffer.from(bytes); writeFileSync(`${out}/flat.decor`, fixture);
  await page.route('**/decors/urban-composition-flat.decor', route => route.fulfill({ body: fixture, contentType: 'application/octet-stream' }));
  const url = new URL(base.href);
  url.searchParams.set('decor', 'urban-composition-flat');
  url.searchParams.set('city', JSON.stringify({ key: 'regression-town', name: 'Gros village', population: 900, culture: 'european-organic', center: { x: 800, y: 800 }, radius: 260, site: '', roads: 'decor' }));
  url.searchParams.set('landuse', JSON.stringify({ enabled: false }));
  // This suite exercises the original core/faubourg composer; refactor controls
  // are verified separately by urban_refactor_ui_check.mjs.
  url.searchParams.set('urban', JSON.stringify({ layoutConfig: { scope: 'settlement', footprint: { mechanism: 'legacy', budget: 'radius' }, accessMode: 'cultural' } }));
  await page.goto(url.href); await ready();
  assert.equal(await config('scope').inputValue(), 'settlement');
  await config('settlementForm').selectOption('nucleated'); await config('suburbs').selectOption('few'); await apply();
  const village = await page.evaluate(() => window.urbanLayouts[0]);
  assert.equal(village.archetype, 'nucleated-village');
  assert.deepEqual(village.phases.map(p => p.kind), ['village', 'faubourg']);
  assert.ok(village.phases.every(p => p.shapes.length));
  assert.equal(await page.locator('[data-composition] [data-kind="faubourg"]').count(), 1);
  await page.locator('#focusSeed').click();
  await page.locator('#urbanQuarterStage').evaluate(p => p.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${out}/village.png` });
  const snapshot = await geometry(), replayUrl = page.url();
  // Unapplied composition changes must not enter the retained link.
  await config('suburbs').selectOption('none');
  assert.equal(JSON.parse(new URL(page.url()).searchParams.get('urban')).layoutConfig.suburbs, 'few');
  await page.goto(replayUrl); await ready();
  assert.ok(await geometry() === snapshot, 'Full composition and parcels must replay exactly');
  await config('suburbs').selectOption('none'); await apply();
  assert.equal(await page.evaluate(() => window.urbanLayouts[0].phases.length), 1);
  await config('suburbs').selectOption('many'); await config('phases').fill('3');
  const before = await page.evaluate(() => window.urbanReplies);
  await page.locator('#seedPopulation').fill('8000'); await page.locator('#seedPopulation').press('Tab'); await ready(before);
  await config('fortification').selectOption('wall'); await apply();
  const town = await page.evaluate(() => window.urbanLayouts[0]);
  assert.deepEqual(town.phases.map(p => p.kind), ['core', 'ring', 'ring', 'faubourg']);
  assert.ok(town.enclosures.length && town.phases[3].shapes.length);
  await page.locator('#focusSeed').click(); await page.locator('#urbanQuarterStage').evaluate(p => p.scrollIntoView({ block: 'start' })); await page.screenshot({ path: `${out}/town.png` });
  const townSnapshot = await geometry(); await page.goto(page.url()); await ready();
  assert.ok(await geometry() === townSnapshot, 'Town phases and parcels must replay exactly');
  const applied = JSON.parse(new URL(page.url()).searchParams.get('urban'));
  await config('count').fill('8');
  await page.locator('#urbanQuarterStage [data-seed]').fill('unapplied-wall-seed');
  const beforeRemoval = await page.evaluate(() => window.urbanReplies);
  await page.locator('#urbanQuarterStage [data-remove-enclosure]').click(); await ready(beforeRemoval);
  const open = await page.evaluate(() => window.urbanLayouts[0]);
  assert.equal(open.enclosures.length, 0, 'Removal must remove native walls');
  assert.equal(await page.locator('#urbanOverlay [data-enclosure]').count(), 0);
  assert.notEqual(JSON.stringify(open.quarters), JSON.stringify(town.quarters), 'Removing walls must regenerate the open shape');
  const openApplied = JSON.parse(new URL(page.url()).searchParams.get('urban'));
  assert.deepEqual(openApplied.layoutConfig, { ...applied.layoutConfig, fortification: 'none' });
  assert.equal(openApplied.quarterSeed, applied.quarterSeed, 'Removal must retain the applied seed');
  assert.equal(await config('count').inputValue(), '8', 'Other drafts must stay editable');
  const openSnapshot = await geometry();
  await page.screenshot({ path: `${out}/town-open.png` });
  await page.goto(page.url()); await ready();
  assert.ok(await geometry() === openSnapshot, 'Open town must replay exactly');
  // The isolated scene still has its own controls and no settlement phases.
  await config('scope').selectOption('district');
  assert.equal(await config('placement').isVisible(), true);
  await config('placement').selectOption('rectangle'); await apply();
  assert.equal(await page.evaluate(() => window.urbanLayouts[0].phases.length), 0);
  // Older links keep the original single-envelope bench.
  const old = new URL(page.url()), saved = JSON.parse(old.searchParams.get('urban'));
  delete saved.layoutConfig.scope; old.searchParams.set('urban', JSON.stringify(saved));
  await page.goto(old.href); await ready();
  assert.equal(await config('scope').inputValue(), 'district');
  results.push({ village: village.phases.map(p => ({ kind: p.kind, population: p.population, shapes: p.shapes.length })),
    town: town.phases.map(p => ({ kind: p.kind, recipe: p.recipe, shapes: p.shapes.length })), checked: ['complete default', 'village core and faubourgs', 'none/few/many', 'three town phases', 'wall', 'wall removal and open shape', 'removal preserves seed and drafts', 'exact replay', 'unapplied drafts', 'isolated scene', 'old link'] });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ results, errors }));
} finally { await browser.close(); }
