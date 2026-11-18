/** Culture browser, compact city choices and authored name visibility; no engine required. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

execFileSync(process.execPath, ['--import', './scripts/shaderModuleStubs.mjs', '--import', 'tsx', 'scripts/v2_workbench_layout_fixture.ts'], { cwd: new URL('..', import.meta.url), windowsHide: true });
const out = 'out/culture-names';
await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile('out/workbench-layout/fixture.json', 'utf8'));
fixture.settings.naming = {
  title: 'Test City',
  places: { main: 'Test City', village: 'Test Village' },
  labels: Object.fromEntries(Array.from({ length: 345 }, (_, i) => [`free:test:${i}`, { kind: 'free', text: `Street ${String(i).padStart(3, '0')}`, hidden: true, anchor: { x: 200 + (i % 20) * 25, y: 200 + Math.floor(i / 20) * 25 } }])),
};
await writeFile(`${out}/fixture.json`, JSON.stringify(fixture));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.setDefaultTimeout(30000);
try {
  await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174'}/v2.html?empty&test=1&lang=en`);
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#map-style').inputValue(), 'satellite');
  await page.locator('#family-tab-settlements').click();
  await page.locator('#culture-environment').uncheck();
  await page.locator('[data-option=culture]').click();
  const cultures = page.locator('.culture-browser');
  assert(await cultures.isVisible());
  assert.equal(await cultures.locator('section').count(), 5);
  await page.screenshot({ path: `${out}/cultures.png` });
  await cultures.getByRole('searchbox').fill('Roman');
  await cultures.locator('[data-culture-choice=roman-core]').click();
  assert.equal(await page.locator('[data-option=culture]').inputValue(), 'roman-core');
  await page.locator('#family-tab-cities').click();
  const sprawl = page.locator('[data-option=sprawl]');
  assert.equal(await sprawl.inputValue(), '1');
  await sprawl.fill('1.4');
  await sprawl.dispatchEvent('change');
  assert.equal(await sprawl.inputValue(), '1.4');
  await sprawl.fill('');
  await sprawl.dispatchEvent('change');
  assert.equal(await sprawl.inputValue(), '1');
  assert.equal(await page.locator('#family-cities > .family-general [data-setting-path="layout.tissue"]').inputValue(), 'grid');
  assert.equal(await page.locator('#family-cities > .family-general [data-city-pattern=grid]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#family-cities > .family-general [data-setting-path="parcels.operator"]').inputValue(), 'courtyard');
  const pattern = page.locator('#family-cities > .family-general [data-city-pattern=radial]').first();
  assert(await pattern.isVisible());
  await pattern.click();
  assert.equal(await pattern.getAttribute('aria-pressed'), 'true');
  const compact = await page
    .locator('#family-cities > .family-general .parameter-field')
    .first()
    .evaluate(label => {
      const caption = label.querySelector('.parameter-caption').getBoundingClientRect(),
        input = label.querySelector('input,select').getBoundingClientRect();
      return Math.abs(caption.y + caption.height / 2 - input.y - input.height / 2) < 2;
    });
  assert(compact, 'caption and value share a line');
  await page.screenshot({ path: `${out}/cities.png` });
  await page.locator('#family-cities > .advanced-open').click();
  const advanced = page.locator('#family-cities > .workbench-advanced');
  for (const [path, expected] of [
    ['layout.preset', 'roman-core/core'],
    ['layout.fortification', 'wall'],
    ['layout.axisAlignment', 'road'],
  ]) {
    const input = advanced.locator(`[data-setting-path="${path}"]`).first();
    await input.selectOption('culture');
    assert.equal(await input.getAttribute('data-resolved-value'), expected, path);
  }
  await advanced.locator('[data-setting-path="layout.mixCulture"]').first().click();
  await cultures.getByRole('searchbox').fill('Roman');
  await cultures.locator('[data-culture-choice=roman-core]').click();
  assert(await advanced.evaluate(el => el.matches(':popover-open')), 'a culture choice preserves its advanced panel');
  await page.keyboard.press('Escape');
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles(`${out}/fixture.json`);
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  // New inspectors use the same browser, retaining their own change handlers.
  await page.locator('#family-tab-cities').click();
  await page.locator('[data-town=main]').click();
  await page.locator('#local-culture').click();
  assert(await cultures.isVisible());
  await cultures.getByRole('searchbox').fill('Roman');
  await cultures.locator('[data-culture-choice=roman-core]').click();
  assert.equal(await page.locator('#local-culture').inputValue(), 'roman-core');
  await page.locator('#edit-place-name').click();
  assert.equal(await page.locator('#family-tab-map').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('.map-label-card input[type=text]').inputValue(), 'Test City');
  const labels = page.locator('.map-label-editor');
  assert(await labels.isVisible(), 'Editor opens the name browser');
  const search = labels.getByRole('searchbox');
  await search.fill('Street');
  assert.match(await labels.locator('.map-label-pager small').textContent(), /1–100 of 345/);
  for (let i = 0; i < 3; i++) await labels.getByRole('button', { name: 'Next', exact: true }).click();
  assert.match(await labels.locator('.map-label-pager small').textContent(), /301–345 of 345/);
  await search.fill('Street 344');
  const row = labels.locator('[data-label-id="free:test:344"]');
  await row.locator('select').selectOption('show');
  await row.locator('button').click();
  assert(await page.locator('.map-label-marker').isVisible());
  await labels.getByRole('textbox', { name: 'Label text', exact: true }).fill('Chosen street');
  await labels.getByRole('textbox', { name: 'Label text', exact: true }).dispatchEvent('change');
  await search.fill('Chosen street');
  await labels.locator('[data-label-id="free:test:344"] select').selectOption('hide');
  await page.waitForFunction(() => document.querySelector('#map-names-apply').getAttribute('aria-busy') === 'false');
  await page.screenshot({ path: `${out}/names.png` });
  // Export is the public persistence boundary; reopening must retain the authored choice.
  async function save() {
    await page.locator('#export-open').click();
    await page.locator('#export-format').selectOption('project');
    const downloaded = page.waitForEvent('download');
    await page.locator('#export-go').click();
    const download = await downloaded,
      path = await download.path();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (await page.locator('#export-dialog').isVisible()) await page.locator('#export-dialog [data-close]').first().click();
    return saved;
  }
  const saved = await save();
  assert.equal(saved.settings.naming.labels['free:test:344'].hidden, true);
  assert.equal(saved.settings.naming.labels['free:test:344'].text, 'Chosen street');
  await writeFile(`${out}/saved.json`, JSON.stringify(saved));
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles(`${out}/saved.json`);
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  await page.locator('#family-tab-map').click();
  await search.fill('Chosen street');
  assert.equal(await labels.locator('[data-label-id="free:test:344"] select').inputValue(), 'hide');
  await labels.locator('[data-label-id="free:test:344"] select').selectOption('auto');
  assert.equal((await save()).settings.naming.labels['free:test:344'].hidden, undefined);
  await page.locator('#language-select').selectOption('fr');
  assert.match(await labels.innerText(), /Parcourir les toponymes/);
  assert.deepEqual(errors, []);
  console.log('Culture browser, city choices and name visibility passed (including save/reopen).');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
