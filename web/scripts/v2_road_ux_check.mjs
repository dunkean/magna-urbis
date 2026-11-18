// node --import ./scripts/shaderModuleStubs.mjs --import tsx scripts/v2_road_ux_check.mjs
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseProject, serializeProject } from '../src/v2/project.ts';

const out = 'out/v2-road-editor',
  project = parseProject(await readFile(`${out}/fixture.json`, 'utf8'));
const p = (x, y) => ({ x, y });
project.world.landuse.farmsteads = [1800, 4300].map(x => ({
  pos: p(x, 2300),
  angle: 0,
  culture: 'european-organic',
  type: 'longere',
  size: 'family',
  buildings: [[p(x - 10, 2290), p(x + 10, 2290), p(x + 10, 2310), p(x - 10, 2310)]],
  yard: [p(x - 25, 2275), p(x + 25, 2275), p(x + 25, 2325), p(x - 25, 2325)],
  drive: [p(x, 3000), p(x, 2330)],
}));
project.world.landuse.ways = [
  [
    { x: 4000, y: 3000 },
    { x: 4000, y: 3600 },
  ],
];
project.settings.region.autoBuildPopulation = 0;
await writeFile(`${out}/rural-ux.json`, serializeProject(project.settings, project.world));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }),
  errors = [],
  nativeDialogs = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', async d => {
  nativeDialogs.push(d.message());
  await d.dismiss();
});
const overlay = () => page.locator('.v2-network-overlay:not([hidden])');
const handles = () => overlay().locator('[data-role=vertex][data-selected]');
const reveal = selector =>
  page.locator(selector).evaluate(el => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.tagName === 'DETAILS') p.open = true;
      if (p.classList.contains('stage-body') && p.hidden) document.querySelector(`[aria-controls="${p.id}"]`)?.click();
    }
  });
const ready = () => page.waitForFunction(() => document.querySelector('.v2-network-banner:not([hidden])')?.getAttribute('aria-busy') === 'false', null, { timeout: 90000 });
try {
  await page.goto('http://127.0.0.1:4174/v2.html?empty&test=1&lang=en');
  await reveal('#import-open');
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles(`${out}/rural-ux.json`);
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  await page.locator('#family-tab-map').click();
  await page.locator('[data-network-quick=roads]').click();
  const box = await page.locator('#map').boundingBox(),
    view = await page.evaluate(() => window.__v2Test.getView());
  const screen = (x, y) => ({ x: box.x + box.width / 2 + (x - view.cx) * view.scale, y: box.y + box.height / 2 + (y - view.cy) * view.scale });
  const click = async (x, y) => {
    const a = screen(x, y);
    await page.mouse.click(a.x, a.y);
  };
  const drag = async (x, y, tx, ty) => {
    const a = screen(x, y),
      b = screen(tx, ty);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await ready();
  };
  // A farm driveway that was absent from World.roads is selectable; a line click selects the whole track.
  await click(1800, 2600);
  assert.equal(await overlay().locator('[data-selected=true]').count(), 0);
  const count = await handles().count();
  assert.equal(count, 3);
  assert((await overlay().locator('[data-role=add-control]').count()) > 0);
  await overlay().locator('[data-role=add-control]').first().click();
  await ready();
  assert.equal(await handles().count(), count + 1);
  const farmIndex = Number(await overlay().locator('[data-role=road]').getAttribute('data-road'));
  assert.equal(await page.evaluate(i => window.__v2Test.world().roads[i].kind, farmIndex), 'track');
  await page.keyboard.press('Control+z');
  await ready();
  assert.equal(await handles().count(), count);
  // Dragging + creates and moves a waypoint in one gesture, while the farm gate stays anchored.
  const ghost = overlay().locator('[data-role=add-control]').first(),
    gx = Number(await ghost.getAttribute('data-x')),
    gy = Number(await ghost.getAttribute('data-y'));
  await drag(gx, gy, gx + 220, gy - 100);
  assert.equal(await handles().count(), count + 1);
  const farmRoad = await page.evaluate(i => window.__v2Test.world().roads[i], farmIndex);
  assert(farmRoad.controls.some(p => p.x > 1950));
  assert.deepEqual(farmRoad.path.at(-1), { x: 1800, y: 2330 });
  // Explicit add mode offers a second discoverable way to add a waypoint to a field lane.
  await click(4000, 3400);
  const fieldCount = await handles().count();
  assert(fieldCount >= 2);
  await reveal('.v2-network-editor [aria-label="Add a waypoint"]');
  await page.locator('.v2-network-editor button[aria-label="Add a waypoint"]').click();
  await click(4000, 3200);
  await ready();
  assert.equal(await handles().count(), fieldCount + 1);
  await page.screenshot({ path: `${out}/rural-ux.png` });
  // Regional deletion uses an in-app dialog, including cancellation and Escape, without stopping the editor.
  const quality = page.getByRole('button', { name: 'Full quality', exact: true });
  if (await quality.count()) await quality.click();
  await click(3000, 0);
  await overlay().locator('[data-role=delete-entry]').click();
  const entry = page.locator('#delete-road-entry-dialog');
  await entry.waitFor();
  assert.equal(await entry.getAttribute('open'), '');
  await page.keyboard.press('Escape');
  await entry.waitFor({ state: 'detached' });
  assert(await overlay().isVisible());
  await overlay().locator('[data-role=delete-entry]').click();
  await entry.waitFor();
  await entry.locator('[data-choice=cancel]').click();
  await overlay().locator('[data-role=delete-entry]').click();
  await entry.waitFor();
  await entry.locator('[data-choice=confirm]').click();
  await ready();
  assert.equal(await page.evaluate(() => window.__v2Test.world().debug.v2RustRegion.roads.exits.length), 0);
  await page.keyboard.press('Control+z');
  await ready();
  assert.equal(await page.evaluate(() => window.__v2Test.world().debug.v2RustRegion.roads.exits.length), 1);
  await page.locator('#settings-reset').click();
  const reset = page.locator('#reset-settings-dialog');
  await reset.waitFor();
  await reset.locator('[data-choice=cancel]').click();
  await reveal('#export-open');
  await page.locator('#export-open').click();
  await page.locator('#export-format').selectOption('project');
  const downloading = page.waitForEvent('download');
  await page.locator('#export-go').click();
  const download = await downloading;
  const saved = parseProject(await readFile(await download.path(), 'utf8'));
  assert(saved.world.roads.some(r => r.kind === 'track' && r.controls?.length >= 4));
  assert(saved.world.landuse.farmsteads.every(f => f.drive.length === 0));
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/ux-report.json`, JSON.stringify({ ruralPicking: true, clickSelectsRoad: true, plusClick: true, plusDrag: true, explicitAdd: true, undo: true, styledEntryAndResetDialogs: true, save: true, errors, nativeDialogs }, null, 2));
  console.log('Road UX check passed.');
} catch (error) {
  await page.screenshot({ path: `${out}/ux-failure.png` }).catch(() => {});
  console.error({ errors, nativeDialogs });
  throw error;
} finally {
  await browser.close();
}
