// From web/: node scripts/urban_buildings_ui_check.mjs [Urban URL] [--audit]
// One reproducible case per family, then exact applied-scene presentation/replay.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const url = new URL(process.argv.find(arg => /^(https?|file):/.test(arg)) ?? 'http://127.0.0.1:5173/urbanbench.html');
url.searchParams.set('space', 'workshop'); url.searchParams.set('profile', 'web'); url.searchParams.set('standalone', '1');
const auditOnly = process.argv.includes('--audit');
const references = process.argv.includes('--references');
const flowOnly = process.argv.includes('--flow-only');
const onlyCulture = process.argv.find(arg => arg.startsWith('--culture='))?.split('=')[1];
const onlyReference = process.argv.find(arg => arg.startsWith('--reference='))?.split('=')[1];
const programmeRole = process.argv.find(arg => arg.startsWith('--role='))?.split('=')[1];
const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6)
  ?? `${references ? 'out/urban-building-references' : 'out/urban-buildings'}${programmeRole ? `-${programmeRole}` : ''}${url.protocol === 'file:' ? '-offline' : ''}`;
mkdirSync(out, { recursive: true });
const cases = [
  { culture: 'european-organic', label: 'organic' },
  { culture: 'bastide', label: 'regular' },
  { culture: 'medina', label: 'courtyard' },
  { culture: 'sahel', label: 'compound' },
  { culture: 'stilt-town', label: 'water-supports' },
  { culture: 'elven', label: 'fantasy' },
].filter(entry => !onlyCulture || entry.culture === onlyCulture);
if (references) cases.splice(0, cases.length,
  { culture: 'bastide', label: 'town-2500', reference: 'regular-town-2500' },
  { culture: 'halfling', label: 'village-200', reference: 'rural-fantasy-200' },
  { culture: 'european-organic', label: 'artisan-suburb', reference: 'organic-suburb' });
if (onlyReference) {
  const selected = cases.find(c => c.reference === onlyReference);
  const cultures = { courtyard: 'medina', compound: 'sahel', riverbank: 'stilt-town', slope: 'newar' };
  assert.ok(selected || cultures[onlyReference], `Unknown review reference: ${onlyReference}`);
  cases.splice(0, cases.length, selected ?? { culture: cultures[onlyReference], label: onlyReference, reference: onlyReference });
}
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=BackForwardCache'] });
const context = await browser.newContext({ viewport: { width: 1650, height: 1100 }, acceptDownloads: true });
const network = [];
if (url.protocol === 'file:') await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
const errors = [], consoleErrors = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
});
await context.addInitScript(() => {
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); this.addEventListener('message', event => { if (event.data?.scene && event.data?.timing) window.__urbanTiming = event.data.timing; }); }
  };
  window.addEventListener('message', event => {
    if (event.data?.channel !== 'magna-urban-workshop') return;
    if (event.data.type === 'result') window.__urbanResult = event.data.result;
    if (event.data.type === 'state' && event.data.state?.buildingState?.scene) {
      window.__urbanApplied = event.data.state; window.__urbanScene = event.data.state.buildingState.scene;
    }
  });
});
const page = await context.newPage();
const editor = () => page.frameLocator('#urbanWorkshop iframe');
const done = () => editor().locator('#status').filter({ hasText: /^Rust · [0-9]+/ }).waitFor({ timeout: 120000 });
const scene = () => editor().locator('#map').evaluate(() => window.__urbanResult?.buildingState?.scene);
const built = () => editor().locator('[data-buildings-status]').filter({ hasText: /^[0-9]+ bâtiments ·/ }).waitFor({ timeout: 120000 });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function assertWorldSurface(local, world, transform) {
  const angle = transform.orientation_deg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  assert.equal(local.length, world.length);
  for (let i = 0; i < local.length; i++) {
    const rings = [local[i].outer, ...local[i].holes], expected = [world[i].outer, ...world[i].holes];
    assert.equal(rings.length, expected.length);
    for (let j = 0; j < rings.length; j++) {
      assert.equal(rings[j].length, expected[j].length);
      for (let k = 0; k < rings[j].length; k++) {
        const p = rings[j][k], q = expected[j][k];
        assert.ok(Math.hypot(transform.origin.x + p.x * c - p.y * s - q.x, transform.origin.y + p.x * s + p.y * c - q.y) < 1e-6, 'House footprint must be the exact retained world placement.');
      }
    }
  }
}
const report = { url: url.href, gpu: 'SwiftShader software renderer; functional check, not a hardware GPU benchmark', cases: [], checks: [], errors, consoleErrors, network };
let reviewScene, reviewUrl;
async function generateCase(entry) {
  await page.goto(url.href); await done();
  if (entry.reference) {
    await editor().locator('[data-urban-reference]').selectOption(entry.reference);
    await editor().locator('[data-urban-reference-load]').click();
    await editor().locator('[data-urban-reference-load]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#urbanWorkshop iframe')?.contentDocument?.querySelector('[data-urban-reference-load]')?.disabled, null, { timeout: 120000 });
    await done();
  } else {
  await editor().locator('#culture').selectOption(entry.culture);
  await editor().locator('#layoutSeed').fill('urban-buildings-review-v1');
  await editor().locator('#plotSeed').fill('urban-buildings-review-v1');
  await editor().locator('#layout').click(); await done();
  await editor().locator('#plotSeed').fill('urban-buildings-review-v1');
  await editor().locator('#parcels').click(); await done();
  }
  if (programmeRole) {
    const isolated = ['isolated-farm', 'roadside-temple', 'isolated-shrine', 'isolated-mill', 'isolated-inn', 'isolated-tower'].includes(programmeRole);
    await editor().locator('[data-programme-intent]').selectOption(isolated ? programmeRole : 'settlement');
    if (!isolated) {
      await editor().locator('[data-programme-functions-auto]').click();
      if (programmeRole !== 'auto') {
        const key = programmeRole === 'crossroads' ? 'commerce' : programmeRole;
        assert.ok(['agricultural', 'commerce', 'artisan', 'riverine', 'port', 'capital'].includes(key), `Unsupported role alias: ${programmeRole}`);
        await editor().locator('[data-programme-custom-functions]').check();
        await editor().locator(`[data-programme-function="${key}"]`).fill('1');
      }
    }
    if (programmeRole === 'port') await editor().locator('[data-programme="navigableAccess"]').check();
    await editor().locator('[data-programme-apply]').click(); await done();
    await editor().locator('#parcels').click(); await done();
  }
  const inputs = await editor().locator('#map').evaluate(() => {
    const result = window.__urbanResult;
    return { ...result, surface: result?.surface && { ...result.surface, height: Array.from(result.surface.height), water: Array.from(result.surface.water), waterLevel: Array.from(result.surface.waterLevel) } };
  });
  writeFileSync(`${out}/${entry.label}.inputs.json`, JSON.stringify(inputs));
  if (!entry.reference) await editor().locator('[data-building-seed]').fill('urban-buildings-review-v1');
  const buildingSeed = await editor().locator('[data-building-seed]').inputValue(), started = Date.now();
  await editor().locator('[data-buildings-generate]').click();
  await editor().locator('[data-buildings-status]').filter({ hasText: /^[0-9]+ bâtiments ·|^Error:/ }).waitFor({ timeout: 120000 });
  const status = await editor().locator('[data-buildings-status]').textContent();
  if (status.startsWith('Error:')) throw new Error(`${entry.culture}: ${status}`);
  const applied = await scene();
  assert.ok(applied, 'Successful generation must publish its applied native scene.');
  const result = await editor().locator('#map').evaluate(() => window.__urbanResult);
  await page.waitForFunction(seed => {
    try {
      const raw = new URL(location.href).searchParams.get('workshop');
      return raw && JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))).buildingSettings?.seed === seed;
    } catch { return false; }
  }, buildingSeed, { timeout: 10000 });
  const refusals = Object.fromEntries([...new Set(applied.refusals.map(r => r.code))].map(code => [code, applied.refusals.filter(r => r.code === code).length]));
  const parcels = result?.partitions?.flatMap(p => p.parcels) ?? [];
  const record = {
    ...entry, buildingSeed, parcels: parcels.length, proposed: applied.buildings.length + applied.refusals.length,
    accepted: applied.buildings.length, refused: applied.refusals.length, openSpaces: applied.open_spaces.length,
    acceptedFraction: applied.buildings.length / Math.max(1, applied.buildings.length + applied.refusals.length), refusals,
    packs: [...new Set(applied.buildings.map(b => b.culture.pack))], functions: [...new Set(applied.buildings.map(b => b.function))],
    sceneHash: hash(applied), replayUrl: page.url(), wallMs: Date.now() - started, timing: await page.evaluate(() => window.__urbanTiming), status: await editor().locator('[data-buildings-status]').textContent(),
  };
  writeFileSync(`${out}/${entry.label}.scene.json`, JSON.stringify(applied));
  await editor().locator('#map').screenshot({ path: `${out}/${entry.label}-2d.png` });
  report.cases.push(record); console.log(JSON.stringify({ ...record, replayUrl: '[saved in result.json]' }));
  return applied;
}
try {
  for (const entry of flowOnly ? [] : cases) {
    const applied = await generateCase(entry);
    if (entry.culture === 'european-organic') { reviewScene = applied; reviewUrl = page.url(); }
  }
  if (flowOnly) {
    await page.goto(url.href); await done();
    reviewScene = await scene(); reviewUrl = page.url();
    assert.ok(reviewScene?.buildings.length, 'Flow review needs an applied city scene URL.');
  } else report.checks.push('native culture/parcel/programme/placement cases');
  if (!auditOnly) assert.ok(report.cases.every(c => c.accepted > 0), 'Every reviewed family needs at least one accepted building; inspect refusal reports.');
  if (!auditOnly) {
    await page.goto(reviewUrl); await done();
    await built();
    assert.equal(hash(await scene()), hash(reviewScene), 'Applied scene must replay exactly.');
    for (const [selector, title] of [
      ['button[title="Méthode du cadastre et des familles parcellaires"]', 'Continuous frontage and cultural parcels'],
      ['#urbanProgrammeStage button[aria-label="Lire la note de méthode"]', 'Urban programme and bounded allocation'],
      ['#urbanBuildingStage button[aria-label="Lire la note de méthode"]', 'External architectural placement'],
      ['button[title="Styles, hauteurs et rendu 2D / 3D"]', 'Applied urban buildings in 2D and perspective'],
    ]) {
      const button = editor().locator(selector);
      await button.evaluate(node => { const details = node.closest('details'); if (details) details.open = true; });
      await button.click();
      await editor().locator('dialog.method-note[open] #methodNoteTitle').filter({ hasText: title }).waitFor();
      assert.ok((await editor().locator('dialog.method-note article').textContent()).length > 500);
      await editor().locator('dialog.method-note button[aria-label="Fermer la note"]').click();
    }
    report.checks.push('four bundled method notes open from their controls');
    const expected = hash(await scene());
    const sceneDownload = page.waitForEvent('download'); await editor().locator('[data-building-json]').click();
    const exportedScene = `${out}/organic-scene-export.json`; await (await sceneDownload).saveAs(exportedScene);
    assert.equal(hash(JSON.parse(readFileSync(exportedScene, 'utf8'))), hash(await scene()), 'JSON export must retain the exact applied native scene.');
    report.checks.push('exact building-scene JSON export');
    for (const style of ['geometric', 'cartographic']) {
      await editor().locator('[data-building-style]').selectOption(style);
      assert.equal(hash(await scene()), expected, 'Changing appearance must preserve geometry.');
    }
    await editor().locator('[data-building-diagnostic]').selectOption('height');
    await editor().locator('[data-building-visible]').uncheck();
    assert.equal(await editor().locator('[data-urban-building]').count(), 0);
    assert.equal(hash(await scene()), expected, 'Hiding a layer must preserve the applied scene.');
    await editor().locator('[data-building-visible]').check();
    for (const format of ['svg', 'png']) {
      await editor().locator(`[data-urban-export="${format}"]`).click();
      await editor().locator('dialog.export-crop').waitFor({ state: 'visible' });
      const download = page.waitForEvent('download');
      await editor().locator('dialog.export-crop [data-action="export"]').click();
      const saved = await download; await saved.saveAs(`${out}/organic-plan.${format}`);
      assert.ok(readFileSync(`${out}/organic-plan.${format}`).length > 1000);
      assert.equal(hash(await scene()), expected, 'Export must preserve the applied scene.');
    }
    await editor().locator('[data-building-3d]').click();
    await editor().locator('.urban-perspective-canvas').waitFor({ state: 'visible' });
    await editor().locator('.urban-perspective-canvas').screenshot({ path: `${out}/organic-3d.png` });
    const capture = page.waitForEvent('download'); await editor().locator('[data-urban-3d-capture]').click();
    await (await capture).saveAs(`${out}/organic-3d-capture.png`);
    assert.equal(hash(await scene()), expected, 'Opening perspective must preserve geometry.');
    await editor().locator('[data-building-3d]').click();
    assert.equal(hash(await scene()), expected, 'Returning to plan must preserve geometry.');
    report.checks.push('exact URL replay', 'two styles', 'layer hide/show', 'physical-height diagnostic', 'SVG/PNG plan exports', '2D/3D same scene', '3D PNG capture');
    const selected = (await scene()).buildings.find(b => b.function === 'domestic' || b.function === 'mixed');
    assert.ok(selected, 'Review case needs a domestic building for the house workshop.');
    await editor().locator(`[data-urban-building="${selected.id}"]`).first().click({ force: true });
    await editor().locator('[data-building-inspection]').filter({ hasText: selected.recipe_id }).waitFor();
    const returnUrl = page.url();
    await editor().locator('[data-open-house]').click();
    await page.waitForURL(target => target.pathname.endsWith('housebench.html') || target.hash.startsWith('#houses'), { timeout: 30000 });
    const house = page.url().includes('rustbench.html') ? page.frameLocator('iframe[data-bench="houses"]') : page;
    await house.locator('#status').filter({ hasText: /Copie du bâtiment/ }).waitFor({ timeout: 120000 });
    assert.equal(await house.locator('#error').isVisible(), false, await house.locator('#error').textContent());
    const download = page.waitForEvent('download'); await house.locator('#export-json').click();
    const saved = await download, path = `${out}/house-enrichment.json`; await saved.saveAs(path);
    const batch = JSON.parse(readFileSync(path, 'utf8')), unit = batch.units[0];
    assert.equal(unit.recipe_id, selected.recipe_id); assert.deepEqual(unit.transform, selected.transform);
    assert.equal(unit.bodies.length, selected.volumes.length);
    for (let i = 0; i < unit.bodies.length; i++) {
      assertWorldSurface(unit.bodies[i].footprint, selected.volumes[i].footprint, selected.transform);
      assert.equal(unit.bodies[i].levels.length, selected.volumes[i].levels.length);
      for (let j = 0; j < unit.bodies[i].levels.length; j++) {
      const local = unit.bodies[i].levels[j], placed = selected.volumes[i].levels[j];
      assertWorldSurface(local.footprint, placed.footprint, selected.transform);
      assert.ok(Math.abs(local.z_m + selected.ground_z_m - placed.z_m) < 1e-6);
      assert.equal(local.height_m, placed.height_m);
      }
    }
    await page.screenshot({ path: `${out}/house-enrichment.png` });
    await page.goto(returnUrl); await done(); await built();
    assert.equal(hash(await scene()), expected, 'House workshop and return must preserve the city scene.');
    report.checks.push('building inspection', 'exact house enrichment', 'return to unchanged city');
  }
  assert.deepEqual(errors, [], 'Unexpected page errors.');
  assert.deepEqual(network, [], 'Standalone file workflow must not attempt HTTP requests.');
  writeFileSync(`${out}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checked: report.checks, errors, consoleErrors }));
} catch (error) {
  report.failure = String(error); report.status = await editor().locator('[data-buildings-status]').textContent().catch(() => ''); writeFileSync(`${out}/result.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
