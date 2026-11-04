/** Verify the built V2 splash while its entry module is delayed, then boot the app. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(web, 'dist-v2');
const screenshot = resolve(web, 'out/v2-splash.png');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const path = resolve(dist, name || 'v2.html');
    if (!path.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
let browser, release;
try {
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let entryRequested;
  const requested = new Promise(resolveRequest => { entryRequested = resolveRequest; });
  const gate = new Promise(resolveGate => { release = resolveGate; });
  await page.route(/\/assets\/v2-[^/]+\.js(?:\?.*)?$/, async route => { entryRequested(); await gate; await route.continue(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/v2.html`, { waitUntil: 'commit' });
  await Promise.race([requested, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('V2 entry module was not requested')), 15000); timer.unref(); })]);
  await page.locator('#boot-splash').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => { const image = document.querySelector('#boot-splash img'); return image && image.complete && image.naturalWidth > 0; });
  const imageBytes = await page.locator('#boot-splash img').evaluate(async img => {
    const response = await fetch(img.src);
    if (!response.ok) throw Error(`Splash image HTTP ${response.status}`);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const expected = await readFile(resolve(web, '../rust/desktop-v2/assets/app-icon.png'));
  if (hash(Buffer.from(imageBytes)) !== hash(expected)) throw Error('Splash image differs from the requested detailed logo.');
  if (await page.locator('#hardware-open').count()) throw Error('App initialized before the entry module was released');
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  release();
  await page.locator('#boot-splash').waitFor({ state: 'detached', timeout: 60000 });
  await page.locator('#hardware-open').waitFor({ state: 'visible', timeout: 30000 });
  if (errors.length) throw Error(`Page errors: ${errors.join('; ')}`);
  console.log(`Splash image loaded, appeared before initialization, and was removed after startup. Screenshot: ${screenshot}`);
} finally {
  release?.();
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
