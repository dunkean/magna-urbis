import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// From web/: node scripts/rust_pipeline_ui_check.mjs [shared bench origin]
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message); });
await context.addInitScript(() => {
  window.__imports = [];
  window.addEventListener('message', event => { if (event.data?.channel === 'magna-urban-workshop' && event.data.type === 'import') window.__imports.push(event.data); });
  window.__terrainGenerations = 0;
  const Base = window.Worker;
  window.Worker = class extends Base {
    constructor(...args) { super(...args); this.addEventListener('message', event => { if (event.data.terrain && event.data.kind === 'overview') window.__terrainGenerations++; }); }
  };
});
try {
  const params = new URLSearchParams({ seed: 'pipeline-check', relief: 'flat', width: '3000', compute: 'wasm', generation: 'cpu', hydro_enabled: '0', auto: '0',
    settlements: JSON.stringify({ config: { mode: 'counts', main: { population: 300 }, counts: { village: 1, hamlet: 1, farmstead: 0 } } }),
    roads: JSON.stringify({ enabled: true, config: { exits: 0 } }) });
  await page.goto(`${base}/rustbench.html#terrain?${params}`);
  const terrain = page.frameLocator('iframe[data-bench=terrain]');
  await terrain.locator('#generate').waitFor();
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[data-bench=terrain]');
    const status = frame?.contentDocument?.querySelector('#status');
    return status?.textContent.includes('overview') && !frame.contentDocument.querySelector('#generate').hasAttribute('aria-busy');
  }, null, { timeout: 120000 });
  assert.equal(await terrain.locator('#settlementStage').isVisible(), false);
  await terrain.locator('#transferExtent').selectOption('crop');
  await terrain.locator('#transferX').fill('500'); await terrain.locator('#transferY').fill('600'); await terrain.locator('#transferWidth').fill('1800');
  await terrain.locator('#pipelineSave').click();
  await terrain.locator('#pipelineStatus').filter({ hasText: 'Export conservé' }).waitFor({ timeout: 60000 });
  const terrainFrame = page.frames().find(f => f.url().includes('terrainbench.html'));
  const baseSnapshot = await terrainFrame.evaluate(async () => {
    const { listHistory, readHistory } = await import('/benchHistory.ts');
    const h = await listHistory(), d = await readHistory(h[0].entry.id);
    return { id: d.meta.id, n: d.raster.n, width: d.raster.width, height: Array.from(d.raster.height), crop: d.meta.pipeline.crop };
  });
  assert.ok(baseSnapshot.n > 2); assert.ok(baseSnapshot.width < 3000);
  await terrain.locator('#pipelineNext').click();
  const settlements = page.frameLocator('iframe[data-bench=settlements]');
  await settlements.locator('#pipelineTransfer').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => {
    const d = document.querySelector('iframe[data-bench=settlements]')?.contentDocument;
    return d?.querySelector('#urbanQuarterStage [data-status]')?.textContent.includes('îlots');
  }, null, { timeout: 120000 });
  const settlementsFrame = page.frames().find(f => f.url().includes('/terrainbench.html') && new URL(f.url()).searchParams.get('stage') === 'settlements');
  assert.equal(await settlementsFrame.evaluate(() => window.__terrainGenerations), 0);
  assert.equal(await settlements.locator('#urbanParcelStage [data-enabled]').isChecked(), false);
  const received = await settlementsFrame.evaluate(async () => {
    const { readHistory } = await import('/benchHistory.ts');
    const d = await readHistory(new URLSearchParams(location.search).get('artifact'));
    return { height: Array.from(d.raster.height), n: d.raster.n };
  });
  assert.deepEqual(received.height, baseSnapshot.height); assert.equal(received.n, baseSnapshot.n);
  const secondCity = await settlements.locator('#setList button').nth(1).getAttribute('data-key');
  await settlements.locator('#setList button').nth(1).click();
  assert.equal(await settlements.locator('#urbanTarget').inputValue(), secondCity);
  await settlements.locator('#pipelineNext').click();
  const urban = page.frameLocator('iframe[data-bench=urban]');
  await urban.locator('#urbanWorkshop').waitFor({ timeout: 60000 });
  const editor = urban.frameLocator('#urbanWorkshop iframe');
  await editor.locator('#map').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => {
    const u = document.querySelector('iframe[data-bench=urban]')?.contentDocument;
    const editor = u?.querySelector('#urbanWorkshop iframe');
    return editor?.contentWindow?.__imports?.length > 0 && u.querySelector('[data-to-map]')?.disabled === false;
  }, null, { timeout: 120000 });
  const urbanFrame = page.frames().find(f => f.url().includes('urbanbench.html'));
  const plan = await urbanFrame.evaluate(async () => {
    const { readHistory, listHistory } = await import('/benchHistory.ts');
    const d = await readHistory(new URLSearchParams(location.search).get('artifact'));
    const imported = document.querySelector('#urbanWorkshop iframe').contentWindow.__imports.at(-1);
    return { layouts: d.meta.pipeline.urban.layouts, imported: imported.state.layouts, radius: imported.radius, history: (await listHistory()).length, water: document.querySelector('#waterLayer').innerHTML.length, workshopSource: document.querySelector('[data-workshop-status]').textContent };
  });
  assert.deepEqual(plan.layouts, plan.imported); assert.ok(plan.radius > 0); assert.equal(plan.layouts.length, 1);
  assert.equal(plan.layouts[0].key, secondCity);
  await editor.locator('#parcels').click();
  await editor.locator('#status').filter({ hasText: /[1-9][0-9]* parcelles constructibles/ }).waitFor({ timeout: 120000 });
  const downloadPromise = page.waitForEvent('download');
  await urban.getByRole('button', { name: 'Conserver et partager .decor', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path(), bytes = await readFile(path);
  const portableContext = await browser.newContext();
  const portable = await portableContext.newPage();
  portable.on('pageerror', e => errors.push(e.message));
  await portable.goto(`${base}/urbanbench.html`);
  await portable.locator('#decorFiles').setInputFiles({ name: 'shared-city.decor', mimeType: 'application/octet-stream', buffer: bytes });
  await portable.waitForFunction(() => document.querySelector('#urbanQuarterStage [data-status]')?.textContent.includes('Plan conservé'), null, { timeout: 120000 });
  const roundtrip = await portable.evaluate(async () => {
    const { readHistory } = await import('/benchHistory.ts');
    const d = await readHistory(new URLSearchParams(location.search).get('artifact'));
    return { layouts: d.meta.pipeline.urban.layouts, parcels: d.meta.pipeline.urban.partitions.reduce((n, p) => n + p.parcels.length, 0), height: Array.from(d.raster.height) };
  });
  assert.deepEqual(roundtrip.layouts, plan.layouts); assert.deepEqual(roundtrip.height, baseSnapshot.height); assert.ok(roundtrip.parcels > 0);
  await portableContext.close();
  await page.reload();
  await page.waitForFunction(() => /[1-9][0-9]* parcelles constructibles/.test(document.querySelector('iframe[data-bench=urban]')?.contentDocument?.querySelector('#urbanWorkshop iframe')?.contentDocument?.querySelector('#status')?.textContent ?? ''), null, { timeout: 120000 });
  assert.equal(errors.length, 0, errors.join('\n'));
  const legacy = await context.newPage(); legacy.on('pageerror', e => errors.push(e.message));
  await legacy.goto(`${base}/terrainbench.html?${params}&pipeline=legacy&urban=${encodeURIComponent(JSON.stringify({ enabled: false, parcelEnabled: false }))}`);
  await legacy.waitForFunction(() => window.magnaDecor?.ready(), null, { timeout: 120000 });
  assert.ok(await legacy.evaluate(() => window.magnaDecor.export('legacy.decor').base64.length > 0));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, raster: `${baseSnapshot.n}²`, crop: baseSnapshot.crop, layouts: plan.layouts.length, blocks: plan.layouts[0].blocks.length, parcels: roundtrip.parcels, history: plan.history, exactHeights: true, exactWorkshopPlan: true, portableRoundtrip: true, selectedSecondCity: true, reload: true, errors }, null, 2));
} catch (e) {
  console.log('URLS', page.frames().map(f => f.url().slice(0, 220)));
  for (const f of page.frames()) console.log('STATUS', await f.locator('#status, #pipelineStatus, #setStatus, [data-status], [data-workshop-status]').allTextContents().catch(() => []));
  throw e;
} finally { await browser.close(); }


