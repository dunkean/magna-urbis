// Run after v2_contour_editing_check.mjs; reopens its real binary city, without regenerating it.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { editableContours } from '../src/v2/contourEdits.ts';
import { contourProblem } from '../src/v2/contourGeometry.ts';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }),
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }),
  errors = [];
page.on('pageerror', e => errors.push(e.message));
const ready = () => page.waitForFunction(() => document.querySelector('.v2-contour-session')?.getAttribute('aria-busy') === 'false' && document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
const points = () => page.locator('.v2-contour-overlay:not([hidden]) [data-contour-role=point]');
try {
  await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:4174'}/v2.html?empty&test=1&lang=en&profile=web&threads=off`);
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles('out/contour-editing/split-quarter.muproj');
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  const w = await page.evaluate(() => {
    const w = window.__v2Test.world();
    return { settlements: w.settlements.map(({ urban, ...t }) => t), debug: { v2RustCities: w.debug.v2RustCities } };
  });
  assert(
    Object.values(w.debug.v2RustCities).some(s => s.layouts[0].config.quarterEdits?.parts.length),
    'binary reopen retains native quarter split',
  );
  const target = editableContours(w, 'quarter').find(t => !contourProblem(t.shape));
  assert(target);
  await page.locator('#family-tab-map').click();
  await page.locator('[data-contour-tool=quarter]').click();
  const xs = target.shape.outer.map(p => p.x),
    ys = target.shape.outer.map(p => p.y),
    box = await page.locator('#map').boundingBox(),
    view = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, scale: Math.min(4, (box.width - 360) / (Math.max(...xs) - Math.min(...xs)), (box.height - 180) / (Math.max(...ys) - Math.min(...ys))) };
  await page.evaluate(v => window.__v2Test.setView(v), view);
  const [p, q] = target.shape.outer.map((p, i) => [p, target.shape.outer[(i + 1) % target.shape.outer.length]]).sort((a, b) => Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) - Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y))[0],
    mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
    x = box.x + box.width / 2 + (mid.x - view.cx) * view.scale,
    y = box.y + box.height / 2 + (mid.y - view.cy) * view.scale;
  await page.mouse.click(x, y);
  const n = await points().count();
  await page.waitForTimeout(450);
  await page.mouse.dblclick(x, y, { delay: 90 });
  await ready();
  assert.equal(await points().count(), n + 1);
  await page.locator('[data-contour-finish]').click();
  await page.keyboard.press('Control+z');
  await ready();
  assert.equal(await points().count(), n, 'undo after Finish restores selected outline and handles');
  await page.locator('[data-contour-tool=block]').click();
  await page.keyboard.press('Control+Shift+z');
  await ready();
  assert.equal(await points().count(), n + 1, 'redo restores the correct contour family');
  assert.equal(await page.locator('[data-contour-tool=quarter]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-contour-tool=block]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);
  const report = { ok: true, reopened: true, undoAfterFinish: true, redoAcrossFamilies: true };
  await writeFile('out/contour-editing/history-report.json', JSON.stringify(report, null, 2));
  console.log(report);
} finally {
  await browser.close();
}
