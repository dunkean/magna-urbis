import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const origin = process.env.URBAN_BENCH_URL ?? 'http://localhost:5173';
const moduleRoot = `/@fs/${process.cwd().replaceAll('\\', '/')}/src`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], results = [];
mkdirSync('out', { recursive: true });
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.landuseReplies = 0;
  window.landuseRequests = 0;
  const Base = window.Worker;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', e => {
        if (e.data.scene) { window.landuseScene = e.data.scene; window.landuseReplies++; }
      });
    }
    postMessage(message, ...args) {
      if (message.input?.raster && message.input?.biome) { window.landuseInput = message.input; window.landuseRequests++; }
      super.postMessage(message, ...args);
    }
  };
});
async function frames() { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function ready() {
  await page.waitForFunction(() => /zones.*ms/.test(document.getElementById('landuseStatus')?.textContent ?? '')
    && document.getElementById('landuseGenerate')?.getAttribute('aria-busy') === 'false'
    && document.getElementById('landuseCanvas')?.width > 1, null, { timeout: 120000 });
  await frames();
}
const geometry = () => page.evaluate(() => JSON.stringify(window.landuseScene.landuse));
const pixels = () => page.locator('#landuseCanvas').evaluate(c => c.toDataURL());
async function assertPixels(expected, message) {
  const delta = await page.evaluate(async expected => {
    const c = document.getElementById('landuseCanvas'), img = new Image(); img.src = expected; await img.decode();
    const ref = document.createElement('canvas'); ref.width = c.width; ref.height = c.height;
    ref.getContext('2d').drawImage(img, 0, 0);
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const b = ref.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let changed = 0, maxDelta = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { changed++; maxDelta = Math.max(maxDelta, Math.abs(a[i] - b[i])); }
    return { changed, maxDelta };
  }, expected);
  assert.ok(delta.changed <= 20 && delta.maxDelta <= 1, `${message}: ${JSON.stringify(delta)}`);
}

async function compareReference() {
  const result = await page.evaluate(async root => {
    const [{ createCanvasRenderer }, { urbanLanduseRenderWorld }, { biomePalette }, { SIZE_PRESETS }] = await Promise.all([
      import(`${root}/render/canvas.ts`), import(`${root}/ui/urbanLanduseData.ts`), import(`${root}/render/biomes.ts`), import(`${root}/gen/options.ts`),
    ]);
    const actual = document.getElementById('landuseCanvas'), ref = document.createElement('canvas');
    ref.width = actual.width; ref.height = actual.height;
    const image = new Image(); image.src = document.getElementById('reliefImage').getAttribute('href'); await image.decode();
    const pal = { ...biomePalette(document.getElementById('landuseStyle').value, window.landuseScene.options.biome), frameKind: 'none' };
    const renderer = createCanvasRenderer(ref, urbanLanduseRenderWorld(window.landuseScene, window.landuseInput.raster), pal,
      { dpr: devicePixelRatio, terrain: () => image, vegetation: document.getElementById('landuseVegetation').value,
        furrowReferenceSize: SIZE_PRESETS[window.landuseScene.options.size].mapSize });
    renderer.setOverlays({ labels: false, legend: false, cartouche: false });
    const [x, y, w, h] = document.getElementById('map').getAttribute('viewBox').split(' ').map(Number);
    const width = document.getElementById('viewport').clientWidth;
    const view = { cx: x + w / 2, cy: y + h / 2, scale: width / w }, stats = renderer.draw(view);
    const a = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data;
    const expected = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data;
    let changed = 0, maxDelta = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== expected[i]) { changed++; maxDelta = Math.max(maxDelta, Math.abs(a[i] - expected[i])); }
    const warmMs = renderer.draw(view).ms;
    const panMs = Array.from({ length: 10 }, (_, i) => renderer.draw({ ...view, cx: view.cx + (i + 1) * 12 / view.scale }).ms);
    renderer.dispose(); return { changed, maxDelta, stats, warmMs, panMaxMs: Math.max(...panMs) };
  }, moduleRoot);
  // Independent GPU surfaces may round a handful of antialiased channels by 1/255.
  assert.ok(result.changed <= 20 && result.maxDelta <= 1, `Canvas reference differs: ${JSON.stringify(result)}`);
  results.push({ reference: result });
}

try {
  const catalogue = await (await fetch(`${origin}/decors/index.json`)).json();
  const ids = [catalogue.decors[0].id, catalogue.decors[21].id, catalogue.decors[22].id];
  for (const id of ids) {
    await page.goto(`${origin}/urbanbench.html?decor=${id}`); await ready();
    assert.equal(new URL(page.url()).searchParams.get('decor'), id);
    await page.locator('#fit').click(); await frames(); await compareReference();
    await page.screenshot({ path: `out/${id}-canvas.png` });
    results.push({ decor: id, status: await page.locator('#landuseStatus').textContent() });
  }
  const detailUrl = await page.evaluate(() => {
    const area = window.landuseScene.landuse.areas.filter(a => a.kind === 'forest').sort((a, b) => b.poly.length - a.poly.length)[0];
    if (!area) throw new Error('Expected forest in validation decor');
    const p = area.poly.reduce((s, p) => ({ x: s.x + p.x / area.poly.length, y: s.y + p.y / area.poly.length }), { x: 0, y: 0 });
    const url = new URL(location.href); url.searchParams.set('view', `${p.x},${p.y},2`); return url.href;
  });
  await page.goto(detailUrl); await ready(); await compareReference();
  await page.screenshot({ path: 'out/urban-canopy-detail.png' });
  const shape = await geometry(), replies = await page.evaluate(() => window.landuseReplies), canopy = await pixels();
  await page.locator('#landuseVegetation').selectOption('classic'); await frames(); await compareReference();
  assert.notEqual(await pixels(), canopy, 'Canopy mode did not change vegetation');
  await page.screenshot({ path: 'out/urban-classic-detail.png' });
  await page.locator('#landuseVegetation').selectOption('canopy'); await frames();
  await assertPixels(canopy, 'Returning to canopy changed the drawing');
  assert.equal(await geometry(), shape); assert.equal(await page.evaluate(() => window.landuseReplies), replies);
  await page.locator('#showLanduse').uncheck(); assert.equal(await page.locator('#landuseLayer').isVisible(), false);
  await page.locator('#showLanduse').check(); await frames(); await assertPixels(canopy, 'Visibility changed the drawing');
  await page.locator('#showRelief').uncheck(); await frames(); assert.notEqual(await pixels(), canopy);
  await page.locator('#showRelief').check(); await frames(); await assertPixels(canopy, 'Background toggle changed the drawing');
  await page.locator('#landuseOpacity').fill('0.85');
  const url = page.url(); await page.goto(url); await ready();
  assert.equal(await geometry(), shape); assert.equal(await page.locator('#landuseVegetation').inputValue(), 'canopy');
  assert.equal(await page.locator('#landuseOpacity').inputValue(), '0.85'); await compareReference();
  await page.locator('#landuseStyle').selectOption('atlas'); await frames(); await compareReference();
  await page.locator('#landusePainted').check();
  await page.waitForFunction(() => document.getElementById('landuseVegetation').disabled); await frames();
  await page.locator('#landusePainted').uncheck(); await frames(); await compareReference();
  assert.equal(await geometry(), shape);
  // No regeneration for view changes; deterministic restoration after zooming.
  const beforeZoom = await page.evaluate(() => window.landuseReplies);
  await page.locator('#fit').click(); await frames(); await compareReference();
  assert.equal(await page.evaluate(() => window.landuseReplies), beforeZoom);
  const requests = await page.evaluate(() => window.landuseRequests);
  await page.locator('#landuseEnabled').uncheck();
  assert.equal(await page.locator('#landuseLayer').isVisible(), false);
  assert.equal(await page.locator('#landuseGenerate').isDisabled(), true);
  await page.locator('#landuseEnabled').check(); await ready();
  assert.equal(await page.evaluate(() => window.landuseRequests), requests, 'Re-enabling should reuse the retained scene');
  await page.locator('#landuseEnabled').uncheck();
  await page.locator('#decorQuick').selectOption(ids[0]);
  await page.waitForFunction(id => new URL(location.href).searchParams.get('decor') === id, ids[0]);
  assert.equal(await page.evaluate(() => window.landuseRequests), requests, 'Disabled stage generated on a decor change');
  await page.goto(page.url());
  await page.waitForFunction(() => document.getElementById('landuseStatus')?.textContent === 'Occupation du territoire désactivée.');
  assert.equal(await page.locator('#landuseEnabled').isChecked(), false);
  assert.equal(await page.evaluate(() => window.landuseRequests), 0, 'Disabled URL started a worker');
  await page.locator('#landuseEnabled').check(); await ready();
  await page.evaluate(() => { document.getElementById('landuseGenerate').click(); document.getElementById('landuseEnabled').click(); });
  assert.equal(await page.locator('#landuseGenerate').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('#landuseLayer').isVisible(), false);
  await page.locator('#landuseEnabled').check(); await ready();
  assert.deepEqual(errors, []);
  results.push({ lifecycle: 'display, visibility, background, URL replay and zoom preserve geometry', errors });
  writeFileSync('out/urban-landuse-canvas-check.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
