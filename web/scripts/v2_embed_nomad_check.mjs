/** Regression: a temple flag must not turn Karak Ordu's only residential block into open land. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.MAGNA_EMBED_CHECK_URL ?? 'http://127.0.0.1:5187/embed.html';
const url = new URL(base);
url.search = new URLSearchParams({
  preview: '1',
  demo: '1',
  name: 'Karak Ordu',
  population: '1250',
  seed: '3521165402',
  cultureBase: 'Mongolian',
  cultureType: 'Nomadic',
  biome: 'Grassland',
  temperature: '8',
  precipitation: '350',
  elevation: '900',
  coast: '0',
  sea: '1',
  river: '0',
  port: '0',
  walls: '0',
  citadel: '0',
  capital: '0',
  temple: '1',
  plaza: '0',
  shantytown: '0',
  hub: '1',
  farms: '0',
}).toString();
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 740 } });
  await context.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'result') return;
          const world = data.world;
          window.__nomadResult = {
            culture: world.options.culture,
            population: world.options.population,
            buildings: world.urban?.buildings?.length ?? 0,
            blocks: Object.values(world.debug?.v2RustCities ?? {}).flatMap(city => city.layouts.flatMap(layout => layout.blocks.map(block => block.kind))),
          };
        });
      }
    };
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url.href);
  await page.locator('html[data-state="ready"],html[data-state="error"]').waitFor({ timeout: 180000 });
  assert.equal(await page.locator('html').getAttribute('data-state'), 'ready', await page.locator('#status').textContent());
  const result = await page.evaluate(() => window.__nomadResult);
  assert.equal(result.culture, 'mongol-ordu');
  assert.equal(result.population, 1250);
  assert.ok(result.buildings > 0, `Expected dwellings, got ${result.buildings}; blocks: ${result.blocks}`);
  assert.ok(result.blocks.includes('block'), 'Keep residential land in the camp.');
  assert.deepEqual(errors, []);
  await mkdir('out/city-embed', { recursive: true });
  await page.screenshot({ path: 'out/city-embed/karak-ordu.png' });
  await writeFile('out/city-embed/karak-ordu.json', JSON.stringify({ url: url.href, ...result }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
