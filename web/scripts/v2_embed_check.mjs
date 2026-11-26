/** Exercise the built preview in a sandboxed, cross-origin FMG-sized iframe. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const web = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(web, 'dist-v2');
const artifacts = resolve(web, 'out/city-embed');
const prefix = '/magna-urbis/v2/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const compressed = new Map();
const addedLatency = Number(process.env.MAGNA_EMBED_TEST_LATENCY_MS ?? 0);
const assets = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) return response.writeHead(404).end();
    const path = resolve(output, decodeURIComponent(url.pathname.slice(prefix.length)));
    if (!path.startsWith(output + sep)) return response.writeHead(404).end();
    const ext = extname(path);
    const gzip = !!request.headers['accept-encoding']?.includes('gzip') && ['.html', '.js', '.css', '.json'].includes(ext);
    const bytes = (gzip && compressed.get(path)) || (await readFile(path));
    const body = gzip && !compressed.has(path) ? gzipSync(bytes) : bytes;
    if (gzip) compressed.set(path, body);
    if (addedLatency > 0) await new Promise(done => setTimeout(done, addedLatency));
    response.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'Content-Length': body.length, Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(ready => assets.listen(0, '127.0.0.1', ready));
const base = 'http://127.0.0.1:' + assets.address().port + prefix;
const parent = createServer((request, response) => {
  const src = new URL(request.url, 'http://localhost').searchParams.get('src');
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(
    '<!doctype html><style>body{margin:0}iframe{width:440px;height:320px;border:0}</style><iframe title="City preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe><script>document.querySelector("iframe").src=' +
      JSON.stringify(src).replaceAll('<', '\\u003c') +
      '</script>',
  );
});
await new Promise(ready => parent.listen(0, '127.0.0.1', ready));
const host = 'http://127.0.0.1:' + parent.address().port + '/';
const framed = source => host + '?' + new URLSearchParams({ src: source });
const flat = new URLSearchParams({ preview: '1', name: 'Brackenford', population: '2500', seed: '12340007', river: '0', coast: '0', walls: '1', cultureBase: 'English' });
const flatUrl = base + 'embed.html?' + flat;
const result = { base, latencyMs: addedLatency, cases: [], errors: [], missing: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = (page, name) => page.locator('iframe').screenshot({ path: resolve(artifacts, name + '.png') });
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 700, height: 500 } });
  await context.addInitScript(() => {
    if (!new URLSearchParams(location.search).has('holdDetail')) return;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) {
        if (message.type === 'detail') window.__releasePreviewDetail = () => super.postMessage(message, ...rest);
        else super.postMessage(message, ...rest);
      }
    };
  });
  const page = await context.newPage();
  const workers = new Set();
  page.on('worker', worker => {
    workers.add(worker);
    worker.on('close', () => workers.delete(worker));
  });
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) result.missing.push(response.url());
  });
  async function preview(name, source, hold = false) {
    const requests = [];
    const responses = [];
    const remember = request => requests.push(request.url());
    const size = response => responses.push(response.headerValue('content-length').then(value => Number(value ?? 0)));
    page.on('request', remember);
    page.on('response', size);
    const started = performance.now();
    await page.goto(framed(source), { waitUntil: 'commit' });
    const root = page.frameLocator('iframe').locator('html');
    await root.and(page.frameLocator('iframe').locator('[data-state="ready"]')).waitFor({ timeout: 4000 });
    const frame = page.frames().find(candidate => candidate.url().startsWith(base));
    assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
    assert.equal(await frame.locator('#status').isVisible(), false);
    assert.equal(await frame.locator('#demo-controls').isVisible(), false);
    if (hold) {
      assert.equal(await root.getAttribute('data-detail'), null);
      await capture(page, name + '-first');
      await frame.evaluate(() => window.__releasePreviewDetail());
    }
    await root.and(page.frameLocator('iframe').locator('[data-detail="ready"]')).waitFor({ timeout: 15000 });
    const timing = await root.evaluate(el => ({ firstMs: Number(el.dataset.readyMs), detailMs: Number(el.dataset.detailMs) }));
    assert.ok(timing.firstMs < 4000);
    if (!hold) assert.ok(timing.detailMs < 15000);
    assert.ok(timing.detailMs > timing.firstMs);
    const pixels = await frame.locator('#map canvas').evaluate(canvas => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Set();
      for (let i = 0; i < data.length; i += 16) colors.add((data[i] << 16) + (data[i + 1] << 8) + data[i + 2]);
      return colors.size;
    });
    assert.ok(pixels > 20, 'The map must contain visible geometry.');
    assert.equal(workers.size, 0, 'The preview must release its worker after enrichment.');
    assert.ok(!requests.some(url => /\.wasm|\/(?:studio-|engine\.worker-|brushAssets-|neuralRuntime-|terrainGpu-)/.test(url)), 'The preview must only load its lightweight generation entry.');
    page.off('request', remember);
    page.off('response', size);
    const bytes = (await Promise.all(responses)).reduce((sum, count) => sum + count, 0);
    assert.ok(bytes < 300_000, 'Keep the full compressed preview within 300 KB.');
    const report = { name, ...timing, checkedMs: Math.round(performance.now() - started), bytes, pixels, requests: requests.length };
    console.log(JSON.stringify(report));
    result.cases.push(report);
    return { frame, pixels: hash(await capture(page, name)) };
  }

  const cold = await preview('town-cold', flatUrl);
  const repeat = await preview('town-repeat', flatUrl);
  assert.equal(repeat.pixels, cold.pixels, 'The same burg must reproduce the same drawing.');
  await repeat.frame.locator('#zoom-in').click();
  assert.equal(await repeat.frame.locator('#map').getAttribute('data-zoom'), '1.5');
  const pos = await repeat.frame.locator('#map').boundingBox();
  await page.mouse.move(pos.x + 100, pos.y + 100);
  await page.mouse.down();
  await page.mouse.move(pos.x + 135, pos.y + 110);
  await page.mouse.up();
  assert.notEqual(await repeat.frame.locator('#map').getAttribute('data-pan-x'), '0');
  await repeat.frame.locator('#fit-view').click();
  assert.equal(await repeat.frame.locator('#map').getAttribute('data-zoom'), '1');
  assert.equal(await repeat.frame.locator('#map').getAttribute('data-pan-x'), '0');
  await page.locator('iframe').evaluate(element => {
    element.style.width = '620px';
    element.style.height = '420px';
  });
  await repeat.frame.waitForFunction(() => document.querySelector('#map canvas')?.getBoundingClientRect().width === 620);
  await capture(page, 'town-resized');

  const data = {
    format: 'fmg-burg-v1',
    i: 12,
    name: 'Port Skarholm',
    population: 10000,
    mfcgSeed: '12340012',
    capital: true,
    port: true,
    citadel: true,
    walls: true,
    plaza: true,
    river: true,
    coast: { sea: 0.5, water: 'ocean' },
    elevation: 40,
    temperature: 8,
    precipitation: 900,
    culture: { base: 'Nordic', type: 'Naval' },
  };
  const rich = new URL(base + 'embed.html?preview=1&lang=fr');
  rich.hash = new URLSearchParams({ burg: JSON.stringify(data) }).toString();
  const port = await preview('port-rich', rich.href);
  const held = new URL(rich);
  held.searchParams.set('holdDetail', '1');
  const firstPort = await preview('port-phases', held.href, true);
  assert.notEqual(hash(await readFile(resolve(artifacts, 'port-phases-first.png'))), firstPort.pixels, 'The detail phase must change the map.');
  assert.equal(firstPort.pixels, port.pixels, 'Holding detail does not change its result.');
  assert.equal(await firstPort.frame.locator('#open').innerText(), 'Ouvrir dans Magna Urbis ↗');

  // Verify the iframe can open the actual studio, preserving its source data and locale.
  const opened = page.waitForEvent('popup');
  await firstPort.frame.locator('#open').click();
  const studio = await opened;
  await studio.waitForURL(url => url.pathname.endsWith('/v2.html'));
  const target = new URL(studio.url());
  assert.equal(target.searchParams.get('lang'), 'fr');
  assert.equal(new URLSearchParams(target.hash.slice(1)).get('city'), JSON.stringify(data));
  await studio.locator('#changelog-open').waitFor({ state: 'attached' });
  const headings = await studio.locator('.changelog-versions h3').allTextContents();
  const notes = await readFile(resolve(web, '../docs/DESKTOP_RELEASE_NOTES.md'), 'utf8');
  assert.deepEqual(
    headings,
    [...notes.matchAll(/^## (.+)$/gm)].slice(0, 4).map(match => match[1].trim()),
  );
  assert.match(await studio.locator('.changelog-versions').textContent(), /lightweight schematic city map/);
  result.changelog = headings;
  await studio.close();

  // Closing the burg while the second phase is pending releases the old worker.
  await page.goto(framed(held.href));
  await page.frameLocator('iframe').locator('html[data-state="ready"]').waitFor();
  assert.equal(workers.size, 1);
  const [worker] = workers;
  await Promise.all([new Promise(done => worker.once('close', done)), page.locator('iframe').evaluate(iframe => iframe.remove())]);
  assert.equal(workers.size, 0);

  await preview('river-town', base + 'embed.html?preview=1&name=Longxi&seed=1288490188&population=3050&river=1&coast=0&walls=1&cultureBase=Chinese&temple=1');
  await preview('nomad-camp', base + 'embed.html?preview=1&name=Karak%20Ordu&seed=3521165402&population=1250&river=0&coast=0&walls=0&cultureBase=Mongolian&cultureType=Nomadic&temple=1');
  await page.goto(framed(base + 'embed.html?preview=1#burg=bad'));
  await page.frameLocator('iframe').locator('html[data-state="error"]').waitFor();
  assert.equal(workers.size, 0);
  await page.goto(flatUrl + '&demo=1&lang=fr');
  await page.locator('html[data-detail="ready"]').waitFor();
  assert.equal(await page.locator('#randomize').isVisible(), true);
  await page.evaluate(() => {
    Math.random = () => 0.3;
  });
  await page.locator('#randomize').click();
  await page.waitForURL(url => url.searchParams.get('cultureBase') === 'Chinese');
  await page.locator('html[data-detail="ready"]').waitFor();
  assert.match(await page.locator('#demo-params').textContent(), /Chinese.*hab\./);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missing, []);
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  await Promise.all([new Promise(done => parent.close(done)), new Promise(done => assets.close(done))]);
}
