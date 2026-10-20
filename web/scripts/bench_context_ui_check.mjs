import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// From web/: node scripts/bench_context_ui_check.mjs [shared bench origin]
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const bench = name => page.frameLocator(`iframe[data-bench=${name}]`);
const tab = name => page.locator(`nav [data-bench=${name}]`);
const child = name => page.locator(`iframe[data-bench=${name}]`).elementHandle().then(el => el.contentFrame());
async function active(name) {
  await page.waitForFunction(name => document.querySelector(`nav [data-bench=${name}]`)?.hasAttribute('aria-current'), name);
  await bench(name).locator('body').waitFor();
}
async function camera(name, expected) {
  await page.waitForFunction(({ name, expected }) => {
    const query = document.querySelector(`iframe[data-bench=${name}]`)?.contentDocument?.querySelector('#map')?.getAttribute('viewBox');
    if (!query) return false;
    const [x, y, w, h] = query.split(' ').map(Number);
    return w > 0 && h > 0 && Math.abs(x + w / 2 - expected[0]) < .001 && Math.abs(y + h / 2 - expected[1]) < .001;
  }, { name, expected });
}
try {
  const params = new URLSearchParams({ seed: 'bench-context', relief: 'flat', width: '3000', compute: 'wasm', generation: 'cpu',
    hydro_enabled: '0', auto: '0', refine: '0',
    settlements: JSON.stringify({ config: { mode: 'counts', main: { population: 300 }, counts: { village: 1, hamlet: 1, farmstead: 0 } } }),
    roads: JSON.stringify({ enabled: false }), urban: JSON.stringify({ enabled: false, parcelEnabled: false }) });
  await page.goto(`${base}/rustbench.html#terrain?${params}`);
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=terrain]')?.contentDocument?.querySelector('#status')?.textContent.includes('overview'), null, { timeout: 90000 });
  const terrain = await child('terrain');
  await terrain.evaluate(() => { window.__contextMarker = 'terrain-kept'; window.__setView(1234, 1654, 1); });
  await bench('terrain').locator('#seed').fill('pending-terrain-draft');
  await bench('terrain').locator('#transferExtent').selectOption('crop');
  await bench('terrain').locator('#transferWidth').fill('2000');
  await bench('terrain').locator('details.stage').filter({ has: bench('terrain').locator('#coastControl') }).locator(':scope > summary').click();
  await bench('terrain').locator('#coastControl [data-coast]').first().click();
  await bench('terrain').locator('#editTerrain').click();
  await bench('terrain').locator('#terrainSketchEditor [data-id=fill]').click();
  await bench('terrain').locator('#terrainSketchEditor [data-id=edit]').click();
  const painted = await terrain.evaluate(() => window.magnaBenchContext.capture().editor);
  await bench('terrain').locator('#pipelineNext').click();
  await active('settlements');
  const cropWidth = await bench('terrain').locator('#transferWidth').inputValue();
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=settlements]')?.contentDocument?.querySelectorAll('#setList button').length >= 2, null, { timeout: 90000 });
  const settlements = await child('settlements');
  const artifact = new URL(settlements.url()).searchParams.get('artifact');
  assert.ok(artifact);
  await settlements.evaluate(() => { window.__contextMarker = 'settlements-kept'; });
  await bench('settlements').locator('#setList button').nth(1).click();
  const selected = await bench('settlements').locator('#urbanTarget').inputValue();
  assert.ok(selected);
  await bench('settlements').locator('#pipelineSave').click();
  await bench('settlements').locator('#pipelineStatus').filter({ hasText: 'Export conservé' }).waitFor();
  const urbanInput = await settlements.evaluate(async () => (await (await import('/benchHistory.ts')).listHistory())[0].entry.id);

  await tab('terrain').click(); await active('terrain'); await camera('terrain', [1234, 1654]);
  assert.equal(await terrain.evaluate(() => window.__contextMarker), 'terrain-kept');
  assert.equal(await bench('terrain').locator('#seed').inputValue(), 'pending-terrain-draft');
  assert.equal(await bench('terrain').locator('#transferExtent').inputValue(), 'crop');
  assert.ok(page.url().includes('seed=bench-context'));
  assert.ok(!page.url().includes('pending-terrain-draft'));

  // The preceding Terrain history entry has an older camera. Back must resume
  // the live page, preserving both its latest camera and its unapplied draft.
  await terrain.evaluate(() => window.__setView(1123, 1456, 1.2));
  await page.goBack(); await active('settlements');
  assert.equal(await settlements.evaluate(() => window.__contextMarker), 'settlements-kept');
  assert.equal(await bench('settlements').locator('#urbanTarget').inputValue(), selected);
  await page.goBack(); await active('terrain'); await camera('terrain', [1123, 1456]);
  assert.equal(await terrain.evaluate(() => window.__contextMarker), 'terrain-kept');
  assert.equal(await bench('terrain').locator('#seed').inputValue(), 'pending-terrain-draft');

  for (const name of ['urban', 'houses']) {
    if (name === 'urban') await page.evaluate(query => { location.hash = `urban?${query}`; }, new URLSearchParams({ artifact: urbanInput, decor: urbanInput, urban: JSON.stringify({ enabled: false, parcelEnabled: false }) }).toString());
    else await tab(name).click();
    await active(name);
    const field = name === 'urban' ? '#seedName' : '#seed';
    if (name === 'houses') await bench(name).locator('#copy-link:not([disabled])').waitFor({ timeout: 90000 });
    else await bench(name).locator('#report code').first().waitFor({ timeout: 90000 });
    await bench(name).locator(field).fill(`draft-${name}`);
    const frame = await child(name);
    await frame.evaluate(() => { window.__contextMarker = 'kept'; });
    await tab('terrain').click(); await active('terrain');
    await tab(name).click(); await active(name);
    assert.equal(await frame.evaluate(() => window.__contextMarker), 'kept');
    assert.equal(await bench(name).locator(field).inputValue(), `draft-${name}`);
  }

  // Reload restores the applied map, then restores drafts without applying them.
  await tab('terrain').click(); await active('terrain');
  await (await child('terrain')).evaluate(() => window.__setView(1199, 1499, 1.3));
  await page.reload(); await active('terrain');
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=terrain]')?.contentDocument?.querySelector('#seed')?.value === 'pending-terrain-draft', null, { timeout: 90000 });
  assert.equal(await bench('terrain').locator('#transferExtent').inputValue(), 'crop');
  assert.equal(await bench('terrain').locator('#transferWidth').inputValue(), cropWidth);
  assert.equal(await bench('terrain').locator('#coastControl [data-coast]').first().getAttribute('aria-pressed'), 'true');
  assert.ok(await bench('terrain').locator('#coastControl').isVisible());
  assert.ok(page.url().includes('seed=bench-context'));
  assert.ok(!page.url().includes('pending-terrain-draft'));
  assert.deepEqual(await (await child('terrain')).evaluate(() => window.magnaBenchContext.capture().editor), painted);
  await camera('terrain', [1199, 1499]);
  await tab('settlements').click(); await active('settlements');
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=settlements]')?.contentDocument?.querySelectorAll('#setList button').length >= 2, null, { timeout: 90000 });
  assert.equal(new URL((await child('settlements')).url()).searchParams.get('artifact'), artifact);
  assert.equal(await bench('settlements').locator('#urbanTarget').inputValue(), selected);
  await bench('settlements').locator(`#setList button[data-key="${selected}"][aria-pressed=true]`).waitFor();
  for (const name of ['urban', 'houses']) {
    await tab(name).click(); await active(name);
    const field = name === 'urban' ? '#seedName' : '#seed';
    await page.waitForFunction(({ name, field }) => document.querySelector(`iframe[data-bench=${name}]`)?.contentDocument?.querySelector(field)?.value === `draft-${name}`, { name, field }, { timeout: 90000 });
  }

  // A deliberate transfer still replaces the destination input.
  await tab('terrain').click(); await active('terrain');
  await page.waitForFunction(() => document.querySelector('iframe[data-bench=terrain]')?.contentDocument?.querySelector('#status')?.textContent.includes('overview'), null, { timeout: 90000 });
  await bench('terrain').locator('#pipelineNext').click(); await active('settlements');
  await page.waitForFunction(old => {
    const frame = document.querySelector('iframe[data-bench=settlements]');
    const id = frame?.contentWindow && new URL(frame.contentWindow.location.href).searchParams.get('artifact');
    return !!id && id !== old;
  }, artifact);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, tabs: 4, history: true, camera: true, drafts: true, selection: true, reloadContextsAndDrafts: true, newTransfer: true, errors }, null, 2));
} catch (error) {
  console.log('CONTEXT', await page.evaluate(() => {
    const doc = document.querySelector('iframe[data-bench=terrain]')?.contentDocument;
    const saved = JSON.parse(sessionStorage.getItem('magna-bench-context-v1-ui') ?? '{}').terrain;
    return { route: location.hash.slice(0, 100), state: history.state, active: document.querySelector('nav [aria-current]')?.dataset.bench,
      savedSeed: saved?.fields.find(field => field.selector === '#seed'), savedView: saved?.extra?.view,
      seed: doc?.querySelector('#seed')?.value, ready: doc?.defaultView.magnaBenchContext?.ready(), status: doc?.querySelector('#status')?.textContent };
  }));
  console.log('ERRORS', errors);
  throw error;
} finally { await browser.close(); }
