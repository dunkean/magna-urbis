/** Real V2 Rust workshop UI, including stopping stages and native quarter/parcel/house controls. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const backend = process.env.MAGNA_URBAN_BACKEND ?? 'rust';
const out = `${web}/out/v2-rust-browser${backend === 'native' ? '-native' : ''}`;
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terrainHash = t => hash({ ...t, rivers: t.rivers.map(({ name, ...r }) => r) });
// Built-capacity evidence changes after houses; the cadastral geometry remains the same.
const cadastreHash = town => hash(town.partitions?.map(partition => ({ key: partition.key, parcels: partition.parcels })));
const result = { time: new Date().toISOString(), backend, checks: {}, errors: [] };
await mkdir(out, { recursive: true });
let browser, page, native;
try {
  let localServer = process.env.MAGNA_LOCAL_SERVER;
  if (backend === 'native' && !localServer) {
    const binary = process.env.MAGNA_LOCAL_BIN ?? fileURLToPath(new URL(`../../rust/desktop-v2/resources/magna-urbis-local${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
    native = spawn(binary, ['--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, MAGNA_LOCAL_ADDR: '127.0.0.1:0' } });
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native Rust service startup timed out')), 20000);
      let text = '';
      native.stdout.on('data', chunk => { text += chunk; for (const line of text.split('\n')) try { const value = JSON.parse(line); if (value.ready && value.port) { clearTimeout(timeout); resolve(value.port); } } catch {} });
      native.once('error', reject); native.once('exit', code => { clearTimeout(timeout); reject(new Error(`Native service exited: ${code}`)); });
    });
    localServer = `http://127.0.0.1:${port}`;
  }
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
    args: process.env.MAGNA_TEST_GPU === '1' ? ['--enable-unsafe-webgpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  const profile = backend === 'native' ? `&profile=local&localServer=${encodeURIComponent(localServer)}` : '';
  await page.goto(`${base}/v2.html?empty&lang=fr${profile}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#terrain-only').waitFor();
  const reveal = async selector => { await page.locator(selector).evaluate(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; }); };
  const input = async (selector, value) => { await reveal(selector); await page.locator(selector).fill(String(value)); await page.locator(selector).dispatchEvent('change'); };
  const select = async (selector, value) => { await reveal(selector); await page.locator(selector).selectOption(value); };
  const globalField = path => `#urban-controls [data-setting-path="${path}"]`;
  const job = async selector => {
    const before = await page.locator('#job-log').textContent(); await page.locator(selector).click();
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
    const log = (await page.locator('#job-log').textContent()).slice(before.length);
    assert(!log.includes('Échec :'), log); assert.match(await page.locator('#footer-status').textContent(), /Carte prête/);
    return log;
  };
  const stagedWorld = async () => {
    const logs = [`[Terrain]\n${await job('#generate-region')}`];
    await page.locator('#tab-settlements').click();
    logs.push(`[Placement and roads]\n${await job('#region-only')}`);
    logs.push(`[City construction]\n${await job('#towns-only')}`);
    return logs.join('\n');
  };
  const exportJson = async (format, label) => {
    await page.locator('#export-open').click(); await page.locator('#export-format').selectOption(format);
    const pending = page.waitForEvent('download', { timeout: 90000 }); await page.locator('#export-go').click();
    const download = await pending; await download.saveAs(`${out}/${label}.json`);
    await page.locator('#export-dialog').waitFor({ state: 'hidden' });
    return JSON.parse(await readFile(`${out}/${label}.json`));
  };
  const project = label => exportJson('project', label);
  const snapshot = project => project.world.debug.v2RustCities.main;
  const inspect = async (kind, data, selector, nativeRequestId) => {
    await page.locator('[data-town="main"]').click();
    // The inspector covers the east half of a focused small settlement.
    await page.locator('#inspector > .close').click();
    await page.locator('#inspect-mode').check(); await page.locator('#inspect-target').selectOption(kind);
    const place = data.world.settlements.find(s => s.main), box = await page.locator('#map').boundingBox();
    const scale = Math.min(3, Math.min(box.height, box.width) / Math.max(600, place.radius * 3));
    const shapes = kind === 'quarter' ? data.world.urban.quarters.map(q => q.poly.outer) : kind === 'parcel' ? data.world.urban.parcels.map(p => p.poly) : data.world.urban.buildings.filter(b => !nativeRequestId || b.nativeRequestId === nativeRequestId).map(b => b.poly);
    for (const shape of shapes) {
      const p = shape.reduce((p, v) => ({ x: p.x + v.x / shape.length, y: p.y + v.y / shape.length }), { x: 0, y: 0 });
      const x = box.x + box.width / 2 + (p.x - place.center.x) * scale, y = box.y + box.height / 2 + (p.y - place.center.y) * scale;
      if (x < box.x + 30 || x > box.x + box.width - 30 || y < box.y + 175 || y > box.y + box.height - 175) continue;
      await page.mouse.click(x, y);
      if (await page.locator(selector).count()) return;
    }
    throw new Error(`No ${kind} could be selected through the visible map`);
  };

  // Keep the default coastal valley seed; small population bounds native geometry and keeps this check quick.
  assert.equal(await page.locator('#terrain-coast-S').getAttribute('aria-pressed'), 'true');
  await select('[data-setting-path="runtime.compute"]', 'cpu');
  await input('[data-setting-path="terrain.resolution"]', 128);
  await page.locator('#tab-settlements').click(); await input('#town-count', 1); await input('[data-option="population"]', 160);
  await select('#urban-backend', backend); await select(globalField('through'), 'layout');
  await input(globalField('houses.floors'), 2);
  await input(globalField('layout.footprint.aspect'), 1.6);
  await select(globalField('layout.fortificationStyle'), 'curtain');
  result.checks.structuredFields = await page.locator('#urban-controls [data-setting-path]').count();
  assert(result.checks.structuredFields > 150);
  result.checks.globalLayoutLog = await stagedWorld();
  let data = await project('01-layout');
  assert.equal(snapshot(data).stage, 'layout'); assert(data.world.urban.quarters.length > 0);
  assert.equal(snapshot(data).layouts[0].config.footprint.aspect, 1.6);
  assert.equal(data.settings.urban.layout.fortificationStyle, 'curtain');
  assert.equal(data.world.urban.parcels.length, 0); assert.equal(data.world.urban.buildings.length, 0);
  const terrain = terrainHash(data.world.terrain);
  result.checks.globalLayout = { backend: snapshot(data).backend, quarters: data.world.urban.quarters.length, coast: 'S', housesAbsent: true };
  await page.screenshot({ path: `${out}/01-layout.png`, fullPage: true });

  await inspect('quarter', data, '#subdivision-json');
  await input('#subdivision-controls [data-setting-path="density"]', .8);
  await input('#subdivision-controls [data-setting-path="wealth"]', .6);
  await input('#subdivision-controls [data-setting-path="salt"]', 2);
  await job('#subdivision-apply');
  data = await project('02-quarter-control');
  assert(Object.values(data.settings.urban.local.main.layout.overrides.quarters).some(q => q.salt === 2));
  assert.equal(terrainHash(data.world.terrain), terrain);
  result.checks.quarter = { inspected: true, localOverrideRetained: true, terrainRetained: true };

  await page.locator('[data-town="main"]').click();
  const layoutHash = hash(snapshot(data).layouts);
  result.checks.parcelsLog = await job('[data-town-stage="parcels"]');
  data = await project('03-parcels');
  assert.equal(snapshot(data).stage, 'parcels'); assert(data.world.urban.parcels.length > 0); assert.equal(data.world.urban.buildings.length, 0);
  assert.equal(hash(snapshot(data).layouts), layoutHash);
  await select(globalField('through'), 'parcels');
  await inspect('parcel', data, '#subdivision-json'); await input('#subdivision-controls [data-setting-path="salt"]', 7);
  await job('#subdivision-apply');
  data = await project('04-parcel-control');
  assert(Object.values(data.settings.urban.local.main.parcels.overrides.parcels).some(p => p.salt === 7));
  assert.equal(terrainHash(data.world.terrain), terrain); assert.equal(hash(snapshot(data).layouts), layoutHash);
  result.checks.parcel = { inspected: true, parcels: data.world.urban.parcels.length, layoutRetained: true };

  await page.locator('[data-town="main"]').click();
  result.checks.programmeLog = await job('[data-town-stage="programme"]');
  data = await project('05-programme');
  assert.equal(snapshot(data).stage, 'programme'); assert(snapshot(data).programmeKey); assert.equal(data.world.urban.buildings.length, 0);
  assert.equal(hash(snapshot(data).layouts), layoutHash);
  result.checks.programme = { housesAbsent: true, layoutRetained: true };
  const parcelHash = cadastreHash(snapshot(data));

  await page.locator('[data-town="main"]').click();
  await input('#local-urban-controls [data-setting-path="houses.floors"]', 3);
  result.checks.buildingsLog = await job('[data-town-stage="buildings"]');
  data = await project('06-native-houses');
  assert.equal(snapshot(data).stage, 'buildings'); assert(data.world.urban.buildings.length > 0);
  assert.equal(hash(snapshot(data).layouts), layoutHash); assert.equal(cadastreHash(snapshot(data)), parcelHash);
  assert.equal(snapshot(data).capacityKey, snapshot(data).buildingKey);
  assert(data.world.urban.buildings.every(b => b.nativeId && b.nativeRequestId && b.nativeParcelId));
  assert(snapshot(data).scene.buildings.some(b => b.volumes.some(v => v.levels.length === 3)));
  result.checks.houses = { projected: data.world.urban.buildings.length, source: snapshot(data).scene.buildings.length,
    localFloorsAppliedToGeometry: true, earlierStagesRetained: true };
  await page.screenshot({ path: `${out}/02-houses.png`, fullPage: true });

  await select(globalField('through'), 'buildings');
  await inspect('house', data, '#house-native-json');
  const before = snapshot(data), housesBefore = before.scene.buildings;
  await input('#house-native-controls [data-setting-path="overrides.floors"]', 2);
  result.checks.houseOverrideLog = await job('#house-native-apply');
  const rebuilt = await project('07-native-house-override'), next = snapshot(rebuilt);
  assert.equal(terrainHash(rebuilt.world.terrain), terrain);
  assert.equal(hash(next.layouts), layoutHash); assert.equal(cadastreHash(next), parcelHash);
  assert.equal(Object.keys(rebuilt.settings.urban.buildings).length, 1);
  const overrides = Object.entries(next.houseOverrides); assert.equal(overrides.length, 1);
  assert.equal(overrides[0][1].overrides.floors, 2);
  const request = next.requests.find(r => r.id === overrides[0][0]); assert(request);
  const changedParcel = request.parcel_id;
  assert.equal(hash(next.scene.buildings.filter(b => b.parcel_id !== changedParcel)), hash(housesBefore.filter(b => b.parcel_id !== changedParcel)));
  assert(next.scene.buildings.filter(b => b.parcel_id === changedParcel).some(b => b.volumes.some(v => v.levels.length === 2)));
  result.checks.houseOverride = { nativeRequestId: overrides[0][0], floorsInSourceGeometry: 2,
    requestsRegenerated: next.lastBuildingRequests, neighborsRetained: true, layoutAndCadastreRetained: true };
  await page.screenshot({ path: `${out}/03-house-overridden.png`, fullPage: true });
  const recipe = await exportJson('recipe', '08-native-recipe');
  assert(!recipe.world);
  await inspect('house', rebuilt, '#house-native-json', overrides[0][0]);
  await input('#house-native-json', JSON.stringify({ overrides: { floors: 1000 } }));
  result.checks.rejectionLog = await job('#house-native-apply');
  const rejected = snapshot(await project('08b-native-rejection'));
  assert(rejected.scene.refusals.some(refusal => refusal.parcel_id === changedParcel));
  assert(!rejected.scene.buildings.some(building => building.parcel_id === changedParcel));
  result.checks.recipeConstraints = { inadmissibleHouseRefused: true, refusal: rejected.scene.refusals.filter(refusal => refusal.parcel_id === changedParcel) };
  assert.match(result.checks.rejectionLog, /refusée/);
  const retry = page.locator(`[data-retry-house="${request.id}"]`);
  const refusalDetails = retry.locator('xpath=..');
  await refusalDetails.locator(':scope > summary').click();
  await refusalDetails.locator('.refusal-json').fill(JSON.stringify({ overrides: { floors: 2 } }));
  result.checks.retryLog = await job(`[data-retry-house="${request.id}"]`);
  const corrected = snapshot(await project('08c-native-corrected'));
  assert(corrected.scene.buildings.filter(b => b.parcel_id === changedParcel).some(b => b.volumes.some(v => v.levels.length === 2)));
  result.checks.recipeConstraints.visibleReportAndRetry = true;
  await page.locator('#import-open').click(); await page.locator('#import-scope').selectOption('complete');
  await page.locator('#project-file').setInputFiles({ name: 'native-recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) });
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  result.checks.recipeLog = await stagedWorld();
  const replay = await project('09-native-recipe-rebuilt'), replaySnapshot = snapshot(replay);
  assert.equal(hash(replaySnapshot.layouts), layoutHash); assert.equal(cadastreHash(replaySnapshot), parcelHash);
  assert(replaySnapshot.scene.buildings.filter(b => b.parcel_id === changedParcel).some(b => b.volumes.some(v => v.levels.length === 2)));
  result.checks.recipeReconstruction = { withoutSnapshot: true, layoutAndCadastreReproduced: true, nativeOverrideApplied: true };
  assert.deepEqual(result.errors, []);
  result.ok = true;
} catch (error) {
  result.ok = false; result.error = error.stack; process.exitCode = 1;
  if (page) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); result.log = await page.locator('#job-log').textContent().catch(() => ''); }
} finally {
  await browser?.close();
  if (native && native.exitCode === null) { native.kill(); await new Promise(resolve => native.once('exit', resolve)); }
  await writeFile(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
