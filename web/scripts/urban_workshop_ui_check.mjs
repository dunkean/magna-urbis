// From web/: node scripts/urban_workshop_ui_check.mjs [Urban Bench URL] [optional .decor file]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5174/urbanbench.html');
url.searchParams.set('space', 'workshop');
url.searchParams.set('standalone', '1');
const out = 'out/urban-workshop'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.addEventListener('message', event => {
    if (event.data?.channel !== 'magna-urban-workshop') return;
    if (event.data.type === 'import') window.__workshopImport = event.data.state;
    if (event.data.type === 'result') window.__workshopResult = event.data.result;
  });
});
const done = frame => frame.locator('#status').filter({ hasText: /^Rust · [0-9]+/ }).waitFor({ timeout: 120000 });
try {
  await page.goto(url.href);
  const editor = page.frameLocator('#urbanWorkshop iframe');
  await done(editor);
  assert.equal(await editor.locator('#engine').inputValue(), 'rust');
  assert.equal(await editor.locator('#houses').isVisible(), false);
  await editor.locator('#mode').selectOption('micro');
  await editor.locator('#layout').click(); await done(editor);
  await editor.locator('#parcels').click(); await done(editor);
  const blocks = await editor.locator('#map').evaluate(() => JSON.stringify(window.__workshopResult.layouts));
  await editor.locator('#plotSeed').fill('workshop-replay');
  await editor.locator('#parcels').click(); await done(editor);
  assert.equal(await editor.locator('#map').evaluate(() => JSON.stringify(window.__workshopResult.layouts)), blocks, 'Parcel edits must preserve every native block and street');
  const parcels = await editor.locator('#map').evaluate(() => JSON.stringify(window.__workshopResult.partitions));
  await page.waitForFunction(() => {
    const value = new URL(location.href).searchParams.get('workshop');
    return value && JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/'))).plotSeed === 'workshop-replay';
  });
  const replayUrl = page.url();
  await page.reload();
  const replay = page.frameLocator('#urbanWorkshop iframe'); await done(replay);
  assert.equal(await replay.locator('#plotSeed').inputValue(), 'workshop-replay');
  assert.equal(await replay.locator('#map').evaluate(() => JSON.stringify(window.__workshopResult.partitions)), parcels, 'Shared workshop link must reproduce exact native parcels');
  await replay.locator('#map').screenshot({ path: `${out}/micro.png` });
  if (process.argv[3]) {
    const raw = gunzipSync(readFileSync(process.argv[3]));
    const decorId = JSON.parse(raw.subarray(12, 12 + raw.readUInt32LE(8)).toString()).meta.id;
    await page.locator('#decorFiles').setInputFiles(process.argv[3]);
    // A previous decor may already have a completed layout. Wait for this file.
    await page.waitForFunction(id => new URL(location.href).searchParams.get('decor') === id, decorId, { timeout: 120000 });
    await page.locator('#urbanQuarterStage [data-status]').filter({ hasText: /^Rust · [0-9]+ settlement/ }).waitFor({ state: 'attached', timeout: 120000 });
    await page.locator('[data-from-map]').click();
    await replay.locator('#editorSource').filter({ hasText: 'plan de la carte' }).waitFor();
    const importedRecipe = await replay.locator('#map').evaluate(() => window.__workshopImport.parcelConfig.recipe);
    assert.equal(await replay.locator('#recipe').inputValue(), importedRecipe, 'Imported composition must expose its applied recipe selection');
    const imported = await replay.locator('#map').evaluate(() => JSON.stringify(window.__workshopImport.layouts));
    await replay.locator('#parcels').click(); await done(replay);
    assert.equal(await replay.locator('#map').evaluate(() => JSON.stringify(window.__workshopResult.layouts)), imported, 'Map import must retain exact native geometry through parcel edits');
    await replay.locator('#map').screenshot({ path: `${out}/map-plan.png` });
    await replay.locator('[data-native="fortification"]').selectOption('wall');
    await replay.locator('#layout').click(); await done(replay);
    assert.ok(await replay.locator('#map').evaluate(() => window.__workshopResult.layouts.some(l => l.enclosures.length)), 'The workshop case must contain a real wall');
    const wallCase = JSON.parse(Buffer.from(new URL(page.url()).searchParams.get('workshop'), 'base64url').toString());
    await replay.locator('#count').fill('8'); await replay.locator('#layoutSeed').fill('unapplied-wall-seed');
    await replay.locator('[data-remove-enclosure]').click(); await done(replay);
    assert.ok(await replay.locator('#map').evaluate(() => window.__workshopResult.layouts.every(l => !l.enclosures.length)), 'Workshop removal must remove native walls');
    assert.equal(await replay.locator('#count').inputValue(), '8', 'Wall removal must retain other drafts');
    const openCase = JSON.parse(Buffer.from(new URL(page.url()).searchParams.get('workshop'), 'base64url').toString());
    assert.equal(openCase.layoutSeed, wallCase.layoutSeed); assert.deepEqual(openCase.options, wallCase.options);
    assert.equal(openCase.urban.layoutConfig.fortification, 'none');
    await page.locator('[data-to-map]').click();
    assert.equal(await page.locator('.terrain-workspace').isVisible(), true);
    await page.locator('#urbanQuarterStage [data-status]').filter({ hasText: /^Rust · [0-9]+ settlement/ }).waitFor({ timeout: 120000 });
    assert.equal(await page.locator('#urbanOverlay [data-enclosure]').count(), 0);
  }
  assert.deepEqual(errors, []);
  const result = { replayUrl, errors, checked: ['native editor', 'micro shapes', 'retained geometry', 'exact URL replay', ...(process.argv[3] ? ['map import', 'map apply'] : [])] };
  writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, replayUrl: `${replayUrl.length} characters` }));
} catch (error) {
  const editor = page.frameLocator('#urbanWorkshop iframe');
  console.error(JSON.stringify({ errors, status: await editor.locator('#status').textContent().catch(() => ''), source: await editor.locator('#editorSource').textContent().catch(() => ''), map: await page.locator('#urbanQuarterStage [data-status]').textContent().catch(() => ''), note: await page.locator('[data-workshop-status]').textContent().catch(() => '') }));
  await page.screenshot({ path: `${out}/failure.png` });
  throw error;
} finally { await browser.close(); }
