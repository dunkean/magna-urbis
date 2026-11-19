/** Manual production-embed qualification CLI. Serves the existing Vite artifact in a sandboxed iframe; never builds the engine. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const web = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(web, 'dist-v2'),
  artifacts = resolve(web, 'out/city-embed');
const prefix = '/magna-urbis/v2/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const assets = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    const path = resolve(output, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
    if (!path.startsWith(output + sep) || !(await stat(path)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(ready => assets.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${assets.address().port}${prefix}`;
const parent = createServer((request, response) => {
  const source = new URL(request.url, 'http://localhost').searchParams.get('src');
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(
    `<!doctype html><style>body{margin:0;background:#ddd}iframe{width:440px;height:320px;border:0;pointer-events:auto}</style><iframe title="City preview" sandbox="allow-scripts allow-same-origin"></iframe><script>document.querySelector('iframe').src=${JSON.stringify(source)};</script>`,
  );
});
await new Promise(ready => parent.listen(0, '127.0.0.1', ready));
const host = `http://127.0.0.1:${parent.address().port}/`;
const result = { base, cases: [], errors: [], missing: [] };
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 700, height: 500 } });
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'progress') (window.__embedProgress ??= []).push({ ms: Math.round(performance.now()), ...data.progress });
          if (data.type === 'result') window.__embedStats = Object.fromEntries(Object.entries(data.world.stats).filter(([key]) => key.startsWith('ms.')));
        });
      }
    };
  });
  const page = await context.newPage(),
    liveWorkers = new Set();
  page.on('worker', worker => {
    liveWorkers.add(worker);
    worker.on('close', () => liveWorkers.delete(worker));
  });
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) result.missing.push(response.url());
  });
  const flat = `${base}embed.html?preview=1&name=Brackenford&population=2500&seed=12340007&river=0&coast=0&walls=1&cultureBase=English`;
  async function preview(name, source) {
    const requested = [];
    const record = request => requested.push(request.url());
    page.on('request', record);
    const started = performance.now();
    await page.goto(`${host}?${new URLSearchParams({ src: source })}`, { waitUntil: 'domcontentloaded' });
    const iframe = page.frameLocator('iframe');
    await iframe.locator('html[data-state="ready"],html[data-state="error"]').waitFor({ timeout: 180000 });
    const state = await iframe.locator('html').getAttribute('data-state');
    assert.equal(state, 'ready', await iframe.locator('#status').textContent());
    const frame = page.frames().find(candidate => candidate.url().startsWith(base));
    assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
    assert.equal(await frame.locator('#status').isVisible(), false);
    const pixels = await frame.locator('#map canvas').evaluate(canvas => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Set();
      for (let i = 0; i < data.length; i += 16) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return colors.size;
    });
    assert.ok(pixels > 20, 'The city must contain visible geometry.');
    const png = await page.locator('iframe').screenshot({ path: resolve(artifacts, `${name}.png`) });
    const readyMs = Number(await iframe.locator('html').getAttribute('data-ready-ms'));
    const timing = await frame.evaluate(() => performance.getEntriesByType('resource').map(entry => ({ name: entry.name, bytes: entry.encodedBodySize })));
    assert.ok(!requested.some(url => /\/(?:studio-|brushAssets-|fantasyBrushAssets-|neuralRuntime-|terrainGpu-)/.test(url)), 'The preview must not load the workbench or optional painters/models.');
    assert.equal(liveWorkers.size, 0, 'The preview must release its generation worker.');
    result.cases.push({
      name,
      readyMs,
      navigationMs: Math.round(performance.now() - started),
      pixels,
      requests: requested.length,
      resourceBytes: timing.reduce((sum, entry) => sum + entry.bytes, 0),
      stats: await frame.evaluate(() => window.__embedStats),
      progress: await frame.evaluate(() => window.__embedProgress),
    });
    page.off('request', record);
    console.log(JSON.stringify({ name, readyMs, cached: await frame.locator('html').getAttribute('data-cached'), stats: result.cases.at(-1).stats }));
    return { frame, hash: createHash('sha256').update(png).digest('hex') };
  }
  async function navigation(frame) {
    const box = await frame.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55);
    await page.mouse.wheel(0, -350);
    await frame.waitForFunction(() => Number(document.querySelector('#map').dataset.zoom) > 1);
    const before = await frame.locator('#map').getAttribute('data-pan-x');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65 + 45, box.y + box.height * 0.55 + 30, { steps: 5 });
    await page.mouse.up();
    assert.notEqual(await frame.locator('#map').getAttribute('data-pan-x'), before, 'Dragging must pan the city.');
    await frame.locator('#fit-view').click();
    assert.equal(await frame.locator('#map').getAttribute('data-zoom'), '1');
    assert.equal(await frame.locator('#map').getAttribute('data-pan-x'), '0');
    await page.mouse.move(680, 480);
  }
  const cold = await preview('town-cold', flat);
  await navigation(cold.frame);
  const warm = await preview('town-cached', flat);
  assert.equal(warm.hash, cold.hash, 'The same city input must reproduce the same preview.');
  await navigation(warm.frame);
  await page.locator('iframe').evaluate(element => {
    element.style.width = '620px';
    element.style.height = '420px';
  });
  await warm.frame.waitForFunction(() => document.querySelector('#map canvas')?.getBoundingClientRect().width === 620);
  await page.locator('iframe').screenshot({ path: resolve(artifacts, 'town-resized.png') });
  const data = {
    format: 'fmg-burg-v1',
    i: 12,
    name: 'Port Skarholm',
    population: 5000,
    mfcgSeed: '12340012',
    capital: true,
    port: true,
    citadel: true,
    walls: true,
    river: false,
    coast: { sea: 0.5, water: 'ocean' },
    elevation: 40,
    temperature: 8,
    precipitation: 900,
    culture: { base: 'Nordic', type: 'Naval' },
    biome: { id: 6, name: 'Temperate deciduous forest' },
  };
  const rich = new URL(`${base}embed.html?preview=1`);
  rich.hash = new URLSearchParams({ burg: JSON.stringify(data) }).toString();
  await preview('port-rich', rich.href);
  // The direct preview is an exploration surface; the ordinary FMG iframe keeps the controls hidden.
  assert.equal(await page.frameLocator('iframe').locator('#demo-controls').isVisible(), false);
  await page.goto(flat + '&demo=1', { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-state="ready"]').waitFor({ timeout: 180000 });
  assert.equal(await page.locator('#randomize').isVisible(), true);
  await page.evaluate(() => {
    Math.random = () => 0.3;
  });
  await page.locator('#randomize').click();
  await page.waitForURL(url => url.searchParams.get('cultureBase') === 'Chinese');
  await page.locator('html[data-state="ready"],html[data-state="error"]').waitFor({ timeout: 180000 });
  assert.equal(await page.locator('html').getAttribute('data-state'), 'ready', await page.locator('#status').textContent());
  assert.match(await page.locator('#demo-params').textContent(), /Chinese.*people/);
  await page.screenshot({ path: resolve(artifacts, 'randomized.png') });
  result.randomized = page.url();
  await page.goto(`${host}?${new URLSearchParams({ src: `${base}embed.html?preview=1#burg=bad` })}`);
  await page.frameLocator('iframe').locator('html[data-state="error"]').waitFor();
  assert.equal(liveWorkers.size, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missing, []);
  // The build still bundles the intended four latest changelog sections.
  const studio = await context.newPage();
  await studio.setViewportSize({ width: 1440, height: 960 });
  await studio.goto(`${base}v2.html?test=1&threads=off`, { waitUntil: 'domcontentloaded' });
  await studio.locator('#changelog-open').waitFor();
  const headings = await studio.locator('.changelog-versions h3').allTextContents();
  const notes = await readFile(resolve(web, '../docs/DESKTOP_RELEASE_NOTES.md'), 'utf8');
  assert.deepEqual(
    headings,
    [...notes.matchAll(/^## (.+)$/gm)].slice(0, 4).map(match => match[1].trim()),
  );
  assert.match(await studio.locator('.changelog-versions').textContent(), /compact city preview/);
  result.changelog = headings;
  console.log(JSON.stringify({ changelog: headings }));
  // Review the shared Minimal changes on the V2 reference page too.
  await studio.waitForFunction(() => window.__v2Test?.ready);
  await studio.locator('#map-style').selectOption('minimal');
  await studio.evaluate(async () => {
    await window.__v2Test.runRegion({
      options: { seed: 'embed-outline-review', population: 500, culture: 'european-organic', coast: 'none', river: 'none' },
      extent: 2000,
      places: 'main',
      runtime: { backend: 'rust', autoBackend: false, compute: 'cpu', source: 'procedural' },
      terrain: { resolution: 128, erosion: 0, generationCompute: 'cpu', forest: { enabled: false } },
      region: { resolution: 128, autoBuildPopulation: 0, placement: { mode: 'list', farmDensity: 0, remotePlaces: 0, list: [{ key: 'main', name: 'Outline review', population: 500, culture: 'european-organic', siteType: 'auto', sitePrefs: {} }] } },
    });
    await window.__v2Test.view('2d-core');
    await window.__v2Test.prepareCapture();
  });
  await studio.locator('#map').screenshot({ path: resolve(artifacts, 'v2-minimal.png') });
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  await Promise.all([new Promise(done => parent.close(done)), new Promise(done => assets.close(done))]);
}
