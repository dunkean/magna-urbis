// From web/: node scripts/terrain_settlements_ui_check.mjs [base URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const heartbeat = setInterval(() => {
  void page.evaluate(() => ({ terrain: document.getElementById('status')?.textContent, settlements: document.getElementById('setStatus')?.textContent }))
    .then(status => console.log(JSON.stringify({ progress: status }))).catch(() => {});
}, 30000);
heartbeat.unref();
await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
await page.addInitScript(() => {
  window.addEventListener('settlements:generated', event => { window.__settlementOutput = event.detail; });
  window.addEventListener('roads:generated', event => { window.__roadOutput = event.detail; });
  const Base = window.Worker;
  window.Worker = class extends Base {
    postMessage(...args) {
      if (args[0] && 'roads' in args[0] && ('place' in args[0] || 'sites' in args[0])) window.__settlementRequests = (window.__settlementRequests ?? 0) + 1;
      return super.postMessage(...args);
    }
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data.settlements) window.__settlementOutput = event.data.settlements;
        if (event.data.roads) window.__roadOutput = event.data.roads;
        if (event.data.terrain && event.data.kind === 'overview' && !event.data.partial) { window.__terrainReplies = (window.__terrainReplies ?? 0) + 1; window.__terrain = event.data.terrain; }
      });
    }
  };
});
const target = new URL(process.argv[2] ?? 'http://127.0.0.1:5174/terrainbench.html');
target.search = new URLSearchParams({ width: '16000', motif: '3000', relief: 'flat', source: 'procedural', compute: 'wasm', generation: 'cpu', hydro_enabled: '0', erosion: '0', refine: '0', forest: '0', style: 'copernicus', auto: '0', standalone: '1', profile: 'web' }).toString();
const spec = { key: 'main', population: 3000, name: '', culture: 'european-organic', kind: 'settlement', siteType: 'auto', sitePrefs: {} };
target.searchParams.set('settlements', JSON.stringify({ config: { mode: 'counts', main: spec, counts: { village: 2, hamlet: 2, farmstead: 2 } } }));
target.searchParams.set('roads', JSON.stringify({ config: { exits: 2, level: 'developed' } }));
target.searchParams.set('urban', JSON.stringify({ enabled: false }));
target.searchParams.set('landuse', JSON.stringify({ enabled: false }));
target.searchParams.set('pipeline', 'legacy');
async function settled() {
  await page.waitForSelector('#setStatus', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('status').dataset.error === 'true'
    || (document.getElementById('setStatus').textContent.startsWith('Rust ·') && !document.getElementById('setGenerate').hasAttribute('aria-busy')
    && document.getElementById('roadStatus').textContent.startsWith('Rust ·') && !document.getElementById('roadStage').hasAttribute('aria-busy')), null, { timeout: 120000 });
  assert.notEqual(await page.locator('#status').getAttribute('data-error'), 'true', await page.locator('#status').textContent());
}
async function screenPoint(x, y) {
  return page.evaluate(({ x, y }) => {
    const map = document.getElementById('map'), rect = map.getBoundingClientRect(), box = map.viewBox.baseVal;
    return { x: rect.x + (x - box.x) / box.width * rect.width, y: rect.y + (y - box.y) / box.height * rect.height };
  }, { x, y });
}
async function changed(action, which = '__settlementOutput') {
  await page.evaluate(which => { window.__previousOutput = window[which]; }, which);
  await action();
  await page.waitForFunction(which => window[which] !== window.__previousOutput, which, { timeout: 120000 });
  await settled();
}
const ROAD_CLASSES = ['highway', 'main', 'local', 'track', 'trail'], SURFACES = ['dirt', 'gravel', 'paved', 'flagstone'];
try {
  await page.goto(target.href, { waitUntil: 'commit' }); await settled();
  let state = await page.evaluate(() => window.__settlementOutput);
  let roads = await page.evaluate(() => window.__roadOutput);
  assert.equal(state.settlements.length, 7);
  assert.equal(roads.unreachable.length, 0);
  assert(roads.segments.length > 0);
  assert(roads.segments.every(r => ROAD_CLASSES.includes(r.class) && SURFACES.includes(r.surface)));
  assert(roads.segments.some(r => r.surface === 'paved'), 'developed level paves its trunks');
  await page.locator('#roadStage .panel-advanced > summary').first().click();
  await page.locator('#settlementStage .panel-advanced > summary').first().click();
  // Road options reroute only: the places stay where they are.
  const placed = JSON.stringify(state.settlements.map(s => s.center));
  await changed(async () => { await page.locator('#roadSurface').selectOption('dirt'); }, '__roadOutput');
  roads = await page.evaluate(() => window.__roadOutput);
  assert(roads.segments.every(r => r.surface === 'dirt'));
  assert.equal(await page.evaluate(() => JSON.stringify(window.__settlementOutput.settlements.map(s => s.center))), placed);
  await changed(async () => { await page.locator('#roadSurface').selectOption('auto'); await page.locator('#roadCulture').selectOption('roman'); }, '__roadOutput');
  roads = await page.evaluate(() => window.__roadOutput);
  assert(roads.segments.every(r => r.profile === 'roman'));
  assert.equal(await page.evaluate(() => JSON.stringify(window.__settlementOutput.settlements.map(s => s.center))), placed);
  await page.locator('[data-settlement="village:0"] .settlement-symbol').click();
  assert.match(await page.locator('#setScore').innerText(), /Choice score/);
  await changed(async () => { await page.locator('#setPopulation').fill('650'); await page.locator('#setPopulation').dispatchEvent('change'); });
  assert.equal(await page.locator('#setMode').inputValue(), 'list');
  assert.equal(await page.evaluate(() => window.__settlementOutput.settlements.find(s => s.key === 'village:0').population), 650);
  await changed(async () => { await page.locator('#setName').fill('Market on the hill'); await page.locator('#setName').dispatchEvent('change'); });
  assert.equal(await page.evaluate(() => window.__settlementOutput.settlements.find(s => s.key === 'village:0').name), 'Market on the hill');
  const free = await page.evaluate(() => {
    const sites = window.__settlementOutput.settlements;
    for (let y = 2500; y < 14000; y += 1500) for (let x = 2500; x < 14000; x += 1500)
      if (sites.every(s => Math.hypot(x - s.center.x, y - s.center.y) > s.radius + 1000)) return { x, y };
  });
  assert(free, 'no free manual position');
  await changed(async () => { await page.locator('#setAdd').click(); const point = await screenPoint(free.x, free.y); await page.mouse.click(point.x, point.y); });
  state = await page.evaluate(() => window.__settlementOutput);
  assert.equal(state.settlements.length, 8);
  const manual = state.settlements.find(s => s.key.startsWith('manual:'));
  assert(manual && Math.hypot(manual.center.x - free.x, manual.center.y - free.y) < 30);
  const beforeRoads = JSON.stringify(await page.evaluate(() => window.__roadOutput.segments));
  await changed(async () => {
    const from = await screenPoint(manual.center.x, manual.center.y), to = await screenPoint(manual.center.x + 500, manual.center.y + 500);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
  });
  state = await page.evaluate(() => window.__settlementOutput);
  const moved = state.settlements.find(s => s.key === manual.key);
  assert(moved && Math.hypot(moved.center.x - manual.center.x - 500, moved.center.y - manual.center.y - 500) < 30);
  roads = await page.evaluate(() => window.__roadOutput);
  assert.notEqual(JSON.stringify(roads.segments), beforeRoads);
  assert(roads.junctions.some(j => j.site === manual.key && Math.hypot(j.point.x - moved.center.x, j.point.y - moved.center.y) < 1), 'the moved place is a road node');
  // Manual refresh keeps draft markers at their new positions, batches moves, and
  // never sends an intermediate placement/routing request.
  await page.locator('#setAutoRefresh').uncheck();
  const requests = await page.evaluate(() => window.__settlementRequests);
  const pendingRoads = JSON.stringify(roads);
  for (const offset of [100, 200]) {
    const previous = offset - 100;
    const from = await screenPoint(moved.center.x + previous, moved.center.y + previous);
    const to = await screenPoint(moved.center.x + offset, moved.center.y + offset);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    const marker = page.locator(`[data-settlement="${manual.key}"]`);
    assert(Math.abs(Number(await marker.getAttribute('data-x')) - moved.center.x - offset) < 30);
  }
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__settlementRequests), requests);
  assert.equal(JSON.stringify(await page.evaluate(() => window.__roadOutput)), pendingRoads);
  assert.match(await page.locator('#setStatus').textContent(), /Changes pending/);
  await changed(async () => { await page.locator('#setRefresh').click(); });
  assert.equal(await page.evaluate(() => window.__settlementRequests), requests + 1);
  const batched = await page.evaluate(key => window.__settlementOutput.settlements.find(s => s.key === key), manual.key);
  assert(Math.hypot(batched.center.x - moved.center.x - 200, batched.center.y - moved.center.y - 200) < 30);
  assert.equal(JSON.parse(new URL(page.url()).searchParams.get('settlements')).autoRefresh, false);
  await page.locator('#setAutoRefresh').check();
  if (target.protocol !== 'file:') assert.equal(await page.evaluate(() => window.__terrainReplies), 1, 'editing settlements regenerated terrain');
  await changed(async () => { await page.locator('#setRemove').click(); });
  state = await page.evaluate(() => window.__settlementOutput);
  assert.equal(state.settlements.length, 7);
  await page.waitForTimeout(250);
  const shared = new URL(page.url());
  assert.equal(JSON.parse(shared.searchParams.get('settlements')).config.list.find(s => s.key === 'village:0').population, 650);
  assert.equal(JSON.parse(shared.searchParams.get('roads')).config.culture, 'roman');
  mkdirSync('out/terrain-settlements', { recursive: true });
  await page.screenshot({ path: 'out/terrain-settlements/edited.png', fullPage: true });
  await page.locator('#setAutoRefresh').uncheck();
  await page.waitForTimeout(250);
  // Procedural is omitted by the legacy share serializer; pin it for this test
  // so a reload does not start the default neural model download.
  const reload = new URL(page.url()); reload.searchParams.set('source', 'procedural');
  await page.goto(reload.href, { waitUntil: 'commit' }); await settled();
  assert.equal(await page.locator('#setAutoRefresh').isChecked(), false);
  assert.equal(await page.evaluate(() => window.__settlementOutput.settlements.find(s => s.key === 'village:0').name), 'Market on the hill');
  const waterEngines = process.argv.includes('--water') ? ['rust', 'vector'] : process.argv.includes('--vector-water') ? ['vector'] : [];
  for (const engine of waterEngines) {
    const waterUrl = new URL(target);
    for (const [key, value] of Object.entries({ hydro_enabled: '1', hydro_engine: engine, hydro_condMode: 'none', hydro_resolution: '256', hydro_vectorResolution: '512', hydro_compute: 'cpu', coasts: 'S' })) waterUrl.searchParams.set(key, value);
    await page.goto(waterUrl.href, { waitUntil: 'commit' }); await settled();
    const adapterUrl = `/@fs/${fileURLToPath(new URL('../../rust/bridge/settlements.ts', import.meta.url)).replaceAll('\\', '/')}`;
    const audit = await page.evaluate(async adapterUrl => {
      const { settlementRaster } = await import(adapterUrl);
      const raster = settlementRaster(window.__terrain), output = window.__settlementOutput, roads = window.__roadOutput;
      const index = p => Math.min(raster.n - 1, Math.floor(p.y / raster.width * raster.n)) * raster.n + Math.min(raster.n - 1, Math.floor(p.x / raster.width * raster.n));
      return {
        count: output.settlements.length,
        wet: output.settlements.filter(s => raster.water[index(s.center)] !== 0).length,
        blockedRoadPoints: roads.segments.flatMap(r => r.path).filter(p => [1, 2].includes(raster.water[index(p)])).length,
        crossings: roads.segments.reduce((sum, r) => sum + r.crossings.length, 0),
        waters: [...new Set(raster.water)],
      };
    }, adapterUrl);
    assert(audit.count > 0, `${engine}: no settlements`);
    assert.equal(audit.wet, 0); assert.equal(audit.blockedRoadPoints, 0);
    await page.screenshot({ path: `out/terrain-settlements/${engine}-water.png`, fullPage: true });
    console.log(JSON.stringify({ waterEngine: engine, ...audit }));
  }
  assert.deepEqual(errors, []);
  roads = await page.evaluate(() => window.__roadOutput);
  console.log(JSON.stringify({ settlements: state.settlements.length, roadClasses: [...new Set(roads.segments.map(r => r.class))], surfaces: [...new Set(roads.segments.map(r => r.surface))], terrainPreserved: true, editingAndSharing: true, errors }));
} catch (error) {
  const status = await page.evaluate(() => ({ terrain: document.getElementById('status')?.textContent, settlements: document.getElementById('setStatus')?.textContent, roads: document.getElementById('roadStatus')?.textContent })).catch(() => undefined);
  console.error(JSON.stringify({ pageErrors: errors, status, url: page.url() })); throw error;
}
finally { clearInterval(heartbeat); await browser.close(); }
