import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';

// From web/: node scripts/recipe_ui_check.mjs [Vite origin]
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], contexts = [];
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  contexts.push(context);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); return page;
}
async function child(page, stage) {
  await page.locator(`iframe[data-bench=${stage}]`).waitFor();
  const frame = await (await page.locator(`iframe[data-bench=${stage}]`).elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.magnaRecipe && window.magnaBenchContext?.ready(), null, { timeout: 120000 });
  return frame;
}
async function exported(page) {
  await page.locator('[data-recipe-export]').click();
  await page.locator('.recipe-dialog [data-copy]:enabled').waitFor({ timeout: 30000 });
  return page.locator('.recipe-dialog textarea').inputValue();
}
async function paste(page, code) {
  await page.locator('[data-recipe-import]').click();
  await page.locator('.recipe-dialog textarea').fill(code);
  await page.locator('.recipe-dialog [data-load]').click();
  if (code !== 'MU.invalid') await page.locator('.recipe-dialog').waitFor({ state: 'hidden', timeout: 180000 });
}
async function snapshot(frame) {
  return frame.evaluate(async () => {
    const r = await window.magnaRecipe.capture();
    const q = Object.fromEntries(new URLSearchParams(r.query));
    return { stage: r.stage, query: q, paths: Array.from(document.querySelectorAll('#terrainOverview path')).map(p => p.getAttribute('d')) };
  });
}
try {
  const page = await fresh();
  const params = new URLSearchParams({ seed: 'recipe-debug', relief: 'flat', width: '3000', compute: 'wasm', generation: 'cpu', render: 'svg',
    hydro_enabled: '0', auto: '0', refine: '0', pins: '123.4,567.8,caf%C3%A9%20%26%20toit', showPins: '0', view: '1200,1400,0.25',
    settlements: JSON.stringify({ config: { mode: 'counts', main: { population: 100 }, counts: { village: 0, hamlet: 1, farmstead: 0 } } }),
    roads: JSON.stringify({ enabled: false }), urban: JSON.stringify({ enabled: false, parcelEnabled: false }) });
  await page.goto(`${base}/rustbench.html#terrain?${params}`);
  const terrain = await child(page, 'terrain');
  const before = await snapshot(terrain);
  assert.ok(before.paths.length > 0, 'terrain SVG rendered');
  await terrain.locator('#seed').fill('UNAPPLIED-DRAFT');
  const code = await exported(page);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-download]').click(); const download = await downloadEvent;
  assert.ok(download.suggestedFilename().endsWith('.murecipe'));
  const file = await readFile(await download.path()); assert.equal(file.toString().trim(), code);
  await mkdir('out', { recursive: true }); await page.screenshot({ path: 'out/recipe-dialog.png' });
  console.log(`Procedural terrain: URL ${terrain.url().length} chars → code ${code.length} chars.`);

  // Reproduce in a new browser context, with no session or IndexedDB data.
  const target = await fresh(); await target.goto(`${base}/rustbench.html`);
  await paste(target, code.match(/.{1,80}/g).join('\n'));
  const replay = await child(target, 'terrain');
  assert.deepEqual(await snapshot(replay), before);
  assert.equal(await replay.locator('#seed').inputValue(), 'recipe-debug');

  // Invalid input leaves the map in place. Importing the same code resets drafts as well.
  await paste(target, 'MU.invalid');
  assert.match(await target.locator('.recipe-dialog [role=status]').textContent(), /Code/);
  await target.locator('.recipe-close').click();
  await replay.locator('#seed').fill('ANOTHER-DRAFT');
  await paste(target, code); const reset = await child(target, 'terrain');
  assert.equal(await reset.locator('#seed').inputValue(), 'recipe-debug');

  // File import has the same result as paste, including pins, visibility and camera.
  const fromFile = await fresh(); await fromFile.goto(`${base}/rustbench.html`);
  await fromFile.locator('[data-recipe-import]').click();
  await fromFile.locator('[data-file]').setInputFiles({ name: download.suggestedFilename(), mimeType: 'text/plain', buffer: file });
  await fromFile.locator('.recipe-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(await snapshot(await child(fromFile, 'terrain')), before);

  // Transfer a crop: the recipe must carry its local raster to a fresh browser.
  await reset.locator('#transferExtent').selectOption('crop'); await reset.locator('#transferWidth').fill('1000');
  await reset.locator('#pipelineNext').click();
  const settlements = await child(target, 'settlements');
  const settlementCode = await exported(target); await target.locator('.recipe-close').click();
  const originalRecipe = await settlements.evaluate(() => window.magnaRecipe.capture());
  assert.ok(originalRecipe.terrain, 'new procedural exports share their source recipe');
  assert.ok(settlementCode.length < 2500, 'retained procedural crop stays compact');
  const portableTarget = await fresh(); await portableTarget.goto(`${base}/rustbench.html`);
  await paste(portableTarget, settlementCode); const retained = await child(portableTarget, 'settlements');
  const restored = await retained.evaluate(async () => {
    const { readHistory } = await import('/benchHistory.ts');
    const r = await window.magnaRecipe.capture(), d = await readHistory(new URLSearchParams(r.query).get('artifact'));
    const hashes = {};
    for (const key of ['height', 'water', 'waterLevel', 'riverWidth', 'riverIds']) hashes[key] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', d.raster[key])));
    return { width: d.raster.width, hashes, geometry: d.raster.geometry, waterSvg: d.meta.waterSvg, q: Object.fromEntries(new URLSearchParams(r.query)) };
  });
  const original = await settlements.evaluate(async () => {
    const { readHistory } = await import('/benchHistory.ts');
    const r = await window.magnaRecipe.capture(), d = await readHistory(new URLSearchParams(r.query).get('artifact'));
    const hashes = {};
    for (const key of ['height', 'water', 'waterLevel', 'riverWidth', 'riverIds']) hashes[key] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', d.raster[key])));
    return { width: d.raster.width, hashes, geometry: d.raster.geometry, waterSvg: d.meta.waterSvg, q: Object.fromEntries(new URLSearchParams(r.query)) };
  });
  assert.equal(restored.width, original.width);
  assert.ok(Math.abs(restored.width - 1000) < 6, 'crop aligns to source cells');
  assert.deepEqual(restored.hashes, original.hashes);
  assert.deepEqual(restored.geometry, original.geometry); assert.equal(restored.waterSvg, original.waterSvg);
  delete restored.q.artifact; delete original.q.artifact;
  assert.deepEqual(restored.q, original.q);
  console.log(`Retained crop: ${settlementCode.length} chars, raster restored byte-for-byte in a fresh browser.`);

  // Urban input is also portable; keep the selected city and current urban configuration.
  const urbanQuery = new URLSearchParams(originalRecipe.query);
  urbanQuery.set('decor', urbanQuery.get('artifact'));
  urbanQuery.set('city', JSON.stringify({ key: 'debug-city', center: { x: 500, y: 500 }, population: 100, culture: 'european-organic', name: 'Repro', radius: 50, roads: 'none' }));
  await target.goto(`${base}/rustbench.html#urban?${urbanQuery}`);
  const urban = await child(target, 'urban');
  await urban.locator('#showWater').uncheck(); await urban.locator('#baseOpacity').selectOption('0.3');
  const urbanCode = await exported(target); await target.locator('.recipe-close').click();
  const urbanBefore = await urban.evaluate(async () => Object.fromEntries(new URLSearchParams((await window.magnaRecipe.capture()).query)));
  await paste(portableTarget, urbanCode); const urbanReplay = await child(portableTarget, 'urban');
  const urbanAfter = await urbanReplay.evaluate(async () => Object.fromEntries(new URLSearchParams((await window.magnaRecipe.capture()).query)));
  for (const q of [urbanBefore, urbanAfter]) { delete q.artifact; delete q.decor; }
  assert.deepEqual(urbanAfter, urbanBefore);
  assert.equal(await urbanReplay.locator('#showWater').isChecked(), false);
  assert.equal(await urbanReplay.locator('#baseOpacity').inputValue(), '0.3');
  console.log(`Urban: ${urbanCode.length} chars, selected city and settings restored.`);

  // Imported/legacy rasters without regeneration metadata remain self-contained.
  const fallbackCode = await retained.evaluate(async () => {
    const { readHistory } = await import('/benchHistory.ts');
    const { portableRecipe } = await import('/recipeSharing.ts'); const { encodeRecipe } = await import('/recipe.ts');
    const r = await window.magnaRecipe.capture(), d = await readHistory(new URLSearchParams(r.query).get('artifact'));
    delete d.meta.regeneration;
    const fallback = await portableRecipe('settlements', r.query, d);
    if (!fallback.decor) throw new Error('Expected binary raster fallback');
    return encodeRecipe(fallback);
  });
  await paste(portableTarget, fallbackCode); await child(portableTarget, 'settlements');
  assert.ok(fallbackCode.length > settlementCode.length);

  // A browser-local heightmap reference is resolved into the shared code.
  await terrain.evaluate(async () => {
    const { storeSketch, decodeSketch } = await import('/terrainSketchSharing.ts');
    const { portableRecipe } = await import('/recipeSharing.ts'); const { encodeRecipe, decodeRecipe } = await import('/recipe.ts');
    const sketch = { version: 1, resolution: 8, heights: Array.from({ length: 64 }, (_, i) => i / 4) };
    const id = await storeSketch(sketch), r = decodeRecipe(encodeRecipe(await portableRecipe('terrain', `heightmap=${id}`)));
    const params = new URLSearchParams(r.query);
    if (params.has('heightmap') || JSON.stringify(decodeSketch(params.get('sketch'))) !== JSON.stringify(sketch)) throw new Error('Local heightmap was not embedded');
  });
  console.log('Legacy binary raster and local heightmap references also restored.');

  // Houses export their applied batch, not form drafts.
  await page.locator('.recipe-close').click(); await page.locator('nav [data-bench=houses]').click();
  const houses = await child(page, 'houses');
  const housesCode = await exported(page); await page.locator('.recipe-close').click();
  const housesBefore = await houses.evaluate(async () => (await window.magnaRecipe.capture()).query);
  await paste(fromFile, housesCode); const housesReplay = await child(fromFile, 'houses');
  assert.equal(await housesReplay.evaluate(async () => (await window.magnaRecipe.capture()).query), housesBefore);
  console.log(`Houses: ${housesCode.length} chars, applied batch and view restored.`);
  assert.deepEqual(errors, []);
  console.log('Recipe copy/paste, file download/import, fresh-browser replay, crop, pins/view, drafts and invalid-input checks passed.');
} finally {
  await browser.close();
}
