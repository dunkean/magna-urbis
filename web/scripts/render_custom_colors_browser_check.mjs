/** Real retained city: personalized map/export pixels, project roundtrip and no generation jobs. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5187/v2.html';
const fixture = resolve(process.env.MAGNA_RENDER_FIXTURE ?? 'out/v2-rust-browser/06-native-houses.json');
const output = resolve('out/render-custom-colors'); await mkdir(output, { recursive: true });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const physical = project => ({ terrain: project.world.terrain.height, native: project.world.terrain.v2NativeTerrain?.height, cities: project.world.debug?.v2RustCities });
const project = JSON.parse(await readFile(fixture, 'utf8')), retained = digest(physical(project));
const lighting = { enabled: false, azimuth: 315, elevation: 45, strength: 1, exaggeration: 2 };
project.settings.appearance = { style: 'atlas', terrainStyle: 'atlas', renderer: 'bench', contours: false, landuse: false, labels: false, lighting };
const input = resolve(output, 'retained-input.json'); await writeFile(input, JSON.stringify(project));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(120000);
const report = { errors: [], fixture, checks: {} }; page.on('pageerror', error => report.errors.push(error.message));
await page.addInitScript(() => {
  window.__colorGenerationJobs = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) { if (['all','terrain','region','roads','town','towns'].includes(args[0]?.action)) window.__colorGenerationJobs.push(args[0].action); return post.apply(this, args); };
});
const reveal = selector => page.locator(selector).evaluate(element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true; });
const idle = async () => { await page.waitForTimeout(250); await page.waitForFunction(() => document.querySelector('#render-status').hidden); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
const setColor = async (key, value) => { const selector = `[data-render-color="${key}"]`; await reveal(selector); await page.locator(selector).fill(value); await idle(); };
const download = async (format, name) => {
  await page.locator('#render-settings').evaluate(element => { element.open = false; });
  await page.locator('#export-open').click(); await page.locator('#export-format').selectOption(format);
  if (format === 'png') { await page.locator('#export-crop').uncheck(); await page.locator('#export-resolution').selectOption('1600'); }
  const pending = page.waitForEvent('download'); await page.locator('#export-go').click(); const result = await pending;
  const path = resolve(output, name); await result.saveAs(path); await page.locator('#export-dialog').waitFor({ state: 'hidden' }); return readFile(path);
};
try {
  await page.goto(`${url}?empty&lang=fr`); await page.locator('#import-open').click();
  await page.locator('#import-scope').selectOption('complete'); await page.locator('#project-file').setInputFiles(input);
  await page.locator('#import-dialog').waitFor({ state: 'hidden' }); await idle();
  const baseline = await page.locator('#map-canvas').evaluate(canvas => canvas.toDataURL());
  await setColor('groundLow', '#a02080'); await setColor('groundHigh', '#a02080');
  const countPixels = () => page.locator('#map-canvas').evaluate(canvas => {
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height; const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let count = 0; for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 160) <= 2 && Math.abs(data[i + 1] - 32) <= 2 && Math.abs(data[i + 2] - 128) <= 2) count++;
    return count;
  });
  assert.notEqual(await page.locator('#map-canvas').evaluate(canvas => canvas.toDataURL()), baseline);
  const mapPixels = await countPixels(); assert(mapPixels > 1000, `Only ${mapPixels} custom ground pixels`);
  await setColor('river', '#00ccee'); await setColor('building', '#cc7700');
  await page.locator('#render-settings').evaluate(element => { element.open = false; });
  await page.screenshot({ path: resolve(output, 'custom-map.png') });
  const png = await download('png', 'custom-map.png');
  const exportPixels = await page.evaluate(async encoded => {
    const response = await fetch(`data:image/png;base64,${encoded}`), bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0; for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 160) <= 2 && Math.abs(data[i + 1] - 32) <= 2 && Math.abs(data[i + 2] - 128) <= 2) count++;
    bitmap.close(); return count;
  }, png.toString('base64'));
  assert(exportPixels > 1000, `Only ${exportPixels} custom export pixels`);
  const saved = JSON.parse(await download('project', 'custom-project.json'));
  assert.equal(digest(physical(saved)), retained);
  assert.deepEqual(saved.settings.appearance.colors, { groundLow: '#a02080', groundHigh: '#a02080', river: '#00ccee', building: '#cc7700' });
  assert.deepEqual(await page.evaluate(() => window.__colorGenerationJobs), []);
  assert.deepEqual(report.errors, []);
  report.checks = { mapPixels, exportPixels, retainedPhysicalData: true, projectColors: saved.settings.appearance.colors, generationJobs: [] }; report.ok = true;
  console.log(JSON.stringify(report));
} catch (error) { report.ok = false; report.failure = String(error.stack ?? error); process.exitCode = 1; console.error(report.failure); await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); }
finally { await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
