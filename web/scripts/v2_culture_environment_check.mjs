/** Real V2 controls: culture filtering, environment changes, dice and generation entry. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/v2.html?empty&lang=fr`, { waitUntil: 'domcontentloaded' });
  await page.locator('#culture-random').waitFor({ state: 'attached' });
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  const selected = () => page.locator('[data-option="culture"]').inputValue();
  const pool = () => page.locator('[data-option="culture"]').evaluate(el => Array.from(el.options, option => option.value));
  const automatic = () => page.locator('#culture-environment').isChecked();
  const change = (selector, value) => page.locator(selector).evaluate((el, next) => {
    if (el.type === 'checkbox') el.checked = next; else el.value = next;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  const click = selector => page.locator(selector).evaluate(el => el.click());
  assert(await automatic());
  assert.equal(await page.locator('#family-region .name-origin-controls').count(), 0);
  assert.equal(await page.locator('#family-settlements #settlements-name-origin').count(), 1);
  await change('#terrain-relief', 'mountains');
  await change('#stage-terrain-climate', 'desert');
  const desert = await pool();
  assert(desert.includes('persian')); assert(!desert.includes('european-organic'));
  assert(desert.includes(await selected()));
  const beforeDice = await selected(); await click('#culture-random');
  assert.notEqual(await selected(), beforeDice); assert(await automatic());

  // These changes keep the stored surface climate and relief: the layer must still refresh the pool.
  await change('#stage-terrain-climate', 'underdark');
  assert.deepEqual((await pool()).sort(), ['drow-enclave', 'duergar-hold', 'myconid-colony']);
  const beforeUnderdarkDice = await selected(); await click('#culture-random');
  assert.notEqual(await selected(), beforeUnderdarkDice);
  await change('#stage-terrain-climate', 'desert');
  assert.deepEqual(await pool(), desert); assert(desert.includes(await selected()));

  await change('#culture-environment', false);
  assert((await pool()).includes('american-grid'));
  await change('[data-option="culture"]', 'american-grid');
  assert(!await automatic());
  await page.evaluate(() => { Math.random = () => 0; });
  await click('#culture-random');
  assert.equal(await selected(), 'european-organic'); assert(!await automatic());
  // The last pre-modern catalogue entry is outside the desert niche, but remains drawable without follow.
  await page.evaluate(() => { Math.random = () => .999999; });
  await click('#culture-random'); assert.equal(await selected(), 'goblin-warren');
  await change('#culture-environment', true);
  assert.deepEqual(await pool(), desert); assert(desert.includes(await selected()));
  await change('[data-option="culture"]', desert.at(-1));
  assert(!await automatic()); assert((await pool()).includes('american-grid'));
  await change('#culture-environment', true);

  // Observe the synchronous generation entry, then cancel before any terrain computation starts.
  await click('#family-tab-region');
  const entry = await page.evaluate(() => {
    Math.random = () => 0;
    document.querySelector('#run-chain').click();
    const actual = document.querySelector('[data-option="culture"]').value;
    const disabled = document.querySelector('#culture-random').disabled && document.querySelector('#culture-environment').disabled;
    document.querySelector('#cancel-job').click();
    return { actual, disabled };
  });
  assert.equal(entry.actual, 'persian'); assert(entry.disabled);
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  await click('#family-tab-settlements');
  await mkdir(new URL('../out/culture-environments/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../out/culture-environments/controls.png', import.meta.url)) });
  // Autosaved placement counts must not silently switch the default back off on reload.
  await page.goto(`${base}/v2.html?lang=fr`, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  assert(await automatic());
  assert.equal(await page.locator('#family-region .name-origin-controls').count(), 0);
  assert.equal(await page.locator('#family-settlements #settlements-name-origin').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: V2 culture filters, relief/climate/Underdark transitions, manual selection, both dice modes and generation draw.');
} finally { await browser.close(); }
