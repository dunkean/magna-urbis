/** Pixel diff of render-perf screenshots: node scripts/v2_render_shotdiff.mjs <dir> <labelA> <labelB> */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [dir, a, b] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
const page = await browser.newPage();
for (const style of ['parchment', 'render-v2', 'render3d', 'fantasy-color']) {
  const [x, y] = await Promise.all([a, b].map(async label => (await readFile(resolve(dir, `${label}-${style}.png`))).toString('base64')));
  const r = await page.evaluate(async ([x, y]) => {
    const load = async s => { const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob()); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height); };
    const p = await load(x), q = await load(y);
    if (p.width !== q.width || p.height !== q.height) return { size: [p.width, p.height, q.width, q.height] };
    let diff = 0, big = 0, sum = 0;
    for (let i = 0; i < p.data.length; i += 4) { const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2])); if (d) diff++; if (d > 24) big++; sum += d; }
    const n = p.width * p.height; return { pixels: n, changedPct: +(100 * diff / n).toFixed(3), bigPct: +(100 * big / n).toFixed(3), meanDelta: +(sum / n).toFixed(3) };
  }, [x, y]);
  console.log(style, JSON.stringify(r));
}
await browser.close();
