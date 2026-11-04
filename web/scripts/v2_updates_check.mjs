/** Desktop update UI with deterministic releases; never downloads or launches an installer. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

console.log('Starting desktop update UI check…');
const server = await createServer({
  configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), optimizeDeps: { noDiscovery: true },
  server: { host: '127.0.0.1', port: 5187, strictPort: true, watch: null },
  plugins: [{ name: 'desktop-update-check', configureServer(vite) {
    vite.middlewares.use('/__updates-check', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head></head><body><header id="header"></header><main id="settings"></main></body></html>');
    });
  } }],
});
let browser;
let releases = [], responseStatus = 200, requests = 0;
const name = 'Magna Urbis V2_0.3.0_x64-setup.exe';
const url = `https://github.com/dunkean/magna-urbis/releases/download/desktop-v0.3.0/${encodeURIComponent(name)}`;
try {
  await server.listen();
  console.log('Update test server ready; opening browser…');
  const address = server.httpServer.address();
  const fixtureUrl = `http://127.0.0.1:${address.port}/__updates-check`;
  const fixture = await fetch(fixtureUrl, { signal: AbortSignal.timeout(5000) });
  assert.equal(fixture.ok, true);
  assert.match(await fixture.text(), /id="settings"/);
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
  console.log('Update test browser ready.');
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.github.com/repos/dunkean/magna-urbis/releases?*', route => {
    requests++;
    return route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(releases) });
  });
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  console.log('Update test page ready.');
  const mount = desktop => Promise.race([page.evaluate(async desktop => {
    const { mountDesktopUpdates } = await import('/src/v2/desktopUpdates.ts');
    window.openedDownloads = [];
    if (desktop) window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'desktop_release_info') return { version: '0.2.2', platform: 'windows-x86_64' };
      if (command === 'desktop_open_download') { window.openedDownloads.push(args.url); return; }
      throw Error(`Unexpected command: ${command}`);
    } };
    mountDesktopUpdates(document.querySelector('#header'), document.querySelector('#settings'));
  }, desktop), new Promise((_, reject) => { setTimeout(() => reject(Error('Timed out mounting update UI')), 30_000).unref(); })]);

  await mount(false);
  console.log('Web isolation checked.');
  assert.equal(await page.locator('.desktop-updates').count(), 0);
  assert.equal(requests, 0, 'Web must not contact the release API');

  releases = [{ tag_name: 'desktop-v0.3.0', draft: false, prerelease: true, assets: [{ name, size: 100, state: 'uploaded', browser_download_url: url }] }];
  await mount(true);
  const check = page.locator('.desktop-updates button');
  await page.locator('#header .desktop-update-link').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#header a').getAttribute('href'), url);
  await page.locator('#header a').click();
  assert.deepEqual(await page.evaluate(() => window.openedDownloads), [url]);
  assert.match(await page.locator('.desktop-updates').innerText(), /Installed version: 0.2.2/);
  await page.evaluate(async () => { const { setLanguage } = await import('/src/v2/i18n.ts'); setLanguage('fr'); });
  assert.match(await page.locator('#header a').innerText(), /Mise à jour 0.3.0/);
  assert.match(await page.locator('.desktop-updates').innerText(), /Version installée : 0.2.2/);

  responseStatus = 503;
  await check.click();
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('Impossible'));
  assert.equal(await check.isEnabled(), true);
  assert.equal(await page.locator('#header a').isVisible(), true, 'Keep a previously discovered download during a temporary outage');

  responseStatus = 200; releases = [];
  await check.click();
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('Aucun nouvel'));
  assert.equal(await page.locator('#header a').isVisible(), false);
  assert.equal(await check.isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('Desktop update UI: web isolation, update link, native browser opening, FR/EN, network failure and retry passed.');
} finally {
  await browser?.close();
  await server.close();
}
