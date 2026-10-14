// From web/: node scripts/terrain_urban_controls_ui_check.mjs [Terrain Bench URL]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const target = new URL(process.argv[2] ?? 'http://localhost:5173/terrainbench.html');
target.search = new URLSearchParams({ v: '4', seed: '42', width: '40000', motif: '3000', source: 'neural', relief: 'valley', coasts: 'N', climate: 'mediterranean', style: 'render', auto: '1', pins: '6926.7,3193.3,', showPins: '0', view: '16241.2,12890.1,0.944' }).toString();
target.searchParams.set('settlements', JSON.stringify({ enabled: true, config: { mode: 'counts', main: { key: 'main', population: 3000, culture: 'european-organic', kind: 'settlement', siteType: 'auto', sitePrefs: {} }, counts: { city: 0, town: 0, village: 9, hamlet: 12, farmstead: 25 } } }));
target.searchParams.set('roads', JSON.stringify({ enabled: true, config: { level: 'developed', culture: 'medieval', density: 0.5, sharing: 0.7, exits: 4 } }));
target.searchParams.set('urban', JSON.stringify({ enabled: true, parcelEnabled: true, target: 'main', layoutConfig: { composition: 'district', placement: 'notched', preset: 'japanese-jokamachi/village', culture: 'european-organic', recipe: 'core', zone: 'core', count: 3, fortification: 'none', axisAlignment: 'culture', exitTreatment: 'legacy', siteAdaptation: 0, footprint: { mechanism: 'legacy', budget: 'radius' }, tissue: 'radial', accessMode: 'adaptive' } }));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const Base = window.Worker;
  window.urbanRequests = []; window.urbanReplies = 0; window.parcelReplies = 0; window.terrainReplies = 0;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', event => {
        if (event.data.layouts) { window.urbanLayouts = event.data.layouts; window.urbanReplies++; }
        if (event.data.partitions) { window.urbanPartitions = event.data.partitions; window.parcelReplies++; }
        if (event.data.terrain && event.data.kind === 'overview' && !event.data.partial) window.terrainReplies++;
      });
    }
    postMessage(message, ...args) {
      if (message.kind === 'quarters' || message.kind === 'parcels') window.urbanRequests.push(message.kind);
      if (message.kind === 'quarters') { window.urbanLayouts = undefined; window.urbanPartitions = undefined; }
      if (message.kind === 'parcels') window.urbanPartitions = undefined;
      super.postMessage(message, ...args);
    }
  };
});
const config = key => page.locator(`#urbanQuarterStage [data-config="${key}"]`);
const footprint = key => page.locator(`#urbanQuarterStage [data-footprint="${key}"]`);
const saved = () => page.evaluate(() => JSON.parse(new URL(location.href).searchParams.get('urban')));
async function ready(after = 0) {
  await page.waitForFunction(after => window.urbanReplies > after && window.urbanLayouts && window.urbanPartitions
    && document.querySelector('#urbanQuarterStage [data-apply]').getAttribute('aria-busy') === 'false'
    && document.querySelector('#urbanParcelStage [data-apply]').getAttribute('aria-busy') === 'false', after, { timeout: 120000 });
}
async function changed(action) {
  const before = await page.evaluate(() => window.urbanReplies);
  await action(); await ready(before);
}
const output = 'out/terrain-urban-controls'; mkdirSync(output, { recursive: true });
try {
  await page.goto(target.href); await ready();
  assert(await config('composition').isVisible());
  assert.match(await page.locator('[data-mode-hint]').textContent(), /Secteur isolé.*Préréglage imposé/s);
  await page.locator('#urbanFocus').click();
  await page.screenshot({ path: `${output}/before.png` });
  const beforeGeometry = await page.evaluate(() => JSON.stringify(window.urbanLayouts));
  const terrainReplies = await page.evaluate(() => window.terrainReplies);
  await config('culture').evaluate(e => e.closest('details').open = true);
  await changed(() => config('culture').selectOption('ottoman'));
  assert.equal((await saved()).layoutConfig.preset, 'culture');
  assert.equal((await saved()).layoutConfig.recipe, 'auto');
  await changed(async () => {
    await config('culture').selectOption('european-organic');
    await config('composition').selectOption('settlement');
    await footprint('mechanism').selectOption('auto');
    await footprint('budget').evaluate(e => e.closest('details').open = true);
    await footprint('budget').selectOption('population');
    await config('tissue').selectOption('organic');
  });
  const organic = await saved();
  assert.equal(organic.layoutConfig.placement, 'center');
  assert.equal(organic.layoutConfig.tissue, 'organic');
  assert.equal(organic.layoutConfig.culture, 'european-organic');
  assert.notEqual(await page.evaluate(() => JSON.stringify(window.urbanLayouts)), beforeGeometry);
  assert.notEqual(await page.evaluate(() => window.urbanLayouts[0].structure.family), 'rectangle');
  assert.equal(await page.evaluate(() => window.terrainReplies), terrainReplies, 'Urban menus must preserve terrain and hydrology');
  await page.locator('#urbanFocus').click(); await page.screenshot({ path: `${output}/organic.png` });
  const organicUrl = page.url(), escapedUrl = organicUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  writeFileSync(`${output}/organic-url.txt`, organicUrl);
  writeFileSync(`${output}/organic.html`, `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Terrain Bench · ville organique</title><meta http-equiv="refresh" content="0;url=${escapedUrl}"><a href="${escapedUrl}">Ouvrir la ville organique</a></html>`);

  await page.locator('#auto').uncheck();
  const requests = await page.evaluate(() => window.urbanRequests.length);
  await config('tissue').selectOption('grid');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.urbanRequests.length), requests);
  assert.equal((await saved()).layoutConfig.tissue, 'organic');
  assert(await page.locator('#urbanQuarterStage [data-draft-state]').isVisible());
  await changed(() => page.locator('#urbanQuarterStage [data-apply]').click());
  assert.equal((await saved()).layoutConfig.tissue, 'grid');
  const quarterRequests = await page.evaluate(() => window.urbanRequests.filter(k => k === 'quarters').length);
  const parcelReplies = await page.evaluate(() => window.parcelReplies);
  await page.locator('#urbanParcelStage [data-config="operator"]').selectOption('wholeBlock');
  await page.locator('#urbanParcelStage [data-apply]').click();
  await page.waitForFunction(before => window.parcelReplies > before && document.querySelector('#urbanParcelStage [data-apply]').getAttribute('aria-busy') === 'false', parcelReplies);
  await page.waitForFunction(() => JSON.parse(new URL(location.href).searchParams.get('urban')).parcelConfig.operator === 'wholeBlock');
  assert.equal(await page.evaluate(() => window.urbanRequests.filter(k => k === 'quarters').length), quarterRequests);
  assert.equal((await saved()).parcelConfig.operator, 'wholeBlock');
  await config('tissue').selectOption('organic');
  const json = page.locator('#urbanParcelStage [data-json]');
  await json.evaluate(e => { e.closest('details').open = true; }); await json.fill('{"invalidField":1}');
  await page.locator('#generate').click();
  assert.match(await page.locator('#status').textContent(), /Paramètre inconnu/);
  await page.locator('#showContours').uncheck();
  assert.equal((await saved()).layoutConfig.tissue, 'grid', 'An invalid parcel draft must not partly commit the urban changes');
  await json.fill('{}');
  await changed(() => page.locator('#generate').click());
  assert.equal((await saved()).layoutConfig.tissue, 'organic', 'General generation must apply urban drafts');
  const geometry = await page.evaluate(() => JSON.stringify({ layouts: window.urbanLayouts, partitions: window.urbanPartitions }));
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => JSON.stringify({ layouts: window.urbanLayouts, partitions: window.urbanPartitions })), geometry);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ autoMenus: true, manualDrafts: true, culturePresetReset: true, organicFootprint: true, terrainPreserved: true, parcelStageIsolation: true, generalGeneration: true, exactReplay: true, errors }));
} catch (error) {
  console.error(await page.locator('#status, [data-status], [data-draft-state]').allTextContents()); throw error;
} finally { await browser.close(); }
