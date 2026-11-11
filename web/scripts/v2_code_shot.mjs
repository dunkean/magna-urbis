// Shoot a V2 map from a MU3 city code (headless Chrome, RTX 5090, ANGLE Vulkan, native :8791 engine).
//   node scripts/v2_code_shot.mjs --code "MU3.…" --out out/<dir> [--port 5173] [--zooms 0,4,8] [--style satellite|parchment]
// Waits for the V2 to be idle, then saves one screenshot per wheel-zoom level centred on the map.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const code = arg('code'); const out = arg('out', 'out/v2-code-shot'); const port = arg('port', '5173');
const zooms = arg('zooms', '0,4,8').split(',').map(Number); const style = arg('style', '');
if (!code) { console.error('usage: --code "MU3.…" --out <dir>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, env: { ...process.env, VK_LOADER_DEVICE_ID_FILTER: '0x2b85' },
    args: ['--use-angle=vulkan', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  const params = new URLSearchParams({ city: code });
  // profile=local runs the chain on the native :8791 engine instead of WASM.
  await page.goto(`http://127.0.0.1:${port}/v2.html?test=1&quality=full&profile=local#${params}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const settle = async (delay = 3000) => {
    await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false', null, { timeout: 600000 });
    await page.waitForTimeout(delay);
  };
  await settle(6000);
  // A shared code only loads the recipe; run the whole chain (relief, settlements, cities).
  await page.getByRole('button', { name: 'Whole chain' }).click();
  await page.waitForTimeout(3000);
  await settle(6000);
  if (style) { await page.locator('#map-style').selectOption(style).catch(e => logs.push(`style: ${e.message}`)); await settle(); }
  await page.screenshot({ path: path.join(out, 'loaded.png') });
  const box = await page.locator('#map-canvas').boundingBox() ?? { x: 0, y: 0, width: 1600, height: 1000 };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let at = 0;
  for (const zoom of zooms) {
    while (at < zoom) { await page.mouse.wheel(0, -240); await page.waitForTimeout(200); at++; }
    await settle();
    await page.evaluate(() => window.__v2Test?.prepareCapture?.());
    const file = path.join(out, `zoom-${zoom}.png`);
    await page.screenshot({ path: file, timeout: 200000 });
    console.log('SHOT', file);
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
} finally {
  await browser?.close();
}
