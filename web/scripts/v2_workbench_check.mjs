/** Real workshop controls: direct scene persistence, editing exclusivity, engine evidence and responsive chrome. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chooseWorkshopPreference } from './workbench_test_helpers.mjs';
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174';
const out = new URL('../out/workbench/', import.meta.url); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem('magna-browser-advice-closed', '1'));
  await page.goto(`${base}/v2.html?empty&test=1&lang=fr`);
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  const input = async (selector, value) => {
    const control = page.locator(selector);
    if (await control.getAttribute('type') === 'range') {
      await control.evaluate((element, next) => { element.value = next; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    } else await control.fill(value);
    await control.dispatchEvent('change');
  };
  const exported = async (format = 'recipe') => {
    await page.locator('#export-open').click(); await page.locator('#export-format').selectOption(format);
    const pending = page.waitForEvent('download'); await page.locator('#export-go').click();
    const download = await pending; return JSON.parse(await readFile(await download.path(), 'utf8'));
  };
  const imported = async recipe => {
    await page.locator('#import-open').click();
    await page.locator('#project-file').setInputFiles({ name: 'workbench.recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) });
    await page.locator('#import-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  };
  assert.equal(await page.locator('#scene-season').getAttribute('max'), '11');
  await page.locator('#scene-season').focus(); await page.keyboard.press('Home');
  for (let step = 0; step < 12; step++) {
    assert.equal(await page.locator('#scene-season').inputValue(), String(step));
    assert.match(await page.locator('#scene-season-value').innerText(), [ /Hiver/, /Printemps/, /Été/, /Automne/ ][Math.floor(step / 3)]);
    if (step < 11) await page.keyboard.press('ArrowRight');
  }
  await page.locator('[data-season="1"]').click();
  await page.locator('#scene-night').click();
  await input('#scene-elevation', '30'); await input('#scene-strength', '1.5');
  const compass = page.locator('.scene-compass');
  const compassBox = await compass.boundingBox();
  await page.mouse.click(compassBox.x + compassBox.width - 4, compassBox.y + compassBox.height / 2);
  assert.equal(await compass.getAttribute('aria-valuenow'), '90');
  await compass.focus(); await page.keyboard.press('End'); await page.keyboard.press('ArrowRight');
  assert.equal(await compass.getAttribute('aria-valuenow'), '0');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await compass.getAttribute('aria-valuenow'), '359');
  await page.keyboard.press('Home'); await page.keyboard.press('PageUp');
  assert.equal(await compass.getAttribute('aria-valuenow'), '15');
  assert.equal(await page.locator('#scene-night').getAttribute('aria-pressed'), 'true');
  await page.locator('#map-style').selectOption('atlas');
  const recipe = await exported();
  assert.equal(recipe.settings.scene, undefined);
  assert.equal(recipe.settings.appearance.composition.effects.season, 0);
  assert.equal(recipe.settings.appearance.composition.effects.ambience, 'night');
  assert.deepEqual(recipe.settings.appearance.composition.effects.lighting, { enabled: true, azimuth: 15, elevation: 30, strength: 1.5, exaggeration: 2 });
  recipe.settings.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
  recipe.settings.extent = 2400; recipe.settings.settlementCount = 2; recipe.settings.options.population = 200;
  recipe.settings.options.seed = 'workbench-ui-review'; recipe.settings.options.relief = 'flat';
  await imported(recipe);
  assert.equal(await page.locator('#scene-season').inputValue(), '1');
  assert.equal(await page.locator('#scene-elevation').inputValue(), '30');
  assert.equal(await page.locator('#scene-strength').inputValue(), '1.5');
  await page.locator('#scene-day').click();
  await page.locator('#run-chain').click();
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
  assert(!/Échec/.test(await page.locator('#job-log').innerText()), await page.locator('#job-log').innerText());
  assert.equal(await page.locator('#labels-open').isEnabled(), true);
  await page.screenshot({ path: fileURLToPath(new URL('01-workshop.png', out)) });
  await page.locator('#inspect-mode').check();
  assert.equal(await page.locator('#editor-dock').isVisible(), true);
  await page.locator('[data-network-quick="roads"]').click();
  assert.equal(await page.locator('#inspect-mode').isChecked(), false);
  assert.equal(await page.locator('#edit-roads').isVisible(), true);
  await page.locator('#rivers-open').click();
  assert.equal(await page.locator('[data-network-quick="roads"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#edit-rivers').isVisible(), true);
  await page.locator('#labels-open').click();
  assert.equal(await page.locator('#rivers-open').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#edit-labels').isVisible(), true);
  await page.screenshot({ path: fileURLToPath(new URL('02-editing.png', out)) });
  await page.locator('#editor-close').click();
  assert.equal(await page.locator('#editor-dock').isVisible(), false);
  await page.locator('#inspect-mode').check(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inspect-mode').isChecked(), false);
  await page.locator('#hardware-open').click(); await page.locator('#exec-engine').selectOption('rust');
  await page.waitForFunction(() => document.querySelector('[data-process="Terrain generation"]').textContent.includes('Rust'));
  const relief = await page.locator('[data-process="Terrain generation"]').innerText();
  assert.match(relief, /Rust/); assert.match(relief, /TypeScript/);
  await page.screenshot({ path: fileURLToPath(new URL('03-engines.png', out)) });
  await page.locator('#hardware-dialog [data-close]').first().click();
  await page.locator('.illustration-trigger').click();
  await page.locator('.workbench-illustration').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.workbench-illustration').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(37, 39, 31)');
  const generate = await page.locator('.workbench-illustration [data-generate]').boundingBox();
  assert(generate && generate.y > 0 && generate.y + generate.height < 960, 'Illustration action remains visible');
  await page.screenshot({ path: fileURLToPath(new URL('04-illustration.png', out)) });
  await page.locator('[data-illustration-close]').click();
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page overflows at ${width}px`);
    for (const selector of ['#scene-season', '.scene-compass', '#scene-elevation', '#scene-strength', '#scene-day', '#scene-night', '#import-open', '#export-open', '#hardware-open']) {
      const box = await page.locator(selector).boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width + 1, `${selector} clipped at ${width}px`);
    }
    await page.screenshot({ path: fileURLToPath(new URL(`05-width-${width}.png`, out)) });
  }
  await page.locator('#labels-open').click();
  const dock = await page.locator('#editor-dock').boundingBox();
  assert(dock && dock.x >= 0 && dock.x + dock.width <= 391);
  await page.screenshot({ path: fileURLToPath(new URL('06-mobile-editing.png', out)) });
  await page.locator('#editor-close').click();
  await chooseWorkshopPreference(page, 'language', 'en');
  await chooseWorkshopPreference(page, 'units', 'ft');
  assert.equal(await page.locator('#units-select').inputValue(), 'ft');
  await chooseWorkshopPreference(page, 'units', 'm');
  assert.equal(await page.locator('#scene-controls label').first().innerText(), 'Season');
  const saved = await exported('project');
  delete saved.settings.scene; delete saved.settings.appearance.composition; await imported(saved);
  assert.equal(await page.locator('#scene-season').inputValue(), '7');
  assert.equal(await page.locator('#scene-elevation').inputValue(), '45');
  assert.equal(await page.locator('#scene-strength').inputValue(), '1');
  assert.deepEqual(errors, []);
  console.log('Workbench verified: 12 seasonal steps, generated icons, day/night, light direction with pointer and keyboard, height, shading, presets, project round trip, generation, exclusive tools, engine evidence, illustration theme, French/English, 1440/1024/768/390px.');
} finally { await browser.close(); }
