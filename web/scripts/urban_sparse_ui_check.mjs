// From web/: node scripts/urban_sparse_ui_check.mjs [Urban Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/urbanbench.html');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', () => {});
await page.addInitScript(() => {
  const Base = window.Worker;
  window.sparseReplies = 0;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data }) => {
        if (data.layouts) { window.sparseLayouts = data.layouts; window.sparseReplies++; }
        if (data.partitions) window.sparsePartitions = data.partitions;
        if (data.error) window.sparseError = data.error;
      });
    }
  };
});
const control = name => page.locator(`#urbanQuarterStage [data-footprint="${name}"]`);
async function ready(after = 0) {
  await page.waitForFunction(after => window.sparseError || window.sparseReplies > after && window.sparseLayouts && window.sparsePartitions
    && document.querySelector('#urbanQuarterStage [data-apply]')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') === 'false', after, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.sparseError), undefined);
  await page.locator('#urbanQuarterStage details').evaluateAll(elements => elements.forEach(e => { e.open = true; }));
}
try {
  await page.goto(`${base.origin}/urbanbench.html?city=${encodeURIComponent(JSON.stringify({ removed: true }))}`);
  const bytes = await page.evaluate(async moduleUrl => {
    const { encodeDecor } = await import(moduleUrl);
    const n = 96, width = 3000, size = n * n;
    const height = Float32Array.from({ length: size }, (_, i) => 100 + 0.0008 * ((Math.floor(i / n) + 0.5) * width / n - 1500) ** 2);
    const meta = { format: 'magna-decor', version: 1, id: 'sparse-valley', label: 'Croissance en vallée', tags: { relief: 'mountains', coast: 'inland', roads: 'none', culture: 'european-organic' },
      seed: 'sparse-ui-2026-10-20', width, query: '', created: '2026-10-20T00:00:00Z', settlements: [], roadConfig: null, roads: null, waterSvg: '',
      stats: { land: 1, minHeight: 100, maxHeight: 1900, roadKm: 0, riverKm: 0 } };
    return Array.from(encodeDecor({ meta, raster: { n, width, height, water: new Uint8Array(size), waterLevel: new Float32Array(size), riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1) } }));
  }, `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/decor.ts`);
  await page.route('**/decors/sparse-valley.decor', route => route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' }));
  const url = new URL(base.href);
  url.searchParams.set('decor', 'sparse-valley');
  url.searchParams.set('city', JSON.stringify({ key: 'sparse-city', name: 'Vallée', population: 1200, culture: 'european-organic', center: { x: 1500, y: 1500 }, radius: 300, site: '', roads: 'decor' }));
  url.searchParams.set('landuse', JSON.stringify({ enabled: false }));
  url.searchParams.set('urban', JSON.stringify({ enabled: true, parcelEnabled: true, target: 'sparse-city', layoutConfig: { composition: 'settlement', fortification: 'none',
    footprint: { family: 'dendritic', grossDensity: 70, cohesion: 0.85, satellites: 0.15, branchDepth: 0.2, gapSize: 60 } }, render: { allocated: true } }));
  await page.goto(url.href); await ready();
  for (const [key, value] of Object.entries({ cohesion: 0.85, satellites: 0.15, branchDepth: 0.2, gapSize: 60 })) {
    assert.equal(Number(await control(key).inputValue()), value);
    assert.ok(await control(key).isEnabled());
  }
  const initial = await page.evaluate(() => JSON.stringify(window.sparseLayouts));
  for (const [key, value] of Object.entries({ cohesion: 0.6, satellites: 0.5, branchDepth: 0.6, gapSize: 100 })) {
    await control(key).fill(String(value)); await control(key).press('Tab');
  }
  assert.equal(JSON.parse(new URL(page.url()).searchParams.get('urban')).layoutConfig.footprint.cohesion, 0.85, 'Drafts must not leak into shared state');
  const before = await page.evaluate(() => window.sparseReplies);
  await page.locator('#urbanQuarterStage [data-apply]').click(); await ready(before);
  const snapshot = await page.evaluate(() => JSON.stringify({ layouts: window.sparseLayouts, partitions: window.sparsePartitions }));
  assert.notEqual(await page.evaluate(() => JSON.stringify(window.sparseLayouts)), initial);
  const replay = page.url(), saved = JSON.parse(new URL(replay).searchParams.get('urban')).layoutConfig.footprint;
  for (const [key, value] of Object.entries({ cohesion: 0.6, satellites: 0.5, branchDepth: 0.6, gapSize: 100 })) assert.equal(saved[key], value);
  assert.ok(await page.locator('[data-urban-surface="allocated"]').count());
  await page.goto(replay); await ready();
  assert.equal(await page.evaluate(() => JSON.stringify({ layouts: window.sparseLayouts, partitions: window.sparsePartitions })), snapshot, 'Applied geometry and parcels must replay exactly');
  const layouts = await page.evaluate(() => JSON.stringify(window.sparseLayouts));
  await page.locator('#urbanParcelStage [data-apply]').click();
  await page.waitForFunction(() => document.querySelector('#urbanParcelStage [data-apply]').getAttribute('aria-busy') === 'false');
  assert.equal(await page.evaluate(() => JSON.stringify(window.sparseLayouts)), layouts, 'Parcel regeneration must retain the footprint and gap access');
  await control('family').selectOption('rectangle');
  assert.equal(await control('cohesion').isEnabled(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'ok', settings: saved, metrics: await page.evaluate(() => window.sparseLayouts[0].structure.metrics), pageErrors: errors }));
} finally {
  await browser.close();
}
