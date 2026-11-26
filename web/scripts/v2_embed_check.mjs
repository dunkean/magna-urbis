/** Exercise the built preview in a sandboxed, cross-origin FMG-sized iframe. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gzip as gzipBuffer } from 'node:zlib';
import { promisify } from 'node:util';

const web = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(web, 'dist-v2');
const artifacts = resolve(web, 'out/city-embed');
const prefix = '/magna-urbis/v2/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const compressed = new Map();
// Prepare the CDN's compressed WASM representation outside the measured navigation.
const gzipAsync = promisify(gzipBuffer);
for (const file of await readdir(resolve(output, 'assets'))) {
  if (!file.endsWith('.wasm')) continue;
  const path = resolve(output, 'assets', file);
  compressed.set(path, await gzipAsync(await readFile(path)));
}
const addedLatency = Number(process.env.MAGNA_EMBED_TEST_LATENCY_MS ?? 0);
const servedAssets = [];
const assets = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) return response.writeHead(404).end();
    const path = resolve(output, decodeURIComponent(url.pathname.slice(prefix.length)));
    if (!path.startsWith(output + sep)) return response.writeHead(404).end();
    const ext = extname(path);
    const gzip = !!request.headers['accept-encoding']?.includes('gzip') && ['.html', '.js', '.css', '.json', '.wasm'].includes(ext);
    const bytes = (gzip && compressed.get(path)) || (await readFile(path));
    const body = gzip && !compressed.has(path) ? gzipSync(bytes) : bytes;
    if (gzip) compressed.set(path, body);
    if (addedLatency > 0) await new Promise(done => setTimeout(done, addedLatency));
    response.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'Content-Length': body.length, Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) });
    servedAssets.push({ url: url.pathname, bytes: body.length });
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
const runtime = process.env.MAGNA_EMBED_TEST_PROFILE === 'local' ? 'local' : 'web';
const flat = new URLSearchParams({ profile: runtime, preview: '1', name: 'Brackenford', population: '2500', seed: '12340007', river: '0', coast: '0', walls: '1', cultureBase: 'English' });
const flatUrl = base + 'embed.html?' + flat;
const result = { base, latencyMs: addedLatency, cases: [], errors: [], missing: [] };
const capture = (page, name) => page.locator('iframe').screenshot({ path: resolve(artifacts, name + '.png') });
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 700, height: 500 } });
  await context.addInitScript(() => {
    const captureFirst = new MutationObserver(() => {
      if (document.documentElement?.dataset.state !== 'ready') return;
      const canvas = document.querySelector('#map canvas');
      if (canvas) window.__townFirstImage = canvas.toDataURL('image/png').split(',')[1];
      captureFirst.disconnect();
    });
    captureFirst.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'progress') (window.__townProgress ??= []).push([data.progress.stage, Math.round(performance.now())]);
          if (data.type === 'city-preview') {
            if (data.mode === 'compact') window.__townResult = data.town;
            else if (data.mode === 'detailed') {
              window.__townDetailed = data.town;
              window.__detailedGenerations = (window.__detailedGenerations ?? 0) + 1;
            }
          }
        });
      }
      postMessage(message, ...rest) {
        if (!new URLSearchParams(location.search).has('holdGeneration')) super.postMessage(message, ...rest);
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
  async function preview(name, source) {
    const firstAsset = servedAssets.length;
    const requests = [];
    const responses = [];
    const remember = request => requests.push(request.url());
    const size = response => responses.push(response.headerValue('content-length').then(value => ({ url: response.url(), bytes: Number(value ?? 0) })));
    page.on('request', remember);
    page.on('response', size);
    const started = performance.now();
    await page.goto(framed(source), { waitUntil: 'commit' });
    const root = page.frameLocator('iframe').locator('html');
    await root.and(page.frameLocator('iframe').locator('[data-state="ready"]')).waitFor({ timeout: 30000 });
    const frame = page.frames().find(candidate => candidate.url().startsWith(base));
    assert.equal(await frame.evaluate(() => crossOriginIsolated), false);
    assert.equal(await frame.locator('#status').isVisible(), false);
    assert.equal(await frame.locator('#demo-controls').isVisible(), false);
    assert.equal(await root.getAttribute('data-detail'), 'idle', 'The richer generation must be opt-in.');
    const timing = await root.evaluate(el => ({ firstMs: Number(el.dataset.readyMs), runtime: el.dataset.runtime, cached: el.dataset.previewCache === 'hit', threads: Number(el.dataset.wasmThreads) || undefined }));
    if (runtime === 'local') assert.equal(timing.runtime, 'native');
    const { generated, image } = await frame.evaluate(() => ({ generated: window.__townResult, image: window.__townFirstImage }));
    const town = timing.cached ? result.cases[0].town : generated;
    if (runtime === 'web') assert.equal(timing.threads, 1, 'An ordinary FMG sandbox must run single-threaded.');
    if (timing.cached) assert.equal(generated, undefined, 'A cached vector map draws without a generation worker.');
    assert.ok(image, 'A completed first canvas paint must precede the context view.');
    await writeFile(resolve(artifacts, name + '-first.png'), Buffer.from(image, 'base64'));
    assert.ok(town?.layouts && town.buildings > 0, 'The map must come from the Rust settlement and contain actual building footprints.');
    const pixels = await frame.locator('#map canvas').evaluate(canvas => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Set();
      for (let i = 0; i < data.length; i += 16) colors.add((data[i] << 16) + (data[i + 1] << 8) + data[i + 2]);
      return colors.size;
    });
    assert.ok(pixels > 20, 'The map must contain visible geometry.');
    assert.equal(workers.size, 0, 'The preview must release its worker after the compact generation.');
    assert.ok(!requests.some(url => /\/(?:studio-|brushAssets-|neuralRuntime-|terrainGpu-)/.test(url)), 'The preview must not load the studio, brush libraries or neural runtime.');
    page.off('request', remember);
    page.off('response', size);
    const assets = await Promise.all(responses);
    const bytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    const largest = assets.sort((a, b) => b.bytes - a.bytes).slice(0, 6);
    const served = servedAssets.slice(firstAsset);
    const staticBytes = served.reduce((sum, asset) => sum + asset.bytes, 0);
    const wasmDownloads = served.filter(asset => asset.url.endsWith('.wasm')).length;
    const progress = await frame.evaluate(() => window.__townProgress);
    const report = { name, ...timing, checkedMs: Math.round(performance.now() - started), bytes, staticBytes, wasmDownloads, pixels, requests: requests.length, town, progress, largest };
    console.log(JSON.stringify({ ...report, progress: undefined, largest: undefined }));
    result.cases.push(report);
    await capture(page, name);
    return { frame, image };
  }

  const cold = await preview('town-cold', flatUrl);
  const repeat = await preview('town-repeat', flatUrl);
  if (runtime === 'web') assert.equal(result.cases[1].cached, true);
  // At the same camera the cached geometry must give the same drawing. Canvas can
  // choose different antialiasing backends as the worker and page settle.
  const drawingDelta = await repeat.frame.evaluate(
    async ([left, right]) => {
      const read = async encoded => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + encoded;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [a, b] = await Promise.all([read(left), read(right)]);
      if (a.length !== b.length) return Infinity;
      return a.reduce((sum, row, index) => sum + Math.abs(row - b[index]), 0) / a.length;
    },
    [cold.image, repeat.image],
  );
  assert.ok(drawingDelta < 0.25, 'The reopened burg must keep the same proportions and visual detail.');
  const compactMap = await repeat.frame.locator('#map canvas').evaluate(canvas => canvas.toDataURL());
  const compactPixels = await page.screenshot({ clip: { x: 30, y: 70, width: 380, height: 180 } });
  const detailStart = performance.now();
  const detailStarted = page.waitForEvent('worker');
  await repeat.frame.locator('#detailed').click();
  const detailWorker = await detailStarted;
  await repeat.frame.locator('html[data-detail="loading"]').waitFor();
  assert.equal(await repeat.frame.locator('#map canvas').evaluate(canvas => canvas.toDataURL()), compactMap, 'Keep the compact map while Detailed runs.');
  assert.equal(await repeat.frame.locator('#detailed').isDisabled(), true);
  await repeat.frame.locator('html[data-detail="ready"]').waitFor({ timeout: 120000 });
  assert.equal(workers.has(detailWorker), false, 'Release the detailed generation worker.');
  const detailTown = await repeat.frame.evaluate(() => window.__townDetailed);
  assert.ok(detailTown?.buildings > 0, 'Detailed must return real Rust building footprints.');
  assert.deepEqual(detailTown, result.cases[1].town, 'The two V2 passes must retain the same streets and buildings.');
  assert.equal(await repeat.frame.locator('#detail-style').inputValue(), 'satellite-light');
  result.detailedMs = Math.round(performance.now() - detailStart);
  result.detailPasses = await repeat.frame.evaluate(() =>
    Object.fromEntries(
      performance
        .getEntriesByType('measure')
        .filter(m => m.name.startsWith('v2pass:'))
        .map(m => [m.name, Math.round(m.duration)]),
    ),
  );
  // Compare the composited map between the toolbars. A control, an extra outline or a cleared canvas
  // cannot satisfy the requirement for a visibly different cartographic style.
  const mapPixels = () => page.screenshot({ clip: { x: 30, y: 70, width: 380, height: 180 } });
  async function compareMapPixels(first, second) {
    return repeat.frame.evaluate(
      async encoded => {
        const pixels = await Promise.all(
          encoded.map(async data => {
            const image = new Image();
            image.src = 'data:image/png;base64,' + data;
            await image.decode();
            const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          }),
        );
        const [a, b] = pixels;
        let changed = 0,
          roofPixels = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.max(...[0, 1, 2].map(c => Math.abs(a[i + c] - b[i + c]))) >= 16) changed++;
          // In this English burg the fast satellite roofs are terracotta, distinct from the ochre lots.
          if (b[i] > b[i + 1] + 25 && b[i + 1] > 1.35 * b[i + 2] && b[i + 1] < 125) roofPixels++;
        }
        return { changed: changed / (a.length / 4), roofs: roofPixels / (a.length / 4) };
      },
      [first, second].map(buffer => buffer.toString('base64')),
    );
  }
  const fastSatellite = await mapPixels();
  const fastPixels = await compareMapPixels(compactPixels, fastSatellite);
  assert.ok(fastPixels.roofs > 0.02, 'The ready Fast Satellite frame must include visible town roofs.');
  result.fastSatelliteChangedFraction = fastPixels.changed;
  assert.ok(result.fastSatelliteChangedFraction > 0.2, 'Fast Satellite must visibly repaint the town.');
  await capture(page, 'town-satellite-fast');
  const switchStart = performance.now();
  await repeat.frame.locator('#detail-style').selectOption('satellite-2');
  await repeat.frame.locator('html[data-detail-style="satellite-2"][data-detail="ready"]').waitFor({ timeout: 120000 });
  result.switchMs = Math.round(performance.now() - switchStart);
  result.satelliteChangedFraction = (await compareMapPixels(fastSatellite, await mapPixels())).changed;
  assert.ok(result.satelliteChangedFraction > 0.2, 'Painted satellite must visibly repaint the town.');
  assert.equal(await repeat.frame.evaluate(() => window.__detailedGenerations), 1);
  await capture(page, 'town-painted-satellite');

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
  async function backingAspect(width, height) {
    await repeat.frame.waitForFunction(
      ([w, h]) => {
        return [...document.querySelectorAll('#map canvas')].some(canvas => {
          const rect = canvas.getBoundingClientRect();
          return rect.width === w && rect.height === h && Math.abs(canvas.width / canvas.height - w / h) < 0.005;
        });
      },
      [width, height],
    );
  }
  await backingAspect(620, 420);
  await capture(page, 'town-resized');
  await page.locator('iframe').evaluate(element => {
    element.style.width = '190px';
    element.style.height = '440px';
  });
  await backingAspect(190, 440);
  await capture(page, 'town-tall');

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
  const rich = new URL(base + 'embed.html?preview=1&lang=fr&profile=' + runtime);
  rich.hash = new URLSearchParams({ burg: JSON.stringify(data) }).toString();
  const port = await preview('port-rich', rich.href);
  assert.equal(await port.frame.locator('#open').innerText(), 'Ouvrir dans Magna Urbis ↗');

  // Verify the iframe can open the actual studio, preserving its source data and locale.
  const opened = page.waitForEvent('popup');
  await port.frame.locator('#open').click();
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
  assert.match(await studio.locator('.changelog-versions').textContent(), /generated town/);
  result.changelog = headings;
  await studio.close();

  // A discarded frame releases its worker, including when the result is pending.
  const startedWorker = page.waitForEvent('worker');
  const cancelled = new URL(flatUrl);
  cancelled.searchParams.set('population', '2501');
  cancelled.searchParams.set('holdGeneration', '1');
  await page.goto(framed(cancelled.href));
  const worker = await startedWorker;
  assert.equal(workers.size, 1);
  await Promise.all([new Promise(done => worker.once('close', done)), page.locator('iframe').evaluate(iframe => iframe.remove())]);
  assert.equal(workers.size, 0);

  await preview('river-town', base + 'embed.html?profile=' + runtime + '&preview=1&name=Longxi&seed=1288490188&population=3050&river=1&coast=0&walls=1&cultureBase=Chinese&temple=1');
  await preview('nomad-camp', base + 'embed.html?profile=' + runtime + '&preview=1&name=Karak%20Ordu&seed=3521165402&population=1250&river=0&coast=0&walls=0&cultureBase=Mongolian&cultureType=Nomadic&temple=1');
  await page.goto(framed(base + 'embed.html?preview=1#burg=bad'));
  await page.frameLocator('iframe').locator('html[data-state="error"]').waitFor();
  assert.equal(workers.size, 0);
  await page.goto(flatUrl + '&demo=1&lang=fr');
  await page.locator('html[data-state="ready"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#randomize').isVisible(), true);
  assert.equal(await page.locator('#demo-controls').getByRole('button', { name: 'Améliorer la vue' }).isEnabled(), true);
  assert.equal(await page.locator('#preview-population').inputValue(), '2500');
  await page.locator('#preview-population').fill('1250');
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await page.waitForURL(url => url.searchParams.get('population') === '1250');
  await page.locator('html[data-state="ready"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#preview-population').inputValue(), '1250');
  assert.equal(new URL(page.url()).searchParams.get('seed'), '12340007');
  await page.evaluate(() => {
    Math.random = () => 0.3;
  });
  await page.locator('#randomize').click();
  await page.waitForURL(url => url.searchParams.get('cultureBase') === 'Chinese');
  await page.locator('html[data-state="ready"]').waitFor({ timeout: 30000 });
  assert.match(await page.locator('#demo-params').textContent(), /Chinese.*hab\./);

  const demoBurg = { format: 'fmg-burg-v1', i: 19, name: 'Demo Burg', population: 700, mfcgSeed: '12340019', river: false, coast: null };
  const richDemo = new URL(base + 'embed.html?preview=1&demo=1&lang=fr&profile=' + runtime);
  richDemo.hash = new URLSearchParams({ burg: JSON.stringify(demoBurg) }).toString();
  await page.goto(richDemo.href);
  await page.locator('html[data-state="ready"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#preview-population').inputValue(), '700');
  await page.evaluate(() => {
    window.__beforePopulationEdit = true;
  });
  await page.locator('#preview-population').fill('850');
  await page.locator('#preview-population').press('Enter');
  await page.waitForFunction(() => !window.__beforePopulationEdit && document.documentElement.dataset.state === 'ready', undefined, { timeout: 30000 });
  const chosen = JSON.parse(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('burg'));
  assert.deepEqual(chosen, { ...demoBurg, population: 850 });
  assert.equal(await page.locator('#preview-population').inputValue(), '850');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missing, []);
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  await Promise.all([new Promise(done => parent.close(done)), new Promise(done => assets.close(done))]);
}
