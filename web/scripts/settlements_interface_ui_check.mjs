import { chromium } from 'playwright';
import assert from 'node:assert/strict';
// From web/: node scripts/settlements_interface_ui_check.mjs [shared bench origin]
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
  const params = new URLSearchParams({ source: 'procedural', seed: 'pipeline-check', relief: 'flat', width: '3000', compute: 'wasm', generation: 'cpu', hydro_enabled: '0', auto: '0',
    settlements: JSON.stringify({ config: { mode: 'counts', main: { population: 300 }, counts: { village: 1, hamlet: 1, farmstead: 0 } } }),
    roads: JSON.stringify({ enabled: true, config: { exits: 0 } }) });
  await page.goto(`${base}/rustbench.html#terrain?${params}`);
  const terrain = page.frameLocator('iframe[data-bench=terrain]');
  await terrain.locator('#generate').waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[data-bench=terrain]');
    const status = frame?.contentDocument?.querySelector('#status');
    return status?.textContent.includes('overview') && !frame.contentDocument.querySelector('#generate').hasAttribute('aria-busy');
  }, null, { timeout: 120000 });
  assert.equal(await terrain.locator('#settlementStage').isVisible(), false);
  await terrain.locator('#pipelineTransfer .panel-advanced > summary').click(); await terrain.locator('#transferExtent').selectOption('crop');
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
  await settlements.locator('#landuseStatus').filter({ hasText: /[1-9][0-9]* zones/ }).waitFor({ timeout: 60000 });
  const landusePixels = () => settlementsFrame.evaluate(() => {
    const canvas = document.querySelector('#landuseCanvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0, transparent = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i]) painted++; else transparent++; }
    return { painted, transparent };
  });
  assert.equal(await settlements.locator('#landuseLayer').isVisible(), true);
  assert.ok((await landusePixels()).painted > 0);
  assert.ok((await landusePixels()).transparent > 0, 'Occupation must preserve the terrain background');
  for (const style of ['fantasy-color', 'atlas', 'parchment']) {
    await settlements.locator('#style').selectOption(style);
    await settlementsFrame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await settlements.locator('#landuseLayer').isVisible(), true, `Missing occupation in ${style}`);
    assert.ok((await landusePixels()).painted > 0);
    const order = await settlementsFrame.evaluate(() => {
      const layer = document.querySelector('#landuseLayer'), painting = document.querySelector('#fantasyPainting');
      return !painting || !!(painting.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.ok(order, 'Terrain painting covers occupation');
  }
  await settlements.locator('#lightingControls > summary').click();
  await settlements.locator('#showLanduse').uncheck();
  assert.equal(await settlements.locator('#landuseLayer').isVisible(), false);
  await settlements.locator('#showLanduse').check();
  assert.equal(await settlements.locator('#landuseLayer').isVisible(), true);
  await settlements.locator('#lightingControls > summary').click();
  await settlements.locator('#viewport').screenshot({ path: 'out/settlements-occupation.png' });
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
    return { layouts: d.meta.pipeline.urban.layouts, imported: imported.state.layouts, radius: imported.radius, history: (await listHistory()).length,  workshopSource: document.querySelector('[data-workshop-status]').textContent };
  });
  assert.deepEqual(plan.layouts, plan.imported); assert.ok(plan.radius > 0); assert.equal(plan.layouts.length, 1);
  assert.equal(plan.layouts[0].key, secondCity);

  const dense = await urbanFrame.evaluate(async () => {
    const { readHistory } = await import('/benchHistory.ts');
    const { cropCityDecor } = await import('/benchTerrainTransfer.ts');
    const d = await readHistory(new URLSearchParams(location.search).get('artifact'));
    const layout = d.meta.pipeline.urban.layouts[0];
    const count = 180000, center = layout.center;
    layout.streets.push({ path: Array.from({ length: count }, (_, i) => ({ x: center.x + i % 2, y: center.y })), widths: [3], rank: 2, role: 'local' });
    const cropped = cropCityDecor(d, layout.key), origin = cropped.meta.pipeline.crop;
    const street = cropped.meta.pipeline.urban.layouts[0].streets.at(-1);
    return { count: street.path.length, exactCoordinates: street.path[0].x + origin.x === center.x, key: cropped.meta.pipeline.city };
  });
  assert.equal(dense.count, 180000); assert.equal(dense.exactCoordinates, true); assert.equal(dense.key, secondCity);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, city: plan.layouts[0].key, exactPlan: true, occupation: ['parchment', 'atlas', 'fantasy-color'], denseCrop: dense.count, errors }));
} catch (error) {
  for (const frame of page.frames()) console.log(frame.url().slice(0, 100), await frame.locator('#pipelineStatus, [data-status], [data-workshop-status]').allTextContents());
  throw error;
} finally { await browser.close(); }
