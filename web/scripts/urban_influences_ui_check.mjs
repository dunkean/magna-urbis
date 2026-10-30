// From web/: node scripts/urban_composition_ui_check.mjs [Urban Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/urbanbench.html');
const terrainCase = process.argv.includes('--terrain');
const alignedCase = process.argv.includes('--aligned');
const out = terrainCase ? 'out/urban-influences-terrain' : alignedCase ? 'out/urban-influences-aligned' : 'out/urban-influences'; mkdirSync(out, { recursive: true });
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
  const bytes = await page.evaluate(async ({ moduleUrl, terrainCase, alignedCase }) => {
    const { encodeDecor } = await import(moduleUrl);
    const n = 64, width = 1600, size = n * n;
    const center = { x: 800, y: 800 };
    const paths = [[{ x: 100, y: 800 }, { x: 1500, y: 800 }], [{ x: 800, y: 100 }, center]];
    if (alignedCase) {
      const a = 27 * Math.PI / 180;
      paths[0] = [-700, 700].map(d => ({ x: 800 + Math.cos(a) * d, y: 800 + Math.sin(a) * d }));
    }
    const segments = paths.map((path, i) => ({ path, class: alignedCase && i ? 'local' : 'main', surface: 'dirt', profile: 'european', width: alignedCase && i ? 2 : 6, a: i, b: i + 1,
      length: i ? 700 : 1400, grade: 0, importance: 1, crossings: [] }));
    const roads = { segments, junctions: [], warnings: [], unreachable: [], routes: 2, lengthByClass: { main: 2100 }, lengthBySurface: { dirt: 2100 }, ms: 0 };
    const meta = { format: 'magna-decor', version: 1, id: 'urban-composition-flat', label: 'Composition · carrefour plat',
      tags: { relief: 'flat', coast: 'inland', roads: 'main', culture: 'european-organic' }, seed: 'large-village-composition', width,
      query: '', created: '2026-10-13T00:00:00Z', settlements: [], roadConfig: null, roads, waterSvg: '',
      stats: { land: 1, minHeight: 20, maxHeight: 20, roadKm: 2.1, riverKm: 0 } };
    const height = new Float32Array(size).fill(20), water = new Uint8Array(size);
    if (terrainCase) {
      meta.roads = null; meta.label = 'Influences · versant et rivière';
      for (let i = 0; i < size; i++) {
        const x = ((i % n) + 0.5) * width / n, y = (Math.floor(i / n) + 0.5) * width / n;
        height[i] = 20 + x * 0.035 + 30 * Math.exp(-((x - 780) ** 2 + (y - 730) ** 2) / 25000);
        if (Math.abs(x - (1010 + 70 * Math.sin(y / 170))) < 25) water[i] = 1;
      }
      const bank = Array.from({ length: 65 }, (_, i) => { const y = i * width / 64; return { x: 1010 + 70 * Math.sin(y / 170), y }; });
      meta.waterSvg = `<path d="M${bank.map(p => `${p.x - 25},${p.y}`).join(' L')} L${bank.slice().reverse().map(p => `${p.x + 25},${p.y}`).join(' L')} Z" fill="#8eb5c2"/>`;
    }
    return Array.from(encodeDecor({ meta, raster: { n, width, height, water,
      waterLevel: new Float32Array(size).fill(20), riverWidth: new Float32Array(size), riverIds: new Int32Array(size).fill(-1) } }));
  }, { moduleUrl: `/@fs/${process.cwd().replaceAll('\\', '/')}/src/ui/decor.ts`, terrainCase, alignedCase });
  const fixture = Buffer.from(bytes); writeFileSync(`${out}/flat.decor`, fixture);
  await page.route('**/decors/urban-composition-flat.decor', route => route.fulfill({ body: fixture, contentType: 'application/octet-stream' }));
  const url = new URL(base.href);
  url.searchParams.set('decor', 'urban-composition-flat');
  url.searchParams.set('city', JSON.stringify({ key: 'regression-town', name: 'Gros village', population: 6000, culture: 'european-organic', center: { x: 800, y: 800 }, radius: 260, site: '', roads: 'decor' }));
  url.searchParams.set('landuse', JSON.stringify({ enabled: false }));
  // This suite exercises the original core/faubourg composer; refactor controls
  // are verified separately by urban_refactor_ui_check.mjs.
  url.searchParams.set('urban', JSON.stringify({ layoutConfig: { scope: 'settlement', footprint: { mechanism: terrainCase ? 'accessibility' : 'planned', family: terrainCase ? 'compact' : 'circle', budget: 'radius' }, fortification: 'none', accessMode: 'adaptive', exitTreatment: 'adaptive', axisAlignment: 'regional', siteAdaptation: 1 } }));
  await page.goto(url.href); await ready();
  await config('mixCulture').selectOption('roman-core');
  await config('mixShare').fill('0.4');
  await config('peripheralRoad').selectOption('full');
  for (const mode of ['phases', 'sectors']) {
    await config('mixMode').selectOption(mode); await apply();
    const layout = await page.evaluate(() => window.urbanLayouts[0]);
    assert.ok(layout.phases.some(p => p.culture === 'roman-core'));
    assert.ok(layout.phases.some(p => p.culture === 'european-organic'));
    if (!terrainCase) assert.ok(layout.streets.some(s => s.role === 'peripheral'));
    const snapshot = await geometry(), replayUrl = page.url();
    await config('mixShare').fill('0.8');
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get('urban')).layoutConfig.mixShare, 0.4);
    await page.goto(replayUrl); await ready();
    assert.equal(await geometry(), snapshot, `${mode} influence must replay exactly`);
    await page.locator('#focusSeed').click();
    await page.screenshot({ path: `${out}/${mode}.png` });
    writeFileSync(`${out}/${mode}.json`, snapshot);
    results.push({ mode, phases: layout.phases.length, streets: layout.streets.length, blocks: layout.blocks.length, peripheral: layout.streets.filter(s => s.role === 'peripheral').length });
  }
  if (alignedCase) {
    const angle = await page.evaluate(() => {
      const l = window.urbanLayouts[0];
      let xx = 0, xy = 0, yy = 0;
      for (const p of l.structure.reserve[0].outer) { const x = p.x - l.center.x, y = p.y - l.center.y; xx += x*x; xy += x*y; yy += y*y; }
      return 0.5 * Math.atan2(2 * xy, xx - yy) * 180 / Math.PI;
    });
    assert.ok(Math.abs(angle - 27) < 2, `Regional axis must orient the foundation: ${angle}`);
  }
  if (terrainCase) {
    const adapted = await page.evaluate(() => JSON.stringify(window.urbanLayouts[0].streets));
    await config('siteAdaptation').fill('0'); await apply();
    assert.notEqual(await page.evaluate(() => JSON.stringify(window.urbanLayouts[0].streets)), adapted, 'Geography must affect actual street geometry');
    await config('siteAdaptation').fill('1'); await apply();
  }
  await config('exitTreatment').selectOption('closed'); await apply();
  assert.ok(await page.evaluate(() => window.urbanLayouts[0].streets.every(s => !['outbound', 'peripheral'].includes(s.role))));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
