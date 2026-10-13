// From web/: node scripts/urban_composition_ui_check.mjs [Urban Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/urbanbench.html');
const terrainCase = process.argv.includes('--terrain');
const alignedCase = process.argv.includes('--aligned');
const out = 'out/urban-junctions'; mkdirSync(out, { recursive: true });
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
      if (message.kind === 'quarters') { window.urbanLayouts = undefined; window.urbanRequest = structuredClone(message); }
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
  const url = new URL(base);
  const city = { key: 'village:2', name: 'village:2', population: 454, culture: 'swahili-stone-town', radius: 0, site: 'village:2', center: { x: 435.9716407451924, y: 974.7625063269516 }, roads: 'decor' };
  url.searchParams.set('decor', 'd000-flat-coast-N-hamlet');
  url.searchParams.set('city', JSON.stringify(city));
  url.searchParams.set('view', '467.8,993.8,1.427');
  url.searchParams.set('urban', JSON.stringify({ enabled: true, parcelEnabled: true, target: city.key, layoutConfig: { axisAlignment: 'regional', composition: 'settlement', preset: 'culture', recipe: 'auto', culture: 'site', fortification: 'none', exitTreatment: 'adaptive', peripheralRoad: 'auto', siteAdaptation: 1, tissue: 'culture', accessMode: 'adaptive', footprint: { mechanism: 'ribbon', family: 'lobed', budget: 'population', grossDensity: 0, aspect: 1.4, orientation: 0, nuclei: 3, irregularity: 0.2, anisotropy: 0.65, separation: 1.3, epochs: 3 } }, render: { reserve: false, allocated: false, centers: false, domains: true, quarters: false, blocks: true, streets: true, enclosures: true, parcels: true, gardens: true, places: true, fronts: false, axes: false, access: false, opacity: 0.8, width: 0.6, palette: 'growth' } }));
  url.searchParams.set('landuse', JSON.stringify({ enabled: false }));
  await page.goto(url.href); await ready();
  await page.locator('#urbanQuarterStage').evaluate(p => { p.scrollIntoView({ block: 'start' }); p.querySelectorAll('details').forEach(d => d.open = false); });
  const button = await page.locator('#urbanQuarterStage [data-apply]').boundingBox();
  const family = await page.locator('#urbanQuarterStage [data-footprint="family"]').boundingBox();
  assert.ok(button && family && button.y < family.y && button.y < 720, 'Regenerate must be above the main controls');
  assert.equal(await config('tissue').isVisible(), true);
  assert.equal(await config('accessMode').isVisible(), true);
  assert.equal(await config('siteAdaptation').isVisible(), false);
  assert.equal(await page.locator('[data-footprint="mechanism"] option[value="planned"]').count(), 0);
  const streetFills = await page.locator('#urbanOverlay [data-street-role]:not([data-street-role="steps"])').evaluateAll(paths => paths.map(p => p.getAttribute('fill-rule')));
  assert.ok(streetFills.length > 0 && streetFills.every(rule => rule === 'nonzero'), 'Street ribbon overlaps must stay filled');
  await page.screenshot({ path: `${out}/user-case.png` });
  const layout = await page.evaluate(() => window.urbanLayouts[0]);
  writeFileSync(`${out}/user-case.json`, JSON.stringify(layout));
  for (const street of layout.streets.filter(s => s.rank <= 1 && s.role !== 'regional')) {
    for (let i = 1; i < street.path.length; i++) {
      const pair = [street.path[i-1], street.path[i]], root = pair.find(p => Math.hypot(p.x-city.center.x,p.y-city.center.y)<1e-4);
      if (root) { const next = pair.find(p => p !== root); assert.ok(Math.abs(next.x-root.x)<Math.abs(next.y-root.y), 'Inherited horizontal road must be the actual village spine'); }
    }
  }
  assert.ok(layout.streets.every(s=>s.widths.every(w=>w>0 && Number.isFinite(w))));
  const request = await page.evaluate(() => { const r = window.urbanRequest; return { ...r, raster: { ...r.raster, height: Array.from(r.raster.height), water: Array.from(r.raster.water) } }; });
  writeFileSync(`${out}/user-request.json`, JSON.stringify(request));
  console.log(JSON.stringify({ sites: request.sites, roads: request.roads.map(s=>({role:s.role,rank:s.rank,ends:[s.path[0],s.path.at(-1)]})), center: layout.center, structure: layout.structure.centers, streets: layout.streets.filter(s => s.rank <= 1).map(s => ({ role: s.role, endpoints: [s.path[0],s.path.at(-1)], width: s.widths[0] })) }, null, 2));
  const snapshot = await geometry(), replay = page.url();
  await page.goto(replay); await ready();
  assert.equal(await geometry(), snapshot, 'The reported village must replay exactly');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
