/** Focused native integration witness; owns only its ephemeral server/browser.
 * From web/: node scripts/compact_city_smoke.mjs [--api-only|--city-only] [--exe=...] [--vite=...] [--out=...]
 * Run only after the coordinated native build completes. No UI source changes.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const option = (key, fallback) => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const executable = resolve(option('exe', '../rust/target/debug/magna-urbis-local.exe'));
const vite = option('vite', 'http://127.0.0.1:5173');
const output = resolve(option('out', '../web/out/work/compact-city-smoke'));
await mkdir(output, { recursive: true });
const executableStat = await stat(executable);
const report = { executable, executableModified: executableStat.mtime.toISOString(), started: new Date().toISOString(), native: [], city: undefined, errors: [] };
const minimumBuild = option('min-build', '');
if (minimumBuild) assert(executableStat.mtimeMs > Date.parse(minimumBuild), 'Native executable predates the requested completed build.');
const socket = createServer();
await new Promise(done => socket.listen(0, '127.0.0.1', done));
const address = socket.address(); assert(address && typeof address !== 'string');
const port = address.port;
await new Promise(done => socket.close(done));
const child = spawn(executable, ['--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '', browser, page;
const ready = new Promise((done, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Native startup timeout: ${serverLog}`)), 30_000);
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Native exited ${code}: ${serverLog}`)); });
  child.stdout.on('data', bytes => { serverLog += String(bytes); if (serverLog.includes('"ready":true')) { clearTimeout(timeout); done(); } });
  child.stderr.on('data', bytes => { serverLog += String(bytes); });
});
const base = `http://127.0.0.1:${port}`;
async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  assert(response.ok && result.ok, `${path}: ${JSON.stringify(result.error ?? result)}`);
  return result.data;
}
const rectangle = (x, y, w, h) => [{ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], holes: [] }];
function request(recipe, index) {
  const x = 100 + index * 80, y = 160, surface = rectangle(x, y, 48, 55);
  return { id: `compact-smoke-${index}`, parcel_id: `compact-smoke-parcel-${index}`, seed: `compact-smoke:${recipe}`,
    cadastral: surface, buildable: surface, roof_domain: surface, reserves: [],
    accesses: [{ id: 'front', segment: [{ x, y: y + 55 }, { x: x + 48, y: y + 55 }], kind: 'public', width_m: 2 }], party_boundaries: [], neighbors: [],
    culture: { culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null }, function: 'domestic',
    terrain: { origin: { x, y }, ground_z_m: 10, gradient: [0, 0], water_z_m: null, max_foundation_step_m: 1 },
    config: { recipe, variation: 0, overrides: { variant: 'default' } }, parcel_fit: true };
}
function worldSurfaceError(local, world, transform) {
  const angle = transform.orientation_deg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  let maximum = 0;
  assert.equal(local.length, world.length, 'Surface polygon count changed.');
  for (let i = 0; i < local.length; i++) {
    const rings = [local[i].outer, ...local[i].holes], expected = [world[i].outer, ...world[i].holes];
    assert.equal(rings.length, expected.length, 'Surface hole count changed.');
    for (let j = 0; j < rings.length; j++) {
      assert.equal(rings[j].length, expected[j].length, 'Footprint vertex count changed.');
      for (let k = 0; k < rings[j].length; k++) {
        const p = rings[j][k], q = expected[j][k];
        maximum = Math.max(maximum, Math.hypot(transform.origin.x + p.x * c - p.y * s - q.x, transform.origin.y + p.x * s + p.y * c - q.y));
      }
    }
  }
  assert(maximum < 1e-6, `Retained footprint changed by ${maximum}m.`);
  return maximum;
}
async function nativeRoundTrip() {
  const requests = ['EUR-MED-B01', 'EUR-MED-B07'].map(request);
  const batch = await post('/houses/plans', { schema_version: '1', requests });
  assert.equal(batch.buildings.length, requests.length, `Native compact refusals: ${JSON.stringify(batch.refusals)}`);
  const filename = resolve(output, 'fresh-native-plans.json');
  await writeFile(filename, JSON.stringify(batch));
  // This is a disk round-trip of this server's fresh output, not an old fixture.
  const reread = JSON.parse(await readFile(filename, 'utf8'));
  for (const building of reread.buildings) {
    assert.equal(building.simplification, 'architectural_plan');
    assert(building.volumes.every(volume => volume.roof_mesh.vertices.length === 0));
    const before = JSON.stringify(building);
    const start = performance.now();
    const detailed = await post('/houses/realize-plan', { building, interiors: false });
    assert.equal(detailed.units.length, 1);
    const unit = detailed.units[0];
    assert.equal(unit.recipe_id, building.recipe_id); assert.equal(unit.variant_id, building.variant_id);
    assert.deepEqual(unit.transform, building.transform);
    assert.equal(unit.bodies.length, building.volumes.length);
    assert(unit.roofs.vertices.length > 0 && unit.roofs.faces.length > 0, 'Detailed endpoint produced no native roof mesh.');
    let maximumFootprintErrorM = 0;
    for (const [index, body] of unit.bodies.entries()) maximumFootprintErrorM = Math.max(maximumFootprintErrorM, worldSurfaceError(body.footprint, building.volumes[index].footprint, unit.transform));
    assert.equal(JSON.stringify(building), before, 'Realization modified the caller retained plan.');
    await writeFile(resolve(output, `${building.id}-realized.json`), JSON.stringify(detailed));
    report.native.push({ id: building.id, recipe: building.recipe_id, bodies: unit.bodies.length, meshVertices: unit.roofs.vertices.length,
      meshFaces: unit.roofs.faces.length, maximumFootprintErrorM, realizeMs: Math.round(performance.now() - start), jsonRoundTrip: true });
  }
}
async function citySmoke() {
  // One small actual settlement, on the user's existing river-plain decor.
  const url = new URL('/citybench.html', vite);
  const settlements = { enabled: true, showPoints: true, config: { mode: 'list', distribution: 'classes',
    main: { key: 'main', name: '', population: 300, culture: 'european-organic', kind: 'settlement', siteType: 'auto', sitePrefs: {} },
    counts: { city: 0, town: 0, village: 0, hamlet: 0, farmstead: 0 },
    list: [{ key: 'city', name: 'Compact smoke · 300 habitants', population: 300, culture: 'european-organic', kind: 'settlement', siteType: 'auto', sitePrefs: {}, position: { x: 8000, y: 8000 } }], relief: 'flat', density: 1 } };
  const urban = { enabled: true, parcelEnabled: true, target: 'city', quarterSeed: 'compact-smoke', parcelSeed: 'compact-smoke',
    layoutConfig: { scope: 'settlement', culture: 'site', preset: 'culture', recipe: 'auto', zone: 'auto', density: 1 },
    parcelConfig: { preset: 'culture', culture: 'site', recipe: 'auto', zone: 'auto', density: 1 }, render: { view: 'parcels' },
    buildingState: { visible: true, generated: false, seed: 'compact-smoke', appearance: { style: 'cartographic', diagnostic: 'none' } }, architecture: 'silhouette' };
  for (const [key, value] of Object.entries({ artifact: 'city-01-river-plain-l', settlements: JSON.stringify(settlements), urban: JSON.stringify(urban), profile: 'local', localServer: base, standalone: '1' })) url.searchParams.set(key, value);
  report.city = { url: url.href, errors: [], consoleErrors: [], planHttpResponses: [] };
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(...args) { super(...args); this.addEventListener('message', event => {
        if (event.data?.scene) window.__compactSmokeScene = event.data.scene;
        if (event.data?.settlements) window.__compactSmokeSettledAt = performance.now();
        if (event.data?.partitions) window.__compactSmokeParcelsAt = performance.now();
      }); }
    };
  });
  context.on('response', response => { if (response.url().endsWith('/houses/plans')) report.city.planHttpResponses.push({ status: response.status(), url: response.url() }); });
  page = await context.newPage();
  page.on('pageerror', error => report.city.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.city.consoleErrors.push(message.text()); });
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.magnaBenchContext?.ready(), null, { timeout: 60_000 });
  await page.locator('[data-city-architecture]').waitFor({ state: 'attached', timeout: 30_000 });
  await page.locator('[data-city-architecture]').evaluate(select => { for (let node = select.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; });
  // The action remains enabled while the preceding city stages are working;
  // wait for the new settlement's actual parcel reply, not button enablement.
  await page.waitForFunction(() => window.__compactSmokeParcelsAt > window.__compactSmokeSettledAt
    && /^Rust · \d+ parcelles/.test(document.querySelector('#urbanParcelStage [data-status]')?.textContent ?? '')
    && document.querySelector('#urbanParcelStage [data-apply]')?.getAttribute('aria-busy') !== 'true', null, { timeout: 60_000 });
  await page.locator('[data-city-architecture]').selectOption('compact');
  await page.locator('[data-buildings-generate]').click();
  await page.waitForFunction(() => /^(?:[\d\s,.]+ bâtiments ·|Error:|Erreur)/.test(document.querySelector('[data-buildings-status]')?.textContent ?? ''), null, { timeout: 60_000 });
  const status = await page.locator('[data-buildings-status]').textContent(); report.city.status = status;
  assert(!/^(Error:|Erreur)/.test(status), status);
  await page.locator('#focusCity').click();
  await page.locator('[data-city-canvas] canvas').waitFor({ state: 'attached', timeout: 10_000 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  Object.assign(report.city, await page.evaluate(() => {
    const scene = window.__compactSmokeScene;
    const canvas = document.querySelector('[data-city-canvas] canvas');
    const pixels = canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let paintedPixels = 0; for (let i = 3; pixels && i < pixels.length; i += 4) if (pixels[i]) paintedPixels++;
    return { architecture: document.querySelector('[data-city-architecture]')?.value,
      counts: document.querySelector('[data-city-building-counts]')?.textContent,
      frame: document.querySelector('[data-city-frame]')?.textContent,
      buildings: scene?.buildings.length, compactBuildings: scene?.buildings.filter(building => building.simplification === 'architectural_plan').length,
      refusals: scene?.refusals.length, archiveCount: Object.keys(scene?.plan_archives ?? {}).length,
      svgBuildingNodes: document.querySelectorAll('[data-urban-building]').length,
      canvas: canvas && { width: canvas.width, height: canvas.height, paintedPixels } };
  }));
  await page.screenshot({ path: resolve(output, 'city-compact.png'), fullPage: true });
  assert.equal(report.city.architecture, 'compact');
  assert(report.city.compactBuildings > 0, 'City did not publish an accepted native compact building.');
  assert(report.city.canvas?.paintedPixels > 0, 'City canvas is blank.');
  assert.equal(report.city.svgBuildingNodes, 0, 'City inserted individual building SVG nodes.');
  assert.equal(report.city.errors.length, 0, `Browser errors: ${report.city.errors.join('; ')}`);
}
try {
  await ready;
  if (!process.argv.includes('--city-only')) await nativeRoundTrip();
  if (!process.argv.includes('--api-only')) await citySmoke();
  report.ok = true;
} catch (error) {
  report.ok = false; report.errors.push(error.stack ?? String(error));
  if (page) {
    try {
      report.city.failureUi = await page.locator('body').innerText();
      await page.screenshot({ path: resolve(output, 'city-blocked.png'), fullPage: true });
    } catch { /* The original error remains primary. */ }
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  child.kill();
  report.finished = new Date().toISOString();
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(output, 'server.log'), serverLog);
}
console.log(JSON.stringify({ ok: report.ok, executableModified: report.executableModified, native: report.native,
  city: report.city && { status: report.city.status, architecture: report.city.architecture, buildings: report.city.buildings,
    compactBuildings: report.city.compactBuildings, refusals: report.city.refusals, archiveCount: report.city.archiveCount,
    canvas: report.city.canvas, frame: report.city.frame, errors: report.city.errors },
  errors: report.errors, report: resolve(output, 'report.json') }, null, 2));
