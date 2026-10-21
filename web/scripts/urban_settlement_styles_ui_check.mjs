// From web/: node scripts/urban_settlement_styles_ui_check.mjs [Urban URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/urbanbench.html');
if (!url.searchParams.has('profile')) url.searchParams.set('profile', 'local');
url.searchParams.set('space', 'workshop'); url.searchParams.set('standalone', '1');
const out = 'out/buildings-parity'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1640, height: 1100 } });
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.addInitScript(() => {
  window.__styleResults = [];
  window.addEventListener('message', event => {
    if (event.data?.channel === 'magna-urban-workshop' && event.data.type === 'result' && event.data.result) window.__styleResults.push(event.data.result);
  });
});
const page = await context.newPage();
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const metric = data => JSON.parse(JSON.stringify(data, (_key, value) => typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value));
const ringArea = ring => Math.abs(ring.reduce((sum, a, i) => {
  const b = ring[(i + 1) % ring.length]; return sum + a.x * b.y - a.y * b.x;
}, 0)) * 0.5;
const shapeArea = shape => ringArea(shape.outer) - shape.holes.reduce((sum, hole) => sum + ringArea(hole), 0);
const surfaceArea = surface => surface.reduce((sum, shape) => sum + shapeArea(shape), 0);
const report = { url: url.href, cases: [], errors };
try {
  await page.goto(url.href);
  await page.locator('#urbanWorkshop iframe').waitFor();
  const frame = page.frames().find(frame => /testbench\.html/.test(frame.url()));
  assert.ok(frame);
  await frame.locator('#status').filter({ hasText: /^Rust · [0-9]+/ }).waitFor({ timeout: 120000 });
  async function full(name) {
    const count = await frame.evaluate(() => window.__styleResults.length);
    await frame.locator('[data-settlement-generate]').click();
    await frame.waitForFunction(count => window.__styleResults.slice(count).some(result => result.buildingState?.scene), count, { timeout: 240000 });
    await frame.locator('[data-buildings-status]').filter({ hasText: /^[0-9]+ bâtiments ·/ }).waitFor({ timeout: 240000 });
    const result = await frame.evaluate(() => window.__styleResults.filter(result => result.buildingState?.scene).at(-1));
    const scene = result.buildingState.scene;
    const plotArea = result.partitions.flatMap(p => p.parcels).filter(p => p.use === 'plot').reduce((sum, p) => sum + shapeArea(p.shape), 0);
    const builtCoverage = scene.buildings.reduce((sum, b) => sum + surfaceArea(b.footprint), 0) / plotArea;
    writeFileSync(`${out}/${name}.json`, JSON.stringify(result));
    assert.ok(scene.buildings.length > 0, `${name}: ${JSON.stringify(scene.refusals.slice(0, 4))}`);
    await frame.locator('#map').screenshot({ path: `${out}/${name}.png` });
    report.cases.push({ name, buildings: scene.buildings.length, refusals: scene.refusals.length, builtCoverage,
      cultures: [...new Set(scene.buildings.map(b => b.culture.culture))], recipes: [...new Set(scene.buildings.map(b => b.recipe_id))],
      variants: [...new Set(scene.buildings.map(b => b.variant_id))], sceneHash: hash(scene) });
    return result;
  }
  await frame.locator('#culture').selectOption('chinese');
  assert.equal(await frame.locator('[data-settlement-style]').inputValue(), 'culture');
  assert.equal(await frame.locator('[data-building-culture]').inputValue(), '');
  await frame.locator('#urbanPopulation').fill('3000');
  await frame.locator('[data-settlement-style]').selectOption('walled-core');
  const chinese = await full('chinese-walled-core');
  assert.equal(chinese.layouts[0].phases.length, 1);
  assert.ok(chinese.layouts[0].enclosures.length > 0);
  assert.ok(chinese.buildingState.scene.buildings.every(b => b.culture.culture === 'chinese'));
  assert.equal(chinese.partitions[0].config.density, 2);
  assert.ok(report.cases[0].builtCoverage > 0.3, 'Dense style must visibly occupy the plots instead of falling back to tiny houses');

  await frame.locator('#culture').selectOption('european-organic');
  await frame.locator('[data-settlement-style]').selectOption('dense-core');
  await frame.getByText('Contexte · forme, relief et contraintes', { exact: true }).click();
  await frame.getByText('Forme, croissance et parcellaire', { exact: true }).click();
  await frame.locator('[data-city-footprint="family"]').selectOption('fingers');
  await frame.locator('[data-native="suburbs"]').selectOption('none');
  await frame.locator('#urbanParcelDensity').fill('2');
  await frame.locator('[data-building-culture]').selectOption('chinese');
  const independent = await full('tentacular-dense-chinese');
  assert.equal(independent.layouts[0].culture, 'european-organic');
  assert.equal(independent.layouts[0].structure.family, 'fingers');
  assert.equal(independent.layouts[0].config.suburbs, 'none');
  assert.equal(independent.partitions[0].config.density, 2);
  assert.ok(independent.buildingState.scene.buildings.every(b => b.culture.culture === 'chinese'));

  const before = hash([independent.layouts, independent.partitions]);
  await frame.locator('[data-building-culture]').selectOption('european-organic');
  const count = await frame.evaluate(() => window.__styleResults.length);
  await frame.locator('[data-buildings-generate]').click();
  await frame.waitForFunction(count => window.__styleResults.slice(count).some(result => result.buildingState?.scene), count, { timeout: 240000 });
  const changed = await frame.evaluate(() => window.__styleResults.filter(result => result.buildingState?.scene).at(-1));
  writeFileSync(`${out}/changed-architecture.json`, JSON.stringify(changed));
  // Capacity reconciliation changes programme counters; cadastral geometry stays exact.
  assert.equal(hash(changed.layouts), hash(independent.layouts));
  assert.equal(hash(metric(changed.partitions.map(p => p.parcels))), hash(metric(independent.partitions.map(p => p.parcels))));
  assert.ok(changed.buildingState.scene.buildings.every(b => b.culture.culture === 'european-organic'));
  report.retainedPlanBeforeArchitectureChange = before;
  await frame.locator('#culture').selectOption('chinese');
  await frame.locator('#urbanPopulation').fill('200');
  await frame.locator('[data-settlement-style]').selectOption('village');
  assert.equal(await frame.locator('#urbanPopulation').inputValue(), '200');
  const village = await full('chinese-village-200');
  assert.equal(village.layouts[0].programme.population, 200);
  assert.equal(village.layouts[0].enclosures.length, 0);
  assert.ok(village.layouts[0].phases.every(phase => phase.zone === 'village'));
  assert.ok(village.buildingState.scene.buildings.every(b => b.culture.culture === 'chinese'));
  report.checks = ['Chinese cultural reset', 'single dense walled core', 'independent tentacular shape', 'no suburbs', 'dense parcels retained', 'independent Chinese architecture', 'architecture-only recalculation preserves cadastral geometry', '200-person Chinese village', 'planning population preserved across style changes'];
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/ui-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  console.error(await page.locator('body').innerText());
  for (const frame of page.frames()) if (/testbench\.html/.test(frame.url())) console.error(await frame.locator('#status').innerText(), await frame.locator('[data-buildings-status]').innerText());
  throw error;
} finally { await browser.close(); }
