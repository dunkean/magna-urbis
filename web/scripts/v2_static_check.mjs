/** Serve exactly the production artifact at a GitHub Pages-style subpath. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url)), output = resolve(web, 'dist-v2');
const prefix = '/magna-urbis/v2/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const name = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const path = resolve(output, name);
    if (!path.startsWith(output + sep) || !(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const neuralManifestBundled = await stat(resolve(output, 'neural/models/manifest.json')).then(() => true, () => false);
const result = { time: new Date().toISOString(), base, errors: [], missing: [], optionalMissing: [], checks: {} };
let browser;
try {
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
    args: process.env.MAGNA_TEST_GPU === '1' ? ['--enable-unsafe-webgpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('response', response => {
    if (response.status() < 400) return;
    // The ordinary prepare:v2 build deliberately excludes optional neural models.
    if (!neuralManifestBundled && response.status() === 404 && response.url() === `${base}neural/models/manifest.json`) {
      result.optionalMissing.push(response.url()); return;
    }
    result.missing.push(response.url());
  });
  await page.goto(`${base}index.html?lang=fr`, { waitUntil: 'domcontentloaded' });
  await page.locator('#generate-region').waitFor();
  assert.equal(await page.locator('#progress-card').isVisible(),false);
  const reveal=async selector=>page.locator(selector).evaluate(node=>{for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
  await page.locator('#hardware-open').click();
  await page.locator('#exec-engine').selectOption('rust');
  await page.locator('#exec-compute').selectOption('cpu');
  await page.locator('#hardware-dialog [data-close]').first().click();
  // This gate qualifies CPU/WASM and static assets; material rendering is covered by the real-GPU live check.
  await page.locator('#map-style').selectOption('parchment');
  await page.locator('#relief-advanced-open').click();
  const resolution='#terrain-controls [data-setting-path="terrain.resolution"]';await reveal(resolution);await page.locator(resolution).fill('128');
  await page.locator('#relief-advanced .relief-advanced-head button').click();
  await page.locator('#generate-region').click();
  // The click first awaits cancellation of background work, before setting aria-busy.
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'true', null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
  assert.match(await page.locator('#footer-status').textContent(), /Carte prête/);
  assert.match(await page.locator('#job-log').textContent(), /rust-wasm-cpu/);
  await page.locator('#hardware-open').click();
  await page.locator('.preferences-section summary').click();
  const scienceHref = await page.locator('.science-link').getAttribute('href');
  assert(scienceHref.startsWith('https://magna-urbis.org/scientific/'));
  // Inspect the bundled atlas locally, independently of public DNS and CDN caches.
  const science = await context.newPage();
  await science.goto(new URL(scienceHref.replace('https://magna-urbis.org/', ''), base).href);
  await page.locator('#hardware-dialog [data-close]').first().click();
  await science.waitForLoadState('networkidle');
  assert.match(await science.locator('body').textContent(), /Magna Urbis/);
  await science.locator('img').evaluateAll(async images => {
    for (const image of images) image.loading = 'eager';
    await Promise.all(images.map(image => image.decode().catch(() => {})));
  });
  const brokenImages = await science.locator('img').evaluateAll(images => images.filter(image => !image.complete || !image.naturalWidth).map(image => image.src));
  assert.deepEqual(brokenImages, []);
  const resources = await science.locator('[src],link[href]').evaluateAll(elements => elements.map(el => el.getAttribute('src') ?? el.getAttribute('href')));
  for (const relative of resources) {
    if (!relative || relative.startsWith('data:') || /^(?:https?:)?\/\//.test(relative)) continue;
    const resource = new URL(relative, science.url());
    const response = await fetch(resource); assert(response.ok, `Missing production documentation asset: ${resource}`);
  }
  await page.screenshot({ path: `${web}/out/v2-production.png`, fullPage: true });
  await science.screenshot({ path: `${web}/out/v2-science-production.png`, fullPage: true });
  result.checks = { pageSubpath: true, standaloneWorkers: true, topographyGenerated: true, rustWasmCpuGenerated: true,
    scienceLoaded: true, scienceResources: resources.length, imagesLoaded: true };
  assert.deepEqual(result.errors, []); assert.deepEqual(result.missing, []);
  result.ok = true;
} catch (error) { result.ok = false; result.error = error.stack; process.exitCode = 1;
  const page=browser?.contexts()[0]?.pages()[0];
  if(page)result.state=await page.evaluate(()=>({footer:document.querySelector('#footer-status')?.textContent,toast:document.querySelector('#toast')?.textContent,log:document.querySelector('#job-log')?.textContent})).catch(()=>undefined);
}
finally {
  await browser?.close(); await new Promise(resolveClosed => server.close(resolveClosed));
  await mkdir(`${web}/out`, { recursive: true });
  await writeFile(`${web}/out/v2-static-check.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
