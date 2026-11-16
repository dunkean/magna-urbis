/** Exercise the deployed workshop through its ordinary controls, exports and imports.
 * MAGNA_V2_URL selects a candidate server; MAGNA_V2_RECIPE accepts a recipe/project file.
 * MAGNA_TEST_ADAPTER_LUID pins Windows hardware without changing browser/user settings.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const web = fileURLToPath(new URL('..', import.meta.url));
const base = new URL(process.env.MAGNA_V2_URL ?? 'https://magna-urbis.org/');
const out = resolve(process.env.MAGNA_V2_LIVE_OUTPUT ?? resolve(web, 'out/v2-live'));
const profile = resolve(process.env.MAGNA_V2_LIVE_PROFILE ?? resolve(out, 'profile'));
const report = { url: base.href, started: new Date().toISOString(), checks: [], errors: [], console: [], models: [] };
await mkdir(out, { recursive: true });
const args = ['--enable-unsafe-webgpu'];
if (process.env.MAGNA_TEST_ADAPTER_LUID) args.push(`--use-adapter-luid=${process.env.MAGNA_TEST_ADAPTER_LUID}`);
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  viewport: { width: 1500, height: 1000 }, acceptDownloads: true, args,
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.errors.push(error.stack ?? error.message));
page.on('console', message => { if (message.type() === 'error') report.console.push(message.text()); });
page.on('response', response => {
  if (response.url().includes('/neural/')) report.models.push({ url: response.url(), status: response.status() });
});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const weights = () => report.models.filter(r => /\/(?:coarse|base|decoder)[^/]*\?/.test(r.url));
async function state() {
  return page.evaluate(() => ({
    busy: document.querySelector('#app')?.getAttribute('aria-busy'),
    footer: document.querySelector('#footer-status')?.textContent,
    toast: document.querySelector('#toast')?.textContent,
    log: document.querySelector('#job-log')?.textContent,
  }));
}
async function record(name, extra = {}) {
  const current = await state();
  report.checks.push({ name, ...extra, ...current });
  console.log(`${name}: ${current.footer}`);
  return current;
}
async function recipe(change) {
  await page.locator('#expert-open').click();
  const value = JSON.parse(await page.locator('#expert-json').inputValue());
  change(value);
  await page.locator('#expert-json').fill(JSON.stringify(value));
  await page.locator('#expert-apply').click();
  assert.equal(await page.locator('#expert-error').textContent(), '');
}
async function run(name, selector = '#generate-region') {
  await page.locator(selector).click();
  const warning = page.locator('#neural-download-warning');
  await Promise.race([
    warning.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
    page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: 30000 }).catch(() => {}),
  ]);
  if (await warning.isVisible()) await warning.locator('[data-continue]').click();
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: 300000 });
  const current = await record(name);
  assert.match(current.footer, /Carte prête|Map ready/, `${current.log}\n${current.toast}`);
  assert.doesNotMatch(`${current.log}\n${current.toast}`, /recursive use of an object|unsafe aliasing|unreachable|toDataURL/);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
}
async function project(name) {
  await page.locator('#export-open').click();
  await page.locator('#export-format').selectOption('project');
  const pending = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#export-go').click();
  const download = await pending, path = resolve(out, `${name}.project.json`);
  await download.saveAs(path);
  await page.locator('#export-dialog').waitFor({ state: 'hidden' });
  const value = JSON.parse(await readFile(path, 'utf8')), world = value.world;
  assert(world?.terrain?.height, 'Project export has no physical terrain');
  const buildings = (world.urban?.buildings ?? []).map(b => ({
    nativeRequestId: b.nativeRequestId, poly: b.poly, roof: b.roof, storeys: b.storeys,
  }));
  return { path, height: hash(world.terrain.height), buildings,
    main: world.settlements?.find(s => s.main), settings: value.settings,
    names: world.names?.entries.map(e=>({id:e.id,kind:e.kind,profile:e.parts?.profile,text:e.text})), regionProfile:world.names?.regionParts?.profile };
}
async function reopen(path) {
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles(path);
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 120000 });
}
async function editHouse(before) {
  await page.locator('#family-tab-cities').click();
  await page.locator('[data-town="main"]').click();
  // Selection is a public toolbar control; opening a city preserves its focused view.
  await page.locator('#inspect-mode').check();
  await page.locator('#inspect-target').selectOption('house');
  const box = await page.locator('#map').boundingBox(), main = before.main;
  const scale = Math.min(3, Math.min(box.height, box.width) / Math.max(600, main.radius * 3));
  let selected;
  for (const building of before.buildings) {
    const p = building.poly.reduce((p, v) => ({ x: p.x + v.x / building.poly.length, y: p.y + v.y / building.poly.length }), { x: 0, y: 0 });
    const x = box.x + box.width / 2 + (p.x - main.center.x) * scale, y = box.y + box.height / 2 + (p.y - main.center.y) * scale;
    if (x < box.x + 40 || x > box.x + box.width - 400 || y < box.y + 170 || y > box.y + box.height - 170) continue;
    await page.mouse.click(x, y);
    if (await page.locator('#house-native-controls').count()) { selected = building; break; }
  }
  assert(selected, 'No house selected through the visible map');
  const roof = page.locator('#house-native-controls [data-setting-path="overrides.roof"]');
  await page.waitForFunction(() => {
    const input = document.querySelector('#house-native-controls [data-setting-path="overrides.roof"]');
    return input instanceof HTMLSelectElement && input.options.length > 1;
  });
  const options = await roof.evaluate(input => [...input.options].map(o => o.value));
  const next = selected.roof === 'flat' ? 'RF-GABLE' : 'RF-FLAT';
  assert(options.includes(next), `No supported roof alternative: ${options.join(', ')}`);
  await roof.selectOption(next);
  assert(await page.locator('#map > [data-urban-selection] path[stroke="#e52b36"]').getAttribute('d'), 'Red selection outline missing');
  await run('03-house-roof', '#house-native-apply');
  const after = await project('edited');
  const changed = after.buildings.find(b => b.nativeRequestId === selected.nativeRequestId);
  assert(changed, 'Edited house disappeared');
  assert.notEqual(changed.roof, selected.roof, 'The roof control did not change the house');
  assert.deepEqual(changed.poly, selected.poly, 'Roof edit changed the footprint');
  assert.equal(after.height, before.height, 'Roof edit changed the physical terrain');
  report.checks.push({ name: 'house-retained', id: selected.nativeRequestId, before: selected.roof, after: changed.roof, outline: 'red' });
  return after;
}
const progress = setInterval(() => void state().then(s => {
  if (s.busy === 'true') console.log(s.log?.split('\n').at(-1));
}).catch(() => {}), 15000);
try {
  // Explicit test mode disables autosave restoration. No test hooks replace the UI or engine.
  const url = new URL(base); url.searchParams.set('test', '1'); url.searchParams.set('lang', 'fr');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-splash').waitFor({ state: 'detached' });
  report.build = await page.locator('#build-info').textContent();
  report.gpu = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return { vendor: adapter?.info?.vendor, architecture: adapter?.info?.architecture, description: adapter?.info?.description, renderer };
  });
  assert(report.gpu.vendor, 'No real WebGPU adapter');
  await page.locator('#source-neural').click();
  if (process.env.MAGNA_V2_RECIPE) {
    const input = JSON.parse(await readFile(resolve(process.env.MAGNA_V2_RECIPE), 'utf8'));
    await recipe(value => { for (const key of Object.keys(value)) delete value[key]; Object.assign(value, input.settings ?? input); });
  } else {
    await recipe(value => { value.runtime.compute = 'cpu'; });
    const count = weights().length;
    await page.locator('#generate-region').click();
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
    const rejected = await record('cpu-rejected-before-download');
    assert.match(rejected.toast, /WebGPU/); assert.equal(weights().length, count);
    assert.equal(await page.locator('#neural-download-warning').count(), 0);
    await recipe(value => { value.runtime.compute = 'auto'; });
    await page.locator('#region-name-origin-profile').selectOption('english');
    await page.locator('#region-name-origin-language').selectOption('en');
    await page.waitForFunction(() => document.querySelector('#map-names-apply').getAttribute('aria-busy') === 'false');
    await page.locator('#family-tab-settlements').click();
    assert.equal(await page.locator('#settlements-name-origin-profile').inputValue(),'english');
    await page.locator('#family-tab-region').click();
  }
  await run('01-neural');
  await page.locator('#view3d').click();
  await page.waitForFunction(() => document.querySelector('#view3d').getAttribute('aria-pressed') === 'true');
  await run('02-complete-map', '#run-chain');
  await page.waitForFunction(() => Number(document.querySelector('.city3d-info b')?.textContent.replace(/\D/g, '')) > 0, null, { timeout: 90000 });
  const full3d = await record('full-generation-in-3d', { info: await page.locator('.city3d-info').textContent() });
  assert.doesNotMatch(full3d.toast ?? '', /toDataURL|recursive use|unsafe aliasing/);
  await page.screenshot({ path: resolve(out, '02-complete-map-3d.png') });
  await page.locator('#view3d').click();
  const before = await project('before'); assert(before.buildings.length > 0);
  if(!process.env.MAGNA_V2_RECIPE) {
    assert.equal(before.regionProfile,'english');
    assert(before.names.every(e=>!e.profile || e.profile==='english'),'Global name origin did not reach every generated name');
    await page.locator('#family-tab-cities').click();
    await page.locator('[data-town="main"]').click();
    await page.locator('#city-name-origin-profile').selectOption('french');
    await page.waitForFunction(() => document.querySelector('#map-names-apply').getAttribute('aria-busy') === 'false');
    const local = await project('local-name-origin');
    assert.equal(local.names.find(e=>e.id==='settlement:main')?.profile,'french');
    assert.equal(local.regionProfile,'english');
    assert.equal(local.height,before.height); assert.deepEqual(local.buildings,before.buildings);
    await page.locator('#city-name-origin-profile').selectOption('');
    await page.waitForFunction(() => document.querySelector('#map-names-apply').getAttribute('aria-busy') === 'false');
    await record('name-origin-global-and-local',{architectureRetained:true,terrainRetained:true});
  }
  const edited = await editHouse(before);
  await reopen(edited.path);
  const restored = await project('reopened');
  assert.equal(restored.height, edited.height); assert.deepEqual(restored.buildings, edited.buildings);
  report.checks.push({ name: 'save-reopen', exactHeights: true, exactBuildings: true });
  await page.locator('#view3d').click();
  await page.waitForFunction(() => document.querySelector('#view3d').getAttribute('aria-pressed') === 'true');
  await page.screenshot({ path: resolve(out, '04-3d.png') });
  await page.locator('#view3d').click();
  await page.locator('#map-style').selectOption('satellite');
  await page.locator('#map-style').selectOption('parchment');
  await page.locator('#language-select').selectOption('en');
  await page.locator('#language-select').selectOption('fr');
  await record('3d-styles-locale');
  await recipe(value => { value.options.seed = `${value.options.seed}-cancel-inference`; });
  await page.locator('#family-tab-region').click();
  await page.locator('#generate-region').click();
  await page.waitForFunction(() => document.querySelector('#progress-label').textContent.includes('calcul coarse'), null, { timeout: 120000 });
  await page.locator('#cancel-job').click();
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  await run('05-after-gpu-cancel');
  const count = weights().length;
  await page.route('**/neural/**', route => route.abort('internetdisconnected'));
  await recipe(value => { value.options.seed = `${value.options.seed}-offline`; });
  await run('06-model-cache-offline');
  assert.equal(weights().length, count, 'Offline inference transferred model weights');
  assert.deepEqual(report.errors, []);
  assert.doesNotMatch(report.console.join('\n'), /recursive use of an object|unsafe aliasing|RuntimeError|unreachable|toDataURL/);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.stack ?? String(error);
  await record('failure').catch(() => {});
  if (await page.locator('#building-inspector').count()) report.inspector = await page.locator('#building-inspector').textContent().catch(() => undefined);
  await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  if (await page.locator('#expert-open').isVisible()) {
    await page.locator('#expert-open').click().catch(() => {});
    const failedRecipe = await page.locator('#expert-json').inputValue().catch(() => undefined);
    if (failedRecipe) await writeFile(resolve(out, 'failure.recipe.json'), failedRecipe);
  }
  console.error(report.failure); process.exitCode = 1;
} finally {
  clearInterval(progress); report.finished = new Date().toISOString();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
  console.log(`Live workshop: ${report.ok ? 'PASS' : 'FAIL'} · ${resolve(out, 'report.json')}`);
}
