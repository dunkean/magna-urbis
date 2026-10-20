// Render generated source sheets into compact, alpha-preserving runtime atlases.
// Original ImageGen PNGs are retained. This tool crops transparent margins only.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../src/render/assets/fantasy/families/', import.meta.url));
const prompts = JSON.parse(await readFile(root + 'prompts.json', 'utf8'));
await mkdir(root + 'runtime/', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const manifest = JSON.parse(await readFile(root + 'runtime/manifest.json', 'utf8'));
try {
  for (const { family, file, columns = 4, variantsPerStyle = 8, sourceRows, runtimeFile = `${family}.webp` } of prompts) {
    if (process.argv[2] && family !== process.argv[2]) continue;
    const source = 'data:image/png;base64,' + (await readFile(root + file)).toString('base64');
    const result = await page.evaluate(async ({ source, columns, variantsPerStyle, sourceRows }) => {
      const image = new Image(); image.src = source; await image.decode();
      const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = image.width; sourceCanvas.height = image.height;
      const sourceCtx = sourceCanvas.getContext('2d'); sourceCtx.drawImage(image, 0, 0);
      const rgba = sourceCtx.getImageData(0, 0, image.width, image.height).data;
      const cell = 192, padding = 8, canvas = document.createElement('canvas'); canvas.width = cell * columns; canvas.height = cell * Math.ceil(variantsPerStyle * 2 / columns);
      const ctx = canvas.getContext('2d'), rects = [];
      for (let i = 0; i < variantsPerStyle * 2; i++) {
        const column = i % columns, row = Math.floor(i / columns), x0 = Math.floor(column * image.width / columns), x1 = Math.floor((column + 1) * image.width / columns);
        const y0 = sourceRows?.[row] ?? Math.floor(row * image.height / (variantsPerStyle * 2 / columns)), y1 = sourceRows?.[row + 1] ?? Math.floor((row + 1) * image.height / (variantsPerStyle * 2 / columns));
        let minX = x1, minY = y1, maxX = x0, maxY = y0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (rgba[(y * image.width + x) * 4 + 3] > 24) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        if (minX > maxX || minY > maxY) throw Error('Empty sprite cell: ' + i);
        minX = Math.max(x0, minX - 2); minY = Math.max(y0, minY - 2); maxX = Math.min(x1 - 1, maxX + 2); maxY = Math.min(y1 - 1, maxY + 2);
        const sw = maxX - minX + 1, sh = maxY - minY + 1, scale = Math.min((cell - padding * 2) / sw, (cell - padding * 2) / sh);
        const w = Math.round(sw * scale), h = Math.round(sh * scale), x = column * cell + Math.floor((cell - w) / 2), y = row * cell + cell - padding - h;
        ctx.filter = i < variantsPerStyle ? 'grayscale(1)' : 'none'; ctx.drawImage(image, minX, minY, sw, sh, x, y, w, h); rects.push([x, y, w, h]);
      }
      return { data: canvas.toDataURL('image/webp', .97).split(',')[1], width: canvas.width, height: canvas.height, rects };
    }, { source, columns, variantsPerStyle, sourceRows });
    const bytes = Buffer.from(result.data, 'base64'); await writeFile(root + `runtime/${runtimeFile}`, bytes);
    manifest[family] = { file: runtimeFile, width: result.width, height: result.height, rows: [0, .25, .5, .75, 1], variantsPerStyle, rects: result.rects };
    console.log(family, bytes.length, 'bytes', variantsPerStyle * 2, 'variants');
  }
  await writeFile(root + 'runtime/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
} finally { await browser.close(); }
