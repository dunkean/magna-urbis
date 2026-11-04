/** Display plumbing on a retained project, without running a generator.
 * MAGNA_V2_URL=http://127.0.0.1:5186 node scripts/v2_display_core_check.mjs [--baseline]
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5186';
const root = '/@fs/' + resolve(web, 'src').replaceAll('\\', '/');
const baseline = process.argv.includes('--baseline');
const backend = process.argv.find(value => value.startsWith('--backend='))?.split('=')[1] ?? 'auto';
const dpr = Number(process.argv.find(value => value.startsWith('--dpr='))?.split('=')[1] ?? 1);
const out = resolve(web, 'out/v2-display-core');
await mkdir(out, { recursive: true });
const report = { baseline, backend, dpr, errors: [], checks: [] };
let page;
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', message => { if (message.text().startsWith('display-check:')) console.log(message.text()); });
  if (backend === 'cpu') await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind === 'webgl2' ? null : get.call(this, kind, ...args); };
  });
  await page.goto(`${base}/v2.html?empty&lang=en${['webgpu', 'webgl'].includes(backend) ? `&renderer=${backend}` : ''}`);
  await page.locator('#map-style').waitFor();
  await page.evaluate(async root => {
    window.__displayProbe = { frames: [], bitmaps: 0, jobs: 0 };
    const create = window.createImageBitmap;
    window.createImageBitmap = (...args) => { window.__displayProbe.bitmaps++; return create(...args); };
    // Vite appends HMR revision queries to dependencies; instrument the exact same module instance.
    const source = await (await fetch(root + '/v2/client.ts')).text();
    const url = source.match(/import\((["'])([^"']*\/benchRenderer\.ts[^"']*)\1\)/)?.[2] ?? root + '/v2/benchRenderer.ts';
    const { BenchRenderer } = await import(url);
    for (const name of ['draw', 'drawLive']) {
      const draw = BenchRenderer.prototype[name];
      if (!draw) continue;
      BenchRenderer.prototype[name] = function (...args) {
        window.__activeBench = this;
        const t = performance.now(), result = draw.apply(this, args);
        window.__displayProbe.frames.push({ kind: name, at: t, ms: performance.now() - t, w: args[1], h: args[2], view: args[0] });
        return result;
      };
    }
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, ...rest) {
      if (['terrain', 'region', 'town', 'towns', 'all'].includes(m?.action)) window.__displayProbe.jobs++;
      return post.call(this, m, ...rest);
    };
  }, root);
  await page.locator('#import-open').click();
  await page.locator('#import-scope').selectOption('complete');
  await page.locator('#project-file').setInputFiles(process.env.MAGNA_RENDER_FIXTURE ?? resolve(web, 'out/v2-rust-browser/06-native-houses.json'));
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  for (const style of backend === 'cpu' ? ['parchment'] : ['parchment', 'render-v2', 'parchment']) {
    await page.locator('#map-style').selectOption(style);
    await page.waitForFunction(style => document.querySelector('#render-status').hidden && document.querySelector('#map-canvas').dataset.renderStyle === style, style, { timeout: 120000 });
    await page.waitForTimeout(500);
    const result = await page.evaluate(async () => {
      const canvas = document.querySelector('#map-canvas'), r = canvas.getBoundingClientRect();
      const probe = window.__displayProbe;
      probe.frames = []; probe.bitmaps = 0;
      const ticks = [], start = performance.now();
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true }));
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        ticks.push(performance.now());
        canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: r.x + r.width / 2 + Math.sin(i / 10) * 140, clientY: r.y + r.height / 2 + Math.cos(i / 10) * 70, bubbles: true }));
        if (i % 15 === 0) canvas.dispatchEvent(new WheelEvent('wheel', { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, deltaY: i % 30 ? 90 : -90, bubbles: true, cancelable: true }));
      }
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 500));
      const frames = probe.frames.filter(f => f.w > 200), deltas = ticks.slice(1).map((t, i) => t - ticks[i]).sort((a, b) => a - b);
      return { renderer: canvas.dataset.renderer, backend: canvas.dataset.terrainBackend, presentation: canvas.dataset.presentation, frames: frames.length,
        bitmaps: probe.bitmaps, jobs: probe.jobs, elapsed: ticks.at(-1) - start,
        frameWorkMs: frames.reduce((s, f) => s + f.ms, 0) / frames.length,
        p50: deltas[Math.floor(deltas.length * .5)], p95: deltas[Math.floor(deltas.length * .95)], lastView: frames.at(-1)?.view };
    });
    report.checks.push({ style, ...result });
    console.log(style, JSON.stringify(result));
    assert(result.frames > 5);
    assert.equal(result.jobs, 0);
    if (!baseline) { assert.equal(result.presentation, 'direct'); assert.equal(result.bitmaps, 0); }
    if (!baseline) {
      const parity = await page.evaluate(() => {
        console.log('display-check: capture reference');
        const renderer = window.__activeBench, last = window.__displayProbe.frames.filter(f => f.w > 200).at(-1);
        const dpr = devicePixelRatio, canvas = document.createElement('canvas');
        renderer.draw(last.view, last.w, last.h, dpr, canvas);
        const reference = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        renderer.drawLive(last.view, last.w, last.h, dpr); renderer.prepareCapture();
        const ctx = canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const layer of renderer.element.querySelectorAll('canvas')) ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
        const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        console.log(`display-check: compare ${canvas.width}x${canvas.height}`);
        let changed = 0, sum = 0;
        for (let i = 0; i < actual.length; i += 4) {
          const delta = Math.max(Math.abs(actual[i] - reference[i]), Math.abs(actual[i + 1] - reference[i + 1]), Math.abs(actual[i + 2] - reference[i + 2]), Math.abs(actual[i + 3] - reference[i + 3]));
          if (delta > 2) changed++; sum += delta;
        }
        return { changedFraction: changed / (actual.length / 4), meanDelta: sum / (actual.length / 4) };
      });
      report.checks.at(-1).parity = parity;
      console.log('parity', JSON.stringify(parity));
      assert(parity.changedFraction < .001, `Live/capture parity: ${JSON.stringify(parity)}`);
    }
  }
  if (!baseline) {
    const selector = '[data-setting-path="appearance.renderer"]';
    await page.locator('#family-tab-map').click();
    console.log('renderer controls', await page.locator(selector).count());
    await page.locator(selector).evaluate(e => { for (let p = e.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true; });
    await page.locator(selector).evaluate(e => { e.value = 'classic'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    console.log('switching to classic');
    await page.waitForFunction(() => document.querySelector('#map-canvas').dataset.renderer === 'Classic Canvas' && !document.querySelector('#map-canvas').dataset.presentation, undefined, { timeout: 15000 });
    assert.equal(await page.locator('.viewer-direct').count(), 0);
    await page.mouse.wheel(0, -80); await page.waitForTimeout(150);
    await page.locator(selector).evaluate(e => { e.value = 'bench'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#render-status').hidden && document.querySelector('#map-canvas').dataset.presentation === 'direct');
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.waitForTimeout(200);
    const dimensions = await page.locator('#map').evaluate(el => {
      const canvas = el.querySelector('.viewer-direct canvas:last-child');
      return { w: el.clientWidth, h: el.clientHeight, cw: canvas.width, ch: canvas.height, dpr: devicePixelRatio };
    });
    assert.equal(dimensions.cw, Math.round(dimensions.w * dimensions.dpr));
    assert.equal(dimensions.ch, Math.round(dimensions.h * dimensions.dpr));
    assert.equal(await page.evaluate(() => window.__displayProbe.jobs), 0);
    report.transitions = { classicRoundTrip: true, resize: dimensions };
    if (process.argv.includes('--exports')) {
      await page.locator('#export-open').click();
      await page.locator('#export-format').selectOption('png');
      await page.locator('#export-crop').uncheck();
      await page.locator('#export-resolution').selectOption('1600');
      const downloading = page.waitForEvent('download', { timeout: 120000 });
      await page.locator('#export-go').click();
      const download = await downloading;
      await download.saveAs(resolve(out, `export-${backend}.png`));
      await page.locator('#export-dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.__displayProbe.jobs), 0);
      report.pngExport = true;
    }
  }
  await page.screenshot({ path: resolve(out, baseline ? 'before.png' : `after-${backend}.png`) });
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = error.stack; process.exitCode = 1;
  if (page) {
    report.state = await page.evaluate(() => ({ canvas: { ...document.querySelector('#map-canvas').dataset }, toast: document.querySelector('#toast').textContent, status: document.querySelector('#render-status').textContent }));
    await page.screenshot({ path: resolve(out, `error-${backend}.png`) });
  }
}
finally { await browser.close(); await writeFile(resolve(out, baseline ? 'before.json' : `after-${backend}${dpr !== 1 ? `-dpr${dpr}` : ''}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
