// From web/: node scripts/fantasy_occupation_ui_check.mjs [bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('out/fantasy', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const Base = Worker;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data.scene?.landuse) window.__occupationReplies = (window.__occupationReplies ?? 0) + 1;
      });
    }
  };
});
const dispatch = (id, value, event = 'input') => page.locator(`#${id}`).evaluate((input, { value, event }) => {
  if (input.type === 'checkbox') input.checked = value; else input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
}, { value, event });
async function ready() {
  await page.waitForFunction(() => document.querySelector('#landuseStatus')?.textContent.includes('zones ·'), null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#fantasyPainting image'), null, { timeout: 120000 });
}
try {
  const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/terrainbench.html');
  url.search = new URLSearchParams({ standalone: '1', stage: 'settlements', source: 'procedural', profile: 'web', compute: 'wasm', auto: '0',
    style: 'fantasy-color', brush_landuse: '1', hydro_enabled: '0', generation: 'cpu' }).toString();
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#terrainLibrary').waitFor();
  const artifact = await page.evaluate(async () => {
    const { decodeDecor } = await import('/decor.ts'), { saveHistory } = await import('/benchHistory.ts');
    const response = await fetch('/decors/d001-hills-inland-hamlet.decor');
    const saved = await saveHistory(decodeDecor(new Uint8Array(await response.arrayBuffer())), false);
    return saved.meta.id;
  });
  url.searchParams.set('artifact', artifact);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await ready();
  assert.equal(await page.locator('#brush_landuse').isChecked(), true);
  assert.equal(Number(await page.locator('#brush_size').getAttribute('min')), 0.1);
  await page.locator('#viewport').screenshot({ path: 'out/fantasy/occupation-guided.png' });
  const painting = await page.locator('#fantasyPainting').innerHTML();
  const replies = await page.evaluate(() => window.__occupationReplies);
  await dispatch('landuseOpacity', '.25');
  assert.equal(await page.locator('#landuseLayer').getAttribute('opacity'), '0.25');
  await dispatch('landuseVisible', false, 'change');
  assert.equal(await page.locator('#showLanduse').isChecked(), false);
  assert.equal(await page.locator('#landuseLayer').evaluate(layer => getComputedStyle(layer).display), 'none');
  assert.equal(await page.locator('#fantasyPainting').innerHTML(), painting, 'hidden occupation still guides the same brushes');
  await page.locator('#viewport').screenshot({ path: 'out/fantasy/occupation-hidden.png' });
  await page.locator('[data-land-kind=forest]').evaluate(box => { box.checked = false; box.dispatchEvent(new Event('change')); });
  await dispatch('landuseFarms', false, 'change');
  assert.equal(await page.evaluate(() => window.__occupationReplies), replies, 'display edits do not regenerate occupation');
  await dispatch('brush_size', '.1');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('brush_size') === '0.1');
  await page.reload(); await ready();
  assert.equal(await page.locator('#brush_landuse').isChecked(), true);
  assert.equal(await page.locator('#brush_size').inputValue(), '0.1');
  assert.equal(await page.locator('#landuseVisible').isChecked(), false);
  assert.equal(await page.locator('#landuseOpacity').inputValue(), '0.25');
  assert.equal(await page.locator('[data-land-kind=forest]').isChecked(), false);
  assert.equal(await page.locator('#landuseFarms').isChecked(), false);
  await dispatch('landuseVisible', true, 'change');
  await dispatch('brush_size', '1');
  await dispatch('brush_landuse', false, 'change');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('brush_landuse') === '0');
  await dispatch('brush_landuse', true, 'change');
  const exportButton = page.locator('#fantasyExport_svg');
  await exportButton.evaluate(button => { for (let p = button.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
  await exportButton.click();
  const downloaded = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('.export-crop [data-action=export]').click();
  const download = await downloaded;
  await download.saveAs('out/fantasy/occupation-export.svg');
  const svg = await readFile('out/fantasy/occupation-export.svg', 'utf8');
  assert(svg.includes('id="landuseLayer"') && svg.includes('opacity="0.25"'));
  assert(!svg.includes('<foreignObject'), 'occupation canvas is embedded in the SVG export');
  await page.locator('#brush_landuse').evaluate(input => {
    const button = input.closest('.terrain-help-row')?.querySelector('button.terrain-help');
    if (!button) throw new Error('Occupation control has no method help'); button.click();
  });
  assert.equal(await page.locator('.method-note').isVisible(), true);
  assert((await page.locator('.method-note article').innerText()).includes('PNPOLY'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ occupation: true, display: true, replay: true, svg: true, help: true, errors }));
} catch (error) {
  console.error(await page.evaluate(() => ({ status: document.querySelector('#status')?.textContent,
    occupation: document.querySelector('#landuseStatus')?.textContent, page: location.pathname })), errors);
  await page.screenshot({ path: 'out/fantasy/occupation-failure.png' });
  throw error;
} finally { await browser.close(); }
