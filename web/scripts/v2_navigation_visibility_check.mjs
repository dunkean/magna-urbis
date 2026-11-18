/** Actual WebGL fog uploads and first-flight placement over a retained, flat scene. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = new URL('../out/workbench-layout/', import.meta.url);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const locations = new WeakSet();
    const find = WebGL2RenderingContext.prototype.getUniformLocation,
      upload = WebGL2RenderingContext.prototype.uniform1f;
    WebGL2RenderingContext.prototype.getUniformLocation = function (program, name) {
      const location = find.call(this, program, name);
      if (location && name === 'fogDistance') locations.add(location);
      return location;
    };
    WebGL2RenderingContext.prototype.uniform1f = function (location, value) {
      if (location && locations.has(location)) {
        window.lastFogDistance = value;
        // Comparison image only: replay the previous 100 m first-person parameter through the real renderer.
        if (window.comparePreviousFog) value = 100;
      }
      return upload.call(this, location, value);
    };
  });
  await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5185'}/v2.html?empty&test=1&lang=fr&renderer=webgl`);
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  const fixture = JSON.parse(await readFile(new URL('fixture.json', out), 'utf8'));
  fixture.settings.appearance.city = { refinement: 'source' };
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles({ name: 'navigation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  await page.locator('#family-tab-map').click();
  await page.locator('#view3d').click();
  const nav = page.locator('.toolbar-row [data-navigation]');
  await nav.waitFor();
  await page.evaluate(() => window.__v2Test.setCamera3d({ ...window.__v2Test.camera3d(), navigation: 'orbit', x: 500, y: 800, distance: 1500, yaw: 0, pitch: 0.8, exaggeration: 1, flightAltitude: undefined }));
  await page.waitForFunction(() => window.lastFogDistance === 3000);
  await nav.selectOption('fly');
  const firstFlight = await page.evaluate(() => window.__v2Test.camera3d());
  assert.equal(firstFlight.x, 500);
  assert.equal(firstFlight.y, 800);
  assert(Math.abs(firstFlight.flightAltitude - 21.7) < 0.001, 'first flight starts 1.7 m above the retained 20 m ground');
  assert.equal(firstFlight.pitch, 0.08);
  await page.waitForFunction(() => window.lastFogDistance === 5000);
  await page.screenshot({ path: fileURLToPath(new URL('flight-clear.png', out)) });
  await page.evaluate(() => {
    window.comparePreviousFog = true;
    window.__v2Test.setCamera3d(window.__v2Test.camera3d());
  });
  await page.screenshot({ path: fileURLToPath(new URL('flight-previous-fog.png', out)) });
  await page.evaluate(() => (window.comparePreviousFog = false));
  await nav.selectOption('walk');
  await page.waitForFunction(() => window.lastFogDistance === 5000);
  await page.screenshot({ path: fileURLToPath(new URL('walk-clear.png', out)) });
  await nav.selectOption('orbit');
  await page.waitForFunction(() => window.lastFogDistance === 3000);
  assert.deepEqual(errors, []);
  await writeFile(new URL('navigation-visibility-report.json', out), JSON.stringify({ checks: 'passed', firstFlight, firstPersonFogDistance: 5000, orbitFogDistance: 3000, errors }, null, 2));
  console.log('Navigation visibility passed: clear first-person fog uploads, first flight at eye level, orbit preserved.');
} finally {
  await browser.close();
}
