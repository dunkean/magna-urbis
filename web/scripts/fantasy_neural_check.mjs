import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
try {
  await page.goto(process.argv[2] || 'http://127.0.0.1:8780/?seed=42&mode=fantasy-color');
  await page.waitForFunction(()=>window.terrainDebug?.snapshot().world, null, {timeout:120000});
  await page.waitForFunction(()=>window.TerrainFantasy?.stats().stamps>0&&TerrainFantasy.stats().decoded===TerrainFantasy.stats().sheets,null,{timeout:180000});
  console.log(JSON.stringify(await page.evaluate(()=>({fantasy:TerrainFantasy.stats(),mode:terrainDebug.snapshot().mode,backend:terrainDebug.snapshot().backend}))));
  await page.locator('#viewport').screenshot({path:'out/fantasy/neural-color.png'});
  await page.locator('#layerPanel > summary').click();
  await page.locator('#layerPanel').getByRole('button',{name:'Fantasy · Ink',exact:true}).click();
  await page.waitForFunction(()=>terrainDebug.snapshot().mode==='fantasy-ink'&&TerrainFantasy.stats().mode==='fantasy-ink'&&TerrainFantasy.stats().stamps>0);
  await page.locator('#viewport').screenshot({path:'out/fantasy/neural-ink.png'});
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
