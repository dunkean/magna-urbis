/** Regional UI, portable overrides, population contrast and real native placement. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = 'out/regional-population';
await mkdir(out, { recursive: true });
const moduleUrl = file => '/@fs/' + fileURLToPath(new URL(`../src/v2/${file}`, import.meta.url)).replaceAll('\\', '/');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true });
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const codeUrl = moduleUrl('cityCode.ts'),
  populationUrl = moduleUrl('regionalPopulation.ts');
async function recipe() {
  return page.evaluate(async url => {
    const { decodeCityCode } = await import(url);
    return decodeCityCode(await window.__v2Test.code()).settings;
  }, codeUrl);
}
async function apply(settings) {
  await page.locator('#expert-open').click();
  await page.locator('#expert-json').fill(JSON.stringify(settings));
  await page.locator('#expert-apply').click();
  await page.locator('#expert-dialog').waitFor({ state: 'hidden' });
}
try {
  await page.goto(`${process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5174'}/v2.html?empty&test=1&lang=en`);
  await page.locator('#boot-splash').waitFor({ state: 'hidden' });
  await page.locator('#family-tab-settlements').click();
  assert(Number(await page.locator('#region-population').inputValue()) > 0);
  assert(Number(await page.locator('#region-isolatedCount').inputValue()) > 0, 'a normal inhabited region defaults to isolated sites');
  assert.equal(await page.locator('.settlement-class-icon').count(), 6);
  const cards = await page.locator('.regional-count-card').evaluateAll(elements =>
    elements.map(element => {
      const r = element.getBoundingClientRect(),
        icon = element.querySelector('.settlement-class-icon');
      return { x: Math.round(r.x), y: Math.round(r.y), icon: icon.getBoundingClientRect().width, background: getComputedStyle(icon).backgroundImage };
    }),
  );
  assert.equal(new Set(cards.map(card => card.x)).size, 3, 'three compact columns');
  assert.equal(new Set(cards.map(card => card.y)).size, 2, 'two compact rows');
  assert(
    cards.every(card => card.icon >= 60),
    'large readable illustrations',
  );
  await page.evaluate(async background => {
    const image = new Image();
    image.src = background.slice(5, -2);
    await image.decode();
    if (image.naturalWidth < 1000) throw new Error('Missing GPT Image atlas');
  }, cards[0].background);
  assert.equal(await page.locator('[data-option=population]').count(), 0, 'no mandatory main-population control');
  await page.screenshot({ path: `${out}/default.png` });
  const initial = await recipe();
  const initialCodeLength = (await page.evaluate(() => window.__v2Test.code())).length;
  const countIds = ['city', 'town', 'village', 'hamlet', 'farmstead'];
  const countsBefore = Object.fromEntries(await Promise.all(countIds.map(async id => [id, Number(await page.locator(`#region-${id}`).inputValue())])));
  let populationBefore = Number(await page.locator('#region-population').inputValue());
  for (const increment of [1, 2]) {
    await page.locator('#region-town').fill(String(countsBefore.town + increment));
    await page.locator('#region-town').dispatchEvent('change');
    for (const id of countIds) assert.equal(Number(await page.locator(`#region-${id}`).inputValue()), countsBefore[id] + (id === 'town' ? increment : 0), `editing towns keeps ${id} independent`);
    const population = Number(await page.locator('#region-population').inputValue());
    assert(population > populationBefore, 'adding a town adds its inhabitants');
    populationBefore = population;
  }
  await page.locator('[data-regional-list=environment]').click();
  // Places first, then a typed population that resizes them without changing their number.
  await page.locator('#region-town').fill('2');
  await page.locator('#region-town').dispatchEvent('change');
  await page.locator('#region-population').fill('10000');
  await page.locator('#region-population').dispatchEvent('change');
  assert.equal(await page.locator('#region-town').inputValue(), '2', 'a typed population keeps the places');
  await page.locator('#region-isolatedDensity').fill('0.5');
  await page.locator('#region-isolatedDensity').dispatchEvent('change');
  const manual = await recipe();
  assert.equal(manual.region.demography.population, 10000);
  assert.equal(manual.region.demography.counts.town, 2);
  assert.equal(manual.region.demography.isolatedDensity, 0.5);
  const changed = structuredClone(manual);
  changed.terrain.relief = 'mountains';
  await apply(changed);
  assert.equal(await page.locator('#region-population').inputValue(), '10000');
  assert.equal(await page.locator('#region-town').inputValue(), '2');
  await page.locator('[data-regional-list=environment]').click();
  assert.notEqual(await page.locator('#region-population').inputValue(), '10000');
  const scenarios = [];
  for (const [culture, climate, relief] of [
    ['european-organic', 'temperate', 'flat'],
    ['american-grid', 'temperate', 'flat'],
    ['inuit-camp', 'arctic', 'high-mountains'],
  ]) {
    const settings = structuredClone(initial);
    settings.extent = 40000;
    settings.options.seed = '42';
    settings.options.culture = culture;
    settings.terrain.climate = climate;
    settings.terrain.relief = relief;
    settings.region = { demography: { followCulture: false }, autoBuildPopulation: 0 };
    await apply(settings);
    const summary = await page.evaluate(
      async ({ url, codeUrl }) => {
        const { regionalPopulation } = await import(url);
        const { decodeCityCode } = await import(codeUrl);
        const p = regionalPopulation(decodeCityCode(await window.__v2Test.code()).settings);
        return { population: p.population, allocated: p.allocatedPopulation, largest: Math.max(0, ...p.places.map(x => x.population)), isolated: p.isolatedCount, counts: p.counts, code: (await window.__v2Test.code()).length };
      },
      { url: populationUrl, codeUrl },
    );
    assert.equal(Number(await page.locator('#region-population').inputValue()), summary.population);
    assert.equal(summary.allocated, summary.population);
    assert(summary.code < initialCodeLength + 250, 'automatic places do not expand MU3');
    assert.equal((await recipe()).region?.placement?.list, undefined);
    scenarios.push({ culture, ...summary });
    await page.screenshot({ path: `${out}/${culture}.png` });
  }
  assert(scenarios[0].population > 50000);
  assert(scenarios[0].isolated > 0);
  assert(scenarios[1].largest > 500000);
  assert(scenarios[2].population < scenarios[0].population / 50, 'harsh map keeps the floor, far below temperate');
  // Import a retained small scene to check the local reroll entry point.
  execFileSync(process.execPath, ['--import', './scripts/shaderModuleStubs.mjs', '--import', 'tsx', 'scripts/v2_workbench_layout_fixture.ts'], { windowsHide: true });
  await page.locator('#import-open').click();
  await page.locator('#project-file').setInputFiles('out/workbench-layout/fixture.json');
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  await page.locator('#family-tab-cities').click();
  await page.locator('[data-town=main]').click();
  assert(await page.locator('#reroll-town').isVisible());
  assert(await page.locator('.settlement-rebuild-actions #build-town').isVisible());
  assert.equal(await page.locator('#local-urban-controls [data-field-path=architecture]').count(), 0);
  await page.screenshot({ path: `${out}/reroll.png` });
  const edited = await recipe();
  edited.local.main = { culture: 'medina', population: 1900 };
  edited.urban = { local: { main: { layout: { culture: 'medina' } } } };
  edited.region ??= {};
  edited.region.demography = { followCulture: false };
  await apply(edited);
  await page.locator('#family-tab-settlements').click();
  await page.locator('[data-option=culture]').selectOption('roman-core');
  const parentChanged = await recipe();
  assert.deepEqual(parentChanged.local, {});
  assert.equal(parentChanged.urban?.local, undefined);
  assert.equal(await page.evaluate(() => window.__v2Test.world().settlements.every(s => s.culture === 'roman-core')), true);
  let native;
  if (process.env.MAGNA_SKIP_NATIVE_POPULATION !== '1') {
    const fixture = JSON.parse(await readFile('out/workbench-layout/fixture.json', 'utf8'));
    native = await page.evaluate(
      async ({ fixture, engineUrl, projectUrl, populationUrl }) => {
        const { parseProject } = await import(projectUrl),
          { planRegion, terrainCacheKey } = await import(engineUrl),
          { regionalPopulation } = await import(populationUrl);
        const { settings, world } = parseProject(JSON.stringify(fixture));
        settings.extent = 6000;
        settings.options.seed = '42';
        settings.options.culture = 'european-organic';
        settings.terrain.climate = 'temperate';
        settings.terrain.relief = 'flat';
        settings.runtime = { backend: 'native', source: 'procedural', compute: 'cpu', localServer: 'http://127.0.0.1:8791' };
        settings.region = { autoBuildPopulation: 0, resolution: 64, demography: { population: 1800, counts: { city: 0, town: 0, village: 2, hamlet: 0, farmstead: 0 }, isolatedCount: 6, followCulture: false } };
        world.mapSize = 6000;
        world.seed = settings.options.seed;
        world.options = settings.options;
        world.stats = { 'v2.terrainKey': terrainCacheKey(settings) };
        for (const grid of [world.terrain.height, world.terrain.slope, world.terrain.flow]) grid.cell = 6000 / grid.w;
        world.terrain.rivers = [
          {
            id: 1,
            path: [
              { x: 3000, y: 200 },
              { x: 3000, y: 5800 },
            ],
            width: [12, 12],
          },
        ];
        world.roads = [];
        delete world.urban;
        delete world.settlements;
        delete world.debug;
        const result = await planRegion(world, settings),
          request = regionalPopulation(settings);
        return { requested: request.population, placed: result.settlements.length, population: result.settlements.reduce((n, p) => n + p.population, 0), isolated: result.debug.v2RustRegion.placement.activities.length, warnings: result.stats['settlements.warning'] };
      },
      { fixture, engineUrl: moduleUrl('engine.ts'), projectUrl: moduleUrl('project.ts'), populationUrl },
    );
    assert.equal(native.placed, 2);
    assert.equal(native.population, native.requested);
    assert(native.isolated > 0, 'native resources produce genuine isolated sites');
    assert(native.isolated <= 6);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ scenarios, native, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, scenarios, native }));
} catch (e) {
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error(errors);
  throw e;
} finally {
  await browser.close();
}
