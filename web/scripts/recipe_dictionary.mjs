import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

// Developer tool: refreshing this dictionary intentionally invalidates old codes.
// Run against Vite after changing the default controls: node scripts/recipe_dictionary.mjs [origin]
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:5173').origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/terrainbench.html?seed=42&width=2400&relief=flat&compute=wasm&generation=cpu&hydro_enabled=0&auto=0&render=svg`);
  await page.waitForFunction(() => window.magnaRecipe && window.magnaBenchContext?.ready(), null, { timeout: 120000 });
  const params = await page.evaluate(async () => Object.fromEntries(new URLSearchParams((await window.magnaRecipe.capture()).query)));
  // Rendering/generation preferences in this sample have no bearing on the codec.
  Object.assign(params, { relief: 'hills', compute: 'gpu-f32', generation: 'gpu-erosion', hydro_enabled: '1', auto: '1', view: '1200,1200,0.25' });
  delete params.render;
  await writeFile(new URL('../src/ui/recipeDictionary.json', import.meta.url), JSON.stringify(params, null, 2) + '\n');
  console.log('Updated recipe compression dictionary.');
} finally { await browser.close(); }
