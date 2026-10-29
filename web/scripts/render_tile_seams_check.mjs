/** Transparent land overlays must composite once, including tile gutters and warm frames. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.V2_CHECK_URL ?? 'http://127.0.0.1:5187/v2.html';
const output = resolve('out/render-tile-seams'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
try {
  await page.goto(`${url}?empty`);
  const report = await page.evaluate(async base => {
    const [{ createCanvasRenderer }, { fakeWorld }, { PALETTES }] = await Promise.all([
      import(`${base}/src/render/canvas.ts`), import(`${base}/scripts/fakeworld.ts`), import(`${base}/src/render/styles.ts`),
    ]);
    const world = fakeWorld({ mapSize: 10000, buildings: 0, streets: 0, clusters: 1, landAreas: 0 });
    world.urban = undefined; world.roads = []; world.terrain.rivers = [];
    world.options = { ...world.options, labels: false, landuse: true, contours: false };
    world.landuse.areas = [{ kind: 'meadow', poly: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 10000 }, { x: 0, y: 10000 }] }];
    const results = [];
    for (const style of ['parchment', 'atlas', 'cadastre', 'blueprint', 'night']) for (const dpr of [1, 1.5, 2]) for (const transparent of [true, false]) {
      const p = { ...PALETTES[style], grain: 0, frameKind: 'none', grid: null, landOpacity: .37, landBlend: 'normal', tex: Object.fromEntries(Object.keys(PALETTES[style].tex).map(key => [key, false])) };
      const canvases = [true, false].map(raster => {
        const canvas = document.createElement('canvas'); canvas.width = Math.round(1103 * dpr); canvas.height = Math.round(799 * dpr);
        const renderer = createCanvasRenderer(canvas, world, p, { raster, dpr, transparentBackground: transparent, terrain: () => null });
        renderer.setOverlays({ labels: false, legend: false, cartouche: false }); return { canvas, renderer };
      });
      for (const offset of [0, .213, 91.753]) {
        const view = { cx: 5000 + offset, cy: 5000 - offset * .43, scale: .8 };
        for (let frame = 0; frame < 2; frame++) {
          const stats = canvases.map(({ renderer }) => renderer.draw(view));
          if (frame === 1 && !stats[0].rasterHits) throw new Error('Warm frame did not use tile cache.');
          const images = canvases.map(({ canvas }) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
          let maxAlpha = 0, maxColor = 0;
          for (let i = 0; i < images[0].length; i++) {
            const delta = Math.abs(images[0][i] - images[1][i]);
            if (i % 4 === 3) maxAlpha = Math.max(maxAlpha, delta); else maxColor = Math.max(maxColor, delta);
          }
          // Fractional bitmap filtering can round premultiplied RGB by a few bytes.
          // Coverage must remain exact; the old gutter overlap raises it visibly.
          if (maxAlpha || maxColor > 4) throw new Error(`Tile seams: ${JSON.stringify({ style, dpr, transparent, offset, frame, maxAlpha, maxColor })}`);
          if (transparent && (images[1][3] <= 0 || images[1][3] >= 255)) throw new Error('Expected a translucent reference.');
        }
      }
      canvases.forEach(({ renderer }) => renderer.dispose());
      results.push({ style, dpr, transparent, pans: 3, warmFrames: true, exactAlpha: true });
    }
    return { ok: true, cases: results };
  }, `${new URL(url).origin}/@fs/${resolve('.').replaceAll('\\', '/')}`);
  assert.equal(report.cases.length, 30);
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, cases: report.cases.length, frames: report.cases.length * 6, exactAlpha: true }));
} finally { await browser.close(); }
