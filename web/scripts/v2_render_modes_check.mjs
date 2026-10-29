/** Real retained terrain/native houses: display parity without any generation job. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const base = (process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175').replace(/\/$/, '');
const production = process.argv.includes('--production');
const out = resolve(web, production ? 'out/v2-render-modes-production' : 'out/v2-render-modes');
const expectedStyles = ['parchment', 'atlas', 'watabou', 'engraving', 'cadastre', 'blueprint', 'illuminated', 'topographic', 'night',
  'render', 'render3d', 'render3d-brush', 'render-v2', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow', 'fantasy-ink', 'fantasy-color', 'copernicus'];
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const physical = project => ({ height: project.world.terrain.height, nativeHeight: project.world.terrain.v2NativeTerrain?.height,
  terrainKey: project.world.stats['v2.terrainKey'], city: project.world.debug?.v2RustCities });
const report = { mode: production ? 'production' : 'source', base, time: new Date().toISOString(), checks: {}, errors: [], missing: [] };
let browser, page;
await mkdir(out, { recursive: true });
try {
  const candidates = [process.env.MAGNA_RENDER_FIXTURE, resolve(web, 'out/v2-rust-browser/06-native-houses.json'), resolve(web, 'out/v2-rust-browser/08c-native-corrected.json')].filter(Boolean);
  let fixture;
  for (const candidate of candidates) if (await stat(candidate).then(s => s.isFile(), () => false)) { fixture = candidate; break; }
  assert(fixture, 'A retained V2 native city project is required; set MAGNA_RENDER_FIXTURE.');
  const source = JSON.parse(await readFile(fixture, 'utf8'));
  assert(source.world.terrain.v2NativeTerrain, 'Fixture lacks retained native terrain.');
  const nativeCities = Object.values(source.world.debug?.v2RustCities ?? {});
  const nativeBuildings = nativeCities.reduce((sum, city) => sum + (city.scene?.buildings.length ?? 0), 0);
  assert(nativeBuildings > 0, 'Fixture lacks retained native houses.');
  const originalPhysical = digest(physical(source));
  report.fixture = { file: fixture, nativeBuildings, fingerprint: originalPhysical };
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => {
    window.__renderQA = { jobs: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(value, ...rest) {
        if (value && ['terrain', 'region', 'roads', 'towns', 'town', 'all'].includes(value.action)) window.__renderQA.jobs.push({ action: value.action, at: performance.now() });
        return super.postMessage(value, ...rest);
      }
    };
  });
  page = await context.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !response.url().includes('favicon')) report.missing.push({ url: response.url(), status: response.status() }); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/v2.html?empty&lang=en`, { waitUntil: 'domcontentloaded' });
  await page.locator('#map-style').waitFor();
  await page.evaluate(() => {
    window.__renderQA.frames = [];
    const canvas = document.querySelector('#map-canvas');
    new MutationObserver(() => {
      window.__renderQA.frames.push({ at: performance.now(), selected: document.querySelector('#map-style').value,
        rendered: canvas.dataset.renderStyle, pending: !document.querySelector('#render-status').hidden });
      if (window.__renderQA.frames.length > 200) window.__renderQA.frames.shift();
    }).observe(canvas, { attributes: true, attributeFilter: ['data-render-style', 'data-city-render'] });
  });
  const reveal = async selector => page.locator(selector).evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  });
  const field = path => `#render-settings [data-setting-path="appearance.${path}"]`;
  const idle = async style => {
    // Form edits debounce for 120 ms. Wait beyond that boundary before reading
    // the real renderer's state, then allow its frame/asset invalidations to paint.
    await page.waitForTimeout(180);
    await page.waitForFunction(style => {
      const status = document.querySelector('#render-status'), canvas = document.querySelector('#map-canvas');
      return status?.hidden && (!style || canvas.dataset.renderStyle === style);
    }, style, { timeout: 120000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const toast = await page.locator('#toast').evaluate(element => ({ hidden: element.hidden, error: element.dataset.error, text: element.textContent }));
    assert(toast.hidden || toast.error !== 'true', toast.text);
  };
  const select = async (path, value) => { const selector = field(path); await reveal(selector); await page.locator(selector).selectOption(value); await idle(); };
  const check = async (path, value) => { const selector = field(path); await reveal(selector); await page.locator(selector).setChecked(value); await idle(); };
  const closeSettings = async () => page.locator('#render-settings').evaluate(element => { element.open = false; });
  const pixels = async () => digest(await page.locator('#map-canvas').evaluate(canvas => canvas.toDataURL('image/png')));
  const cityStats = async () => JSON.parse(await page.locator('#map-canvas').getAttribute('data-city-render') ?? '{}');
  const screenshot = async name => { await closeSettings(); await page.screenshot({ path: resolve(out, name), fullPage: false }); };
  const exportFile = async (format, filename, layers) => {
    await closeSettings(); await page.locator('#export-open').click(); await page.locator('#export-format').selectOption(format);
    if (format === 'png') { await page.locator('#export-crop').uncheck(); await page.locator('#export-resolution').selectOption('1600'); }
    if (layers) for (const name of ['background', 'terrain', 'water', 'landuse', 'city', 'streets', 'roads', 'labels', 'decor'])
      await page.locator(`[data-layer="${name}"]`).setChecked(layers.includes(name));
    const downloading = page.waitForEvent('download', { timeout: 180000 }); await page.locator('#export-go').click();
    const download = await downloading, path = resolve(out, filename); await download.saveAs(path);
    await page.locator('#export-dialog').waitFor({ state: 'hidden' }); return readFile(path);
  };
  await page.locator('#import-open').click(); await page.locator('#import-scope').selectOption('complete');
  await page.locator('#project-file').setInputFiles(fixture); await page.locator('#import-dialog').waitFor({ state: 'hidden', timeout: 180000 });
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  await idle();
  assert.equal((await cityStats()).buildings, nativeBuildings);
  assert.match(await page.locator('#map-canvas').getAttribute('data-renderer'), /CPU|CityBench/);
  const imported = JSON.parse(await exportFile('project', '01-imported.project.json'));
  assert.equal(digest(physical(imported)), originalPhysical, 'Project import changed retained physical data.');
  report.checks.import = { physicalRetained: true, renderer: await page.locator('#map-canvas').getAttribute('data-renderer'), stats: await cityStats() };
  const jobsBefore = await page.evaluate(() => window.__renderQA.jobs.length);

  const options = await page.locator('#map-style option').evaluateAll(elements => elements.map(element => element.value));
  assert.deepEqual([...options].sort(), [...expectedStyles].sort());
  report.checks.terrainStyles = [];
  for (const style of options) {
    await page.locator('#map-style').selectOption(style); await idle(style);
    const hash = await pixels(); report.checks.terrainStyles.push({ style, hash, selected: await page.locator('#map-style').inputValue(), renderer: await page.locator('#map-canvas').getAttribute('data-renderer') });
    console.log(`Terrain mode ${style}: ${hash.slice(0, 12)}`);
    if (['render-v2', 'parchment', 'fantasy-color', 'fantasy-ink'].includes(style)) await screenshot(`terrain-${style}.png`);
  }
  const terrainHashes = new Set(report.checks.terrainStyles.map(entry => entry.hash));
  assert(terrainHashes.size >= 14, `Only ${terrainHashes.size} distinct terrain images for ${options.length} modes.`);
  for (const entry of report.checks.terrainStyles.filter(entry => !['parchment', 'render3d-brush'].includes(entry.style)))
    assert.notEqual(entry.hash, report.checks.terrainStyles.find(other => other.style === 'parchment').hash, `${entry.style} silently displays parchment.`);
  report.checks.terrainDistinctImages = terrainHashes.size;

  await page.locator('#map-style').selectOption('render-v2'); await idle('render-v2');
  await page.locator('#tab-settlements').click(); await page.locator('[data-town="main"]').click();
  await page.locator('#inspector .close').click();
  for (let i = 0; i < 2; i++) await page.locator('#zoom-in').click();
  await idle('render-v2');
  await page.waitForFunction(() => JSON.parse(document.querySelector('#map-canvas').dataset.cityRender || '{}').visibleBuildings > 0);
  report.checks.cityViews = [];
  for (const view of ['tissue', 'uses', 'parcels', 'buildings', 'roles']) {
    await select('city.view', view);
    const stats = await cityStats(); report.checks.cityViews.push({ view, hash: await pixels(), stats });
    assert(stats.native && stats.layouts > 0); if (view === 'buildings' || view === 'roles') assert(stats.visibleBuildings > 0);
  }
  assert(new Set(report.checks.cityViews.map(entry => entry.hash)).size >= 4, 'City views do not redraw distinct content.');
  await select('city.view', 'buildings'); report.checks.cityPalettes = [];
  for (const palette of ['growth', 'atlas', 'ink', 'terrain', 'parchment']) {
    await select('city.palette', palette); report.checks.cityPalettes.push({ palette, hash: await pixels(), stats: await cityStats() });
    if (['ink', 'parchment'].includes(palette)) await screenshot(`city-${palette}.png`);
  }
  assert(new Set(report.checks.cityPalettes.map(entry => entry.hash)).size >= 3, 'City palettes are visually identical.');
  await select('city.palette', 'growth'); report.checks.buildingStyles = [];
  for (const style of ['geometric', 'cartographic', 'silhouette']) {
    await select('city.buildingStyle', style); const stats = await cityStats();
    assert(stats.visibleBuildings > 0); report.checks.buildingStyles.push({ style, hash: await pixels(), stats });
  }
  await select('city.buildingStyle', 'cartographic'); report.checks.buildingDiagnostics = [];
  for (const diagnostic of ['none', 'uses', 'height', 'access']) {
    await select('city.diagnostic', diagnostic); report.checks.buildingDiagnostics.push({ diagnostic, hash: await pixels(), stats: await cityStats() });
  }
  assert(new Set(report.checks.buildingDiagnostics.map(entry => entry.hash)).size >= 3, 'Native building diagnostics did not affect the map.');
  await select('city.diagnostic', 'none'); await check('city.painted', false); const noShadows = await pixels();
  await check('city.painted', true); const shadows = await pixels(); assert.notEqual(shadows, noShadows, 'Painted native shadows are absent.');
  await screenshot('native-houses-shadows.png');
  await check('textured', false); const noTextures = await pixels(); await check('textured', true);
  await page.waitForTimeout(800); const textures = await pixels(); assert.notEqual(textures, noTextures, 'Textures do not alter native city surfaces.');
  report.checks.shadowsAndTextures = { shadows, noShadows, textures, noTextures, stats: await cityStats() };
  await screenshot('native-houses-textured.png');
  const png = await exportFile('png', 'native-satellite.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 1600);
  report.checks.png = { bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const cityPng = await exportFile('png', 'native-city-without-streets.png', ['city']);
  const streetsPng = await exportFile('png', 'native-streets-without-city.png', ['streets']);
  const imageAlpha = async png => page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let drawn = 0;
    for (let index = 3; index < rgba.length; index += 4) if (rgba[index]) drawn++;
    return { drawn, pixels: canvas.width * canvas.height };
  }, png.toString('base64'));
  const cityAlpha = await imageAlpha(cityPng), streetsAlpha = await imageAlpha(streetsPng);
  assert.notEqual(digest(cityPng.toString('base64')), digest(streetsPng.toString('base64')));
  assert(cityAlpha.drawn > 1000 && cityAlpha.drawn < cityAlpha.pixels, JSON.stringify(cityAlpha));
  assert(streetsAlpha.drawn > 1000 && streetsAlpha.drawn < streetsAlpha.pixels, JSON.stringify(streetsAlpha));
  report.checks.independentExports = { cityWithoutStreets: cityAlpha, streetsWithoutCity: streetsAlpha };

  await page.locator('#language-select').selectOption('fr'); await page.setViewportSize({ width: 390, height: 844 }); await idle();
  await page.locator('#toast').waitFor({ state: 'hidden' });
  const mobileStyle = await page.locator('#map-style').evaluate(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    return { width: box.width, textWidth: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20,
      selected: element.selectedOptions[0]?.textContent ?? '', value: element.value };
  });
  assert(mobileStyle.textWidth > 90, `Mobile style selector has only ${mobileStyle.textWidth} px of usable text width.`);
  assert(mobileStyle.selected.trim().length > 3 && mobileStyle.value === 'render-v2');
  const mobileMinimap = await page.locator('#minimap').evaluate(canvas => {
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set(); let drawn = 0;
    for (let index = 0; index < rgba.length; index += 4) if (rgba[index + 3]) { drawn++; colors.add(`${rgba[index]},${rgba[index + 1]},${rgba[index + 2]}`); }
    return { width: canvas.width, height: canvas.height, drawn, colors: colors.size };
  });
  assert(mobileMinimap.drawn > 200 && mobileMinimap.colors > 8, `Mobile minimap was not repainted after resize: ${JSON.stringify(mobileMinimap)}`);
  report.checks.mobile = { width: 390, style: mobileStyle, minimap: mobileMinimap, language: 'fr' };
  await reveal(field('city.palette')); assert.match(await page.locator('#render-settings').innerText(), /Villes et bâtiments|Palette des villes/);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page overflows.');
  await page.screenshot({ path: resolve(out, 'mobile-render-settings-fr.png'), fullPage: true });
  await closeSettings(); await screenshot('mobile-native-fr.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const after = JSON.parse(await exportFile('project', '99-after-display.project.json'));
  assert.equal(digest(physical(after)), originalPhysical, 'Display changes changed retained terrain or native architecture.');
  const jobs = await page.evaluate(() => window.__renderQA.jobs);
  assert.equal(jobs.length, jobsBefore, JSON.stringify(jobs));
  report.checks.retention = { physicalRetained: true, generationJobsDuringDisplay: jobs.length - jobsBefore };
  assert.deepEqual(report.errors, [], 'Browser errors'); assert.deepEqual(report.missing, [], 'Missing assets');
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = error.stack; process.exitCode = 1;
  if (page) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {});
    report.renderState = await page.evaluate(() => {
      const canvas = document.querySelector('#map-canvas'), status = document.querySelector('#render-status');
      return { selected: document.querySelector('#map-style').value, dataset: { ...canvas.dataset },
        status: { hidden: status.hidden, text: status.textContent }, dimensions: [canvas.width, canvas.height, canvas.clientWidth, canvas.clientHeight],
        busy: document.querySelector('#app').getAttribute('aria-busy'), frames: window.__renderQA?.frames ?? [] };
    }).catch(() => undefined);
    report.body = (await page.locator('body').innerText().catch(() => '')).slice(-7000); report.log = await page.locator('#job-log').innerText().catch(() => ''); }
} finally {
  await browser?.close(); await writeFile(resolve(out, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, mode: report.mode, terrainModes: report.checks.terrainStyles?.length,
    distinctTerrainImages: report.checks.terrainDistinctImages, cityViews: report.checks.cityViews?.length,
    cityPalettes: report.checks.cityPalettes?.length, buildingStyles: report.checks.buildingStyles?.length,
    diagnostics: report.checks.buildingDiagnostics?.length, retention: report.checks.retention,
    independentExports: report.checks.independentExports, errors: report.errors, missing: report.missing,
    ...(report.error ? { error: report.error } : {}), report: resolve(out, 'results.json') }, null, 2));
}
