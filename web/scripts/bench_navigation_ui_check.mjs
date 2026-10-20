import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// From web/: node scripts/bench_navigation_ui_check.mjs [bench origin]
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const terrain = page.frameLocator('iframe[data-bench=terrain]');
const params = new URLSearchParams({ source: 'procedural', seed: 'navigation', width: '3000', relief: 'flat',
  generation: 'cpu', compute: 'wasm', hydro_enabled: '0', auto: '0', refine: '0',
  projection: '3d', camera3d: '1200,1600,4500,0.2,0.8,1.5' });
async function ready() {
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=terrain]')?.contentWindow?.magnaBenchContext?.ready(), null, { timeout: 120000 });
  await terrain.locator('#terrain3d').waitFor({ state: 'visible' });
}
async function capture() {
  return page.evaluate(() => document.querySelector('iframe[data-bench=terrain]').contentWindow.magnaBenchContext.capture());
}
try {
  await page.goto(`${base}/terrainbench.html?${params}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForURL('**/rustbench.html#terrain?**', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await ready();
  await terrain.locator('#seed').fill('pending-draft');
  await page.evaluate(() => { document.querySelector('iframe[data-bench=terrain]').contentWindow.__navigationMarker = 'retained'; });
  const before = await capture();
  assert.equal(before.perspective, true);
  for (const stage of ['settlements', 'urban', 'houses']) {
    await page.locator(`nav [data-bench=${stage}]`).click();
    await page.locator(`nav [data-bench=${stage}][aria-current=page]`).waitFor();
    await page.locator('nav [data-bench=terrain]').click();
    await page.locator('nav [data-bench=terrain][aria-current=page]').waitFor();
    await terrain.locator('#terrain3d').waitFor({ state: 'visible' });
    const after = await capture();
    assert.equal(after.perspective, true);
    assert.deepEqual(after.camera3d, before.camera3d);
    assert.equal(await terrain.locator('#seed').inputValue(), 'pending-draft');
    assert.equal(await page.evaluate(() => document.querySelector('iframe[data-bench=terrain]').contentWindow.__navigationMarker), 'retained');
  }
  assert.equal(new URL(await page.locator('#standalone').getAttribute('href')).searchParams.get('standalone'), '1');
  await page.screenshot({ path: 'out/bench-navigation-3d.png' });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await ready();
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=terrain]')?.contentDocument?.querySelector('#seed')?.value === 'pending-draft', null, { timeout: 90000 });
  assert.deepEqual((await capture()).camera3d, before.camera3d);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, directEntry: true, tabs: 4, live3dCamera: true, drafts: true, reload: true, errors }, null, 2));
} finally { await browser.close(); }
