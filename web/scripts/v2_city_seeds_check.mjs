/** Exercise city draws through the real UI and exported projects. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const web = fileURLToPath(new URL('..', import.meta.url));
const moduleBase = `/@fs/${resolve(web, 'src/v2').replace(/\\/g, '/')}`;
const out = resolve(web, 'out/v2-city-seeds');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terrainHash = world => hash({ ...world.terrain, rivers: world.terrain.rivers.map(({ name, ...river }) => river) });
process.env.CI = 'true';
const server = await createServer({ configFile: resolve(web, 'vite.v2.config.ts'), server: { host: '127.0.0.1', port: 5197, strictPort: false, hmr: false }, clearScreen: false });
let browser;
try {
  await mkdir(out, { recursive: true }); await server.listen();
  browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().startsWith('City seeds QA:')) console.log(message.text()); });
  await page.goto(`${server.resolvedUrls.local[0]}v2.html?empty&lang=fr`, { waitUntil: 'networkidle' });
  await page.locator('[data-stage-variation="city-roads"]').waitFor({ state: 'attached' });
  const reliefProof = await page.evaluate(async moduleBase => {
    const wasm = await import(`${moduleBase.replace('/web/src/v2', '/rust/bridge')}/wasmRuntime.ts`);
    await wasm.loadSingleWasm();
    const { generateCpuTerrain, releaseCpuCheckpoints } = await import(`${moduleBase.replace('/web/src/v2', '/rust/bridge')}/terrainCpuPipeline.ts`);
    const { rerollSeed } = await import(`${moduleBase.replace('/web/src/v2', '/rust/bridge')}/generationSeed.ts`);
    const base = { seed: 'relief-step-proof', width: 2400, motifSize: 2400, relief: 'hills', erosion: .3, mountainMix: .5, resolution: 64,
      procedural: { preset: 'classic', regionalN: 64, surfaceN: 64, erosionTuning: { iterations: 1, surfaceIterations: 0 } } };
    const digest = values => { let hash = 2166136261; for (const value of new Uint32Array(values.buffer, values.byteOffset, values.length)) hash = Math.imul(hash ^ value, 16777619); return hash >>> 0; };
    const capture = async settings => {
      const stages = {}, cached = [];
      await generateCpuTerrain(settings, { before: async () => {}, after: async (stage, height) => { if (height) stages[stage] = digest(height); },
        cached: async (stage, height) => { cached.push(stage); if (height) stages[stage] = digest(height); } });
      return { stages, cached };
    };
    const original = await capture(base), changedSettings = { ...base, generalSeed: rerollSeed(base.seed, ['relief-detail']) };
    const changed = await capture(changedSettings); releaseCpuCheckpoints(); const replay = await capture(changedSettings); releaseCpuCheckpoints();
    if (original.stages.amplitude !== changed.stages.amplitude || !changed.cached.includes('amplitude')) throw new Error('Relief upstream checkpoint changed.');
    if (original.stages.ridged === changed.stages.ridged || changed.stages.ridged !== replay.stages.ridged) throw new Error('Relief stage variation did not replay.');
    return { retainedPrefix: true, lateVariation: true, seedReplay: true };
  }, moduleBase);
  // Produce a compact real project as an import fixture, without private application hooks.
  const fixture = await page.evaluate(async moduleBase => {
    console.log('City seeds QA: loading fixture modules');
    const { defaultSettings } = await import(`${moduleBase}/settings.ts`);
    const { generateTerrain, planRegion, generateTown } = await import(`${moduleBase}/engine.ts`);
    const { serializeProject } = await import(`${moduleBase}/project.ts`);
    const { renameMap } = await import(`${moduleBase}/mapNaming.ts`);
    const { TerrainCache } = await import(`${moduleBase}/cache.ts`);
    console.log('City seeds QA: generating fixture');
    const settings = defaultSettings();
    settings.generation = 'procedural'; settings.runtime = { backend: 'typescript', compute: 'cpu', source: 'procedural' };
    settings.extent = 1200; settings.settlementCount = 1;
    settings.urban = { backend: 'rust', through: 'parcels', local: { main: { layout: { density: 1.2 } } } };
    Object.assign(settings.options, { population: 1800, size: 'town', coast: 'none', river: 'none', relief: 'flat', walls: 'none', castle: 'no',
      importedHeight: { w: 8, h: 8, rgba: new Uint8Array(0), elevations: new Float32Array(64).fill(20) } });
    const cache = new TerrainCache({ get: async () => undefined, put: async () => {}, clear: async () => {} });
    const terrain = await generateTerrain(settings, undefined, cache); console.log('City seeds QA: terrain ready');
    const region = await planRegion(terrain, settings); console.log('City seeds QA: region ready');
    const world = await generateTown(region, settings, 'main'); console.log('City seeds QA: city ready');
    world.settlements.push({ ...structuredClone(world.settlements[0]), key: 'neighbour', main: false, name: 'Neighbour', center: { x: 300, y: 300 }, urban: structuredClone(world.urban) });
    return serializeProject(settings, renameMap(world, settings));
  }, moduleBase);
  console.log('City seeds QA: importing project');
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles({ name: 'city-seeds.json', mimeType: 'application/json', buffer: Buffer.from(fixture) });
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.locator('[data-town="main"]').waitFor({ state: 'attached' });
  const reveal = async selector => {
    const stage = await page.locator(selector).evaluate(element => element.closest('.stage-row')?.dataset.stage);
    if (stage && await page.locator(`#body-${stage}`).isHidden()) await page.locator(`#row-${stage} .stage-title`).click();
    await page.locator(selector).evaluate(element => { for (let p = element.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true; });
  };
  const project = async name => {
    await page.locator('#export-open').click(); await page.locator('#export-format').selectOption('project');
    const pending = page.waitForEvent('download'); await page.locator('#export-go').click();
    const path = resolve(out, `${name}.json`); await (await pending).saveAs(path);
    await page.locator('#export-dialog').waitFor({ state: 'hidden' }); return JSON.parse(await readFile(path, 'utf8'));
  };
  const job = async selector => {
    const before = await page.locator('#job-log').textContent(); await reveal(selector); await page.locator(selector).click();
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
    const log = (await page.locator('#job-log').textContent()).slice(before.length); assert(!log.includes('Échec :'), log);
  };
  await page.locator('#family-tab-cities').click();
  await page.locator('#cities-select-none').click();
  assert(await page.locator('[data-stage-variation="city-roads"]').isDisabled());
  await page.locator('[data-city-select="main"]').check();
  const density = '#urban-global-layout-density'; await reveal(density);
  assert.equal(await page.locator(density).inputValue(), '1.2');
  await page.locator('#cities-select-all').click();
  assert.equal(await page.locator(density).inputValue(), '');
  assert.equal(await page.locator(density).getAttribute('placeholder'), 'Valeurs différentes');
  await page.locator(density).fill('1.4'); await page.locator(density).blur();
  const changedSelection = await project('selection-values');
  assert.equal(changedSelection.settings.urban.local.main.layout.density, 1.4);
  assert.equal(changedSelection.settings.urban.local.neighbour.layout.density, 1.4);
  await page.locator('[data-city-select="neighbour"]').uncheck();
  await page.locator(density).fill('1.2'); await page.locator(density).blur();
  await page.locator('#cities-select-none').click(); await page.locator('[data-city-select="neighbour"]').check();
  await page.locator(density).fill('1'); await page.locator(density).blur();
  await page.locator('#cities-select-none').click(); await page.locator('[data-city-select="main"]').check();
  const before = await project('before');
  const beforeNative = before.world.debug.v2RustCities.main;
  assert.equal(await page.locator('.urban-inherited-value').count(), 0);
  await reveal('#urban-global-layout-density');
  assert.equal(await page.locator('#urban-global-layout-density').inputValue(), '1.2');
  console.log('City seeds QA: retrying selection');
  await job('[data-stage-variation="city-roads"]');
  const after = await project('after');
  const afterNative = after.world.debug.v2RustCities.main;
  const recipe = JSON.parse(Buffer.from(after.settings.options.seed.slice(4), 'base64url').toString('utf8'));
  assert.equal(recipe.v['city/main/streets'], 1);
  assert.equal(await page.locator('#seed').inputValue(), after.settings.options.seed);
  assert.deepEqual(after.settings.urban, before.settings.urban);
  assert.equal(after.settings.urban.local.main.seed, before.settings.urban.local.main.seed);
  assert.equal(afterNative.stage, beforeNative.stage);
  assert.equal(hash(afterNative.compositionLayouts), hash(beforeNative.compositionLayouts));
  assert.equal(hash(afterNative.layouts[0].quarters), hash(beforeNative.layouts[0].quarters));
  assert.equal(hash(afterNative.layouts[0].enclosures), hash(beforeNative.layouts[0].enclosures));
  assert.notEqual(hash(afterNative.layouts[0].streets), hash(beforeNative.layouts[0].streets));
  assert.equal(terrainHash(after.world), terrainHash(before.world));
  assert.equal(hash(after.world.roads), hash(before.world.roads));
  assert.equal(hash(after.world.settlements.find(p => p.key === 'neighbour')), hash(before.world.settlements.find(p => p.key === 'neighbour')));
  assert.deepEqual(after.world.settlements.map(({ key, center, radius }) => ({ key, center, radius })), before.world.settlements.map(({ key, center, radius }) => ({ key, center, radius })));
  // Restore the complete variation recipe through the sole general seed field.
  const chooseSeed = async seed => {
    await page.locator('#family-tab-region').click(); await reveal('#seed');
    await page.locator('#seed').fill(seed); await page.locator('#seed').dispatchEvent('change');
    await page.locator('#family-tab-cities').click();
  };
  await chooseSeed(before.settings.options.seed);
  await page.locator('[data-town="main"]').click();
  await job('#build-town');
  const restored = await project('restored'); assert.equal(hash(restored.world.debug.v2RustCities.main.layouts), hash(beforeNative.layouts));
  await chooseSeed(after.settings.options.seed); await page.locator('[data-town="main"]').click(); await job('#build-town');
  const replay = await project('replay'); assert.equal(hash(replay.world.debug.v2RustCities.main.layouts), hash(afterNative.layouts));
  await job('[data-stage-variation="city-parcels"]');
  const individual = await project('individual');
  const individualRecipe = JSON.parse(Buffer.from(individual.settings.options.seed.slice(4), 'base64url').toString('utf8'));
  assert.equal(individualRecipe.v['city/main/parcels'], 1);
  assert.equal(hash(individual.world.debug.v2RustCities.main.layouts), hash(afterNative.layouts));
  assert.equal(hash(individual.world.roads), hash(before.world.roads));
  assert.equal(terrainHash(individual.world), terrainHash(before.world));
  assert.equal(hash(individual.world.settlements.find(p => p.key === 'neighbour')), hash(before.world.settlements.find(p => p.key === 'neighbour')));
  await page.screenshot({ path: resolve(out, 'city-seeds.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { reliefProof, generalSeedRecordsVariations: true, internalStreetsReroll: true, parcelStepReroll: true, compositionRetained: true, currentValuesDisplayed: true, seedReplay: true, terrainRetained: true, regionalRoadsRetained: true, neighboursRetained: true, errors };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(report);
} finally { await browser?.close(); await server.close(); }
